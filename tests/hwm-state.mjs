import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { renderObservation } from '../src/runtime/hwm/renderer.ts';
import { parseHwm, validateHwm } from '../src/runtime/hwm/view.ts';
async function fixture(t,html){const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('https://example.test/?city=Boston&city=New+York&token=private123');return page;}
const capture=page=>captureSnapshot(page,{context:true,waitMs:0});

test('document facts and form state preserve URL duplicates, external form owners and sensitive boundaries',async t=>{
 const page=await fixture(t,'<html lang="ko"><head><title>Search</title></head><body><form id="f"><input name="city" value="Chicago"></form><input form="f" name="guests" value="2"><input form="f" type="password" value="private123"><div role="status">Dates not applied</div></body></html>');
 const g=(await capture(page)).contextGraph;assert.equal(g.facts.lang,'ko');assert.equal(g.facts.title,'Search');assert.deepEqual(g.state.params.slice(0,2),[['city','Boston'],['city','New York']]);
 assert.ok(!JSON.stringify(g).includes('private123'));assert.equal(g.state.fields.length,3);assert.ok(g.state.fields.every(f=>f.form));assert.ok(g.state.status.length===1);
 const view=parseHwm(renderObservation(g,{session:'s1'}));assert.deepEqual(validateHwm(view),[]);const state=view.entries.find(e=>e.tag==='state');assert.ok(state);assert.ok(state.items.some(i=>i.attrs.value==='Chicago'));assert.equal(state.items.find(i=>i.attrs.redacted===true).attrs.value,undefined);assert.ok(state.items.some(i=>i.attrs.display==='Dates not applied'));
});

test('select, explicit radio/tab groups and nested fieldsets keep known selected members separate',async t=>{
 const page=await fixture(t,'<select multiple><option selected>A</option><option selected>B</option><option>C</option></select><div role="radiogroup"><button role="radio" aria-checked="false">A</button><button role="radio" aria-checked="true">B</button></div><div role="tablist"><button role="tab" aria-selected="true">One</button><button role="tab" aria-selected="false">Two</button></div><fieldset><legend>Outer</legend><input type="checkbox" checked><fieldset><legend>Inner</legend><input type="checkbox" checked></fieldset></fieldset>');
 const g=(await capture(page)).contextGraph;const groups=g.state.groups;assert.equal(groups.length,5);
 assert.equal(groups.find(x=>g.nodes.find(n=>n.id===x.node).tag==='select').selected.length,2);
 for(const group of groups){assert.equal(group.complete,true);assert.ok(group.selected.length>=1);assert.ok(group.selected.every(id=>g.nodes.some(n=>n.id===id)));}
 const fields=groups.filter(x=>g.nodes.find(n=>n.id===x.node).kind==='fieldset');assert.ok(fields.every(x=>x.selected.length===1));
 assert.ok(g.state.fields.some(f=>f.checked===true));
 assert.deepEqual(validateHwm(parseHwm(renderObservation(g,{session:'s1'}))),[]);
});

test('a hidden member and unknown ARIA checked state yield a partial selection, not false none',async t=>{
 const page=await fixture(t,'<div role="radiogroup"><button role="radio" aria-checked="true">Known</button><button role="radio" aria-checked="nonsense">Unknown</button><button role="radio" hidden aria-checked="false">Hidden</button></div>');
 const g=(await capture(page)).contextGraph;const group=g.state.groups[0];assert.equal(group.complete,false);assert.equal(group.selected.length,1);
 const view=parseHwm(renderObservation(g,{session:'s1'}));const source=g.nodes.find(n=>n.id===group.node);const node=view.entries.find(n=>n.id===(source.actionRef??source.id));assert.equal(node.attrs['selected-complete'],false);assert.equal(node.attrs.selected.length,1);
});

test('heading outline is a derived index and does not replace DOM ancestry',async t=>{
 const page=await fixture(t,'<main><h1>Main</h1><p>Intro</p><section><h2>Background <em>notes</em></h2><p>First <a href="/a">link</a></p><h3>Details</h3><table><tr><td>Cell</td></tr></table></section><h2>Next</h2><p>Last</p></main>');
 const g=(await capture(page)).contextGraph;assert.equal(g.outline.length,4);const item=g.outline[1];assert.equal(item.paras.min,1);assert.equal(item.links.min,1);assert.equal(item.tables.min,1);
 const view=parseHwm(renderObservation(g,{session:'s1'}));assert.deepEqual(validateHwm(view),[]);const outline=view.entries.find(e=>e.tag==='outline');assert.equal(outline.items[1].attrs.display,'Background notes');
 const heading=g.nodes.find(n=>n.id===item.node);assert.equal(heading.parent,g.nodes.find(n=>n.tag==='section').id);
});

test('state projection comes from the saved graph after DOM changes',async t=>{
 const page=await fixture(t,'<input value="Before"><div aria-live="polite">Waiting</div>');const g=(await capture(page)).contextGraph;
 await page.locator('input').fill('After');await page.locator('[aria-live]').evaluate(e=>e.textContent='Done');const hwm=renderObservation(g,{session:'s1'});
 const state=parseHwm(hwm).entries.find(e=>e.tag==='state');assert.ok(state.items.some(i=>i.attrs.value==='Before'));
 assert.ok(hwm.includes('Before'));assert.ok(!hwm.includes('After'));assert.ok(hwm.includes('Waiting'));assert.ok(!hwm.includes('Done'));
});

test('conflicting ARIA declarations never overwrite native checked/selected facts',async t=>{
 const page=await fixture(t,'<fieldset><input type="checkbox" aria-checked="true"></fieldset><select><option aria-selected="true">A</option><option selected>B</option></select>');
 const g=(await capture(page)).contextGraph;const checkbox=g.nodes.find(n=>n.tag==='input');assert.equal(checkbox.attrs.checked,false);assert.equal(checkbox.attrs['aria-checked'],'true');
 const a=g.nodes.find(n=>n.tag==='option'&&n.attrs['aria-selected']==='true');assert.equal(a.attrs.selected,false);
 assert.ok(g.state.groups.every(group=>group.complete===false));
});
