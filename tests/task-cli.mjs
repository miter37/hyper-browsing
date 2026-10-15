import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {browserOptions} from './browser-options.mjs';
import {BrowserDaemon} from '../src/browserd/server.ts';import {SessionStore} from '../src/browserd/session-store.ts';import {getConfig} from '../src/config.ts';
import {mapCommandToRpc} from '../scripts/webctl-rpc.mjs';
import {needsHeadedFallback,safeHeadedRetry} from '../src/browserd/headed-fallback.ts';

test('goal CLI commands preserve input files and headless policy in the fast transport',()=>{
 const found=mapCommandToRpc(['find'],{session:'s',query:'Rating',role:'button'},new Set(['headless-only']));
 assert.equal(found.method,'task.find');assert.deepEqual(found.params.input.terms,['Rating']);assert.equal(found.params.format,'hb');assert.equal(found.params.allowHeadedFallback,false);
 const run=mapCommandToRpc(['run'],{session:'s',input:'{"steps":[]}'},new Set());assert.equal(run.method,'task.run');assert.deepEqual(run.params.input,{steps:[]});
});
test('goal recovery may change display for a blocked page but never replays a plan or reveals for ambiguity',()=>{
 assert.equal(needsHeadedFallback('task.run',{ok:false,reason:'target_ambiguous'}),false);
 assert.equal(needsHeadedFallback('task.find',{ok:true,pageState:{state:'blocked'}}),true);
 assert.equal(safeHeadedRetry('task.run',{input:{steps:[]}}),false);
 assert.equal(safeHeadedRetry('task.find',{input:{terms:['Search']}}),true);
 assert.equal(safeHeadedRetry('task.find',{input:{terms:['Search'],scope:{ref:'e1'}}}),false);
});
async function fixture(t){const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const context=await browser.newContext();
 await context.route('https://example.test/**',r=>r.fulfill({contentType:'text/html',body:'<main><input aria-label="Place"><button onclick="window.count=(window.count||0)+1">Open</button></main>'}));
 const sessions=new SessionStore(context),opened=await sessions.open('https://example.test');const daemon=new BrowserDaemon({...getConfig(),learningDisabled:true});daemon.sessions=sessions;daemon.context=context;daemon.chrome.ensureConnected=async()=>context;t.after(()=>daemon.demand.close());return {daemon,sessions,id:opened.id,page:sessions.get(opened.id)};
}
test('native find/run avoids HWM, provides request/step ids and request store never replays a plan',async t=>{
 const {daemon,id,page}=await fixture(t);const found=await daemon.dispatchUnlocked('task.find',{sessionId:id,format:'hb',input:{terms:['Open'],exact:true}});assert.equal(found.status,'unique');assert.ok(found.candidates[0].ref);assert.equal(found.hwm,undefined);
 const input={steps:[{id:'open',target:{ref:found.candidates[0].ref},action:{op:'click'}}]},params={sessionId:id,format:'hb',input};
 const run=()=>daemon.requests.run('same-request','task.run',params,()=>daemon.dispatchUnlocked('task.run',{...params,observationRequestId:'same-request'}));
 const a=await run(),b=await run();assert.equal(a.ok,true);assert.deepEqual(a,b);assert.equal(a.steps[0].stepId,'same-request:open');assert.equal(await page.evaluate(()=>window.count),1);
});
test('direct actions can verify and find the next goal in the same response; invalid follow data is rejected before execution',async t=>{
 const {daemon,id,page}=await fixture(t);const found=await daemon.dispatchUnlocked('task.find',{sessionId:id,format:'hb',input:{terms:['Place'],exact:true}});const ref=found.candidates[0].ref;
 const result=await daemon.dispatchUnlocked('page.fill',{sessionId:id,format:'hb',ref,value:'Busan',then:{expect:{fields:{value:'Busan'}},follow:{terms:['Open'],exact:true}}});
 assert.equal(result.execution,'completed');assert.equal(result.verification.status,'confirmed');assert.equal(result.finding.status,'unique');assert.equal(result.hwm,undefined);
 assert.equal(result.focus,undefined);
 const repeated=await daemon.dispatchUnlocked('task.find',{sessionId:id,format:'hb',input:{terms:['Open'],exact:true},since:result.delivery,consumer:result.consumer});assert.equal(repeated.known,1);
 await assert.rejects(()=>daemon.dispatchUnlocked('page.fill',{sessionId:id,format:'hb',ref,value:'bad',then:{arbitrary:true}}),/invalid_follow/);
 assert.equal(await page.locator('input').inputValue(),'Busan');
});
test('goal receipts suppress only actually delivered fields for the same document and consumer',async t=>{
 const {daemon,id}=await fixture(t),params={sessionId:id,format:'hb',input:{terms:['Open'],exact:true}};
 const first=await daemon.dispatchUnlocked('task.find',params);const second=await daemon.dispatchUnlocked('task.find',{...params,since:first.delivery,consumer:first.consumer});
 assert.equal(second.known,1);assert.equal(second.candidates.length,0);assert.equal(second.status,'unique');
 const another=await daemon.dispatchUnlocked('task.find',params);assert.equal(another.candidates.length,1);
});
test('a goal delivery failure after a successful action cannot erase known execution',async t=>{
 const {daemon,id,page}=await fixture(t);const found=await daemon.dispatchUnlocked('task.find',{sessionId:id,input:{terms:['Place'],exact:true}});
 daemon.demand.deliverGoal=()=>{throw new Error('receipt capacity');};
 const result=await daemon.dispatchUnlocked('page.fill',{sessionId:id,format:'hb',ref:found.candidates[0].ref,value:'Busan',then:{follow:{terms:['Open'],exact:true}}});
 assert.equal(result.execution,'completed');assert.equal(result.ok,true);assert.equal(result.observationError,'goal_delivery_unavailable');assert.equal(await page.locator('input').inputValue(),'Busan');
});
