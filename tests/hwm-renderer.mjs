import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { renderObservation } from '../src/runtime/hwm/renderer.ts';
import { parseHwm, validateHwm } from '../src/runtime/hwm/view.ts';

test('real graph renders without rereading DOM, using one alias map for nodes and matches',async t=>{
 const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<main><h1>Results</h1><p>Read <a href="/a">Details</a> now.</p><label for="x">Place</label><input id="x"><a href="/b">Details</a></main>');
 const snapshot=await captureSnapshot(page,{context:true,query:'Details',waitMs:0});const graph=snapshot.contextGraph;
 const before=JSON.stringify(graph);await page.setContent('<p>Changed after observation</p>');
 const hwm=renderObservation(graph,{session:'s1'});assert.equal(renderObservation(graph,{session:'s1'}),hwm);assert.equal(JSON.stringify(graph),before);
 const view=parseHwm(hwm);assert.deepEqual(validateHwm(view),[]);assert.ok(hwm.includes('Results'));assert.ok(!hwm.includes('Changed after observation'));
 for(const node of graph.nodes.filter(n=>n.actionRef))assert.ok(view.entries.some(e=>e.type==='node'&&e.id===node.actionRef));
 const record=view.entries.find(e=>e.tag==='candidates');assert.ok(record.items.every(i=>view.entries.some(e=>e.id===i.ref)));
 assert.ok(view.entries.some(e=>e.type==='node'&&e.relations.some(r=>r.rel==='labels'&&r.basis==='html')));
});

test('renderer retains explicit unknowns, partial results and gaps with original content',()=>{
 const graph={version:'0.2',observation:'p1',document:'d1',capturedAt:'2026-10-14T06:00:00Z',url:'https://example.test',scan:{scope:'fixture',complete:false},nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'control',parent:'n1',order:0,actionRef:'e41',attrs:{value:'',checked:null}}],edges:[],gaps:[{id:'gap1',kind:'unobserved',reason:'budget',parent:'n1'}],matches:[]};
 const view=parseHwm(renderObservation(graph,{session:'s1',result:{request:'req1',execution:'partial',stoppedAt:1,results:[{execution:'completed'}]}}));
 assert.deepEqual(validateHwm(view),[]);assert.equal(view.entries.find(e=>e.id==='e41').attrs.checked,null);assert.equal(view.entries.find(e=>e.tag==='gap').attrs.kind,'unobserved');
});

test('removed references use the old observation alias and foreign observation addresses are rejected',()=>{
 const base={version:'0.2',capturedAt:'2026-10-14T06:00:00Z',url:'https://example.test',document:'d1',scan:{scope:'fixture',complete:true},edges:[],gaps:[],matches:[]};
 const before={...base,observation:'p1',nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'control',parent:'n1',order:0,actionRef:'e41',attrs:{}}]};
 const after={...base,observation:'p2',nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'control',parent:'n1',order:0,actionRef:'e42',attrs:{}}]};
 const changes=[{op:'removed',before:{obs:'p1',node:'n2'}},{op:'added',after:{obs:'p2',node:'n2'}}];
 const view=parseHwm(renderObservation(after,{session:'s1',before,changes}));const records=view.entries.filter(e=>e.tag==='change');
 assert.equal(records[0].attrs.before.node,'e41');assert.equal(records[1].attrs.after.node,'e42');
 assert.throws(()=>renderObservation(after,{session:'s1',before,changes:[{op:'removed',before:{obs:'pForeign',node:'n2'}}]}),/observation/i);
});
