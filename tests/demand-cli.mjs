import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {browserOptions} from './browser-options.mjs';
import {BrowserDaemon} from '../src/browserd/server.ts';import {SessionStore} from '../src/browserd/session-store.ts';import {getConfig} from '../src/config.ts';
import {mapCommandToRpc} from '../scripts/webctl-rpc.mjs';
test('default CLI maps native reads with explicit scope and receipt; HWM is opt-in',()=>{
 const result=mapCommandToRpc(['snapshot'],{session:'s'},new Set());assert.equal(result.params.format,'hb');
 const read=mapCommandToRpc(['read'],{session:'s',map:'M1',panel:'P2',want:'content,state',since:'D1',consumer:'C1','text-limit':'2000'},new Set());
 assert.equal(read.method,'page.read');assert.equal(read.params.map,'M1');assert.equal(read.params.since,'D1');assert.equal(read.params.textLimit,'2000');
 assert.equal(mapCommandToRpc(['explain'],{session:'s',map:'M1',panel:'P2'},new Set()).params.format,'hwm');
 assert.equal(mapCommandToRpc(['snapshot'],{session:'s',format:'json'},new Set()).params.format,'json');
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
