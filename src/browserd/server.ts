import http from "node:http";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config";
import { ensureRuntime } from "../runtime/paths";
import { ensureToken } from "./token";
import { SessionStore } from "./session-store";
import { captureSnapshot, saveSnapshot } from "../runtime/snapshot";
import { actOn, fillOrSelect, goHistory } from "../engine/interact";
import { locatorFromStrategy, resolveUnique } from "../engine/locators";
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
import { RequestStore } from "./request-store";
import { serial } from "../runtime/learning-policy";
import crypto from "node:crypto";
import { needsHeadedFallback, safeHeadedRetry, recoverableBrowserError } from "./headed-fallback";
import { ChromeManager, listChromeProfiles, resolveChromeProfile, type ProfileMode } from "./chrome-manager";
import { navigate } from "../engine/navigate";
import { findFrame, frameView, listFrames, FRAME_HINT } from "./frame-view";
import { recordMemoryStep, describeUrlChange, rememberTyped, memoryFor, closeMemory, draftMemory, acceptDraft, saveFacts, removeNotes, siteGuide } from "../runtime/site-memory";
import { dismissAnnoyances, analyzeForms, compareSnapshots, sniffApi, waitForIdle, scrollPage, waitForElement, listItems } from "../runtime/discovery-tools";

// A page-load popup watch stops at the first of these: from then on a new dialog may be the agent's own doing.
const USER_ACTIONS = new Set(["page.click", "page.hover", "page.fill", "page.select", "page.press", "page.scroll", "page.evaluate",
  "page.dismissAnnoyances", "batch.run", "action.run", "overview.run", "session.close"]);
const LOAD_POPUP_WATCH_MS = 8000;

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) {
      req.destroy();
      const error = new Error("RPC body exceeds 8 MiB") as Error & { execution?: string };
      error.execution = "not_started";
      throw error;
    }
    chunks.push(Buffer.from(chunk));
  }
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
  private networkListeners = new Map<string, { page: Page; request: (req: any) => void; response: (res: any) => void }>();

  /** Detach listeners before sessions close or Chrome is replaced. */
  private clearNetwork(sessionId?: string): void {
    const ids = sessionId ? [sessionId] : [...this.networkListeners.keys()];
    for (const id of ids) {
      const entry = this.networkListeners.get(id);
      if (entry) {
        entry.page.off("request", entry.request);
        entry.page.off("response", entry.response);
      }
      this.networkListeners.delete(id);
      this.networkLogs.delete(id);
    }
  }

  constructor(private config: AppConfig) { this.chrome = new ChromeManager(config); }

  async start(): Promise<void> {
    await ensureRuntime(this.config);
    this.token = await ensureToken(this.config);
    const started = await this.chrome.start();
    this.context = started.context;
    this.sessions = new SessionStore(this.context);
    await this.sessions.adoptExisting();

    this.server = http.createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        if (req.headers["x-browserd-token"] !== this.token) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { status: "ok", pid: process.pid, chrome: this.chrome.getState() });
      }
      if (req.method !== "POST" || req.url !== "/rpc") return json(res, 404, { error: "not_found" });
      if (req.headers.authorization !== `Bearer ${this.token}`) return json(res, 401, { error: "unauthorized" });
      try {
        const { method, params = {}, requestId = crypto.randomUUID() } = await readJson(req);
        const started = Date.now();
        if (params.sessionId && USER_ACTIONS.has(method)) await this.loadPopupWatch.get(params.sessionId)?.stop();
        if (method === "session.closeAll") for (const watch of this.loadPopupWatch.values()) await watch.stop();
        const result = method === "request.status" ? await this.dispatch(method, params) : await this.requests.run(requestId, method, params, () => this.dispatch(method, params));
        await this.afterLoadPopups(method, params, result);
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

  // Popups that open by themselves after a page load (sign-in promos, consent banners) are closed without being
  // asked. The watch ends at the first user action on the tab, so a dialog the agent opened itself is never touched.
  private loadPopupWatch = new Map<string, { log: string[]; stop: () => Promise<void> }>();
  private async afterLoadPopups(method: string, params: any, result: any): Promise<void> {
    if (!result || typeof result !== "object" || Array.isArray(result)) return;
    const sessionId = method === "session.open" ? result.id : params.sessionId;
    if (!sessionId) return;
    if (method === "session.close") { this.loadPopupWatch.delete(sessionId); return; }
    const loaded = method === "session.open" ? Boolean(params.url) && !result.navigationError
      : ["page.goto", "page.back", "page.forward"].includes(method) && result.ok !== false;
    if (!loaded || result.blocked) {
      const watch = this.loadPopupWatch.get(sessionId);
      if (watch?.log.length) result.autoDismissed = watch.log.splice(0);
      return;
    }
    if (process.env.WEBAGENT_AUTO_DISMISS === "0") return;
    let page: Page;
    try { page = this.store().get(sessionId); } catch { return; }
    await this.loadPopupWatch.get(sessionId)?.stop();
    const first = await dismissAnnoyances(page, { fast: true }).catch(() => null);
    if (first?.actions.length) result.autoDismissed = first.actions;
    const log: string[] = [];
    let active = true;
    const until = Date.now() + LOAD_POPUP_WATCH_MS;
    const running = (async () => {
      while (active && Date.now() < until && !page.isClosed()) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (!active || page.isClosed()) break;
        const later = await dismissAnnoyances(page, { fast: true }).catch(() => null);
        if (later?.actions.length) log.push(...later.actions);
      }
    })();
    this.loadPopupWatch.set(sessionId, { log, stop: async () => { active = false; await running; } });
  }

  // Which site memories a session has already been shown, so a site's notes appear once per session.
  private memoryShown = new Map<string, Set<string>>();
  private async memoryKey(page: Page, sessionId: string): Promise<{ key: string; host: string } | undefined> {
    const ctx: any = await learningContext(this.config, page, sessionId).catch(() => null);
    return ctx?.key ? { key: ctx.key, host: ctx.host } : undefined;
  }
  /** After a page loads: note what the load showed, and hand over saved memory for a site seen for the first time. */
  private async afterLoadMemory(page: Page, sessionId: string, kind: "open" | "goto", before: string, result: any) {
    if (!page || !sessionId || !result || typeof result !== "object") return;
    const site = await this.memoryKey(page, sessionId);
    if (!site) return;
    const url = page.url();
    const blocked = result.blocked || result.effect?.blocked || result.pageState?.blocked;
    if (blocked) await recordMemoryStep(this.config, sessionId, { kind: "blocked", host: site.host, key: site.key, path: new URL(url).origin + new URL(url).pathname, blocked: { kind: blocked.kind, evidence: blocked.evidence || "" } });
    else {
      const change = describeUrlChange(sessionId, before, url);
      if (change.queryParam) await recordMemoryStep(this.config, sessionId, { kind, host: site.host, key: site.key, path: new URL(url).origin + new URL(url).pathname, ...change });
    }
    const shown = this.memoryShown.get(sessionId) || new Set<string>();
    if (!shown.has(site.key)) {
      const memory: any = await memoryFor(this.config, site.key, site.host).catch(() => undefined);
      const known = await this.knownSiteBriefing(page).catch(() => undefined);
      if (memory || known) result.siteMemory = { ...(known || {}), ...(memory || {}),
        hint: [known?.hint, memory?.hint].filter(Boolean).join(" ") };
      shown.add(site.key); this.memoryShown.set(sessionId, shown);
    }
  }

  /** A registered site: its saved actions and the sections of its guide, so they are used without being asked for. */
  private async knownSiteBriefing(page: Page) {
    const identified = await identifySite(this.config, page);
    if (!identified) return undefined;
    const def: any = identified.loaded.definition;
    const actions = Object.entries(def.actions || {}).slice(0, 8).map(([id, a]: [string, any]) => `${id}${a.description ? ": " + String(a.description).slice(0, 90) : ""}`);
    const guide = await siteGuide(identified.loaded.dir);
    if (!actions.length && !guide?.sections.length) return undefined;
    return {
      site: def.site.id,
      ...(actions.length ? { actions } : {}),
      ...(guide?.sections.length ? { guide: guide.sections } : {}),
      hint: `Known site "${def.site.id}".` + (actions.length ? " Saved actions run with run_saved_action (check the result)." : "")
        + (guide?.sections.length ? " Read a guide section with learning_notes capability \"guide:<section>\"." : ""),
    };
  }

  private async recordStepMemory(page: Page, params: any, kind: string, before: string, result: any) {
    const site = await this.memoryKey(page, params.sessionId);
    if (!site) return;
    const after = page.url();
    const blocked = result.effect?.blocked;
    const base = { host: site.host, key: site.key, path: (() => { try { const u = new URL(after); return u.origin + u.pathname; } catch { return ""; } })() };
    if (blocked) return recordMemoryStep(this.config, params.sessionId, { ...base, kind: "blocked", blocked: { kind: blocked.kind, evidence: blocked.evidence || "" } });
    const frameUrl = params.frame !== undefined ? (page as any).mainFrame?.().url?.() : undefined;
    const change = after !== before ? describeUrlChange(params.sessionId, before, after) : {};
    if (!change.queryParam && !change.setParams && params.frame === undefined) return;
    const control = params.locator ? { ...params.locator } : referencesFor(page).semanticLocator(params.ref) || undefined;
    await recordMemoryStep(this.config, params.sessionId, { ...base, kind: kind as any, control: control as any, frame: params.frame, frameUrl, submit: Boolean(params.submit), ...change });
  }

  private store(): SessionStore {
    if (!this.sessions) throw new Error("browserd not started");
    return this.sessions;
  }

  private async dispatch(method: string, params: any): Promise<any> {
    // A display change relaunches the shared Chrome instance. Never interrupt an
    // in-flight operation in another session, and leave status queries unblocked.
    if (["request.status", "learning.status", "learning.finish"].includes(method)) return this.dispatchUnlocked(method, params);
    return serial(`browser:${this.config.runtimeDir}`, async () => {
      try { return await this.dispatchWithFallback(method, params); }
      finally { if (params.sessionId) this.sessions?.touch?.(params.sessionId); }
    });
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
      try { original.pageState = await inspectPageState(this.store().get(probeSession),undefined,3000); } catch { /* Preserve the original execution outcome. */ }
    }
    if (!needsHeadedFallback(method, original) || this.chrome.getState()?.headless !== true) return original;
    const fallback: any = { attempted: true, from: "headless", to: "headed", retried: false, observationRequired: true,
      reason: original.reason || original.blocked || original.navigationError || "headless_failure" };
    try {
      // Capture up-to-date URLs before destroying Playwright handles.
      this.store().captureUrls?.();
      this.clearNetwork();
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
    // Bookkeeping and cleanup must not launch/restart Chrome or block a finished user task.
    if (method === "learning.finish") {
      try { return await finishLearning(this.config, params.sessionId, params.input || { taskStatus: params.taskStatus, decision: params.decision, reason: params.reason }); }
      catch (e: any) { if (!e.code) throw e; return { taskStatus: params.taskStatus || params.input?.taskStatus, learningSaved: false, warning: e.message }; }
    }
    if (method === "learning.status") {
      return await learningStatus(this.config, params.sessionId).catch((e: any) => ({ active: false, learningPending: false, warning: e.message }));
    }
    if (method === "session.close") {
      this.clearNetwork(params.sessionId);
      await this.store().close(params.sessionId);
      const learning = await finishObservedLearning(this.config, params.sessionId).catch((e: any) => ({ learningPending: false, warning: e.message }));
      const siteMemory = await closeMemory(this.config, params.sessionId).catch(() => undefined);
      this.memoryShown.delete(params.sessionId);
      return { closed: params.sessionId, learning, learning_pending: false, ...(siteMemory ? { siteMemory } : {}) };
    }
    if (method === "session.closeAll") {
      this.clearNetwork();
      const closed = await this.store().closeAll();
      for (const sessionId of closed) await finishObservedLearning(this.config, sessionId).catch(() => {});
      return { closed, count: closed.length };
    }
    const current = await this.chrome.ensureConnected();
    if (current !== this.context) {
      this.clearNetwork();
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
      this.store().captureUrls?.();
      this.clearNetwork();
      const repaired = await this.chrome.repair();
      this.context = repaired.context;
      if (this.sessions) await this.sessions.rebindContext(repaired.context);
      else { this.sessions = new SessionStore(repaired.context); await this.sessions.adoptExisting(); }
      return { status: "switched", preference: saved, resolved, chrome: repaired.state, takeover: repaired.takeover };
    }
    if (method === "browser.repair") {
      this.store().captureUrls?.();
      this.clearNetwork();
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
      this.store().captureUrls?.();
      this.clearNetwork();
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
        await this.afterLoadMemory(this.store().get(opened.id), opened.id, "open", "", opened).catch(() => {});
      }
      return opened;
    }
    if (method === "session.list") return this.store().list();
    let page = params.sessionId ? this.store().get(params.sessionId) : undefined;
    const topPage = page;
    if (page && params.frame !== undefined && (method.startsWith("page.") || method === "batch.run")) {
      const frame = findFrame(page, String(params.frame));
      if (!frame) return { ok: false, reason: "no_frame", execution: "not_started", frames: await listFrames(page, 1),
        hint: "No frame has this name or URL part. Use one of frames, or omit frame for the page itself." };
      page = frameView(page, frame);
    }
    const result = await this.dispatchOnPage(method, params, page);
    // Nothing found on the page itself: say so when the content may sit inside a frame.
    if (topPage && params.frame === undefined && result && typeof result === "object" && !Array.isArray(result)
      && (result.found === false || result.reason === "no_match" || (method === "page.snapshot" && result.snapshot))) {
      const frames = await listFrames(topPage).catch(() => []);
      if (frames.length) {
        if (method === "page.snapshot") { result.snapshot.frames = frames; result.snapshot.frameHint = FRAME_HINT; }
        else { result.frames = frames; result.frameHint = FRAME_HINT; }
      }
    }
    return result;
  }

  private async dispatchOnPage(method: string, params: any, page: Page | undefined): Promise<any> {
    if (method === "batch.run") {
      if (!page) throw new Error("sessionId required");
      return runBatch(page, params.input, async (command, result) => {
        if (result.ok) await recordLearningEvent(this.config, page, params.sessionId, "fill", { locator: command.locator || referencesFor(page).semanticLocator(command.ref), valuePresent: Boolean(command.value || command.option), batch: true });
      });
    }
    if (page && ["page.click", "page.hover", "page.fill", "page.select", "page.press"].includes(method)) {
      const kind = method.slice(5) as "click" | "hover" | "fill" | "select" | "press";
      const urlBefore = page.url();
      if (kind === "fill") rememberTyped(params.sessionId, params.value);
      const result = await executePrimitive(page, kind, params);
      if (result.ok && kind !== "hover") await this.recordStepMemory(page, params, kind, urlBefore, result).catch(() => {});
      if (result.ok && kind !== "hover") await recordLearningEvent(this.config, page, params.sessionId, kind === "select" ? "fill" : kind, {
        locator: params.locator ? { ...params.locator, ...(params.within ? { within: params.within } : {}) } : referencesFor(page).semanticLocator(params.ref),
        valuePresent: Boolean(params.value || params.option), key: params.key,
      });
      if (params.observe) result.snapshot = await captureSnapshot(page, { references: referencesFor(page), query: params.query });
      if (kind === "click") result.clicked = result.ok;
      if (kind === "hover") result.hovered = result.ok;
      return { ...result, learning_pending: false };
    }
    if(method==='page.verify'){
      if(!page)throw new Error('sessionId required');
      const verdict = await verifyPage(page,params.input);
      const ok = (verdict?.details || []).filter((d: any) => d.ok && d.type === "url_param");
      if (ok.length) {
        const site = await this.memoryKey(page, params.sessionId);
        const checks = (params.input?.checks || []).filter((c: any) => c?.type === "url_param");
        const verified = ok.map((d: any) => ({ name: String(checks[d.index]?.name ?? ""), expected: String(d.expected ?? "") })).filter((v: any) => v.name);
        if (site && verified.length) await recordMemoryStep(this.config, params.sessionId, { kind: "verify", host: site.host, key: site.key, path: "", verified });
      }
      return verdict;
    }
    if (method === "memory.draft" || method === "memory.save") {
      const facts = await draftMemory(this.config, params.sessionId);
      if (method === "memory.draft") return { draft: facts.map((f) => ({ id: f.id, text: f.text })) };
      const key = page ? (await this.memoryKey(page, params.sessionId))?.key : facts[0]?.key;
      const out: any = {};
      if (Array.isArray(params.accept) && params.accept.length) out.accepted = await acceptDraft(this.config, params.sessionId, params.accept.map(String));
      if (Array.isArray(params.notes) && params.notes.length) {
        if (!key) throw new Error("Open the site in this session first");
        const notes = params.notes.slice(0, 5).map((n: any) => ({ id: String(n.capability || "note").slice(0, 100), capability: String(n.capability || "note").slice(0, 100), text: String(n.text || "").trim().slice(0, 400), key, evidence: "written by the agent" })).filter((n: any) => n.text);
        out.noted = await saveFacts(this.config, notes, "agent");
      }
      if (Array.isArray(params.remove) && params.remove.length) {
        if (!key) throw new Error("Open the site in this session first");
        out.removed = await removeNotes(this.config, key, params.remove.map(String));
      }
      return { ok: true, ...out };
    }
    let learningPolicy: any;
    if (page) learningPolicy = await learningContext(this.config, page, params.sessionId).catch((e: any) => ({ warning: e.message }));
    if (method === "learning.notes" || method === "learning.notes.save") {
      if (!page || !learningPolicy?.key) throw new Error("Observe an HTTP(S) site first");
      if (method === "learning.notes.save") return saveNotes(this.config, params.sessionId, learningPolicy.key, params.notes || params.input?.notes);
      if (typeof params.capability === "string" && params.capability.startsWith("guide:")) {
        const identified = await identifySite(this.config, page);
        const guide = identified ? await siteGuide(identified.loaded.dir, params.capability.slice(6).trim()) : undefined;
        return guide ? { site: identified!.loaded.definition.site.id, section: params.capability.slice(6).trim(), text: guide.text ?? null, sections: guide.text ? undefined : guide.sections }
          : { ok: false, reason: "no_guide", hint: "This site has no guide (sites/<id>/SKILL.md)." };
      }
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
      const urlBefore = page.url();
      const res: any = await navigate(page, params.url);
      const blocked = await detectBlock(page);
      if (blocked) res.blocked = blocked;
      await this.afterLoadMemory(page, params.sessionId, "goto", urlBefore, res).catch(() => {});
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
      // Result lists often render a moment after the page reports ready: look again briefly before saying none.
      let list: any = await listItems(page, { query: params.query, limit: params.limit ? Number(params.limit) : undefined });
      for (let i = 0; i < 3 && list && list.found === false; i++) {
        await page.waitForTimeout(1000);
        list = await listItems(page, { query: params.query, limit: params.limit ? Number(params.limit) : undefined });
      }
      return list;
    }
    if (method === "page.back" || method === "page.forward") {
      if (!page) throw new Error("sessionId required");
      return await goHistory(page, method === "page.back" ? "back" : "forward");
    }
    if (method === "page.extract") {
      if (!page) throw new Error("sessionId required");
      const readOne = async (locator: any, timeout: number): Promise<string | null> => {
        if (params.read === "section") return locator.evaluate((el: Element) => {
            const ws = /\s+/g;
            const H = "h1, h2, h3, h4, h5, h6, [role=heading]";
            const head = el.closest(H) || el.querySelector(H) || el;
            const level = /^H[1-6]$/.test(head.tagName) ? Number(head.tagName[1]) : Number(head.getAttribute("aria-level") || 2);
            // Headings are often wrapped with small extras (<div><h2>..</h2>[edit]</div>): start after the wrapper.
            let start: Element = head;
            while (start.parentElement && start.parentElement !== document.body && ((start.parentElement as HTMLElement).innerText || "").length <= ((head as HTMLElement).innerText || "").length + 40) start = start.parentElement;
            const parts: string[] = [];
            let size = 0;
            for (let n = start.nextElementSibling; n && size < 6000; n = n.nextElementSibling) {
              const h = n.matches(H) ? n : n.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role=heading]");
              if (h && (/^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : Number(h.getAttribute("aria-level") || 2)) <= level) break;
              const t = ((n as HTMLElement).innerText || "").replace(ws, " ").trim();
              if (t) { parts.push(t); size += t.length; }
            }
            return parts.join("\n");
          }, undefined, { timeout });
        if (params.read === "row") return locator.evaluate((el: Element) => {
          const ws = /\s+/g;
          const row = el.closest("tr, [role=row], li, dl > div");
          if (row) return (row as HTMLElement).innerText.replace(ws, " ").trim();
          const term = el.closest("dt, th"); const next = term?.nextElementSibling;
          return term && next ? ((term as HTMLElement).innerText + " " + (next as HTMLElement).innerText).replace(ws, " ").trim() : ((el.parentElement || el) as HTMLElement).innerText.replace(ws, " ").trim();
        }, undefined, { timeout });
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
      // Content that is on the page is there now; waiting the 5 s action timeout for a guess only slows a lookup.
      const outcome: any = await executePrimitive(page, "extract", { ...params, timeoutMs: params.timeoutMs ?? 2000 });
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
      // A tab behind another tab in a visible window is not painted, so a capture can wait forever.
      await page.bringToFront().catch(() => {});
      await page.screenshot({ path: file, fullPage: Boolean(params.fullPage), timeout: 10000, animations: "disabled" });
      return { file };
    }
    if (method === "network.start") {
      if (!page) throw new Error("sessionId required");
      this.clearNetwork(params.sessionId);
      const logs: any[] = [];
      const safeUrl = (raw: string) => {
        try { const u = new URL(raw); for (const key of [...u.searchParams.keys()]) u.searchParams.set(key, "<redacted>"); return redactText(u.toString()); }
        catch { return redactText(raw); }
      };
      const request = (req: any) => { if (logs.length < 500) logs.push({ type: "request", at: new Date().toISOString(), method: req.method(), resourceType: req.resourceType(), url: safeUrl(req.url()) }); };
      const response = (res: any) => { if (logs.length < 500) logs.push({ type: "response", at: new Date().toISOString(), status: res.status(), url: safeUrl(res.url()) }); };
      page.on("request", request); page.on("response", response);
      this.networkLogs.set(params.sessionId, logs);
      this.networkListeners.set(params.sessionId, { page, request, response });
      return { started: true };
    }
    if (method === "network.stop") {
      if (!page) throw new Error("sessionId required");
      const events = this.networkLogs.get(params.sessionId) || [];
      this.clearNetwork(params.sessionId);
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
      if (!this.config.allowUnsafeEval) return { ok: false, execution: "not_started", reason: "unsafe_eval_disabled",
        hint: "Raw page JavaScript can mutate the page and send network requests. Set WEBAGENT_ALLOW_UNSAFE_EVAL=1 only in a trusted environment." };
      if (!params.confirmed) return { ok: false, execution: "not_started", confirmationRequired: true, risk: "unclassified" };
      if (typeof params.expression !== "string" || !params.expression.trim() || params.expression.length > 16384)
        return { ok: false, execution: "not_started", reason: "invalid_expression" };
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

    if (method === "site.repair") {
      if (!page) throw new Error("sessionId required");
      const { loadSite } = await import("../engine/site-loader");
      const identified = params.siteId ? { loaded: await loadSite(this.config, params.siteId) } : await identifySite(this.config, page);
      if (!identified) throw new Error("No registered site matches the current page; pass siteId");
      const { saveElementStrategy, saveUrlTemplate } = await import("../engine/self-repair");
      if (params.urlTemplate) return saveUrlTemplate(this.config, identified.loaded, String(params.urlTemplate), String(params.template || ""), params.sessionId);
      if (!params.element) throw new Error("Pass element (with locator or ref) or urlTemplate (with template)");
      const strategy = params.locator || referencesFor(page).semanticLocator(params.ref);
      if (!strategy) return { ok: false, reason: "no_strategy", hint: "Pass a locator, or a ref from a fresh snapshot." };
      const { within, ...plain } = strategy as any;
      const check = await resolveUnique(page, plain, undefined, 3000, within, {});
      if (!("locator" in check)) return { ok: false, reason: "not_unique", detail: check, hint: "The locator must point at exactly one visible element on this page." };
      return { ok: true, ...(await saveElementStrategy(this.config, identified.loaded, String(params.element), strategy, "agent", params.sessionId)) };
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
    this.clearNetwork();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    await this.chrome.stop();
  }
}
