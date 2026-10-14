import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {getConfig} from '../../src/config.ts';
import {ChromeManager,forceReleaseChromeProfile} from '../../src/browserd/chrome-manager.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [id,op,...args]=process.argv.slice(2);
if(!/^[a-z0-9-]+$/.test(id||''))throw Error('Invalid trial');
const dir=path.join(ROOT,'.runtime/hwm-integrated-20261014',id);
await fs.mkdir(dir,{recursive:true});
const read=async n=>JSON.parse(await fs.readFile(path.join(dir,n),'utf8'));
const write=async(n,v)=>fs.writeFile(path.join(dir,n),JSON.stringify(v,null,2));
const envFor=c=>({...process.env,WEBAGENT_HOME:ROOT,WEBAGENT_RUNTIME_DIR:dir,WEBAGENT_PORT:String(c.port),WEBAGENT_CDP_PORT:String(c.cdpPort),WEBAGENT_CHROME_USER_DATA_DIR:c.profile,WEBAGENT_CHROME_PROFILE_DIRECTORY:'Default',WEBAGENT_CHROME_PROFILE_STRATEGY:'managed',WEBAGENT_HEADLESS:'1',WEBAGENT_LANG:'en-US',WEBAGENT_WINDOW_SIZE:'1440,900',WEBAGENT_LEARNING_DISABLED:'1',WEBAGENT_QUIET:'1'});
async function command(argv,env,timeout){return new Promise(resolve=>{const child=spawn(process.execPath,argv,{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',done=false;child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);const finish=(code,error)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,error,stdout,stderr});};const timer=setTimeout(()=>{child.kill();finish(null,'command_timeout');},timeout);child.on('error',e=>finish(null,e.message));child.on('close',code=>finish(code));});}
if(op==='init'){
 const c={port:47000+Number(args[0]),cdpPort:10000+Number(args[0]),profile:path.join(dir,'profile')};
 await fs.mkdir(path.join(c.profile,'Default'),{recursive:true});await write('config.json',c);const env=envFor(c);Object.assign(process.env,env);const t=performance.now();
 const manager=new ChromeManager(getConfig());const started=await manager.start();await write('chrome-initial.json',started.state);await write('browserd-endpoint.json',{port:c.port});
 const log=await fs.open(path.join(dir,'daemon.log'),'a');const daemon=spawn(process.execPath,['--import','tsx',path.join(ROOT,'src/bin/browserd.ts')],{cwd:ROOT,env,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});daemon.unref();await log.close();c.daemonPid=daemon.pid;await write('config.json',c);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${c.port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error('Daemon not ready');await write('timing.json',{preparedAt:new Date().toISOString(),setupMs:performance.now()-t});console.log(JSON.stringify({id,ready,dir}));process.exit(0);
}
const c=await read('config.json'),env=envFor(c);
if(op==='cleanup'){
 const live=await fetch(`http://127.0.0.1:${c.port}/health`).then(r=>r.json()).catch(()=>null);
 if(live?.chrome?.userDataDir===c.profile&&Number.isSafeInteger(live.pid)){try{process.kill(live.pid,'SIGTERM');}catch{}}
 if(c.daemonPid){try{process.kill(c.daemonPid,'SIGTERM');}catch{}}
 const state=await read('chrome-state.json').catch(()=>null);
 if(path.resolve(c.profile).startsWith(path.resolve(ROOT,'.runtime/hwm-integrated-20261014')+path.sep)&&state?.userDataDir===c.profile)await forceReleaseChromeProfile({...getConfig(),runtimeDir:dir},{...state,managed:true});
 await write('cleaned.json',{at:new Date().toISOString()});console.log('Trial-owned backend cleaned');process.exit(0);
}
if(op!=='hb')throw Error('Use init/hb/cleanup');
if(await fs.stat(path.join(dir,'cleaned.json')).then(()=>true).catch(()=>false))throw Error('Trial already cleaned; commands cannot restart it');
if(['learning','overview','asset','run','site','registry'].includes(args[0])||args.includes('--learn'))throw Error('Learning forbidden');
const lockPath=path.join(dir,'command.lock');
const lock=await fs.open(lockPath,'wx').catch(()=>null);
if(!lock){console.log('{"execution":"not_started","reason":"benchmark_command_in_flight"}');process.exit(1);}
await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await lock.close();
const timing=await read('timing.json');if(!timing.firstCommandAt){timing.firstCommandAt=new Date().toISOString();await write('timing.json',timing);}
const lines=(await fs.readFile(path.join(dir,'commands.jsonl'),'utf8').catch(()=>'' )).split('\n').filter(Boolean);
if(lines.length>=45||Date.now()-Date.parse(timing.firstCommandAt)>480000){await fs.rm(lockPath,{force:true});console.log('{"budgetExceeded":true}');process.exit(2);}
const sequence=lines.length+1,startedAt=new Date().toISOString(),t=performance.now();let result=await command([path.join(ROOT,'scripts/webctl-rpc.mjs'),...args],env,90000);
if(result.code===42){result=await command([path.join(ROOT,'scripts/launcher.mjs'),'webctl',...args],env,90000);result.fastPathFallback=true;}
const data={sequence,startedAt,endedAt:new Date().toISOString(),durationMs:performance.now()-t,args,...result};await write(`command-${String(sequence).padStart(3,'0')}.json`,data);await fs.appendFile(path.join(dir,'commands.jsonl'),JSON.stringify({...data,stdout:undefined,stderr:undefined})+'\n');
await fs.rm(lockPath,{force:true});
console.log(result.stdout);if(result.stderr)console.error(result.stderr);console.error(JSON.stringify({sequence,durationMs:data.durationMs,code:data.code,dir}));process.exitCode=result.code===0?0:1;
