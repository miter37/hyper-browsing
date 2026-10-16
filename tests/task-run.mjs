import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserOptions} from './browser-options.mjs';
import {runTask,executeWithFollow} from '../src/runtime/task/run.ts';
import {findGoal} from '../src/runtime/task/observe.ts';
import {executePrimitive} from '../src/engine/execute.ts';

async function fixture(t,html){const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent(html);return page;}

test('a newly linked local region yields early with actual context, without confirming the missing goal',async t=>{
 const page=await fixture(t,`${'<div class="notice" hidden><button>Unrelated</button></div>'.repeat(4)}<button aria-controls="choices" onclick="document.querySelector('#choices').hidden=false;document.querySelectorAll('.notice').forEach(el=>el.hidden=false)">Open</button><div id="choices" hidden><div><span>Adults</span><input type="range" value="1"><button><span aria-hidden="true">+</span></button></div><button>Apply</button></div><button onclick="window.bad=true">Continue</button>`);
 const result=await runTask(page,{waitMs:2500,steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'},expect:{exists:{terms:['Guessed name'],exact:true}}},{id:'continue',target:{terms:['Continue'],exact:true},action:{op:'click'}}]});
 assert.equal(result.reason,'postcondition_unconfirmed');assert.equal(result.steps[0].verification.status,'unconfirmed');assert.equal(result.steps[0].verification.reason,'new_linked_region');assert.ok(result.steps[0].verification.checks<12);
 assert.equal(await page.evaluate(()=>window.bad),undefined);
 const plus=result.recovery.regions[0].controls.find(c=>!c.name&&c.tag==='button');assert.equal(plus.local.text,'Adults');assert.equal(plus.local.values[0].value,'1');
});

test('unrelated new UI and explicitly busy linked UI do not prematurely stop a valid wait',async t=>{
 for(const busy of [false,true]){
  const page=await fixture(t,`<button aria-controls="panel" onclick="document.querySelector('#ad').hidden=false;${busy?"document.querySelector('#panel').hidden=false;document.querySelector('#panel').setAttribute('aria-busy','true');":""}setTimeout(()=>{document.querySelector('#panel').hidden=false;document.querySelector('#panel').removeAttribute('aria-busy');document.querySelector('#panel').innerHTML='<button>Expected choice</button>';},650)">Open</button><div id="ad" role="dialog" hidden><button>Unrelated action</button></div><div id="panel" hidden><button>Other choice</button></div>`);
  const result=await runTask(page,{waitMs:1800,steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'},expect:{exists:{terms:['Expected choice'],scope:'document'}}}]});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.recovery,undefined);
 }
});

test('single-command early yield preserves execution and skips the obsolete follow query',async t=>{
 const page=await fixture(t,'<button aria-controls="panel" onclick="document.querySelector(\'#panel\').hidden=false">Open</button><div id="panel" hidden><button>Actual choice</button></div>');
 const ref=(await findGoal(page,{terms:['Open'],exact:true})).candidates[0].ref;
 const result=await executeWithFollow(page,{ref},{expect:{exists:{terms:['Expected choice']}},follow:{terms:['Actual choice']},waitMs:2000},()=>executePrimitive(page,'click',{ref,goalDriven:true}));
 assert.equal(result.execution,'completed');assert.equal(result.verification.reason,'new_linked_region');assert.equal(result.finding.status,'not_found');assert.equal(result.recovery.regions[0].controls[0].name,'Actual choice');
});

test('Plan B returns an unexpected local popup and stops remaining actions without replay',async t=>{
 const page=await fixture(t,`<button onclick="window.opens=(window.opens||0)+1;document.querySelector('#popup').hidden=false">Guests</button>
 <div id="popup" hidden><h2>Travellers</h2><label>Adults <input value="1"></label><button aria-hidden="true">+</button><button>Apply</button></div><button onclick="window.bad=true">Continue</button>`);
 const result=await runTask(page,{waitMs:0,steps:[{id:'open',target:{terms:['Guests'],exact:true},action:{op:'click'},expect:{exists:{terms:['Expected choice'],exact:true}}},{id:'continue',target:{terms:['Continue'],exact:true},action:{op:'click'}}]});
 assert.equal(result.reason,'postcondition_unconfirmed');assert.equal(result.execution,'partial');assert.equal(result.remaining,1);
 assert.equal(result.recovery.kind,'local-observation');assert.equal(result.recovery.regions[0].basis,'newly-visible');
 assert.match(result.recovery.regions[0].text,/Travellers/);
 assert.ok(result.recovery.regions[0].controls.some(c=>c.name==='Apply'&&c.ref));
 assert.ok(result.recovery.regions[0].controls.some(c=>c.value==='1'));
 assert.equal(await page.evaluate(()=>window.opens),1);assert.equal(await page.evaluate(()=>window.bad),undefined);
});

test('single command verification failure returns Plan B while preserving completed execution',async t=>{
 const page=await fixture(t,`<button onclick="document.querySelector('section').hidden=false">Open</button><section hidden><button>Actual choice</button></section>`);
 const ref=(await findGoal(page,{terms:['Open'],exact:true})).candidates[0].ref;
 const result=await executeWithFollow(page,{ref},{expect:{exists:{terms:['Wrong choice']}},waitMs:0},()=>executePrimitive(page,'click',{ref,goalDriven:true}));
 assert.equal(result.execution,'completed');assert.equal(result.verification.status,'unconfirmed');assert.ok(result.recovery.regions[0].controls.some(c=>c.name==='Actual choice'));
});

test('Plan B is bounded, private and absent from successful responses',async t=>{
 const page=await fixture(t,`<button onclick="document.querySelector('section').hidden=false">Open</button><section hidden><input type="password" value="DO_NOT_LEAK"><input autocomplete="one-time-code" value="PRIVATE_OTP">${Array.from({length:30},(_,i)=>`<button>Option ${i}</button>`).join('')}</section>`);
 const result=await runTask(page,{waitMs:0,steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'},expect:{exists:{terms:['Missing']}}}]});
 assert.ok(result.recovery);assert.ok(Buffer.byteLength(JSON.stringify(result.recovery))<=4000);assert.equal(result.recovery.complete,false);
 assert.doesNotMatch(JSON.stringify(result.recovery),/DO_NOT_LEAK|PRIVATE_OTP/);
 const success=await runTask(page,{steps:[{id:'choose',target:{terms:['Option 0'],exact:true},action:{op:'click'}}]});assert.equal(success.ok,true);assert.equal(success.recovery,undefined);
});

test('Plan B handles unexpected information before a missing next target and preserves unknown outcomes',async t=>{
 const page=await fixture(t,'<button>Open</button><section hidden><h2>Account prompt</h2><button>Dismiss</button></section>');let calls=0;
 const result=await runTask(page,{waitMs:0,steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'},expect:{exists:{terms:['Dismiss']}}},{id:'next',target:{terms:['Expected next'],exact:true},action:{op:'click'}}]}, {execute:async()=>{calls++;await page.locator('section').evaluate(el=>el.hidden=false);return {ok:true,execution:'completed'};}});
 assert.equal(calls,1);assert.equal(result.reason,'target_not_found');assert.match(result.recovery.regions[0].text,/Account prompt/);
 await page.locator('section').evaluate(el=>el.hidden=true);
 const unknown=await runTask(page,{steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'}}]}, {execute:async()=>{calls++;await page.locator('section').evaluate(el=>el.hidden=false);return {ok:false,execution:'outcome_unknown',reason:'timeout'};}});
 assert.equal(calls,2);assert.equal(unknown.execution,'outcome_unknown');assert.ok(unknown.recovery.regions[0].controls.some(c=>c.name==='Dismiss'));
});

test('Plan B falls back to current popup or target surroundings without asserting newness',async t=>{
 const page=await fixture(t,'<div role="dialog" aria-label="Existing popup"><button>Choose</button><p>Current instructions</p></div>');
 const missing=await runTask(page,{steps:[{id:'missing',target:{terms:['Not present'],exact:true},action:{op:'click'}}]});
 assert.equal(missing.execution,'not_started');assert.equal(missing.recovery.regions[0].basis,'current-open-region');
 const result=await runTask(page,{waitMs:0,steps:[{id:'choose',target:{terms:['Choose'],exact:true},action:{op:'click'},expect:{exists:{terms:['Missing']}}}]});
 assert.equal(result.recovery.regions[0].basis,'current-open-region');assert.match(result.recovery.regions[0].text,/Current instructions/);
 await page.setContent('<section><button>Choose</button><p>Nearby instructions</p></section>');
 const nearby=await runTask(page,{waitMs:0,steps:[{id:'choose',target:{terms:['Choose'],exact:true},action:{op:'click'},expect:{exists:{terms:['Missing']}}}]});
 assert.equal(nearby.recovery.regions[0].basis,'target-surroundings');
});

test('terminal follow is a read, not a demand for a unique next action',async t=>{
 const page=await fixture(t,'<button>Open</button><button>Choice A</button><button>Choice B</button>');
 const result=await runTask(page,{steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'},follow:{terms:['Choice']}}]});
 assert.equal(result.ok,true);assert.equal(result.execution,'completed');assert.equal(result.finding.status,'ambiguous');
});

test('introduced verifies existence of new matching nodes without requiring unique content',async t=>{
 const page=await fixture(t,'<button onclick="document.querySelector(\'section\').innerHTML=\'<p>Included bag one</p><p>Included bag two</p>\'">Open</button><section></section>');
 const result=await runTask(page,{steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'},expect:{introduced:{terms:['Included bag'],actionableOnly:false}}}]});
 assert.equal(result.ok,true);assert.equal(result.finding.coverage.matched,2);
});

test('exists waits for multiple menu choices before follow, without replaying the opener',async t=>{
 const page=await fixture(t,'<button onclick="window.clicks=(window.clicks||0)+1;setTimeout(()=>document.querySelector(\'section\').innerHTML=\'<div role=menu><button>Choice A</button><button>Choice B</button></div>\',150)">Open</button><section></section>');
 const ref=(await findGoal(page,{terms:['Open'],exact:true})).candidates[0].ref;
 const result=await executeWithFollow(page,{ref},{expect:{exists:{terms:['Choice']}},follow:{terms:['Choice']}},()=>executePrimitive(page,'click',{ref,goalDriven:true}));
 assert.equal(result.verification.status,'confirmed');assert.equal(result.finding.scope.role,'menu');assert.equal(result.finding.coverage.matched,2);assert.equal(result.verification.finding,undefined);assert.equal(await page.evaluate(()=>window.clicks),1);
});

test('exists cannot confirm an incomplete scan, and goal still requires unique evidence',async t=>{
 const page=await fixture(t,'<button>Open</button><button>Choice</button><button>Choice</button>');
 for(const expect of [{exists:{terms:['Choice'],maxVisits:2}},{goal:{terms:['Choice']}}]){
  const r=await runTask(page,{waitMs:0,steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'},expect}]});
  assert.equal(r.reason,'postcondition_unconfirmed');
 }
});
test('short plans find and execute shared refs, verify current value, then select a newly introduced option',async t=>{
 const page=await fixture(t,'<input aria-label="Destination"><div id="choices"></div>');
 await page.locator('input').evaluate(el=>{el.oninput=()=>setTimeout(()=>{const b=document.createElement('button');b.textContent='Seoul';b.onclick=()=>b.textContent='Chosen';document.querySelector('#choices').append(b);},180);});
 const result=await runTask(page,{steps:[
  {id:'type',target:{terms:['Destination'],exact:true},action:{op:'fill',value:'Seoul'},expect:{fields:{value:'Seoul'},introduced:{terms:['Seoul'],roles:['button'],exact:true}}},
  {id:'choose',target:{terms:['Seoul'],roles:['button'],exact:true},action:{op:'click'},expect:{introduced:{terms:['Chosen'],exact:true}}}
 ]});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.execution,'completed');assert.equal(result.steps.length,2);assert.equal(await page.locator('button').innerText(),'Chosen');assert.equal(result.hwm,undefined);
});
test('ambiguous candidates stop before mutation and do not choose the first same-href link',async t=>{
 const page=await fixture(t,'<a href="#same">Details</a><a href="#same">Details</a>');
 const result=await runTask(page,{steps:[{id:'open',target:{terms:['Details'],exact:true},action:{op:'click'}}]});
 assert.equal(result.ok,false);assert.equal(result.reason,'target_ambiguous');assert.equal(result.execution,'not_started');assert.equal(result.remaining,1);assert.equal(result.finding.coverage.matched,2);assert.equal(await page.evaluate(()=>location.hash),'');
});
test('old matching results do not satisfy introduced condition; delayed new refs permit the next step',async t=>{
 const page=await fixture(t,'<button id="filter">Filter</button><div id="results"><button>New result</button></div><aside id="ad"></aside>');
 await page.locator('#filter').evaluate(el=>{el.onclick=()=>setTimeout(()=>{const b=document.createElement('button');b.textContent='New result';b.onclick=()=>window.picked=true;document.querySelector('#results').replaceChildren(b);},250);});
 const result=await runTask(page,{steps:[
  {id:'filter',target:{terms:['Filter'],exact:true},action:{op:'click'},expect:{introduced:{terms:['New result'],exact:true}}},
  {id:'pick',target:{terms:['New result'],exact:true},action:{op:'click'}}
 ]});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>window.picked),true);
});
test('a missed postcondition stops the plan despite successful click and unrelated activity',async t=>{
 const page=await fixture(t,'<button onclick="window.clicks=(window.clicks||0)+1">Filter</button><button onclick="window.bad=true">Old result</button><aside id="ad"></aside>');
 await page.evaluate(()=>{window.adTimer=setInterval(()=>document.querySelector('#ad').textContent=String(Math.random()),25);});
 const result=await runTask(page,{waitMs:250,steps:[{id:'filter',target:{terms:['Filter'],exact:true},action:{op:'click'},expect:{introduced:{terms:['Old result'],exact:true}}},{id:'bad',target:{terms:['Old result'],exact:true},action:{op:'click'}}]});
 assert.equal(result.reason,'postcondition_unconfirmed');assert.equal(result.execution,'partial');assert.equal(result.steps[0].action.execution,'completed');assert.equal(result.remaining,1);assert.equal(await page.evaluate(()=>window.bad),undefined);assert.equal(await page.evaluate(()=>window.clicks),1);
});
test('confirmation is per action, stops following steps, and is not inferred from the goal',async t=>{
 const page=await fixture(t,'<button onclick="window.deleted=true">Delete account</button><input aria-label="Next">');
 const result=await runTask(page,{steps:[{id:'delete',target:{terms:['Delete account'],exact:true},action:{op:'click'}},{id:'next',target:{terms:['Next'],exact:true},action:{op:'fill',value:'bad'}}]});
 assert.equal(result.reason,'confirmation_required');assert.equal(result.execution,'not_started');assert.equal(result.steps[0].action.confirmationRequired,true);assert.equal(await page.evaluate(()=>window.deleted),undefined);
});
test('unknown execution is preserved without replay or subsequent actions',async t=>{
 const page=await fixture(t,'<button>Open</button><input aria-label="Next">');let calls=0;
 const result=await runTask(page,{steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'}},{id:'next',target:{terms:['Next'],exact:true},action:{op:'fill',value:'bad'}}]}, {execute:async()=>{calls++;return {ok:false,execution:'outcome_unknown',reason:'timeout'};}});
 assert.equal(calls,1);assert.equal(result.execution,'outcome_unknown');assert.equal(result.remaining,1);assert.equal(result.steps[0].action.reason,'timeout');
});
test('an execution exception retains the attempted step and never replays it',async t=>{
 const page=await fixture(t,'<button>Open</button>');let calls=0;
 const result=await runTask(page,{steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'}}]}, {execute:async()=>{calls++;throw new Error('Lost reply');}});
 assert.equal(calls,1);assert.equal(result.execution,'outcome_unknown');assert.equal(result.steps[0].action.reason,'execution_exception');
});
test('targeted plan effects avoid whole-page probes while preserving target changes',async t=>{
 const page=await fixture(t,'<input aria-label="Place"><aside>Unrelated</aside>');
 const result=await runTask(page,{steps:[{id:'fill',target:{terms:['Place'],exact:true},action:{op:'fill',value:'Seoul'},expect:{fields:{value:'Seoul'}}}]});
 assert.equal(result.ok,true);assert.equal(result.steps[0].action.effect.scope,'target-and-requested-goals');assert.equal(result.steps[0].action.effect.page,undefined);assert.equal(result.steps[0].action.effect.targetChanged.value.after,'Seoul');
});
test('plan validation rejects blanket confirmation, arbitrary operations and invalid later steps before any action',async t=>{
 const page=await fixture(t,'<button onclick="window.executed=true">Go</button>');
 for(const input of [{confirmed:true,steps:[{id:'go',target:{terms:['Go']},action:{op:'click'}}]},{steps:[{id:'go',target:{terms:['Go']},action:{op:'click'}},{id:'wrong',target:{terms:['Go']},action:{op:'evaluate',value:'bad'}}]}]){
  await assert.rejects(()=>runTask(page,input),/invalid_task/);
 }assert.equal(await page.evaluate(()=>window.executed),undefined);
});
test('field verification reads false and unchanged values without asserting task success',async t=>{
 const page=await fixture(t,'<input type="checkbox" aria-label="Filter" checked>');
 const result=await runTask(page,{steps:[{id:'off',target:{terms:['Filter'],exact:true},action:{op:'click'},expect:{fields:{checked:false}}}]});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.steps[0].verification.status,'confirmed');assert.equal(result.taskSuccess,undefined);
});
test('explicit scoped result changes wait for that scope and a replacement is not silently rebound',async t=>{
 const page=await fixture(t,`<div role="group" aria-label="Results"><span>Old</span></div><button onclick="setTimeout(()=>document.querySelector('[role=group]').innerHTML='<span>New</span>',200)">Refresh</button>`);
 const region=await findGoal(page,{terms:['Results'],fields:['name'],actionableOnly:false});
 const result=await runTask(page,{steps:[{id:'refresh',target:{terms:['Refresh'],exact:true},action:{op:'click'},expect:{changed:{ref:region.candidates[0].ref}}}]});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.steps[0].verification.status,'confirmed');
});
test('intermediate candidate detail is returned only once, at the final relevant boundary',async t=>{
 const page=await fixture(t,'<input aria-label="Place"><button>Continue</button>');
 const result=await runTask(page,{steps:[{id:'fill',target:{terms:['Place'],exact:true},action:{op:'fill',value:'Seoul'},expect:{fields:{value:'Seoul'},goal:{terms:['Continue'],exact:true}}}]});
 assert.equal(result.ok,true);assert.equal(result.finding.status,'unique');assert.equal(result.steps[0].verification.finding,undefined);
});
test('an expired task deadline is checked after input pacing before starting a mutation',async t=>{
 const page=await fixture(t,'<button onclick="window.changed=true">Open</button>');
 const result=await runTask(page,{timeoutMs:100,steps:[{id:'open',target:{terms:['Open'],exact:true},action:{op:'click'}}]});
 assert.equal(result.ok,false);assert.equal(result.execution,'not_started');assert.equal(await page.evaluate(()=>window.changed),undefined);
});
test('a changed ancestor guard cannot turn an unchanged old DOM target into an introduced result',async t=>{
 const page=await fixture(t,'<button onclick="document.querySelector(\'h2\').textContent=\'New heading\'">Filter</button><section><h2>Old heading</h2><button>Old result</button></section>');
 const result=await runTask(page,{waitMs:100,steps:[{id:'filter',target:{terms:['Filter'],exact:true},action:{op:'click'},expect:{introduced:{terms:['Old result'],exact:true}}}]});
 assert.equal(result.ok,false);assert.equal(result.reason,'postcondition_unconfirmed');
});
test('declared target state is rechecked at execution, not only during goal discovery',async t=>{
 const page=await fixture(t,'<input type="checkbox" aria-label="Filter" onclick="window.clicked=true">');
 const result=await runTask(page,{steps:[{id:'filter',target:{terms:['Filter'],exact:true,states:{checked:false}},action:{op:'click'}}]}, {execute:async(page,kind,params)=>{await page.locator('input').evaluate(el=>el.checked=true);return executePrimitive(page,kind,params);}});
 assert.equal(result.ok,false);assert.equal(result.steps[0].action.reason,'precondition_mismatch');assert.equal(result.execution,'not_started');assert.equal(await page.evaluate(()=>window.clicked),undefined);
});
test('long expected values compare actual fields rather than display previews',async t=>{
 const page=await fixture(t,'<input aria-label="Place">'),value='a'.repeat(160);
 const result=await runTask(page,{steps:[{id:'fill',target:{terms:['Place'],exact:true},action:{op:'fill',value},expect:{fields:{value}}}]});
 assert.equal(result.ok,true);assert.equal(result.steps[0].verification.status,'confirmed');assert.equal(await page.locator('input').inputValue(),value);
});
