import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHwm, serializeHwm, validateHwm } from '../src/runtime/hwm/view.ts';

const header='@hwm p1 version="0.2" session="s1" document="d1" url="https://example.test/" view="overview" captured-at="2026-10-14T06:00:00Z" scan={"scope":"fixture","complete":true} collected=["text"]';
const wrap=body=>`${header}\nn1 document\n${body}\n@end p1 complete\n`;

test('consent fixtures parse, validate and round trip with the same meaning',async()=>{
 for(let i=1;i<=4;i++){
  const source=await fs.readFile(new URL(`./fixtures/hwm/fixture-${i}.hwm`,import.meta.url),'utf8');
  const ast=parseHwm(source);assert.deepEqual(validateHwm(ast),[]);
  assert.deepEqual(parseHwm(serializeHwm(ast)),ast);
 }
});

test('quoted page syntax stays data; whitespace and JSON nesting are preserved',()=>{
 const source=wrap('  t1 text "@end p1 complete \\n ->controls:g9 \\"quoted\\"" metadata={"a":["x y",{"z":2}]}');
 const ast=parseHwm(source);assert.match(ast.entries[1].primary.value,/@end/);
 assert.deepEqual(ast.entries[1].attrs.metadata,{a:['x y',{z:2}]});
 assert.deepEqual(parseHwm(serializeHwm(ast)),ast);
});

test('defaults and unknown source are distinct; multiple inline targets are retained',()=>{
 const ast=parseHwm(wrap('  t1 text "Label"\n  e1 control "Search"@? ->controls:g1@aria ->controls:g2@aria\n  g1 group\n  g2 group'));
 assert.equal(ast.entries[1].primary.source,'dom-text');assert.equal(ast.entries[2].primary.source,null);
 assert.equal(ast.entries[2].relations.length,2);assert.deepEqual(validateHwm(ast),[]);
});

test('records do not change the parent stack; block rows are not tree nodes',()=>{
 const ast=parseHwm(wrap('  g1 group\n    t1 text "A"\n@gap gp1 kind="unobserved" reason="not-rendered" parent="g1"\n  g2 group\n@candidates q1 query="A" scope="n1"\n- t1 match="text"'));
 assert.equal(ast.entries.find(x=>x.id==='g2').parent,'n1');assert.deepEqual(validateHwm(ast),[]);
});

test('malformed JSON, duplicate keys and ambiguous indentation are rejected',()=>{
 for(const body of ['  e1 control value=unquoted','  e1 control value="a" value="b"','  e1 control meta={"x":1,"x":2}','   e1 control','    e1 control']) assert.throws(()=>parseHwm(wrap(body)));
 assert.throws(()=>parseHwm(wrap('@edge r1 from="n1" rel="form" to="n1"\n- n1 value="x"')));
});

test('validation catches duplicate IDs, missing targets and missing root/heading level',()=>{
 for(const body of ['  t1 text "A"\n  t1 text "B"','  e1 control ->controls:g99@aria','  h1 heading "A"','@edge n1 from="n1" rel="form" to="n1"']) assert.ok(validateHwm(parseHwm(wrap(body))).length);
 assert.ok(validateHwm(parseHwm(`${header}\ng1 group\n@end p1 complete`)).length);
});

test('truncated envelope remains explicit and is not accepted as a complete observation',()=>{
 const ast=parseHwm(`${header}\nn1 document\n`);assert.equal(ast.end,null);assert.ok(validateHwm(ast).some(x=>x.code==='missing_end'));
 assert.throws(()=>parseHwm(`${wrap('')}@state late complete=true`));
});

test('changed records require before/after and identity while added uses only after',()=>{
 const wrong=parseHwm(wrap('  e1 control\n@change c1 op="changed" after={"obs":"p1","node":"e1"} field="value" old="a" new="b"'));
 assert.ok(validateHwm(wrong).length);
 const good=parseHwm(wrap('  e1 control\n@change c1 op="added" after={"obs":"p1","node":"e1"}'));
 assert.deepEqual(validateHwm(good),[]);
});

test('dangling references cannot hide behind a folded gap without graph evidence',()=>{
 const ast=parseHwm(wrap('  g1 list\n@gap gp1 kind="folded" reason="budget" parent="g1" range={"after-order":0,"items":1}\n@links l1\n- "https://example.test/a" refs=["e99"] total=1 refs-complete=true'));
 assert.ok(validateHwm(ast).some(x=>x.code==='missing_target'));
 assert.deepEqual(validateHwm(ast,{foldedTargets:{e99:'gp1'}}),[]);
});

test('validator rejects invalid header types, graph cycles and false completeness claims',()=>{
 const ast=parseHwm(wrap('  g1 group\n    t1 text "A"'));
 ast.header.scan={complete:'yes',scope:'fixture'};assert.ok(validateHwm(ast).some(x=>x.code==='header'));
 ast.header.scan={complete:true,scope:'fixture'};ast.entries[1].parent='t1';assert.ok(validateHwm(ast).some(x=>x.code==='parent_cycle'));
 const links=parseHwm(wrap('  e1 link "A"\n@links l1 complete=true\n- "https://example.test/a" refs=["e1"] total={"min":17,"exact":true} refs-complete=true'));
 assert.ok(validateHwm(links).some(x=>x.code==='links_count'));
});

test('explicit edge types and source uncertainty cannot contradict the view',()=>{
 const edge=parseHwm(wrap('@edge r1 from="n1" rel="controls" to="n1" basis="html"'));
 assert.ok(validateHwm(edge).some(x=>x.code==='relation'));
 const source=parseHwm(wrap('  e1 control "A" name-source=null'));
 assert.ok(validateHwm(source).some(x=>x.code==='source'));
});

test('partial batch execution preserves its stop location and step evidence',()=>{
 const ast=parseHwm(`${header}\n@result x1 request="req7" execution="partial" stoppedAt=1 results=[{"execution":"completed"},{"execution":"not_started"}] rollback=false\nn1 document\n@end p1 complete`);
 assert.deepEqual(validateHwm(ast),[]);assert.deepEqual(parseHwm(serializeHwm(ast)),ast);
});
