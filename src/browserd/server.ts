import http from "node:http";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config";
import { ensureRuntime } from "../runtime/paths";
import { ensureToken } from "./token";
import { SessionStore } from "./session-store";
import { captureSnapshot, saveSnapshot } from "../runtime/snapshot";
import { renderObservation } from '../runtime/hwm/renderer';
import { compareObservations, observeExecution } from '../runtime/hwm/changes';
import { ObservationService } from '../runtime/hwm/service';
import { ObservationError } from '../runtime/hwm/store';
import { parseHwm } from '../runtime/hwm/view';
import type { ProjectionOptions } from '../runtime/hwm/projection';
import { actOn, fillOrSelect, goHistory } from "../engine/interact";
import { locatorFromStrategy } from "../engine/locators";
import { detectBlock, settle } from "../engine/page-state";
import { identifySite } from "../engine/identify";
import { runKnownAction } from "../engine/action-runner";
import { effectiveRisk, heuristicRiskFromText, requiresConfirmation } from "../engine/risk";
import { inspectPageState } from '../engine/page-state';
import { verifyPage } from '../engine/verify';
import { evidenceFor } from "../runtime/metrics";
import { detectState } from "../engine/state";
import path from "node:path";
import { redactText } from "../utils/strings";
import { recordLearningEvent, encodeObservedExtraction, learningStatus, learningContext, finishObservedLearning } from "../runtime/learning";
import { finishLearning, readNotes, saveNotes } from "../runtime/learning-policy";
import { saveObservedAction } from "../runtime/learning-assets";
import { runOverview, saveOverview } from "../runtime/overview";
import { actionRevision, assetStatus, recordAssetFailure } from "../engine/asset-state";
import { referencesFor } from "../runtime/references";
import { executePrimitive } from "../engine/execute";
import { runBatch } from "../engine/batch";
import { compactResult } from "../runtime/output";
import {renderCommandResult} from '../runtime/hwm/result';
import {DemandObservationService} from '../runtime/observation/service';
import {ObservationStore} from '../runtime/hwm/store';
import { RequestStore } from "./request-store";
import { serial } from "../runtime/learning-policy";
import crypto from "node:crypto";
import { needsHeadedFallback, safeHeadedRetry, recoverableBrowserError } from "./headed-fallback";
import { ChromeManager, listChromeProfiles, resolveChromeProfile, type ProfileMode } from "./chrome-manager";
import { navigate } from "../engine/navigate";
import { dismissAnnoyances, analyzeForms, compareSnapshots, sniffApi, waitForIdle, scrollPage, waitForElement, listItems } from "../runtime/discovery-tools";

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export class BrowserDaemon {
  private observations=new ObservationService(new ObservationStore({maxBytes:14*1024*1024}));
  private demand=new DemandObservationService({detailed:this.observations});
  private projection(params:any):ProjectionOptions{
    if(params.mode!==undefined&&!['full','overview','focus'].includes(params.mode))throw Object.assign(new Error('mode must be full, overview or focus'),{execution:'not_started'});
    const options:ProjectionOptions={mode:params.mode??(params.format==='hwm'?'overview':'full'),focus:params.focus};
    for(const key of ['nodeBudget','textBudget','changeBudget'] as const)if(params[key]!==undefined){const n=Number(params[key]);if(!Number.isSafeInteger(n)||n<1||n>1000000)throw Object.assign(new Error('Invalid projection budget'),{execution:'not_started'});options[key]=n;}
    if(options.mode==='focus'&&!options.focus)throw Object.assign(new Error('focus mode requires focus'),{execution:'not_started'});return options;
  }
  private publish(params:any,data:Parameters<NonNullable<Parameters<typeof observeExecution>[5]>>[0]){
    const stored=this.observations.remember(params.sessionId,data.after,data.header);if(!stored.ok)return {retention:stored,...(params.format==='hwm'?{hwm:renderObservation(data.after,{session:params.sessionId,before:data.before,changes:data.changes,result:data.result,projection:this.projection(params),retentionFailure:stored.reason,extraHeader:{...data.header,retention:{...stored}}})}:{})};
    let comparison:string|undefined;
    if(data.before){try{comparison=this.observations.rememberComparison(params.sessionId,data.before,data.after,data.changes,data.result).id;}catch{/* Keep execution evidence even when retention refuses a comparison. */}}
    const result:Record<string,unknown>=params.format==='hwm'?(comparison?this.observations.comparison(params.sessionId,comparison,this.projection(params)):{hwm:renderObservation(data.after,{session:params.sessionId,before:data.before,changes:data.changes,result:data.result,extraHeader:{...data.header,retention:JSON.parse(JSON.stringify({...stored,comparison:'unavailable'}))}})}):{};
    delete result.ok;
    return {...result,observation:data.after.observation,...(comparison?{comparison}:{retention:{comparison:'unavailable'}})};
  }
  private context?: BrowserContext;
  private sessions?: SessionStore;
  private chrome: ChromeManager;
  private token = "";
  private requests = new RequestStore();
  private server?: http.Server;
  private networkLogs = new Map<string, any[]>();
  private networkListeners = new Map<string, { request: (req: any) => void; response: (res: any) => void }>();

  constructor(private config: AppConfig) { this.chrome = new ChromeManager(config); }

  async start(): Promise<void> {
    await ensureRuntime(this.config);
    this.token = await ensureToken(this.config);
    const started = await this.chrome.start();
    this.context = started.context;
    this.sessions = new SessionStore(this.context);
    await this.sessions.adoptExisting();

    this.server = http.createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/health") return json(res, 200, { status: "ok", pid: process.pid, chrome: this.chrome.getState() });
      if (req.method !== "POST" || req.url !== "/rpc") return json(res, 404, { error: "not_found" });
      if (req.headers.authorization !== `Bearer ${this.token}`) return json(res, 401, { error: "unauthorized" });
      try {
        const { method, params = {}, requestId = crypto.randomUUID() } = await readJson(req);
        const started = Date.now();
        let result = method === "request.status" ? await this.dispatch(method, params) : await this.requests.run(requestId, method, params, () => this.dispatch(method, {...params,observationRequestId:requestId}));
        // Command duration belongs to the same result consumed by the HWM renderer.
        if (result && typeof result === "object" && !Array.isArray(result)) result.durationMs = Date.now() - started;
        // The HWM wire carries one representation; never ship the entire JSON graph as a duplicate.
        if(params.format==='hwm'){
          let page:Page|undefined;try{page=params.sessionId?this.sessions?.get(params.sessionId):undefined;}catch{/* A closed session still has a valid command result. */}
          try{
            const hwm=renderCommandResult(result,{session:params.sessionId??'unobserved',document:page?referencesFor(page).documentIdentity():'unobserved',url:page?page.url():result?.url??'about:blank'});
            if(result&&typeof result==='object'&&!Array.isArray(result))result.hwm=hwm;else result={value:result,hwm,durationMs:Date.now()-started};
          }catch{
            // An output error must not change an already-known execution outcome.
            if(result&&typeof result==='object'&&!Array.isArray(result)){delete result.hwm;result.observationError='result-projection-failed';}else result={value:result,observationError:'result-projection-failed'};
          }
        }
        // How long each command took, so slow steps are visible to the agent and in transcripts.
        const full = params.verbose || params.observe || params.context || ["page.snapshot", "page.evaluate", "page.forms", "page.list", "network.stop", "page.sniffApi", "learning.notes"].includes(method);
        const output=params.format==='hb'?result:params.format==='hwm'?Object.fromEntries(Object.entries(result).filter(([key])=>!['snapshot','changes'].includes(key))):full?result:compactResult(result);
        json(res, 200, { ok: true, result: output });
      } catch (error: any) {
        json(res, 200, { ok: false, execution: error.execution === "not_started" ? "not_started" : "outcome_unknown", error: error?.message || String(error), stack: process.env.WEBAGENT_DEBUG ? error?.stack : undefined });
      }
    });

    await new Promise<void>((resolve) => this.server!.listen(this.config.port, this.config.host, resolve));
  }

  private store(): SessionStore {
    if (!this.sessions) throw new Error("browserd not started");
    return this.sessions;
  }

  private async dispatch(method: string, params: any): Promise<any> {
    // A display change relaunches the shared Chrome instance. Never interrupt an
    // in-flight operation in another session, and leave status queries unblocked.
    if (["request.status", "learning.status", "learning.finish"].includes(method)||method.startsWith('observation.')) return this.dispatchUnlocked(method, params);
    return serial(`browser:${this.config.runtimeDir}`, () => this.dispatchWithFallback(method, params));
  }
  private async dispatchWithFallback(method: string, params: any): Promise<any> {
    let original: any;
    try { original = await this.dispatchUnlocked(method, params); }
    catch (error: any) {
      if (error.execution === "not_started" || !recoverableBrowserError(error)) throw error;
      original = { ok: false, execution: "outcome_unknown", reason: "browser_error", error: error.message };
    }
    const probeSession = method === 'session.open' ? original.id : params.sessionId;
    if (probeSession && !original.confirmationRequired && !original.pageState && !original.snapshot?.pageState && !original.effect?.pageState
      && (original.ok === false || ['session.open','page.goto'].includes(method))) {
      if(method==='session.open'&&params.url&&original.navigationError){
        // The error document is not evidence that the requested page is ready.
        original.pageState={state:'navigation_error',evidence:String(original.navigationError).split('\n')[0]};
      }else{
        try { original.pageState = await inspectPageState(this.store().get(probeSession),undefined,3000); } catch { /* Preserve the original execution outcome. */ }
      }
    }
    if (!needsHeadedFallback(method, original) || this.chrome.getState()?.headless !== true) return original;
    const fallback: any = { attempted: true, from: "headless", to: "headed", retried: false, observationRequired: true,
      reason: original.reason || original.blocked || original.navigationError || "headless_failure" };
    try {
      // Capture up-to-date URLs before destroying Playwright handles.
      await this.store().list();
      await this.chrome.writeDisplayPreference({ headless: false });
      const repaired = await this.chrome.repair();
      this.context = repaired.context;
      await this.store().rebindContext(repaired.context);
      fallback.switched = true;
    } catch (error: any) {
      fallback.error = error.message;
      return { ...original, headedFallback: fallback };
    }
    const sessionId = method === "session.open" ? original.id : params.sessionId;
    const retryMethod = method === "session.open" ? "page.goto" : method;
    const retryParams = method === "session.open" ? { ...params, sessionId } : params;
    if (sessionId && safeHeadedRetry(retryMethod, retryParams) && (method !== "session.open" || params.url)) {
      fallback.retried = true;
      try {
        const result = await this.dispatchUnlocked(retryMethod, retryParams);
        fallback.observationRequired = needsHeadedFallback(retryMethod, result);
        return { ...result, ...(method === "session.open" ? { id: sessionId } : {}), headedFallback: fallback };
      } catch (error: any) { fallback.retryError = error.message; }
    }
    return { ...original, headedFallback: fallback,
      hint: "Chrome switched to headed mode. Observe the current page and continue; do not replay writes, batches or old element references." };
  }
  private async dispatchUnlocked(method: string, params: any): Promise<any> {
    if (method === "request.status") return { queriedRequestId: params.requestId, ...this.requests.status(params.requestId) };
    if(method.startsWith('observation.')){
      try{
        if(!params.sessionId)throw new ObservationError('session_required');
        if(params.format!==undefined&&!['json','hwm'].includes(params.format))throw new ObservationError('unsupported_format');
        if(method==='observation.inspect')return this.observations.inspect(params.sessionId,params.observation,params.target);
        const result=method==='observation.view'?this.observations.view(params.sessionId,params.observation,this.projection(params)):
          method==='observation.changes'?this.observations.comparison(params.sessionId,params.comparison,this.projection(params)):
          method==='observation.expand'?params.comparison?this.observations.expandChanges(params.sessionId,params.comparison,params.target):this.observations.expand(params.sessionId,params.observation,params.target,this.projection(params)):undefined;
        if(!result)throw new ObservationError('unknown_observation_method');
        if(params.format==='hwm')return result;const {hwm,...meta}=result;return {...meta,view:parseHwm(hwm)};
      }catch(e:any){return {ok:false,execution:'not_started',reason:e.code??'invalid_observation_request',error:e.message};}
    }
    // Bookkeeping and cleanup must not launch/restart Chrome or block a finished user task.
    if (method === "learning.finish") {
      try { return await finishLearning(this.config, params.sessionId, params.input || { taskStatus: params.taskStatus, decision: params.decision, reason: params.reason }); }
      catch (e: any) { if (!e.code) throw e; return { taskStatus: params.taskStatus || params.input?.taskStatus, learningSaved: false, warning: e.message }; }
    }
    if (method === "learning.status") {
      return await learningStatus(this.config, params.sessionId).catch((e: any) => ({ active: false, learningPending: false, warning: e.message }));
    }
    if (method === "session.close") {
      await this.store().close(params.sessionId);
      this.observations.clearSession(params.sessionId);
      await this.demand.clearSession(params.sessionId);
      const learning = await finishObservedLearning(this.config, params.sessionId).catch((e: any) => ({ learningPending: false, warning: e.message }));
      return { closed: params.sessionId, learning, learning_pending: false };
    }
    if (method === "session.closeAll") {
      const closed = await this.store().closeAll();
      for(const id of closed)this.observations.clearSession(id);
      for(const id of closed)await this.demand.clearSession(id);
      for (const sessionId of closed) await finishObservedLearning(this.config, sessionId).catch(() => {});
      return { closed, count: closed.length };
    }
    const current = await this.chrome.ensureConnected();
    if (current !== this.context) {
      this.context = current;
      if (this.sessions) await this.sessions.rebindContext(current);
      else { this.sessions = new SessionStore(current); await this.sessions.adoptExisting(); }
    }
    if (method === "health") return { status: "ok", pid: process.pid, chrome: this.chrome.getState() };
    if (method === "browser.status") return { status: "ok", chrome: this.chrome.getState(), sessions: await this.store().list() };
    if (method === "browser.profiles") {
      const profiles = await listChromeProfiles();
      return {
        profiles: profiles.map((p, index) => ({ index, first: index === 0, ...p })),
        preference: await this.chrome.readPreference(),
        active: this.chrome.getState(),
      };
    }
    if (method === "browser.use") {
      // Validate the requested profile before persisting it, so a typo cannot wedge startup.
      const preference = params.reset ? {} : {
        profileName: params.profile || undefined,
        mode: (params.mode as ProfileMode) || undefined,
        userDataDir: params.userDataDir || undefined,
        profileDirectory: params.profileDirectory || undefined,
      };
      const resolved = await resolveChromeProfile(this.config, { preference });
      const saved = await this.chrome.writePreference(preference);
      const repaired = await this.chrome.repair();
      this.context = repaired.context;
      if (this.sessions) await this.sessions.rebindContext(repaired.context);
      else { this.sessions = new SessionStore(repaired.context); await this.sessions.adoptExisting(); }
      return { status: "switched", preference: saved, resolved, chrome: repaired.state, takeover: repaired.takeover };
    }
    if (method === "browser.repair") {
      const repaired = await this.chrome.repair();
      this.context = repaired.context;
      if (this.sessions) await this.sessions.rebindContext(repaired.context);
      else { this.sessions = new SessionStore(repaired.context); await this.sessions.adoptExisting(); }
      return { status: "repaired", chrome: repaired.state, takeover: repaired.takeover, sessions: await this.store().list() };
    }
    if (method === "browser.reveal" || method === "browser.hide") {
      // Changing headless is launch-time only in Chrome - there is no live CDP toggle - so
      // this relaunches the browser. Open tabs are not lost: rebindContext() reopens every
      // tracked session at its last known URL in the new window, same as browser.repair does.
      await this.chrome.writeDisplayPreference({ headless: method === "browser.hide" });
      const repaired = await this.chrome.repair();
      this.context = repaired.context;
      if (this.sessions) await this.sessions.rebindContext(repaired.context);
      else { this.sessions = new SessionStore(repaired.context); await this.sessions.adoptExisting(); }
      return {
        status: method === "browser.reveal" ? "revealed" : "hidden",
        chrome: repaired.state,
        sessions: await this.store().list(),
      };
    }
    if (method === "session.open") {
      const viewport = typeof params.viewport === "string" ? params.viewport.match(/^(\d{3,5})[x,](\d{3,5})$/) : null;
      const locale = typeof params.locale === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(params.locale) ? params.locale : undefined;
      const opened: any = await this.store().open(params.url, {
        prepare: async (p) => {
          if (viewport) await p.setViewportSize({ width: Number(viewport[1]), height: Number(viewport[2]) });
          if (locale) {
            // Accept-Language and navigator.language for this tab only.
            const cdp = await p.context().newCDPSession(p);
            const ua = await cdp.send("Browser.getVersion").then((v: any) => v.userAgent).catch(() => undefined);
            if (ua) await cdp.send("Network.setUserAgentOverride", { userAgent: ua, acceptLanguage: locale });
            await cdp.send("Emulation.setLocaleOverride", { locale: locale.replace("-", "_") }).catch(() => {});
          }
        },
      });
      if (params.url && !opened.navigationError) {
        const blocked = await detectBlock(this.store().get(opened.id));
        if (blocked) opened.blocked = blocked;
      }
      return opened;
    }
    if (method === "session.list") return this.store().list();
    const page = params.sessionId ? this.store().get(params.sessionId) : undefined;
    if(['page.read','page.explain'].includes(method)){
      if(!page)throw Object.assign(new Error('sessionId required'),{execution:'not_started'});
      return method==='page.read'?this.demand.read(page,params.sessionId,params):this.demand.explain(page,params.sessionId,params);
    }
    if (method === "batch.run") {
      if (!page) throw new Error("sessionId required");
      if(params.format&&!['hb','json','hwm'].includes(params.format))throw new Error('format must be hb, json or hwm');
      this.projection(params);
      const execute=()=>runBatch(page, params.input, async (command, result) => {
        if (result.ok) await recordLearningEvent(this.config, page, params.sessionId, "fill", { locator: command.locator || referencesFor(page).semanticLocator(command.ref), valuePresent: Boolean(command.value || command.option), batch: true });
      });
      if(params.format==='hb')return this.demand.result(page,params.sessionId,await execute(),params);
      return params.context===true||params.format==='hwm'?observeExecution(page,params.sessionId,execute,params.observationRequestId,params.format==='hwm'?'hwm':'json',data=>this.publish(params,data),{lightweight:params.context!==true,query:params.query,before:this.observations.latest(params.sessionId)}):execute();
    }
    if (page && ["page.click", "page.hover", "page.fill", "page.select", "page.press"].includes(method)) {
      if(params.format&&!['hb','json','hwm'].includes(params.format))throw new Error('format must be hb, json or hwm');
      this.projection(params);
      const kind = method.slice(5) as "click" | "hover" | "fill" | "select" | "press";
      const context=params.context===true||params.format==='hwm';
      const result:any = context?await observeExecution(page,params.sessionId,()=>executePrimitive(page,kind,params),params.observationRequestId,params.format==='hwm'?'hwm':'json',data=>this.publish(params,data),{lightweight:params.context!==true,before:this.observations.latest(params.sessionId),query:params.query??(params.ref?referencesFor(page).metadata(params.ref)?.name:params.locator?.name??params.locator?.label??params.locator?.placeholder)}) : await executePrimitive(page, kind, params);
      if (result.ok && kind !== "hover") await recordLearningEvent(this.config, page, params.sessionId, kind === "select" ? "fill" : kind, {
        locator: params.locator ? { ...params.locator, ...(params.within ? { within: params.within } : {}) } : referencesFor(page).semanticLocator(params.ref),
        valuePresent: Boolean(params.value || params.option), key: params.key,
      });
      if (params.observe&&!context) result.snapshot = await captureSnapshot(page, { references: referencesFor(page), query: params.query });
      if (kind === "click") result.clicked = result.ok;
      if (kind === "hover") result.hovered = result.ok;
      return params.format==='hb'?this.demand.result(page,params.sessionId,result,params):{ ...result, learning_pending: false };
    }
    if(method==='page.verify'){
      if(!page)throw new Error('sessionId required');
      return verifyPage(page,params.input);
    }
    let learningPolicy: any;
    if (page) learningPolicy = await learningContext(this.config, page, params.sessionId).catch((e: any) => ({ warning: e.message }));
    if (method === "learning.notes" || method === "learning.notes.save") {
      if (!page || !learningPolicy?.key) throw new Error("Observe an HTTP(S) site first");
      if (method === "learning.notes.save") return saveNotes(this.config, params.sessionId, learningPolicy.key, params.notes || params.input?.notes);
      const notes = await readNotes(this.config, learningPolicy.key, params.capability);
      // Index first; text is only loaded for a selected capability.
      return { policy: learningPolicy, notes: params.capability ? notes : notes.map(({ text, ...index }) => index) };
    }
    if (method === "learning.action.save") {
      if (!page) throw new Error("sessionId required");
      return saveObservedAction(this.config, page, params.sessionId, params.input);
    }
    if (method === "overview.save" || method === "overview.run") {
      if (!page) throw new Error("sessionId required");
      const onProbe = (p: any) => this.store().ignore(p);
      return method === "overview.save" ? saveOverview(this.config, page, params.sessionId, params.input, onProbe)
        : runOverview(this.config, page, params.sessionId, { siteId: params.siteId, onProbe });
    }
    if (method === "asset.status" || method === "asset.report") {
      if (!page) throw new Error("sessionId required");
      const identified = params.siteId ? { loaded: await (await import("../engine/site-loader")).loadSite(this.config, params.siteId) } : await identifySite(this.config, page);
      if (!identified) throw new Error("No registered site matches");
      const site = identified.loaded.definition.site.id;
      const revision = await actionRevision(identified.loaded, params.actionId);
      if (method === "asset.report") {
        if (!["wrong_result", "structure", "locator"].includes(params.reason)) throw new Error("Report a confirmed structural failure or wrong result");
        await recordAssetFailure(this.config, site, params.actionId, revision, params.reason, params.sessionId);
      }
      return assetStatus(this.config, site, params.actionId, revision);
    }
    if (method === "page.goto") {
      if (!page) throw new Error("sessionId required");
      const res: any = await navigate(page, params.url);
      const blocked = await detectBlock(page);
      if (blocked) res.blocked = blocked;
      if (!blocked) await recordLearningEvent(this.config, page, params.sessionId, "goto", { status: res.status });
      if (params.observe) {
        res.snapshot = await captureSnapshot(page, { references: referencesFor(page) });
      }
      return res;
    }
    if (method === "page.snapshot") {
      if (!page) throw new Error("sessionId required");
      if (params.format !== undefined && !['hb','json','hwm'].includes(params.format)) throw new Error('Unsupported snapshot format; use hb, json or hwm');
      if(params.format==='hb'){
        if(params.query&&!params.map)return {ok:false,execution:'not_started',reason:'scope_required',hint:'Use snapshot for the map, then read --map M --panel P --query TEXT; or explicit --format json for legacy discovery.'};
        if(params.map)return this.demand.read(page,params.sessionId,{...params,want:params.want??'controls'});
        const map=await this.demand.map(page,params.sessionId,params);return {...map,pageState:await inspectPageState(page,undefined,0),blocked:await detectBlock(page)};
      }
      const projection=this.projection(params);
      const snapshot = await captureSnapshot(page, { query: params.query, limit: params.limit ? Number(params.limit) : undefined, references: referencesFor(page), context: true, contextLimit: params.contextLimit ? Number(params.contextLimit) : undefined });
      if(params.format==='hwm'&&!snapshot.contextGraph) return {ok:false,execution:'not_started',reason:'capture_failed',snapshot};
      const header=JSON.parse(JSON.stringify({'collection-timing':snapshot.collectionTiming,'state-observation':{...snapshot.stateObservation,pageState:snapshot.pageState,blocked:snapshot.blocked}}));
      const retention=snapshot.contextGraph?this.observations.remember(params.sessionId,snapshot.contextGraph,header):undefined;
      const hwm=params.format==='hwm'&&snapshot.contextGraph?retention?.ok?this.observations.view(params.sessionId,snapshot.contextGraph.observation,projection).hwm:renderObservation(snapshot.contextGraph,{session:params.sessionId,projection,retentionFailure:retention?.reason??'observation_unavailable',extraHeader:{...header,retention:{...retention}}}):undefined;
      const file = params.save ? await saveSnapshot(this.config, params.sessionId, snapshot) : undefined;
      const learning = await recordLearningEvent(this.config, page, params.sessionId, "snapshot", { saved: Boolean(params.save), query: params.query });
      return { snapshot, hwm, file,retention, learning_pending: false, learning_warning: learning.warning, learningPolicy };
    }
    if (method === "page.list") {
      if (!page) throw new Error("sessionId required");
      return await listItems(page, { query: params.query, limit: params.limit ? Number(params.limit) : undefined });
    }
    if (method === "page.back" || method === "page.forward") {
      if (!page) throw new Error("sessionId required");
      return await goHistory(page, method === "page.back" ? "back" : "forward");
    }
    if (method === "page.extract") {
      if (!page) throw new Error("sessionId required");
      const readOne = async (locator: any, timeout: number): Promise<string | null> => {
        if (params.read === "value") return locator.inputValue({ timeout });
        if (params.read === "attribute") return locator.getAttribute(params.attribute, { timeout });
        return (await locator.innerText({ timeout })).trim();
      };
      if (params.all) {
        // Every visible match, in page order: reading a list is not ambiguous.
        const visible = locatorFromStrategy(page, params.locator).filter({ visible: true });
        const n = Math.min(await visible.count(), Math.max(1, Math.min(Number(params.limit) || 20, 100)));
        const values: Array<string | null> = [];
        for (let i = 0; i < n; i++) values.push(await readOne(visible.nth(i), 2000).catch(() => null));
        await recordLearningEvent(this.config, page, params.sessionId, "extract", { locator: params.locator, read: params.read || "text", all: true });
        return { values, count: await visible.count() };
      }
      const outcome: any = await executePrimitive(page, "extract", params);
      if (!outcome.ok) return outcome;
      const value: string | null = outcome.value;
      // Encoding the read as site knowledge writes into sites/<site>/; only when asked (--learn).
      let learningWarning: string | undefined;
      const semanticLocator = params.locator || referencesFor(page).semanticLocator(params.ref);
      const learned = params.learn && semanticLocator
        ? await encodeObservedExtraction(this.config, page, params.sessionId, semanticLocator, params.read || "text", params.attribute, Boolean(params.requested)).catch((e: any) => { learningWarning = e.message; return undefined; })
        : undefined;
      const learning = await recordLearningEvent(
        this.config, page, params.sessionId, "extract",
        { locator: semanticLocator, read: params.read || "text", attribute: params.attribute },
        learned?.actionId
      );
      return { value, learned, resolvedBy: outcome.resolvedBy, execution: outcome.execution, learning_pending: false, learning_warning: learningWarning || learning.warning };
    }


    if (method === "page.screenshot") {
      if (!page) throw new Error("sessionId required");
      const file = path.join(this.config.runtimeDir, "snapshots", `${Date.now()}-${params.sessionId}.png`);
      await page.screenshot({ path: file, fullPage: Boolean(params.fullPage) });
      return { file };
    }
    if (method === "network.start") {
      if (!page) throw new Error("sessionId required");
      const old = this.networkListeners.get(params.sessionId);
      if (old) { page.off("request", old.request); page.off("response", old.response); }
      const logs: any[] = [];
      const safeUrl = (raw: string) => {
        try { const u = new URL(raw); for (const key of [...u.searchParams.keys()]) u.searchParams.set(key, "<redacted>"); return redactText(u.toString()); }
        catch { return redactText(raw); }
      };
      const request = (req: any) => { if (logs.length < 500) logs.push({ type: "request", at: new Date().toISOString(), method: req.method(), resourceType: req.resourceType(), url: safeUrl(req.url()) }); };
      const response = (res: any) => { if (logs.length < 500) logs.push({ type: "response", at: new Date().toISOString(), status: res.status(), url: safeUrl(res.url()) }); };
      page.on("request", request); page.on("response", response);
      this.networkLogs.set(params.sessionId, logs);
      this.networkListeners.set(params.sessionId, { request, response });
      return { started: true };
    }
    if (method === "network.stop") {
      if (!page) throw new Error("sessionId required");
      const listeners = this.networkListeners.get(params.sessionId);
      if (listeners) { page.off("request", listeners.request); page.off("response", listeners.response); }
      this.networkListeners.delete(params.sessionId);
      const events = this.networkLogs.get(params.sessionId) || [];
      this.networkLogs.delete(params.sessionId);
      return { events };
    }

    // --- Discovery Tools for Unknown Sites ---
    if (method === "page.dismissAnnoyances") {
      if (!page) throw new Error("sessionId required");
      return await dismissAnnoyances(page, { forceHide: Boolean(params.forceHide) });
    }
    if (method === "page.forms") {
      if (!page) throw new Error("sessionId required");
      return await analyzeForms(page);
    }
    if (method === "page.diff") {
      if (!page) throw new Error("sessionId required");
      const before: any = params.before;
      if(params.format&&!['json','hwm'].includes(params.format))throw new Error('format must be json or hwm');
      const graph=before?.contextGraph??before?.snapshot?.contextGraph;
      if(graph&&(params.context===true||params.format==='hwm')){
        const after=await captureSnapshot(page,{references:referencesFor(page),context:true});
        if(!after.contextGraph)return {after,observationError:'capture-failed'};
        const changes=compareObservations(graph,after.contextGraph);
        return {changes,after,...this.publish(params,{before:graph,after:after.contextGraph,changes,result:{execution:'completed',operation:'observation-comparison'},header:JSON.parse(JSON.stringify({'collection-timing':after.collectionTiming,'state-observation':after.stateObservation}))})};
      }
      if (!before || !before.elements) throw new Error("params.before (PageSnapshot) required for diff; context diff requires a saved contextGraph");
      if(params.context===true||params.format==='hwm')throw new Error('Context diff requires a saved contextGraph');
      const after = await captureSnapshot(page, { references: referencesFor(page) });
      const diff = compareSnapshots(before, after);
      return { diff, after };
    }
    if (method === "page.sniffApi") {
      if (!page) throw new Error("sessionId required");
      return await sniffApi(page, params.durationMs ? Number(params.durationMs) : 2500);
    }
    if (method === "page.waitForIdle") {
      if (!page) throw new Error("sessionId required");
      return await waitForIdle(page, params.timeoutMs ? Number(params.timeoutMs) : 10000);
    }
    if (method === "page.scroll") {
      if (!page) throw new Error("sessionId required");
      return await scrollPage(page, {
        direction: params.direction,
        distance: params.distance ? Number(params.distance) : undefined,
        times: params.times ? Number(params.times) : undefined,
        selector: params.selector,
        delayMs: params.delayMs ? Number(params.delayMs) : undefined,
      });
    }
    if (method === "page.waitFor") {
      if (!page) throw new Error("sessionId required");
      return await waitForElement(page, {
        css: params.css,
        text: params.text,
        timeoutMs: params.timeoutMs ? Number(params.timeoutMs) : undefined,
        state: params.state,
      });
    }
    if (method === "page.evaluate") {
      if (!page) throw new Error("sessionId required");
      const value=await page.evaluate(params.expression);
      if(params.format!=='hwm')return value;
      // HWM identifies the expression scope; JSON keeps its original value API.
      const points=Array.from(String(params.expression));
      return {value,scope:'eval-expression',expression:points.slice(0,240).join(''),...(points.length>240?{expressionTruncated:true,expressionLength:points.length,expressionLengthUnit:'unicode-code-point'}:{})};
    }

    if (method === "site.identify") {
      if (!page) throw new Error("sessionId required");
      const identified = await identifySite(this.config, page);
      if (!identified) return { known: false, url: page.url() };
      const def = identified.loaded.definition;
      const actions = Object.entries(def.actions || {});
      const knowledge = actions.length + Object.keys(def.urlTemplates || {}).length + Object.keys(def.extractors || {}).length;
      // A site folder with no actions, URL templates or extractors (an empty scaffold) gives nothing to run.
      if (!knowledge) return { known: false, scaffoldOnly: true, site: def.site, path: identified.loaded.dir, url: page.url() };
      return {
        known: true,
        site: def.site,
        state: identified.state,
        variant: identified.variant,
        path: identified.loaded.dir,
        url: page.url(),
        actions: actions.slice(0, 15).map(([id, a]: [string, any]) => ({ id, description: a.description, inputs: a.inputs ? Object.keys(a.inputs) : undefined })),
        learningPolicy,
        hint: "Run a listed action with `webctl run <id>`; see `webctl actions` for state-specific availability. Read sites/<id>/SKILL.md for notes.",
      };
    }

    if (method === "action.list") {
      if (!page) throw new Error("sessionId required");
      const identified = await identifySite(this.config, page);
      if (!identified) return { known: false, actions: [] };
      const site = identified.loaded.definition;
      const state = await detectState(page, site);
      const variant = state.variant || "_unknown";
      const actions = [];
      for (const [id, action] of Object.entries(site.actions)) {
        if (action.allowedStates?.length && (!state.state || !action.allowedStates.includes(state.state))) continue;
        const variantSpec = action.variants?.[variant];
        if (action.variants && !variantSpec) continue;
        const storedLifecycle = variantSpec?.lifecycle ?? action.lifecycle;
        const revision = await actionRevision(identified.loaded, id);
        const recovery = await assetStatus(this.config, site.site.id, id, revision);
        const evidence = await evidenceFor(this.config, site.site.id, id, variant, revision);
        const lifecycle = evidence.successfulSessions >= 2 ? "verified" : evidence.successes >= 1 ? "candidate" : "encoded";
        actions.push({
          id,
          description: action.description,
          lifecycle,
          storedLifecycle,
          scope: action.knowledge?.scope,
          revision,
          recovery,
          preferred: lifecycle === "verified" && !recovery.suspended,
          risk: effectiveRisk(id, action),
          evidence,
        });
      }
      return { known: true, site: site.site.id, state: state.state, variant, actions };
    }

    if (method === "action.run") {
      if (!page) throw new Error("sessionId required");
      const identified = params.siteId
        ? { loaded: await (await import("../engine/site-loader")).loadSite(this.config, params.siteId) }
        : await identifySite(this.config, page);
      if (!identified) throw new Error("No registered site matches the current page");
      return runKnownAction(this.config, page, identified.loaded, {
        sessionId: params.sessionId,
        actionId: params.actionId,
        input: params.input || {},
        confirmed: Boolean(params.confirmed),
      });
    }

    throw new Error(`Unknown RPC method: ${method}`);
  }

  async stop(): Promise<void> {
    await this.demand.close();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    await this.chrome.stop();
  }
}
