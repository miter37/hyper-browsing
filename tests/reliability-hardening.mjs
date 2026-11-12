import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { interpolate, interpolateUrl } from '../src/utils/strings.ts';
import { siteIdFromHost } from '../src/runtime/learning.ts';
import { materializeElement, resolveElement } from '../src/engine/locators.ts';
import { executePrimitive } from '../src/engine/execute.ts';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { SessionStore } from '../src/browserd/session-store.ts';
import { scanActionFile } from '../src/security/action-scan.ts';
import { loadSite } from '../src/engine/site-loader.ts';
import { runKnownAction } from '../src/engine/action-runner.ts';
import { getConfig } from '../src/config.ts';

async function fixture(t, html) {
  const browser = await chromium.launch(browserOptions());
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  await page.goto('https://example.test/');
  t.after(() => browser.close());
  return { context, page };
}

test('single and double-braced templates interpolate exactly once, URLs encode components', () => {
  assert.equal(interpolate('x={{name}}&y={name}', { name: 'O Hara' }), 'x=O Hara&y=O Hara');
  assert.equal(interpolateUrl('https://example.test/s/{{name}}?q={{name}}', { name: 'a/b &c' }),
    'https://example.test/s/a%2Fb%20%26c?q=a%2Fb%20%26c');
  assert.throws(() => interpolate('{{missing}}', {}), /Missing variable: missing/);
});

test('new learning IDs are hostname-scoped even for multi-label public suffixes', () => {
  assert.equal(siteIdFromHost('www.naver.co.kr'), 'naver_co_kr');
  assert.equal(siteIdFromHost('example.co.uk'), 'example_co_uk');
  assert.equal(siteIdFromHost('foo.com.au'), 'foo_com_au');
  assert.notEqual(siteIdFromHost('example.co.uk'), siteIdFromHost('another.co.uk'));
});

test('dynamic CSS locator substitutes input and escapes embedded CSS quotes', async t => {
  const { page } = await fixture(t, '<button class="item_link">O\'Hara (1)</button>');
  const element = { strategies: [{ css: "button.item_link:has-text('{{name}}')" }] };
  const mapped = materializeElement(element, { name: "O'Hara (1)" });
  assert.match(mapped.strategies[0].css, /O\\'Hara/);
  assert.equal(await (await resolveElement(page, mapped)).count(), 1);
  assert.throws(() => materializeElement({strategies:[{css:'button.{{name}}'}]}, {name:'.x'}), /quoted strings/);
});

test('declarative actions propagate input into dynamic locators and verification', async t => {
  const { page } = await fixture(t, '<button class="item_link" onclick="document.querySelector(\'#done\').textContent=\'yes\'">O\'Hara</button><span id="done">no</span>');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-template-'));
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  const c = {...getConfig(),root,runtimeDir:path.join(root,'.runtime'),sitesDir:path.join(root,'sites')};
  const dir = path.join(c.sitesDir, 'example');
  await fs.mkdir(dir,{recursive:true});
  const doc = {
    site:{id:'example'}, match:{hosts:['example.test']},
    elements:{choose:{strategies:[{css:"button.item_link:has-text('{{complexName}}')"}]},done:{strategies:[{css:'#done'}]}},
    extractors:{check:{element:'done',read:'text'}},
    actions:{pick:{risk:'read',implementation:{kind:'declarative',steps:[{op:'click',element:'choose'}]},
      verify:[{type:'extractor_equals',extractor:'check',value:'yes'}]}}
  };
  await fs.writeFile(path.join(dir,'site.yaml'),JSON.stringify(doc));
  const result = await runKnownAction(c,page,await loadSite(c,'example'),
    {sessionId:'test_session',actionId:'pick',input:{complexName:"O'Hara"}});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(await page.locator('#done').innerText(),'yes');
});

test('buttons with write semantics and unlabeled non-search submits demand confirmation',async t => {
  const {page}=await fixture(t,`<button id="order" onclick="window.done=1">Place order</button>
    <button id="booking" onclick="window.done=1">Confirm reservation</button>
    <button id="follow" onclick="window.done=1">Follow</button>
    <form onsubmit="event.preventDefault(); window.done=1"><button id="continue">Continue</button></form>
    <form onsubmit="event.preventDefault()"><input type="search" name="q"><button id="search">Search</button></form>`);
  for (const id of ['order','booking','follow','continue']) {
    const result=await executePrimitive(page,'click',{locator:{css:'#'+id}});
    assert.equal(result.confirmationRequired,true,id);
    assert.equal(result.execution,'not_started',id);
    assert.equal(await page.evaluate(()=>window.done||0),0,id);
  }
  const search=await executePrimitive(page,'click',{locator:{css:'#search'}});
  assert.equal(search.confirmationRequired,undefined);
});

test('raw evaluation requires explicit confirmation at RPC dispatch', async () => {
  const daemon=new BrowserDaemon(getConfig());
  let calls=0;
  const page={evaluate:async()=>{calls++;return 42;}};
  const context={};
  daemon.context=context;
  daemon.chrome={ensureConnected:async()=>context};
  daemon.sessions={get:()=>page};
  const denied=await daemon.dispatchUnlocked('page.evaluate',{sessionId:'s',expression:'document.title'});
  assert.equal(denied.confirmationRequired,true);
  assert.equal(calls,0);
  assert.equal(await daemon.dispatchUnlocked('page.evaluate',{sessionId:'s',expression:'document.title',confirmed:true}),42);
  assert.equal(calls,1);
});

test('security scan rejects computed process access and dynamic modules', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-action-scan-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'actions.ts');
  for(const source of ["process['env'].SECRET", "await import('node:fs')", "Function('return 1')()"]) {
    await fs.writeFile(file,source);
    await assert.rejects(scanActionFile(file),/Security scan rejected/);
  }
});

test('code actions require consent even when their metadata declares read-only',async t => {
  const { page } = await fixture(t, '<h1>Ready</h1>');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-code-action-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const c = {...getConfig(),root,runtimeDir:path.join(root,'.runtime'),sitesDir:path.join(root,'sites')};
  const dir = path.join(c.sitesDir, 'example');
  await fs.mkdir(dir,{recursive:true});
  const doc = {site:{id:'example'},match:{hosts:['example.test']},
    actions:{unsafe:{risk:'read',implementation:{kind:'code',export:'unsafe'},verify:[]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),JSON.stringify(doc));
  const result=await runKnownAction(c,page,await loadSite(c,'example'),
    {sessionId:'code_test',actionId:'unsafe',input:{}});
  assert.equal(result.confirmationRequired,true);
  assert.equal(result.risk,'unclassified');
  assert.equal(result.execution,'not_started');
});

test('session restore matches URLs rather than tab position and preserves closed session IDs',async () => {
  const fakePage=(url='about:blank')=>({
    current:url, url(){return this.current;},title:async()=>'',isClosed(){return Boolean(this.closed);},
    closed:false
  });
  const first=fakePage(),second=fakePage();
  const pending=[first,second];
  const store=new SessionStore({on:()=>{},newPage:async()=>pending.shift()});
  const a=await store.open(); const b=await store.open();
  first.current='https://a.test/';second.current='https://b.test/';
  await store.list();
  first.closed=true;second.closed=true;
  const newA=fakePage('https://a.test/'),newB=fakePage('https://b.test/');
  const unrelated=fakePage('https://user.test/');
  await store.rebindContext({on:()=>{},pages:()=>[newB,unrelated,newA],newPage:async()=>{throw Error('unnecessary new page');}});
  assert.strictEqual(store.get(a.id),newA);
  assert.strictEqual(store.get(b.id),newB);
  assert.equal(unrelated.current,'https://user.test/');
});

test('network capture cleanup detaches listeners and drops buffered results', () => {
  const daemon=new BrowserDaemon(getConfig());
  const stopped=[];
  const page={off:(name,cb)=>stopped.push(name)};
  daemon.networkListeners.set('s',{page,request:()=>{},response:()=>{}});
  daemon.networkLogs.set('s',[{type:'request'}]);
  assert.equal(daemon.stopNetworkCapture('s').length,1);
  assert.deepEqual(stopped,['request','response']);
  assert.equal(daemon.networkListeners.size,0);
  assert.equal(daemon.networkLogs.size,0);
});
