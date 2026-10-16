import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserOptions} from './browser-options.mjs';
import {DemandObservationService} from '../src/runtime/observation/service.ts';
import {findGoal} from '../src/runtime/task/observe.ts';
import {executePrimitive} from '../src/engine/execute.ts';
import {BrowserDaemon} from '../src/browserd/server.ts';
import {SessionStore} from '../src/browserd/session-store.ts';
import {getConfig} from '../src/config.ts';
import {needsHeadedFallback} from '../src/browserd/headed-fallback.ts';
import {boundedObservationOutput} from '../src/runtime/observation/bounded-snapshot.ts';
import {parseGoal,parseTask,parseFollow} from '../src/runtime/task/schema.ts';
import {runTask} from '../src/runtime/task/run.ts';

async function fixture(t,html){const b=await chromium.launch(browserOptions());t.after(()=>b.close());const page=await b.newPage();await page.setContent(html);return page;}

test('batch and follow correction details survive the daemon HTTP boundary',async t=>{
 const page=await fixture(t,'<button>Known</button>'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-invalid-task-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const daemon=new BrowserDaemon({...getConfig(),runtimeDir:dir,host:'127.0.0.1',port:0,learningDisabled:true});
 daemon.chrome.start=async()=>({context:page.context()});daemon.chrome.stop=async()=>{};
 daemon.dispatch=async(method,params)=>method==='task.run'?parseTask(params.input):parseFollow(params.input);await daemon.start();t.after(()=>daemon.stop());
 for(const [method,input] of [['task.run',{steps:[{id:'x',target:{terms:['PRIVATE_SEARCH']},action:{op:'click'},follow:{terms:['PRIVATE_RESULT'],fields:['role']}}]}],['page.click',{follow:{terms:['PRIVATE_RESULT'],fields:['role']}}]]){
  const response=await fetch(`http://127.0.0.1:${daemon.server.address().port}/rpc`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${daemon.token}`},body:JSON.stringify({method,params:{input}})});
  const result=await response.json();assert.equal(result.execution,'not_started');assert.ok(result.validation?.length);assert.ok(result.validation[0].allowed.includes('name'));assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SEARCH|PRIVATE_RESULT/);
 }
});

test('goal validation correction survives the daemon HTTP error boundary',async t=>{
 const page=await fixture(t,'<button>Known</button>'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-invalid-goal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const daemon=new BrowserDaemon({...getConfig(),runtimeDir:dir,host:'127.0.0.1',port:0,learningDisabled:true});
 daemon.chrome.start=async()=>({context:page.context()});daemon.chrome.stop=async()=>{};
 daemon.dispatch=async(_method,params)=>parseGoal(params.input);await daemon.start();t.after(()=>daemon.stop());
 const response=await fetch(`http://127.0.0.1:${daemon.server.address().port}/rpc`,{method:'POST',headers:{authorization:`Bearer ${daemon.token}`,'content-type':'application/json'},body:JSON.stringify({method:'task.find',params:{input:{terms:['Known'],fields:['checked']}}})});
 const result=await response.json();assert.equal(result.error,'invalid_goal');assert.equal(result.execution,'not_started');assert.equal(result.validation[0].path,'fields.0');assert.match(result.validation[0].hint,/states/);
});

test('transport removes nested observation graphs without changing execution or saved data',()=>{
 const graph={observation:'p1',nodes:[{text:'large internal payload'}]},snapshot={contextGraph:graph,elements:[],url:'https://example.test/',title:''};
 const raw={state:'completed',result:{execution:'outcome_unknown',snapshot,after:snapshot}},safe=boundedObservationOutput(raw);
 assert.equal(safe.result.execution,'outcome_unknown');assert.equal(safe.result.snapshot.contextGraph,undefined);assert.equal(safe.result.after.contextGraph,undefined);assert.equal(raw.result.snapshot.contextGraph,graph);
});

test('named tiny native inputs remain discoverable without claiming a pointer hit',async t=>{
 const page=await fixture(t,'<main><input type="range" aria-label="Minimum" value="20" tabindex="-1" style="width:1px;height:1px;opacity:0"><input aria-label="Hidden" hidden></main>');
 const found=await findGoal(page,{terms:['Minimum'],roles:['slider'],exact:true});
 assert.equal(found.status,'unique');assert.equal(found.candidates[0].value,'20');
 assert.equal(found.candidates[0].interaction.keyboard,'native-control');assert.equal(found.candidates[0].interaction.small,true);
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),panel=map.panels.find(p=>p.role==='main');
 const read=await service.read(page,'s',{map:map.map,panel:panel.id,want:'content,controls,state'});assert.ok(read.data.some(n=>n.name==='Minimum'&&n.interaction?.keyboard==='native-control'));
 const result=await executePrimitive(page,'fill',{ref:found.candidates[0].ref,value:'40'});assert.equal(result.ok,true);assert.equal(await page.locator('input[type=range]').inputValue(),'40');
 assert.equal((await findGoal(page,{terms:['Hidden'],exact:true})).status,'not_found');
});

test('local focus uses real controls before unlabelled wrappers',async t=>{
 const page=await fixture(t,'<section><h2>Page A</h2><div data-testid="wrapper"><button>Previous</button><button onclick="document.querySelector(\'h2\').textContent=\'Page B\'">Next</button></div></section>');
 const service=new DemandObservationService();t.after(()=>service.close());
 const result=await service.afterAction(page,'s',await executePrimitive(page,'click',{locator:{role:'button',name:'Next',exact:true}}));
 assert.deepEqual(result.focus.controls.map(c=>c.name),['Previous','Next']);
});

test('control reads filter wrappers before pagination and keep the default response small',async t=>{
 const page=await fixture(t,'<main>'+Array.from({length:160},(_,i)=>`<div data-testid="wrapper-${i}"><span>Decoration ${i}</span></div>`).join('')+'<fieldset><legend>Amount per day</legend><input type="range" aria-label="Lower" value="20" style="width:1px;height:1px;opacity:0"><input type="range" aria-label="Upper" value="90" style="width:1px;height:1px;opacity:0"></fieldset>'+Array.from({length:40},(_,i)=>`<button>Choice ${i}</button>`).join('')+'</main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const result=await service.read(page,'s',{map:map.map,panel:map.panels[0].id,want:'controls'});
 assert.ok(result.data.some(c=>c.name==='Lower'));assert.ok(result.data.some(c=>c.name==='Upper'));
 assert.ok(result.data.every(c=>['input','button'].includes(c.tag)));assert.ok(Buffer.byteLength(JSON.stringify(result))<=4200);
 assert.equal(result.coverage.observed,42);assert.ok(result.nextRead);
 const next=await service.read(page,'s',{...result.nextRead,limit:12});assert.ok(next.data.length);assert.ok(!next.data.some(c=>c.name==='Lower'));
});

test('an action query excludes test-id containers but content queries preserve them',async t=>{
 const page=await fixture(t,'<main><div data-testid="wrapper"><button>Launch</button></div></main>');
 const action=await findGoal(page,{terms:['Launch']});assert.equal(action.status,'unique');assert.equal(action.candidates[0].tag,'button');
 const content=await findGoal(page,{terms:['Launch'],actionableOnly:false});assert.ok(content.candidates.some(c=>c.tag==='div'&&c.actionable===false));
});

test('image fallback includes a bounded set of viewport control refs, including tiny native fields',async t=>{
 const page=await fixture(t,'<main><fieldset><legend>Amount</legend><input type="range" aria-label="Lower" value="20" style="width:1px;height:1px;opacity:0"><button>Apply</button><input type="password" aria-label="Secret" value="CANARY_PRIVATE_VALUE"></fieldset><div style="margin-top:2000px"><button>Offscreen</button></div></main>');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-visual-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const service=new DemandObservationService({screenshotsDir:dir});t.after(()=>service.close());
 await service.find(page,'s',{terms:['Missing A']});const result=await service.find(page,'s',{terms:['Missing B']});
 assert.ok(result.visual.controls.some(c=>c.name==='Lower'&&c.ref&&c.value==='20'));
 assert.ok(result.visual.controls.some(c=>c.name==='Apply'));assert.ok(!result.visual.controls.some(c=>c.name==='Offscreen'));
 assert.ok(Buffer.byteLength(JSON.stringify(result.visual.controls))<=2000);assert.ok(result.visual.controlsCoverage);
 assert.ok(!JSON.stringify(result.visual.controls).includes('CANARY_PRIVATE_VALUE'));
});

test('second unsuccessful lookup captures an image and changed words do not reset the budget',async t=>{
 const page=await fixture(t,'<main><h1>Example</h1><button>Observed choice</button></main>');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-visual-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const service=new DemandObservationService({screenshotsDir:dir});t.after(()=>service.close());
 const first=await service.find(page,'s',{terms:['Missing A']},{goalId:'current-control'});assert.equal(first.retry.remaining,1);assert.equal(first.visual,undefined);
 const second=await service.find(page,'s',{terms:['Missing B'],scope:'document'},{goalId:'current-control'});assert.equal(second.retry.remaining,0);assert.equal(second.visual.mustRead,true);assert.ok((await fs.stat(second.visual.file)).size>0);
 assert.equal(needsHeadedFallback('page.snapshot',{ok:false,reason:'visual_review_required'}),false);
 const third=await service.find(page,'s',{terms:['Observed choice']},{goalId:'current-control'});assert.equal(third.reason,'visual_review_required');assert.equal(third.visual.id,second.visual.id);
 const reviewed=await service.find(page,'s',{terms:['Observed choice']},{goalId:'current-control',visualReviewed:second.visual.id});assert.equal(reviewed.status,'unique');
});

test('an explicitly scoped failed lookup captures that visible region instead of the full page',async t=>{
 const page=await fixture(t,'<section role="region" aria-label="Options" style="width:400px;height:200px"><button>Known</button></section><aside>Outside scope</aside>');
 const root=(await findGoal(page,{roles:['region'],terms:['Options'],exact:true,actionableOnly:false})).candidates[0].ref;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-visual-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const service=new DemandObservationService({screenshotsDir:dir});t.after(()=>service.close());
 await service.find(page,'s',{terms:['Missing A'],scope:{ref:root}});
 const result=await service.find(page,'s',{terms:['Missing B'],scope:{ref:root}});assert.equal(result.visual.scope,'requested-region');assert.equal(result.visual.clip.width,400);
 const bytes=await fs.readFile(result.visual.file);assert.equal(bytes.readUInt32BE(16),400);assert.equal(bytes.readUInt32BE(20),200);
});

test('new ambiguous candidates are evidence; repeating the same choices switches to an image',async t=>{
 const page=await fixture(t,'<section><h2>Choices A</h2><button onclick="document.querySelector(\'h2\').textContent=\'Choices B\'">Choice A</button><button>Choice B</button></section>');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-visual-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const service=new DemandObservationService({screenshotsDir:dir});t.after(()=>service.close());
 const first=await service.find(page,'s',{terms:['Choice']});assert.equal(first.retry,undefined);assert.equal(first.visual,undefined);
 const second=await service.find(page,'s',{roles:['button']});assert.equal(second.visual.mustRead,true);
 await service.afterAction(page,'s',await executePrimitive(page,'click',{ref:first.candidates.find(c=>c.name==='Choice A').ref}));
 const next=await service.find(page,'s',{terms:['Missing']});assert.equal(next.retry.remaining,1);assert.equal(next.visual,undefined);
});

test('different candidate evidence is not a repeated ambiguity and unique execution still requires a target',async t=>{
 const page=await fixture(t,'<button>Choice A</button><button>Choice B</button><button>Other A</button><button>Other B</button>');
 const service=new DemandObservationService();t.after(()=>service.close());
 for(const query of ['Choice','Other']){const r=await service.find(page,'s',{terms:[query]});assert.equal(r.status,'ambiguous');assert.equal(r.retry,undefined);assert.equal(r.visual,undefined);}
 let calls=0;const action=await runTask(page,{steps:[{id:'ambiguous',target:{terms:['Choice']},action:{op:'click'}}]},{execute:async()=>{calls++;return {execution:'completed'};}});
 assert.equal(action.execution,'not_started');assert.equal(action.reason,'target_ambiguous');assert.equal(calls,0);
});

test('multiple requested content matches are useful information, not a failed unique target',async t=>{
 const page=await fixture(t,'<main><p>Fact A</p><p>Fact B</p></main>');const service=new DemandObservationService();t.after(()=>service.close());
 for(let i=0;i<3;i++){const result=await service.find(page,'s',{terms:['Fact'],actionableOnly:false});assert.ok(result.candidates.length>=2);assert.equal(result.visual,undefined);assert.equal(result.retry,undefined);}
});

test('legacy JSON snapshots never attach the stored graph, including explicit context capture',async t=>{
 const b=await chromium.launch(browserOptions());t.after(()=>b.close());const context=await b.newContext();
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-snapshot-'));await fs.mkdir(path.join(dir,'snapshots'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<main><input aria-label="Minimum" type="range">'+Array.from({length:1500},(_,i)=>'<div><span>Item '+i+'</span></div>').join('')+'</main>'}));
 const sessions=new SessionStore(context),opened=await sessions.open('https://example.test/');const daemon=new BrowserDaemon({...getConfig(),runtimeDir:dir,learningDisabled:true});daemon.sessions=sessions;daemon.context=context;daemon.chrome.ensureConnected=async()=>context;t.after(()=>daemon.demand.close());
 for(const explicit of [false,true]){const result=await daemon.dispatchUnlocked('page.snapshot',{sessionId:opened.id,format:'json',query:'Minimum',limit:10,context:explicit,save:explicit});assert.equal(result.snapshot.contextGraph,undefined);assert.ok(Buffer.byteLength(JSON.stringify(result))<=16000);if(explicit){assert.ok(result.context.nodes>1000);const saved=JSON.parse(await fs.readFile(result.file,'utf8'));assert.ok(saved.contextGraph.nodes.length>1000);}}
});
