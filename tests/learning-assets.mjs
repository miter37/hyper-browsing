import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { recordLearningEvent, learningStatus, encodeObservedExtraction } from '../src/runtime/learning.ts';
import { saveObservedAction } from '../src/runtime/learning-assets.ts';
import { saveOverview, runOverview } from '../src/runtime/overview.ts';
import { recordVisit } from '../src/runtime/learning-policy.ts';
import { getConfig } from '../src/config.ts';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { runKnownAction } from '../src/engine/action-runner.ts';
import { loadSite } from '../src/engine/site-loader.ts';
import YAML from 'yaml';
import { browserOptions } from './browser-options.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-assets-'));
  const c={...getConfig(),root,runtimeDir:path.join(root,'.runtime'),sitesDir:path.join(root,'sites'),generatedDir:path.join(root,'.generated'),profileDir:path.join(root,'profile'),chromeProfileStrategy:'managed'};
  await fs.mkdir(c.sitesDir,{recursive:true});
  await fs.mkdir(path.join(c.runtimeDir,'metrics'),{recursive:true});
  const browser=await chromium.launch(browserOptions());
  const context=await browser.newContext();
  const requests=[];
  await context.route('https://example.test/**',route=>{
    const pathname=new URL(route.request().url()).pathname; requests.push(pathname);
    return route.fulfill({contentType:'text/html',body:pathname==='/'?'<h1>Home</h1><a href="/list">Listings</a><a href="/delete">Delete</a><button>Search</button>':pathname==='/list'?'<h1>Listings</h1><p id="result">0</p><a href="/detail">Detail</a>':'<h1>Detail</h1>'});
  });
  const page=await context.newPage(); await page.goto('https://example.test/');
  t.after(async()=>{await browser.close();await fs.rm(root,{recursive:true,force:true});});
  return {c,page,requests};
}
test('first observations never create site assets or block completion',async t=>{
  const {c,page}=await fixture(t);
  await recordLearningEvent(c,page,'s1','click',{locator:{role:'button',name:'Search'},value:'private-input'});
  const status=await learningStatus(c,'s1');
  assert.equal(status.learningPending,false);assert.equal(status.policy.visits,1);
  assert.deepEqual(await fs.readdir(c.sitesDir),[]);
  const journal=await fs.readFile(status.journal,'utf8');assert.equal(journal.includes('private-input'),false);
});
test('second task saves observed action, preserving existing skill and code',async t=>{
  const {c,page}=await fixture(t);
  await recordLearningEvent(c,page,'s1','extract',{locator:{css:'#result'},read:'text'});
  await page.goto('https://example.test/list');
  await recordLearningEvent(c,page,'s2','extract',{locator:{css:'#result'},read:'text'});
  await fs.mkdir(path.join(c.sitesDir,'example'),{recursive:true});
  await fs.writeFile(path.join(c.sitesDir,'example','SKILL.md'),'existing skill');
  await fs.writeFile(path.join(c.sitesDir,'example','actions.ts'),'existing code');
  const payload={id:'read_count',capability:'read-count',scope:'Listings page; confirmed only for current language',
    elements:{result:{strategies:[{css:'#result'}]}},extractors:{count:{element:'result',read:'text'}},
    action:{risk:'read',implementation:{kind:'declarative',steps:[]},returns:{extractor:'count'},verify:[{type:'extractor_equals',extractor:'count',value:'{expected}'}]}};
  const result=await saveObservedAction(c,page,'s2',payload);
  assert.equal(result.saved,true);
  assert.equal(await fs.readFile(path.join(c.sitesDir,'example','SKILL.md'),'utf8'),'existing skill');
  assert.equal(await fs.readFile(path.join(c.sitesDir,'example','actions.ts'),'utf8'),'existing code');
});
test('overview preserves source, explores one level and distinguishes candidates',async t=>{
  const {c,page,requests}=await fixture(t);
  for(let i=0;i<7;i++) await recordVisit(c,`s${i}`,'example.test','host:example.test');
  await recordLearningEvent(c,page,'s6','snapshot',{});
  await page.goto('https://example.test/list');await recordLearningEvent(c,page,'s6','goto',{});
  await page.goto('https://example.test/');
  await saveOverview(c,page,'s6',{routes:[{url:'https://example.test/list',label:'Listings',readOnly:true}]});
  const result=await runOverview(c,page,'run',{siteId:'example_test'});
  assert.equal(result.ok,true); assert.equal(result.screens.length,2);
  assert.equal(page.url(),'https://example.test/'); assert.equal(requests.includes('/detail'),false);
  assert.equal(result.screens[0].candidates.find(v=>v.name==='Search').verified,false);
  await recordLearningEvent(c,page,'next','snapshot',{});
  await assert.rejects(saveOverview(c,page,'next',{routes:[]}),/cooldown/i);
});
test('overview refuses unobserved or destructive routes',async t=>{
  const {c,page}=await fixture(t);
  await recordLearningEvent(c,page,'s','snapshot',{});
  await assert.rejects(saveOverview(c,page,'s',{requested:true,routes:[{url:'https://example.test/delete',label:'Delete',readOnly:true}]}));
  await assert.rejects(saveOverview(c,page,'s',{requested:true,routes:[{url:'https://example.test/list',label:'Listings',readOnly:true}]}));
});

test('daemon learning APIs finish independently, expose notes, and close after storage failure',async t=>{
  const {c,page}=await fixture(t);
  const daemon=new BrowserDaemon(c);
  daemon.context=page.context();
  daemon.chrome={ensureConnected:async()=>page.context()};
  let closed=false;
  daemon.sessions={get:()=>page,close:async()=>{closed=true;},ignore:()=>{}};
  await daemon.dispatch('page.snapshot',{sessionId:'s'});
  const saved=await daemon.dispatch('learning.notes.save',{sessionId:'s',notes:[{capability:'filters',conditions:'desktop',text:'적용된 조건을 다시 확인한다.'}]});
  assert.equal(saved.saved,1);
  const notes=await daemon.dispatch('learning.notes',{sessionId:'s',capability:'filters'});
  assert.equal(notes.notes.length,1);
  const done=await daemon.dispatch('learning.finish',{sessionId:'s',taskStatus:'succeeded',decision:'skipped',reason:'one_off'});
  assert.equal(done.taskStatus,'succeeded');
  // Make bookkeeping unavailable after task completion; close must still succeed.
  await fs.rm(path.join(c.runtimeDir,'observations'),{recursive:true,force:true});
  await fs.writeFile(path.join(c.runtimeDir,'observations'),'blocked');
  const result=await daemon.dispatch('session.close',{sessionId:'s'});
  assert.equal(closed,true);assert.equal(result.closed,'s');assert.equal(result.learning_pending,false);
});

test('a failed action falls back, is repaired in place, and validates only the new version',async t=>{
  const {c,page}=await fixture(t);await page.goto('https://example.test/list');
  const dir=path.join(c.sitesDir,'example');await fs.mkdir(dir,{recursive:true});
  const doc={site:{id:'example'},match:{hosts:['example.test']},elements:{wrong:{strategies:[{css:'#result'}]}},extractors:{count:{element:'wrong',read:'text'}},actions:{read_count:{risk:'read',implementation:{kind:'declarative',steps:[]},returns:{extractor:'count'},verify:[{type:'extractor_equals',extractor:'count',value:'1'}]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),YAML.stringify(doc));
  let loaded=await loadSite(c,'example');
  const failed=await runKnownAction(c,page,loaded,{sessionId:'one',actionId:'read_count',input:{}});
  assert.equal(failed.ok,false);assert.equal(failed.recovery.suspended,true);
  const repeat=await runKnownAction(c,page,loaded,{sessionId:'two',actionId:'read_count',input:{}});
  assert.equal(repeat.stage,'preflight');assert.equal(repeat.fallbackRequired,true);
  // Agent observes actual result, completes task, and replaces only this capability.
  await recordLearningEvent(c,page,'repair','extract',{locator:{css:'#result'},read:'text'});
  const repaired=await saveObservedAction(c,page,'repair',{id:'read_count',capability:'read-count',scope:'Listings count',action:{...doc.actions.read_count,verify:[{type:'extractor_equals',extractor:'count',value:'{expected}'}]},validationInput:{expected:'0'}});
  assert.equal(repaired.repair,true);assert.equal(repaired.validation.ok,true);
  assert.notEqual(repaired.revision,failed.revision);
  assert.equal(repaired.validation.promotion.to,'candidate');
  loaded=await loadSite(c,'example');
  const next=await runKnownAction(c,page,loaded,{sessionId:'independent',actionId:'read_count',input:{expected:'0'}});
  assert.equal(next.promotion.to,'verified');
});
test('saving a declared-read click never replays a write for validation',async t=>{
  const {c,page}=await fixture(t);
  await page.setContent('<h1>Home</h1><button id="confirm-reservation" onclick="window.sent=(window.sent||0)+1">Confirm</button><p id="result">1</p>');
  await page.locator('#confirm-reservation').click();
  await recordLearningEvent(c,page,'s1','click',{locator:{css:'#confirm-reservation'}});
  await recordLearningEvent(c,page,'s2','click',{locator:{css:'#confirm-reservation'}});
  const result=await saveObservedAction(c,page,'s2',{id:'confirm_booking',capability:'confirm-booking',scope:'Observed confirmation screen',
    elements:{primary:{strategies:[{css:'#confirm-reservation'}]},result:{strategies:[{css:'#result'}]}},extractors:{count:{element:'result',read:'text'}},
    action:{risk:'read',implementation:{kind:'declarative',steps:[{op:'click',element:'primary'}]},verify:[{type:'extractor_equals',extractor:'count',value:'1'}]},validationInput:{}});
  assert.equal(await page.evaluate(()=>window.sent),1);
  assert.equal(result.validation,undefined);
});
test('login and verification UNKNOWN do not suspend healthy revisions',async t=>{
  const {c,page}=await fixture(t);await page.goto('https://example.test/list');
  const dir=path.join(c.sitesDir,'example');await fs.mkdir(dir,{recursive:true});
  const doc={site:{id:'example'},match:{hosts:['example.test']},elements:{result:{strategies:[{css:'#result'}]}},extractors:{count:{element:'result',read:'text'}},actions:{read_count:{risk:'read',implementation:{kind:'declarative',steps:[]},verify:[{type:'extractor_equals',extractor:'count',value:'0'}]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),YAML.stringify(doc));
  const loaded=await loadSite(c,'example');
  await page.setContent('<h1>Sign in</h1><input type="password">');
  const loggedOut=await runKnownAction(c,page,loaded,{sessionId:'auth',actionId:'read_count',input:{}});
  assert.equal(loggedOut.failureClass,'auth');assert.equal(loggedOut.recovery.suspended,false);
  await page.setContent('<h1>Listings</h1><p id="result">0</p>');
  // Verification errors are retained as UNKNOWN rather than assumed structural damage.
  loaded.definition.actions.read_count.verify=[{type:'extractor_equals',extractor:'count',value:'{missing}'}];
  const unknown=await runKnownAction(c,page,loaded,{sessionId:'unknown',actionId:'read_count',input:{}});
  assert.equal(unknown.verification.outcome,'UNKNOWN');assert.equal(unknown.recovery.suspended,false);
});
test('CLI locator defaults do not prevent encoding an observed extraction',async t=>{
  const {c,page}=await fixture(t);await page.goto('https://example.test/list');
  await recordLearningEvent(c,page,'s1','extract',{locator:{css:'#result',exact:false},read:'text'});
  await recordLearningEvent(c,page,'s2','extract',{locator:{css:'#result',exact:false},read:'text'});
  const result=await saveObservedAction(c,page,'s2',{id:'count',capability:'count',scope:'Listings',elements:{result:{strategies:[{css:'#result'}]}},extractors:{count:{element:'result',read:'text'}},action:{risk:'read',implementation:{kind:'declarative',steps:[]},returns:{extractor:'count'},verify:[]}});
  assert.equal(result.saved,true);
});
test('concurrent extraction encoding and action saving preserve both capabilities',async t=>{
  const {c,page}=await fixture(t);await page.goto('https://example.test/list');
  await recordLearningEvent(c,page,'s1','extract',{locator:{css:'#result'},read:'text'});
  await recordLearningEvent(c,page,'s2','extract',{locator:{css:'#result'},read:'text'});
  // Initialize a known site before racing updates, to isolate file-update behavior.
  await encodeObservedExtraction(c,page,'s1',{css:'#result'},'text',undefined,true);
  await recordLearningEvent(c,page,'s3','extract',{locator:{css:'#result'},read:'text'});
  await Promise.all([
    encodeObservedExtraction(c,page,'s2',{css:'#result'},'attribute','data-count',true),
    saveObservedAction(c,page,'s3',{id:'parallel_count',capability:'count',scope:'Listings',requested:true,elements:{parallel_result:{strategies:[{css:'#result'}]}},extractors:{parallel_count:{element:'parallel_result',read:'text'}},action:{risk:'read',implementation:{kind:'declarative',steps:[]},returns:{extractor:'parallel_count'},verify:[]}}),
  ]);
  const loaded=await loadSite(c,'example');
  assert.ok(loaded.definition.actions.parallel_count);
  assert.ok(Object.values(loaded.definition.extractors).some(ex=>ex.read==='attribute'));
});
test('missing code can be replaced after discovery without frequency gating',async t=>{
  const {c,page}=await fixture(t);await page.goto('https://example.test/list');
  const dir=path.join(c.sitesDir,'example');await fs.mkdir(dir,{recursive:true});
  const doc={site:{id:'example'},match:{hosts:['example.test']},elements:{result:{strategies:[{css:'#result'}]}},extractors:{count:{element:'result',read:'text'}},actions:{count:{risk:'read',implementation:{kind:'code',export:'count'},returns:{extractor:'count'},verify:[]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),YAML.stringify(doc));
  const failed=await runKnownAction(c,page,await loadSite(c,'example'),{sessionId:'s',actionId:'count',input:{}});
  assert.equal(failed.recovery.suspended,true);
  await recordLearningEvent(c,page,'s','extract',{locator:{css:'#result'},read:'text'});
  const repaired=await saveObservedAction(c,page,'s',{id:'count',capability:'count',scope:'Listings',action:{...doc.actions.count,implementation:{kind:'declarative',steps:[]},verify:[{type:'extractor_equals',extractor:'count',value:'0'}]},validationInput:{}});
  assert.equal(repaired.repair,true);assert.equal(repaired.validation.ok,true);
});
test('validation binds to the saved revision and refuses a substituted click',async t=>{
  const {c,page}=await fixture(t);
  await page.setContent('<h1>Home</h1><button id="send" onclick="window.sent=(window.sent||0)+1">Confirm</button>');
  const dir=path.join(c.sitesDir,'example');await fs.mkdir(dir,{recursive:true});
  const doc={site:{id:'example'},match:{hosts:['example.test']},elements:{primary:{strategies:[{css:'#send'}]}},actions:{confirm_booking:{risk:'read',implementation:{kind:'declarative',steps:[{op:'click',element:'primary'}]},verify:[]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),YAML.stringify(doc));
  const substituted=await runKnownAction(c,page,await loadSite(c,'example'),{sessionId:'s',actionId:'confirm_booking',input:{},validationOnly:true,expectedRevision:'previous-pure-extraction'});
  assert.equal(substituted.ok,false);assert.equal(await page.evaluate(()=>window.sent||0),0);
  const unsafe=await runKnownAction(c,page,await loadSite(c,'example'),{sessionId:'s',actionId:'confirm_booking',input:{},validationOnly:true});
  assert.equal(unsafe.ok,false);assert.equal(await page.evaluate(()=>window.sent||0),0);
});
test('password settings do not masquerade as a logged-out environment',async t=>{
  const {c,page}=await fixture(t);
  await page.setContent('<h1>Account settings</h1><label>New password<input type="password" autocomplete="new-password"></label><p id="result">active</p>');
  const dir=path.join(c.sitesDir,'example');await fs.mkdir(dir,{recursive:true});
  const doc={site:{id:'example'},match:{hosts:['example.test']},elements:{result:{strategies:[{css:'#result'}]}},extractors:{status:{element:'result',read:'text'}},actions:{account_status:{risk:'read',implementation:{kind:'declarative',steps:[]},returns:{extractor:'status'},verify:[{type:'extractor_equals',extractor:'status',value:'active'}]}}};
  await fs.writeFile(path.join(dir,'site.yaml'),YAML.stringify(doc));
  const result=await runKnownAction(c,page,await loadSite(c,'example'),{sessionId:'s',actionId:'account_status',input:{}});
  assert.equal(result.ok,true);
});
