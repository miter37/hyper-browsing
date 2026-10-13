import http from "node:http";
import type { BrowserContext } from "playwright";
import type { AppConfig } from "../config";
import { ensureRuntime } from "../runtime/paths";
import { ensureToken } from "./token";
import { SessionStore } from "./session-store";
import { captureSnapshot, saveSnapshot } from "../runtime/snapshot";
import { actOn, fillOrSelect, goHistory } from "../engine/interact";
import { locatorFromStrategy } from "../engine/locators";
import { detectBlock, settle } from "../engine/page-state";
import { identifySite } from "../engine/identify";
import { runKnownAction } from "../engine/action-runner";
import { effectiveRisk, heuristicRiskFromText, requiresConfirmation } from "../engine/risk";
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
import { RequestStore } from "./request-store";
import { serial } from "../runtime/learning-policy";
import crypto from "node:crypto";
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
        const result = method === "request.status" ? await this.dispatch(method, params) : await this.requests.run(requestId, method, params, () => this.dispatch(method, params));
        // How long each command took, so slow steps are visible to the agent and in transcripts.
        if (result && typeof result === "object" && !Array.isArray(result)) (result as any).durationMs = Date.now() - started;
        const full = params.verbose || params.observe || ["page.snapshot", "page.evaluate", "page.forms", "page.list", "network.stop", "page.sniffApi", "learning.notes"].includes(method);
        json(res, 200, { ok: true, result: full ? result : compactResult(result) });
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
    if (params.sessionId) return serial(`session:${this.config.runtimeDir}:${params.sessionId}`, () => this.dispatchUnlocked(method, params));
    return this.dispatchUnlocked(method, params);
  }
  private async dispatchUnlocked(method: string, params: any): Promise<any> {
    if (method === "request.status") return { queriedRequestId: params.requestId, ...this.requests.status(params.requestId) };
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
      const learning = await finishObservedLearning(this.config, params.sessionId).catch((e: any) => ({ learningPending: false, warning: e.message }));
      return { closed: params.sessionId, learning, learning_pending: false };
    }
    if (method === "session.closeAll") {
      const closed = await this.store().closeAll();
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
    if (method === "batch.run") {
      if (!page) throw new Error("sessionId required");
      return runBatch(page, params.input, async (command, result) => {
        if (result.ok) await recordLearningEvent(this.config, page, params.sessionId, "fill", { locator: command.locator || referencesFor(page).semanticLocator(command.ref), valuePresent: Boolean(command.value || command.option), batch: true });
      });
    }
    if (page && ["page.click", "page.hover", "page.fill", "page.select", "page.press"].includes(method)) {
      const kind = method.slice(5) as "click" | "hover" | "fill" | "select" | "press";
      const result = await executePrimitive(page, kind, params);
      if (result.ok && kind !== "hover") await recordLearningEvent(this.config, page, params.sessionId, kind === "select" ? "fill" : kind, {
        locator: params.locator ? { ...params.locator, ...(params.within ? { within: params.within } : {}) } : referencesFor(page).semanticLocator(params.ref),
        valuePresent: Boolean(params.value || params.option), key: params.key,
      });
      if (params.observe) result.snapshot = await captureSnapshot(page, { references: referencesFor(page), query: params.query });
      if (kind === "click") result.clicked = result.ok;
      if (kind === "hover") result.hovered = result.ok;
      return { ...result, learning_pending: false };
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
      const snapshot = await captureSnapshot(page, { query: params.query, limit: params.limit ? Number(params.limit) : undefined, references: referencesFor(page) });
      const file = params.save ? await saveSnapshot(this.config, params.sessionId, snapshot) : undefined;
      const learning = await recordLearningEvent(this.config, page, params.sessionId, "snapshot", { saved: Boolean(params.save), query: params.query });
      return { snapshot, file, learning_pending: false, learning_warning: learning.warning, learningPolicy };
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
      if (!before || !before.elements) throw new Error("params.before (PageSnapshot) required for diff");
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
      return await page.evaluate(params.expression);
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
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    await this.chrome.stop();
  }
}
