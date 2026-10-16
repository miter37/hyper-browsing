import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {getConfig} from '../../src/config.ts';
import {ChromeManager,forceReleaseChromeProfile} from '../../src/browserd/chrome-manager.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PUBLIC=path.dirname(fileURLToPath(import.meta.url)),PRIVATE=path.join(ROOT,'.runtime','booking-visual-retry-2026-10-16');
const [site,op,...args]=process.argv.slice(2),scenarios=JSON.parse(await fs.readFile(path.join(ROOT,'benchmarks/booking-visual-retry-2026-10-16/scenarios.json'),'utf8'));
const index=scenarios.findIndex(s=>s.site===site);if(index<0)throw Error('Unknown assigned site');
const trial=path.join(PRIVATE,site);await fs.mkdir(trial,{recursive:true});
const read=async name=>JSON.parse(await fs.readFile(path.join(trial,name),'utf8'));
const write=async(name,data)=>fs.writeFile(path.join(trial,name),JSON.stringify(data,null,2));
const environment=c=>({...process.env,WEBAGENT_HOME:ROOT,WEBAGENT_RUNTIME_DIR:trial,WEBAGENT_PORT:String(c.port),WEBAGENT_CDP_PORT:String(c.cdpPort),WEBAGENT_CHROME_USER_DATA_DIR:c.profile,WEBAGENT_CHROME_PROFILE_DIRECTORY:'Default',WEBAGENT_CHROME_PROFILE_STRATEGY:'managed',WEBAGENT_HEADLESS:'0',WEBAGENT_LANG:'en-US',WEBAGENT_WINDOW_SIZE:'1440,900',WEBAGENT_LEARNING_DISABLED:'1',WEBAGENT_QUIET:'1'});
async function command(argv,env,timeoutMs=90000){return new Promise(resolve=>{
 const child=spawn(process.execPath,argv,{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',done=false;
 const end=(code,error)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,error,stdout,stderr});};
 const timer=setTimeout(()=>{child.kill();end(null,'command_timeout_outcome_unknown');},timeoutMs);
 child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',e=>end(null,e.message));child.on('close',code=>end(code));
});}
if(op==='init'){
 if(await fs.stat(path.join(trial,'config.json')).catch(()=>null))throw Error('Trial already initialized: do not repeat a site');
 const c={port:46460+index,cdpPort:10460+index,profile:path.join(trial,'profile'),site,model:'gpt-6-luna',effort:'medium'};
 await fs.mkdir(path.join(c.profile,'Default'),{recursive:true});await write('config.json',c);Object.assign(process.env,environment(c));
 const start=Date.now(),manager=new ChromeManager(getConfig()),initial=await manager.start();await write('chrome-initial.json',initial.state);
 const log=await fs.open(path.join(trial,'daemon.log'),'a');const daemon=spawn(process.execPath,['--import','tsx',path.join(ROOT,'src/bin/browserd.ts')],{cwd:ROOT,env:environment(c),detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});daemon.unref();await log.close();c.daemonPid=daemon.pid;await write('config.json',c);
 let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${c.port}/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Daemon not ready');
 await write('timing.json',{preparedAt:new Date().toISOString(),setupMs:Date.now()-start});await write('scenario.json',scenarios[index]);
 console.log(JSON.stringify({site,ready,headless:initial.state.headless,trial,setupMs:Date.now()-start}));process.exit(0);
}
const c=await read('config.json'),env=environment(c);
if(op==='cleanup'){
 if(c.daemonPid)try{process.kill(c.daemonPid,'SIGTERM');}catch{}
 Object.assign(process.env,env);const state=await read('chrome-state.json').catch(()=>null);
 if(state?.userDataDir===c.profile)await forceReleaseChromeProfile(getConfig(),{...state,managed:true});
 await write('cleaned.json',{at:new Date().toISOString()});console.log('Cleaned only this trial browser and daemon');process.exit(0);
}
if(op==='finish'){
 const result=JSON.parse(await fs.readFile(path.resolve(args[0]),'utf8'));await write('result.json',{...result,site,finishedAt:new Date().toISOString()});console.log('Saved final result');process.exit(0);
}
if(op!=='cli')throw Error('Use init/cli/finish/cleanup');
if(['learning','asset','site','registry','overview','identify','actions'].includes(args[0])||args.includes('--learn')||args[0]==='run'&&!args.includes('--input-file'))throw Error('Learning and stored assets forbidden');
// Serialize even if an agent submits tool calls concurrently; never overwrite evidence.
const lock=path.join(trial,'command.lock'),lockStart=Date.now();
for(;;){try{await fs.mkdir(lock);break;}catch(error){if(error.code!=='EEXIST'||Date.now()-lockStart>100000)throw error;await new Promise(r=>setTimeout(r,100));}}
try{
const timing=await read('timing.json');if(!timing.firstCommandAt){timing.firstCommandAt=new Date().toISOString();await write('timing.json',timing);}
const rows=(await fs.readFile(path.join(trial,'commands.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean);
const remaining=480000-(Date.now()-Date.parse(timing.firstCommandAt));if(rows.length>=45||remaining<=0){console.log(JSON.stringify({budgetExceeded:true,reason:'trial_budget'}));process.exit(2);}
const sequence=rows.length+1,startedAt=new Date().toISOString(),start=Date.now();
const inputs={};for(const flag of ['--input-file','--then-file']){const i=args.indexOf(flag);if(i>=0&&args[i+1]){const file=path.resolve(args[i+1]);if(!file.startsWith(trial+path.sep))throw Error('Input files must stay in assigned trial');inputs[flag]={file,text:await fs.readFile(file,'utf8')};}}
await write('inflight.json',{sequence,startedAt,args});
const result=await command([path.join(ROOT,'scripts/launcher.mjs'),'webctl',...args],env,Math.min(90000,remaining));
const record={sequence,args,inputs,startedAt,endedAt:new Date().toISOString(),durationMs:Date.now()-start,...result,stdoutBytes:Buffer.byteLength(result.stdout),stderrBytes:Buffer.byteLength(result.stderr)};
await write(`command-${String(sequence).padStart(3,'0')}.json`,record);await fs.appendFile(path.join(trial,'commands.jsonl'),JSON.stringify({...record,stdout:undefined,stderr:undefined})+'\n');await fs.rm(path.join(trial,'inflight.json'),{force:true});
process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);process.exitCode=result.code===0?0:1;
}finally{await fs.rmdir(lock).catch(()=>{});}
