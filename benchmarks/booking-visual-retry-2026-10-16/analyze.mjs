import fs from 'node:fs/promises';
import path from 'node:path';
const base=path.resolve('benchmarks/booking-visual-retry-2026-10-16'),privateRoot=path.resolve('.runtime/booking-visual-retry-2026-10-16');
const scenarios=JSON.parse(await fs.readFile('benchmarks/booking-visual-retry-2026-10-16/scenarios.json','utf8'));
const json=async file=>fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
const traces=new Map(),sessions='C:/Users/doyoon.kim/.codex/sessions/2026/10/16';
for(const name of await fs.readdir(sessions).catch(()=>[]))if(name.endsWith('.jsonl')){
 const text=await fs.readFile(path.join(sessions,name),'utf8'),first=JSON.parse(text.split('\n')[0]),agent=first.payload?.source?.subagent?.thread_spawn?.agent_path;
 if(!agent?.startsWith('/root/visualfix_'))continue;
 const events=text.trim().split('\n').map(JSON.parse),context=events.find(e=>e.type==='turn_context')?.payload,done=events.filter(e=>e.type==='event_msg'&&e.payload.type==='task_complete').at(-1);
 const usage=events.filter(e=>e.type==='event_msg'&&e.payload.type==='token_count').at(-1)?.payload.info?.total_token_usage;
 const outputs=events.filter(e=>e.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(e.payload.type));
 const textOf=p=>typeof p.output==='string'?p.output:Array.isArray(p.output)?p.output.filter(b=>['input_text','text'].includes(b.type)).map(b=>b.text??'').join('\n'):'';
 const calls=events.filter(e=>e.type==='response_item'&&['function_call','custom_tool_call'].includes(e.payload.type)),callText=calls.map(e=>e.payload.input??e.payload.arguments??'').join('\n').replace(/\\+/g,'/');
 traces.set(agent,{agent,sessionFile:name,startedAt:first.timestamp,completedAt:done?.timestamp,wallMs:done?Date.parse(done.timestamp)-Date.parse(first.timestamp):null,model:context?.model,effort:context?.effort,projectSkillReadObserved:callText.includes('D:/APPs/hyper-browsing/SKILL.md'),prohibitedToolObserved:/browser-use\.exe|D:\/APPs\/browser-use\/|tools\.web__run|cua\./i.test(callText),toolCalls:calls.length,deliveredToolTextBytes:outputs.reduce((n,e)=>n+Buffer.byteLength(textOf(e.payload)),0),truncatedToolResponses:outputs.filter(e=>/truncated output|tokens truncated|output truncated/i.test(textOf(e.payload))).length,tokenUsage:usage??null});
}
const rows=[];
for(const scenario of scenarios){
 const folder=path.join(privateRoot,scenario.site),result=await json(path.join(folder,'result.json')),audit=await json(path.join(folder,'audit.json')),timing=await json(path.join(folder,'timing.json'));
 if(!timing)continue;
 const commands=(await fs.readFile(path.join(folder,'commands.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);
 const initial=await json(path.join(folder,'chrome-initial.json')),current=await json(path.join(folder,'chrome-state.json'));
 let completedInputs=0;for(const c of commands){const raw=await json(path.join(folder,`command-${String(c.sequence).padStart(3,'0')}.json`));let output;try{output=JSON.parse(raw.stdout);}catch{continue;}
  if(c.args[0]==='run')for(const s of output.steps??[]){if(s.action?.execution==='completed')completedInputs++;if(s.action?.submissionExecution==='completed'||s.action?.value?.submitted===true)completedInputs++;}
  else if(['click','fill','press','select','hover'].includes(c.args[0])&&output.execution==='completed'){completedInputs++;if(output.submissionExecution==='completed'||output.value?.submitted===true)completedInputs++;}
 }
 const row={site:scenario.site,status:audit?.status??result?.status??'running',claimedStatus:result?.status,audited:!!audit,score:(audit?.checkpoints??result?.checkpoints??[]).filter(c=>c.passed).length,calls:commands.length,completedInputs,taskWallMs:commands.length?Date.parse(commands.at(-1).endedAt)-Date.parse(commands[0].startedAt):null,cliMs:commands.reduce((n,c)=>n+c.durationMs,0),stdoutBytes:commands.reduce((n,c)=>n+c.stdoutBytes,0),stderrBytes:commands.reduce((n,c)=>n+c.stderrBytes,0),initialHeadless:initial?.headless,finalHeadless:current?.headless,failedCalls:commands.filter(c=>c.code!==0).length,revealCalls:commands.filter(c=>c.args[0]==='browser'&&c.args[1]==='reveal').length,setupMs:timing.setupMs,trace:traces.get('/root/visualfix_'+scenario.site)??null,difficulties:result?.difficulties,processFindings:audit?.processFindings,output:result?.output};
 rows.push(row);
}
await fs.writeFile(path.join(base,'results-live.json'),JSON.stringify(rows,null,2));
await fs.writeFile(path.join(base,'trials.json'),JSON.stringify(scenarios.map((s,i)=>({site:s.site,sequence:i+1,agent:'/root/visualfix_'+s.site,status:rows.find(r=>r.site===s.site)?.status??'queued'})),null,2));
console.log(JSON.stringify(rows.map(({site,status,score,calls,taskWallMs,initialHeadless,finalHeadless,audited})=>({site,status,score,calls,seconds:taskWallMs/1000,initialHeadless,finalHeadless,audited}))));
