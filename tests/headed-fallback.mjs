import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserDaemon } from '../src/browserd/server.ts';
import { ChromeManager, forceReleaseChromeProfile } from '../src/browserd/chrome-manager.ts';
import { getConfig } from '../src/config.ts';
import http from 'node:http';
import { SessionStore } from '../src/browserd/session-store.ts';

async function fixture(t, results) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-headed-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const daemon=new BrowserDaemon({...getConfig(),root,runtimeDir:root});
  let headless=true, switches=0, calls=0;
  const state={headless:true};
  daemon.chrome={getState:()=>({...state,headless}),writeDisplayPreference:async p=>{headless=p.headless;},repair:async()=>{switches++;return {context:{},state:{headless:false}};}};
  daemon.sessions={list:async()=>[],rebindContext:async()=>{},get:()=>{throw new Error('no page');}};
  daemon.dispatchUnlocked=async()=>{calls++;const result=results[Math.min(calls-1,results.length-1)];if(result instanceof Error)throw result;return result;};
  return {daemon,count:()=>({switches,calls})};
}
test('failed headless read automatically switches and retries once',async t=>{
  const {daemon,count}=await fixture(t,[{ok:false,reason:'timeout',execution:'not_started'},{ok:true,value:'ready',execution:'completed'}]);
  const result=await daemon.dispatch('page.extract',{sessionId:'s',locator:{text:'Result'}});
  assert.equal(result.value,'ready');assert.equal(result.headedFallback.retried,true);assert.deepEqual(count(),{switches:1,calls:2});
});
test('uncertain click reveals but does not replay and requests observation',async t=>{
  const {daemon,count}=await fixture(t,[{ok:false,reason:'timeout',execution:'outcome_unknown'}]);
  const result=await daemon.dispatch('page.click',{sessionId:'s',locator:{text:'Send'},confirmed:true});
  assert.equal(result.execution,'outcome_unknown');assert.equal(result.headedFallback.retried,false);assert.equal(result.headedFallback.observationRequired,true);assert.deepEqual(count(),{switches:1,calls:1});
});
test('blocked session opens once and retries safe navigation in its existing session',async t=>{
  const {daemon,count}=await fixture(t,[{id:'task_a',blocked:'captcha',url:'https://example.test'},{url:'https://example.test',title:'Ready'}]);
  const methods=[];const base=daemon.dispatchUnlocked;daemon.dispatchUnlocked=async(m,p)=>{methods.push([m,p.sessionId]);return base(m,p);};
  const result=await daemon.dispatch('session.open',{url:'https://example.test'});
  assert.equal(result.id,'task_a');assert.deepEqual(methods,[['session.open',undefined],['page.goto','task_a']]);assert.equal(count().switches,1);
});
test('invalid or ambiguous targets and confirmation refusals do not restart Chrome',async t=>{
  for(const failure of [{ok:false,reason:'ambiguous'},{ok:false,reason:'stale_ref'},{ok:false,confirmationRequired:true},{ok:false,reason:'invalid_target'}]){
    const {daemon,count}=await fixture(t,[failure]);await daemon.dispatch('page.click',{sessionId:'s'});assert.equal(count().switches,0);
  }
});
test('reference and partial batch failures reveal without replaying obsolete targets',async t=>{
  for(const [method,params,result] of [['page.fill',{ref:'@e1'},{ok:false,reason:'timeout',execution:'outcome_unknown'}],['batch.run',{input:{commands:[]}},{ok:false,reason:'step_failed',execution:'partial'}]]){
    const {daemon,count}=await fixture(t,[result]);const actual=await daemon.dispatch(method,{sessionId:'s',...params});assert.equal(actual.headedFallback.retried,false);assert.equal(count().calls,1);
  }
});
test('a second failure stops after one headed retry and reveal failure preserves original outcome',async t=>{
  const {daemon,count}=await fixture(t,[{ok:false,reason:'timeout',execution:'not_started'}]);
  await daemon.dispatch('page.extract',{sessionId:'s'});assert.deepEqual(count(),{switches:1,calls:2});
  const other=await fixture(t,[{ok:false,execution:'outcome_unknown',reason:'timeout'}]);other.daemon.chrome.repair=async()=>{throw new Error('no display');};
  const result=await other.daemon.dispatch('page.click',{sessionId:'s'});assert.equal(result.execution,'outcome_unknown');assert.equal(result.headedFallback.error,'no display');
});
test('headless startup failure attempts headed startup once',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-start-headed-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const manager=new ChromeManager({...getConfig(),runtimeDir:root,headless:true});let attempts=0;
  manager.startLocked=async()=>{attempts++;if(attempts===1){manager.profile={managed:true,userDataDir:path.join(root,'profile')};throw new Error('CDP launch failed');}return {context:{},state:{headless:false},takeover:{}};};
  const result=await manager.start();assert.equal(attempts,2);assert.equal(result.state.headless,false);assert.equal(result.state.headedFallback.reason,'CDP launch failed');
});
test('real Chrome retries a read after a confirmed headless challenge in the same session',{timeout:60000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-real-headed-'));
  const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.headers['user-agent']?.includes('HeadlessChrome')?'<h1>Headless blocked content</h1>':'<h1>Ready</h1><p id="result">Headed result</p>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const c={...getConfig(),runtimeDir:root,sitesDir:path.join(root,'sites'),generatedDir:path.join(root,'generated'),headless:true,chromeProfileStrategy:'managed',chromeUserDataDir:path.join(root,'profile'),chromeProfileDirectory:'Default'};
  await fs.mkdir(path.join(root,'profile','Default'),{recursive:true});
  const chrome=new ChromeManager(c);const daemon=new BrowserDaemon(c);daemon.chrome=chrome;
  t.after(async()=>{await forceReleaseChromeProfile(c,chrome.profile);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const started=await chrome.start();daemon.context=started.context;daemon.sessions=new SessionStore(started.context);
  const opened=await daemon.sessions.open(`http://127.0.0.1:${server.address().port}`);
  assert.equal(chrome.getState().headless,true);
  await daemon.sessions.get(opened.id).setContent('<div role="dialog">Robot or human? Confirm that you are human.</div>');
  const result=await daemon.dispatch('page.extract',{sessionId:opened.id,locator:{css:'#result'}});
  assert.equal(result.value,'Headed result');assert.equal(result.headedFallback.retried,true);assert.equal(chrome.getState().headless,false);
  assert.equal((await daemon.sessions.list())[0].id,opened.id);
});
test('session display restart reapplies viewport and locale preparation',async()=>{
  const prepared=[];const page=()=>({url:()=> 'about:blank',title:async()=>'',isClosed:()=>false});
  const first=page(),next=page();
  const store=new SessionStore({on:()=>{},newPage:async()=>first});
  const session=await store.open(undefined,{prepare:async p=>prepared.push(p)});
  await store.rebindContext({on:()=>{},pages:()=>[next]});
  assert.deepEqual(prepared,[first,next]);assert.equal(store.get(session.id),next);
});
test('failed display preparation preserves every existing session ID',async()=>{
  const page=()=>({url:()=> 'about:blank',title:async()=>'',isClosed:()=>false});
  const first=page(),second=page(),replacement=page(),otherReplacement=page();let calls=0;
  const pages=[first,second];const store=new SessionStore({on:()=>{},newPage:async()=>pages.shift()});
  const a=await store.open(undefined,{prepare:async()=>{if(++calls===2)throw new Error('locale preparation failed');}});
  const b=await store.open();
  await assert.rejects(store.rebindContext({on:()=>{},pages:()=>[replacement,otherReplacement]}),/locale preparation failed/);
  assert.equal(store.get(a.id),replacement);assert.equal(store.get(b.id),otherReplacement);
});
test('reattachment failure to previous headless Chrome also gets headed startup fallback',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-attach-headed-'));
  const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://previous'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const profile=path.join(root,'profile');await fs.mkdir(path.join(profile,'Default'),{recursive:true});
  await fs.writeFile(path.join(root,'chrome-state.json'),JSON.stringify({userDataDir:profile,profileDirectory:'Default',headless:true,cdpPort:server.address().port}));
  const manager=new ChromeManager({...getConfig(),runtimeDir:root,chromeUserDataDir:profile,chromeProfileDirectory:'Default',headless:true});
  manager.attach=async()=>{throw new Error('CDP connection closed');};
  manager.launch=async()=>({context:{},state:{headless:false},takeover:{}});
  const result=await manager.start();assert.equal(result.state.headedFallback.reason,'CDP connection closed');assert.equal(result.state.headless,false);
});
