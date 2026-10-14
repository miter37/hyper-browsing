import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { browserOptions } from '../../tests/browser-options.mjs';
import { executePrimitive } from '../../src/engine/execute.ts';
import { encode } from '../../.runtime/hwm-samehref-benchmark/node_modules/gpt-tokenizer/esm/encoding/o200k_base.js';

const folder=path.dirname(fileURLToPath(import.meta.url));
const cases=[
 {id:'equivalent',goal:'shared',within:'Alpha',html:'<section><h2>Alpha</h2><a href="#same" onclick="event.preventDefault();window.selected=\'shared\'">Open</a></section><section><h2>Beta</h2><a href="#same" onclick="event.preventDefault();window.selected=\'shared\'">Open</a></section>'},
 {id:'different-handlers',goal:'beta',within:'Beta',html:'<section><h2>Alpha</h2><a href="#same" onclick="event.preventDefault();window.selected=\'alpha\'">Open</a></section><section><h2>Beta</h2><a href="#same" onclick="event.preventDefault();window.selected=\'beta\'">Open</a></section>'},
];
const browser=await chromium.launch(browserOptions());const rows=[];
try{
 for(const scenario of cases)for(let repeat=1;repeat<=3;repeat++){
  const methods=repeat%2?['legacy-first-emulated','ambiguous-then-scope']:['ambiguous-then-scope','legacy-first-emulated'];
  for(const method of methods){
   const context=await browser.newContext();const page=await context.newPage();await page.setContent(scenario.html);
   const commands=[],results=[];const started=performance.now();
   if(method==='legacy-first-emulated'){
    // Faithful first-candidate choice, through the current HB input/authorization/effect stack.
    // Explicit nth stands in for the removed automatic branch; this is not an old-build benchmark.
    const params={locator:{role:'link',name:'Open',exact:true},nth:0};commands.push(params);results.push(await executePrimitive(page,'click',params));
   }else{
    const params={locator:{role:'link',name:'Open',exact:true}};commands.push(params);results.push(await executePrimitive(page,'click',params));
    if(results[0].reason!=='ambiguous')throw Error('Expected ambiguity');
    const scoped={locator:{role:'link',name:'Open',exact:true},within:scenario.within};commands.push(scoped);results.push(await executePrimitive(page,'click',scoped));
   }
   const elapsedMs=performance.now()-started;const selected=await page.evaluate(()=>window.selected??null);
   const output=JSON.stringify(results),input=JSON.stringify(commands);
   rows.push({scenario:scenario.id,repeat,method,correct:selected===scenario.goal,selected,goal:scenario.goal,calls:commands.length,elapsedMs,inputTokens:encode(input).length,outputTokens:encode(output).length,totalTokens:encode(input).length+encode(output).length,outputBytes:Buffer.byteLength(output),commands,results});
   await context.close();
  }
 }
}finally{await browser.close();}
const median=a=>{const sorted=[...a].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const summary=cases.flatMap(s=>['legacy-first-emulated','ambiguous-then-scope'].map(method=>{const trials=rows.filter(r=>r.scenario===s.id&&r.method===method);return {scenario:s.id,method,correct:trials.filter(r=>r.correct).length,trials:trials.length,calls:median(trials.map(r=>r.calls)),medianMs:median(trials.map(r=>r.elapsedMs)),medianTokens:median(trials.map(r=>r.totalTokens)),medianOutputTokens:median(trials.map(r=>r.outputTokens))};}));
await fs.writeFile(path.join(folder,'results.json'),JSON.stringify({capturedAt:new Date().toISOString(),encoding:'o200k_base',summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
