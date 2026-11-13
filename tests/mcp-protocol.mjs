import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createMcpHandler} from '../scripts/mcp-server.mjs';
import {TOOLS,runTool,validateToolInput,locatorFromCliFlags} from '../scripts/mcp-tools.mjs';

const msg=(method,id,params)=>({jsonrpc:'2.0',id,method,params});

test('failed daemon startup never reports a transmitted action',{timeout:5000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hb-mcp-startup-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const scripts=path.join(root,'scripts');await fs.mkdir(scripts);
  for(const file of ['mcp-server.mjs','mcp-tools.mjs','rpc-transport.mjs'])await fs.copyFile(path.resolve('scripts',file),path.join(scripts,file));
  await fs.writeFile(path.join(scripts,'launcher.mjs'),'process.stderr.write("Fixture startup failure");process.exit(1);');
  const child=spawn(process.execPath,[path.join(scripts,'mcp-server.mjs')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  t.after(()=>child.kill());
  let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stdout.on('data',d=>stdout+=d);
  child.stderr.setEncoding('utf8');child.stderr.on('data',d=>stderr+=d);
  child.stdin.end(JSON.stringify(msg('tools/call',1,{name:'click',arguments:{sessionId:'s',ref:'e1'}}))+'\n');
  const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0,stderr);
  const response=JSON.parse(stdout);assert.equal(response.result.isError,true);
  const result=JSON.parse(response.result.content[0].text);
  assert.equal(result.execution,'not_started');assert.equal(result.reason,'browser_startup_failed');
  assert.match(result.error,/Fixture startup failure/);
});
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
test('read and navigation tools reach the daemon with narrowing arguments',async()=>{
  const calls=[];const call=async(method,params)=>{calls.push({method,params});return {ok:true};};
  await runTool('read_text',{sessionId:'s',locator:{css:'.temp'},nth:1,all:true},call);
  assert.deepEqual(calls[0],{method:'page.extract',params:{sessionId:'s',locator:{css:'.temp'},nth:1,all:true,read:'text',learn:false}});
  await runTool('navigate',{sessionId:'s',url:'https://example.com/'},call);
  assert.equal(calls[1].method,'page.goto');
  await runTool('click',{sessionId:'s',locator:{role:'link',name:'hide'},nth:2,within:'Top'},call);
  assert.deepEqual(calls[2].params,{sessionId:'s',locator:{role:'link',name:'hide'},nth:2,within:'Top'});
  for(const [name,args] of [
    ['read_text',{sessionId:'s',ref:'e1',nth:0}],
    ['read_text',{sessionId:'s',locator:{css:'a'},read:'html'}],
    ['navigate',{sessionId:'s',url:'file:///etc/passwd'}],
    ['wait_for',{sessionId:'s'}],
  ]) assert.throws(()=>validateToolInput(name,args),undefined,name);
  assert.equal(calls.length,3);
});
test('daemon guidance is translated from CLI flags to tool arguments',async()=>{
  assert.deepEqual(locatorFromCliFlags('--role button --name "Save \\"all\\"" --exact'),{role:'button',name:'Save "all"',exact:true});
  assert.equal(locatorFromCliFlags('free text'),null);
  const ambiguous=await runTool('click',{sessionId:'s',locator:{role:'link',name:'hide'}},async()=>({ok:false,ambiguous:true,
    hint:'Several visible elements match. Re-run with --nth N (from candidates), --within "<heading/section text>", or a more specific locator.'}));
  assert.equal(/--nth|--within/.test(ambiguous.hint),false);
  assert.match(ambiguous.hint,/\bnth\b.*\bwithin\b/);
  const snap=await runTool('snapshot',{sessionId:'s'},async()=>({snapshot:{url:'https://x/'+'a'.repeat(400),collapsed:[{tag:'a',name:'More',use:'--text "More" --exact'}]}}));
  assert.deepEqual(snap.snapshot.collapsed[0],{tag:'a',name:'More',locator:{text:'More',exact:true}});
  assert.equal(snap.snapshot.url.length,410); // page URLs stay whole outside listings
});
test('session listings keep long URLs short',async()=>{
  const long='https://accounts.example/signin?'+'q'.repeat(2000);
  const status=await runTool('browser_status',{},async()=>({status:'ok',sessions:[{id:'a',url:long},{id:'b',url:'https://x/'}]}));
  assert.equal(status.sessions[0].url.length,201);
  assert.equal(status.sessions[0].urlTruncated,true);
  assert.deepEqual(status.sessions[1],{id:'b',url:'https://x/'});
});
test('MCP results stay small: session id alias, short close, capped long text',async()=>{
  const open=await runTool('session_open',{url:'https://x.test/'},async()=>({id:'task_1',title:'t'.repeat(500)}));
  assert.equal(open.sessionId,'task_1');assert.equal(open.title.length,161);
  const closed=await runTool('session_close',{sessionId:'task_1'},async()=>({closed:'task_1',learning:{journal:'x'.repeat(900),learningPending:false},requestId:'r'}));
  assert.deepEqual(closed,{ok:true,closed:'task_1',requestId:'r'});
  const read=await runTool('read_text',{sessionId:'s',locator:{css:'body'}},async()=>({value:'v'.repeat(9000)}));
  assert.equal(read.value.length,4001);assert.ok(read.truncatedValues);
});
