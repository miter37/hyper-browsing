import test from 'node:test';import assert from 'node:assert/strict';
import { chromium } from 'playwright';import { browserOptions } from './browser-options.mjs';import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { renderObservation } from '../src/runtime/hwm/renderer.ts';import { parseHwm } from '../src/runtime/hwm/view.ts';
import { ObservationService } from '../src/runtime/hwm/service.ts';
async function fixture(t,html){const b=await chromium.launch(browserOptions());t.after(()=>b.close());const p=await b.newPage();await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));await p.goto('https://example.test/');return p;}
test('overview folds stored nodes with retrievable gaps and links preserve each independent ref',async t=>{
 const p=await fixture(t,'<main><h1>Results</h1><ul>'+Array.from({length:12},(_,i)=>`<li>Item ${i}<span>$${i}</span><a href="https://example.test/item">Details</a></li>`).join('')+'</ul></main>');const g=(await captureSnapshot(p,{context:true,waitMs:0})).contextGraph;
 const service=new ObservationService();service.remember('s1',g);const result=service.view('s1',g.observation,{mode:'overview',nodeBudget:12});const v=parseHwm(result.hwm);
 assert.equal(v.header.view,'overview');assert.ok(v.entries.filter(e=>e.type==='node').length<g.nodes.length);assert.ok(v.entries.some(e=>e.tag==='gap'&&e.attrs.kind==='folded'));
 assert.ok(v.entries.some(e=>e.type==='node'&&e.attrs['repeated-shapes']));assert.ok(v.entries.some(e=>e.tag==='gap'&&e.attrs.reason==='repeated-shape'));
 const links=v.entries.find(e=>e.tag==='links');assert.equal(links.items[0].attrs.refs.length,12);assert.equal(new Set(links.items[0].attrs.refs).size,12);
 const gap=v.entries.find(e=>e.tag==='gap'&&e.attrs.scope==='nodes');assert.equal(gap.attrs.expand,gap.id);assert.ok(gap.attrs.range.roots.length);const expanded=service.expand('s1',g.observation,gap.attrs.expand);assert.ok(expanded.hwm.includes('Details'));assert.ok(service.inspect('s1',g.observation,g.nodes.find(n=>n.text==='Item 10').id).node.text==='Item 10');
 assert.equal(service.view('s1',g.observation,{mode:'overview',nodeBudget:12}).hwm,result.hwm);
});
test('focus retains card context and external relation endpoints; full expand uses saved heading range',async t=>{
 const p=await fixture(t,'<label id="lab" for="in">Place</label><main><h1>Article</h1><p>Intro</p><h2>Section</h2><p>Read <a href="/a">inline</a> now</p><ul><li>Mouse <b>$18.40</b><input id="in" aria-labelledby="lab"></li><li>Other item</li></ul><h2>Next</h2><p>Later</p></main>');const g=(await captureSnapshot(p,{context:true,waitMs:0})).contextGraph;const service=new ObservationService();service.remember('s1',g);
 const input=g.nodes.find(n=>n.tag==='input');const focus=service.view('s1',g.observation,{mode:'focus',focus:input.actionRef,nodeBudget:30});assert.ok(parseHwm(focus.hwm).entries.some(e=>e.primary?.value==='$18.40'));assert.ok(focus.hwm.includes('Place'));
 for(const ref of [input.id,input.actionRef,'@'+input.actionRef])assert.ok(parseHwm(service.expand('s1',g.observation,ref).hwm).entries.some(e=>e.type==='node'&&e.id===input.actionRef));
 const heading=g.outline[1].node;await p.setContent('<p>New DOM must not appear</p>');const original=service.expand('s1',g.observation,heading);const entries=parseHwm(original.hwm).entries;assert.ok(entries.some(e=>e.primary?.value==='inline'));assert.ok(!entries.some(e=>e.primary?.value==='Later'));assert.ok(!entries.some(e=>e.primary?.value?.includes('New DOM')));
 const overview=service.view('s1',g.observation,{mode:'overview',nodeBudget:10});assert.equal(parseHwm(overview.hwm).entries.find(e=>e.tag==='outline').items[1].attrs.paras.min,g.outline[1].paras.min);
});
test('wrapper compression preserves branching, references and boundaries and long text expands exactly',async t=>{
 const text='Long paragraph. '.repeat(50);const p=await fixture(t,'<main><div><span><p>'+text+'</p></span></div><div id="branch"><b>A</b><b>B</b></div><div aria-busy="false">State</div><div style="overflow:auto;width:40px;height:20px"><p>Scroll content</p></div></main>');const g=(await captureSnapshot(p,{context:true,waitMs:0})).contextGraph;const service=new ObservationService();service.remember('s1',g);
 const result=service.view('s1',g.observation,{mode:'overview',nodeBudget:50,textBudget:40});const v=parseHwm(result.hwm);assert.ok(v.entries.some(e=>e.type==='node'&&(e.attrs.via||e.attrs['via-dom'])));assert.ok(v.entries.some(e=>e.type==='node'&&e.attrs.id==='branch'));assert.ok(v.entries.some(e=>e.type==='node'&&e.attrs.busy===false));assert.ok(v.entries.some(e=>e.type==='node'&&e.attrs['layout-boundary']));
 const clipped=v.entries.find(e=>e.tag==='gap'&&e.attrs.field==='text');assert.ok(clipped);assert.ok(service.expand('s1',g.observation,clipped.id).hwm.includes(text));
});
test('folded changes retain old aliases, independent scan completeness and immutable comparison data',async t=>{
 const p=await fixture(t,'<ul>'+Array.from({length:6},(_,i)=>`<li><button>Old ${i}</button></li>`).join('')+'</ul>');const before=(await captureSnapshot(p,{context:true,waitMs:0})).contextGraph;await p.locator('ul').evaluate(e=>e.innerHTML='<li><button>New</button></li>');const after=(await captureSnapshot(p,{context:true,waitMs:0})).contextGraph;
 const {compareObservations}=await import('../src/runtime/hwm/changes.ts');const changes=compareObservations(before,after);const service=new ObservationService();const comparison=service.rememberComparison('s1',before,after,changes,{execution:'partial',stoppedAt:1});const result=service.comparison('s1',comparison.id,{changeBudget:1});const v=parseHwm(result.hwm);const gap=v.entries.find(e=>e.tag==='gap'&&e.attrs.scope==='changes');assert.ok(gap);assert.equal(gap.attrs['changes-complete'],true);assert.equal(gap.attrs['before-scan-complete'],before.scan.complete);
 const expanded=service.expandChanges('s1',comparison.id,gap.id);const records=parseHwm(expanded.hwm).entries.filter(e=>e.tag==='change');assert.ok(records.some(e=>e.attrs.op==='removed'&&String(e.attrs.before.node).startsWith('e')));assert.equal(expanded.changes.length,changes.length-1);
});
test('masked destinations remain separate links instead of forming a false same-destination group',()=>{
 const g={version:'0.2',observation:'pMasked',document:'d1',capturedAt:'2026-10-14T06:00:00Z',url:'https://example.test',scan:{scope:'fixture',complete:true},nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'link',parent:'n1',order:0,actionRef:'e11',attrs:{href:'/item?token=one'}},{id:'n3',kind:'link',parent:'n1',order:1,actionRef:'e12',attrs:{href:'/item?token=two'}}],edges:[],gaps:[],matches:[]};
 const service=new ObservationService();service.remember('s1',g);const result=service.view('s1',g.observation);const index=parseHwm(result.hwm).entries.find(e=>e.tag==='links');assert.ok(index);assert.equal(index.items.length,2);assert.ok(index.items.every(i=>i.attrs.refs.length===1&&i.attrs['destination-identity']==='redacted'));assert.ok(!result.hwm.includes('token=one'));assert.ok(!result.hwm.includes('token=two'));
});
test('legacy sensitive field rules also protect graphs, store, inspect and expansion',async t=>{
 const p=await fixture(t,'<input autocomplete="cc-number" value="4111111111111111"><input name="cvv" value="123"><input autocomplete="one-time-code" value="987654"><textarea autocomplete="one-time-code">654321</textarea>');
 const snapshot=await captureSnapshot(p,{context:true,waitMs:0});const g=snapshot.contextGraph,service=new ObservationService();service.remember('s1',g);
 const serialized=JSON.stringify(g);for(const value of ['4111111111111111','987654','654321'])assert.ok(!serialized.includes(value));
 for(const node of g.nodes.filter(n=>['input','textarea'].includes(n.tag))){assert.ok(node.attrs.redactedFields.includes('value'));assert.equal(node.attrs.value,undefined);assert.equal(service.inspect('s1',g.observation,node.id).node.attrs.value,undefined);const v=parseHwm(service.expand('s1',g.observation,node.id).hwm);assert.ok(v.entries.some(e=>e.tag==='gap'&&e.attrs.kind==='redacted'));}
});
test('text folding counts Unicode code points and never splits a surrogate pair',()=>{
 const g={version:'0.2',observation:'pUnicode',document:'d1',capturedAt:'2026-10-14T06:00:00Z',url:'https://example.test',scan:{scope:'fixture',complete:true},nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'text',parent:'n1',order:0,text:'😀x',textSource:'dom-text',attrs:{}}],edges:[],gaps:[],matches:[]};const service=new ObservationService();service.remember('s1',g);
 const v=parseHwm(service.view('s1',g.observation,{mode:'overview',textBudget:1}).hwm),node=v.entries.find(e=>e.id==='n2'),gap=v.entries.find(e=>e.tag==='gap');assert.equal(node.primary.value,'😀');assert.equal(node.attrs['primary-length'],2);assert.equal(gap.attrs.chars.min,1);assert.ok(service.expand('s1',g.observation,gap.id).hwm.includes('😀x'));
});
test('focus retains rendered dialog declarations without calling them proven occluders',async t=>{
 const p=await fixture(t,'<main><input aria-label="Place"></main><div role="dialog" aria-label="Sign in"><button>Close</button></div><div role="dialog" hidden aria-label="Hidden dialog">Hidden</div>');const g=(await captureSnapshot(p,{context:true,waitMs:0})).contextGraph,service=new ObservationService();service.remember('s1',g);
 const v=parseHwm(service.view('s1',g.observation,{mode:'focus',focus:g.nodes.find(n=>n.tag==='input').actionRef}).hwm);assert.ok(v.entries.some(e=>e.primary?.value==='Sign in'));assert.ok(v.entries.some(e=>e.primary?.value==='Close'));assert.ok(!v.entries.some(e=>e.primary?.value==='Hidden dialog'));assert.ok(!v.entries.some(e=>e.type==='node'&&e.relations.some(r=>r.rel==='covered-by')));
});
