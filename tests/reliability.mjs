import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { interpolate, interpolateUrl } from '../src/utils/strings.ts';
import { siteIdFromHost } from '../src/runtime/learning.ts';
import { locatorFor } from '../src/engine/locators.ts';
import { evaluateCondition } from '../src/engine/conditions.ts';
import { executePrimitive } from '../src/engine/execute.ts';
import { SessionStore } from '../src/browserd/session-store.ts';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { loadSite } from '../src/engine/site-loader.ts';
import { scanActionFile } from '../src/security/action-scan.ts';

async function fixture(t, html) {
  const browser = await chromium.launch(browserOptions());
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  await page.goto('https://example.test/');
  t.after(() => browser.close());
  return { page, context, browser };
}

test('double-brace and legacy templates resolve without stray braces; URL values are components', () => {
  assert.equal(interpolate('{{min_price}}-{legacy}', { min_price: 1000, legacy: 'ok' }), '1000-ok');
  assert.equal(interpolateUrl('https://example.test/s/{{place}}?q={{query}}', { place: 'Seoul/Mapo', query: 'a & b' }),
    'https://example.test/s/Seoul%2FMapo?q=a%20%26%20b');
  assert.throws(() => interpolate('{{missing}}', {}), /Missing variable: missing/);
});

test('host IDs no longer collide on multi-label public suffixes', () => {
  assert.equal(siteIdFromHost('www.naver.co.kr'), 'naver');
  assert.equal(siteIdFromHost('foo.example.co.uk'), 'example');
  assert.equal(siteIdFromHost('shop.example.com.au'), 'example');
  assert.notEqual(siteIdFromHost('alpha.co.kr'), siteIdFromHost('beta.co.kr'));
  assert.equal(siteIdFromHost('foo.bar.unknown'), 'foo_bar_unknown');
});

test('saved locators bind literal text without constructing executable CSS', async t => {
  const { page } = await fixture(t, '<a class="item_link">Bridge & Tower</a><a class="item_link">Other</a>');
  const site = { elements: { result: { strategies: [{ css: 'a.item_link', hasText: '{{complexName}}' }] } } };
  const target = await locatorFor(page, site, 'result', { complexName: 'Bridge & Tower' });
  assert.equal(await target.count(), 1);
  assert.equal(await target.innerText(), 'Bridge & Tower');
  assert.equal(await evaluateCondition(page, site, { type: 'element_visible', element: 'result' }, { complexName: 'Bridge & Tower' }), true);
  await assert.rejects(locatorFor(page, site, 'result', {}), /Missing variable/);
  await assert.rejects(locatorFor(page, { elements: { bad: { strategies: [{ css: 'a:has-text("{{name}}")' }] } } }, 'bad', {name:'hi'}), /Do not interpolate CSS/);
});

test('unknown form submissions and real purchase/reservation buttons require confirmation', async t => {
  const { page } = await fixture(t, '<form onsubmit="event.preventDefault();window.done=1"><button id="confirm">Continue</button></form>');
  let result = await executePrimitive(page, 'click', { locator: { css: '#confirm' } });
  assert.equal(result.confirmationRequired, true);
  assert.equal(result.risk, 'unclassified');
  assert.equal(await page.evaluate(() => window.done || 0), 0);
  await page.setContent('<button onclick="window.done=1">Place order</button>');
  result = await executePrimitive(page, 'click', { locator: { role: 'button', name: 'Place order' } });
  assert.equal(result.risk, 'external_write');
  assert.equal(result.execution, 'not_started');
  await page.setContent('<button onclick="window.done=1">Confirm reservation</button>');
  result = await executePrimitive(page, 'click', { locator: { role: 'button', name: 'Confirm reservation' } });
  assert.equal(result.confirmationRequired, true);
  await page.setContent('<form role="search" onsubmit="event.preventDefault()"><input type="search"><button>Search</button></form>');
  result = await executePrimitive(page, 'click', { locator: { role: 'button', name: 'Search' } });
  assert.equal(result.confirmationRequired, undefined);
});

test('context rebinding does not navigate unrelated existing tabs', async t => {
  const { page, context, browser } = await fixture(t, '<h1>Test</h1>');
  const store = new SessionStore(context);
  await store.adoptExisting();
  const original = (await store.list())[0];
  const second = await browser.newContext();
  await second.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Other</h1>' }));
  const unrelated = await second.newPage();
  await unrelated.goto('https://other.test/');
  await store.rebindContext(second);
  assert.equal(unrelated.url(), 'https://other.test/');
  assert.equal(store.get(original.id).url(), 'https://example.test/');
  assert.notEqual(store.get(original.id), unrelated);
  assert.ok((await store.list()).some(s => s.url === 'https://other.test/'));
});

test('unsafe eval is off by default, and still requires explicit confirmation when enabled', async t => {
  const { context } = await fixture(t, '<h1>Safe</h1>');
  const store = new SessionStore(context);
  await store.adoptExisting();
  const sessionId = (await store.list())[0].id;
  const config = { allowUnsafeEval: false, learningDisabled: true };
  const daemon = new BrowserDaemon(config);
  daemon.sessions = store;
  daemon.context = context;
  daemon.chrome.ensureConnected = async () => context;
  const denied = await daemon.dispatchUnlocked('page.evaluate', {sessionId,expression:'1+2'});
  assert.equal(denied.reason, 'unsafe_eval_disabled');
  config.allowUnsafeEval = true;
  const unconfirmed = await daemon.dispatchUnlocked('page.evaluate', {sessionId,expression:'1+2'});
  assert.equal(unconfirmed.confirmationRequired, true);
  const allowed = await daemon.dispatchUnlocked('page.evaluate', {sessionId,expression:'1+2',confirmed:true});
  assert.equal(allowed, 3);
});

test('network listeners are detached when sessions close', async t => {
  const { context } = await fixture(t, '<h1>Network</h1>');
  const store = new SessionStore(context);
  await store.adoptExisting();
  const sessionId = (await store.list())[0].id;
  const config = { learningDisabled: true };
  const daemon = new BrowserDaemon(config);
  daemon.sessions = store;
  daemon.context = context;
  daemon.chrome.ensureConnected = async () => context;
  const started = await daemon.dispatchUnlocked('network.start', {sessionId});
  assert.equal(started.started, true);
  assert.equal(daemon.networkListeners.size, 1);
  await daemon.dispatchUnlocked('session.close', {sessionId});
  assert.equal(daemon.networkListeners.size, 0);
  assert.equal(daemon.networkLogs.size, 0);
});

test('path traversal and computed environment access are rejected', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-security-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const config = { root, sitesDir: path.join(root, 'sites') };
  await fs.mkdir(config.sitesDir);
  await assert.rejects(loadSite(config, '../outside'), /outside sites directory/);
  const file = path.join(root, 'actions.ts');
  await fs.writeFile(file, 'const token = process["env"].TOKEN;');
  await assert.rejects(scanActionFile(file), /computed process access/);
});
