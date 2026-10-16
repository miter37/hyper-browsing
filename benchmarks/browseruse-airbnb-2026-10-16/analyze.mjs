import fs from 'node:fs/promises';
const hb='.runtime/work-surface-luna-airbnb-2026-10-16/airbnb',bu='.runtime/browseruse-airbnb-2026-10-16';
const read=async p=>(await fs.readFile(p,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const summary=rows=>({calls:rows.length,wallMs:Date.parse(rows.at(-1).endedAt)-Date.parse(rows[0].startedAt),cliMs:rows.reduce((n,r)=>n+r.durationMs,0),stdoutBytes:rows.reduce((n,r)=>n+r.stdoutBytes,0),nonzeroExits:rows.filter(r=>r.code!==0).map(r=>r.sequence)});
const h=await read(hb+'/commands.jsonl'),b=await read(bu+'/commands.jsonl'),events=await read(bu+'/action-events.jsonl');
const actions={};for(const e of events)actions[e.name]=(actions[e.name]||0)+1;
const result={hb:{initial:summary(h.filter(r=>r.sequence<=36)),unitAudit:summary(h.filter(r=>r.sequence>=37&&r.sequence<=42)),correction:summary(h.filter(r=>r.sequence>=43)),full:summary(h)},browserUse:{all:summary(b),discardedURLShortcut:summary(b.filter(r=>r.sequence<=6)),uiRestart:summary(b.filter(r=>r.sequence>=7)),helperCalls:actions}};
await fs.writeFile('benchmarks/browseruse-airbnb-2026-10-16/metrics.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
