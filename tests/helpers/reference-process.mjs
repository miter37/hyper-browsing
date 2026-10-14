import { chromium } from 'playwright';
import { browserOptions } from '../browser-options.mjs';
import { captureSnapshot } from '../../src/runtime/snapshot.ts';
import { referencesFor } from '../../src/runtime/references.ts';
import { executePrimitive } from '../../src/engine/execute.ts';

const browser=await chromium.launch(browserOptions());
try{
 const page=await browser.newPage();
 await page.setContent('<button onclick="window.clicked=true">'+(process.env.OLD_REF?'Different target':'Original target')+'</button>');
 const snap=await captureSnapshot(page,{references:referencesFor(page),waitMs:0});
 const ref=snap.elements.find(e=>e.tag==='button').ref;
 const result=process.env.OLD_REF?await executePrimitive(page,'click',{ref:process.env.OLD_REF}):null;
 process.stdout.write(JSON.stringify({ref,result,clicked:await page.evaluate(()=>Boolean(window.clicked))}));
}finally{await browser.close();}
