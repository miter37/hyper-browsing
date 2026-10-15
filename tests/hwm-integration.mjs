import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {browserOptions} from './browser-options.mjs';
import {captureSnapshot} from '../src/runtime/snapshot.ts';import {referencesFor} from '../src/runtime/references.ts';
import {ObservationService} from '../src/runtime/hwm/service.ts';import {parseHwm} from '../src/runtime/hwm/view.ts';
import {renderCommandResult} from '../src/runtime/hwm/result.ts';import {observeExecution} from '../src/runtime/hwm/changes.ts';
import {analyzeForms} from '../src/runtime/discovery-tools.ts';
import {BrowserDaemon} from '../src/browserd/server.ts';import {getConfig} from '../src/config.ts';
async function pageFor(t,html){const b=await chromium.launch(browserOptions());t.after(()=>b.close());const p=await b.newPage();await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));await p.goto('https://example.test');return p;}
test('ordinary snapshots are one observation with the original controls and contextual content',async t=>{
 const p=await pageFor(t,'<main><h1>Products</h1><ul><li><h2>Mouse A</h2><span>$18.40</span><a href="/a">Details</a></li><li><h2>Mouse B</h2><span>$16.00</span><a href="/b">Details</a></li></ul><label>Sort by<select><option>Recommended</option></select></label></main>');
 const snap=await captureSnapshot(p,{references:referencesFor(p),waitMs:0});assert.ok(snap.contextGraph);const g=snap.contextGraph;
 for(const control of snap.elements){const node=g.nodes.find(n=>n.actionRef===control.ref);assert.ok(node,'every original control retained');for(const key of ['hint','context','popup','clipped','transparent','selectedText','testId'])if(control[key]!==undefined)assert.deepEqual(node.attrs[key],control[key]);}
 assert.ok(g.nodes.some(n=>n.text==='$18.40'));assert.ok(g.nodes.some(n=>n.text==='$16.00'));
});
test('query controls deep beyond navigation remain in the same observation and lead the view',async t=>{
 const p=await pageFor(t,'<nav>'+Array.from({length:500},(_,i)=>`<div><a href="/nav/${i}">Menu ${i}</a></div>`).join('')+'</nav><main><h2>Target</h2><p>Price $18.40</p><button aria-label="Exact target">Act</button></main>');
 const snap=await captureSnapshot(p,{query:'Exact target',waitMs:0,contextLimit:50});assert.ok(snap.contextGraph);const g=snap.contextGraph,target=snap.elements.find(e=>e.name==='Exact target');assert.ok(g.nodes.some(n=>n.actionRef===target.ref));
 const service=new ObservationService();service.remember('s1',g);const v=parseHwm(service.view('s1',g.observation,{mode:'overview',nodeBudget:8}).hwm);assert.ok(v.entries.some(n=>n.id===target.ref));
});
test('ordinary observation preserves hidden discovery advice and disclosure hints without fabricated execution refs',async t=>{
 const p=await pageFor(t,'<main><button aria-controls="options" aria-expanded="false">More options</button><div id="options" style="display:none"><button>Hidden target</button></div><p>Target prose</p></main>');const snap=await captureSnapshot(p,{query:'target',waitMs:0});const g=snap.contextGraph;assert.ok(g);assert.deepEqual(g.discovery.hidden,snap.hidden);assert.deepEqual(g.discovery.textHits,snap.textHits);
 const service=new ObservationService();service.remember('s1',g);const text=service.view('s1',g.observation,{mode:'overview'}).hwm;assert.ok(text.includes('openWith'));assert.ok(text.includes('Hidden target'));
});
test('reference binding is deferred and guards still reject replaced or recycled nodes',async t=>{
 const p=await pageFor(t,'<button aria-label="First">Act</button>');const refs=referencesFor(p);const snap=await captureSnapshot(p,{references:refs,waitMs:0});const ref=snap.elements.find(e=>e.role==='button').ref;assert.equal(refs.diagnostics().boundHandles,0);
 const resolved=await refs.resolve(ref);assert.equal(resolved.resolvedBy,'reference');assert.equal(refs.diagnostics().boundHandles,1);
 await p.evaluate(()=>document.querySelector('button').setAttribute('aria-label','Other'));assert.equal((await refs.resolve(ref)).reason,'stale_ref');
});
test('common result rendering preserves unknown execution and final fallback evidence',()=>{
 const hwm=renderCommandResult({ok:false,execution:'outcome_unknown',reason:'rpc_timeout',headedFallback:{attempted:true},durationMs:17},{session:'s',document:'d',url:'https://example.test'});
 const r=parseHwm(hwm).entries.find(e=>e.tag==='result');assert.equal(r.attrs.execution,'outcome_unknown');assert.equal(r.attrs.durationMs,17);assert.deepEqual(r.attrs.headedFallback,{attempted:true});
 const list=parseHwm(renderCommandResult({items:[{text:'Mouse $18.40',title:'Mouse',href:'/a',textTruncated:true}]},{session:'s',document:'d',url:'https://example.test'}));assert.ok(list.entries.some(e=>e.type==='node'&&e.kind==='item'&&e.attrs.textTruncated));assert.ok(!list.entries.some(e=>e.type==='node'&&e.id.startsWith('e')));
});
test('lightweight execution observes after only and uses the bounded retained prior observation',async t=>{
 const p=await pageFor(t,'<main><label>Place<input value="Before"></label></main>');const prior=(await captureSnapshot(p,{waitMs:0})).contextGraph;
 let evaluations=0;const evaluate=p.evaluate.bind(p);p.evaluate=async(...args)=>{evaluations++;return evaluate(...args);};
 const r=await observeExecution(p,'s',async()=>{await p.locator('input').fill('After');return {execution:'completed'};},'req','hwm',undefined,{lightweight:true,query:'Place',before:prior});
 assert.equal(r.execution,'completed');assert.ok(r.changes.some(c=>c.field==='value'&&c.old==='Before'&&c.new==='After'));assert.equal(evaluations,3,'one snapshot evaluation plus page state and block checks, not two snapshots');
 const noPrior=await observeExecution(p,'s',async()=>({execution:'completed'}),'req2','hwm',undefined,{lightweight:true});assert.equal(noPrior.changes[0].reason,'no-prior-observation');
});
test('forms use the common private-field policy and every optional field serializes as valid HWM',async t=>{
 const p=await pageFor(t,'<form action="/submit?token=my-private-token"><input><input name="apiKey" value="my-private-key"><input autocomplete="section-pay cc-number" value="4111111111111111"><div role="combobox" id="secret">private-custom-value</div></form>');
 const forms=await analyzeForms(p);const serialized=JSON.stringify(forms);assert.ok(!serialized.includes('my-private-key'));assert.ok(!serialized.includes('4111111111111111'));assert.ok(!serialized.includes('private-custom-value'));assert.ok(!serialized.includes('my-private-token'));
 const hwm=renderCommandResult(forms,{session:'s',document:'d',url:p.url()});assert.ok(!hwm.includes('undefined'));parseHwm(hwm);
});
test('forms with undefined optional attributes are normalized before HWM serialization',()=>{
 const hwm=renderCommandResult({forms:[{fields:[{tag:'input',name:undefined,value:undefined}]}]},{session:'s',document:'d',url:'https://example.test'});assert.ok(!hwm.includes('undefined'));parseHwm(hwm);
});
test('private textarea content never escapes through discovery textHits or hints',async t=>{
 const p=await pageFor(t,'<textarea name="password">private123</textarea><button>Check</button>');const snap=await captureSnapshot(p,{query:'private',waitMs:0});assert.ok(!JSON.stringify(snap).includes('private123'));
});
test('query prose past long navigation retains its section and neighboring price',async t=>{
 const p=await pageFor(t,'<nav>'+Array.from({length:100},(_,i)=>`<div><a href="/nav/${i}">Menu ${i}</a></div>`).join('')+'</nav><article><h2>Found section</h2><p>Target prose <span>$18.40</span></p></article>');const snap=await captureSnapshot(p,{query:'Target prose',contextLimit:20,waitMs:0});const g=snap.contextGraph;assert.ok(g.matches.length);assert.ok(g.nodes.some(n=>n.text?.includes('$18.40')));assert.ok(g.nodes.some(n=>n.tag==='article'));
});
test('ordinary view abbreviates raw geometry while full and inspect retain the same measured facts',async t=>{
 const p=await pageFor(t,'<main><p>Price $18.40</p><button>Details</button></main>');const g=(await captureSnapshot(p,{waitMs:0})).contextGraph;const svc=new ObservationService();svc.remember('s',g);const overview=parseHwm(svc.view('s',g.observation,{mode:'overview'}).hwm);assert.ok(!overview.entries.some(e=>e.type==='node'&&e.attrs.box));assert.equal(overview.header['detail-projection'],'raw-geometry-in-full-or-inspect');const node=g.nodes.find(n=>n.actionRef);assert.deepEqual(svc.inspect('s',g.observation,node.id).node.attrs.box,node.attrs.box);assert.ok(parseHwm(svc.view('s',g.observation,{mode:'full'}).hwm).entries.some(e=>e.type==='node'&&e.attrs.box));
});
test('saved node, heading and gap expansions honor budgets without changing their retained source',()=>{
 const g={version:'0.2',observation:'pBudget',document:'d1',capturedAt:new Date().toISOString(),url:'https://example.test',scan:{scope:'fixture',complete:true},nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'heading',parent:'n1',order:0,text:'Section',textSource:'dom-text',attrs:{level:1}},{id:'n3',kind:'group',parent:'n1',order:1,attrs:{}},...Array.from({length:20},(_,i)=>({id:'n'+(i+4),kind:'text',parent:'n3',order:i,text:'Paragraph '+i+' '+ 'word '.repeat(20),textSource:'dom-text',attrs:{}}))],edges:[],gaps:[],matches:[]};const svc=new ObservationService();svc.remember('s',g);const initial=parseHwm(svc.view('s',g.observation,{mode:'overview',nodeBudget:4}).hwm),gap=initial.entries.find(e=>e.tag==='gap'&&e.attrs.scope==='nodes');assert.ok(gap);
 for(const target of ['n2','n3',gap.id]){const v=parseHwm(svc.expand('s',g.observation,target,{nodeBudget:5,textBudget:8}).hwm);assert.equal(v.header['projection-budget'].requested,5);assert.ok(v.entries.some(e=>e.tag==='gap'));assert.ok(v.entries.filter(e=>e.type==='node'&&e.primary).every(e=>Array.from(e.primary.value).length<=8));}
 assert.equal(svc.inspect('s',g.observation,'n4').node.text,g.nodes[3].text);assert.ok(parseHwm(svc.expand('s',g.observation,'n3').hwm).entries.some(e=>e.primary?.value===g.nodes[3].text));
});
test('eval identifies its expression scope in HWM while JSON callers retain the original result shape',async t=>{
 const p=await pageFor(t,'<main>Data</main>');const sessions={get:()=>p},opened={id:'s'};const daemon=new BrowserDaemon({...getConfig(),learningDisabled:true});daemon.sessions=sessions;daemon.context=p.context();daemon.chrome.ensureConnected=async()=>p.context();
 for(const expression of ['2+3','[1,2]','({value:"original",scope:"page-owned"})']){const expected=await p.evaluate(expression);assert.deepEqual(await daemon.dispatchUnlocked('page.evaluate',{sessionId:opened.id,expression,format:'json'}),expected);const result=await daemon.dispatchUnlocked('page.evaluate',{sessionId:opened.id,expression,format:'hwm'});assert.equal(result.scope,'eval-expression');assert.deepEqual(result.value,expected);assert.equal(result.expression,expression);const v=parseHwm(renderCommandResult(result,{session:opened.id,document:'d',url:p.url()}));assert.equal(v.entries.find(e=>e.tag==='result').attrs.scope,'eval-expression');}
 const expression='"'+ '😀'.repeat(300)+'"',result=await daemon.dispatchUnlocked('page.evaluate',{sessionId:opened.id,expression,format:'hwm'});assert.equal(result.expressionTruncated,true);assert.equal(Array.from(result.expression).length,240);assert.equal(result.expressionLength,302);assert.equal(result.expressionLengthUnit,'unicode-code-point');assert.equal(result.value,'😀'.repeat(300));
});
test('failed initial navigation reports the existing navigation_error state without reading the error DOM',async()=>{
 const daemon=new BrowserDaemon({...getConfig(),learningDisabled:true});daemon.chrome.getState=()=>({headless:false});const error={id:'s',navigationError:'net::ERR_NAME_NOT_RESOLVED\ncall details',url:'about:blank'};daemon.dispatchUnlocked=async()=>({...error});let probes=0;daemon.sessions={get(){probes++;throw Error('must not inspect an error document');}};const result=await daemon.dispatchWithFallback('session.open',{url:'https://invalid.test'});assert.equal(result.pageState.state,'navigation_error');assert.equal(result.pageState.evidence,'net::ERR_NAME_NOT_RESOLVED');assert.equal(result.navigationError,error.navigationError);assert.equal(probes,0);
});
