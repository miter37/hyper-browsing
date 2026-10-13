import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as policy from '../src/runtime/learning-policy.ts';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-learning-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, runtimeDir: path.join(root, '.runtime'), sitesDir: path.join(root, 'sites'), generatedDir: path.join(root, '.generated') };
}

test('visits count independent tasks in a rolling 30-day window', async t => {
  const c = await fixture(t); const now = Date.UTC(2026, 9, 13);
  await policy.recordVisit(c, 'a', 'example.com', 'host:example.com', now);
  await policy.recordVisit(c, 'a', 'example.com', 'host:example.com', now);
  assert.equal((await policy.sitePolicy(c, 'host:example.com', now)).visits, 1);
  await policy.recordVisit(c, 'b', 'example.com', 'host:example.com', now);
  assert.equal((await policy.sitePolicy(c, 'host:example.com', now)).actionEligible, true);
  for (let i=2;i<7;i++) await policy.recordVisit(c, `t${i}`, 'example.com', 'host:example.com', now);
  assert.equal((await policy.sitePolicy(c, 'host:example.com', now)).overviewEligible, true);
  assert.equal((await policy.sitePolicy(c, 'host:example.com', now + 30*86400000 + 1)).visits, 0);
  assert.equal(await fs.stat(c.sitesDir).then(()=>true,()=>false), false);
});

test('notes merge by capability and conditions, with a per-task size limit', async t => {
  const c = await fixture(t);
  await policy.saveNotes(c, 's1', 'host:example.com', [{capability:'filters',conditions:'desktop',text:'날짜 선택 후 적용을 눌러야 한다.'}]);
  await policy.saveNotes(c, 's2', 'host:example.com', [{capability:'filters',conditions:'desktop',text:'날짜 선택 후 적용된 날짜를 확인한다.'}]);
  const notes = await policy.readNotes(c, 'host:example.com', 'filters');
  assert.equal(notes.length, 1); assert.match(notes[0].text, /확인/);
  await assert.rejects(policy.saveNotes(c, 's3', 'host:example.com', [{capability:'x',conditions:'',text:'x'.repeat(601)}]));
});

test('task success may finish with skipped learning and cannot reserve automatic work', async t => {
  const c = await fixture(t);
  const result = await policy.finishLearning(c, 's', {taskStatus:'succeeded',decision:'skipped',reason:'one_off'});
  assert.equal(result.taskStatus, 'succeeded'); assert.equal(result.decision, 'skipped');
  assert.equal((await policy.readDecision(c,'s')).decision, 'skipped');
  await assert.rejects(policy.finishLearning(c,'bad',{taskStatus:'succeeded',decision:'pending',reason:'later'}));
});

test('automatic asset budget is shared, repair bypasses frequency and cooldown', async t => {
  const c = await fixture(t); const key='host:example.com';
  await assert.rejects(policy.claimAsset(c,'s1',key,'action'));
  await policy.recordVisit(c,'s1','example.com',key);
  await policy.recordVisit(c,'s2','example.com',key);
  await policy.claimAsset(c,'s2',key,'action');
  await assert.rejects(policy.claimAsset(c,'s2',key,'overview'));
  await policy.claimAsset(c,'repair',key,'overview',{repair:true});
  await assert.rejects(policy.claimAsset(c,'repair',key,'overview',{repair:true}));
});

test('concurrent visits are not lost', async t => {
  const c=await fixture(t);
  await Promise.all(Array.from({length:7},(_,i)=>policy.recordVisit(c,`s${i}`,'example.com','host:example.com')));
  assert.equal((await policy.sitePolicy(c,'host:example.com')).visits,7);
});
test('registering a site preserves visit counts and overview cooldown',async t=>{
  const c=await fixture(t);
  await policy.recordVisit(c,'s1','example.com','host:example.com');
  await policy.recordVisit(c,'s2','example.com','host:example.com');
  await policy.markOverviewUpdated(c,'host:example.com');
  await policy.recordVisit(c,'s2','example.com','site:example');
  const result=await policy.sitePolicy(c,'site:example');
  assert.equal(result.visits,2);assert.equal(result.overviewRefreshAllowed,false);
});
test('observation pruning enforces age and total bytes without removing notes',async t=>{
  const c=await fixture(t);const dir=path.join(c.runtimeDir,'observations');await fs.mkdir(dir,{recursive:true});
  const old=path.join(dir,'learning-old.json');await fs.writeFile(old,'{}');
  const oldTime=new Date(Date.now()-31*86400000);await fs.utimes(old,oldTime,oldTime);
  const huge=path.join(dir,'learning-huge.json');await fs.writeFile(huge,'x'.repeat(10*1024*1024+1));
  const small=path.join(dir,'learning-small.json');await fs.writeFile(small,'{}');
  const earlier=new Date(Date.now()-1000);await fs.utimes(small,earlier,earlier);
  await policy.saveNotes(c,'s','host:example.com',[{capability:'x',conditions:'',text:'Useful fact'}]);
  await policy.pruneObservations(c);
  assert.equal(await fs.stat(old).then(()=>true,()=>false),false);
  assert.equal(await fs.stat(huge).then(()=>true,()=>false),false);
  assert.equal(await fs.stat(small).then(()=>true,()=>false),true);
  assert.equal((await policy.readNotes(c,'host:example.com')).length,1);
});
