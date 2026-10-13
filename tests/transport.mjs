import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BrowserdClient } from '../src/browserd/client.ts';
import { postRpc } from '../scripts/rpc-transport.mjs';
import { RequestStore } from '../src/browserd/request-store.ts';
import { compactResult } from '../src/runtime/output.ts';

test('response loss produces outcome_unknown and never repeats a transmitted command',async t=>{
  let executions=0;
  const server=http.createServer((req,res)=>{executions++;req.resume();req.on('end',()=>{res.destroy();});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await postRpc({endpoint:`http://127.0.0.1:${server.address().port}`,token:'test',method:'page.click',params:{sessionId:'s'},timeoutMs:100});
  assert.equal(result.result.execution,'outcome_unknown');assert.equal(result.fallbackAllowed,false);assert.ok(result.result.requestId);assert.equal(executions,1);
});
test('response deadline also covers incomplete response bodies',async t=>{
  const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const result=await postRpc({endpoint:`http://127.0.0.1:${server.address().port}`,token:'test',method:'page.fill',params:{},timeoutMs:100});
  assert.equal(result.result.execution,'outcome_unknown');assert.equal(result.fallbackAllowed,false);
});
test('duplicate request ID shares execution, while different payload is rejected',async()=>{
  const requests=new RequestStore();let n=0;
  const execute=async()=>{n++;await new Promise(resolve=>setTimeout(resolve,30));return{ok:true};};
  const [a,b]=await Promise.all([requests.run('request-a','page.click',{ref:'@e1'},execute),requests.run('request-a','page.click',{ref:'@e1'},execute)]);
  assert.equal(n,1);assert.deepEqual(a,b);
  assert.equal(requests.status('request-a').state,'completed');
  await assert.rejects(requests.run('request-a','page.click',{ref:'@e2'},execute));
  await requests.run('metadata','learning.action.save',{description:'first'},execute);
  await assert.rejects(requests.run('metadata','learning.action.save',{description:'changed'},execute));
});
test('compact output keeps safety information but omits detailed probe logs',()=>{
  const result=compactResult({ok:false,execution:'outcome_unknown',reason:'timeout',log:['long'],snapshot:{elements:[{name:'Large'}]},ambiguous:true,candidates:[{name:'A'}],truncated:true,effect:{urlChanged:true,url:'https://example.test',page:{opened:['dialog Confirm'],valueChanges:{a:{before:'old',after:'new'}}}},hint:'Observe again'});
  assert.equal(result.execution,'outcome_unknown');assert.equal(result.ambiguous,true);assert.equal(result.truncated,true);assert.equal(result.hint,'Observe again');
  assert.equal(result.log,undefined);assert.equal(result.snapshot,undefined);assert.equal(result.effect.urlChanged,true);assert.deepEqual(result.effect.page.opened,['dialog Confirm']);
});
