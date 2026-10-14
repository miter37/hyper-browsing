import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationStore } from '../src/runtime/hwm/store.ts';
const graph=id=>({version:'0.2',observation:id,document:'d1',capturedAt:'2026-10-14T06:00:00Z',url:'https://example.test',scan:{scope:'fixture',complete:true},nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'text',parent:'n1',order:0,text:'Original',textSource:'dom-text',attrs:{}}],edges:[],gaps:[],matches:[]});
test('stored observations are detached, scoped, masked and expire without rereading anything',()=>{
 let now=0;const store=new ObservationStore({ttlMs:100,clock:()=>now});const g=graph('p1');g.nodes[1].text='user@example.com';assert.equal(store.put('s1',g).ok,true);g.nodes[1].text='Mutated';
 const saved=store.get('s1','p1');assert.ok(!JSON.stringify(saved).includes('user@example.com'));saved.graph.nodes[1].text='Caller mutation';assert.notEqual(store.get('s1','p1').graph.nodes[1].text,'Caller mutation');
 assert.throws(()=>store.get('s2','p1'),e=>e.code==='observation_scope_mismatch');now=100;assert.throws(()=>store.get('s1','p1'),e=>e.code==='observation_expired');
});
test('FIFO count/byte bounds reject oversized data and comparison requires both original observations',()=>{
 const store=new ObservationStore({maxObservations:2,maxBytes:10000,maxObservationBytes:3000});store.put('s1',graph('p1'));store.put('s1',graph('p2'));const comparison=store.compare('s1','p1','p2',[{op:'removed',before:{obs:'p1',node:'n2'}}]);assert.equal(store.getComparison('s1',comparison.id).before.graph.observation,'p1');
 store.put('s1',graph('p3'));assert.throws(()=>store.get('s1','p1'),e=>e.code==='observation_expired');assert.throws(()=>store.getComparison('s1',comparison.id),e=>e.code==='comparison_expired');
 const big=graph('p4');big.nodes[1].text='prose '.repeat(1000);assert.equal(store.put('s1',big).ok,false);assert.ok(store.stats().serializedBytes<=10000);assert.equal(store.stats().observations,2);
});
test('comparison TTL and session cleanup are independent of browser state',()=>{
 let now=0;const store=new ObservationStore({ttlMs:100,clock:()=>now});store.put('s1',graph('p1'));store.put('s1',graph('p2'));const c=store.compare('s1','p1','p2',[]);now=100;assert.throws(()=>store.getComparison('s1',c.id),e=>e.code==='comparison_expired');
 store.put('s1',graph('p3'));store.clearSession('s1');assert.throws(()=>store.get('s1','p3'),e=>e.code==='observation_expired');
});
test('malformed parent cycles are rejected before storage and projection',()=>{
 const store=new ObservationStore(),bad=graph('pCycle');bad.nodes[1].parent='n2';assert.throws(()=>store.put('s1',bad),e=>e.code==='invalid_observation_graph');
});
