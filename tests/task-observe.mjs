import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserOptions} from './browser-options.mjs';
import {findGoal} from '../src/runtime/task/observe.ts';
import {executePrimitive} from '../src/engine/execute.ts';
import {parseGoal} from '../src/runtime/task/schema.ts';

test('invalid goal diagnostics identify the field and correction without echoing private input',()=>{
 assert.throws(()=>parseGoal({terms:['secret search'],fields:['PRIVATE_VALUE']}),e=>{
  assert.equal(e.code,'invalid_goal');assert.equal(e.execution,'not_started');
  assert.equal(e.validation[0].path,'fields.0');assert.ok(e.validation[0].allowed.includes('name'));
  assert.match(e.validation[0].hint,/states/);assert.doesNotMatch(JSON.stringify(e.validation),/PRIVATE_VALUE|secret search/);return true;
 });
 assert.throws(()=>parseGoal({}),e=>{assert.match(e.validation[0].hint,/terms.*roles/);return true;});
});

async function fixture(t,html){const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent(html);return page;}

test('unnamed controls preserve their own local row text, values and control order',async t=>{
 const row=(name,value)=>`<div><span>${name}</span><div><button><span aria-hidden="true">−</span></button><input type="range" role="spinbutton" value="${value}" min="0" max="9" style="width:1px;opacity:0"><button><span aria-hidden="true">+</span></button></div></div>`;
 const page=await fixture(t,`<div role="dialog" aria-label="Guests">${row('Adults',1)}${row('Children',0)}</div>`);
 const result=await findGoal(page,{roles:['button'],limit:8,byteBudget:8000});
 assert.equal(result.candidates.length,4);
 const [minus,plus,childMinus,childPlus]=result.candidates;
 assert.equal(plus.name,undefined);assert.equal(plus.local.basis,'dom-ancestor');assert.equal(plus.local.text,'Adults');
 assert.equal(plus.local.values[0].value,'1');assert.equal(plus.local.controlIndex,2);assert.equal(minus.local.controlIndex,0);
 assert.equal(childPlus.local.text,'Children');assert.equal(childMinus.local.values[0].value,'0');
 assert.doesNotMatch(JSON.stringify(plus.local),/Children/);
 const scoped=await findGoal(page,{roles:['button'],scope:{ref:plus.ref}});assert.equal(scoped.candidates[0].local,undefined);
});

test('same words retain the enclosing form or landmark instead of losing it at a group',async t=>{
 const page=await fixture(t,'<main><form aria-label="Search form"><fieldset><legend>Route</legend><button>Direct</button></fieldset></form><aside aria-label="Result options"><fieldset><legend>Stops</legend><button>Direct</button></fieldset></aside></main>');
 const result=await findGoal(page,{terms:['Direct'],exact:true});
 assert.equal(result.status,'ambiguous');
 assert.equal(result.candidates[0].owner.name,'Route');assert.equal(result.candidates[0].owner.ancestors[0].role,'form');assert.equal(result.candidates[0].owner.ancestors[0].name,'Search form');
 assert.equal(result.candidates[1].owner.name,'Stops');assert.equal(result.candidates[1].owner.ancestors[0].role,'complementary');assert.equal(result.candidates[1].owner.ancestors[0].name,'Result options');
 assert.equal(result.candidates[0].local,undefined);
});

test('local context masks private field values and marks capped values without widening matches',async t=>{
 const page=await fixture(t,`<section><span>Credentials</span><input type="password" value="NEVER_PUBLISH_ME"><button><span aria-hidden="true">+</span></button></section><section><span>Person</span><input value="${'z'.repeat(90)}"><button><span aria-hidden="true">+</span></button></section>`);
 const result=await findGoal(page,{roles:['button'],limit:4});
 assert.ok(result.candidates[0].local);assert.doesNotMatch(JSON.stringify(result),/NEVER_PUBLISH_ME/);
 assert.equal(result.candidates[0].local.values[0].redacted,true);assert.equal(result.candidates[1].local.values[0].valueTruncated,true);
 const notName=await findGoal(page,{terms:['Credentials'],roles:['button'],fields:['name']});assert.equal(notName.status,'not_found');
});

test('explicit role-only lookup discovers unnamed inputs without treating an empty goal as all controls',async t=>{
 const page=await fixture(t,'<input role="combobox"><button>Other</button>');
 const found=await findGoal(page,{roles:['combobox']});
 assert.equal(found.status,'unique');assert.ok(found.candidates[0].ref);assert.equal(found.candidates[0].name,undefined);
 await assert.rejects(()=>findGoal(page,{}),/invalid_goal/);
});

test('public goal previews mark every capped text and value',async t=>{
 const page=await fixture(t,`<div role="dialog" aria-label="Details">${'x'.repeat(550)}</div><input aria-label="Long value" value="${'y'.repeat(300)}">`);
 const text=await findGoal(page,{terms:['Details'],fields:['name'],actionableOnly:false});
 assert.equal(text.candidates[0].textTruncated,true);
 const value=await findGoal(page,{terms:['Long value'],scope:'document'});
 assert.equal(value.candidates[0].valueTruncated,true);
});

test('repeated controls include bounded source item context, without mixing neighbouring items',async t=>{
 const page=await fixture(t,'<ul><li>Item A $10 <button>Details</button></li><li>Item B $20 <button>Details</button></li></ul>');
 const result=await findGoal(page,{terms:['Details'],exact:true});
 assert.match(result.candidates[0].owner.text,/Item A \$10/);assert.doesNotMatch(result.candidates[0].owner.text,/Item B/);
 assert.match(result.candidates[1].owner.text,/Item B \$20/);
});

test('explicit local text budget reads a small dialog without increasing default output',async t=>{
 const page=await fixture(t,`<div role="dialog" aria-label="Details">${'start '.repeat(100)} end-of-details</div>`);
 const goal={terms:['Details'],fields:['name'],roles:['dialog'],actionableOnly:false};
 const compact=await findGoal(page,goal),detail=await findGoal(page,{...goal,textLimit:1200});
 assert.equal(compact.candidates[0].textTruncated,true);assert.ok(compact.candidates[0].text.length<=500);
 assert.match(detail.candidates[0].text,/end-of-details$/);assert.notEqual(detail.candidates[0].textTruncated,true);
});

test('goal lookup preserves visible text separately from name and returns a directly executable ref',async t=>{
 const page=await fixture(t,'<div role="menu" aria-label="Rating"><div role="menuitemradio" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',\'true\')"><span aria-hidden="true">4.5</span></div></div>');
 const found=await findGoal(page,{terms:['4.5'],fields:['text'],roles:['menuitemradio']});
 assert.equal(found.status,'unique');assert.equal(found.candidates[0].name,undefined);assert.equal(found.candidates[0].text,'4.5');
 assert.deepEqual(found.candidates[0].match,[{field:'text',term:'4.5'}]);assert.equal(found.scope.role,'menu');
 const result=await executePrimitive(page,'click',{ref:found.candidates[0].ref});assert.equal(result.ok,true);
 assert.equal(await page.locator('[role=menuitemradio]').getAttribute('aria-checked'),'true');
});
test('active dialog excludes matching background controls; explicit document scope retains ambiguity',async t=>{
 const page=await fixture(t,'<button>Save choices</button><div role="dialog" aria-label="Preferences"><button>Save choices</button></div>');
 const local=await findGoal(page,{terms:['Save choices'],exact:true});assert.equal(local.status,'unique');assert.equal(local.candidates[0].owner.role,'dialog');
 const all=await findGoal(page,{terms:['Save choices'],exact:true,scope:'document'});assert.equal(all.status,'ambiguous');assert.equal(all.coverage.matched,2);
});
test('shared names exclude hidden duplicate words, traverse open shadow and match before output limits',async t=>{
 const page=await fixture(t,'<main><button>Seoul<span aria-hidden="true">Seoul</span></button><div id="host"></div></main>');
 await page.locator('#host').evaluate(el=>{el.attachShadow({mode:'open'}).innerHTML='<button>Needle</button>';});
 const city=await findGoal(page,{terms:['Seoul'],fields:['name'],exact:true});assert.equal(city.status,'unique');assert.equal(city.candidates[0].name,'Seoul');
 const needle=await findGoal(page,{terms:['Needle'],exact:true,limit:1});assert.equal(needle.status,'unique');assert.ok(needle.candidates[0].ref);
});
test('goals distinguish placeholder and value matches, preserve false state and mask public evidence',async t=>{
 const page=await fixture(t,'<input aria-label="Location" placeholder="Where" value="Seoul"><input type="checkbox" aria-label="Filter"><button>person@example.com</button><input type="password" aria-label="Password" value="private-value">');
 const place=await findGoal(page,{terms:['Where'],fields:['placeholder']});assert.equal(place.candidates[0].match[0].field,'placeholder');assert.equal(place.candidates[0].name,'Location');
 const box=await findGoal(page,{terms:['Filter'],states:{checked:false}});assert.equal(box.status,'unique');
 const email=await findGoal(page,{terms:['person@example.com']});assert.ok(!JSON.stringify(email).includes('person@example.com'));
 const secret=await findGoal(page,{terms:['private-value'],fields:['value']});assert.equal(secret.status,'not_found');
});
test('partial collection or folded candidates cannot establish unique execution',async t=>{
 const page=await fixture(t,'<main><button>Match</button>'+Array.from({length:20},()=>'<button>Match</button>').join('')+'</main>');
 const partial=await findGoal(page,{terms:['Match'],maxVisits:3});assert.equal(partial.status,'incomplete');assert.equal(partial.coverage.complete,false);
 const folded=await findGoal(page,{terms:['Match'],limit:1});assert.equal(folded.status,'ambiguous');assert.equal(folded.coverage.matched,21);assert.equal(folded.candidates.length,1);assert.equal(folded.coverage.shown,1);
});
test('scope refs are checked and old references are never rebound to replacement elements',async t=>{
 const page=await fixture(t,'<button aria-label="Group">Scope</button>');
 const original=await findGoal(page,{terms:['Group'],exact:true});const ref=original.candidates[0].ref;
 await page.locator('button').evaluate(el=>{el.outerHTML='<button aria-label="Group">New</button>';});
 const stale=await findGoal(page,{terms:['Group'],scope:{ref}});assert.equal(stale.ok,false);assert.equal(stale.reason,'stale_ref');
});
test('goal output respects a byte budget while preserving exact matched counts and folding evidence',async t=>{
 const page=await fixture(t,Array.from({length:10},(_,i)=>`<button aria-label="Match ${i}">${'Description '.repeat(70)}</button>`).join(''));
 const result=await findGoal(page,{terms:['Match'],fields:['name'],limit:10,byteBudget:1600});
 assert.equal(result.coverage.matched,10);assert.equal(result.coverage.truncated,true);assert.ok(result.candidates.length<10);assert.ok(Buffer.byteLength(JSON.stringify(result))<=1600);
});
test('active scope follows an explicit aria-controls portal from within a modal',async t=>{
 const page=await fixture(t,'<div role="dialog" aria-modal="true" aria-label="Search"><input aria-label="Destination" aria-controls="suggestions"></div><div id="suggestions" role="listbox"><button role="option">Seoul</button></div>');
 const result=await findGoal(page,{terms:['Seoul'],roles:['option'],exact:true});assert.equal(result.status,'unique');assert.equal(result.scope.role,'listbox');
});
test('a long scope name cannot escape the goal response budget',async t=>{
 const page=await fixture(t,`<div role="dialog" aria-label="${'scope '.repeat(500)}"><button>Hit</button></div>`);
 const result=await findGoal(page,{terms:['Hit'],byteBudget:1000});assert.ok(Buffer.byteLength(JSON.stringify(result))<=1000);assert.ok(result.scope.name.length<=120);assert.equal(result.scope.nameTruncated,true);
});
