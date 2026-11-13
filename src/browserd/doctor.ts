import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config";
import type { ChromeManager } from "./chrome-manager";
import { liveChromePort, hasLogin } from "./chrome-manager";
import type { SessionStore } from "./session-store";
import { pointedRuntimeDir, knownRuntimeDirs, claimRuntimeHome, POINTER_FILE } from "../../scripts/runtime-home.mjs";

/**
 * One call that finds out why the browser is not working and, with fix, repairs it the safe way:
 * reattach before relaunch, never another app's process, never the user's own Chrome, never a profile folder.
 * It exists so an agent facing a browser error does one thing instead of improvising (new ports, killed
 * processes, deleted profiles), which is what turned one error into days of breakage before.
 */
export interface DoctorDeps {
  config: AppConfig;
  chrome: ChromeManager;
  sessions?: SessionStore;
  lastSweep?: { at: string; closed: string[] };
  /** Reconnect to the running Chrome (reattach, no restart) and rebind sessions. */
  reconnect(): Promise<void>;
  /** Relaunch Chrome on the same profile; open sessions come back at their URLs. */
  relaunch(): Promise<void>;
  sweep(): Promise<string[]>;
}

interface Check { name: string; ok: boolean; detail: Record<string, unknown> | string; fixed?: string; advice?: string }

function pidAlive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function readJson(file: string): any { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; } }
function lockState(file: string) {
  if (!fs.existsSync(file)) return undefined;
  const held = readJson(file) || {};
  const ageMs = Date.now() - fs.statSync(file).mtimeMs;
  return { file, pid: held.pid, ageMs, stale: (held.pid && !pidAlive(Number(held.pid))) || ageMs > 120_000 };
}

export async function runDoctor(d: DoctorDeps, fix: boolean) {
  const checks: Check[] = [];
  const c = d.config;

  // 1. One runtime per machine.
  const machine = pointedRuntimeDir();
  const explicit = Boolean(process.env.WEBAGENT_RUNTIME_DIR) && process.env.WEBAGENT_RUNTIME_RESOLVED !== "1";
  const strays = knownRuntimeDirs(c.root).filter((r) => path.resolve(r) !== path.resolve(c.runtimeDir)).map((r) => {
    const st = readJson(path.join(r, "chrome-state.json"));
    const pid = Number(fs.existsSync(path.join(r, "browserd.pid")) ? fs.readFileSync(path.join(r, "browserd.pid"), "utf8").trim() : 0);
    return { runtimeDir: r, daemonRunning: pid > 0 && pidAlive(pid), profile: st?.userDataDir };
  });
  const runtime: Check = { name: "runtime", ok: explicit || (machine ? path.resolve(machine) === path.resolve(c.runtimeDir) : true),
    detail: { runtimeDir: c.runtimeDir, machineRuntime: machine || null, pointer: POINTER_FILE, explicit, otherRuntimes: strays } };
  if (!machine && !explicit && fix) { claimRuntimeHome(c.runtimeDir); runtime.fixed = "claimed this runtime as the machine runtime"; }
  if (strays.some((s) => s.daemonRunning)) runtime.advice = "Another runtime still has a daemon running (an older install or a separate WEBAGENT_RUNTIME_DIR). It is left alone; new commands all go to this runtime. Its profile is not signed in the same way, so do not switch to it.";
  checks.push(runtime);

  // 2. Startup locks left by a crashed start.
  const locks = [lockState(path.join(c.runtimeDir, "chrome-startup.lock")), lockState(path.join(c.runtimeDir, "daemon-start.lock"))].filter(Boolean) as any[];
  const staleLocks = locks.filter((l) => l.stale);
  const lockCheck: Check = { name: "locks", ok: !staleLocks.length, detail: { locks } };
  if (staleLocks.length && fix) { for (const l of staleLocks) fs.rmSync(l.file, { force: true }); lockCheck.fixed = `removed ${staleLocks.length} stale lock(s)`; lockCheck.ok = true; }
  checks.push(lockCheck);

  // 3. Chrome: reachable, and connected to this daemon.
  const state = d.chrome.getState();
  const profileDir = state?.userDataDir;
  const live = profileDir ? await liveChromePort(profileDir, [state?.cdpPort]) : undefined;
  const connected = d.chrome.connected();
  const chrome: Check = { name: "chrome", ok: Boolean(live && connected), detail: { profile: profileDir || null, devtoolsPort: live || null, connected, pid: state?.pid || null } };
  if (fix && !chrome.ok) {
    try {
      if (live) { await d.reconnect(); chrome.fixed = "reattached to the running Chrome (no restart)"; }
      else { await d.relaunch(); chrome.fixed = "Chrome was not answering: relaunched it on the same profile; open sessions reopened at their URLs"; }
      chrome.ok = d.chrome.connected();
      chrome.detail = { ...(chrome.detail as any), devtoolsPort: d.chrome.getState()?.cdpPort, connected: chrome.ok };
    } catch (error: any) {
      chrome.advice = "Chrome could not be started: " + String(error?.message || error).slice(0, 400);
    }
  }
  checks.push(chrome);

  // 4. Signed-in profile, and its backups.
  const userDataDir = d.chrome.getState()?.userDataDir || profileDir;
  if (userDataDir) {
    const backupsDir = path.join(c.runtimeDir, "profile-backups", path.basename(userDataDir));
    const backups = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).sort() : [];
    const login = hasLogin(userDataDir);
    const profile: Check = { name: "profile", ok: login, detail: { userDataDir, cookies: login, backups: backups.length, newestBackup: backups[backups.length - 1] || null } };
    if (!login && backups.length && fix) {
      try { await d.relaunch(); profile.fixed = "restored the login files from the newest backup and relaunched Chrome"; profile.ok = hasLogin(userDataDir); }
      catch (error: any) { profile.advice = String(error?.message || error).slice(0, 300); }
    } else if (!login) profile.advice = backups.length ? "No cookies in the profile: run with fix to restore the newest login backup." : "The profile has no saved login yet. Sign in once in the agent's Chrome window; it then persists and is backed up daily.";
    checks.push(profile);
  }

  // 5. Tabs left behind.
  if (d.sessions) {
    const idle = d.sessions.idleList();
    const tabs: Check = { name: "tabs", ok: idle.length <= 20, detail: { open: idle.length, idleOver1h: idle.filter((t) => t.idleMs > 3600_000).length, lastSweep: d.lastSweep || null } };
    if (fix) { const closed = await d.sweep(); if (closed.length) tabs.fixed = `closed ${closed.length} idle tab(s)`; tabs.ok = true; }
    checks.push(tabs);
  }

  const ok = checks.every((x) => x.ok);
  return {
    ok,
    checks,
    advice: ok ? "The browser is healthy. Retry the task." :
      fix ? "Some checks still fail (see advice per check). Tell the user what failed; do not delete profiles, kill processes or change ports yourself."
        : "Run browser_doctor again with fix: true.",
    rules: "Never delete or rename chrome-profiles, never kill Chrome or node processes, never pick DevTools/daemon ports by hand. Unknown session: open a new one.",
  };
}
