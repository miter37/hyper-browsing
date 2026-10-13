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
import { recordLearningEvent, encodeObservedExtraction, learningStatus } from "../runtime/learning";
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
        const { method, params = {} } = await readJson(req);
        const started = Date.now();
        const result = await this.dispatch(method, params);
        // How long each command took, so slow steps are visible to the agent and in transcripts.
        if (result && typeof result === "object" && !Array.isArray(result)) (result as any).durationMs = Date.now() - started;
        json(res, 200, { ok: true, result });
      } catch (error: any) {
        json(res, 200, { ok: false, error: error?.message || String(error), stack: process.env.WEBAGENT_DEBUG ? error?.stack : undefined });
      }
    });

    await new Promise<void>((resolve) => this.server!.listen(this.config.port, this.config.host, resolve));
  }

  private store(): SessionStore {
    if (!this.sessions) throw new Error("browserd not started");
    return this.sessions;
  }

  private async dispatch(method: string, params: any): Promise<any> {
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
    if (method === "session.close") {
      const learning = await learningStatus(this.config, params.sessionId);
      await this.store().close(params.sessionId);
      return { closed: params.sessionId, learning, learning_pending: Boolean(learning?.learningPending) };
    }
    if (method === "session.closeAll") {
      // Bulk cleanup sweep: does not check learning_pending per tab (would be slow for many
      // stray tabs, and this path is for clearing clutter, not finishing a specific task).
      const closed = await this.store().closeAll();
      return { closed, count: closed.length };
    }
    if (method === "learning.status") return learningStatus(this.config, params.sessionId);

    const page = params.sessionId ? this.store().get(params.sessionId) : undefined;
    if (method === "page.goto") {
      if (!page) throw new Error("sessionId required");
      const res: any = await navigate(page, params.url);
      const blocked = await detectBlock(page);
      if (blocked) res.blocked = blocked;
      if (params.observe) {
        res.snapshot = await captureSnapshot(page);
      }
      return res;
    }
    if (method === "page.snapshot") {
      if (!page) throw new Error("sessionId required");
      const snapshot = await captureSnapshot(page, { query: params.query, limit: params.limit ? Number(params.limit) : undefined });
      const file = params.save ? await saveSnapshot(this.config, params.sessionId, snapshot) : undefined;
      const learning = await recordLearningEvent(this.config, page, params.sessionId, "snapshot", { saved: Boolean(params.save), query: params.query });
      return { snapshot, file, learning_pending: learning.pending };
    }
    if (method === "page.list") {
      if (!page) throw new Error("sessionId required");
      return await listItems(page, { query: params.query, limit: params.limit ? Number(params.limit) : undefined });
    }
    if (method === "page.click") {
      if (!page) throw new Error("sessionId required");
      const locatorText = JSON.stringify(params.locator || {});
      const risk = heuristicRiskFromText(locatorText);
      if (requiresConfirmation(risk) && !params.confirmed) return { clicked: false, confirmationRequired: true, risk };
      // --force skips actionability checks. Needed when an ad overlay or sticky header sits
      // on top of an otherwise visible control.
      const outcome: any = await actOn(page, "click", params, (locator, timeout) => locator.click({ force: Boolean(params.force), timeout }));
      if (!outcome.ok) return { clicked: false, risk, ...outcome };
      const learning = await recordLearningEvent(this.config, page, params.sessionId, "click", { locator: params.locator, risk });
      const res: any = { clicked: true, risk, url: page.url(), effect: outcome.effect, warning: outcome.warning, resolvedBy: outcome.resolvedBy, learning_pending: learning.pending };
      if (params.observe) {
        res.snapshot = await captureSnapshot(page);
      }
      return res;
    }
    if (method === "page.hover") {
      if (!page) throw new Error("sessionId required");
      // Opens hover-only menus and collapsed sub-lists; follow with snapshot (or --observe) to see what appeared.
      // The pointer stays there until the next pointer action, so a following click on the revealed item works.
      const outcome: any = await actOn(page, "hover", params, (locator, timeout) => locator.hover({ force: Boolean(params.force), timeout }));
      if (!outcome.ok) return { hovered: false, ...outcome };
      const res: any = { hovered: true, url: page.url(), effect: outcome.effect, warning: outcome.warning, resolvedBy: outcome.resolvedBy };
      if (params.observe) {
        res.snapshot = await captureSnapshot(page, { query: params.query });
      }
      return res;
    }
    if (method === "page.fill" || method === "page.select") {
      if (!page) throw new Error("sessionId required");
      const res: any = await fillOrSelect(page, method === "page.select" ? "select" : "fill", params);
      if (!res.ok) return res;
      const wanted = String(method === "page.select" ? params.option : params.value ?? "");
      const learning = await recordLearningEvent(this.config, page, params.sessionId, "fill", { locator: params.locator, valuePresent: Boolean(wanted) });
      res.learning_pending = learning.pending;
      if (params.observe) {
        res.snapshot = await captureSnapshot(page);
      }
      return res;
    }
    if (method === "page.press") {
      if (!page) throw new Error("sessionId required");
      let effect: unknown;
      if (params.locator) {
        const outcome: any = await actOn(page, "press", params, (locator, timeout) => locator.press(params.key, { timeout }));
        if (!outcome.ok) return outcome;
        effect = outcome.effect;
      } else {
        const before = page.url();
        await page.keyboard.press(params.key);
        await settle(page, { quietMs: 300, maxMs: 1500 });
        effect = { urlChanged: page.url() !== before, url: page.url() };
      }
      const learning = await recordLearningEvent(this.config, page, params.sessionId, "press", { locator: params.locator, key: params.key });
      const res: any = { ok: true, effect, learning_pending: learning.pending };
      if (params.observe) {
        res.snapshot = await captureSnapshot(page);
      }
      return res;
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
        return { values, count: await visible.count() };
      }
      const outcome: any = await actOn(page, "extract", params, (locator, timeout) => readOne(locator, timeout));
      if (!outcome.ok) return outcome;
      const value: string | null = outcome.value;
      // Encoding the read as site knowledge writes into sites/<site>/; only when asked (--learn).
      const learned = params.learn
        ? await encodeObservedExtraction(this.config, page, params.sessionId, params.locator, params.read || "text", params.attribute)
        : undefined;
      const learning = await recordLearningEvent(
        this.config, page, params.sessionId, "extract",
        { locator: params.locator, read: params.read || "text", attribute: params.attribute },
        learned?.actionId
      );
      return { value, learned, resolvedBy: outcome.resolvedBy, learning_pending: learning.pending };
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
      const after = await captureSnapshot(page);
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
        const lifecycle = variantSpec?.lifecycle ?? action.lifecycle;
        actions.push({
          id,
          description: action.description,
          lifecycle,
          risk: effectiveRisk(id, action),
          evidence: await evidenceFor(this.config, site.site.id, id, variant),
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
