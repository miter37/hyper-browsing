// Read-only live size comparison. No learning, login, form submission or assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {browserOptions} from '../../tests/browser-options.mjs';
import {captureSnapshot} from '../../src/runtime/snapshot.ts';
import {ObservationService} from '../../src/runtime/hwm/service.ts';
const dir=path.resolve('.runtime/hwm-three-sites-20261015');await fs.mkdir(dir,{recursive:true});
const old=JSON.parse(await fs.readFile('.runtime/airbnb-hwm-audit-20261015/paired-snapshot.json','utf8'));
const sites=[{name:'Airbnb',url:old.snapshot.url},{name:'Wikipedia',url:'https://en.wikipedia.org/wiki/Apollo_11'},{name:'Hacker News',url:'https://news.ycombinator.com/'}];
const pkg=await import(pathToFileURL(path.resolve('.runtime/airbnb-hwm-audit-20261015/tokenizer/node_modules/js-tiktoken/dist/index.js')).href);
const tokenizer=pkg.getEncoding('o200k_base');
const size=text=>({bytes:Buffer.byteLength(text),proxyTokens:tokenizer.encode(text).length});
const browser=await chromium.launch(browserOptions()),rows=[];
try{
 for(const [i,site]of sites.entries()){
  const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:900}}),page=await context.newPage();
  try{
   const start=performance.now();let navigationError;
   await page.goto(site.url,{waitUntil:'domcontentloaded',timeout:45000}).catch(e=>navigationError=e.message.split('\n')[0]);
   await page.waitForLoadState('load',{timeout:10000}).catch(()=>{});
   await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
   // Allow the same initial render interval for all sites, not a site heuristic.
   await page.waitForTimeout(1500);
   const close=page.getByRole('dialog').getByRole('button',{name:'Close',exact:true});let dismissedDialog=false;
   if(await close.count()===1&&await close.isVisible()){await close.click();dismissedDialog=true;}
   const aria=await page.locator('body').ariaSnapshot({timeout:15000});
   const snapshot=await captureSnapshot(page,{waitMs:0});
   const ariaAfter=await page.locator('body').ariaSnapshot({timeout:15000});
   if(!snapshot.contextGraph)throw new Error('No public observation graph');
   const {contextGraph,collectionTiming,stateObservation,...flat}=snapshot;
   // Current control-oriented fields, not a run of a historical binary.
   const legacy=JSON.stringify({snapshot:flat},null,2)+'\n';
   const compact=JSON.stringify({snapshot:flat});
   const service=new ObservationService(),session='size'+i;
   const header=JSON.parse(JSON.stringify({'collection-timing':collectionTiming,'state-observation':{...stateObservation,pageState:snapshot.pageState,blocked:snapshot.blocked}}));
   const retained=service.remember(session,contextGraph,header);if(!retained.ok)throw new Error(retained.reason);
   const hwm=service.view(session,contextGraph.observation,{mode:'overview'}).hwm;
   const row={site:site.name,title:snapshot.title,url:snapshot.url,navigationError,pageState:snapshot.pageState,blocked:snapshot.blocked,observation:contextGraph.observation,
    playwrightAria:size(aria),hbWithoutHwmProjection:size(legacy),hbWithoutHwmCompact:size(compact),hbWithHwm:size(hwm),
    controls:snapshot.elements.length,graphNodes:contextGraph.nodes.length,graphScan:contextGraph.scan,controlObservation:snapshot.observation,
    samePage:true,atomicAcrossMethods:false,dismissedDialog,ariaUnchangedAroundHb:aria===ariaAfter,ariaAfter:size(ariaAfter),durationMs:Math.round(performance.now()-start)};
   for(const [label,text]of Object.entries({aria,legacy,hwm}))await fs.writeFile(path.join(dir,`${i}-${label}.txt`),text);
   rows.push(row);console.log(JSON.stringify(row));
  }catch(e){rows.push({site:site.name,error:e.message});console.log(JSON.stringify(rows.at(-1)));}
  finally{await context.close();}
 }
}finally{await browser.close();}
const hashes=[];for(const file of ['src/runtime/snapshot.ts','src/runtime/hwm/projection.ts','src/runtime/hwm/service.ts'])hashes.push({file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
await fs.writeFile(path.join(import.meta.dirname,'three-sites-results.json'),JSON.stringify({at:new Date().toISOString(),headless:true,learning:false,mode:'one page per site; read-only sequential extraction',tokenizer:'o200k_base proxy, not billing tokens',withoutHwm:'control-centered pretty JSON projection excluding contextGraph/collectionTiming/stateObservation; not historical engine',hashes,rows},null,2)+'\n');
