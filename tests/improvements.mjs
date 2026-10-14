import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { referencesFor } from '../src/runtime/references.ts';
import { executePrimitive } from '../src/engine/execute.ts';
import { runBatch } from '../src/engine/batch.ts';
import { needsHeadedFallback } from '../src/browserd/headed-fallback.ts';
import { SessionStore } from '../src/browserd/session-store.ts';
import * as verification from '../src/engine/verify.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

async function fixture(t,html){
 const browser=await chromium.launch(browserOptions());
 const context=await browser.newContext();
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));
 const page=await context.newPage();await page.goto('https://example.test/');
 t.after(()=>browser.close());return {page,context};
}

test('damaged DOM children do not discard healthy observed controls',async t=>{
 const {page}=await fixture(t,'<div id="broken">Damaged</div><button>Healthy</button>');
 await page.evaluate(()=>Object.defineProperty(document.querySelector('#broken'),'children',{value:{}}));
 const snap=await captureSnapshot(page,{references:referencesFor(page)});
 assert.ok(snap.elements.some(e=>e.name==='Healthy'));
 assert.equal(snap.observation.complete,false);
 assert.ok(snap.observation.errors.length);
});

test('a missing document returns incomplete observation rather than throwing',async t=>{
 const {page}=await fixture(t,'<button>Healthy</button>');
 await page.evaluate(()=>document.documentElement.remove());
 const snap=await captureSnapshot(page,{references:referencesFor(page)});
 assert.equal(snap.observation.complete,false);
 assert.equal(snap.elements.length,0);
});

test('human challenge dialogs are detected even over a populated page',async t=>{
 const {page}=await fixture(t,'<h1>Shop</h1>'+ '<a href="/item">Item</a>'.repeat(20)+'<div role="dialog">Robot or human? Activate and hold the button to confirm that you are human.</div>');
 const snap=await captureSnapshot(page,{references:referencesFor(page)});
 assert.equal(snap.blocked?.kind,'captcha');
});

test('shell-safe references and legacy aliases operate the same pinned element',async t=>{
 const {page}=await fixture(t,'<input placeholder="Name"><button onclick="window.clicked=1">Observe</button>');
 const snap=await captureSnapshot(page,{references:referencesFor(page)});
 const input=snap.elements.find(e=>e.placeholder==='Name');
 assert.match(input.ref,/^e\d+$/);
 assert.equal((await executePrimitive(page,'fill',{ref:'@'+input.ref,value:'legacy'})).ok,true);
 const result=await runBatch(page,{commands:[{op:'fill',ref:input.ref,value:'canonical'}]});
 assert.equal(result.ok,true);assert.equal(await page.locator('input').inputValue(),'canonical');
});

test('display truncation never becomes the saved semantic locator',async t=>{
 const label='Product '+ 'long name '.repeat(25);
 const {page}=await fixture(t,`<button>${label.trim()}</button>`);
 const refs=referencesFor(page);const snap=await captureSnapshot(page,{references:refs});
 const el=snap.elements.find(e=>e.tag==='button');
 assert.equal(el.nameTruncated,true);assert.ok(el.name.length<=120);
 assert.equal(refs.semanticLocator(el.ref).name,label.trim());
 assert.equal(JSON.stringify(snap).includes('_fullName'),false);
});

test('domain names do not raise risk and site-specific filter hints do not lower it',async t=>{
 const {page}=await fixture(t,'<a href="https://www.bestbuy.com/site/item">Product details</a><div role="group" aria-label="Buying Format"><a href="/search?LH_BIN=1">Buy It Now</a></div>');
 const snap=await captureSnapshot(page,{references:referencesFor(page)});
 const link=snap.elements.find(e=>e.name==='Product details');
 const result=await executePrimitive(page,'click',{ref:link.ref});assert.equal(result.confirmationRequired,undefined);
 await page.goto('https://example.test/');
 const filter=await executePrimitive(page,'click',{locator:{role:'link',name:'Buy It Now',exact:true}});
 assert.equal(filter.confirmationRequired,true);assert.equal(filter.risk,'external_write');assert.equal(filter.execution,'not_started');
});

test('actual purchase buttons cannot bypass confirmation through opaque CSS',async t=>{
 const {page}=await fixture(t,'<button id="opaque" onclick="window.paid=(window.paid||0)+1">Pay now</button>');
 const result=await executePrimitive(page,'click',{locator:{css:'#opaque'}});
 assert.equal(result.confirmationRequired,true);assert.equal(result.execution,'not_started');
 assert.equal(await page.evaluate(()=>window.paid||0),0);
});

test('healthy missing targets do not restart Chrome',()=>{
 assert.equal(needsHeadedFallback('page.click',{ok:false,reason:'no_match',execution:'not_started',pageState:{state:'ready'}}),false);
 assert.equal(needsHeadedFallback('page.snapshot',{pageState:{state:'navigation_error',evidence:'chrome error document'}}),true);
});

test('normal zero results and persistent loading have distinct page states',async t=>{
 const {page}=await fixture(t,'<h1>Search results</h1><p>No results found</p>');
 assert.equal((await captureSnapshot(page)).pageState.state,'ready');
 await page.setContent('<div role="progressbar" aria-busy="true">Loading...</div>');
 assert.equal((await captureSnapshot(page)).pageState.state,'loading');
});

test('popup effects immediately return prepared destination sessions',async t=>{
 const {context}=await fixture(t,'<a href="/destination" target="_blank">Open details</a>');
 const store=new SessionStore(context);
 const parent=await store.open('https://example.test/',{prepare:async p=>p.setViewportSize({width:1440,height:900})});
 const page=store.get(parent.id);
 const result=await executePrimitive(page,'click',{locator:{role:'link',name:'Open details',exact:true}});
 assert.equal(result.effect.newSessions.length,1);
 const dest=result.effect.newSessions[0];assert.ok(dest.sessionId);assert.equal(dest.setupStatus,'ready');
 assert.deepEqual(store.get(dest.sessionId).viewportSize(),{width:1440,height:900});
 assert.equal(page.url(),'https://example.test/');
 assert.ok((await store.list()).some(s=>s.id===dest.sessionId));
});

test('ephemeral verification checks applied dates, filters and zero results without writing',async t=>{
 assert.equal(typeof verification.verifyPage,'function');
 const {page}=await fixture(t,'<input aria-label="Adults" value="2"><label><input type="checkbox" checked>Free cancellation</label><p id="results">0 properties</p>');
 await page.goto('https://example.test/?checkin=2026-11-17');
 const result=await verification.verifyPage(page,{checks:[
  {type:'url_param',name:'checkin',expected:'2026-11-17'},
  {type:'element',target:{locator:{label:'Adults'}},read:'value',op:'equals',expected:'2'},
  {type:'element',target:{locator:{role:'checkbox'}},read:'checked',op:'equals',expected:true},
  {type:'element',target:{locator:{css:'#results'}},read:'text',op:'contains',expected:'0 properties'}
 ]});
 assert.equal(result.outcome,'APPLIED');assert.equal(result.details.length,4);
 const wrong=await verification.verifyPage(page,{checks:[{type:'url_param',name:'checkin',expected:'2026-11-19'},{type:'url_param',name:'checkin',expected:'2026-11-17'}]});
 assert.equal(wrong.outcome,'NOT_APPLIED');assert.equal(wrong.details.length,2);
 assert.equal((await verification.verifyPage(page,{checks:[]})).outcome,'UNKNOWN');
});

test('ambiguous fields and loading pages cannot certify a task',async t=>{
 assert.equal(typeof verification.verifyPage,'function');
 const {page}=await fixture(t,'<button>Duplicate</button><button>Duplicate</button>');
 const spec={checks:[{type:'element',target:{locator:{role:'button',name:'Duplicate'}},read:'text',op:'equals',expected:'Duplicate'}]};
 assert.equal((await verification.verifyPage(page,spec)).outcome,'UNKNOWN');
 await page.setContent('<div role="progressbar">Loading...</div>');
 assert.equal((await verification.verifyPage(page,{checks:[{type:'url_param',name:'x',expected:'1'}]})).outcome,'UNKNOWN');
});

test('missing boolean semantics are unknown instead of false',async t=>{
 const {page}=await fixture(t,'<div id="plain">Ordinary text</div>');
 const result=await verification.verifyPage(page,{checks:[{type:'element',target:{locator:{css:'#plain'}},read:'checked',op:'equals',expected:false}]});
 assert.equal(result.outcome,'UNKNOWN');
});

test('global Enter and fill-submit cannot bypass a payment form confirmation',async t=>{
 const {page}=await fixture(t,'<form onsubmit="event.preventDefault();window.paid=1"><input id="amount"><button type="submit">Pay now</button></form>');
 await page.locator('input').focus();
 const pressed=await executePrimitive(page,'press',{key:'Enter'});
 assert.equal(pressed.confirmationRequired,true);
 const filled=await executePrimitive(page,'fill',{locator:{css:'#amount'},value:'10',submit:true});
 assert.equal(filled.confirmationRequired,true);assert.equal(await page.locator('input').inputValue(),'');
 assert.equal(await page.evaluate(()=>window.paid||0),0);
});

test('PowerShell carries canonical and quoted legacy refs through both CLI surfaces',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-shell-'));const calls=[];
 const server=http.createServer(async(req,res)=>{let data='';for await(const b of req)data+=b;calls.push(JSON.parse(data));res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:{ok:true,execution:'completed'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 await fs.writeFile(path.join(root,'browserd-endpoint.json'),JSON.stringify({port:server.address().port}));await fs.writeFile(path.join(root,'browserd.token'),'fixture-token');
 const env={...process.env,WEBAGENT_RUNTIME_DIR:root,WEBAGENT_PORT:String(server.address().port),WEBAGENT_HOST:'127.0.0.1'};
 for(const prefix of ['node scripts/webctl-rpc.mjs','node --import tsx src/bin/webctl.ts'])for(const ref of ['e27',"'@e27'"]){
  const result=await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-Command',`${prefix} click --session s --ref ${ref}`],{env,windowsHide:true});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
  assert.equal(result.code,0,result.err);assert.ok(['e27','@e27'].includes(calls.at(-1).params.ref));
 }
});

test('delayed popup preparation failures return a visible destination warning',async t=>{
 const {context}=await fixture(t,'<button onclick="setTimeout(()=>window.open(\'/destination\'),500)">Open</button>');
 const store=new SessionStore(context);let count=0;
 const parent=await store.open('https://example.test/',{prepare:async p=>{count++;if(count>1)throw Error('settings');await p.setViewportSize({width:1440,height:900});}});
 const result=await executePrimitive(store.get(parent.id),'click',{locator:{role:'button',name:'Open',exact:true}});
 assert.equal(result.effect.newSessions.length,1);assert.equal(result.effect.newSessions[0].setupStatus,'partial');assert.equal(result.observationRequired,true);
});

test('readback mismatch prevents a requested search submission',async t=>{
 const {page}=await fixture(t,'<form onsubmit="event.preventDefault();window.submitted=1"><input type="search" id="q" oninput="this.value=\'changed\'"><button>Search</button></form>');
 const result=await executePrimitive(page,'fill',{locator:{css:'#q'},value:'requested',submit:true});
 assert.equal(result.reason,'value_mismatch');assert.equal(await page.evaluate(()=>window.submitted||0),0);
});

test('payment semantics cannot hide behind labels, descendants or associated forms',async t=>{
 const {page}=await fixture(t,'<p>Checkout test</p>');
 const cases=[
 ['<input id="target" type="button" value="Pay now" onclick="window.paid=1">','click'],
 ['<span id="pay">Pay now</span><button id="target" aria-labelledby="pay" onclick="window.paid=1">Continue</button>','click'],
 ['<button aria-label="Pay now" onclick="window.paid=1"><span id="target">Continue</span></button>','click'],
 ['<form id="checkout" onsubmit="event.preventDefault();window.paid=1"><button>Pay now</button></form><input id="target" form="checkout">','press'],
 ['<form action="/payment" onsubmit="event.preventDefault();window.paid=1"><button id="target">Continue</button></form>','click']
 ];
 for(const [html,op] of cases){await page.setContent(html);await page.evaluate(()=>window.paid=0);
 if(op==='press')await page.locator('#target').focus();
 const result=await executePrimitive(page,op,op==='press'?{key:'Enter'}:{locator:{css:'#target'}});
 assert.equal(result.confirmationRequired,true,html);assert.equal(await page.evaluate(()=>window.paid),0,html);
 }
});

test('mixed native and ARIA check states cannot certify false',async t=>{
 const {page}=await fixture(t,'<div id="mixed" role="checkbox" aria-checked="mixed">Partial</div><input id="native" type="checkbox"><div id="invalid" role="option" aria-selected="invalid">Option</div>');
 await page.locator('#native').evaluate(e=>e.indeterminate=true);
 for(const [id,read] of [['mixed','checked'],['native','checked'],['invalid','selected']]){
 const result=await verification.verifyPage(page,{checks:[{type:'element',target:{locator:{css:'#'+id}},read,op:'equals',expected:false}]});
 assert.equal(result.outcome,'UNKNOWN',id);
 }
});

test('global Enter uses the common popup effect contract',async t=>{
 const {context}=await fixture(t,'<a href="/destination" target="_blank">Open details</a>');
 const store=new SessionStore(context);const parent=await store.open('https://example.test/');
 const page=store.get(parent.id);await page.locator('a').focus();
 const result=await executePrimitive(page,'press',{key:'Enter'});
 assert.ok(result.effect,JSON.stringify(result));assert.equal(result.effect.newSessions.length,1);assert.ok(result.effect.newSessions[0].sessionId);assert.equal(result.observationRequired,true);
});

test('capture failures remain incomplete instead of escaping during retry',async t=>{
 const {page}=await fixture(t,'<h1>Page</h1>');
 await page.evaluate(()=>Object.defineProperty(document,'title',{get(){throw Error('broken title');}}));
 const result=await captureSnapshot(page);
 assert.equal(result.observation.complete,false);assert.ok(result.observation.errors.includes('capture_failed'));
});

test('native labels and image names retain dangerous activation semantics',async t=>{
 const {page}=await fixture(t,'<p>Controls</p>');
 for(const html of ['<label id="target" for="box">Delete account</label><input type="checkbox" id="box" onclick="window.changed=1">','<button id="target" onclick="window.changed=1"><img alt="Pay now"></button>']){
 await page.setContent(html);await page.evaluate(()=>window.changed=0);
 const result=await executePrimitive(page,'click',{locator:{css:'#target'}});
 assert.equal(result.confirmationRequired,true,html);assert.equal(await page.evaluate(()=>window.changed),0);
 }
});

test('modifier activation keys cannot bypass payment confirmation',async t=>{
 const {page}=await fixture(t,'<button id="pay" onclick="window.paid=1">Pay now</button>');
 await page.locator('#pay').focus();
 const result=await executePrimitive(page,'press',{key:'Shift+Enter'});
 assert.equal(result.confirmationRequired,true);assert.equal(await page.evaluate(()=>window.paid||0),0);
});

test('purchase-format menu combinations never grant a site-specific confirmation exemption',async t=>{
 const {page}=await fixture(t,'<ul><li><a href="/sch/i.html?all=1">All</a></li><li><a href="/sch/i.html?auction=1">Auction</a></li><li><a href="/sch/i.html?LH_BIN=1">Buy It Now</a></li></ul>');
 const result=await executePrimitive(page,'click',{locator:{role:'link',name:'Buy It Now',exact:true}});
 assert.equal(result.confirmationRequired,true);assert.equal(result.risk,'external_write');assert.equal(result.execution,'not_started');
 await page.setContent('<a href="/checkout?LH_BIN=1">Buy It Now</a>');
 assert.equal((await executePrimitive(page,'click',{locator:{role:'link',name:'Buy It Now',exact:true}})).confirmationRequired,true);
});

test('image submit control names require payment confirmation',async t=>{
 const {page}=await fixture(t,'<form onsubmit="event.preventDefault();window.paid=1"><input id="target" type="image" alt="Pay now" width="80" height="30"></form>');
 const result=await executePrimitive(page,'click',{locator:{css:'#target'}});
 assert.equal(result.confirmationRequired,true);assert.equal(await page.evaluate(()=>window.paid||0),0);
});

test('same-search filter parameters never grant a site-specific confirmation exemption',async t=>{
 const {page}=await fixture(t,'<a href="/sch/i.html?_nkw=mouse&amp;LH_BIN=1">Buy It Now (531) Items</a>');
 await page.goto('https://example.test/sch/i.html?_nkw=mouse');
 const result=await executePrimitive(page,'click',{locator:{role:'link',name:'Buy It Now (531) Items',exact:true}});
 assert.equal(result.confirmationRequired,true);assert.equal(result.risk,'external_write');assert.equal(result.execution,'not_started');
});
