import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { mapCommandToRpc } from '../scripts/webctl-rpc.mjs';

test('fast and normal command surfaces carry learning and recovery payloads',()=>{
  assert.equal(mapCommandToRpc(['learning','notes'],{session:'s',capability:'filters'},new Set()).method,'learning.notes');
  assert.equal(mapCommandToRpc(['overview','run'],{session:'s',site:'example'},new Set()).params.siteId,'example');
  assert.equal(mapCommandToRpc(['asset','report','search'],{session:'s',reason:'wrong_result'},new Set()).params.actionId,'search');
  assert.equal(mapCommandToRpc(['extract'],{session:'s',css:'#value'},new Set(['learn','requested'])).params.requested,true);
});
test('learning finish works without a daemon and does not create a browser',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-cli-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const payload=path.join(root,'finish.json');await fs.writeFile(payload,JSON.stringify({taskStatus:'succeeded',decision:'skipped',reason:'one_off'}));
  const result=spawnSync(process.execPath,['scripts/launcher.mjs','webctl','learning','finish','--session','s','--input-file',payload],{
    cwd:process.cwd(),env:{...process.env,WEBAGENT_RUNTIME_DIR:root},encoding:'utf8',timeout:10000,windowsHide:true,
  });
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).taskStatus,'succeeded');
  assert.equal(await fs.stat(path.join(root,'chrome-state.json')).then(()=>true,()=>false),false);
});
test('RPC overview failure returns a nonzero exit code, never a false success',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-rpc-'));
  const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:{ok:false,fallbackRequired:true}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  await fs.writeFile(path.join(root,'browserd-endpoint.json'),JSON.stringify({port:server.address().port}));
  await fs.writeFile(path.join(root,'browserd.token'),'test-token');
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/webctl-rpc.mjs','overview','run','--session','s','--site','example'],{env:{...process.env,WEBAGENT_RUNTIME_DIR:root},windowsHide:true});
    let stdout='';child.stdout.on('data',d=>stdout+=d);child.on('error',reject);child.on('close',code=>resolve({code,stdout}));
  });
  assert.equal(result.code,1);assert.equal(JSON.parse(result.stdout).fallbackRequired,true);
});
