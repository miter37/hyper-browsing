import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { compareObservations, observeExecution } from '../src/runtime/hwm/changes.ts';
import { parseHwm, validateHwm } from '../src/runtime/hwm/view.ts';
import { SessionStore } from '../src/browserd/session-store.ts';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { getConfig } from '../src/config.ts';
async function fixture(t){const b=await chromium.launch(browserOptions());t.after(()=>b.close());const context=await b.newContext(),p=await context.newPage();await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<input value="A"><p>Before</p><button>Open</button>'}));await p.goto('https://example.test');return p;}
const capture=async p=>(await captureSnapshot(p,{context:true,waitMs:0})).contextGraph;
test('physical DOM identity survives renumbering and compares only observed fields',async t=>{
 const p=await fixture(t),a=await capture(p);await p.locator('input').fill('B');await p.locator('p').evaluate(e=>{e.firstChild.data='After';e.before(document.createElement('hr'));});const b=await capture(p),changes=compareObservations(a,b);
 assert.ok(changes.some(c=>c.op==='changed'&&c.field==='value'&&c.old==='A'&&c.new==='B'));
 assert.ok(changes.some(c=>c.op==='changed'&&c.field==='text'&&c.old==='Before'&&c.new==='After'));
 assert.ok(changes.some(c=>c.op==='unchanged'&&c.field==='disabled'));
 assert.ok(changes.some(c=>c.op==='added'));
 assert.ok(changes.every(c=>c.causal===false));
});
test('identical replacement markup is removal/addition, never matched by name or position',async t=>{
 const p=await fixture(t),a=await capture(p);await p.locator('input').evaluate(e=>e.replaceWith(e.cloneNode(true)));const b=await capture(p),changes=compareObservations(a,b);
 const old=a.nodes.find(n=>n.tag==='input');assert.ok(changes.some(c=>c.op==='removed'&&c.before.node===old.id));assert.ok(!changes.some(c=>c.identity==='tracked-dom-node'&&c.before?.node===old.id));
});
test('partial observations do not prove node removal and unknown values are incomparable',async t=>{
 const p=await fixture(t),a=await capture(p),b=(await captureSnapshot(p,{context:true,contextLimit:2,waitMs:0})).contextGraph;
 assert.ok(!compareObservations(a,b).some(c=>c.op==='removed'));
 const full=await capture(p);const input=full.nodes.find(n=>n.tag==='input');delete input.attrs.value;
 assert.ok(compareObservations(a,full).some(c=>c.op==='incomparable'&&c.field==='value'));
});
test('document replacement is an explicit event without node identity claims',async t=>{
 const p=await fixture(t),a=await capture(p);await p.goto('https://example.test/next');const changes=compareObservations(a,await capture(p));
 assert.equal(changes.length,1);assert.equal(changes[0].reason,'document-identity-changed');assert.equal(changes[0].subject,'document');assert.equal(changes[0].replacement,'unconfirmed');
});
test('execution is invoked once, unknown/partial remain independent of changes and popup evidence',async t=>{
 const p=await fixture(t);let calls=0;
 const request='a'.repeat(48);
 const result=await observeExecution(p,'s1',async()=>{calls++;await p.locator('input').fill('B');return {ok:false,execution:'outcome_unknown',newSessions:[{sessionId:'popup1',url:'https://example.test/new'}]};},request);
 assert.equal(calls,1);assert.equal(result.execution,'outcome_unknown');const view=parseHwm(result.hwm);assert.deepEqual(validateHwm(view),[]);
 const record=view.entries.find(e=>e.tag==='result');assert.equal(record.attrs.execution,'outcome_unknown');assert.equal(record.attrs.newSessions[0].sessionId,'popup1');assert.ok(view.entries.some(e=>e.tag==='change'&&e.attrs.field==='value'));
 assert.equal(record.attrs.request,request);assert.ok(view.entries.filter(e=>e.tag==='change').every(e=>e.attrs['after-request']===request));
 const partial=await observeExecution(p,'s1',async()=>({ok:false,execution:'partial',stoppedAt:1,results:[{execution:'completed'}]}));assert.equal(parseHwm(partial.hwm).entries.find(e=>e.tag==='result').attrs.stoppedAt,1);
});
test('semantic key reuse and redacted fields cannot claim comparable values',async t=>{
 const p=await fixture(t);await p.locator('input').evaluate(e=>e.setAttribute('data-key','item-a'));const a=await capture(p);await p.locator('input').evaluate(e=>{e.setAttribute('data-key','item-b');e.value='Z';});const b=await capture(p);
 assert.ok(compareObservations(a,b).some(c=>c.reason==='semantic-identity-changed'));assert.ok(!compareObservations(a,b).some(c=>c.field==='value'&&c.op==='changed'));
});
test('masked content cannot become an unchanged claim',async t=>{
 const p=await fixture(t);await p.locator('input').fill('first@example.com');const a=await capture(p);await p.locator('input').fill('second@example.com');const changes=compareObservations(a,await capture(p));
 assert.ok(changes.some(c=>c.field==='value'&&c.reason==='redacted'));assert.ok(!changes.some(c=>c.field==='value'&&c.op==='unchanged'));
});
test('deep ancestry guard is bounded and incomplete evidence does not certify identity',async t=>{
 const p=await fixture(t);await p.setContent('<div>'.repeat(80)+'<input value="A">'+'</div>'.repeat(80));const a=await capture(p);
 assert.equal(a.nodes.find(n=>n.tag==='input').tracking.semantic,null);
 const changes=compareObservations(a,await capture(p));assert.ok(changes.some(c=>c.reason==='semantic-guard-incomplete'));assert.ok(!changes.some(c=>c.field==='value'&&c.op==='unchanged'));
});
test('recycled selected member does not make the group selection unchanged',async t=>{
 const p=await fixture(t);await p.setContent('<div role="tablist"><button role="tab" data-key="A" aria-selected="true">A</button></div>');const a=await capture(p);await p.locator('button').evaluate(e=>e.setAttribute('data-key','B'));
 const changes=compareObservations(a,await capture(p));assert.ok(!changes.some(c=>c.field==='selected'&&c.op==='unchanged'));assert.ok(changes.some(c=>c.field==='selected'&&c.reason==='selection-identity-unconfirmed'));
});
test('daemon context commands expose actual popup registration and graph diff without replay',async t=>{
 const p=await fixture(t);await p.context().route('**/*',r=>r.fulfill({contentType:'text/html',body:'<input value="A"><a href="/next" target="_blank">Open details</a>'}));
 const store=new SessionStore(p.context()),parent=await store.open('https://example.test/');
 const daemon=new BrowserDaemon({...getConfig(),learningDisabled:true});daemon.sessions=store;daemon.context=p.context();daemon.chrome.ensureConnected=async()=>p.context();
 const before=(await daemon.dispatchUnlocked('page.snapshot',{sessionId:parent.id,format:'json'})).snapshot;
 const filled=await daemon.dispatchUnlocked('page.fill',{sessionId:parent.id,locator:{css:'input'},value:'B',format:'hwm',observationRequestId:'reqFill'});
 assert.equal(filled.execution,'completed');assert.ok(filled.changes.some(c=>c.field==='value'&&c.new==='B'));
 const diff=await daemon.dispatchUnlocked('page.diff',{sessionId:parent.id,before,format:'hwm'});assert.ok(diff.changes.some(c=>c.field==='value'&&c.new==='B'));
 const json=await daemon.dispatchUnlocked('page.fill',{sessionId:parent.id,locator:{css:'input'},value:'B',context:true});assert.equal(json.hwm,undefined);assert.ok(json.snapshot.contextGraph);
 const batch=await daemon.dispatchUnlocked('batch.run',{sessionId:parent.id,input:{commands:[{op:'fill',locator:{css:'input'},value:'C'},{op:'fill',locator:{css:'#missing'},value:'D',timeoutMs:100}]},format:'hwm'});
 assert.equal(batch.execution,'partial');assert.equal(batch.ok,false);assert.equal(parseHwm(batch.hwm).entries.find(e=>e.tag==='result').attrs.stoppedAt,1);assert.ok(batch.changes.some(c=>c.field==='value'&&c.new==='C'));
 const opened=await daemon.dispatchUnlocked('page.click',{sessionId:parent.id,locator:{role:'link',name:'Open details',exact:true},format:'hwm',observationRequestId:'reqOpen'});
 const result=parseHwm(opened.hwm).entries.find(e=>e.tag==='result');assert.equal(result.attrs.effect.newSessions.length,1);assert.ok(result.attrs.effect.newSessions[0].sessionId);assert.equal(result.attrs.request,'reqOpen');
 const popup=parseHwm(opened.hwm).entries.find(e=>e.tag==='change'&&e.attrs.subject==='session');assert.equal(popup.attrs.op,'added');assert.equal(popup.attrs.after.session,result.attrs.effect.newSessions[0].sessionId);assert.equal(popup.attrs.source,'playwright-popup-event');
 assert.equal((await store.list()).length,2);assert.deepEqual(validateHwm(parseHwm(opened.hwm)),[]);
});
