import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { captureSnapshot } from '../src/runtime/snapshot.ts';
import { referencesFor } from '../src/runtime/references.ts';
const exec=promisify(execFile);
const helper=fileURLToPath(new URL('./helpers/reference-process.mjs',import.meta.url));

test('repeated snapshots keep registered reference count bounded and invalidate disposal is measured',async t=>{
 const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<button>A</button><button>B</button><input aria-label="Place">');const refs=referencesFor(page);
 const settle=async()=>{const end=performance.now()+2000;while(refs.diagnostics().pendingDisposals&&performance.now()<end)await new Promise(r=>setTimeout(r,5));assert.equal(refs.diagnostics().pendingDisposals,0);};
 for(let i=0;i<12;i++){const s=await captureSnapshot(page,{context:true,waitMs:0});assert.equal(s.collectionTiming.references.registeredReferences,3);await settle();assert.equal(refs.diagnostics().registeredReferences,3);}
 await page.goto('data:text/html,<button>Next</button>');await captureSnapshot(page,{context:true,waitMs:0});await settle();const d=refs.diagnostics();assert.equal(d.registeredReferences,1);assert.equal(d.boundHandles,0);assert.ok(d.disposalSettled>=1);assert.ok(d.lastInvalidation.complete);assert.ok(d.lastInvalidation.attempted>=1);assert.ok(d.lastInvalidation.elapsedMs>=0);
});
async function processSnapshot(oldRef){const {stdout}=await exec(process.execPath,['--import','tsx',helper],{windowsHide:true,timeout:30000,env:{...process.env,...(oldRef?{OLD_REF:oldRef}:{})}});return JSON.parse(stdout);}

test('a reference from the old daemon process never executes a different target after restart',async()=>{
 const old=await processSnapshot();const current=await processSnapshot(old.ref);
 assert.equal(current.clicked,false,'old reference executed the new target');
 assert.notEqual(current.ref,old.ref);
 assert.equal(current.result.reason,'stale_ref');assert.equal(current.result.execution,'not_started');assert.equal(current.clicked,false);
});

test('same node and guard reuse a ref; changed guard and navigation invalidate it',async t=>{
 const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<button>First</button>');
 const refs=referencesFor(page);const snap=()=>captureSnapshot(page,{references:refs,waitMs:0});
 const a=(await snap()).elements.find(e=>e.tag==='button').ref;const b=(await snap()).elements.find(e=>e.tag==='button').ref;assert.equal(a,b);
 await page.locator('button').evaluate(el=>el.textContent='Second');const c=(await snap()).elements.find(e=>e.tag==='button').ref;assert.notEqual(a,c);assert.equal((await refs.resolve(a)).reason,'stale_ref');
 await page.goto('data:text/html,<button>Third</button>');const d=(await snap()).elements.find(e=>e.tag==='button').ref;assert.notEqual(d,c);assert.equal((await refs.resolve(c)).reason,'stale_ref');
});

test('the one-millionth slot is valid and the next allocation reports incomplete capture',async t=>{
 const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<button>Boundary</button>');
 const refs=referencesFor(page);const state=await refs.snapshotState();
 await state.state.evaluate(s=>{s.next=s.max;});
 const last=await captureSnapshot(page,{references:refs,waitMs:0});assert.ok(last.elements.some(e=>e.tag==='button'));
 await page.locator('button').evaluate(el=>el.textContent='Next allocation');
 const over=await captureSnapshot(page,{references:refs,waitMs:0});assert.equal(over.observation.complete,false);assert.equal(over.elements.length,0);
});
