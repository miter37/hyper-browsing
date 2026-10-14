import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { referencesFor } from '../src/runtime/references.ts';
import { executePrimitive } from '../src/engine/execute.ts';
import { renderObservation } from '../src/runtime/hwm/renderer.ts';
async function fixture(t,html){const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent(html);return page;}
const capture=page=>captureSnapshot(page,{context:true,references:referencesFor(page),waitMs:0});

test('layout boundaries retain CSS declaration and measured scroll extent without inferred actions',async t=>{
 const page=await fixture(t,'<div id="scroll" style="overflow:auto;width:120px;height:60px" aria-hidden="false" aria-busy="false"><div style="height:300px">Content</div></div>');
 const g=(await capture(page)).contextGraph,node=g.nodes.find(n=>n.attrs.id==='scroll');
 const actual=await page.locator('#scroll').evaluate(e=>({client:[e.clientWidth,e.clientHeight],extent:[e.scrollWidth,e.scrollHeight],offset:[e.scrollLeft,e.scrollTop]}));
 assert.equal(node.attrs['aria-hidden'],'false');assert.equal(node.attrs.busy,false);
 assert.deepEqual(node.attrs['layout-boundary'].client,actual.client);assert.deepEqual(node.attrs['layout-boundary'].extent,actual.extent);assert.deepEqual(node.attrs['layout-boundary'].offset,actual.offset);
 assert.deepEqual(node.attrs['layout-boundary'].overflow,['auto','auto']);assert.equal(node.attrs['layout-boundary'].source,'dom-cssom-v1');assert.equal(node.attrs['layout-boundary'].scrollable,undefined);
});

test('unrendered wrapper keeps a boundary node and does not expose its subtree text or input',async t=>{
 const page=await fixture(t,'<h2 hidden>Hidden heading</h2><div hidden role="heading">Unknown heading level</div><div id="closed" hidden aria-hidden="true" aria-busy="true"><input type="password" value="private123"><p>Hidden content</p></div>');
 const g=(await capture(page)).contextGraph,node=g.nodes.find(n=>n.attrs.id==='closed');assert.ok(node);assert.equal(node.attrs.hidden,true);assert.equal(node.attrs['aria-hidden'],'true');assert.equal(node.attrs['aria-busy'],'true');
 assert.ok(g.gaps.some(gap=>gap.parent===node.id&&gap.reason==='not-rendered'));assert.ok(!g.nodes.some(n=>n.parent===node.id));assert.ok(!JSON.stringify(g).includes('private123'));assert.ok(!JSON.stringify(g).includes('Hidden content'));
 assert.ok(renderObservation(g,{session:'s1'}).includes('not-rendered'));
});

test('capture phase timings distinguish graph evaluation, transfer and reference binding',async t=>{
 const page=await fixture(t,'<input aria-label="Place"><button>Search</button>');const snapshot=await capture(page),phases=snapshot.collectionTiming.phases;
 for(const key of ['referenceStateMs','pageEvaluationMs','resultTransferMs','referenceBindingMs','cleanupMs'])assert.ok(Number.isFinite(phases[key])&&phases[key]>=0,key);
 assert.equal(phases.retainedReferences,snapshot.elements.filter(e=>e.ref).length);assert.ok(phases.retainedReferences>=2);
 assert.ok(phases.referenceBindingMs>0);assert.ok((await captureSnapshot(page,{waitMs:0})).collectionTiming);
});

test('body text and controls keep item ownership, inline order, and the original execution refs',async t=>{
 const page=await fixture(t,'<main><ul><li>Mouse A <b>$18.40</b><a href="/a">Details</a></li><li>Mouse B <b>$16.00</b><a href="/b">Details</a></li></ul><p>Read <a href="/terms">terms</a> carefully.</p></main>');
 const snapshot=await capture(page),g=snapshot.contextGraph;assert.ok(g);
 const price=g.nodes.find(n=>n.text==='$18.40'),other=g.nodes.find(n=>n.text==='$16.00');
 const ancestry=n=>{const out=[];while(n){out.push(n);n=g.nodes.find(p=>p.id===n.parent);}return out;};
 assert.notEqual(ancestry(price).find(n=>n.kind==='item').id,ancestry(other).find(n=>n.kind==='item').id);
 const refs=g.nodes.filter(n=>n.actionRef).map(n=>n.actionRef);assert.ok(snapshot.elements.filter(e=>e.tag==='a').every(e=>refs.includes(e.ref)));
 const p=g.nodes.find(n=>n.kind==='paragraph');const parts=g.nodes.filter(n=>n.parent===p.id);assert.deepEqual(parts.map(n=>n.kind),['text','link','text']);assert.equal(parts[0].text,'Read ');assert.equal(parts[2].text,' carefully.');
});

test('query matches distinguish content and decoded URL fields without filtering away ancestors',async t=>{
 const page=await fixture(t,'<section><a href="/a">New York</a></section><section><a href="/find?city=New%20York">Hotels</a></section>');
 const snap=await captureSnapshot(page,{context:true,query:'New York',references:referencesFor(page),waitMs:0});const g=snap.contextGraph;
 assert.ok(g.matches.some(m=>m.field==='text'));assert.ok(g.matches.some(m=>m.field==='href.query'));
 assert.ok(g.matches.every(m=>g.nodes.some(n=>n.id===m.node)));assert.ok(g.nodes.some(n=>n.text==='Hotels'));
});

test('collection budget, hidden subtrees and frames report gaps rather than false emptiness',async t=>{
 const page=await fixture(t,'<div hidden>Not rendered</div><iframe src="about:blank"></iframe>'+ '<p>Text</p>'.repeat(15));
 const full=(await capture(page)).contextGraph;assert.ok(full.gaps.some(g=>g.reason==='not-rendered'));assert.ok(full.gaps.some(g=>g.reason==='frame-not-scanned'));
 const small=(await captureSnapshot(page,{context:true,contextLimit:5,waitMs:0})).contextGraph;
 assert.equal(small.scan.complete,false);assert.ok(small.gaps.some(g=>g.reason==='budget'));assert.ok(small.nodes.length<=5);
});

test('secrets are redacted, long content is retained, open shadow and slots do not duplicate text',async t=>{
 const content='Long article. '.repeat(100);
 const page=await fixture(t,'<p>'+content+'</p><input type="password" value="private123"><textarea name="password">textarea-private</textarea><p>test@example.com</p><x-card><span>Slotted text</span></x-card>');
 await page.evaluate(()=>document.querySelector('x-card').attachShadow({mode:'open'}).innerHTML='<section>Shadow <slot></slot></section>');
 const g=(await capture(page)).contextGraph;const json=JSON.stringify(g);
 assert.ok(g.nodes.some(n=>n.text?.length>500));assert.ok(!json.includes('private123'));assert.ok(!json.includes('textarea-private'));assert.ok(!json.includes('test@example.com'));
 assert.equal(g.nodes.filter(n=>n.text==='Slotted text').length,1);assert.ok(g.nodes.some(n=>n.kind==='shadow'));
});

test('native label and form connections have explicit evidence; default snapshots stay compatible',async t=>{
 const page=await fixture(t,'<form id="f"><button>Search</button></form><label for="city">Destination</label><input id="city" form="f" aria-controls="choices"><ul id="choices"><li>Boston</li></ul>');
 const legacy=await captureSnapshot(page,{waitMs:0});assert.ok(legacy.contextGraph);
 const graph=(await capture(page)).contextGraph;assert.ok(graph.edges.some(e=>e.rel==='labels'&&e.basis==='html'));assert.ok(graph.edges.some(e=>e.rel==='form'&&e.basis==='html'));assert.ok(graph.edges.some(e=>e.rel==='controls'&&e.basis==='aria'));
});

test('identical hrefs do not authorize selecting the first distinct element',async t=>{
 const page=await fixture(t,'<a href="#target" onclick="window.first=true">Details</a><a href="#target" onclick="window.second=true">Details</a>');
 const result=await executePrimitive(page,'click',{locator:{role:'link',name:'Details',exact:true}});
 assert.equal(result.reason,'ambiguous');assert.equal(result.execution,'not_started');assert.equal(await page.evaluate(()=>Boolean(window.first||window.second)),false);
});

test('graph document/time are explicit and later state collection does not claim a single instant',async t=>{
 const page=await fixture(t,'<p>Original</p>');const snap=await capture(page);
 assert.ok(snap.contextGraph.document);assert.ok(snap.collectionTiming.startedAt);assert.ok(snap.collectionTiming.finishedAt);
 assert.equal(snap.collectionTiming.documentChanged,false);assert.equal(snap.stateObservation.simultaneousWithGraph,false);
 const first=snap.contextGraph.document;await page.goto('data:text/html,<p>New document</p>');assert.notEqual((await capture(page)).contextGraph.document,first);
});

test('navigation between content capture and state probe marks the original graph partial',async t=>{
 const page=await fixture(t,'<p>Original content</p>');const original=page.evaluate.bind(page);let moved=false;
 page.evaluate=async(...args)=>{if(!moved){moved=true;await page.goto('data:text/html,<p>Later content</p>');}return original(...args);};
 const snap=await capture(page);
 assert.equal(snap.collectionTiming.documentChanged,true);assert.equal(snap.contextGraph.scan.complete,false);assert.equal(snap.observation.complete,false);
 assert.ok(snap.contextGraph.nodes.some(n=>n.text==='Original content'));assert.ok(!snap.contextGraph.nodes.some(n=>n.text==='Later content'));
 assert.ok(snap.contextGraph.gaps.some(g=>g.reason==='document-changed'));
});
