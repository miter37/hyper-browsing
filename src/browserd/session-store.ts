import crypto from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { navigate } from "../engine/navigate";

export interface SessionInfo {
  id: string;
  url: string;
  title: string;
  /** Set when the session opened but navigation did not complete; the session is still usable. */
  navigationError?: string;
  status?: number;
  interstitial?: "passed" | "still";
}

export interface OpenOptions {
  /** Called on the new tab before it navigates (viewport, locale). */
  prepare?: (page: Page) => Promise<void>;
}

interface SessionRecord {
  page: Page;
  lastUrl: string;
}

/**
 * How long an unclaimed new tab (ad popup, window.open() from a script, target=_blank link)
 * is given before it is closed automatically. Long enough that a page legitimately opened
 * through open() is always registered into `sessions` well before this fires - that
 * registration happens synchronously right after newPage() resolves, before any navigation -
 * short enough that stray tabs don't sit around cluttering the window.
 */
const POPUP_GRACE_MS = 4000;

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();

  constructor(private context: BrowserContext) {
    this.watchForPopups(context);
  }

  /**
   * Auto-closes tabs that appear without going through open()/adoptExisting() - typically ad
   * popups or window.open() calls from page scripts. A page is "claimed" the moment it is
   * added to `sessions`, which open() does immediately after creating it (before navigating),
   * so anything still unclaimed after the grace period was never ours to begin with.
   */
  private watchForPopups(context: BrowserContext): void {
    context.on("page", (page) => {
      setTimeout(() => {
        if (page.isClosed()) return;
        const claimed = [...this.sessions.values()].some((r) => r.page === page);
        if (!claimed) {
          // Adopt user-opened tabs/OAuth popups instead of closing them
          this.sessions.set(`popup_${crypto.randomUUID().slice(0, 8)}`, { page, lastUrl: page.url() });
        }
      }, POPUP_GRACE_MS);
    });
  }

  async adoptExisting(): Promise<void> {
    for (const page of this.context.pages()) {
      if ([...this.sessions.values()].some((r) => r.page === page)) continue;
      this.sessions.set(`restored_${crypto.randomUUID().slice(0, 8)}`, { page, lastUrl: page.url() });
    }
  }

  async rebindContext(context: BrowserContext): Promise<void> {
    const desired = [...this.sessions.entries()].map(([id, rec]) => ({ id, url: rec.lastUrl || "about:blank" }));
    this.context = context;
    this.sessions.clear();
    this.watchForPopups(context);
    const existing = context.pages();
    let i = 0;
    for (const row of desired) {
      const page = existing[i++] || await context.newPage();
      if (row.url && row.url !== "about:blank" && page.url() !== row.url) {
        await navigate(page, row.url).catch(() => {});
      }
      this.sessions.set(row.id, { page, lastUrl: page.url() || row.url });
    }
    await this.adoptExisting();
  }

  async open(url?: string, options: OpenOptions = {}): Promise<SessionInfo> {
    const page = await this.context.newPage();
    if (options.prepare) await options.prepare(page).catch(() => {});
    const id = `task_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    // Claim the page immediately - before navigating, which can take up to tens of seconds -
    // so watchForPopups' grace-period check never races a slow but legitimate navigation.
    this.sessions.set(id, { page, lastUrl: page.url() });
    // A navigation failure must not discard the session: the caller can retry or inspect it.
    let navigationError: string | undefined;
    let status: number | undefined;
    let interstitial: SessionInfo["interstitial"];
    if (url) {
      try { ({ status, interstitial } = await navigate(page, url)); }
      catch (error: any) { navigationError = error?.message || String(error); }
    }
    if (navigationError) return { id, url: page.url(), title: "", navigationError };
    return { id, url: page.url(), title: await page.title().catch(() => ""), status, interstitial };
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
