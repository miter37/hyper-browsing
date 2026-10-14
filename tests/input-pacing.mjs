import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { executePrimitive } from '../src/engine/execute.ts';
import { runBatch } from '../src/engine/batch.ts';
async function fixture(t,html){const browser=await chromium.launch(browserOptions());const page=await browser.newPage();await page.setContent(html);t.after(()=>browser.close());return page;}

test('input delay samples stay between 500 and 1000ms and vary per action',async()=>{
 const pacing=await import('../src/engine/input-pacing.ts').catch(()=>({}));assert.equal(typeof pacing.sampleInputDelayMs,'function');
 const values=Array.from({length:200},()=>pacing.sampleInputDelayMs());assert.ok(values.every(v=>Number.isInteger(v)&&v>=500&&v<=1000));assert.ok(new Set(values).size>1);
});

test('first fill and its Enter submission each receive an input pause',async t=>{
 const page=await fixture(t,'<form onsubmit="event.preventDefault();window.submittedAt=Date.now()"><input id="q" type="search" oninput="window.inputAt=Date.now()"><button>Search</button></form>');await page.evaluate(()=>window.startedAt=Date.now());
 const result=await executePrimitive(page,'fill',{locator:{css:'#q'},value:'query',submit:true});assert.equal(result.ok,true);
 const times=await page.evaluate(()=>({start:window.startedAt,input:window.inputAt,submit:window.submittedAt}));assert.ok(times.input-times.start>=490,JSON.stringify(times));assert.ok(times.submit-times.input>=490,JSON.stringify(times));
});

test('a value changed during submission pause is checked again and never submitted',async t=>{
 const page=await fixture(t,'<form onsubmit="event.preventDefault();window.submitted=1"><input id="q" type="search" oninput="setTimeout(()=>this.value=\'changed\',200)"><button>Search</button></form>');
 const result=await executePrimitive(page,'fill',{locator:{css:'#q'},value:'requested',submit:true});assert.equal(result.reason,'value_mismatch');assert.equal(result.submitted,false);assert.equal(await page.evaluate(()=>window.submitted||0),0);
});

test('batch inputs retain the common randomized pause',async t=>{
 const page=await fixture(t,'<input id="a" oninput="window.aAt=Date.now()"><input id="b" oninput="window.bAt=Date.now()">');
 const result=await runBatch(page,{commands:[{op:'fill',locator:{css:'#a'},value:'A'},{op:'fill',locator:{css:'#b'},value:'B'}]});assert.equal(result.ok,true);
 const gap=await page.evaluate(()=>window.bAt-window.aAt);assert.ok(gap>=490,String(gap));
});

test('opening and selecting a custom dropdown are separately paced',async t=>{
 const page=await fixture(t,'<div role="combobox" tabindex="0" onclick="window.openAt=Date.now();document.querySelector(\'#option\').hidden=false">Colors</div><div id="option" hidden role="option" onclick="window.pickAt=Date.now()">Blue</div>');
 const result=await executePrimitive(page,'select',{locator:{role:'combobox'},option:'Blue'});assert.equal(result.ok,true);
 const gap=await page.evaluate(()=>window.pickAt-window.openAt);assert.ok(gap>=490,String(gap));
});

test('a submission becoming payment during the pause is refused before Enter',async t=>{
 const page=await fixture(t,'<form onsubmit="event.preventDefault();window.paid=1"><input id="q" type="search" oninput="setTimeout(()=>document.querySelector(\'button\').textContent=\'Pay now\',200)"><button>Search</button></form>');
 const result=await executePrimitive(page,'fill',{locator:{css:'#q'},value:'query',submit:true});assert.equal(result.confirmationRequired,true);assert.equal(result.submitted,false);assert.equal(result.execution,'completed');assert.equal(result.submissionExecution,'not_started');assert.equal(await page.evaluate(()=>window.paid||0),0);
});
