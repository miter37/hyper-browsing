import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const old='benchmarks/hb-headed-four-2026-10-16/',base='benchmarks/booking-local-context-2026-10-16/';
const scenarios=JSON.parse(await fs.readFile(old+'scenarios.json','utf8')).filter(s=>s.site==='booking');
await fs.writeFile(base+'scenarios.json',JSON.stringify(scenarios,null,2));
for(const file of ['control.mjs','agent-guide.md','monitor.mjs','analyze.mjs','report.mjs']){
 let text=await fs.readFile(old+file,'utf8');text=text.replaceAll('hb-headed-four-2026-10-16','booking-local-context-2026-10-16').replaceAll('/root/headed4_','/root/localfix_').replaceAll('46260+index','46360+index').replaceAll('10260+index','10360+index').replaceAll('변경 과업 4개 headed 재시험','Booking 동일 조건 · 국소 상태 보완 후 headed 재시험');
 await fs.writeFile(base+file,text);
}
const v=JSON.parse(await fs.readFile(old+'versions.json','utf8'));v.frozenAt=new Date().toISOString();v.followupOf='hb-headed-four-2026-10-16/booking';
v.sourceHashes['src/engine/action-region.ts']='';
for(const file of Object.keys(v.sourceHashes))v.sourceHashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
await fs.writeFile(base+'versions.json',JSON.stringify(v,null,2));console.log('Prepared one headed Booking trial after local-context fixes.');
