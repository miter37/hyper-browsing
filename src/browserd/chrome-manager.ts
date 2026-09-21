import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type { AppConfig } from "../config";

/**
 * Chrome 136+ deliberately ignores --remote-debugging-port when Chrome is started against its
 * normal (default) user-data directory. That is why this module can end up driving an
 * agent-owned copy of the user-data directory instead of the real one. Everything here is
 * written so that the *user's own Chrome is never terminated*: the agent only ever reclaims a
 * user-data directory that it created itself.
 */

export type ProfileMode = "auto" | "managed" | "real";

export interface ChromeProfileCandidate {
  /** On-disk profile directory name, e.g. "Default" or "Profile 1". */
  directory: string;
  /** Human readable name from Chrome's Local State, e.g. "doyoon". */
  displayName: string;
  /** Real Chrome user-data root that contains this profile. */
  root: string;
}

export interface ResolvedChromeProfile {
  /** Profile the caller asked for, or "(first profile)" when auto-detected. */
  requestedName: string;
  userDataDir: string;
  profileDirectory: string;
  displayName: string;
  /** True when userDataDir is an agent-owned directory under .runtime. */
  managed: boolean;
  source: "explicit" | "real-chrome-profile" | "managed-mirror-of-first-profile" | "managed-fallback";
  /** Short explanation of why this profile was chosen; surfaced by `webctl browser status`. */
  reason: string;
  /** Present when the real profile was wanted but could not be used. */
  hint?: string;
  /** The real Chrome profile this resolution is based on, when known. */
  basedOn?: ChromeProfileCandidate;
}

export interface ChromeRuntimeState {
  executable: string;
  chromeVersion?: string;
  userDataDir: string;
  profileDirectory: string;
  displayName: string;
  managed: boolean;
  /** Whether this Chrome instance is running with no visible window. */
  headless: boolean;
  cdpPort: number;
  pid?: number;
  startedAt: string;
  source: ResolvedChromeProfile["source"];
  reason: string;
  hint?: string;
}

export interface DisplayPreference {
  headless?: boolean;
}

export interface ProfilePreference {
  profileName?: string;
  mode?: ProfileMode;
  userDataDir?: string;
  profileDirectory?: string;
}

/* ------------------------------------------------------------------ *
 * Platform locations
 * ------------------------------------------------------------------ */

export function chromeRoots(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Google", "Chrome"),
      path.join(home, "Library", "Application Support", "Google", "Chrome Beta"),
      path.join(home, "Library", "Application Support", "Chromium"),
    ];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(local, "Google", "Chrome", "User Data"),
      path.join(local, "Google", "Chrome Beta", "User Data"),
      path.join(local, "Chromium", "User Data"),
    ];
  }
  return [
    path.join(home, ".config", "google-chrome"),
    path.join(home, ".config", "google-chrome-beta"),
    path.join(home, ".config", "chromium"),
    // Snap and Flatpak installs keep the profile elsewhere.
    path.join(home, "snap", "chromium", "common", "chromium"),
    path.join(home, ".var", "app", "com.google.Chrome", "config", "google-chrome"),
  ];
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/* ------------------------------------------------------------------ *
 * Profile discovery
 * ------------------------------------------------------------------ */

/** "Default" sorts first, then "Profile 2" before "Profile 10", then anything else. */
function profileOrder(dir: string): [number, number, string] {
  if (dir === "Default") return [0, 0, dir];
  const m = /^Profile\s+(\d+)$/i.exec(dir);
  if (m) return [1, Number(m[1]), dir];
  return [2, 0, dir.toLowerCase()];
}

function compareProfiles(a: ChromeProfileCandidate, b: ChromeProfileCandidate): number {
  const [ag, an, at] = profileOrder(a.directory);
  const [bg, bn, bt] = profileOrder(b.directory);
  return ag - bg || an - bn || at.localeCompare(bt);
}

/**
 * Every Chrome profile visible on this machine, ordered so index 0 is "the first profile".
 * Reads Chrome's Local State when present, and probes the directory layout otherwise.
 */
export async function listChromeProfiles(): Promise<ChromeProfileCandidate[]> {
  const found: ChromeProfileCandidate[] = [];
  const seen = new Set<string>();
  for (const root of chromeRoots()) {
    if (!(await exists(root))) continue;
    const perRoot: ChromeProfileCandidate[] = [];
    try {
      const localState = JSON.parse(await fs.readFile(path.join(root, "Local State"), "utf8"));
      for (const [dir, info] of Object.entries<any>(localState?.profile?.info_cache || {})) {
        if (!(await exists(path.join(root, dir)))) continue;
        perRoot.push({ directory: dir, displayName: String(info?.name || dir), root });
      }
    } catch {
      // Missing or invalid Local State: fall through to directory probing.
    }
    if (!perRoot.length) {
      for (const dir of ["Default", "Profile 1", "Profile 2", "Profile 3"]) {
        if (await exists(path.join(root, dir, "Preferences"))) perRoot.push({ directory: dir, displayName: dir, root });
      }
    }
    perRoot.sort(compareProfiles);
    for (const c of perRoot) {
      const key = (c.root + "::" + c.directory).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(c);
    }
  }
  return found;
}

function matchesRequestedName(c: ChromeProfileCandidate, requested: string): boolean {
  const want = requested.trim().toLowerCase();
  return [c.directory, c.displayName].some((v) => String(v).trim().toLowerCase() === want);
}

function sanitizeDirName(v: string): string {
  return v.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "profile";
}

function managedUserDataDir(config: AppConfig, candidate: ChromeProfileCandidate | undefined, fallbackLabel?: string): string {
  const label = sanitizeDirName(candidate?.directory || fallbackLabel || "Default");
  if (process.platform === "linux") {
    const snapDir = path.join(os.homedir(), "snap", "chromium", "common");
    if (fsSync.existsSync(snapDir)) {
      return path.join(snapDir, "37web-profiles", label + "-user-data");
    }
  }
  return path.join(config.runtimeDir, "chrome-profiles", label + "-user-data");
}

async function ensureManagedDir(dir: string, displayName: string): Promise<void> {
  await fs.mkdir(path.join(dir, "Default"), { recursive: true });
  const prefs = path.join(dir, "Default", "Preferences");
  if (!(await exists(prefs))) {
    await fs.writeFile(prefs, JSON.stringify({ profile: { name: displayName } }, null, 2)).catch(() => {});
  }
}

/* ------------------------------------------------------------------ *
 * Chrome executable + version
 * ------------------------------------------------------------------ */

function which(names: string[]): string | undefined {
  for (const name of names) {
    try {
      if (process.platform === "win32") {
        const found = execFileSync("where", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0]?.trim();
        if (found) return found;
      } else {
        const found = execFileSync("sh", ["-c", "command -v " + JSON.stringify(name)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (found) return found;
      }
    } catch {}
  }
  return undefined;
}

export function findChromeExecutable(config: AppConfig): string {
  const explicit = config.chromeExecutable;
  if (explicit && fsSync.existsSync(explicit)) return explicit;

  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(os.homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else if (process.platform === "win32") {
    const roots = [
      process.env.PROGRAMFILES || "C:\\Program Files",
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    ];
    for (const root of roots) {
      candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(root, "Chromium", "Application", "chrome.exe"));
    }
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/opt/google/chrome/chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    );
  }
  const found = candidates.find((p) => p && fsSync.existsSync(p));
  if (found) return found;

  const onPath = which(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]);
  if (onPath) return onPath;

  throw new Error(
    "Google Chrome/Chromium executable not found. Install Chrome, or set WEBAGENT_CHROME_EXECUTABLE to the full path of the Chrome binary.",
  );
}

let cachedVersion: { exe: string; version?: string } | undefined;

/** Full Chrome version string, e.g. "139.0.7258.67". Best effort; undefined when unknown. */
export function chromeVersion(executable: string): string | undefined {
  if (cachedVersion && cachedVersion.exe === executable) return cachedVersion.version;
  let version: string | undefined;
  try {
    if (process.platform === "win32") {
      // chrome.exe --version writes nothing to stdout on Windows. Chrome keeps a versioned
      // sibling directory next to the binary, which is the cheapest reliable source.
      const appDir = path.dirname(executable);
      const versions = fsSync.readdirSync(appDir)
        .filter((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n))
        .sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]));
      version = versions[versions.length - 1];
      if (!version) {
        const shell = which(["powershell.exe", "pwsh.exe"]) || "powershell.exe";
        const literal = "'" + executable.replace(/'/g, "''") + "'";
        const raw = execFileSync(shell, [
          "-NoProfile", "-NonInteractive", "-Command",
          "(Get-Item -LiteralPath " + literal + ").VersionInfo.ProductVersion",
        ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim();
        if (/^\d+\./.test(raw)) version = raw;
      }
    } else {
      const raw = execFileSync(executable, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }).trim();
      const m = /(\d+\.\d+\.\d+\.\d+)/.exec(raw);
      version = m ? m[1] : undefined;
    }
  } catch {}
  cachedVersion = { exe: executable, version };
  return version;
}

function majorVersion(version: string | undefined): number | undefined {
  const major = Number(String(version || "").split(".")[0]);
  return Number.isFinite(major) && major > 0 ? major : undefined;
}

/** Chrome 136 is the release where remote debugging on the default user-data-dir stopped working. */
export const CDP_BLOCKED_FROM_MAJOR = 136;

/* ------------------------------------------------------------------ *
 * Process inspection (never touches the user's own Chrome)
 * ------------------------------------------------------------------ */

function normalizeForMatch(v: string): string {
  return path.resolve(v).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

interface ProcessRow { pid: number; command: string }

function listProcesses(): ProcessRow[] {
  try {
    if (process.platform === "win32") {
      // Single quotes only: embedded double quotes do not survive Windows argument escaping.
      const ps = "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'chrom*' }"
        + " | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
      const shell = which(["powershell.exe", "pwsh.exe"]) || "powershell.exe";
      const raw = execFileSync(shell, ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((r: any) => ({ pid: Number(r.ProcessId), command: String(r.CommandLine || "") }))
        .filter((r: ProcessRow) => Number.isFinite(r.pid));
    }
    const raw = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });
    return raw.split(/\r?\n/).map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), command: m[2] } : undefined;
    }).filter(Boolean) as ProcessRow[];
  } catch { return []; }
}

function looksLikeChrome(command: string): boolean {
  const c = command.toLowerCase();
  return c.includes("google chrome") || c.includes("chrome.exe") || c.includes("chromium")
    || c.includes("google-chrome") || /[/\\]chrome(\s|"|$)/.test(c);
}

function explicitUserDataDir(command: string): string | undefined {
  const m = command.replace(/\\/g, "/").match(/--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const raw = m ? (m[1] || m[2] || m[3]) : undefined;
  return raw ? normalizeForMatch(raw) : undefined;
}

/**
 * Whether a Chrome command line is using `userDataDir`.
 *
 * This is the safety-critical rule of the whole module, so it is a pure function that can be
 * tested directly. A command line with an explicit --user-data-dir matches only that exact
 * directory. A command line *without* one is ordinary Chrome started by the user, so it can
 * only ever match a real profile root - never an agent-owned directory. That is what
 * guarantees the agent cannot terminate the user's own browser.
 */
export function commandTargetsUserDataDir(command: string, userDataDir: string): boolean {
  if (!looksLikeChrome(command)) return false;
  const target = normalizeForMatch(userDataDir);
  const dir = explicitUserDataDir(command);
  if (dir) return dir === target;
  return chromeRoots().map(normalizeForMatch).includes(target);
}

/** Chrome processes currently holding `userDataDir`. */
function chromeProcessesUsing(userDataDir: string): ProcessRow[] {
  return listProcesses().filter((row) => row.pid !== process.pid && commandTargetsUserDataDir(row.command, userDataDir));
}

async function terminateProcess(pid: number, hard = false): Promise<void> {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", ...(hard ? ["/F"] : [])], { stdio: "ignore" });
    } else {
      process.kill(pid, hard ? "SIGKILL" : "SIGTERM");
    }
  } catch {}
}

async function waitForExit(pids: number[], timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const live = new Set(listProcesses().map((x) => x.pid));
    if (pids.every((pid) => !live.has(pid))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export interface TakeoverResult {
  killed: number[];
  locksRemoved: string[];
  /** Set when a conflicting Chrome was deliberately left running. */
  blockedBy?: number[];
}

/**
 * Free `profile.userDataDir` so Chrome can be relaunched with CDP enabled.
 *
 * Agent-owned (managed) directories are reclaimed by terminating the stale Chrome that owns
 * them. Real Chrome profiles are never reclaimed this way: the conflicting pids are reported
 * so the caller falls back to a managed profile instead of closing the user's browser.
 */
export async function forceReleaseChromeProfile(config: AppConfig, profile: ResolvedChromeProfile): Promise<TakeoverResult> {
  const conflicts = chromeProcessesUsing(profile.userDataDir);
  const pids = [...new Set(conflicts.map((x) => x.pid))];

  if (pids.length && !profile.managed) {
    return { killed: [], locksRemoved: [], blockedBy: pids };
  }
  if (pids.length && !config.forceProfileTakeover) {
    throw new Error(
      "Chrome is already using the agent profile directory " + profile.userDataDir +
      ". Close it, or set WEBAGENT_FORCE_PROFILE_TAKEOVER=1 to let the agent restart it automatically.",
    );
  }

  const killed: number[] = [];
  if (pids.length) {
    for (const pid of pids) await terminateProcess(pid, false);
    if (!(await waitForExit(pids, 5000))) {
      for (const pid of pids) await terminateProcess(pid, true);
      await waitForExit(pids, 3000);
    }
    killed.push(...pids);
  }

  const locksRemoved: string[] = [];
  if (chromeProcessesUsing(profile.userDataDir).length === 0) {
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      const p = path.join(profile.userDataDir, name);
      try {
        if (await exists(p)) { await fs.rm(p, { force: true }); locksRemoved.push(p); }
      } catch {}
    }
  }
  return { killed, locksRemoved };
}

/* ------------------------------------------------------------------ *
 * Display (headless) resolution
 * ------------------------------------------------------------------ */

function displayPreferencePath(config: AppConfig): string {
  return path.join(config.runtimeDir, "display-preference.json");
}

export async function readDisplayPreference(config: AppConfig): Promise<DisplayPreference> {
  try { return JSON.parse(await fs.readFile(displayPreferencePath(config), "utf8")); } catch { return {}; }
}

export async function writeDisplayPreference(config: AppConfig, pref: DisplayPreference): Promise<DisplayPreference> {
  await fs.mkdir(config.runtimeDir, { recursive: true });
  const clean: DisplayPreference = typeof pref.headless === "boolean" ? { headless: pref.headless } : {};
  await fs.writeFile(displayPreferencePath(config), JSON.stringify(clean, null, 2));
  return clean;
}

/** The runtime `browser reveal`/`browser hide` choice always wins over WEBAGENT_HEADLESS. */
export async function resolveHeadless(config: AppConfig): Promise<boolean> {
  const pref = await readDisplayPreference(config);
  return typeof pref.headless === "boolean" ? pref.headless : config.headless;
}

/* ------------------------------------------------------------------ *
 * Profile resolution
 * ------------------------------------------------------------------ */

export interface ResolveOptions {
  preference?: ProfilePreference;
  /** Forces a managed directory regardless of mode; used by the automatic fallback path. */
  forceManaged?: boolean;
  fallbackReason?: string;
}

/**
 * Decide which Chrome profile to drive.
 *
 * Priority:
 *   1. An explicit user-data directory (`webctl browser use --user-data-dir`, or env).
 *   2. A profile named by the caller (`webctl browser use --profile NAME`, or env).
 *   3. The first profile Chrome knows about - usually "Default".
 *
 * Mode "auto" uses the real profile directory when Chrome still allows remote debugging there
 * (Chrome < 136, and nothing else holding it); otherwise it transparently uses an agent-owned
 * directory mirroring the same profile.
 */
export async function resolveChromeProfile(config: AppConfig, options: ResolveOptions = {}): Promise<ResolvedChromeProfile> {
  const pref = options.preference || {};
  const explicitDir = pref.userDataDir || config.chromeUserDataDir;
  if (explicitDir) {
    const dir = path.resolve(explicitDir);
    const profileDirectory = pref.profileDirectory || config.chromeProfileDirectory || "Default";
    const name = pref.profileName || config.chromeProfileName || profileDirectory;
    return {
      requestedName: name,
      userDataDir: dir,
      profileDirectory,
      displayName: name,
      managed: normalizeForMatch(dir).startsWith(normalizeForMatch(config.runtimeDir)),
      source: "explicit",
      reason: "Using the explicitly configured user-data directory " + dir + " (profile \"" + profileDirectory + "\").",
    };
  }

  const requestedName = pref.profileName || config.chromeProfileName;
  const candidates = await listChromeProfiles();
  const mode: ProfileMode = options.forceManaged ? "managed" : (pref.mode || config.chromeProfileStrategy);

  const target: ChromeProfileCandidate | undefined = requestedName
    ? candidates.find((c) => matchesRequestedName(c, requestedName))
    : candidates[0];

  // In managed mode the name is only a label for the agent-owned directory, so an unknown
  // name is fine. Auto/real modes need the real profile to exist.
  if (requestedName && !target && mode !== "managed") {
    const known = candidates.map((c) => c.directory + " (\"" + c.displayName + "\")").join(", ") || "none found";
    throw new Error(
      "No Chrome profile matches \"" + requestedName + "\". Known profiles: " + known +
      ". Run `webctl browser profiles` to list them, or `webctl browser use --auto` to go back to the first profile.",
    );
  }

  const displayName = target ? target.displayName : (requestedName || "Default");
  const label = requestedName ? "\"" + requestedName + "\"" : "the first Chrome profile";

  const useManaged = (): ResolvedChromeProfile => ({
    requestedName: requestedName || "(first profile)",
    userDataDir: managedUserDataDir(config, target, requestedName),
    profileDirectory: "Default",
    displayName,
    managed: true,
    source: options.forceManaged ? "managed-fallback" : "managed-mirror-of-first-profile",
    reason: options.fallbackReason
      || "Using an agent-owned Chrome profile mirroring " + label + " (\"" + displayName + "\").",
    hint: "This is a real Chrome window on a separate profile directory: sign in once in it and the session persists.",
    basedOn: target,
  });

  if (mode === "managed" || !target) {
    const resolved = useManaged();
    if (!target) {
      resolved.reason = options.fallbackReason
        || "No existing Chrome profile was found on this machine; using a fresh agent-owned profile.";
    }
    await ensureManagedDir(resolved.userDataDir, resolved.displayName);
    return resolved;
  }

  const real: ResolvedChromeProfile = {
    requestedName: requestedName || "(first profile)",
    userDataDir: target.root,
    profileDirectory: target.directory,
    displayName,
    managed: false,
    source: "real-chrome-profile",
    reason: "Using " + label + ": " + target.directory + " (\"" + displayName + "\") in " + target.root + ".",
    basedOn: target,
  };

  if (mode === "real") return real;

  // mode === "auto": use the real profile only when Chrome still permits CDP there.
  let major: number | undefined;
  try { major = majorVersion(chromeVersion(findChromeExecutable(config))); } catch {}

  if (major !== undefined && major < CDP_BLOCKED_FROM_MAJOR) {
    if (chromeProcessesUsing(target.root).length === 0) return real;
    const busy = useManaged();
    busy.reason = label + " is currently open in your own Chrome window, which the agent will not close."
      + " Using an agent-owned profile mirroring it instead.";
    busy.hint = "Close Chrome and run `webctl browser repair` if you want the agent to drive your real profile.";
    await ensureManagedDir(busy.userDataDir, busy.displayName);
    return busy;
  }

  const fallback = useManaged();
  fallback.reason = major === undefined
    ? "Chrome's version could not be determined, so the agent uses its own profile directory mirroring " + label + " (\"" + displayName + "\")."
    : "Chrome " + major + " ignores remote debugging on the real profile directory, so the agent uses its own profile directory mirroring " + label + " (\"" + displayName + "\").";
  await ensureManagedDir(fallback.userDataDir, fallback.displayName);
  return fallback;
}

/* ------------------------------------------------------------------ *
 * Ports / CDP
 * ------------------------------------------------------------------ */

async function isPortFree(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function choosePort(preferred: number): Promise<number> {
  for (let p = preferred; p < preferred + 30; p++) if (await isPortFree(p)) return p;
  throw new Error("No free Chrome DevTools port in range " + preferred + "-" + (preferred + 29));
}

async function fetchJson(url: string, timeoutMs = 1000): Promise<any | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return undefined;
    return await res.json();
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}

async function waitForCdp(port: number, child: ChildProcess | undefined, timeoutMs = 20000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const version = await fetchJson("http://127.0.0.1:" + port + "/json/version", 700);
    if (version && version.webSocketDebuggerUrl) return;
    if (child && child.exitCode != null) throw new Error("Chrome exited during startup with code " + child.exitCode);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Chrome did not expose CDP on port " + port + " within " + timeoutMs + "ms");
}

/* ------------------------------------------------------------------ *
 * Cross-process startup lock
 * ------------------------------------------------------------------ */

/**
 * Guards Chrome acquisition (profile takeover + launch) against multiple browserd processes
 * racing for the same managed profile directory at once. Without this, two processes starting
 * concurrently can each treat the other's freshly-launched Chrome as a stale conflict and kill
 * it, in a cycle that never stabilizes - Chrome opening and immediately closing, repeatedly.
 * This can happen innocuously: e.g. two separate webctl callers (or a caller plus a leftover
 * process from an earlier run) starting around the same time against the same WEBAGENT_HOME.
 */
const LOCK_STALE_MS = 30000;
const LOCK_POLL_MS = 200;
const LOCK_WAIT_MS = 25000;

function chromeLockPath(config: AppConfig): string {
  return path.join(config.runtimeDir, "chrome-startup.lock");
}

/** Waits for exclusive ownership of Chrome startup, then returns a function that releases it. */
async function acquireChromeLock(config: AppConfig): Promise<() => Promise<void>> {
  const lockPath = chromeLockPath(config);
  await fs.mkdir(config.runtimeDir, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      await handle.close();
      return async () => { await fs.rm(lockPath, { force: true }).catch(() => {}); };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      // Someone else holds it. If their lock is stale (they crashed mid-startup), steal it.
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lockPath, { force: true }).catch(() => {});
          continue;
        }
      } catch {
        // Lock disappeared between the failed open and this stat - just retry the open.
      }
      if (Date.now() > deadline) {
        throw new Error(
          "Timed out waiting for another process to finish starting Chrome (" + lockPath + "). " +
          "If nothing is actually starting Chrome right now, delete that file and retry.",
        );
      }
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Manager
 * ------------------------------------------------------------------ */

export class ChromeManager {
  private browser?: Browser;
  private context?: BrowserContext;
  private child?: ChildProcess;
  private profile?: ResolvedChromeProfile;
  private state?: ChromeRuntimeState;
  private disconnected = false;

  constructor(private config: AppConfig) {}

  async start(): Promise<{ context: BrowserContext; state: ChromeRuntimeState; takeover: any }> {
    const release = await acquireChromeLock(this.config);
    try { return await this.startLocked(); }
    finally { await release(); }
  }

  /** The actual startup logic. Only call this while already holding the Chrome startup lock. */
  private async startLocked(): Promise<{ context: BrowserContext; state: ChromeRuntimeState; takeover: any }> {
    const preference = await this.readPreference();
    const executable = findChromeExecutable(this.config);
    let profile = await resolveChromeProfile(this.config, { preference });

    // Reattach to a Chrome this agent started earlier instead of restarting it.
    const previous = await this.readState();
    if (previous && normalizeForMatch(previous.userDataDir) === normalizeForMatch(profile.userDataDir)
      && previous.profileDirectory === profile.profileDirectory) {
      const version = await fetchJson("http://127.0.0.1:" + previous.cdpPort + "/json/version", 700);
      if (version && version.webSocketDebuggerUrl) {
        const attached = await this.attach(previous.cdpPort);
        this.profile = profile;
        this.state = previous;
        return { context: attached, state: previous, takeover: { reusedExistingChrome: true, killed: [], locksRemoved: [] } };
      }
    }

    let takeover: TakeoverResult = await forceReleaseChromeProfile(this.config, profile);
    if (takeover.blockedBy && takeover.blockedBy.length) {
      // The real profile is held by the user's own Chrome. Never close it: mirror it instead.
      const blockedBy = takeover.blockedBy;
      profile = await resolveChromeProfile(this.config, {
        preference,
        forceManaged: true,
        fallbackReason: "Your own Chrome is using " + profile.profileDirectory + " (\"" + profile.displayName +
          "\"), and the agent does not close your browser. Using an agent-owned profile mirroring it instead.",
      });
      takeover = { ...(await forceReleaseChromeProfile(this.config, profile)), blockedBy };
    }

    try {
      return await this.launch(executable, profile, takeover);
    } catch (error: any) {
      if (profile.managed) throw error;
      // Chrome refused CDP on the real profile: keep the task alive with a managed mirror.
      const fallback = await resolveChromeProfile(this.config, {
        preference,
        forceManaged: true,
        fallbackReason: "Chrome refused remote debugging on " + profile.profileDirectory + " (\"" + profile.displayName +
          "\") (" + (error && error.message ? error.message : String(error)) + "). Using an agent-owned profile mirroring it instead.",
      });
      const released = await forceReleaseChromeProfile(this.config, fallback);
      return await this.launch(executable, fallback, { ...released, fellBackFrom: profile.userDataDir });
    }
  }

  private async launch(executable: string, profile: ResolvedChromeProfile, takeover: any): Promise<{ context: BrowserContext; state: ChromeRuntimeState; takeover: any }> {
    const port = await choosePort(this.config.cdpPort || 9223);
    const headless = await resolveHeadless(this.config);
    const args = [
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profile.userDataDir,
      "--profile-directory=" + profile.profileDirectory,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--disable-features=TranslateUI,OptimizationHints,OptimizationGuideModelDownloading",
      "--disable-blink-features=AutomationControlled",
      "--disable-component-update",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-default-apps",
      "--disk-cache-size=33554432",
      "about:blank",
    ];
    if (headless) args.unshift("--headless=new");

    const launchCwd = profile.userDataDir;

    if (process.platform === "win32" && !headless) {
      const helper = path.join(this.config.root, "scripts", "launch-on-desktop.ps1");
      const fullCmd = `"${executable}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
      const shell = which(["powershell.exe", "pwsh.exe"]) || "powershell.exe";
      try {
        const out = execFileSync(
          shell,
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-CommandLine", fullCmd, "-WorkingDirectory", launchCwd],
          { encoding: "utf8", timeout: 10000 }
        ).trim();
        const launchedPid = Number(out);
        if (Number.isFinite(launchedPid) && launchedPid > 0) {
          this.child = { pid: launchedPid, unref: () => {} } as any;
        } else {
          this.child = spawn(executable, args, { cwd: launchCwd, detached: true, stdio: "ignore", windowsHide: false });
          this.child.unref();
        }
      } catch {
        this.child = spawn(executable, args, { cwd: launchCwd, detached: true, stdio: "ignore", windowsHide: false });
        this.child.unref();
      }
    } else {
      this.child = spawn(executable, args, { cwd: launchCwd, detached: true, stdio: "ignore", windowsHide: false });
      this.child.unref();
    }
    await waitForCdp(port, this.child, this.config.chromeStartupTimeoutMs);
    const context = await this.attach(port);

    const state: ChromeRuntimeState = {
      executable,
      chromeVersion: chromeVersion(executable),
      userDataDir: profile.userDataDir,
      profileDirectory: profile.profileDirectory,
      displayName: profile.displayName,
      managed: profile.managed,
      headless,
      cdpPort: port,
      pid: this.child?.pid,
      startedAt: new Date().toISOString(),
      source: profile.source,
      reason: profile.reason,
      hint: profile.hint,
    };
    this.profile = profile;
    this.state = state;
    await this.writeState(state);
    return { context, state, takeover };
  }

  private async attach(port: number): Promise<BrowserContext> {
    this.browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
    this.disconnected = false;
    this.browser.on("disconnected", () => { this.disconnected = true; });
    const context = this.browser.contexts()[0];
    if (!context) throw new Error("Connected to Chrome but no browser context is available");
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined, configurable: true });
        // Mask automated chrome runtime tokens
        (window as any).chrome = (window as any).chrome || { runtime: {} };
      } catch {}
    }).catch(() => {});
    this.context = context;
    return context;
  }

  async ensureConnected(): Promise<BrowserContext> {
    if (this.context && !this.disconnected && this.browser && this.browser.isConnected()) return this.context;
    const started = await this.start();
    return started.context;
  }

  getState(): ChromeRuntimeState | undefined { return this.state; }

  async repair(): Promise<{ context: BrowserContext; state: ChromeRuntimeState; takeover: any }> {
    const release = await acquireChromeLock(this.config);
    try {
      // Drop local Playwright handles first, then reclaim only agent-owned Chrome processes.
      this.browser = undefined;
      this.context = undefined;
      this.disconnected = true;
      const profile = this.profile || await resolveChromeProfile(this.config, { preference: await this.readPreference() });
      const takeover = await forceReleaseChromeProfile(this.config, profile);
      try { await fs.rm(this.statePath(), { force: true }); } catch {}
      this.profile = undefined;
      const started = await this.startLocked();
      return { ...started, takeover: { ...takeover, ...started.takeover, repaired: true } };
    } finally {
      await release();
    }
  }

  async stop(): Promise<void> {
    // Deliberately leave Chrome running: closing a CDP-connected Browser would close the
    // visible window. The next browserd instance reattaches using chrome-state.json.
    this.browser = undefined;
    this.context = undefined;
  }

  /* --- profile preference (survives daemon restarts) --- */

  preferencePath(): string { return path.join(this.config.runtimeDir, "profile-preference.json"); }

  async readPreference(): Promise<ProfilePreference> {
    try { return JSON.parse(await fs.readFile(this.preferencePath(), "utf8")); } catch { return {}; }
  }

  async writePreference(pref: ProfilePreference): Promise<ProfilePreference> {
    await fs.mkdir(this.config.runtimeDir, { recursive: true });
    const clean: ProfilePreference = {};
    if (pref.profileName) clean.profileName = pref.profileName;
    if (pref.mode) clean.mode = pref.mode;
    if (pref.userDataDir) clean.userDataDir = path.resolve(pref.userDataDir);
    if (pref.profileDirectory) clean.profileDirectory = pref.profileDirectory;
    await fs.writeFile(this.preferencePath(), JSON.stringify(clean, null, 2));
    return clean;
  }

  async readDisplayPreference(): Promise<DisplayPreference> { return readDisplayPreference(this.config); }
  async writeDisplayPreference(pref: DisplayPreference): Promise<DisplayPreference> { return writeDisplayPreference(this.config, pref); }

  private statePath(): string { return path.join(this.config.runtimeDir, "chrome-state.json"); }

  private async readState(): Promise<ChromeRuntimeState | undefined> {
    try { return JSON.parse(await fs.readFile(this.statePath(), "utf8")); } catch { return undefined; }
  }

  private async writeState(state: ChromeRuntimeState): Promise<void> {
    await fs.mkdir(this.config.runtimeDir, { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }
}
