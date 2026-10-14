import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const rows=JSON.parse(await fs.readFile(path.join(base,'results-live.json'),'utf8'));
if(rows.length!==60||rows.some(r=>!r.audited||!r.agentCompletedAt))throw Error('60 independent completed, audited trials required');
if(rows.some(r=>r.model!=='gpt-6-luna'||r.reasoningEffort!=='medium'||r.lateCommands))throw Error('Model, effort or late command audit failed');
const median=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null;};
const range=a=>({median:median(a),min:Math.min(...a),max:Math.max(...a)});
const summary={createdAt:new Date().toISOString(),validTrials:60,methods:{},sites:[],successfulPairs:[]};
for(const method of ['bu','hb']){
 const a=rows.filter(r=>r.method===method);
 summary.methods[method]={n:a.length,strictSuccess:a.filter(r=>r.status==='succeeded'&&r.checkpointScore===4).length,statuses:Object.fromEntries(['succeeded','partial','blocked','failed'].map(s=>[s,a.filter(r=>r.status===s).length])),checkpointTotal:a.reduce((s,r)=>s+r.checkpointScore,0),checkpointPossible:a.length*4,taskWallMs:range(a.map(r=>r.taskWallMs)),successfulTaskWallMs:range(a.filter(r=>r.status==='succeeded').map(r=>r.taskWallMs)),browserCommands:range(a.map(r=>r.browserCommandCount)),agentWallMs:range(a.map(r=>r.agentWallMs)),agentToolCalls:range(a.map(r=>r.agentToolCalls)),nonToolMs:range(a.map(r=>r.nonToolMs)),reasoningOutputTokens:range(a.map(r=>r.tokenUsage?.reasoning_output_tokens)),headedSwitches:a.filter(r=>r.headedSwitches).length,headedAttempts:a.reduce((s,r)=>s+r.headedAttempts,0)};
}
for(const site of [...new Set(rows.map(r=>r.site))]){
 const entry={site};
 for(const method of ['bu','hb']){const a=rows.filter(r=>r.site===site&&r.method===method);entry[method]={strictSuccess:a.filter(r=>r.status==='succeeded').length,scores:a.sort((x,y)=>x.repeat-y.repeat).map(r=>r.checkpointScore),taskWallMs:range(a.map(r=>r.taskWallMs)),browserCommands:range(a.map(r=>r.browserCommandCount))};}
 summary.sites.push(entry);
 for(let repeat=1;repeat<=3;repeat++){const a=rows.find(r=>r.site===site&&r.repeat===repeat&&r.method==='bu'),b=rows.find(r=>r.site===site&&r.repeat===repeat&&r.method==='hb');if(a.status==='succeeded'&&b.status==='succeeded')summary.successfulPairs.push({site,repeat,buMs:a.taskWallMs,hbMs:b.taskWallMs,hbOverBu:b.taskWallMs/a.taskWallMs,buCommands:a.browserCommandCount,hbCommands:b.browserCommandCount});}
}
summary.successfulPairSummary={n:summary.successfulPairs.length,buMedianMs:median(summary.successfulPairs.map(p=>p.buMs)),hbMedianMs:median(summary.successfulPairs.map(p=>p.hbMs)),medianHbOverBu:median(summary.successfulPairs.map(p=>p.hbOverBu))};
const cleanPairs=summary.successfulPairs.filter(p=>!rows.some(r=>r.site===p.site&&r.repeat===p.repeat&&r.duplicateCommandSequences));
summary.successfulPairsWithoutNumberCollisions={n:cleanPairs.length,medianHbOverBu:median(cleanPairs.map(p=>p.hbOverBu))};
const keys=['id','site','repeat','method','status','claimedStatus','checkpointScore','setupMs','taskWallMs','browserCommandCount','agentWallMs','agentToolCalls','toolOccupiedMs','nonToolMs','reasoningTimeMs','reasoningEventCount','headedAttempts','headedSwitches','failedCommands','lateCommands','duplicateCommandSequences'];
const esc=x=>'"'+String(x??'').replaceAll('"','""')+'"';
const csv=[keys.concat(['inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens']).join(','),...rows.map(r=>keys.map(k=>esc(r[k])).concat(['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'].map(k=>esc(r.tokenUsage?.[k]))).join(','))].join('\n')+'\n';
await fs.writeFile(path.join(base,'results.csv'),'\uFEFF'+csv);
await fs.writeFile(path.join(base,'summary.json'),JSON.stringify(summary,null,2));
const privateRoot=path.resolve(base,'../../.runtime/benchmark-us-20261013/trials');
const evidence=[];
function publicUrl(value){try{const u=new URL(value);const keep=new Set(['q','k','_nkw','LH_BIN','LH_ItemCondition','rh','checkin','checkout','group_adults','no_rooms','nflt','startDate','endDate','adults','rooms','destination','guestRating','st']);for(const key of [...u.searchParams.keys()])if(!keep.has(key))u.searchParams.delete(key);u.hash='';return u.href;}catch{return value;}}
for(const r of rows){const audit=JSON.parse(await fs.readFile(path.join(privateRoot,r.id,'audit.json'),'utf8'));evidence.push({id:r.id,status:r.status,checkpointScore:r.checkpointScore,checkpoints:audit.checkpoints.map(c=>({...c,url:publicUrl(c.url)})),auditNotes:audit.notes,output:r.output,difficulties:r.difficulties});}
await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({methods:summary.methods,successfulPairSummary:summary.successfulPairSummary}));
