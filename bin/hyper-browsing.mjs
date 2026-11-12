#!/usr/bin/env node
/** Cross-platform npm/npx entry point. */
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const argv=process.argv.slice(2);
const help=()=>{
process.stdout.write('Hyper-Browsing — local-first browser automation for AI agents\n\n'+
'Commands:\n'+
'  hyper-browsing mcp                   MCP stdio server for AI clients\n'+
'  hyper-browsing doctor                Verify browser daemon and Chrome\n'+
'  hyper-browsing browser start         Start/reuse the local browser daemon\n'+
'  hyper-browsing browser status        View browser status\n'+
'  hyper-browsing webctl <command>      Full CLI command set\n'+
'  hyper-browsing <webctl command>      Short form (session, snapshot, ...)\n'+
'  hyper-browsing help                  Show this help\n\n'+
'Requires Node.js 20+ and installed Google Chrome.\n');
};
if(!argv.length||['help','--help','-h'].includes(argv[0])){help();process.exit(0);}
if(argv[0]==='--version'||argv[0]==='-v'){process.stdout.write('0.3.0\n');process.exit(0);}
const runtime=process.env.WEBAGENT_RUNTIME_DIR||path.join(os.homedir(),'.hyper-browsing');
const env={...process.env,WEBAGENT_HOME:ROOT,WEBAGENT_RUNTIME_DIR:runtime};
const command=argv[0];
let target,args;
if(command==='mcp'){target='scripts/mcp-server.mjs';args=[];}
else if(command==='doctor'){target='scripts/launcher.mjs';args=['webctl','browser','status'];}
else if(command==='browser'&&argv[1]==='start'){target='scripts/launcher.mjs';args=['webctl','health'];}
else if(command==='daemon'){target='scripts/launcher.mjs';args=['browserd',...argv.slice(1)];}
else {target='scripts/launcher.mjs';args=['webctl',...(command==='webctl'?argv.slice(1):argv)];}
const child=spawn(process.execPath,[path.join(ROOT,target),...args],{env,cwd:ROOT,stdio:'inherit',windowsHide:false});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',err=>{process.stderr.write('Hyper-Browsing launch error: '+err.message+'\n');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
