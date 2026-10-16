import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.runtime/direct-two-2026-10-16');
for(const site of await fs.readdir(root).catch(()=>[])){
 if(process.argv[2]&&site!==process.argv[2])continue;
 const folder=path.join(root,site);if(!(await fs.stat(folder)).isDirectory())continue;
 const get=async name=>fs.readFile(path.join(folder,name),'utf8').then(JSON.parse).catch(()=>null);
 const rows=(await fs.readFile(path.join(folder,'commands.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);
 const result=await get('result.json'),last=rows.at(-1),payload=last?await get(`command-${String(last.sequence).padStart(3,'0')}.json`):null;
 const chrome=await get('chrome-state.json'),inflight=await get('inflight.json');
 console.log(JSON.stringify({site,calls:rows.length,headless:chrome?.headless,finished:!!result,status:result?.status,score:result?.checkpoints?.filter(c=>c.passed).length,last:last?.args,inflight:inflight?.args,latest:payload?.stdout.slice(0,1100)}));
}
