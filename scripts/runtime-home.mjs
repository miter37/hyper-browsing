/**
 * One runtime per machine user.
 *
 * Every entry point (MCP server, webctl, the npx/npm package, a checkout or skill folder) used to pick its
 * own runtime folder, so two installs ran two daemons, two Chromes and two copies of the login profile:
 * one install was signed in, the other was not, and they fought over ports. Now the first daemon to start
 * records its runtime in ~/.hyper-browsing/runtime-home.json and every later entry point uses that one
 * runtime: one daemon, one Chrome, one signed-in profile. WEBAGENT_RUNTIME_DIR still overrides everything.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MACHINE_DIR = path.join(os.homedir(), '.hyper-browsing');
export const POINTER_FILE = path.join(MACHINE_DIR, 'runtime-home.json');

/** The runtime this install would use on its own: <root>/.runtime, or ~/.hyper-browsing for a packaged copy. */
export function defaultRuntimeDir(root) {
  const packaged = path.resolve(root).split(path.sep).includes('node_modules');
  return packaged ? MACHINE_DIR : path.join(path.resolve(root), '.runtime');
}

/** The machine's runtime from the pointer file, if it names a folder that still exists. */
export function pointedRuntimeDir() {
  try {
    const dir = JSON.parse(fs.readFileSync(POINTER_FILE, 'utf8')).runtimeDir;
    return dir && fs.existsSync(dir) ? path.resolve(dir) : undefined;
  } catch { return undefined; }
}

/** Where state lives: WEBAGENT_RUNTIME_DIR, else the machine runtime, else this install's default. */
export function resolveRuntimeDir(root) {
  if (process.env.WEBAGENT_RUNTIME_DIR) return path.resolve(process.env.WEBAGENT_RUNTIME_DIR);
  return pointedRuntimeDir() || defaultRuntimeDir(root);
}

/**
 * Called when a daemon starts: the first one claims the machine. An explicit WEBAGENT_RUNTIME_DIR (tests,
 * isolated setups) never claims, and an existing claim is never moved silently.
 */
export function claimRuntimeHome(runtimeDir) {
  // WEBAGENT_RUNTIME_RESOLVED marks a runtime this module chose (passed down by bin/hyper-browsing.mjs); any
  // other WEBAGENT_RUNTIME_DIR was set by hand and stays private.
  const explicit = process.env.WEBAGENT_RUNTIME_DIR && process.env.WEBAGENT_RUNTIME_RESOLVED !== '1';
  if (explicit || process.env.WEBAGENT_NO_CLAIM === '1') return undefined;
  const current = pointedRuntimeDir();
  if (current) return current;
  try {
    fs.mkdirSync(MACHINE_DIR, { recursive: true });
    fs.writeFileSync(POINTER_FILE, JSON.stringify({
      runtimeDir: path.resolve(runtimeDir),
      claimedAt: new Date().toISOString(),
      note: 'Every hyper-browsing install on this machine uses this runtime: one daemon, one Chrome, one signed-in profile. Move it only with: hyper-browsing doctor --home <dir>',
    }, null, 2));
  } catch {}
  return path.resolve(runtimeDir);
}

/** Moves the machine runtime (doctor --home). The old one is left in place, untouched. */
export function setRuntimeHome(runtimeDir) {
  fs.mkdirSync(MACHINE_DIR, { recursive: true });
  fs.writeFileSync(POINTER_FILE, JSON.stringify({ runtimeDir: path.resolve(runtimeDir), claimedAt: new Date().toISOString(),
    note: 'Set by hyper-browsing doctor --home.' }, null, 2));
  return path.resolve(runtimeDir);
}

/** Runtime folders on this machine that hold a Chrome profile, to report strays that are not the machine runtime. */
export function knownRuntimeDirs(root) {
  const out = new Set([MACHINE_DIR, defaultRuntimeDir(root)]);
  const pointed = pointedRuntimeDir(); if (pointed) out.add(pointed);
  return [...out].filter((d) => fs.existsSync(path.join(d, 'chrome-profiles')));
}
