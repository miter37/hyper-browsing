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
import { runTool } from '../scripts/mcp-tools.mjs';
import { readOnlyProblem } from '../src/runtime/page-script.ts';
import { browserOptions } from './browser-options.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A grid drawn elsewhere (canvas-style): rows are display:contents, cells have no size, and a responsive
// short label is display:none. An aria-hidden row is decoration. An empty, unnamed selection column leads.
const GRID = `<style>.cell{width:0;height:0;overflow:hidden;position:absolute}.row{display:contents}.short{display:none}</style>
<div role="grid" aria-label="Screener results" style="width:600px;height:80px">
  <div role="rowgroup"><div role="row" class="row">
    <div role="columnheader" class="cell"></div><div role="columnheader" class="cell">Ticker</div>
    <div role="columnheader" class="cell">Market Cap<span class="short">Mkt Cap</span></div><div role="columnheader" class="cell">Change</div></div>
  <div class="body">
    ${[['AAA', '114.88B', '0.30%'], ['BBB', '71.31B', '1.33%'], ['CCC', '9.88B', '-4.15%'], ['DDD', '450M', '2%'], ['EEE', '1.2T', '(3.5)']]
      .map(([t, c, ch]) => `<div role="row" class="row"><div role="gridcell" class="cell"><button aria-label="Flag"></button></div><div role="gridcell" class="cell"><a href="/q?t=${t}">${t}</a></div><div role="gridcell" class="cell">${c}</div><div role="gridcell" class="cell">${ch}</div></div>`).join('')}
    <div role="row" class="row" aria-hidden="true"><div role="gridcell" class="cell"></div><div role="gridcell" class="cell">ZZZ</div><div role="gridcell" class="cell">1T</div><div role="gridcell" class="cell">0</div></div>
  </div></div>
</div><canvas width="600" height="80"></canvas>`;

const TABLES = `<table><tr><td>layout</td></tr></table>
<table id="news"><thead><tr><th>Headline</th><th>Time</th></tr></thead><tbody><tr><td>One</td><td>9:00</td></tr><tr><td>Two</td><td>9:30</td></tr></tbody></table>
<table id="trades"><thead><tr><th>Owner</th><th>Transaction</th><th>Value ($)</th></tr></thead><tbody>
${Array.from({ length: 120 }, (_, i) => `<tr><td><a href="/o/${i}">Owner ${i}</a></td><td>${i % 3 ? 'Sale' : 'Buy'}</td><td>${(i * 25000).toLocaleString('en-US')}</td></tr>`).join('')}
</tbody></table>`;

async function world(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-bulk-'));
  const c = { ...getConfig(), root: ROOT, runtimeDir: path.join(root, '.runtime'), sitesDir: path.join(root, 'sites'), generatedDir: path.join(root, '.generated'), profileDir: path.join(root, 'profile') };
  await fs.mkdir(path.join(c.runtimeDir, 'metrics'), { recursive: true });
  process.env.WEBAGENT_RUNTIME_DIR = c.runtimeDir;
  const browser = await chromium.launch(browserOptions());
  const context = await browser.newContext();
  await context.route('https://site.test/**', async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/rows') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { rows: [{ id: 1, name: 'alpha', value: 10 }, { id: 2, name: 'beta', value: 20 }, { id: 3, name: 'alphabet', value: 30 }] } }) });
    if (u.pathname === '/frame') return r.fulfill({ contentType: 'text/html', body: '<p>widget</p>' });
    const pages = {
      '/grid': GRID,
      '/tables': TABLES,
      '/data': `<script type="application/json" id="boot">{"user":{"plan":"free"},"items":[1,2,3]}</script>
        <h1>data</h1><script>fetch('/api/rows').then(r=>r.json()).then(j=>document.querySelector('h1').textContent='loaded '+j.data.rows.length); fetch('https://tracker.test/collect').catch(()=>{});</script>`,
      '/long': `<article id="a">${'word '.repeat(4000)}END</article>`,
      '/frames': `<iframe name="content" src="https://site.test/frame" width="500" height="300"></iframe>
        <iframe src="https://securepubads.g.doubleclick.net/gampad/ads?x=1" width="300" height="250"></iframe>
        <iframe src="https://cdn.other.test/creative.html" width="728" height="90"></iframe>`,
    };
    return r.fulfill({ contentType: 'text/html', body: `<html><body>${pages[u.pathname] || '<h1>site</h1>'}</body></html>` });
  });
  await context.route('https://tracker.test/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"tracked":true}' }));
  await context.route('https://securepubads.g.doubleclick.net/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>ad</p>' }));
  await context.route('https://cdn.other.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>banner</p>' }));
  await context.newPage();
  const d = new BrowserDaemon({ ...c, port: 0 });
  d.chrome = { start: async () => ({ context }), ensureConnected: async () => context, getState: () => ({}), stop: async () => {}, connected: () => true,
    repair: async () => ({ context, state: {}, takeover: {} }) };
  t.after(async () => { await d.stop().catch(() => {}); await browser.close(); await fs.rm(root, { recursive: true, force: true }); delete process.env.WEBAGENT_RUNTIME_DIR; });
  await d.start();
  const endpoint = `http://127.0.0.1:${d.server.address().port}`;
  const token = (await fs.readFile(path.join(c.runtimeDir, 'browserd.token'), 'utf8')).trim();
  const call = async (method, params = {}) => {
    const r = await postRpc({ endpoint, token, method, params });
    if (r.rpcOk === false && r.result?.error) throw new Error(r.result.error);
    return r.result;
  };
  return { call, tool: (name, args) => runTool(name, args, call) };
}
const rows = (r) => r.tsv.split('\n');

test('read_table reads a grid whose cells have no size, filters numbers in the page and pages', async (t) => {
  const { tool } = await world(t);
  const { sessionId } = await tool('session_open', { url: 'https://site.test/grid' });
  const all = await tool('read_table', { sessionId });
  assert.equal(all.found, true, JSON.stringify(all));
  assert.equal(all.table.label, 'Screener results');
  assert.equal(rows(all)[0], 'Ticker\tMarket Cap\tChange', 'hidden short label and empty unnamed column are left out');
  assert.equal(all.matchedRows, 5, 'the aria-hidden row is not data');
  const big = await tool('read_table', { sessionId, columns: ['Ticker'], where: [{ column: 'market cap', op: '>=', value: '10B' }] });
  assert.deepEqual(rows(big).slice(1), ['AAA', 'BBB', 'EEE']);
  const neg = await tool('read_table', { sessionId, columns: ['Ticker'], where: [{ column: 'Change', op: '<', value: 0 }] });
  assert.deepEqual(rows(neg).slice(1), ['CCC', 'EEE'], '-4.15% and (3.5) are negative numbers');
  const page1 = await tool('read_table', { sessionId, limit: 2, links: true });
  assert.equal(page1.returned, 2); assert.equal(page1.nextOffset, 2);
  assert.match(rows(page1)[1], /\thttps:\/\/site\.test\/q\?t=AAA$/);
  const page2 = await tool('read_table', { sessionId, limit: 2, offset: page1.nextOffset });
  assert.match(rows(page2)[1], /^CCC/);
  const bad = await tool('read_table', { sessionId, where: [{ column: 'Nope', op: '=', value: 1 }] });
  assert.equal(bad.reason, 'unknown_column');
});

test('read_table picks a table by its columns, skips layout tables and returns many rows in one read', async (t) => {
  const { tool } = await world(t);
  const { sessionId } = await tool('session_open', { url: 'https://site.test/tables' });
  const largest = await tool('read_table', { sessionId, limit: 500 });
  assert.equal(largest.table.totalRows, 120);
  assert.equal(largest.returned, 120, 'a whole 120-row table fits in one read');
  const news = await tool('read_table', { sessionId, query: 'headline' });
  assert.deepEqual(rows(news), ['Headline\tTime', 'One\t9:00', 'Two\t9:30']);
  assert.ok(!news.otherTables.some((x) => x.columns.length === 0 && x.rows === 1 && x.label === undefined && x.index === undefined), 'listing is well formed');
  const buys = await tool('read_table', { sessionId, query: 'value', where: [{ column: 'Transaction', op: '=', value: 'Buy' }, { column: 'Value', op: '>=', value: 2000000 }] });
  assert.equal(buys.matchedRows, 13, 'i % 3 === 0 and i >= 80 among 0..119');
  assert.ok(rows(buys).slice(1).every((r) => r.split('\t')[1] === 'Buy'));
});

test('run_script reads in one call and refuses anything that could change the page or the site', async (t) => {
  const { tool } = await world(t);
  const { sessionId } = await tool('session_open', { url: 'https://site.test/tables' });
  const r = await tool('run_script', { sessionId, source: "return [...document.querySelectorAll('#trades tbody tr')].filter(tr => tr.cells[1].innerText === 'Buy').length" });
  assert.deepEqual([r.ok, r.value], [true, 40]);
  const expr = await tool('run_script', { sessionId, source: "document.querySelector('#news th').innerText" });
  assert.equal(expr.value, 'Headline');
  const read = await tool('run_script', { sessionId, source: "const html = await (await fetch('/tables')).text(); return html.includes('trades')" });
  assert.equal(read.value, true, 'a same-site GET fetch is a read');
  for (const source of [
    "document.querySelector('a').click()",
    "fetch('/api', { method: 'POST', body: 'x' })",
    "const o = {}; o.method = 'DELETE'; return fetch('/x', o)",
    "eval('1')",
    "document.body.appendChild(document.createElement('div'))",
    "document.querySelector('h1').style.color = 'red'",
    "location.href = 'https://evil.test'",
    "localStorage.setItem('a', 1)",
    "document.querySelector('a')['cli' + 'ck']()",
    "history.pushState({}, '', '/x')",
  ]) {
    const refused = await tool('run_script', { sessionId, source });
    assert.equal(refused.reason, 'not_read_only', source);
    assert.equal(refused.execution, 'not_started');
  }
  assert.equal(readOnlyProblem("const s = el.style.display === 'none'; return s"), undefined, 'a comparison is not an assignment');
  assert.equal(readOnlyProblem("return [...document.querySelectorAll('td')].map(td => td.innerText.replace(/\\s+/g, ' '))"), undefined);
  const long = await tool('run_script', { sessionId, source: "return 'x'.repeat(50000)" });
  assert.ok(long.nextOffset > 0 && long.value.length <= 15000);
  const rest = await tool('run_script', { sessionId, source: "return 'x'.repeat(50000)", offset: long.nextOffset });
  assert.equal(rest.offset, long.nextOffset);
});

test('page_data lists and reads the JSON the page loaded from its own site and embedded, not trackers', async (t) => {
  const { tool, call } = await world(t);
  const { sessionId } = await tool('session_open', { url: 'https://site.test/data' });
  await call('page.waitFor', { sessionId, text: 'loaded 3' });
  const list = await tool('page_data', { sessionId });
  const net = list.sources.filter((s) => s.origin === 'network');
  assert.equal(net.length, 1, 'only the first-party call is recorded: ' + JSON.stringify(list.sources));
  assert.match(net[0].url, /\/api\/rows$/);
  assert.deepEqual(net[0].shape.keys, ['data']);
  assert.ok(list.sources.some((s) => s.origin === 'embedded' && s.shape.keys.includes('items')));
  const items = await tool('page_data', { sessionId, source: net[0].source, path: 'data.rows', query: 'alpha' });
  assert.deepEqual(items.items.map((x) => x.name), ['alpha', 'alphabet']);
  const paged = await tool('page_data', { sessionId, source: net[0].source, path: 'data.rows', limit: 1, offset: 1 });
  assert.deepEqual([paged.items[0].id, paged.nextOffset, paged.total], [2, 2, 3]);
});

test('read_text reads long text in parts; snapshot lists content frames and only counts ad frames', async (t) => {
  const { tool } = await world(t);
  const { sessionId } = await tool('session_open', { url: 'https://site.test/long' });
  const first = await tool('read_text', { sessionId, locator: { css: '#a' } });
  assert.ok(first.totalLength > 20000 && first.nextOffset === first.value.length);
  let offset = first.nextOffset, last = first;
  while (last.nextOffset) { last = await tool('read_text', { sessionId, locator: { css: '#a' }, offset }); offset = last.nextOffset; }
  assert.ok(last.value.endsWith('END'));
  await tool('navigate', { sessionId, url: 'https://site.test/frames' });
  const snap = await tool('snapshot', { sessionId });
  assert.deepEqual(snap.snapshot.frames.map((f) => f.frame), ['content']);
  assert.equal(snap.snapshot.adFrames, 2, 'an ad-server frame and a third-party banner-sized frame');
});
