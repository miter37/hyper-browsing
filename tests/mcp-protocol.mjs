import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createMcpHandler} from '../scripts/mcp-server.mjs';
import {TOOLS,runTool,validateToolInput} from '../scripts/mcp-tools.mjs';

const msg=(method,id,params)=>({jsonrpc:'2.0',id,method,params});
test('MCP initialize, tools/list, ping and notification contract',async()=>{
  const h=createMcpHandler(async()=>({ok:true}));
  const init=await h(msg('initialize',1,{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}));
  assert.equal(init.result.protocolVersion,'2025-06-18');
  assert.ok(init.result.capabilities.tools);
  const listing=await h(msg('tools/list',2));
  assert.ok(listing.result.tools.some(t=>t.name==='smart_scroll'));
  assert.ok(listing.result.tools.some(t=>t.name==='run_saved_action'));
  assert.ok(!listing.result.tools.some(t=>/eval|arbitrary|exec/.test(t.name)));
  assert.equal((await h(msg('ping',3))).result!==undefined,true);
  assert.equal(await h(msg('notifications/initialized',undefined)),null);
  assert.equal(TOOLS.length>=15,true);
});
test('invalid target/unknown tool/unsafe arguments fail before any RPC',async()=>{
  const called=[];const h=createMcpHandler(async(method,params)=>{called.push([method,params]);return {ok:true};});
  assert.equal((await h(msg('tools/call',1,{name:'imaginary',arguments:{}}))).error.code,-32602);
  assert.equal((await h(msg('tools/call',2,{name:'click',arguments:{sessionId:'a',locator:{css:'#a'},ref:'e1'}}))).error.code,-32602);
  assert.equal((await h(msg('tools/call',3,{name:'session_open',arguments:{url:'file:///etc/passwd'}}))).error.code,-32602);
  assert.equal((await h(msg('tools/call',4,{name:'click',arguments:{sessionId:'a',locator:{css:'#a'},arbitrary:true}}))).error.code,-32602);
  assert.equal(called.length,0);
});
test('MCP actions relay unchanged to the shared safety engine (no hidden approval)',async()=>{
  const calls=[];
  const h=createMcpHandler(async(method,params)=>{
    calls.push({method,params});
    return method==='page.click'?{ok:false,confirmationRequired:true,execution:'not_started',risk:'external_write'}:{ok:true,execution:'completed'};
  });
  const click=await h(msg('tools/call',1,{name:'click',arguments:{sessionId:'s',ref:'e27'}}));
  assert.equal(calls[0].method,'page.click');
  assert.equal(calls[0].params.confirmed,undefined);
  assert.equal(click.result.isError,true);
  assert.equal(JSON.parse(click.result.content[0].text).confirmationRequired,true);
  const done=await h(msg('tools/call',2,{name:'run_saved_action',arguments:{sessionId:'s',actionId:'read_facts'}}));
  assert.equal(done.result.isError,false);
  assert.equal(calls[1].method,'action.run');
  assert.equal(calls[1].params.confirmed,false);
});
test('smart scroll accumulates unique items over bounded rounds and never sends writes',async()=>{
  const calls=[];let i=0;
  const result=await runTool('smart_scroll',{sessionId:'s',rounds:3,limit:4},async(method,params)=>{
    calls.push(method);
    if(method==='page.scroll')return {ok:true};
    i++;
    return {found:true,items:[{title:'A',href:'https://x/a',text:'A'},{title:String(i),href:'https://x/'+i,text:String(i)}]};
  });
  assert.equal(result.ok,true);
  assert.equal(result.items.length,4);
  assert.ok(calls.every(x=>x==='page.list'||x==='page.scroll'));
  assert.equal(calls.filter(x=>x==='page.scroll').length,2);
});
test('stdio wire contains only JSON-RPC and exits after stdin closes',async()=>{
  const child=spawn(process.execPath,['scripts/mcp-server.mjs'],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',d=>stdout+=d);
  child.stderr.setEncoding('utf8');child.stderr.on('data',d=>stderr+=d);
  child.stdin.write(JSON.stringify(msg('initialize',1,{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}))+'\n');
  child.stdin.write(JSON.stringify(msg('tools/list',2))+'\n');
  child.stdin.write(JSON.stringify(msg('ping',3))+'\n');
  child.stdin.end();
  const exit=await Promise.race([new Promise(r=>child.on('exit',code=>r(code))),new Promise((_,rej)=>setTimeout(()=>{child.kill();rej(new Error('stdio exit timeout'))},5000))]);
  assert.equal(exit,0,stderr);
  const events=stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(e=>e.id).sort(),[1,2,3]);
  assert.equal(events.find(e=>e.id===2).result.tools.length,TOOLS.length);
});
