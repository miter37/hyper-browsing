import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { navigate } from "../engine/navigate";
import { registerPopupHandler, type PopupEffect } from '../engine/popups';

export interface SessionInfo {
  id: string;
  url: string;
  title: string;
  /** Set when the session opened but navigation did not complete; the session is still usable. */
  navigationError?: string;
  status?: number;
  interstitial?: "passed" | "still";
  setupStatus?: 'ready'|'partial';
  setupError?: string;
}

export interface OpenOptions {
  /** Called on the new tab before it navigates (viewport, locale). */
  prepare?: (page: Page) => Promise<void>;
  /** Open in another browser (the isolated Chrome) instead of this store's context. */
  context?: BrowserContext;
  /** Session id prefix, e.g. "iso" for isolated sessions. */
  idPrefix?: string;
}

interface SessionRecord {
  page: Page;
  /** Lives in another browser (isolated Chrome): never rebound or recreated when the main Chrome restarts. */
  external?: boolean;
  lastUrl: string;
  prepare?: OpenOptions["prepare"];
  setupStatus?: 'ready'|'partial';
  setupError?: string;
}

/** What survives a daemon restart for each session: the Chrome tab it is bound to and when it was last used. */
interface SavedTab { id: string; targetId: string; lastUsed: number; url?: string }

export interface SweepOptions {
  /** Close tabs nobody used for this long. */
  idleMs: number;
  /** Above this many tabs, close the least recently used ones that have been idle for minIdleMs. */
  maxTabs: number;
  minIdleMs: number;
}
export const DEFAULT_SWEEP: SweepOptions = {
  idleMs: Number(process.env.WEBAGENT_TAB_IDLE_HOURS || 6) * 3600_000,
  maxTabs: Number(process.env.WEBAGENT_MAX_TABS || 20),
  minIdleMs: 15 * 60_000,
};

export class SessionStore {
  private ignored = new WeakSet<Page>();
  private lastUsed = new Map<string, number>();
  private targetIds = new WeakMap<Page, Promise<string | undefined>>();
  private saveTimer?: NodeJS.Timeout;
  /** Pages being created as session windows right now; popup adoption waits for them so it never steals one. */
  private creating = new Set<Promise<unknown>>();
  /** Each new session gets its own window (set for a real Chrome; tests on a launched context use tabs). */
  windowPerSession = false;
  windowSize = { width: 1440, height: 900 };
  private watchedContexts = new WeakSet<BrowserContext>();
  ignore(page: Page): void { this.ignored.add(page); }
  private sessions = new Map<string, SessionRecord>();
  private pendingPopups = new WeakMap<Page, Promise<PopupEffect>>();
  private watchParent(page:Page,id:string):void {
    registerPopupHandler(page,popup=>this.adoptPopup(popup,id));
  }
  private adoptPopup(page:Page,parentId?:string):Promise<PopupEffect> {
    const pending=this.pendingPopups.get(page);if(pending)return pending;
    const promise=(async()=>{
      if(this.creating.size)await Promise.allSettled([...this.creating]);
      const existing=[...this.sessions].find(([,r])=>r.page===page);
      if(existing)return {sessionId:existing[0],url:page.url(),title:await page.title().catch(()=>''),setupStatus:existing[1].setupStatus||'ready'};
      const prepare=parentId?this.sessions.get(parentId)?.prepare:undefined;
      const id=`popup_${crypto.randomUUID().slice(0,8)}`;
      const record:SessionRecord={page,lastUrl:page.url(),prepare,setupStatus:'ready'};
      this.sessions.set(id,record);this.watchParent(page,id);this.used(id);
      try{if(prepare)await prepare(page);}catch{record.setupStatus='partial';record.setupError='Inherited page settings could not be applied';}
      return {sessionId:id,url:page.url(),title:await page.title().catch(()=>''),setupStatus:record.setupStatus!,setupError:record.setupError};
    })();this.pendingPopups.set(page,promise);return promise;
  }

  /** persistFile keeps session ids bound to their tabs across daemon restarts (another agent's ids stay valid). */
  constructor(private context: BrowserContext, private persistFile?: string) {
    this.watchForPopups(context);
  }

  /** Chrome's own id of a tab: stable for the tab's life, across CDP reconnects and daemon restarts. */
  private targetIdOf(page: Page): Promise<string | undefined> {
    let known = this.targetIds.get(page);
    if (!known) {
      known = (async () => {
        try {
          const cdp = await page.context().newCDPSession(page);
          const info: any = await cdp.send("Target.getTargetInfo");
          await cdp.detach().catch(() => {});
          return info?.targetInfo?.targetId as string | undefined;
        } catch { return undefined; }
      })();
      this.targetIds.set(page, known);
    }
    return known;
  }

  private readSaved(): SavedTab[] {
    if (!this.persistFile) return [];
    try { return JSON.parse(fs.readFileSync(this.persistFile, "utf8")).tabs || []; } catch { return []; }
  }

  /** Writes the id-to-tab table soon (coalesced), so frequent touches do not each hit the disk. */
  private scheduleSave(): void {
    if (!this.persistFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.saveNow(); }, 300);
    this.saveTimer.unref?.();
  }

  async saveNow(): Promise<void> {
    if (!this.persistFile) return;
    const tabs: SavedTab[] = [];
    for (const [id, rec] of this.sessions) {
      if (rec.page.isClosed()) continue;
      const targetId = await this.targetIdOf(rec.page);
      if (targetId) tabs.push({ id, targetId, lastUsed: this.lastUsed.get(id) || Date.now(), url: rec.lastUrl });
    }
    try {
      fs.mkdirSync(path.dirname(this.persistFile), { recursive: true });
      const tmp = this.persistFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), tabs }, null, 1));
      fs.renameSync(tmp, this.persistFile);
    } catch {}
  }

  private used(id: string): void { this.lastUsed.set(id, Date.now()); this.scheduleSave(); }

  /** Open sessions that live in the isolated Chrome. */
  externalCount(): number { return [...this.sessions.values()].filter((r) => r.external && !r.page.isClosed()).length; }

  /** Last use of each session, oldest first. */
  idleList(): Array<{ id: string; idleMs: number; url: string }> {
    const now = Date.now();
    return [...this.sessions].filter(([, r]) => !r.page.isClosed())
      .map(([id, r]) => ({ id, idleMs: now - (this.lastUsed.get(id) || now), url: r.page.url() }))
      .sort((a, b) => b.idleMs - a.idleMs);
  }

  /**
   * Closes tabs left behind by finished, crashed or abandoned tasks: idle past idleMs, or - above maxTabs - the
   * least recently used ones idle for minIdleMs. A tab used recently by any agent is never closed, and one tab
   * always stays so Chrome does not exit.
   */
  async sweepIdle(options: SweepOptions = DEFAULT_SWEEP): Promise<string[]> {
    const rows = this.idleList();
    const close = new Set(rows.filter((r) => r.idleMs > options.idleMs).map((r) => r.id));
    const remaining = rows.filter((r) => !close.has(r.id));
    for (const r of remaining) {
      if (rows.length - close.size <= options.maxTabs) break;
      if (r.idleMs > options.minIdleMs) close.add(r.id);
    }
    if (!close.size) return [];
    if (close.size >= rows.length) await this.context.newPage().catch(() => undefined);
    for (const id of close) {
      await this.sessions.get(id)?.page.close().catch(() => {});
      this.sessions.delete(id); this.lastUsed.delete(id);
    }
    this.scheduleSave();
    return [...close];
  }

  /** Register unclaimed tabs and inherit preparation from their opener. */
  private watchForPopups(context: BrowserContext): void {
    if (this.watchedContexts.has(context)) return;
    this.watchedContexts.add(context);
    context.on("page", (page) => {
      setTimeout(async () => {
        if (page.isClosed() || this.ignored.has(page)) return;
        if (this.creating.size) await Promise.allSettled([...this.creating]);
        const claimed = [...this.sessions.values()].some((r) => r.page === page);
        if (!claimed) {
          // Adopt user-opened tabs/OAuth popups instead of closing them
          const opener=await page.opener().catch(()=>null);
          const parent=opener?[...this.sessions].find(([,r])=>r.page===opener)?.[0]:undefined;
          await this.adoptPopup(page,parent).catch(()=>{});
        }
      }, 0);
    });
  }

  async adoptExisting(): Promise<void> {
    const saved = new Map(this.readSaved().map((t) => [t.targetId, t]));
    for (const page of this.context.pages()) {
      if ([...this.sessions.values()].some((r) => r.page === page)) continue;
      // A tab this runtime knew before a restart keeps its session id and its last-use time.
      const known = saved.get((await this.targetIdOf(page)) || "");
      const id = known && !this.sessions.has(known.id) ? known.id : `restored_${crypto.randomUUID().slice(0, 8)}`;
      this.sessions.set(id, { page, lastUrl: page.url() });this.watchParent(page,id);
      this.lastUsed.set(id, known?.lastUsed || Date.now());
    }
    this.scheduleSave();
  }

  /** Refresh URLs after every command, before Chrome gets relaunched. */
  captureUrls(): void {
    for (const rec of this.sessions.values()) {
      if (!rec.page.isClosed()) rec.lastUrl = rec.page.url() || rec.lastUrl;
    }
  }

  async rebindContext(context: BrowserContext): Promise<void> {
    this.captureUrls();
    // Isolated sessions live in another Chrome: a main-Chrome restart leaves them as they are.
    const external = [...this.sessions].filter(([, rec]) => rec.external);
    const old = new Map([...this.sessions].filter(([, rec]) => !rec.external));
    const desired = [...old.entries()].map(([id, rec]) => ({
      id, url: rec.lastUrl || "about:blank", prepare: rec.prepare,
      setupStatus: rec.setupStatus, setupError: rec.setupError,
    }));
    this.context = context;
    this.sessions.clear();
    for (const [id, rec] of external) this.sessions.set(id, rec);
    this.watchForPopups(context);

    // Never bind a session to an unrelated tab by its array index.
    // Reuse only the original live page or a *unique* exact URL match.
    const available = new Set(context.pages());
    const urlCounts = new Map<string, number>();
    for (const row of desired) urlCounts.set(row.url, (urlCounts.get(row.url) || 0) + 1);
    let preparationError: unknown;
    for (const row of desired) {
      const prior = old.get(row.id)?.page;
      let page: Page | undefined;
      if (prior && !prior.isClosed() && typeof prior.context === "function" && prior.context() === context) page = prior;
      if (!page && row.url === "about:blank") {
        // Blank tabs have no state or navigation to overwrite, so an unclaimed
        // existing blank tab can safely stand in for a blank session.
        page = [...available].find(p => !p.isClosed() && p.url() === "about:blank");
      }
      if (!page && row.url !== "about:blank" && urlCounts.get(row.url) === 1) {
        const matches = [...available].filter(p => !p.isClosed() && p.url() === row.url);
        if (matches.length === 1) page = matches[0];
      }
      if (!page) page = await context.newPage();
      available.delete(page);
      const record: SessionRecord = { page, lastUrl: row.url, prepare: row.prepare,
        setupStatus: row.setupStatus || "ready", setupError: row.setupError };
      this.sessions.set(row.id, record);
      this.watchParent(page, row.id);
      if (row.prepare) {
        try { await row.prepare(page); record.setupStatus = "ready"; record.setupError = undefined; }
        catch (error) {
          record.setupStatus = "partial";
          record.setupError = "Page settings could not be restored";
          preparationError ||= error;
        }
      }
      if (row.url && row.url !== "about:blank" && page.url() !== row.url) {
        await navigate(page, row.url).catch(() => {});
      }
      record.lastUrl = page.url() === "about:blank" ? row.url : page.url();
    }
    // Preserve unrelated tabs as separate sessions, without navigating them.
    await this.adoptExisting();
    if (preparationError) throw preparationError;
  }

  /**
   * A new page for a session. In a real Chrome it is a window of its own, opened in the background: every
   * session then has a visible tab (no background-tab slowdown) and one agent's screenshot or focus never
   * pushes another agent's tab away. Falls back to a plain new tab.
   */
  private async newSessionPage(context: BrowserContext): Promise<Page> {
    if (!this.windowPerSession || context !== this.context || typeof context.browser !== "function") return context.newPage();
    const browser = context.browser();
    if (!browser) return context.newPage();
    let done!: () => void;
    const creating = new Promise<void>((r) => { done = r; });
    this.creating.add(creating);
    const arrived: Page[] = [];
    const onPage = (p: Page) => { arrived.push(p); };
    context.on("page", onPage);
    try {
      const cdp = await browser.newBrowserCDPSession();
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", newWindow: true, background: true,
        width: this.windowSize.width, height: this.windowSize.height } as any) as any;
      await cdp.detach().catch(() => {});
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        for (const p of arrived) if ((await this.targetIdOf(p)) === targetId) return p;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("new window did not appear");
    } catch {
      return context.newPage();
    } finally {
      context.off("page", onPage);
      this.creating.delete(creating); done();
    }
  }

  async open(url?: string, options: OpenOptions = {}): Promise<SessionInfo> {
    const context = options.context || this.context;
    const page = await this.newSessionPage(context);
    const id = `${options.idPrefix || "task"}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    // Claim the page immediately - before navigating, which can take up to tens of seconds -
    // so popup adoption never races a slow but legitimate navigation.
    const record:SessionRecord={ page, lastUrl: page.url(), prepare: options.prepare,setupStatus:'ready', external: context !== this.context };
    this.sessions.set(id,record);this.watchParent(page,id);this.used(id);
    if(options.prepare)try{await options.prepare(page);}catch{record.setupStatus='partial';record.setupError='Page settings could not be applied';}
    // A navigation failure must not discard the session: the caller can retry or inspect it.
    let navigationError: string | undefined;
    let status: number | undefined;
    let interstitial: SessionInfo["interstitial"];
    if (url) {
      try { ({ status, interstitial } = await navigate(page, url)); }
      catch (error: any) { navigationError = error?.message || String(error); }
    }
    if (navigationError) return { id, url: page.url(), title: "", navigationError, setupStatus:record.setupStatus, setupError:record.setupError };
    return { id, url: page.url(), title: await page.title().catch(() => ""), status, interstitial,setupStatus:record.setupStatus,setupError:record.setupError };
  }

  get(id: string): Page {
    const rec = this.sessions.get(id);
    if (!rec) {
      const error: any = new Error(`Unknown session: ${id}. Its tab was closed (by the task, the user, or an idle-tab sweep). Open a new session with session_open; list live ones with session_list. Do not restart the browser for this.`);
      error.execution = "not_started";
      throw error;
    }
    if (rec.page.isClosed()) {
      const error: any = new Error(`Session page is closed: ${id}. Open a new session with session_open.`);
      error.execution = "not_started";
      throw error;
    }
    rec.lastUrl = rec.page.url() || rec.lastUrl;
    this.used(id);
    return rec.page;
  }

  touch(id: string): void {
    const rec = this.sessions.get(id);
    if (rec && !rec.page.isClosed()) { rec.lastUrl = rec.page.url() || rec.lastUrl; this.used(id); }
  }

  async close(id: string): Promise<void> {
    const rec = this.sessions.get(id);
    if (!rec) throw new Error(`Unknown session: ${id}`);
    await rec.page.close().catch(() => {});
    this.sessions.delete(id); this.lastUsed.delete(id); this.scheduleSave();
  }

  /** Closes every open tab this daemon knows about. The bulk sweep behind `session close --all`. */
  async closeAll(): Promise<string[]> {
    const closed = [...this.sessions.keys()];
    for (const rec of this.sessions.values()) await rec.page.close().catch(() => {});
    this.sessions.clear(); this.lastUsed.clear(); this.scheduleSave();
    return closed;
  }

  async list(): Promise<SessionInfo[]> {
    const rows: SessionInfo[] = [];
    for (const [id, rec] of this.sessions) {
      if (rec.page.isClosed()) continue;
      rec.lastUrl = rec.page.url() || rec.lastUrl;
      rows.push({ id, url: rec.page.url(), title: await rec.page.title().catch(() => "") });
    }
    return rows;
  }
}
