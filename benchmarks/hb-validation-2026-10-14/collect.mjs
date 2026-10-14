import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..'),privateRoot=path.join(root,'.runtime','hb-validation-20261014','trials');
const trials=JSON.parse(await fs.readFile(path.join(base,'trials.json'),'utf8'));
const sessionIndex=new Map();
for(const day of ['13','14','15']){
const sessions='C:/Users/doyoon.kim/.codex/sessions/2026/10/'+day;
for(const file of await fs.readdir(sessions).catch(()=>[])){
 if(!file.endsWith('.jsonl'))continue;
 const text=await fs.readFile(path.join(sessions,file),'utf8');const first=JSON.parse(text.split('\n')[0]);
 const agent=first.payload?.source?.subagent?.thread_spawn?.agent_path;
 if(agent?.startsWith('/root/validate_'))sessionIndex.set(agent,{file,text,first});
}}
function unionMs(intervals){let sum=0,end=-Infinity;for(const [a,b]of intervals.sort((x,y)=>x[0]-y[0])){if(b>a){sum+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}}return sum;}
const rows=[];
for(const trial of trials){
 const folder=path.join(privateRoot,trial.id);const result=await fs.readFile(path.join(folder,'result.json'),'utf8').then(JSON.parse).catch(()=>null);
 const timing=await fs.readFile(path.join(folder,'timing.json'),'utf8').then(JSON.parse).catch(()=>null);
 const commands=await fs.readFile(path.join(folder,'commands.jsonl'),'utf8').then(s=>s.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(()=>[]);
 const source=sessionIndex.get(trial.agent||`/root/validate_${trial.id.replace(/_hb$/,'')}`);let metrics={};
 if(source){
  const events=source.text.trim().split('\n').map(JSON.parse),contexts=events.filter(e=>e.type==='turn_context');
  const completed=events.filter(e=>e.type==='event_msg'&&e.payload.type==='task_complete').at(-1);
  const token=events.filter(e=>e.type==='event_msg'&&e.payload.type==='token_count').at(-1)?.payload.info?.total_token_usage;
  const items=events.filter(e=>e.type==='event_msg'&&e.payload.type==='item_completed');
  const executions=items.filter(e=>e.payload.item?.type==='CommandExecution');
  const toolItems=items.filter(e=>!['Reasoning','AgentMessage','Plan','TodoList','UserMessage'].includes(e.payload.item?.type));
  const toolIntervals=toolItems.map(e=>[e.payload.started_at_ms,e.payload.completed_at_ms]).filter(a=>a.every(Number.isFinite));
  const wall=completed?Date.parse(completed.timestamp)-Date.parse(source.first.timestamp):null;
  const functionCalls=events.filter(e=>e.type==='response_item'&&['function_call','custom_tool_call'].includes(e.payload.type));
  metrics={agent:source.first.payload.source.subagent.thread_spawn.agent_path,sessionFile:source.file,model:contexts[0]?.payload.model,reasoningEffort:contexts[0]?.payload.effort,agentStartedAt:source.first.timestamp,agentCompletedAt:completed?.timestamp,agentWallMs:wall,agentToolCalls:functionCalls.length,commandExecutionEvents:executions.length,toolOccupiedMs:unionMs(toolIntervals),nonToolMs:wall===null?null:Math.max(0,wall-unionMs(toolIntervals)),reasoningEventCount:items.filter(e=>e.payload.item?.type==='Reasoning').length,reasoningTimeMs:null,tokenUsage:token};
  // Preserve timestamps/categories, never export private reasoning text or system instructions.
  const safeTrace=items.map(e=>({timestamp:e.timestamp,type:e.payload.item?.type,startedAtMs:e.payload.started_at_ms,completedAtMs:e.payload.completed_at_ms,...(e.payload.item?.type==='CommandExecution'?{command:e.payload.item.command,exitCode:e.payload.item.exit_code}:{} )}));
  await fs.writeFile(path.join(folder,'session-metrics.json'),JSON.stringify(metrics,null,2));
  await fs.writeFile(path.join(folder,'session-events.jsonl'),safeTrace.map(e=>JSON.stringify(e)).join('\n')+'\n');
  trial.sessionFile=source.file;trial.status=result?'reported':completed?'missing_result':'running';
 }
 let nativeActions=0,headed=0;const names=await fs.readdir(folder).catch(()=>[]);
 for(const name of names.filter(n=>/^command-\d+\.json$/.test(n))){
  const command=JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));
  nativeActions++;try{const payload=JSON.parse(command.stdout);if(payload.headedFallback?.attempted)headed++;}catch{}
 }
 headed+=commands.filter(c=>c.method==='environment.reveal').length;
 const initialChrome=await fs.readFile(path.join(folder,'chrome-initial.json'),'utf8').then(JSON.parse).catch(()=>null);
 const finalChrome=await fs.readFile(path.join(folder,'chrome-state.json'),'utf8').then(JSON.parse).catch(()=>null);
 const headedObserved=initialChrome?.headless===true&&finalChrome?.headless===false?1:0;
 const audited=await fs.readFile(path.join(folder,'audit.json'),'utf8').then(JSON.parse).catch(()=>null);
 const status=audited?.status||result?.status||trial.status;
 const lastEnd=commands.at(-1)?.endedAt;
 const lateCommands=result?commands.filter(c=>Date.parse(c.endedAt)>Date.parse(result.finishedAt)).length:0;
 const duplicateCommandSequences=commands.filter((c,i)=>c.sequence!==undefined&&commands.findIndex(x=>x.sequence===c.sequence) !== i).length;
 rows.push({...trial,status,claimedStatus:result?.status,audited:Boolean(audited),checkpointScore:(audited?.checkpoints||result?.checkpoints||[]).filter(c=>c.passed).length,setupMs:timing?.setupMs,taskWallMs:timing?.firstCommandAt&&lastEnd?Date.parse(lastEnd)-Date.parse(timing.firstCommandAt):null,browserCommandCount:commands.filter(c=>c.method!=='environment.reveal').length,nativeActions,headedAttempts:headed,headedSwitches:headedObserved,initialHeadless:initialChrome?.headless,finalHeadless:finalChrome?.headless,browserCommandMs:commands.reduce((s,c)=>s+c.durationMs,0),failedCommands:commands.filter(c=>c.code!==undefined&&c.code!==0).length,lateCommands,duplicateCommandSequences,...metrics,difficulties:result?.difficulties||[],output:result?.output,auditNotes:audited?.notes});
}
await fs.writeFile(path.join(base,'trials.json'),JSON.stringify(trials,null,2));
await fs.writeFile(path.join(base,'results-live.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify({reported:rows.filter(r=>r.claimedStatus).length,total:trials.length,unreviewed:rows.filter(r=>r.claimedStatus&&!r.audited).map(r=>r.id),running:rows.filter(r=>r.status==='running').map(r=>r.id)}));
