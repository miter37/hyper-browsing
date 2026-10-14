import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {browserOptions} from '../../tests/browser-options.mjs';
import {captureSnapshot} from '../../src/runtime/snapshot.ts';
import {referencesFor} from '../../src/runtime/references.ts';
import {renderObservation} from '../../src/runtime/hwm/renderer.ts';
const [label='baseline']=process.argv.slice(2);
if(label==='baseline')throw new Error('baseline.json is frozen from the pre-integration implementation; do not regenerate it with integrated code');
const b=await chromium.launch(browserOptions());const results=[];
try{for(const count of [30,100,300]){
 const p=await b.newPage();await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<main><h1>Items</h1><ul>'+Array.from({length:count},(_,i)=>`<li><h2>Item ${i}</h2><span>$${i}</span><span>Shipping text</span><button>Details ${i}</button></li>`).join('')+'</ul></main>'}));await p.goto('https://example.test');const refs=referencesFor(p),samples=[];
 for(let i=0;i<18;i++){const start=performance.now();const snap=await captureSnapshot(p,{references:refs,waitMs:0});const ms=performance.now()-start;const renderStart=performance.now(),hwm=renderObservation(snap.contextGraph,{session:'fixture',projection:{mode:'overview'}}),renderMs=performance.now()-renderStart;if(i>=3)samples.push({ms,renderMs,scanMs:snap.scanMs,bytes:Buffer.byteLength(JSON.stringify(snap)),hwmBytes:Buffer.byteLength(hwm),elements:snap.elements.length});}
 const times=samples.map(s=>s.ms).sort((a,b)=>a-b);results.push({count,median:times[Math.floor(times.length/2)],p95:times[Math.ceil(times.length*.95)-1],samples});await p.close();
}}finally{await b.close();}
await fs.writeFile(new URL(`./${label}.json`,import.meta.url),JSON.stringify({label,at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results.map(({count,median,p95})=>({count,median,p95}))));
