import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {getConfig} from '../../src/config.ts';
import {ChromeManager,forceReleaseChromeProfile} from '../../src/browserd/chrome-manager.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PUBLIC=path.dirname(fileURLToPath(import.meta.url));
const PRIVATE=path.join(ROOT,'.runtime','benchmark-us-20261013');
const [id,operation,...args]=process.argv.slice(2);
if(!/^[a-z0-9_-]+$/.test(id||''))throw new Error('Invalid trial id');
const trial=path.join(PRIVATE,'trials',id);await fs.mkdir(trial,{recursive:true});
const configFile=path.join(trial,'config.json');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const append=async data=>fs.appendFile(path.join(trial,'commands.jsonl'),JSON.stringify(data)+'\n');
const write=async(name,data)=>fs.writeFile(path.join(trial,name),JSON.stringify(data,null,2));
function envFor(c){return {...process.env,WEBAGENT_HOME:ROOT,WEBAGENT_RUNTIME_DIR:trial,WEBAGENT_PORT:String(c.port),WEBAGENT_CDP_PORT:String(c.cdpPort),WEBAGENT_CHROME_USER_DATA_DIR:c.profile,WEBAGENT_CHROME_PROFILE_DIRECTORY:'Default',WEBAGENT_CHROME_PROFILE_STRATEGY:'managed',WEBAGENT_HEADLESS:'1',WEBAGENT_LANG:'en-US',WEBAGENT_WINDOW_SIZE:'1440,900',WEBAGENT_LEARNING_DISABLED:'1',WEBAGENT_QUIET:'1',BU_NAME:`bench_${id}`,BU_CDP_URL:`http://127.0.0.1:${c.cdpPort}`,BH_RUNTIME_DIR:path.join(trial,'bu-ipc'),BH_TMP_DIR:path.join(trial,'bu-tmp'),BH_TELEMETRY:'0',BROWSER_HARNESS_TELEMETRY:'0',BH_RECORD:'0',BH_DOMAIN_SKILLS:'0',PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'};}
async function command(executable,argv,env,input,timeoutMs=90000){
 return new Promise(resolve=>{
  const child=spawn(executable,argv,{cwd:ROOT,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='',finished=false;
  child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  const timer=setTimeout(()=>{child.kill();done(null,'command_timeout');},timeoutMs);
  function done(code,error){if(finished)return;finished=true;clearTimeout(timer);resolve({code,error,stdout:out,stderr:err});}
  child.on('error',e=>done(null,e.message));child.on('close',code=>done(code));child.stdin.end(input||'');
 });
}
if(operation==='init'){
 const [method,index]=args;const c={method,port:43000+Number(index),cdpPort:9600+Number(index),profile:path.join(trial,'profile')};
 await fs.mkdir(path.join(c.profile,'Default'),{recursive:true});await write('config.json',c);
 const env=envFor(c);Object.assign(process.env,env);
 const manager=new ChromeManager(getConfig());const start=performance.now();const started=await manager.start();
 await write('chrome-initial.json',started.state);await write('browserd-endpoint.json',{port:c.port});
 if(method==='hb'){
  const log=await fs.open(path.join(trial,'daemon.log'),'a');
  const daemon=spawn(process.execPath,['--import','tsx',path.join(ROOT,'src/bin/browserd.ts')],{cwd:ROOT,env,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});daemon.unref();await log.close();c.daemonPid=daemon.pid;await write('config.json',c);
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${c.port}/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw new Error('Benchmark daemon failed to start');
 }else{
  const output=await command('D:/APPs/browser-use/.venv/Scripts/browser-use.exe',[],env,'print("BENCHMARK_READY")\n');
  await write('bootstrap-output.json',output);if(output.code!==0)throw new Error('Browser-use bootstrap failed: '+output.stderr.slice(-1200));
 }
 await write('timing.json',{preparedAt:new Date().toISOString(),setupMs:performance.now()-start});
 console.log(JSON.stringify({id,method,ready:true,trial,setupMs:performance.now()-start}));process.exit(0);
}
const c=await read(configFile);const env=envFor(c);
if(operation==='info'){console.log(JSON.stringify({id,method:c.method,trial,public:PUBLIC}));process.exit(0);}
if(operation==='finish'){
 const input=await read(path.resolve(args[0]));await write('result.json',{...input,id,method:c.method,finishedAt:new Date().toISOString()});console.log('Result saved');process.exit(0);
}
if(operation==='cleanup'){
 const until=Date.now()+95000;
 for(;;){const pending=(await fs.readdir(trial)).filter(n=>n.startsWith('inflight-'));if(!pending.length)break;if(Date.now()>until)throw new Error('Pending browser commands; cleanup postponed');await new Promise(r=>setTimeout(r,500));}
 if(c.method==='bu')await command('D:/APPs/browser-use/.venv/Scripts/browser-use.exe',['--reload'],env,'',20000);
 if(c.daemonPid){try{process.kill(c.daemonPid,'SIGTERM');}catch{}}
 const state=await read(path.join(trial,'chrome-state.json')).catch(()=>null);
 if(state?.userDataDir===c.profile)await forceReleaseChromeProfile({...getConfig(),runtimeDir:trial},{...state,managed:true});
 await write('cleaned.json',{at:new Date().toISOString()});console.log('Cleaned only trial-owned backend');process.exit(0);
}
if(operation==='reveal'){
 if(c.method!=='bu'||c.revealed)throw new Error('Only one browser-use environment reveal is permitted');
 const startedAt=new Date().toISOString(),t0=performance.now();Object.assign(process.env,env);
 await command('D:/APPs/browser-use/.venv/Scripts/browser-use.exe',['--reload'],env,'',20000);
 const manager=new ChromeManager(getConfig());await manager.writeDisplayPreference({headless:false});
 const started=await manager.repair();c.revealed=true;c.cdpPort=started.state.cdpPort;await write('config.json',c);
 await append({method:'environment.reveal',startedAt,endedAt:new Date().toISOString(),durationMs:performance.now()-t0});
 console.log(JSON.stringify({headed:true,observationRequired:true,hint:'Use new_tab with the last observed URL; no blind write replay.'}));process.exit(0);
}
if(operation!=='hb'&&operation!=='bu')throw new Error('Use init/info/hb/bu/finish/cleanup');
if(c.method!==operation)throw new Error('Wrong assigned method');
const timing=await read(path.join(trial,'timing.json'));if(!timing.firstCommandAt){timing.firstCommandAt=new Date().toISOString();await write('timing.json',timing);}
const existing=(await fs.readFile(path.join(trial,'commands.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean);
if(existing.length>=45||Date.now()-Date.parse(timing.firstCommandAt)>480000){console.log(JSON.stringify({budgetExceeded:true,reason:'trial_budget'}));process.exit(2);}
const sequence=existing.length+1;const startedAt=new Date().toISOString();const t0=performance.now();let input,argv,executable;
if(operation==='hb'){
 if(['learning','overview','asset','run','site','registry'].includes(args[0])||args.includes('--learn'))throw new Error('Learning/assets forbidden by experiment protocol');
 executable=process.execPath;argv=[path.join(ROOT,'scripts/webctl-rpc.mjs'),...args];
}else{
 input=await fs.readFile(path.resolve(args[0]),'utf8');
 const instrumentation=`import time as _bt, json as _bj\ndef _bench_wrap(_fn, _name):\n def _wrapped(*a, **k):\n  _t=_bt.perf_counter()\n  try:\n   return _fn(*a, **k)\n  finally:\n   print("BENCH_ACTION "+_bj.dumps({"name":_name,"duration_ms":(_bt.perf_counter()-_t)*1000}), flush=True)\n return _wrapped\nfor _name in ["new_tab","goto_url","page_info","js","click_at_xy","type_text","fill_input","press_key","scroll","capture_screenshot","wait_for_load","wait_for_element","close_tab","cdp"]:\n if _name in globals():\n  globals()[_name]=_bench_wrap(globals()[_name],_name)\n`;
 input=instrumentation+input;executable='D:/APPs/browser-use/.venv/Scripts/browser-use.exe';argv=[];
}
const inflight=path.join(trial,`inflight-${process.pid}.json`);await fs.writeFile(inflight,JSON.stringify({sequence,startedAt}));
const remaining=()=>Math.max(1,480000-(Date.now()-Date.parse(timing.firstCommandAt)));
let result=await command(executable,argv,env,input,Math.min(90000,remaining()));
if(operation==='hb'&&result.code===42){
 result=await command(process.execPath,[path.join(ROOT,'scripts/launcher.mjs'),'webctl',...args],env,'',Math.min(90000,remaining()));
 result.fastPathFallback=true;
}
const durationMs=performance.now()-t0;const log={sequence,method:operation,startedAt,endedAt:new Date().toISOString(),durationMs,args:operation==='hb'?args:[path.resolve(args[0])],input:operation==='bu'?input:undefined,...result};
await write(`command-${String(sequence).padStart(3,'0')}.json`,log);await append({...log,stdout:undefined,stderr:undefined,input:undefined});
await fs.rm(inflight,{force:true});
console.log(result.stdout||'');if(result.stderr)console.error(result.stderr);
console.error(JSON.stringify({benchmark:{sequence,durationMs,code:result.code,error:result.error,log:path.join(trial,`command-${String(sequence).padStart(3,'0')}.json`)}}));
process.exitCode=result.code===0?0:1;
