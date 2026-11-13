import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getConfig } from '../src/config.ts';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { postRpc } from '../scripts/rpc-transport.mjs';
import { browserOptions } from './browser-options.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const route = async (context) => context.route('https://site.test/**', async (r) => {
  const u = new URL(r.request().url());
  if (u.pathname === '/slow') await new Promise((res) => setTimeout(res, 2500));
  await r.fulfill({ contentType: 'text/html', body: `<h1>${u.pathname}</h1><button onclick="document.title='clicked'">Go</button>` });
});

async function world(t, { persistent = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-par-'));
  const c = { ...getConfig(), root: ROOT, runtimeDir: path.join(root, '.runtime'), sitesDir: path.join(root, 'sites'), generatedDir: path.join(root, '.generated'), profileDir: path.join(root, 'profile') };
  await fs.mkdir(path.join(c.runtimeDir, 'metrics'), { recursive: true });
  process.env.WEBAGENT_RUNTIME_DIR = c.runtimeDir;
  let browser, context;
  if (persistent) { context = await chromium.launchPersistentContext(path.join(root, 'ud'), browserOptions()); }
  else { browser = await chromium.launch(browserOptions()); context = await browser.newContext(); }
  await route(context);
  if (!context.pages().length) await context.newPage();
  const d = new BrowserDaemon({ ...c, port: 0 });
  d.chrome = { start: async () => ({ context }), ensureConnected: async () => context, getState: () => (persistent ? { cdpPort: 1 } : {}), stop: async () => {}, connected: () => true,
    repair: async () => ({ context, state: {}, takeover: {} }) };
  t.after(async () => { await d.stop().catch(() => {}); await (browser || context).close(); await fs.rm(root, { recursive: true, force: true }); delete process.env.WEBAGENT_RUNTIME_DIR; });
  return { d, c, context, ready: async () => {
    await d.start();
    const endpoint = `http://127.0.0.1:${d.server.address().port}`;
    const token = (await fs.readFile(path.join(c.runtimeDir, 'browserd.token'), 'utf8')).trim();
    return async (method, params = {}) => {
      const r = await postRpc({ endpoint, token, method, params });
      if (r.rpcOk === false && r.result?.error) throw new Error(r.result.error);
      return r.result;
    };
  } };
}

test('sessions of different agents run side by side; one session keeps its own order', async (t) => {
  const { ready } = await world(t);
  const call = await ready();
  const a = await call('session.open', { url: 'https://site.test/a' });
  const b = await call('session.open', { url: 'https://site.test/b' });
  const t0 = Date.now();
  const slow = call('page.goto', { sessionId: a.id, url: 'https://site.test/slow' }).then(() => Date.now() - t0);
  await new Promise((r) => setTimeout(r, 200));
  const other = await call('page.extract', { sessionId: b.id, locator: { css: 'h1' }, read: 'text' });
  const otherDone = Date.now() - t0;
  assert.equal(other.value, '/b');
  assert.ok(otherDone < 1500, `session b waited for session a (${otherDone} ms)`);
  // Same session: the read waits for the navigation before it.
  const sameSession = await call('page.extract', { sessionId: a.id, locator: { css: 'h1' }, read: 'text' });
  assert.equal(sameSession.value, '/slow');
  assert.ok(await slow >= 2400);
});

test('a Chrome-wide command waits for session work in flight', async (t) => {
  const { ready } = await world(t);
  const call = await ready();
  const a = await call('session.open', { url: 'https://site.test/a' });
  const t0 = Date.now();
  const slow = call('page.goto', { sessionId: a.id, url: 'https://site.test/slow' }).then(() => Date.now() - t0);
  await new Promise((r) => setTimeout(r, 200));
  await call('session.closeAll', {});
  const closedAt = Date.now() - t0;
  assert.ok(closedAt >= await slow, `closeAll ran during a session's navigation (${closedAt} ms)`);
});

test('in a real Chrome every session gets its own window', async (t) => {
  const { ready, context } = await world(t, { persistent: true });
  const call = await ready();
  const a = await call('session.open', { url: 'https://site.test/a' });
  const b = await call('session.open', { url: 'https://site.test/b' });
  assert.notEqual(a.id, b.id);
  const cdp = await context.browser()?.newBrowserCDPSession?.() || await context.newCDPSession(context.pages()[0]);
  const windowOf = async (url) => {
    const page = context.pages().find((p) => p.url() === url);
    const s = await context.newCDPSession(page);
    const { targetInfo } = await s.send('Target.getTargetInfo');
    return (await cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId })).windowId;
  };
  assert.notEqual(await windowOf('https://site.test/a'), await windowOf('https://site.test/b'));
  const text = await call('page.extract', { sessionId: b.id, locator: { css: 'h1' }, read: 'text' });
  assert.equal(text.value, '/b', 'the session is bound to its own window page, not one adopted as a popup');
  const list = await call('session.list', {});
  assert.equal(list.filter((s) => s.id === a.id || s.id === b.id).length, 2);
  assert.ok(!list.some((s) => s.id.startsWith('popup_') && /site\.test\/(a|b)$/.test(s.url)), 'a session window was also adopted as a popup');
});

test('isolated sessions: one extra Chrome at most, with the main login, untouched by a main restart, closed when done', async (t) => {
  const { d, ready, context } = await world(t);
  await context.addCookies([{ name: 'sid', value: 'logged-in', domain: 'site.test', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  let starts = 0, stops = 0;
  const iso = await chromium.launch(browserOptions());
  t.after(() => iso.close());
  d.isolatedLauncher = { start: async () => {
    starts++; const ctx = await iso.newContext(); await route(ctx);
    return { context: ctx, info: { cdpPort: 2 }, stop: async () => { stops++; await ctx.close(); } };
  } };
  const call = await ready();
  const [x, y] = await Promise.all([call('session.open', { url: 'https://site.test/x', isolated: true }), call('session.open', { url: 'https://site.test/y', isolated: true })]);
  assert.equal(starts, 1, 'two isolated sessions share one extra Chrome');
  assert.ok(x.id.startsWith('iso_') && y.id.startsWith('iso_'));
  assert.ok(x.isolated.cookiesCopied >= 1); assert.match(x.isolated.note, /not kept/);
  const isoPage = d.sessions.get(x.id);
  const cookies = await isoPage.context().cookies('https://site.test/');
  assert.equal(cookies.find((k) => k.name === 'sid')?.value, 'logged-in', 'the isolated Chrome starts signed in');
  assert.notEqual(isoPage.context(), context);
  // A main-Chrome restart rebinds main sessions only.
  await d.sessions.rebindContext(context);
  assert.equal((await call('page.extract', { sessionId: x.id, locator: { css: 'h1' }, read: 'text' })).value, '/x');
  const status = await call('browser.status', {});
  assert.equal(status.isolated.running, true);
  await call('session.close', { sessionId: x.id }); await call('session.close', { sessionId: y.id });
  assert.ok(status.activity && typeof status.activity.sessionsRunning === 'number');
  assert.equal(await d.isolatedPool.stopIfIdle(true), true); assert.equal(stops, 1);
  assert.equal((await call('browser.status', {})).isolated.running, false);
});
