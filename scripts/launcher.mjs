#!/usr/bin/env node
/**
 * Cross-platform entry point for adaptive-web-agent.
 *
 * Usage: node scripts/launcher.mjs <webctl|browserd|bootstrap|self-check> [args...]
 *
 * This replaces the previous bash-only bin/ scripts so the skill runs identically on
 * Windows (cmd.exe, PowerShell, Git Bash), macOS and Linux. It performs the self-check,
 * first-run bootstrap, and browserd supervision that used to live in scripts/*.sh.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";

process.env.WEBAGENT_HOME = process.env.WEBAGENT_HOME || ROOT;

const RUNTIME_DIR = path.resolve(process.env.WEBAGENT_RUNTIME_DIR || path.join(ROOT, ".runtime"));
/** Set by the user: the port is then pinned and never auto-selected. */
const PINNED_PORT = process.env.WEBAGENT_PORT ? Number(process.env.WEBAGENT_PORT) : undefined;
const BASE_PORT = PINNED_PORT || 3219;
const PID_FILE = path.join(RUNTIME_DIR, "browserd.pid");
const LOG_FILE = path.join(RUNTIME_DIR, "browserd.log");
const ENDPOINT_FILE = path.join(RUNTIME_DIR, "browserd-endpoint.json");

function log(message) {
  if (process.env.WEBAGENT_QUIET === "1") return;
  process.stderr.write("[adaptive-web-agent] " + message + "\n");
}

function fail(message, code = 1) {
  process.stderr.write("[adaptive-web-agent] " + message + "\n");
  process.exit(code);
}

/* ------------------------------------------------------------------ *
 * Self-check
 * ------------------------------------------------------------------ */

const REQUIRED_FILES = [
  "SKILL.md",
  "package.json",
  "src/bin/browserd.ts",
  "src/bin/webctl.ts",
  "src/browserd/server.ts",
  "src/browserd/chrome-manager.ts",
  "src/runtime/learning.ts",
  "src/schema/site.ts",
  "scripts/launcher.mjs",
];

function selfCheck() {
  const missing = REQUIRED_FILES.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  if (missing.length) {
    for (const rel of missing) process.stderr.write("MISSING: " + path.join(ROOT, rel) + "\n");
    process.exit(3);
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

/** Absolute path to tsx's CLI entry, resolved from the installed package. */
function resolveTsx() {
  const pkgPath = path.join(ROOT, "node_modules", "tsx", "package.json");
  if (!fs.existsSync(pkgPath)) return undefined;
  let bin;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin && (pkg.bin.tsx || Object.values(pkg.bin)[0]));
  } catch { return undefined; }
  if (!bin) return undefined;
  const abs = path.join(ROOT, "node_modules", "tsx", bin);
  return fs.existsSync(abs) ? abs : undefined;
}

function npmInstall() {
  log("Installing Node dependencies (first use only)...");
  // Node refuses to execute .cmd shims without a shell on Windows.
  const command = IS_WINDOWS ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["install", "--no-audit", "--no-fund"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: IS_WINDOWS,
  });
  if (result.error || result.status !== 0) {
    fail("npm install failed. Run it manually in " + ROOT + " and retry.", 2);
  }
}

function bootstrap() {
  if (nodeMajor() < 20) fail("Node.js >= 20 is required; found " + process.version + ".", 2);
  for (const dir of [RUNTIME_DIR, path.join(ROOT, ".generated"), path.join(ROOT, "sites")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let tsx = resolveTsx();
  if (!tsx) {
    npmInstall();
    tsx = resolveTsx();
    if (!tsx) fail("tsx is still missing after npm install; check " + path.join(ROOT, "node_modules") + ".", 2);
  }
  // v0.2+ drives the installed Google Chrome over CDP, so Playwright's bundled Chromium is
  // only downloaded when explicitly requested.
  if (process.env.WEBAGENT_INSTALL_PLAYWRIGHT_CHROMIUM === "1") {
    const marker = path.join(RUNTIME_DIR, ".playwright-browser-ready");
    if (!fs.existsSync(marker)) {
      log("Installing Playwright Chromium...");
      const cli = path.join(ROOT, "node_modules", "playwright", "cli.js");
      const install = fs.existsSync(cli)
        ? spawnSync(process.execPath, [cli, "install", "chromium"], { cwd: ROOT, stdio: "inherit" })
        : spawnSync(IS_WINDOWS ? "npx.cmd" : "npx", ["playwright", "install", "chromium"], { cwd: ROOT, stdio: "inherit", shell: IS_WINDOWS });
      if (!install.error && install.status === 0) fs.writeFileSync(marker, new Date().toISOString());
    }
  }
  return tsx;
}

/* ------------------------------------------------------------------ *
 * browserd supervision
 * ------------------------------------------------------------------ */

const TOKEN_FILE = path.join(RUNTIME_DIR, "browserd.token");

/** True only when *our* browserd answers on `port`; a foreign listener must not be mistaken for it. */
async function daemonHealthy(port) {
  if (!fs.existsSync(TOKEN_FILE)) return false;
  const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  if (!token) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900);
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/health", {
      headers: { "x-browserd-token": token },
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body && body.status === "ok");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function readEndpointPort() {
  try {
    const port = Number(JSON.parse(fs.readFileSync(ENDPOINT_FILE, "utf8")).port);
    return Number.isFinite(port) && port > 0 ? port : undefined;
  } catch { return undefined; }
}

function writeEndpointPort(port) {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(ENDPOINT_FILE, JSON.stringify({ port, updatedAt: new Date().toISOString() }, null, 2));
  } catch {}
}

/**
 * Pick the port browserd should use.
 *
 * WEBAGENT_PORT pins the port exactly. Otherwise the last known port is reused when a daemon
 * is alive there, and a free port at or after 3219 is chosen when it is not - so an unrelated
 * app already sitting on 3219 cannot block the skill.
 */
async function resolveDaemonPort() {
  if (PINNED_PORT) return PINNED_PORT;

  const recorded = readEndpointPort();
  if (recorded && await daemonHealthy(recorded)) return recorded;

  for (let port = BASE_PORT; port < BASE_PORT + 40; port++) {
    if (await daemonHealthy(port)) return port;
    if (await portIsFree(port)) return port;
  }
  fail("No free port for browserd in range " + BASE_PORT + "-" + (BASE_PORT + 39) + ". Set WEBAGENT_PORT explicitly.");
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killPid(pid, hard) {
  try {
    if (IS_WINDOWS) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", ...(hard ? ["/F"] : [])], { stdio: "ignore" });
    } else {
      process.kill(pid, hard ? "SIGKILL" : "SIGTERM");
    }
  } catch {}
}

async function stopStaleDaemon() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
  if (Number.isFinite(pid) && pid > 0 && processAlive(pid)) {
    killPid(pid, false);
    for (let i = 0; i < 20 && processAlive(pid); i++) await sleep(150);
    if (processAlive(pid)) killPid(pid, true);
  }
  try { fs.rmSync(PID_FILE, { force: true }); } catch {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Starts browserd if it is not already answering, and returns the port it is reachable on. */
async function ensureBrowserd() {
  const port = await resolveDaemonPort();
  if (await daemonHealthy(port)) {
    writeEndpointPort(port);
    return port;
  }

  // A stale browserd may still hold the pid file while no longer answering RPC.
  await stopStaleDaemon();

  if (!(await portIsFree(port))) {
    // If the port is not free and not healthy, attempt to clean up stale process holding it on Windows
    if (IS_WINDOWS) {
      try {
        const netstat = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
        const portPid = Number(netstat.stdout.trim().split(/\r?\n/)[0]);
        if (Number.isFinite(portPid) && portPid > 0) {
          killPid(portPid, true);
          await sleep(500);
        }
      } catch {}
    }
  }

  // If still not free, automatically resolve a truly free port rather than failing
  let chosenPort = port;
  if (!(await portIsFree(chosenPort))) {
    for (let p = BASE_PORT; p < BASE_PORT + 50; p++) {
      if (await portIsFree(p)) {
        chosenPort = p;
        break;
      }
    }
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, "");
  const out = fs.openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "launcher.mjs"), "browserd"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: false,
    env: { ...process.env, WEBAGENT_HOME: ROOT, WEBAGENT_PORT: String(chosenPort) },
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  writeEndpointPort(chosenPort);

  for (let i = 0; i < 240; i++) {
    if (await daemonHealthy(chosenPort)) return chosenPort;
    if (child.exitCode !== null && !processAlive(child.pid)) break;
    await sleep(250);
  }

  let tail = "";
  try { tail = fs.readFileSync(LOG_FILE, "utf8").split(/\r?\n/).slice(-80).join("\n"); } catch {}
  fail("browserd failed to become healthy.\n---- last browserd log ----\n" + tail + "\n---------------------------");
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const TARGETS = {
  webctl: "src/bin/webctl.ts",
  browserd: "src/bin/browserd.ts",
};

async function main() {
  const [target, ...args] = process.argv.slice(2);

  if (target === "self-check") {
    selfCheck();
    process.stdout.write("adaptive-web-agent self-check: OK\n");
    return;
  }
  if (target === "bootstrap") {
    selfCheck();
    bootstrap();
    log("Runtime ready.");
    return;
  }
  if (!target || !TARGETS[target]) {
    fail("Usage: node scripts/launcher.mjs <webctl|browserd|bootstrap|self-check> [args...]", 64);
  }

  selfCheck();
  const tsx = bootstrap();

  // Only webctl needs the daemon; running browserd here *is* the daemon.
  if (target === "webctl") {
    process.env.WEBAGENT_PORT = String(await ensureBrowserd());
  } else if (!PINNED_PORT) {
    // Foreground daemon: claim a port and record it so webctl finds this instance.
    const port = await resolveDaemonPort();
    process.env.WEBAGENT_PORT = String(port);
    writeEndpointPort(port);
  }

  const result = spawnSync(process.execPath, [tsx, path.join(ROOT, TARGETS[target]), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, WEBAGENT_HOME: ROOT },
  });
  if (result.error) fail(String(result.error.message || result.error), 1);
  process.exit(result.status === null ? 1 : result.status);
}

main().catch((error) => fail(String((error && error.stack) || error), 1));
