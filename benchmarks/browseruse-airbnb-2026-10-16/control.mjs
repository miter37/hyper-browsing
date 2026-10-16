import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {getConfig} from '../../src/config.ts';
import {ChromeManager,forceReleaseChromeProfile} from '../../src/browserd/chrome-manager.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const DIR=path.join(ROOT,'.runtime/browseruse-airbnb-2026-10-16'),EXE='D:/APPs/browser-use/.venv/Scripts/browser-use.exe';
await fs.mkdir(DIR,{recursive:true});
const [op,file]=process.argv.slice(2),read=async n=>JSON.parse(await fs.readFile(path.join(DIR,n),'utf8')),write=async(n,v)=>fs.writeFile(path.join(DIR,n),JSON.stringify(v,null,2));
const config={cdpPort:11980,profile:path.join(DIR,'profile')};
const env={...process.env,WEBAGENT_RUNTIME_DIR:DIR,WEBAGENT_CDP_PORT:String(config.cdpPort),WEBAGENT_CHROME_USER_DATA_DIR:config.profile,WEBAGENT_CHROME_PROFILE_DIRECTORY:'Default',WEBAGENT_CHROME_PROFILE_STRATEGY:'managed',WEBAGENT_HEADLESS:'0',WEBAGENT_LANG:'en-US',WEBAGENT_WINDOW_SIZE:'1440,900',BU_NAME:'default',BU_CDP_URL:`http://127.0.0.1:${config.cdpPort}`,BH_RUNTIME_DIR:path.join(DIR,'bu-ipc'),BH_TMP_DIR:path.join(DIR,'bu-tmp'),BH_AGENT_WORKSPACE:path.join(DIR,'workspace'),BH_TAB_MARKER:'0',BH_TELEMETRY:'0',BROWSER_HARNESS_TELEMETRY:'0',BH_RECORD:'0',BH_DOMAIN_SKILLS:'0',PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',BU_BENCH_ACTION_LOG:path.join(DIR,'action-events.jsonl')};
function command(input,args=[],timeout=90000){return new Promise(resolve=>{const child=spawn(EXE,args,{cwd:'D:/APPs/browser-use',env,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',done=false;const finish=(code,error)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,error,stdout,stderr});};const timer=setTimeout(()=>{child.kill();finish(null,'command_timeout_outcome_unknown');},timeout);child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',e=>finish(null,e.message));child.on('close',c=>finish(c));child.stdin.end(input);});}
if(op==='init'){
 if(await fs.stat(path.join(DIR,'timing.json')).catch(()=>null))throw Error('Already initialized');
 await fs.mkdir(path.join(config.profile,'Default'),{recursive:true});Object.assign(process.env,env);
 const start=Date.now(),manager=new ChromeManager(getConfig()),chrome=await manager.start();await write('chrome-initial.json',chrome.state);
 const result=await command('print("BENCHMARK_READY")\n');await write('bootstrap.json',result);if(result.code!==0)throw Error(result.stderr.slice(-1500)||result.stdout.slice(-1500));
 await write('timing.json',{preparedAt:new Date().toISOString(),setupMs:Date.now()-start});console.log(JSON.stringify({ready:true,headed:!chrome.state.headless,dir:DIR,setupMs:Date.now()-start}));
}else if(op==='call'){
 const filename=path.resolve(file);if(!filename.startsWith(DIR+path.sep)||!filename.endsWith('.py'))throw Error('Use Python input files in assigned trial');
 const timing=await read('timing.json');if(!timing.firstCommandAt){timing.firstCommandAt=new Date().toISOString();await write('timing.json',timing);}
 const rows=(await fs.readFile(path.join(DIR,'commands.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean);
 if(rows.length>=60||Date.now()-Date.parse(timing.firstCommandAt)>=480000)throw Error('Trial budget');
 const input=await fs.readFile(filename,'utf8');
 const instrumentation=`import os as _bo, json as _bj, time as _bt\ndef _bw(fn,name):\n def wrapped(*a,**k):\n  started=_bt.perf_counter()\n  try: return fn(*a,**k)\n  finally:\n   with open(_bo.environ['BU_BENCH_ACTION_LOG'],'a',encoding='utf-8') as f: f.write(_bj.dumps({'name':name,'durationMs':(_bt.perf_counter()-started)*1000})+'\\n')\n return wrapped\nfor _bn in ['new_tab','goto_url','page_info','js','click_at_xy','type_text','fill_input','press_key','scroll','capture_screenshot','wait_for_load','close_tab','cdp']:\n if _bn in globals(): globals()[_bn]=_bw(globals()[_bn],_bn)\n`;
 const startedAt=new Date().toISOString(),start=Date.now(),sequence=rows.length+1;await write('inflight.json',{sequence,startedAt,file:filename});
 const result=await command(instrumentation+input,[],Math.min(90000,480000-(Date.now()-Date.parse(timing.firstCommandAt))));
 const record={sequence,startedAt,endedAt:new Date().toISOString(),durationMs:Date.now()-start,file:filename,input,...result,stdoutBytes:Buffer.byteLength(result.stdout),stderrBytes:Buffer.byteLength(result.stderr)};
 await write(`command-${String(sequence).padStart(3,'0')}.json`,record);await fs.appendFile(path.join(DIR,'commands.jsonl'),JSON.stringify({...record,stdout:undefined,stderr:undefined,input:undefined})+'\n');await fs.rm(path.join(DIR,'inflight.json'),{force:true});process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.code===0?0:1;
}else if(op==='finish'){await write('result.json',{...JSON.parse(await fs.readFile(path.resolve(file),'utf8')),finishedAt:new Date().toISOString()});console.log('Saved');
}else if(op==='cleanup'){
 await command('', ['--reload'],20000);Object.assign(process.env,env);const state=await read('chrome-state.json');if(state.userDataDir===config.profile)await forceReleaseChromeProfile(getConfig(),{...state,managed:true});await write('cleaned.json',{at:new Date().toISOString()});console.log('Cleaned only trial-owned browser and daemon');
}else throw Error('init/call FILE.py/finish FILE.json/cleanup');
