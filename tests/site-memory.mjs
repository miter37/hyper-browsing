import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describeUrlChange, rememberTyped, recordMemoryStep, draftMemory, saveFacts, memoryFor, closeMemory, acceptDraft, removeNotes } from '../src/runtime/site-memory.ts';

const config = async () => ({ runtimeDir: await fs.mkdtemp(path.join(os.tmpdir(), 'hb-mem-')) });
const P = 'https://shop.test/search';

test('a URL change tells the search parameter by name and the choices a control set, without tracking ids',()=>{
  rememberTyped('s1','무선 마우스');
  const c=describeUrlChange('s1','https://shop.test/','https://shop.test/search?q=%EB%AC%B4%EC%84%A0+%EB%A7%88%EC%9A%B0%EC%8A%A4&channel=user&utm_source=x&srpvid=89ab474e089e00d8');
  assert.equal(c.queryParam,'q');assert.deepEqual(c.setParams,{channel:'user'});
  const s=describeUrlChange('s1','https://shop.test/search?q=%EB%AC%B4%EC%84%A0+%EB%A7%88%EC%9A%B0%EC%8A%A4&channel=user','https://shop.test/search?q=%EB%AC%B4%EC%84%A0+%EB%A7%88%EC%9A%B0%EC%8A%A4&channel=user&sorter=salePriceAsc&sid=AbC123def456GhI789');
  assert.equal(s.queryParam,'q');
  assert.deepEqual(s.setParams,{sorter:'salePriceAsc'});assert.deepEqual(s.keptParams,{channel:'user'});
});

test('a session drafts facts for search, controls, frames and blocks; auto mode saves them; the next visit shows them',async()=>{
  const c=await config();
  process.env.WEBAGENT_SITE_MEMORY='auto';
  const base={host:'shop.test',key:'host:shop.test',path:P};
  await recordMemoryStep(c,'s2',{...base,kind:'fill',queryParam:'q',keptParams:{channel:'user'},control:{role:'searchbox',name:'검색'},submit:true});
  await recordMemoryStep(c,'s2',{...base,kind:'click',setParams:{sorter:'salePriceAsc'},control:{role:'radio',name:'낮은가격순'}});
  await recordMemoryStep(c,'s2',{...base,kind:'verify',path:'',verified:[{name:'sorter',expected:'salePriceAsc'}]});
  await recordMemoryStep(c,'s2',{...base,kind:'click',frame:'searchIframe',frameUrl:'https://list.shop.test/list?x=1',control:{role:'link',name:'Cafe 1'}});
  await recordMemoryStep(c,'s2',{host:'other.test',key:'host:other.test',path:'https://other.test/checkpoint',kind:'blocked',blocked:{kind:'bot-challenge',evidence:'unusual browser activity'}});
  const facts=await draftMemory(c,'s2');
  const by=Object.fromEntries(facts.map(f=>[f.capability,f.text]));
  assert.match(by.search,/search\?q=\{query\}&channel=user/);
  const sort=facts.find(f=>f.capability.startsWith('control:sorter'));
  assert.match(sort.text,/radio "낮은가격순" sets sorter=salePriceAsc .*confirmed with verify/);
  assert.match(by['frame:searchIframe'],/pass frame "searchIframe"/);
  assert.equal(facts.find(f=>f.capability==='blocked').key,'host:other.test');
  const closed=await closeMemory(c,'s2');
  assert.ok(closed.saved.length>=4);
  const shown=await memoryFor(c,'host:shop.test','shop.test');
  assert.ok(shown.notes.some(n=>n.includes('sorter=salePriceAsc')));assert.ok(shown.hint);
  assert.equal(await memoryFor(c,'host:none.test','none.test'),undefined);
  await removeNotes(c,'host:shop.test',['search']);
  assert.ok(!(await memoryFor(c,'host:shop.test','shop.test')).notes.some(n=>n.startsWith('[search]')));
});

test('suggest mode offers the draft and keeps only accepted facts',async()=>{
  const c=await config();
  process.env.WEBAGENT_SITE_MEMORY='suggest';
  await recordMemoryStep(c,'s3',{host:'shop.test',key:'host:shop.test',path:P,kind:'click',setParams:{sort:'stars'},control:{role:'menuitem',name:'Most stars'}});
  await recordMemoryStep(c,'s3',{host:'shop.test',key:'host:shop.test',path:P,kind:'click',setParams:{l:'TypeScript'},control:{role:'link',name:'TypeScript'}});
  const closed=await closeMemory(c,'s3');
  assert.equal(closed.draft.length,2);assert.equal(await memoryFor(c,'host:shop.test','shop.test'),undefined);
  await acceptDraft(c,'s3',[closed.draft[0].id]);
  assert.equal((await memoryFor(c,'host:shop.test','shop.test')).notes.length,1);
  process.env.WEBAGENT_SITE_MEMORY='off';
  assert.equal(await closeMemory(c,'s3'),undefined);
  delete process.env.WEBAGENT_SITE_MEMORY;
});

test('engine facts per site are bounded',async()=>{
  const c=await config();
  const facts=Array.from({length:20},(_,i)=>({id:'f'+i,capability:'control:p'+i,text:'t'+i,key:'host:a.test',evidence:'x'}));
  await saveFacts(c,facts,'auto',12);
  assert.equal((await memoryFor(c,'host:a.test','a.test',50)).notes.length,12);
});

test('the search fact is the first search, and later filters stay separate control facts',async()=>{
  const c=await config();
  const base={host:'gh.test',key:'host:gh.test',path:'https://gh.test/search'};
  await recordMemoryStep(c,'s5',{...base,kind:'fill',queryParam:'q',setParams:{type:'repositories'},control:{role:'combobox',name:'Search'},submit:true});
  await recordMemoryStep(c,'s5',{...base,kind:'click',queryParam:'q',keptParams:{type:'repositories'},setParams:{l:'TypeScript'},control:{role:'link',name:'TypeScript'}});
  const facts=await draftMemory(c,'s5');
  const search=facts.find(f=>f.id==='search');
  assert.equal(search.text,'Search results load at https://gh.test/search?q={query}&type=repositories (found by typing in the search field and pressing Enter).');
  assert.ok(!facts.some(f=>f.id.includes('combobox')));
  assert.match(facts.find(f=>f.id.startsWith('control:l:')).text,/link "TypeScript" sets l=TypeScript/);
});
