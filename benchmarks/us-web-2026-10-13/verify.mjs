import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..');
const rows=JSON.parse(await fs.readFile(path.join(base,'results-live.json'),'utf8'));
const errors=[],profiles=new Set(),agents=new Set();
if(rows.length!==60)errors.push('Not 60 rows');
for(const r of rows){
 if(!r.audited||!r.agentCompletedAt)errors.push(r.id+': unfinished/unreviewed');
 if(r.model!=='gpt-6-luna'||r.reasoningEffort!=='medium')errors.push(r.id+': model mismatch');
 if((r.status==='succeeded')!==(r.checkpointScore===4))errors.push(r.id+': inconsistent strict status');
 if(r.lateCommands)errors.push(r.id+': commands after result');
 if(r.taskWallMs>481000)errors.push(r.id+': time budget overrun');
 if(agents.has(r.agent))errors.push(r.id+': agent reused');agents.add(r.agent);
 const dir=path.join(root,'.runtime/benchmark-us-20261013/trials',r.id);
 const config=JSON.parse(await fs.readFile(path.join(dir,'config.json'),'utf8'));
 if(profiles.has(config.profile))errors.push(r.id+': shared profile');profiles.add(config.profile);
 const files=await fs.readdir(dir);
 if(!files.includes('cleaned.json')||files.some(n=>n.startsWith('inflight-')))errors.push(r.id+': cleanup incomplete');
 const observations=await fs.readdir(path.join(dir,'observations')).catch(()=>[]);
 if(observations.length)errors.push(r.id+': learning observations present');
 const commands=(await fs.readFile(path.join(dir,'commands.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 if(commands.length>45)errors.push(r.id+': command budget overrun');
 if(commands.some(c=>c.method==='hb'&&(['learning','overview','asset','run','site','registry'].includes(c.args[0])||c.args.includes('--learn'))))errors.push(r.id+': forbidden asset command');
}
for(const site of [...new Set(rows.map(r=>r.site))])for(const method of ['bu','hb']){
 const a=rows.filter(r=>r.site===site&&r.method===method);
 if(a.length!==3||new Set(a.map(r=>r.repeat)).size!==3)errors.push(site+'/'+method+': missing repeats');
}
const v=JSON.parse(await fs.readFile(path.join(base,'versions.json'),'utf8'));
for(const [f,h]of Object.entries(v.sourceHashes)){const b=await fs.readFile(path.join(root,f));if(crypto.createHash('sha256').update(b).digest('hex')!==h)errors.push('Product changed: '+f);}
const result={verifiedAt:new Date().toISOString(),validTrials:rows.length,uniqueAgents:agents.size,uniqueProfiles:profiles.size,allAudited:rows.every(r=>r.audited),learningObservationFiles:0,duplicateSequenceTrials:rows.filter(r=>r.duplicateCommandSequences).map(r=>r.id),errors};
await fs.writeFile(path.join(base,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(errors.length)process.exitCode=1;
