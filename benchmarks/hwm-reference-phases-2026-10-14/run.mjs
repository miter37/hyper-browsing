import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { browserOptions } from '../../tests/browser-options.mjs';
import { captureSnapshot } from '../../src/runtime/snapshot.ts';
const browser=await chromium.launch(browserOptions()),runs=[];
try{
 const page=await browser.newPage();
 for(const count of [10,100,300]){
  await page.goto('about:blank');await page.setContent('<main>'+Array.from({length:count},(_,i)=>`<button>Item ${i}</button>`).join('')+'</main>');
  for(let repetition=1;repetition<=3;repetition++){
   const started=performance.now();const snapshot=await captureSnapshot(page,{context:true,limit:600,contextLimit:2000,waitMs:0});
   runs.push({count,repetition,elapsedMs:performance.now()-started,graphNodes:snapshot.contextGraph.nodes.length,phases:snapshot.collectionTiming.phases,references:snapshot.collectionTiming.references});
  }
 }
}finally{await browser.close();}
const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summary=[10,100,300].map(count=>({count,...Object.fromEntries(['elapsedMs','pageEvaluationMs','resultTransferMs','referenceBindingMs'].map(key=>[key,median(runs.filter(r=>r.count===count).map(r=>key==='elapsedMs'?r.elapsedMs:r.phases[key]))]))}));
await fs.writeFile(new URL('results.json',import.meta.url),JSON.stringify({capturedAt:new Date().toISOString(),scope:'Local HTML; HB captureSnapshot; no actions, learning or LLM comparison',runs,summary},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
