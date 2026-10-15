import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
test('fast RPC and TypeScript CLI both carry context flags to page.snapshot',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hwm-cli-'));
 const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const r=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:r.params.format==='hwm'?{hwm:'@hwm p1\nn1 document\n@end p1 complete\n'}:{method:r.method,params:r.params}}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 await fs.writeFile(path.join(dir,'browserd-endpoint.json'),JSON.stringify({port:server.address().port}));await fs.writeFile(path.join(dir,'browserd.token'),'fixture-token');
 for(const prefix of [['scripts/webctl-rpc.mjs'],['--import','tsx','src/bin/webctl.ts']]){
  for(const [args,method] of [[['close','--session','s1'],'session.close'],[['close','--all'],'session.closeAll']]){const response=await exec(process.execPath,[...prefix,...args,'--format','json'],{windowsHide:true,timeout:10000,env:{...process.env,WEBAGENT_RUNTIME_DIR:dir,WEBAGENT_PORT:String(server.address().port),WEBAGENT_HOST:'127.0.0.1'}});const payload=JSON.parse(response.stdout);assert.equal(payload.method,method);if(method==='session.close')assert.equal(payload.params.sessionId,'s1');}
  const automatic=await exec(process.execPath,[...prefix,'snapshot','--session','s1'],{windowsHide:true,timeout:10000,env:{...process.env,WEBAGENT_RUNTIME_DIR:dir,WEBAGENT_PORT:String(server.address().port),WEBAGENT_HOST:'127.0.0.1'}});assert.equal(JSON.parse(automatic.stdout).params.format,'hb');
  const {stdout}=await exec(process.execPath,[...prefix,'snapshot','--session','s1','--context','--context-limit','42','--format','json'],{windowsHide:true,timeout:10000,env:{...process.env,WEBAGENT_RUNTIME_DIR:dir,WEBAGENT_PORT:String(server.address().port),WEBAGENT_HOST:'127.0.0.1'}});
  const result=JSON.parse(stdout);assert.equal(result.method,'page.snapshot');assert.equal(result.params.context,true);assert.equal(result.params.contextLimit,'42');
  const formatted=await exec(process.execPath,[...prefix,'snapshot','--session','s1','--format','hwm'],{windowsHide:true,timeout:10000,env:{...process.env,WEBAGENT_RUNTIME_DIR:dir,WEBAGENT_PORT:String(server.address().port),WEBAGENT_HOST:'127.0.0.1'}});
  assert.equal(formatted.stdout,'@hwm p1\nn1 document\n@end p1 complete\n');
  const beforeFile=path.join(dir,'before.json');await fs.writeFile(beforeFile,JSON.stringify({elements:[],contextGraph:{observation:'pOld'}}));
  for(const args of [['fill','--css','input','--value','X'],['diff','--before',beforeFile],['batch','--input',JSON.stringify({commands:[]})]]){
   const response=await exec(process.execPath,[...prefix,...args,'--session','s1','--context','--format','json'],{windowsHide:true,timeout:10000,env:{...process.env,WEBAGENT_RUNTIME_DIR:dir,WEBAGENT_PORT:String(server.address().port),WEBAGENT_HOST:'127.0.0.1'}});
   const payload=JSON.parse(response.stdout);assert.equal(payload.params.context,true);assert.equal(payload.params.format,'json');
  }
  for(const command of ['view','expand','inspect','changes']){
   const response=await exec(process.execPath,[...prefix,command,'--session','s1','--observation','p1','--target','n2','--comparison','cmp1','--mode','overview','--node-budget','17','--format','json'],{windowsHide:true,timeout:10000,env:{...process.env,WEBAGENT_RUNTIME_DIR:dir,WEBAGENT_PORT:String(server.address().port),WEBAGENT_HOST:'127.0.0.1'}});
   const payload=JSON.parse(response.stdout);assert.equal(payload.method,'observation.'+command);assert.equal(payload.params.observation,'p1');assert.equal(payload.params.nodeBudget,'17');assert.equal(payload.params.mode,'overview');
  }
 }
});
