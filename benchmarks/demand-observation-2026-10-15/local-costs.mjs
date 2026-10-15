// Same completed read task, two HB workflows; no vanilla/browser-use experiment.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {browserOptions} from '../../tests/browser-options.mjs';
import {captureSnapshot} from '../../src/runtime/snapshot.ts';import {executePrimitive} from '../../src/engine/execute.ts';
import {DemandObservationService} from '../../src/runtime/observation/service.ts';
const fixtures=[
 {task:'second item text',query:null,selector:'li:nth-child(2)',item:2,expected:'Mouse 1',html:'<main><ul>'+Array.from({length:120},(_,i)=>`<li>Mouse ${i}<p>$${i+16}.00 shipping included</p><a href="/item/${i}">Details</a><button>Watch ${i}</button></li>`).join('')+'</ul></main>'},
 {task:'find named paragraph text',query:'Target paragraph',selector:'#target',expected:'Target paragraph',html:'<main><h1>Article</h1>'+Array.from({length:150},(_,i)=>`<p ${i===90?'id="target"':''}>${i===90?'Target paragraph':'Other paragraph '+i}: ordinary words <a href="/source/${i}">Source ${i}</a></p>`).join('')+'</main>'},
 {task:'current named input value',query:'Requested place',selector:'input[aria-label="Requested place"]',want:'state',expected:'Busan',html:'<main>'+Array.from({length:100},(_,i)=>`<label>${i===80?'Requested place':'Other '+i}<input aria-label="${i===80?'Requested place':'Other '+i}" value="${i===80?'Busan':'Seoul'}"></label>`).join('')+'</main>'}
];
const browser=await chromium.launch(browserOptions()),rows=[];
try{for(const f of fixtures){const page=await browser.newPage();await page.setContent(f.html);const service=new DemandObservationService();try{
 const before=performance.now(),snap=await captureSnapshot(page,{context:false,waitMs:0});const {collectionTiming,stateObservation,...flat}=snap;
 const extracted=await executePrimitive(page,'extract',{locator:{css:f.selector},read:f.want==='state'?'value':'text'});assert.equal(extracted.ok,true);assert.ok(JSON.stringify(extracted.value).includes(f.expected));
 const legacyBytes=Buffer.byteLength(JSON.stringify({snapshot:flat},null,2))+Buffer.byteLength(JSON.stringify(extracted,null,2)),legacyMs=performance.now()-before;
 const start=performance.now(),map=await service.map(page,'s'),panel=map.panels.find(p=>p.role==='main')??map.panels[0];
 const read=await service.read(page,'s',{map:map.map,panel:panel.id,want:f.want??'content,controls',query:f.query??undefined,item:f.item,since:map.delivery});assert.ok(JSON.stringify(read.data).includes(f.expected));
 rows.push({task:f.task,legacyBytes,nativeBytes:Buffer.byteLength(JSON.stringify(map))+Buffer.byteLength(JSON.stringify(read)),legacyCalls:2,nativeCalls:2,legacyMs:Math.round(legacyMs),nativeMs:Math.round(performance.now()-start),completed:true});
 }finally{await service.close();await page.close();}}}finally{await browser.close();}
const ratios=rows.map(r=>1-r.nativeBytes/r.legacyBytes).sort((a,b)=>a-b);const report={at:new Date().toISOString(),scope:'three deterministic local read fixtures, same completion evidence; not LLM/live success-rate proof',baseline:'HB control-only snapshot plus actual HB extract; no HWM graph, pretty JSON',current:'HB map + scoped read, compact JSON, includes delivery envelope',rows,medianReduction:ratios[1]};
await fs.writeFile(path.join(import.meta.dirname,'local-costs.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
