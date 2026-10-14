import crypto from "node:crypto";
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
}

interface SessionRecord {
  page: Page;
  lastUrl: string;
  prepare?: OpenOptions["prepare"];
  setupStatus?: 'ready'|'partial';
  setupError?: string;
}

export class SessionStore {
  private ignored = new WeakSet<Page>();
  ignore(page: Page): void { this.ignored.add(page); }
  private sessions = new Map<string, SessionRecord>();
  private pendingPopups = new WeakMap<Page, Promise<PopupEffect>>();
  private watchParent(page:Page,id:string):void {
    registerPopupHandler(page,popup=>this.adoptPopup(popup,id));
  }
  private adoptPopup(page:Page,parentId?:string):Promise<PopupEffect> {
    const pending=this.pendingPopups.get(page);if(pending)return pending;
    const promise=(async()=>{
      const existing=[...this.sessions].find(([,r])=>r.page===page);
      if(existing)return {sessionId:existing[0],url:page.url(),title:await page.title().catch(()=>''),setupStatus:existing[1].setupStatus||'ready'};
      const prepare=parentId?this.sessions.get(parentId)?.prepare:undefined;
      const id=`popup_${crypto.randomUUID().slice(0,8)}`;
      const record:SessionRecord={page,lastUrl:page.url(),prepare,setupStatus:'ready'};
      this.sessions.set(id,record);this.watchParent(page,id);
      try{if(prepare)await prepare(page);}catch{record.setupStatus='partial';record.setupError='Inherited page settings could not be applied';}
      return {sessionId:id,url:page.url(),title:await page.title().catch(()=>''),setupStatus:record.setupStatus!,setupError:record.setupError};
    })();this.pendingPopups.set(page,promise);return promise;
  }

  constructor(private context: BrowserContext) {
    this.watchForPopups(context);
  }

  /** Register unclaimed tabs and inherit preparation from their opener. */
  private watchForPopups(context: BrowserContext): void {
    context.on("page", (page) => {
      setTimeout(async () => {
        if (page.isClosed() || this.ignored.has(page)) return;
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
    for (const page of this.context.pages()) {
      if ([...this.sessions.values()].some((r) => r.page === page)) continue;
      const id=`restored_${crypto.randomUUID().slice(0, 8)}`;
      this.sessions.set(id, { page, lastUrl: page.url() });this.watchParent(page,id);
    }
  }

  async rebindContext(context: BrowserContext): Promise<void> {
    const desired = [...this.sessions.entries()].map(([id, rec]) => ({ id, url: rec.lastUrl || "about:blank", prepare: rec.prepare }));
    this.context = context;
    this.sessions.clear();
    this.watchForPopups(context);
    const existing = context.pages();
    let i = 0;
    let preparationError: unknown;
    for (const row of desired) {
      const page = existing[i++] || await context.newPage();
      this.sessions.set(row.id, { page, lastUrl: row.url, prepare: row.prepare });
      this.watchParent(page,row.id);
      if (row.prepare) {
        try { await row.prepare(page); }
        catch (error) { preparationError ||= error; }
      }
      if (row.url && row.url !== "about:blank" && page.url() !== row.url) {
        await navigate(page, row.url).catch(() => {});
      }
      this.sessions.set(row.id, { page, lastUrl: page.url() || row.url, prepare: row.prepare });
    }
    await this.adoptExisting();
    if (preparationError) throw preparationError;
  }

  async open(url?: string, options: OpenOptions = {}): Promise<SessionInfo> {
    const page = await this.context.newPage();
    const id = `task_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    // Claim the page immediately - before navigating, which can take up to tens of seconds -
    // so popup adoption never races a slow but legitimate navigation.
    const record:SessionRecord={ page, lastUrl: page.url(), prepare: options.prepare,setupStatus:'ready' };
    this.sessions.set(id,record);this.watchParent(page,id);
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
    if (!rec) throw new Error(`Unknown session: ${id}`);
    if (rec.page.isClosed()) throw new Error(`Session page is closed: ${id}`);
    rec.lastUrl = rec.page.url() || rec.lastUrl;
    return rec.page;
  }

  touch(id: string): void {
    const rec = this.sessions.get(id);
    if (rec && !rec.page.isClosed()) rec.lastUrl = rec.page.url() || rec.lastUrl;
  }

  async close(id: string): Promise<void> {
    const rec = this.sessions.get(id);
    if (!rec) throw new Error(`Unknown session: ${id}`);
    await rec.page.close().catch(() => {});
    this.sessions.delete(id);
  }

  /** Closes every open tab this daemon knows about. The bulk sweep behind `session close --all`. */
  async closeAll(): Promise<string[]> {
    const closed = [...this.sessions.keys()];
    for (const rec of this.sessions.values()) await rec.page.close().catch(() => {});
    this.sessions.clear();
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
