import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config";
import { ChromeManager, liveChromePort, forceReleaseChromeProfile } from "./chrome-manager";

/**
 * At most one extra Chrome, for sessions opened with isolated: true.
 *
 * Chrome cannot run two processes on one profile folder, so an isolated session gets its own throwaway
 * profile. At start it receives the main Chrome's cookies over CDP (the live login, not a stale file copy,
 * and no locked SQLite files to copy). Sign-ins made inside it are not kept: some sites also end the other
 * login when one account is used from two browsers, so this is for work that needs its own browser
 * (heavy pages, a separate display mode, risky flows), not the default.
 * When no isolated session has been open for IDLE_MS, the Chrome is closed and its folder deleted.
 */
const IDLE_MS = Number(process.env.WEBAGENT_ISOLATED_IDLE_MIN || 10) * 60_000;

export interface IsolatedLauncher {
  start(headless: boolean): Promise<{ context: BrowserContext; info: Record<string, unknown>; stop: () => Promise<void> }>;
}

/** The real launcher: a ChromeManager on its own runtime and throwaway profile folder. */
export function chromeLauncher(config: AppConfig): IsolatedLauncher {
  const runtimeDir = path.join(config.runtimeDir, "isolated");
  const userDataDir = path.join(runtimeDir, "profile");
  return {
    async start(headless) {
      // A folder left by a crashed daemon: close its Chrome (ours) and start clean.
      const port = await liveChromePort(userDataDir).catch(() => undefined);
      if (port) await closeChrome(port);
      await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(path.join(userDataDir, "Default"), { recursive: true });
      const manager = new ChromeManager({ ...config, runtimeDir, chromeUserDataDir: userDataDir, chromeProfileDirectory: "Default",
        chromeProfileName: undefined, cdpPort: undefined, headless });
      const started = await manager.start();
      return {
        context: started.context,
        info: { userDataDir, cdpPort: started.state.cdpPort, pid: started.state.pid, headless: started.state.headless },
        stop: async () => {
          await closeChrome(started.state.cdpPort);
          await manager.stop();
          await new Promise((r) => setTimeout(r, 800));
          await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => {});
        },
      };
    },
  };
}

/**
 * At daemon start no isolated session exists yet, so an isolated Chrome still running is left over from a daemon
 * that died without stopping it: ask it to quit, stop whatever still holds that folder (only that folder), and
 * delete the folder.
 */
export async function cleanupIsolatedLeftovers(config: AppConfig): Promise<boolean> {
  const runtimeDir = path.join(config.runtimeDir, "isolated");
  const userDataDir = path.join(runtimeDir, "profile");
  try { await fs.access(runtimeDir); } catch { return false; }
  const port = await liveChromePort(userDataDir).catch(() => undefined);
  if (port) { await closeChrome(port); await new Promise((r) => setTimeout(r, 1500)); }
  await forceReleaseChromeProfile({ ...config, forceProfileTakeover: true }, { userDataDir, profileDirectory: "Default", managed: true } as any).catch(() => {});
  for (let i = 0; i < 5; i++) {
    try { await fs.rm(runtimeDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return true;
}

/** Asks a Chrome to quit through DevTools (graceful, only ever used on the isolated Chrome). */
async function closeChrome(port: number) {
  try {
    const version: any = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve) => {
      ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: "Browser.close" })); setTimeout(resolve, 300); };
      ws.onerror = () => resolve();
    });
    try { ws.close(); } catch {}
  } catch {}
}

export class IsolatedPool {
  private running?: { context: BrowserContext; info: Record<string, unknown>; stop: () => Promise<void>; startedAt: string; cookies: number };
  private starting?: Promise<NonNullable<IsolatedPool["running"]>>;
  private idleSince?: number;
  private timer?: NodeJS.Timeout;

  constructor(private launcher: IsolatedLauncher, private mainContext: () => BrowserContext | undefined, private headless: () => boolean) {}

  /** The isolated Chrome, started on first use with the main Chrome's current cookies. */
  async context(): Promise<BrowserContext> {
    if (this.running) { this.idleSince = undefined; return this.running.context; }
    this.starting ||= (async () => {
      const launched = await this.launcher.start(this.headless());
      const cookies = await this.mainContext()?.cookies().catch(() => []) || [];
      if (cookies.length) await launched.context.addCookies(cookies).catch(async () => {
        for (const cookie of cookies) await launched.context.addCookies([cookie]).catch(() => {});
      });
      this.running = { ...launched, startedAt: new Date().toISOString(), cookies: cookies.length };
      this.timer = setInterval(() => { void this.stopIfIdle(); }, 60_000);
      this.timer.unref?.();
      return this.running;
    })().finally(() => { this.starting = undefined; });
    return (await this.starting).context;
  }

  /** Called when the number of isolated sessions changes. */
  sessionsOpen(count: number) {
    this.idleSince = count > 0 ? undefined : (this.idleSince ?? Date.now());
  }

  async stopIfIdle(force = false) {
    if (!this.running) return false;
    if (!force && (this.idleSince === undefined || Date.now() - this.idleSince < IDLE_MS)) return false;
    const running = this.running;
    this.running = undefined; this.idleSince = undefined;
    if (this.timer) clearInterval(this.timer);
    await running.stop().catch(() => {});
    return true;
  }

  status() {
    return this.running ? { running: true, startedAt: this.running.startedAt, cookiesCopied: this.running.cookies, ...this.running.info,
      idleSince: this.idleSince ? new Date(this.idleSince).toISOString() : null } : { running: false };
  }

  owns(page: Page) { return Boolean(this.running && page.context() === this.running.context); }
}
