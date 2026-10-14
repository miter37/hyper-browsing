import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { referencesFor } from '../src/runtime/references.ts';
import { executePrimitive } from '../src/engine/execute.ts';
import { runBatch } from '../src/engine/batch.ts';
import { runKnownAction } from '../src/engine/action-runner.ts';
import { loadSite } from '../src/engine/site-loader.ts';
import { getConfig } from '../src/config.ts';
import YAML from 'yaml';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { postRpc } from '../scripts/rpc-transport.mjs';
import { browserOptions } from './browser-options.mjs';

async function fixture(t, html='<h1>Example</h1>') {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-execute-'));
  const c={...getConfig(),root,runtimeDir:path.join(root,'.runtime'),sitesDir:path.join(root,'sites'),generatedDir:path.join(root,'.generated'),profileDir:path.join(root,'profile')};
  await fs.mkdir(path.join(c.runtimeDir,'metrics'),{recursive:true});
  const browser=await chromium.launch(browserOptions());
  const context=await browser.newContext();await context.route('https://example.test/**',r=>r.fulfill({contentType:'text/html',body:html}));
  const page=await context.newPage();await page.goto('https://example.test/');
  t.after(async()=>{await browser.close();await fs.rm(root,{recursive:true,force:true});});
  return {c,page};
}
test('references pin observed elements across reordering and invalidate replacements',async t=>{
  const {page}=await fixture(t,'<button id="a" onclick="window.clicked=\'a\'">Same</button><button id="b" onclick="window.clicked=\'b\'">Same</button>');
  const snap=await captureSnapshot(page,{references:referencesFor(page)});
  assert.ok(snap.elements[0].ref); const ref=snap.elements[0].ref;
  await page.evaluate(()=>document.body.append(document.querySelector('#a')));
  const clicked=await executePrimitive(page,'click',{ref});assert.equal(clicked.ok,true);
  assert.equal(await page.evaluate(()=>window.clicked),'a');
  await page.evaluate(()=>document.querySelector('#a').outerHTML='<button id="a" onclick="window.clicked=\'replacement\'">Same</button>');
  const stale=await executePrimitive(page,'click',{ref});assert.equal(stale.reason,'stale_ref');
  assert.equal(await page.evaluate(()=>window.clicked),'a');
});
test('references reject semantic recycling, cross-page use and document navigation',async t=>{
  const {page}=await fixture(t,'<button>First</button>');
  const snap=await captureSnapshot(page,{references:referencesFor(page)});const ref=snap.elements[0].ref;
  await page.evaluate(()=>document.querySelector('button').textContent='Different');
  assert.equal((await executePrimitive(page,'click',{ref})).reason,'stale_ref');
  const other=await page.context().newPage();await other.goto('https://example.test/');
  await captureSnapshot(other,{references:referencesFor(other)});
  assert.equal((await executePrimitive(other,'click',{ref})).reason,'stale_ref');
  await page.goto('https://example.test/next');
  assert.equal((await executePrimitive(page,'click',{ref})).reason,'stale_ref');
});
test('saved declarative actions refuse ambiguous elements without clicking',async t=>{
  const {c,page}=await fixture(t,'<button onclick="window.clicked=1">Choose</button><button onclick="window.clicked=2">Choose</button>');
  const dir=path.join(c.sitesDir,'example');await fs.mkdir(dir,{recursive:true});
  const doc={site:{id:'example'},match:{hosts:['example.test']},elements:{choose:{strategies:[{role:'button',name:'Choose'}]}},actions:{choose:{risk:'read',implementation:{kind:'declarative',steps:[{op:'click',element:'choose'}]},verify:[{type:'url_matches',pattern:'https://example.test/'}]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),YAML.stringify(doc));
  const result=await runKnownAction(c,page,await loadSite(c,'example'),{sessionId:'s',actionId:'choose',input:{}});
  assert.equal(result.ok,false);assert.equal(result.steps[0].reason,'ambiguous');
  assert.equal(await page.evaluate(()=>window.clicked||0),0);
});
test('references reject recycled row identity and external accessible-name changes',async t=>{
  const {page}=await fixture(t,'<article data-id="first"><h2>First item</h2><button onclick="window.clicked=1">Open</button></article><span id="label">First label</span><input aria-labelledby="label">');
  const snap=await captureSnapshot(page,{references:referencesFor(page)});
  const button=snap.elements.find(e=>e.name==='Open').ref;
  const input=snap.elements.find(e=>e.tag==='input').ref;
  await page.evaluate(()=>{document.querySelector('h2').textContent='Second item';document.querySelector('article').dataset.id='second';document.querySelector('#label').textContent='Second label';});
  assert.equal((await executePrimitive(page,'click',{ref:button})).reason,'stale_ref');
  assert.equal((await executePrimitive(page,'fill',{ref:input,value:'wrong'})).reason,'stale_ref');
  assert.equal(await page.evaluate(()=>window.clicked||0),0);
});
test('an already satisfied postcondition cannot certify a blocked saved write',async t=>{
  const {c,page}=await fixture(t,'<h1>Already saved</h1><button>Choose</button><button>Choose</button>');
  const dir=path.join(c.sitesDir,'example');await fs.mkdir(dir,{recursive:true});
  const doc={site:{id:'example'},match:{hosts:['example.test']},elements:{choose:{strategies:[{role:'button',name:'Choose'}]}},actions:{save:{risk:'external_write',implementation:{kind:'declarative',steps:[{op:'click',element:'choose'}]},verify:[{type:'url_matches',pattern:'https://example.test/'}]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),YAML.stringify(doc));
  const result=await runKnownAction(c,page,await loadSite(c,'example'),{sessionId:'s',actionId:'save',input:{},confirmed:true});
  assert.equal(result.ok,false);assert.equal(result.execution,'not_started');assert.equal(result.promotion,undefined);
});
test('batch stops at an ambiguous input and does not fill later fields or create assets',async t=>{
  const {c,page}=await fixture(t,'<label>First<input id="first"></label><input placeholder="Duplicate"><input placeholder="Duplicate"><input id="last">');
  const result=await runBatch(page,{commands:[{op:'fill',locator:{label:'First'},value:'ok'},{op:'fill',locator:{placeholder:'Duplicate'},value:'bad'},{op:'fill',locator:{css:'#last'},value:'never'}]});
  assert.equal(result.ok,false);assert.equal(result.stoppedAt,1);assert.equal(result.results[0].execution,'completed');
  assert.equal(await page.locator('#first').inputValue(),'ok');assert.equal(await page.locator('#last').inputValue(),'');
  assert.equal(await fs.stat(c.sitesDir).then(()=>true,()=>false),false);
});
test('batch preflight rejects submit and non-input commands before any mutation',async t=>{
  const {page}=await fixture(t,'<input id="first">');
  await assert.rejects(runBatch(page,{commands:[{op:'fill',locator:{css:'#first'},value:'bad',submit:true}]}));
  await assert.rejects(runBatch(page,{commands:[{op:'fill',locator:{css:'#first'},value:'bad'},{op:'click',locator:{css:'button'}}]}));
  assert.equal(await page.locator('#first').inputValue(),'');
});
test('actual daemon exposes refs, batch, compact details and duplicate-request protection',async t=>{
  const {c,page}=await fixture(t,'<label>Name<input id="name"></label><button onclick="window.count=(window.count||0)+1">Count</button>');
  const daemon=new BrowserDaemon({...c,port:0});
  daemon.chrome={start:async()=>({context:page.context()}),ensureConnected:async()=>page.context(),getState:()=>({}),stop:async()=>{}};
  await daemon.start();t.after(()=>daemon.stop());
  const endpoint=`http://127.0.0.1:${daemon.server.address().port}`;const token=await fs.readFile(path.join(c.runtimeDir,'browserd.token'),'utf8');
  const sessions=await daemon.sessions.list();const sessionId=sessions[0].id;
  const call=(method,params={},requestId)=>postRpc({endpoint,token:token.trim(),method,params:{sessionId,...params},requestId});
  const snap=(await call('page.snapshot')).result.snapshot;
  const hwm=(await call('page.snapshot',{format:'hwm'})).result;
  assert.ok(hwm.hwm?.startsWith('@hwm '));assert.ok(hwm.hwm.includes('document'));assert.equal(hwm.snapshot,undefined);assert.ok(snap.contextGraph);
  const input=snap.elements.find(e=>e.name==='Name');const button=snap.elements.find(e=>e.name==='Count');
  assert.ok(input.ref);assert.ok(button.ref);
  const batch=(await call('batch.run',{input:{commands:[{op:'fill',ref:input.ref,value:'Alice'}]}})).result;
  assert.equal(batch.ok,true);assert.equal(batch.results[0].value,'Alice');
  const id='duplicate-click';
  await Promise.all([call('page.click',{ref:button.ref},id),call('page.click',{ref:button.ref},id)]);
  assert.equal(await page.evaluate(()=>window.count),1);
  const details=(await call('request.status',{requestId:id,verbose:true})).result;
  assert.equal(details.state,'completed');assert.equal(details.result.execution,'completed');
});
test('batch stops when a fill changes the page structure and when readback mismatches',async t=>{
  const {page}=await fixture(t,'<input id="first" oninput="document.querySelector(\'#last\').remove()"><input id="last">');
  let result=await runBatch(page,{commands:[{op:'fill',locator:{css:'#first'},value:'a'},{op:'fill',locator:{css:'#last'},value:'b'}]});
  assert.equal(result.ok,false);assert.equal(result.stoppedAt,0);assert.equal(result.reason,'observation_required');
  await page.setContent('<input id="first" oninput="this.value=\'REJECTED\'"><input id="last">');
  result=await runBatch(page,{commands:[{op:'fill',locator:{css:'#first'},value:'a'},{op:'fill',locator:{css:'#last'},value:'b'}]});
  assert.equal(result.reason,'value_mismatch');assert.equal(await page.locator('#last').inputValue(),'');
});
test('native select rejects duplicate option labels before selection',async t=>{
  const {page}=await fixture(t,'<select><option>Initial</option><option value="a">Duplicate</option><option value="b">Duplicate</option></select>');
  const result=await executePrimitive(page,'select',{locator:{css:'select'},option:'Duplicate'});
  assert.equal(result.ok,false);assert.equal(await page.locator('select').inputValue(),'Initial');
});

