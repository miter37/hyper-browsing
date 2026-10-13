import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as assets from '../src/engine/asset-state.ts';
import { appendMetric, evidenceFor } from '../src/runtime/metrics.ts';
import { SiteSchema } from '../src/schema/site.ts';
import { promoteAfterSuccess } from '../src/engine/lifecycle.ts';
import YAML from 'yaml';
import { effectiveRisk } from '../src/engine/risk.ts';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-repair-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const c={root,runtimeDir:path.join(root,'.runtime')};
  await fs.mkdir(path.join(c.runtimeDir,'metrics'),{recursive:true});
  const definition=SiteSchema.parse({site:{id:'example'},match:{hosts:['example.com']},elements:{result:{strategies:[{css:'#result'}]}},extractors:{result:{element:'result',read:'text'}},actions:{read:{risk:'read',implementation:{kind:'declarative',steps:[]},returns:{extractor:'result'},verify:[{type:'extractor_equals',extractor:'result',value:'{{expected}}'}]}}});
  return {c,loaded:{dir:root,yamlPath:path.join(root,'site.yaml'),definition}};
}
test('revision ignores lifecycle but changes with locators, conditions and code',async t=>{
  const {loaded}=await fixture(t);
  const first=await assets.actionRevision(loaded,'read');
  loaded.definition.actions.read.lifecycle='verified';
  assert.equal(await assets.actionRevision(loaded,'read'),first);
  loaded.definition.elements.result.strategies[0].css='#new-result';
  assert.notEqual(await assets.actionRevision(loaded,'read'),first);
  loaded.definition.actions.read.implementation={kind:'code',export:'read'};
  await fs.writeFile(path.join(loaded.dir,'actions.ts'),'export const actions = {};');
  const code=await assets.actionRevision(loaded,'read');
  await fs.writeFile(path.join(loaded.dir,'actions.ts'),'export const actions = {read:()=>1};');
  assert.notEqual(await assets.actionRevision(loaded,'read'),code);
});
test('environment failure is not suspension; changed revision needs new validation',async t=>{
  const {c}=await fixture(t);
  await assets.recordAssetFailure(c,'example','read','v1','network','s');
  assert.equal((await assets.assetStatus(c,'example','read','v1')).suspended,false);
  await assets.recordAssetFailure(c,'example','read','v1','locator','s');
  assert.equal((await assets.assetStatus(c,'example','read','v1')).suspended,true);
  assert.equal((await assets.assetStatus(c,'example','read','v2')).validationRequired,true);
  await assets.recordAssetSuccess(c,'example','read','v2','repair-session');
  assert.equal((await assets.assetStatus(c,'example','read','v2')).suspended,false);
  assert.equal((await assets.assetStatus(c,'example','read','v1')).suspended,true);
});
test('evidence only counts semantic successes for this revision',async t=>{
  const {c}=await fixture(t);
  const base={timestamp:new Date().toISOString(),site:'example',action:'read',variant:'_unknown',ok:true,verified:'APPLIED',durationMs:1};
  await appendMetric(c,{...base,sessionId:'old'});
  await appendMetric(c,{...base,sessionId:'one',revision:'v1',semanticVerified:true});
  await appendMetric(c,{...base,sessionId:'one',revision:'v1',semanticVerified:true});
  await appendMetric(c,{...base,sessionId:'two',revision:'v1',semanticVerified:true});
  await appendMetric(c,{...base,sessionId:'structural',revision:'v2',semanticVerified:false});
  assert.equal((await evidenceFor(c,'example','read','_unknown','v1')).successfulSessions,2);
  assert.equal((await evidenceFor(c,'example','read','_unknown','v2')).successes,0);
});
test('existence alone cannot certify semantic success, including any branches',()=>{
  const exists={type:'extractor_exists',extractor:'x'};
  const equals={type:'extractor_equals',extractor:'x',value:'0'};
  assert.equal(assets.hasSemanticVerification([exists]),false);
  assert.equal(assets.hasSemanticVerification([{any:[exists,equals]}]),false);
  assert.equal(assets.hasSemanticVerification([{all:[exists,equals]}]),true);
});
test('in-flight success cannot clear a confirmed suspension of the same revision',async t=>{
  const {c}=await fixture(t);
  await assets.recordAssetFailure(c,'example','read','v1','wrong_result','reported');
  await assets.recordAssetSuccess(c,'example','read','v1','old-inflight');
  assert.equal((await assets.assetStatus(c,'example','read','v1')).suspended,true);
});
test('missing code is a versionable broken implementation, not an unhashable asset',async t=>{
  const {loaded}=await fixture(t);loaded.definition.actions.read.implementation={kind:'code',export:'read'};
  const missing=await assets.actionRevision(loaded,'read');
  assert.equal(typeof missing,'string');
  await fs.writeFile(path.join(loaded.dir,'actions.ts'),'export const actions = {};');
  assert.notEqual(await assets.actionRevision(loaded,'read'),missing);
});
test('old revision promotion cannot alter a concurrent replacement',async t=>{
  const {c,loaded}=await fixture(t);
  const revision=await assets.actionRevision(loaded,'read');
  await appendMetric(c,{timestamp:new Date().toISOString(),sessionId:'s',site:'example',action:'read',variant:'_unknown',ok:true,verified:'APPLIED',durationMs:1,revision,semanticVerified:true});
  const replacement=structuredClone(loaded.definition);
  replacement.actions.read.verify=[{type:'extractor_equals',extractor:'result',value:'replacement'}];
  await fs.writeFile(loaded.yamlPath,YAML.stringify(replacement));
  const promotion=await promoteAfterSuccess(c,loaded,'read','_unknown','encoded',false,revision);
  assert.equal(promotion.changed,false);
  assert.equal(YAML.parse(await fs.readFile(loaded.yamlPath,'utf8')).actions.read.lifecycle,'encoded');
});
test('pure extraction remains read-only even when its name contains status',async t=>{
  const {loaded}=await fixture(t);
  assert.equal(effectiveRisk('read_account_status',loaded.definition.actions.read),'read');
});
test('adding an unrelated declarative capability preserves existing revision evidence',async t=>{
  const {loaded}=await fixture(t);const before=await assets.actionRevision(loaded,'read');
  loaded.definition.elements.other={strategies:[{css:'#other'}]};
  loaded.definition.extractors.other={element:'other',read:'text'};
  loaded.definition.actions.other={risk:'read',lifecycle:'encoded',implementation:{kind:'declarative',steps:[]},returns:{extractor:'other'},verify:[]};
  assert.equal(await assets.actionRevision(loaded,'read'),before);
});
