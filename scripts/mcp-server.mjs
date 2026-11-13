#!/usr/bin/env node
/** Zero-dependency MCP stdio server (JSON-RPC 2.0, line-delimited). */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {postRpc} from './rpc-transport.mjs';
import {TOOLS,runTool,validateToolInput} from './mcp-tools.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const RUNTIME=path.resolve(process.env.WEBAGENT_RUNTIME_DIR||path.join(ROOT,'.runtime'));
const ENDPOINT=path.join(RUNTIME,'browserd-endpoint.json');
const TOKEN=path.join(RUNTIME,'browserd.token');
const PROTOCOL='2025-06-18';
const SERVER_INFO={name:'hyper-browsing',version:'0.3.0'};

function readCredentials(){
  const port=Number(JSON.parse(fs.readFileSync(ENDPOINT,'utf8')).port);
  const token=fs.readFileSync(TOKEN,'utf8').trim();
  if(!Number.isInteger(port)||port<1||port>65535||!token)throw new Error('Invalid browserd endpoint credentials');
  return {endpoint:'http://127.0.0.1:'+port,token};
}
let started=false;
async function defaultRpc(method,params,retried=false){
  if(!started){
    // Launcher ensures a token-authenticated local daemon, reusing the existing
    // Chrome profile. It prints to stderr, never into MCP stdout.
    const child=spawnSync(process.execPath,[path.join(ROOT,'scripts/launcher.mjs'),'webctl','health'],{
      cwd:ROOT,env:{...process.env,WEBAGENT_HOME:ROOT},encoding:'utf8',timeout:95000,
      maxBuffer:2*1024*1024,windowsHide:true,
    });
    if(child.status!==0)return {ok:false,execution:'not_started',reason:'browser_startup_failed',error:'Browser startup failed: '+(child.stderr||child.error?.message||'unknown').slice(0,1200)};
    started=true;
  }
  let credentials;
  try{credentials=readCredentials();}
  catch(error){started=false;return {ok:false,execution:'not_started',reason:'daemon_credentials_unavailable',error:String(error?.message||error)};}
  let response=await postRpc({...credentials,method,params});
  // ECONNREFUSED means the command never reached the daemon. Startup may be
  // repeated, but an outcome_unknown action must NEVER be retransmitted.
  if(response.fallbackAllowed){
    started=false;
    // The daemon was restarted or stopped since the last call. The command never reached it, so starting the
    // daemon again and sending it once more cannot repeat an action.
    if(!retried)return defaultRpc(method,params,true);
    return {ok:false,execution:'not_started',reason:'daemon_unreachable',hint:'Restart the MCP connection or run hyper-browsing doctor. Original command was not transmitted.'};
  }
  return response.result;
}

export function createMcpHandler(rpc=defaultRpc){
  return async function handle(message) {
    const id=message?.id;
    if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string')
      return id===undefined ? null : {jsonrpc:'2.0',id,error:{code:-32600,message:'Invalid request'}};
    if(id===undefined)return null; // Notifications never get responses.
    const ok=result=>({jsonrpc:'2.0',id,result});
    const error=(code,text)=>({jsonrpc:'2.0',id,error:{code,message:text}});
    try{
      switch(message.method){
        case 'initialize':{
          const offered=message.params?.protocolVersion;
          const version=offered==='2025-03-26'?'2025-03-26':PROTOCOL;
          return ok({protocolVersion:version,capabilities:{tools:{}},serverInfo:SERVER_INFO,
            instructions:'Local Chrome browser automation. Always inspect current refs before acting. No blind retries after outcome_unknown. Explicit user approval is required before external writes.'});
        }
        case 'ping':return ok({});
        case 'tools/list':return ok({tools:TOOLS});
        case 'tools/call':{
          const name=message.params?.name;
          const args=message.params?.arguments||{};
          if(typeof name!=='string'||!TOOLS.some(t=>t.name===name))return error(-32602,'Unknown tool');
          try{validateToolInput(name,args);}
          catch(e){return error(-32602,String(e.message||e));}
          try{
            const result=await runTool(name,args,rpc);
            const safe=result===undefined?{ok:false,reason:'empty_result'}:result;
            return ok({content:[{type:'text',text:JSON.stringify(safe)}],
              isError:Boolean(safe?.ok===false)});
          }catch(e){return ok({content:[{type:'text',text:JSON.stringify({ok:false,error:String(e.message||e),execution:'outcome_unknown'})}],isError:true});}
        }
        default:return error(-32601,'Method not found');
      }
    }catch(e){return error(-32603,String(e.message||e));}
  };
}

if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))){
  const handle=createMcpHandler();
  // Keep stdout a *pure* MCP channel. Diagnostics go to stderr.
  const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  let pending=0,closed=false;
  const finish=()=>{if(closed&&pending===0)process.exit(0);};
  lines.on('line',async line=>{
    if(!line.trim())return;
    pending++;
    try{
      let msg;
      try{msg=JSON.parse(line);}
      catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');return;}
      const answer=await handle(msg);
      if(answer)process.stdout.write(JSON.stringify(answer)+'\n');
    }catch(error){
      process.stderr.write('[hyper-browsing-mcp] '+String(error?.message||error)+'\n');
    }finally{pending--;finish();}
  });
  lines.on('close',()=>{closed=true;finish();});
}
