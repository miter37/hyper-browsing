import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getConfig } from '../src/config.ts';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { postRpc } from '../scripts/rpc-transport.mjs';
import { browserOptions } from './browser-options.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function world(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-robust-'));
  const c = { ...getConfig(), root: ROOT, runtimeDir: path.join(root, '.runtime'), sitesDir: path.join(root, 'sites'), generatedDir: path.join(root, '.generated'), profileDir: path.join(root, 'profile') };
  await fs.mkdir(path.join(c.runtimeDir, 'metrics'), { recursive: true });
  process.env.WEBAGENT_RUNTIME_DIR = c.runtimeDir; // explicit: tests never claim the machine runtime
  const browser = await chromium.launch(browserOptions());
  const context = await browser.newContext();
  await context.route('https://site.test/**', (r) => r.fulfill({ contentType: 'text/html', body: `<h1>${new URL(r.request().url()).pathname}</h1>` }));
  await (await context.newPage()).goto('https://site.test/home');
  const daemons = [];
  const start = async (chrome = {}) => {
    const d = new BrowserDaemon({ ...c, port: 0 });
    d.chrome = { start: async () => ({ context }), ensureConnected: async () => context, getState: () => ({}), stop: async () => {}, connected: () => true, ...chrome };
    await d.start(); daemons.push(d);
    const endpoint = `http://127.0.0.1:${d.server.address().port}`;
    const token = (await fs.readFile(path.join(c.runtimeDir, 'browserd.token'), 'utf8')).trim();
    const call = async (method, params = {}) => {
      const r = await postRpc({ endpoint, token, method, params });
      if (r.rpcOk === false && r.result?.error) return { error: r.result.error, execution: r.result.execution };
      return r.result;
    };
    return { d, call };
  };
  t.after(async () => { for (const d of daemons) await d.stop().catch(() => {}); await browser.close(); await fs.rm(root, { recursive: true, force: true }); delete process.env.WEBAGENT_RUNTIME_DIR; });
  return { c, context, start, root };
}

test('session ids survive a daemon restart, so another agent\'s session keeps working', async (t) => {
  const { start } = await world(t);
  const first = await start();
  const opened = await first.call('session.open', { url: 'https://site.test/work' });
  await first.d.stop();
  const second = await start();
  const list = await second.call('session.list', {});
  const sessions = list.sessions || list;
  assert.ok(sessions.some((s) => s.id === opened.id && s.url.endsWith('/work')), JSON.stringify(sessions));
  const text = await second.call('page.extract', { sessionId: opened.id, locator: { css: 'h1' }, read: 'text' });
  assert.equal(text.value, '/work');
});

test('idle tabs are swept, recently used ones are kept, and one tab always stays', async (t) => {
  const { start } = await world(t);
  const { d, call } = await start();
  const a = await call('session.open', { url: 'https://site.test/a' });
  const b = await call('session.open', { url: 'https://site.test/b' });
  await new Promise((r) => setTimeout(r, 120));
  await call('page.extract', { sessionId: b.id, locator: { css: 'h1' }, read: 'text' });
  const closed = await d.sessions.sweepIdle({ idleMs: 100, maxTabs: 20, minIdleMs: 0 });
  assert.ok(closed.includes(a.id)); assert.ok(!closed.includes(b.id));
  const all = await d.sessions.sweepIdle({ idleMs: -1, maxTabs: 20, minIdleMs: 0 });
  assert.ok(all.includes(b.id));
  assert.ok(d.context.pages().filter((p) => !p.isClosed()).length >= 1, 'Chrome keeps a tab');
  assert.ok(!d.sessions.idleList().some((s) => s.id === a.id || s.id === b.id));
  const gone = await call('page.snapshot', { sessionId: a.id });
  assert.match(gone.error, /Unknown session.*session_open.*Do not restart the browser/);
  assert.equal(gone.execution, 'not_started');
});

test('browser_doctor diagnoses without changing anything, and with fix relaunches a dead Chrome', async (t) => {
  const { start, root, context } = await world(t);
  let relaunched = 0, live = false;
  const profileDir = path.join(root, 'chrome-profiles', 'P-user-data');
  await fs.mkdir(path.join(profileDir, 'Default'), { recursive: true });
  const { call } = await start({ getState: () => ({ userDataDir: profileDir, cdpPort: 1 }), connected: () => live,
    repair: async () => { relaunched++; live = true; return { context, state: {}, takeover: {} }; } });
  const report = await call('browser.doctor', { fix: false });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((c) => c.name === 'chrome').ok, false);
  assert.match(report.advice, /fix: true/); assert.equal(relaunched, 0);
  assert.match(report.rules, /Never delete or rename chrome-profiles/);
  assert.match(report.checks.find((c) => c.name === 'profile').advice, /Sign in once/);
  // A stale startup lock left by a crashed start is cleared.
  await fs.writeFile(path.join(process.env.WEBAGENT_RUNTIME_DIR, 'chrome-startup.lock'), JSON.stringify({ pid: 999999, at: 'x' }));
  const fixed = await call('browser.doctor', { fix: true });
  const chrome = fixed.checks.find((c) => c.name === 'chrome');
  assert.equal(relaunched, 1); assert.match(chrome.fixed, /relaunched/); assert.equal(chrome.ok, true);
  assert.match(fixed.checks.find((c) => c.name === 'locks').fixed, /removed 1 stale lock/);
});

test('one runtime per machine: the first daemon claims it, every install then resolves to it, explicit dirs stay private', () => {
  const home = execFileSync('node', ['-e', 'console.log(require("os").tmpdir())'], { encoding: 'utf8' }).trim();
  const fakeHome = path.join(home, `hb-home-${process.pid}-${Date.now()}`);
  const script = `
    const m = await import(${JSON.stringify('file:///' + path.join(ROOT, 'scripts', 'runtime-home.mjs').replace(/\\\\/g, '/'))});
    const fs = await import('node:fs'); const path = await import('node:path');
    const a = path.join(${JSON.stringify(fakeHome)}, 'installA'); const b = path.join(${JSON.stringify(fakeHome)}, 'installB');
    const out = { before: m.resolveRuntimeDir(b) };
    fs.mkdirSync(path.join(a, '.runtime'), { recursive: true });
    out.claimed = m.claimRuntimeHome(path.join(a, '.runtime'));
    out.afterB = m.resolveRuntimeDir(b);
    process.env.WEBAGENT_RUNTIME_DIR = path.join(b, 'private');
    out.explicit = m.resolveRuntimeDir(b); out.explicitClaim = m.claimRuntimeHome(path.join(b, 'private')) ?? null;
    console.log(JSON.stringify(out));`;
  const env = { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome }; delete env.WEBAGENT_RUNTIME_DIR; delete env.WEBAGENT_RUNTIME_RESOLVED;
  const out = JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', env }));
  assert.equal(out.before, path.join(fakeHome, 'installB', '.runtime'));
  assert.equal(out.claimed, path.join(fakeHome, 'installA', '.runtime'));
  assert.equal(out.afterB, path.join(fakeHome, 'installA', '.runtime'), 'a second install uses the machine runtime');
  assert.equal(out.explicit, path.join(fakeHome, 'installB', 'private'));
  assert.equal(out.explicitClaim, null, 'an explicit runtime never claims the machine');
});
