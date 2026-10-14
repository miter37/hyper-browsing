import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {getConfig} from '../../src/config.ts';
import {ChromeManager,forceReleaseChromeProfile} from '../../src/browserd/chrome-manager.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.runtime','hb-validation-20261014');
const [id,op,...args]=process.argv.slice(2);
if(!/^v[1-3]_[a-z]+_hb$/.test(id||''))throw Error('Invalid trial');
const trial=path.join(PRIVATE,'trials',id);await fs.mkdir(trial,{recursive:true});
const read=async n=>JSON.parse(await fs.readFile(path.join(trial,n),'utf8'));
const write=async(n,v)=>fs.writeFile(path.join(trial,n),JSON.stringify(v,null,2));
const envFor=c=>({...process.env,WEBAGENT_HOME:ROOT,WEBAGENT_RUNTIME_DIR:trial,WEBAGENT_PORT:String(c.port),WEBAGENT_CDP_PORT:String(c.cdpPort),WEBAGENT_CHROME_USER_DATA_DIR:c.profile,WEBAGENT_CHROME_PROFILE_DIRECTORY:'Default',WEBAGENT_CHROME_PROFILE_STRATEGY:'managed',WEBAGENT_HEADLESS:'1',WEBAGENT_LANG:'en-US',WEBAGENT_WINDOW_SIZE:'1440,900',WEBAGENT_LEARNING_DISABLED:'1',WEBAGENT_QUIET:'1'});
function command(argv,env,timeoutMs){return new Promise(resolve=>{const child=spawn(process.execPath,argv,{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',ended=false;child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>{child.kill();finish(null,'command_timeout');},timeoutMs);function finish(code,error){if(ended)return;ended=true;clearTimeout(timer);resolve({code,error,stdout,stderr});}child.on('error',e=>finish(null,e.message));child.on('close',code=>finish(code));});}
if(op==='init'){
 const index=Number(args[0]);if(!Number.isInteger(index)||index<110||index>139)throw Error('Invalid dedicated port index');
 const c={method:'hb',port:43000+index,cdpPort:9600+index,profile:path.join(trial,'profile')};
 if(await fs.stat(path.join(trial,'config.json')).catch(()=>null))throw Error('Trial already initialized');
 await fs.mkdir(path.join(c.profile,'Default'),{recursive:true});await write('config.json',c);
 const env=envFor(c);Object.assign(process.env,env);const t0=performance.now();
 const manager=new ChromeManager(getConfig());const started=await manager.start();await write('chrome-initial.json',started.state);await write('browserd-endpoint.json',{port:c.port});
 const log=await fs.open(path.join(trial,'daemon.log'),'a');const daemon=spawn(process.execPath,['--import','tsx',path.join(ROOT,'src/bin/browserd.ts')],{cwd:ROOT,env,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});daemon.unref();await log.close();c.daemonPid=daemon.pid;await write('config.json',c);
 let ready=false;for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+c.port+'/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error('Daemon did not start');
 await write('timing.json',{preparedAt:new Date().toISOString(),setupMs:performance.now()-t0});console.log(JSON.stringify({id,ready:true,trial}));process.exit(0);
}
const c=await read('config.json'),env=envFor(c);
if(op==='finish'){const result=JSON.parse(await fs.readFile(path.resolve(args[0]),'utf8'));await write('result.json',{...result,id,method:'hb',finishedAt:new Date().toISOString()});console.log('Result saved');process.exit(0);}
if(op==='cleanup'){
 if(await fs.stat(path.join(trial,'command.lock')).catch(()=>null))throw Error('Command still running');
 if(c.daemonPid)try{process.kill(c.daemonPid,'SIGTERM');}catch{}
 const state=await read('chrome-state.json').catch(()=>null);if(state?.userDataDir===c.profile)await forceReleaseChromeProfile({...getConfig(),runtimeDir:trial},{...state,managed:true});
 await write('cleaned.json',{at:new Date().toISOString()});console.log('Cleaned own backend');process.exit(0);
}
if(op!=='hb')throw Error('HB-only validation: no other execution method supported');
if(['learning','overview','asset','run','site','registry'].includes(args[0])||args.includes('--learn'))throw Error('Learning/assets forbidden');
const lock=path.join(trial,'command.lock');const handle=await fs.open(lock,'wx').catch(()=>null);if(!handle)throw Error('Previous command running; poll it, do not retransmit');
try{
 const timing=await read('timing.json');if(!timing.firstCommandAt){timing.firstCommandAt=new Date().toISOString();await write('timing.json',timing);}
 const count=(await read('counter.json').catch(()=>({count:0}))).count;
 if(count>=45||Date.now()-Date.parse(timing.firstCommandAt)>480000){console.log(JSON.stringify({budgetExceeded:true}));process.exitCode=2;}else{
 const sequence=count+1;await write('counter.json',{count:sequence});const startedAt=new Date().toISOString(),t0=performance.now();
 const remaining=()=>Math.max(1,480000-(Date.now()-Date.parse(timing.firstCommandAt)));
 let result=await command([path.join(ROOT,'scripts/webctl-rpc.mjs'),...args],env,Math.min(90000,remaining()));
 if(result.code===42){result=await command([path.join(ROOT,'scripts/launcher.mjs'),'webctl',...args],env,Math.min(90000,remaining()));result.fastPathFallback=true;}
 const log={sequence,method:'hb',startedAt,endedAt:new Date().toISOString(),durationMs:performance.now()-t0,args,...result};await write('command-'+String(sequence).padStart(3,'0')+'.json',log);await fs.appendFile(path.join(trial,'commands.jsonl'),JSON.stringify({...log,stdout:undefined,stderr:undefined})+'\n');console.log(result.stdout||'');if(result.stderr)console.error(result.stderr);console.error(JSON.stringify({validation:{sequence,durationMs:log.durationMs,code:result.code}}));process.exitCode=result.code===0?0:1;
 }
}finally{await handle.close();await fs.rm(lock,{force:true});}
