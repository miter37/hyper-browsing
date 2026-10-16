import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {browserOptions} from './browser-options.mjs';
import {BrowserDaemon} from '../src/browserd/server.ts';import {SessionStore} from '../src/browserd/session-store.ts';import {getConfig} from '../src/config.ts';
import {mapCommandToRpc} from '../scripts/webctl-rpc.mjs';
import {parseGoal} from '../src/runtime/task/schema.ts';

test('role-only CLI lookup inside an observed group requires no guessed name or text field',()=>{
 const request=mapCommandToRpc(['find'],{session:'s','scope-ref':'e123',role:'slider','goal-id':'amount'},new Set());
 const goal=parseGoal(request.params.input);assert.deepEqual(goal.roles,['slider']);assert.deepEqual(goal.terms,[]);assert.deepEqual(goal.scope,{ref:'e123'});
});
test('default CLI maps native reads with explicit scope and receipt; HWM is opt-in',()=>{
 const result=mapCommandToRpc(['snapshot'],{session:'s'},new Set());assert.equal(result.params.format,'hb');
 const read=mapCommandToRpc(['read'],{session:'s',map:'M1',panel:'P2',want:'content,state',since:'D1',consumer:'C1','text-limit':'2000'},new Set());
 assert.equal(read.method,'page.read');assert.equal(read.params.map,'M1');assert.equal(read.params.since,'D1');assert.equal(read.params.textLimit,'2000');
 assert.equal(mapCommandToRpc(['explain'],{session:'s',map:'M1',panel:'P2'},new Set()).params.format,'hwm');
 assert.equal(mapCommandToRpc(['snapshot'],{session:'s',format:'json'},new Set()).params.format,'json');
 const visual=mapCommandToRpc(['find'],{session:'s',query:'Minimum','goal-id':'price-min','visual-reviewed':'V123'},new Set());assert.equal(visual.params.goalId,'price-min');assert.equal(visual.params.visualReviewed,'V123');
});
test('native daemon map/read and a real fill preserve execution while avoiding post-action graphs',async t=>{
 const b=await chromium.launch(browserOptions());t.after(()=>b.close());const context=await b.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<header><button>Menu</button></header><main><input aria-label="Place" value="Seoul"><p>Article words</p></main>'}));
 const sessions=new SessionStore(context),opened=await sessions.open('https://example.test');const daemon=new BrowserDaemon({...getConfig(),learningDisabled:true});daemon.sessions=sessions;daemon.context=context;daemon.chrome.ensureConnected=async()=>context;
 t.after(()=>daemon.demand.close());const map=await daemon.dispatchUnlocked('page.snapshot',{sessionId:opened.id,format:'hb'});assert.equal(map.kind,'map');assert.equal(map.snapshot,undefined);
 const panel=map.panels.find(p=>p.role==='main');const read=await daemon.dispatchUnlocked('page.read',{sessionId:opened.id,format:'hb',map:map.map,panel:panel.id,want:'controls',since:map.delivery});assert.equal(read.kind,'read');
 const ref=panel.controls.find(c=>c.name==='Place').ref;
 const result=await daemon.dispatchUnlocked('page.fill',{sessionId:opened.id,format:'hb',ref,value:'Busan',since:read.delivery,map:map.map,panel:panel.id});
 assert.equal(result.execution,'completed');assert.equal(result.snapshot,undefined);assert.equal(result.hwm,undefined);assert.equal(result.comparison,undefined);assert.equal(await sessions.get(opened.id).locator('input').inputValue(),'Busan');
});

async function entryFixture(t){
 const b=await chromium.launch(browserOptions());t.after(()=>b.close());const context=await b.newContext();
 await context.route('https://example.test/**',r=>r.fulfill({contentType:'text/html',body:'<header><button>Menu</button></header><main><input aria-label="Destination"><p>'+ 'Long body words '.repeat(1500)+'</p></main><div role="dialog" aria-label="Welcome" style="position:fixed;right:0;top:0"><button>Dismiss welcome</button></div>'}));
 const daemon=new BrowserDaemon({...getConfig(),learningDisabled:true});daemon.context=context;daemon.sessions=new SessionStore(context);daemon.chrome.ensureConnected=async()=>context;t.after(()=>daemon.demand.close());return daemon;
}

test('opening a site includes the small panel map and actual dialog controls in the same response',async t=>{
 const daemon=await entryFixture(t),result=await daemon.dispatchUnlocked('session.open',{url:'https://example.test/start',format:'json'});
 assert.ok(result.id);assert.equal(result.kind,'map');assert.ok(result.at);assert.equal(result.panels[0].role,'dialog');
 assert.ok(result.panels[0].controls.some(c=>c.name==='Dismiss welcome'&&c.ref));assert.ok(result.panels.some(p=>p.controls?.some(c=>c.name==='Destination')));
 assert.ok(Buffer.byteLength(JSON.stringify(result))<8000);assert.ok(!JSON.stringify(result).includes('Long body words'));
 const panel=result.panels.find(p=>p.role==='main');const read=await daemon.dispatchUnlocked('page.read',{sessionId:result.id,at:result.at,panel:panel.id,want:'state'});assert.equal(read.ok,true);
});

test('explicit navigation returns a fresh map, while a local action keeps its small result',async t=>{
 const daemon=await entryFixture(t),first=await daemon.dispatchUnlocked('session.open',{url:'https://example.test/start'});
 const next=await daemon.dispatchUnlocked('page.goto',{sessionId:first.id,url:'https://example.test/next',format:'hb'});assert.equal(next.kind,'map');assert.ok(next.panels.length);assert.notEqual(next.map,first.map);
 const back=await daemon.dispatchUnlocked('page.back',{sessionId:first.id,format:'hb'});assert.equal(back.kind,'map');assert.equal(back.url,'https://example.test/start');
 const forward=await daemon.dispatchUnlocked('page.forward',{sessionId:first.id,format:'hb'});assert.equal(forward.kind,'map');assert.equal(forward.url,'https://example.test/next');
 const input=forward.panels.flatMap(p=>p.controls??[]).find(c=>c.name==='Destination');const filled=await daemon.dispatchUnlocked('page.fill',{sessionId:first.id,format:'hb',ref:input.ref,value:'Paris'});assert.equal(filled.execution,'completed');assert.equal(filled.panels,undefined);assert.notEqual(filled.focus?.kind,'map');
});

test('initial map failure preserves the opened session and does not repeat navigation',async t=>{
 const daemon=await entryFixture(t);let captures=0;daemon.demand.map=async()=>{captures++;throw Object.assign(new Error('map unavailable'),{code:'scope_stale'});};
 const result=await daemon.dispatchUnlocked('session.open',{url:'https://example.test/start'});assert.ok(result.id);assert.equal(result.url,'https://example.test/start');assert.equal(result.observationError,'scope_stale');assert.equal(captures,1);assert.equal((await daemon.sessions.list()).length,1);
});

test('entry maps do not restore secret URL parameters over their redacted page facts',async t=>{
 const daemon=await entryFixture(t),result=await daemon.dispatchUnlocked('session.open',{url:'https://example.test/start?token=PRIVATE_CANARY_TOKEN_1234567890'});
 assert.ok(result.panels.length);assert.ok(!result.url.includes('PRIVATE_CANARY_TOKEN_1234567890'));assert.ok(result.redacted.includes('url'));
});

test('HB scroll accepts the received continuation and returns bounded viewport read entry points',async t=>{
 const daemon=await entryFixture(t),opened=await daemon.dispatchUnlocked('session.open',{url:'https://example.test/scroll'});
 const result=await daemon.dispatchUnlocked('page.scroll',{sessionId:opened.id,format:'hb',at:opened.at,distance:700});
 assert.equal(result.scrolled,true);assert.equal(result.owner.kind,'document');assert.equal(result.currentView.range,'viewport');assert.ok(result.currentView.at);
 assert.ok(!JSON.stringify(result).includes('Long body words'));assert.ok(Buffer.byteLength(JSON.stringify(result))<5000);
});

test('HB scroll uses the panel continuation through the daemon without document fallback',async t=>{
 const daemon=await entryFixture(t),opened=await daemon.dispatchUnlocked('session.open',{url:'https://example.test/widget'});
 const page=daemon.sessions.get(opened.id);await page.setContent('<main style="height:120px;overflow:auto"><h2>Widget</h2><div style="height:1200px"></div></main><div style="height:1800px"></div>');
 const m=await daemon.dispatchUnlocked('page.snapshot',{sessionId:opened.id,format:'hb'});
 const panel=m.panels.find(p=>p.role==='main');const result=await daemon.dispatchUnlocked('page.scroll',{sessionId:opened.id,format:'hb',at:m.at,panel:panel.id,distance:200});
 assert.equal(result.owner.kind,'element');assert.equal(result.owner.after[1],200);assert.equal(await page.evaluate(()=>scrollY),0);assert.ok(result.currentView.at);
});
