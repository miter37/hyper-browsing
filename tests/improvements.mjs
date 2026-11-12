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

test('PowerShell carries canonical and quoted legacy refs through both CLI surfaces',{skip:process.platform!=='win32'},async t=>{
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

test('availability wording is state, not a booking action; GET forms only load a URL',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><div role="application" aria-label="calendar">
   <div role="button" tabindex="0" aria-label="10, Thursday, December 2026. 예약 가능합니다. 체크인 날짜로 선택하세요." onclick="window.day=1">10</div>
   <div role="button" tabindex="0" aria-label="11, Friday, December 2026. Available to book" onclick="window.day2=1">11</div></div>
  <form method="get" action="/searchresults"><input name="ss"><button type="submit">Search</button></form>
  <form method="post" action="/x"><input name="n"><button type="submit">Go</button></form>
  <button onclick="window.booked=1">예약하기</button><button onclick="window.booked2=1">Book now</button>`);
 for(const label of ['10, Thursday','11, Friday']){
  const r=await executePrimitive(page,'click',{locator:{css:`[aria-label^="${label}"]`}});
  assert.equal(r.confirmationRequired,undefined,label);
 }
 assert.equal(await page.evaluate(()=>window.day&&window.day2),1);
 const post=await executePrimitive(page,'click',{locator:{role:'button',name:'Go',exact:true}});
 assert.equal(post.confirmationRequired,true);assert.equal(post.risk,'unclassified');
 for(const name of ['예약하기','Book now']){
  const r=await executePrimitive(page,'click',{locator:{role:'button',name,exact:true}});
  assert.equal(r.confirmationRequired,true,name+' '+JSON.stringify(r));assert.equal(r.risk,'external_write',name);
 }
 assert.equal(await page.evaluate(()=>window.booked||window.booked2||0),0);
 await page.evaluate(()=>document.querySelector('form[method=get]').addEventListener('submit',e=>{e.preventDefault();window.searched=1;}));
 const get=await executePrimitive(page,'click',{locator:{role:'button',name:'Search',exact:true}});
 assert.equal(get.confirmationRequired,undefined);assert.equal(await page.evaluate(()=>window.searched),1);
});

test('a date query finds the day however the page writes it',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><div role="button" tabindex="0" aria-label="10, Thursday, December 2026. Available">10</div>
  <div role="button" tabindex="0" aria-label="11, Friday, December 2026">11</div>
  <div role="gridcell" tabindex="0" aria-label="2026년 12월 12일 토요일">12</div>
  <button data-testid="calendar-day-12/13/2026">13</button>
  <button aria-label="Dec 14, 2026">14</button>`);
 const names=async q=>(await captureSnapshot(page,{query:q})).elements.map(e=>[e.name,e.testId].filter(Boolean).join(' '));
 assert.ok((await names('2026년 12월 10일')).some(n=>n.startsWith('10, Thursday')));
 assert.ok(!(await names('12월 10일')).some(n=>n.startsWith('11, Friday')));
 assert.ok((await names('December 12')).some(n=>n.includes('12월 12일')));
 assert.ok((await names('2026-12-13')).some(n=>String(n).includes('12/13/2026')));
 assert.ok((await names('12월 14일')).some(n=>n==='Dec 14, 2026'));
});

test('a query of several words finds each named control, and verify says which field is wrong',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><label>여행지 <input placeholder="여행지 검색"></label>
  <button>체크인 날짜 추가</button><button>여행자 게스트 추가</button><button>도움말</button>`);
 const names=(await captureSnapshot(page,{query:'여행지 체크인 여행자'})).elements.map(e=>e.name||e.placeholder);
 assert.ok(names.some(n=>/체크인/.test(n))&&names.some(n=>/여행자/.test(n))&&names.some(n=>/여행지/.test(n)),JSON.stringify(names));
 assert.ok(!names.includes('도움말'));
 const bad=await verification.verifyPage(page,{checks:[{type:'url_param',name:'q',value:'x'}]});
 assert.equal(bad.reason,'invalid_verification');assert.match(bad.error,/checks\.0/);assert.ok(bad.hint);
});

test('effect names report a visible label and its screen-reader copy once',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><input id="q"><div id="l" role="listbox"></div>
  <script>document.getElementById('q').addEventListener('input',()=>{
   const o=document.createElement('div');o.setAttribute('role','option');o.textContent='제주 도시';
   const sr=document.createElement('span');sr.textContent=' 제주 도시';sr.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden';
   o.append(sr);document.getElementById('l').append(o);});</script>`);
 const r=await executePrimitive(page,'fill',{locator:{css:'#q'},value:'제주'});
 assert.ok(r.effect?.page?.appeared?.includes('제주 도시'),JSON.stringify(r.effect));
});

test('image words are part of a name, and spacing does not hide a match',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><label><input type="checkbox" style="opacity:0;position:absolute"><img alt="로켓배송" width="40" height="12">만 보기</label><button>도움말</button>`);
 const snap=await captureSnapshot(page,{query:'로켓배송만 보기'});
 assert.ok(snap.elements.some(e=>/로켓배송\s*만 보기/.test(e.name||'')),JSON.stringify(snap.elements));
 assert.equal(snap.queryFilter.query,'로켓배송만 보기');assert.ok(snap.queryFilter.matches>0);
 const none=await captureSnapshot(page,{query:'zzz-not-here'});
 assert.equal(none.queryFilter.matches,0);assert.ok(none.queryFilter.hint);
});

test('a click on a link that routes late still reports the new URL',async t=>{
 const {page}=await fixture(t,`<a href="/next" onclick="event.preventDefault();setTimeout(()=>history.pushState({},'', '/next'),900)">Next page</a>`);
 const r=await executePrimitive(page,'click',{locator:{role:'link',name:'Next page'}});
 assert.equal(r.effect.urlChanged,true,JSON.stringify(r.effect));assert.match(r.effect.url,/\/next$/);
});

test('content inside an iframe is listed, observed, read and clicked through frame',async t=>{
 const {findFrame,frameView,listFrames}=await import('../src/browserd/frame-view.ts');
 const {listItems}=await import('../src/runtime/discovery-tools.ts');
 const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());
 const context=await browser.newContext();
 const top='<meta charset="utf-8"><input placeholder="search"><iframe name="searchIframe" src="https://list.example.test/place/list" style="width:400px;height:600px"></iframe>';
 const inner='<meta charset="utf-8"><ul>'+[1,2,3].map(i=>`<li><a href="/place/${i}">Cafe ${i}</a> 리뷰 ${i*10}</li>`).join('')+'</ul><button onclick="window.opened=1">펼쳐보기</button>';
 await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().includes('list.example.test')?inner:top}));
 const page=await context.newPage();await page.goto('https://map.example.test/');
 await page.frame({name:'searchIframe'}).waitForLoadState();
 const frames=await listFrames(page);
 assert.equal(frames[0].frame,'searchIframe');assert.match(frames[0].url,/place\/list/);
 assert.ok(!(await captureSnapshot(page)).elements.some(e=>e.name==='펼쳐보기'));
 const inside=frameView(page,findFrame(page,'place/list'));
 const list=await listItems(inside,{limit:5});
 assert.equal(list.items[0].title,'Cafe 1');
 const snap=await captureSnapshot(inside,{references:referencesFor(inside),query:'펼쳐보기'});
 const button=snap.elements.find(e=>e.name==='펼쳐보기');assert.ok(button?.ref);
 const r=await executePrimitive(page,'click',{ref:button.ref});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(await page.frame({name:'searchIframe'}).evaluate(()=>window.opened),1);
});

test('calendar cells named only by their day number carry the date of their month',async t=>{
 const month=(label,id)=>`<div role="rowgroup" aria-label="${label}"><div role="row">${[17,18,19].map(d=>`<div role="gridcell" tabindex="0" onclick="window.picked='${id}-${d}'">${d}</div>`).join('')}</div></div>`;
 const {page}=await fixture(t,`<meta charset="utf-8"><div role="grid">${month('2026년 11월','nov')}${month('2026년 12월','dec')}</div>
  <div role="button" tabindex="0" data-iso="2027-01-18">18</div>`);
 const snap=await captureSnapshot(page,{query:'12월 18일'});
 const cell=snap.elements.find(e=>e.date==='2026-12-18');
 assert.ok(cell,JSON.stringify(snap.elements));assert.ok(!snap.elements.some(e=>e.date==='2026-11-18'));
 assert.ok((await captureSnapshot(page,{query:'2027-01-18'})).elements.some(e=>e.date==='2027-01-18'));
 const r=await executePrimitive(page,'click',{locator:{role:'gridcell',name:'18',exact:true,within:'12월'}});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(await page.evaluate(()=>window.picked),'dec-18');
});

test('result rows without links or headings are still read as a list',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><ul>${['Air Busan 15:35 – 18:10 ₩309,718','ZIPAIR 13:05 – 15:30 ₩353,318','ZIPAIR 15:00 – 17:25 ₩353,318'].map(r=>`<li><div>${r}</div><div>Nonstop · 2 hr 35 min · ICN–NRT</div></li>`).join('')}</ul>`);
 const {listItems}=await import('../src/runtime/discovery-tools.ts');
 const list=await listItems(page,{limit:5});
 assert.equal(list.found,true,JSON.stringify(list));assert.equal(list.total,3);assert.match(list.items[0].title,/Air Busan/);
});

test('a result card with a cart checkbox is still a result, titled by its name link, filtered by query',async t=>{
 const card=(i,name)=>`<li><input type="checkbox" aria-label="select"><a href="/goods/${i}"><img alt=""> 이미지 보기</a><a href="/goods/${i}">${name}</a><p>저자 · 출판사 · 19,800원 · 평점 9.${i} 판매지수 ${i*1000} 내일 도착 예정</p></li>`;
 const {page}=await fixture(t,`<meta charset="utf-8"><div class="sec"><section><ul class="filters"><li><label><input type="checkbox">국내도서</label></li><li><label><input type="checkbox">외국도서</label></li><li><label><input type="checkbox">eBook</label></li></ul></section>
  <section><ul id="list">${[card(1,'점프 투 파이썬'),card(2,'혼자 공부하는 파이썬'),card(3,'자바의 정석'),card(4,'파이썬 코딩 도장')].join('')}</ul></section><section><p>footer text long enough to count as something</p></section></div>`);
 const {listItems}=await import('../src/runtime/discovery-tools.ts');
 const all=await listItems(page,{limit:5});
 assert.equal(all.total,4,JSON.stringify(all));assert.equal(all.items[0].title,'점프 투 파이썬');
 const py=await listItems(page,{query:'파이썬',limit:5});
 assert.equal(py.total,3);assert.ok(py.items.every(i=>i.title.includes('파이썬')));
});

test('a covered click is reported as not sent, naming the control on top; a label reads its whole row',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><div style="position:relative"><span id="price">1,903,550원</span><a href="/variant/2" style="position:absolute;inset:0">66몰</a></div>
  <table><tr><th>ISBN13</th><td>9791163034735</td></tr></table><dl><dt>쪽수</dt><dd>432쪽</dd></dl>`);
 const r=await executePrimitive(page,'click',{locator:{css:'#price'},timeoutMs:800});
 assert.equal(r.reason,'intercepted');assert.equal(r.execution,'not_started');assert.equal(r.coveringControl.href,'/variant/2');
 const row=await executePrimitive(page,'extract',{locator:{text:'ISBN13',exact:true},read:'row'});
 assert.equal(row.value,'ISBN13 9791163034735');
 const dd=await executePrimitive(page,'extract',{locator:{text:'쪽수',exact:true},read:'row'});
 assert.equal(dd.value,'쪽수 432쪽');
});

test('a search whose Enter changes nothing is reported as unconfirmed',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><form onsubmit="event.preventDefault()"><input type="search" id="q"></form>`);
 const r=await executePrimitive(page,'fill',{locator:{css:'#q'},value:'파이썬',submit:true});
 assert.equal(r.submitted,'unconfirmed',JSON.stringify(r));assert.ok(r.warning);
});

test('a search form is recognised by what it calls itself, and a heading reads its section',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><form action="/results" onsubmit="event.preventDefault();window.searched=1"><input name="search_query" placeholder="Search"><button>Search</button></form>
  <form action="/account/update" onsubmit="event.preventDefault();window.updated=1"><input name="nickname"><button>Go</button></form>
  <div class="heading"><h2 id="Legacy">Legacy</h2><span>[edit]</span></div><p>First paragraph of legacy.</p><p>Second one.</p>
  <div class="heading"><h3>Sub</h3></div><p>Sub text.</p><div class="heading"><h2>Next</h2></div><p>Not this.</p>`);
 const s=await executePrimitive(page,'fill',{locator:{css:'input[name=search_query]'},value:'파이썬 강의',submit:true});
 assert.equal(s.confirmationRequired,undefined,JSON.stringify(s));assert.equal(await page.evaluate(()=>window.searched),1);
 const u=await executePrimitive(page,'click',{locator:{role:'button',name:'Go',exact:true}});
 assert.equal(u.confirmationRequired,true);
 const sec=await executePrimitive(page,'extract',{locator:{role:'heading',name:'Legacy'},read:'section'});
 assert.equal(sec.value,'First paragraph of legacy.\nSecond one.\nSub\nSub text.',JSON.stringify(sec));
});

test('Enter still reaches a search field that suggestions re-rendered after typing',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><form role="search" onsubmit="event.preventDefault();window.sent=document.activeElement.value"><div id="box"><input id="q" name="search"></div></form>
  <script>document.getElementById('q').addEventListener('input',e=>{const v=e.target.value;setTimeout(()=>{const n=document.createElement('input');n.id='q';n.name='search';n.value=v;document.getElementById('box').replaceChildren(n);n.focus();},0);},{once:true});</script>`);
 const r=await executePrimitive(page,'fill',{locator:{css:'#q'},value:'Marie Curie',submit:true});
 assert.notEqual(r.execution,'outcome_unknown',JSON.stringify(r));
 if (r.ok) assert.equal(await page.evaluate(()=>window.sent),'Marie Curie');
 else assert.equal(r.execution,'not_started');
});

test('a checkpoint page that asks for proof of being human is reported as blocked',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><header><a href="/">Home</a> 배송처 대한민국</header><h4>We're noticing unusual browser activity.</h4><p>Check the box to confirm you're human. Automated browsing violates our Conditions of Use.</p><label><input type="checkbox"> I am human</label><button disabled>Continue</button>`);
 const {detectBlock}=await import('../src/engine/page-state.ts');
 const b=await detectBlock(page);
 assert.equal(b?.kind,'bot-challenge',JSON.stringify(b));
 await page.setContent('<meta charset="utf-8"><h1>Help center</h1><p>Unusual activity on your account? Read our guide.</p><a href="/guide">Guide</a>');
 assert.equal(await detectBlock(page),undefined);
});

test('a dialog saying automation tools are restricted is reported as blocked',async t=>{
 const {page}=await fixture(t,`<meta charset="utf-8"><div role="dialog"><h2>안내 메세지</h2><p>매크로, 개발자도구 등 미허가 도구 사용 시 이용이 제한될 수 있습니다. CODE: -8003</p><button>확인</button></div><p>해당 스케줄에 운행하는 열차가 없습니다.</p>`);
 const {detectBlock}=await import('../src/engine/page-state.ts');
 assert.equal((await detectBlock(page))?.kind,'bot-challenge');
 await page.setContent('<meta charset="utf-8"><div role="dialog"><p>선택하신 인원이 맞나요? 어른 1명</p><button>예</button></div>');
 assert.equal(await detectBlock(page),undefined);
});
