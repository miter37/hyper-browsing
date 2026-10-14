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
  const result=await postRpc({endpoint:`http://127.0.0.1:${server.address().port}`,token:'test',method:'page.click',params:{sessionId:'s'},timeoutMs:100,completionWaitMs:0});
  assert.equal(result.result.execution,'outcome_unknown');assert.equal(result.fallbackAllowed,false);assert.ok(result.result.requestId);assert.equal(executions,1);
});
test('response deadline also covers incomplete response bodies',async t=>{
  const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const result=await postRpc({endpoint:`http://127.0.0.1:${server.address().port}`,token:'test',method:'page.fill',params:{},timeoutMs:100,completionWaitMs:0});
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

async function delayedRpcFixture(t,{delay=80,status='completed',result={ok:true,execution:'completed',effect:{newSessions:[{sessionId:'popup_a',setupStatus:'ready'}]},headedFallback:{attempted:true,switched:true},observationRequired:true}}={}){
 let executions=0,checks=0,finished=false;const methods=[];const ids=[];let originalId;
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);methods.push(data.method);res.setHeader('content-type','application/json');
 if(data.method==='request.status'){checks++;assert.equal(data.params.requestId,originalId,`status polling must query the original requestId; got ${data.params.requestId} vs ${originalId}`);res.end(JSON.stringify({ok:true,result:{state:status==='completed'?(finished?'completed':'running'):status,execution:status==='failed'?'outcome_unknown':'completed',result:finished?result:undefined,error:status==='failed'?'execution failed':undefined}}));return;}
 ids.push(data.requestId);originalId=data.requestId;
 executions++;setTimeout(()=>{finished=true;res.end(JSON.stringify({ok:true,result}));},delay);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});return {endpoint:`http://127.0.0.1:${server.address().port}`,counts:()=>({executions,checks,methods})};
}

test('slow headed recovery automatically collects completion without repeating the write',async t=>{
 const f=await delayedRpcFixture(t);const r=await postRpc({endpoint:f.endpoint,token:'test',method:'page.click',timeoutMs:30,completionWaitMs:800});
 assert.equal(r.result.ok,true);assert.equal(r.result.execution,'completed');assert.equal(r.result.effect.newSessions[0].sessionId,'popup_a');assert.equal(r.result.observationRequired,true);assert.equal(r.result.headedFallback.switched,true);assert.equal(r.result.transportRecovery.kind,'request_status');assert.equal(f.counts().executions,1);assert.ok(f.counts().checks>=1);assert.equal(r.fallbackAllowed,false);
});

test('completion polling preserves the full snapshot and original request identity',async t=>{
 const f=await delayedRpcFixture(t,{result:{snapshot:{elements:[{name:'NASA official result',ref:'e27'}]},pageState:{state:'ready'}}});const r=await postRpc({endpoint:f.endpoint,token:'test',method:'page.snapshot',timeoutMs:30,completionWaitMs:800,requestId:'original-request'});
 assert.equal(r.result.requestId,'original-request');assert.equal(r.result.snapshot.elements[0].ref,'e27');assert.equal(f.counts().executions,1);
});

test('unavailable request history never authorizes launcher fallback or retransmission',async t=>{
 const f=await delayedRpcFixture(t,{status:'unknown'});const r=await postRpc({endpoint:f.endpoint,token:'test',method:'page.fill',timeoutMs:30,completionWaitMs:100});
 assert.equal(r.result.execution,'outcome_unknown');assert.equal(r.fallbackAllowed,false);assert.equal(f.counts().executions,1);assert.equal(f.counts().checks,1);
});

test('status polling is bounded when the original request is still running',async t=>{
 const f=await delayedRpcFixture(t,{status:'running',delay:500});const started=Date.now();const r=await postRpc({endpoint:f.endpoint,token:'test',method:'page.click',timeoutMs:30,completionWaitMs:75});
 assert.equal(r.result.execution,'outcome_unknown');assert.equal(r.result.requestState,'running');assert.equal(f.counts().executions,1);assert.ok(Date.now()-started<500);
});

test('failed original requests return failure and do not reexecute',async t=>{
 const f=await delayedRpcFixture(t,{status:'failed'});const r=await postRpc({endpoint:f.endpoint,token:'test',method:'page.click',timeoutMs:30,completionWaitMs:100});
 assert.equal(r.result.ok,false);assert.equal(r.result.reason,'request_failed');assert.equal(r.result.execution,'outcome_unknown');assert.equal(f.counts().executions,1);
});
