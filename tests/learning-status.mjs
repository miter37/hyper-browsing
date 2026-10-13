import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordVisit } from '../src/runtime/learning-policy.ts';
import { learningStatus } from '../src/runtime/learning.ts';
test('learning status exposes visit policy even without a discovery journal',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-status-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const c={runtimeDir:root};
  await recordVisit(c,'a','example.com','site:example');await recordVisit(c,'b','example.com','site:example');
  const result=await learningStatus(c,'b');assert.equal(result.policy.visits,2);assert.equal(result.policy.actionEligible,true);
});
test('a pre-registration journal resolves the migrated site policy',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-status-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const c={runtimeDir:root};
  await recordVisit(c,'a','example.com','host:example.com');await recordVisit(c,'b','example.com','host:example.com');
  await fs.mkdir(path.join(root,'observations'),{recursive:true});
  await fs.writeFile(path.join(root,'observations','learning-b.json'),JSON.stringify({siteId:'example_com',host:'example.com',key:'host:example.com',events:[]}));
  await recordVisit(c,'b','example.com','site:example');
  assert.equal((await learningStatus(c,'b')).policy.visits,2);
});
