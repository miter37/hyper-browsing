import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserOptions} from './browser-options.mjs';
import {DemandObservationService} from '../src/runtime/observation/service.ts';
import {runTask} from '../src/runtime/task/run.ts';
import {parseTask} from '../src/runtime/task/schema.ts';
import {findGoal} from '../src/runtime/task/observe.ts';

async function fixture(t,html){const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent(html);return page;}
async function service(t,page){const s=new DemandObservationService();t.after(()=>s.close());const m=await s.map(page,'s');return {s,m,main:m.panels.find(p=>p.role==='main')};}

test('control-state read gives current widget facts without building or dumping a prose graph',async t=>{
 const page=await fixture(t,'<main><h2>Current interval</h2><input aria-label="Minimum" type="number" min="10" value="20"><p role="status">Changes pending</p><table>'+Array.from({length:60},(_,i)=>`<tr><td>Cell ${i}</td></tr>`).join('')+'</table></main>');
 const {s,m,main}=await service(t,page);s.detailed.remember=()=>{throw Error('unexpected prose graph');};
 const r=await s.read(page,'s',{at:m.at,panel:main.id,want:'controls,state',repeat:true});
 assert.equal(r.ok,true);assert.deepEqual(r.current.headings,['Current interval']);assert.deepEqual(r.current.status,['Changes pending']);assert.equal(r.data.find(n=>n.name==='Minimum').native.min,'10');assert.doesNotMatch(JSON.stringify(r),/Cell 59/);assert.ok(Buffer.byteLength(JSON.stringify(r))<7000);
 const same=await s.read(page,'s',{at:r.at,want:'controls,state'});assert.equal(same.current,undefined);assert.ok(same.known>0);
});

test('scoped work read preserves explicit outside controllers and gives executable inner scroll entry points',async t=>{
 const page=await fixture(t,'<button aria-controls="months">Next period</button><main id="months"><div style="height:100px;overflow:auto"><h2>Period A</h2><div style="height:900px"></div></div></main><button>Unrelated operation</button>');
 const {s,m,main}=await service(t,page);const r=await s.read(page,'s',{at:m.at,panel:main.id,want:'controls,state'});
 const controller=r.related.find(n=>n.relation==='controlled-by');assert.ok(controller.controls.some(c=>c.name==='Next period'&&c.ref));
 assert.doesNotMatch(JSON.stringify(r.related),/Unrelated operation/);
 const scroll=r.related.find(n=>n.relation==='scroll-owner');assert.ok(scroll.at);
 const moved=await s.scroll(page,'s',{at:scroll.at,distance:100});assert.equal(moved.owner.kind,'element');assert.equal(moved.owner.after[1],100);assert.equal(await page.evaluate(()=>scrollY),0);
});

test('map panels give concrete scoped handles instead of requiring placeholder reconstruction',async t=>{
 const page=await fixture(t,'<main><button>Choose</button></main>');const {s,main}=await service(t,page);assert.ok(main.at);
 const r=await s.read(page,'s',{at:main.at,want:'controls'});assert.equal(r.ok,true);assert.equal(r.panel,main.id);
});

test('origin follow reads the original form while an unrelated dialog remains active',async t=>{
 const page=await fixture(t,`<form><p role="status" id="summary">Old interval</p><button type="button" aria-controls="popup" onclick="document.getElementById('summary').textContent='New interval';document.getElementById('popup').hidden=false">Change</button></form><div id="popup" role="dialog" aria-label="Choices" hidden><button>Other option</button></div>`);
 const r=await runTask(page,{waitMs:50,steps:[{id:'edit',target:{terms:['Change'],exact:true},action:{op:'click'},follow:{terms:['New interval'],scope:'origin',actionableOnly:false}}]});
 assert.equal(r.execution,'completed');assert.ok(r.finding.candidates.some(c=>c.text?.includes('New interval')),JSON.stringify(r));assert.equal(r.finding.readiness.basis,'origin-region');
});

test('detached origin never widens to a new form or current document',async t=>{
 const page=await fixture(t,`<form><button onclick="event.preventDefault();this.form.outerHTML='<form>New interval</form>'">Replace</button></form>`);
 const r=await runTask(page,{waitMs:0,steps:[{id:'edit',target:{terms:['Replace'],exact:true},action:{op:'click'},follow:{terms:['New interval'],scope:'origin',actionableOnly:false}}]});
 assert.equal(r.execution,'completed');assert.equal(r.finding.reason,'origin_region_stale');assert.equal(r.finding.candidates.length,0);
});

test('portal completion follows its explicit controller back to the original form',async t=>{
 const page=await fixture(t,`<form><button type="button" aria-controls="portal">Dates</button><p role="status" id="summary">Old interval</p></form><div role="dialog" id="portal"><button onclick="document.getElementById('summary').textContent='New interval';this.parentElement.hidden=true">Done</button></div><form><p role="status">Unrelated form</p></form>`);
 const r=await runTask(page,{waitMs:50,steps:[{id:'done',target:{terms:['Done'],exact:true},action:{op:'click'},follow:{terms:['New interval'],scope:'origin',actionableOnly:false}}]});
 assert.equal(r.execution,'completed');assert.ok(r.finding.candidates.some(c=>c.text==='New interval'),JSON.stringify(r));assert.equal(r.finding.readiness.basis,'origin-region');
});

test('related scope handles survive an unchanged map refresh without replacing another target',async t=>{
 const page=await fixture(t,'<button aria-controls="months">Advance</button><main id="months"><input aria-label="Value"></main>');
 const {s,m,main}=await service(t,page),r=await s.read(page,'s',{at:m.at,panel:main.id,want:'controls,state'});
 const at=r.related.find(n=>n.relation==='controlled-by').at;
 const refreshed=await s.map(page,'s');assert.equal(refreshed.map,m.map);
 const controller=await s.read(page,'s',{at,want:'controls',repeat:true});assert.ok(controller.data.some(c=>c.name==='Advance'));
});

test('invalid batch fields give actionable private diagnostics before any mutation',()=>{
 assert.throws(()=>parseTask({steps:[{id:'open',target:{terms:['PRIVATE_SEARCH']},action:{op:'click'},follow:{terms:['PRIVATE_RESULT'],fields:['role']}}]}),e=>{
  assert.equal(e.execution,'not_started');assert.equal(e.validation[0].path,'steps.0.follow.fields.0');assert.ok(e.validation[0].allowed.includes('name'));assert.doesNotMatch(JSON.stringify(e.validation),/PRIVATE_SEARCH|PRIVATE_RESULT/);return true;
 });
});

test('work context retracts removed facts and never leaks private input values',async t=>{
 const page=await fixture(t,'<main><h2>Old title</h2><input type="password" value="PRIVATE_CANARY_123"><p role="status">'+ 'x'.repeat(200)+'</p><button>Keep</button></main>');
 const {s,m,main}=await service(t,page),r=await s.read(page,'s',{at:m.at,panel:main.id,want:'controls,state'});
 assert.equal(r.current.complete,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_CANARY_123/);
 await page.locator('h2,[role=status]').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));
 const next=await s.read(page,'s',{at:r.at,want:'controls,state'});assert.deepEqual(next.current.headings,[]);assert.deepEqual(next.current.status,[]);
});

test('an origin linked to multiple forms remains unresolved instead of choosing the first',async t=>{
 const page=await fixture(t,`<form><button type="button" aria-controls="portal">One</button><p role="status">Summary</p></form><form><button type="button" aria-controls="portal">Two</button><p role="status">Summary</p></form><div id="portal" role="dialog"><button>Done</button></div>`);
 const r=await runTask(page,{waitMs:0,steps:[{id:'done',target:{terms:['Done'],exact:true},action:{op:'click'},follow:{terms:['Summary'],scope:'origin',actionableOnly:false}}]});
 assert.equal(r.execution,'completed');assert.equal(r.finding.reason,'origin_region_stale');assert.equal(r.finding.candidates.length,0);
});

test('indirect explicit links retain their ancestor or descendant qualification',async t=>{
 const page=await fixture(t,'<button aria-controls="outer">Toggle outer</button><section id="outer"><main><button aria-controls="portal">Open choices</button></main></section><div id="portal"><button>Choice</button></div>');
 const {s,m,main}=await service(t,page),r=await s.read(page,'s',{at:m.at,panel:main.id,want:'controls,state'});
 assert.equal(r.related.find(n=>n.relation==='controlled-by').via,'ancestor');
 assert.equal(r.related.find(n=>n.relation==='controls').via,'descendant');
});

test('display-contents wrappers preserve current values instead of claiming an empty complete widget',async t=>{
 const page=await fixture(t,'<main><div role="group" aria-label="Settings" style="display:contents"><h2>Price range</h2><input aria-label="Minimum" value="100000"><span style="display:none"><input value="hidden-value"></span><span style="display:contents;visibility:hidden"><input value="hidden-contents-value"></span></div></main>');
 const {s,m,main}=await service(t,page);const found=await findGoal(page,{roles:['group'],terms:['Settings'],exact:true,actionableOnly:false});
 const r=await s.read(page,'s',{at:m.at,panel:main.id,target:found.candidates[0].ref,want:'controls,state'});
 assert.ok(r.current.values.some(v=>v.value==='100000'));assert.deepEqual(r.current.headings,['Price range']);
 assert.doesNotMatch(JSON.stringify(r.current),/hidden-value|hidden-contents-value/);
});
