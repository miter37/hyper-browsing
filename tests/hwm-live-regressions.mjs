import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserOptions} from './browser-options.mjs';
import {BrowserDaemon} from '../src/browserd/server.ts';
import {SessionStore} from '../src/browserd/session-store.ts';
import {getConfig} from '../src/config.ts';
import {ObservationStore} from '../src/runtime/hwm/store.ts';
import {ObservationService} from '../src/runtime/hwm/service.ts';
import {parseHwm} from '../src/runtime/hwm/view.ts';
import {listItems} from '../src/runtime/discovery-tools.ts';
const graph=id=>({version:'0.2',observation:id,document:'d1',capturedAt:'2026-10-14T09:00:00Z',url:'https://example.test',scan:{scope:'fixture',complete:true},nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{}},{id:'n2',kind:'text',parent:'n1',order:0,text:'Original',textSource:'dom-text',attrs:{}}],edges:[],gaps:[],matches:[]});
async function fixture(t,html){const b=await chromium.launch(browserOptions());t.after(()=>b.close());const context=await b.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));return {context,page:await context.newPage()};}
test('rejected observations distinguish retention failure from TTL expiry and stay scoped',()=>{
 let now=0;const store=new ObservationStore({maxObservationBytes:50,ttlMs:100,clock:()=>now});
 assert.equal(store.put('s1',graph('pLarge')).reason,'observation_too_large');
 assert.throws(()=>store.get('s1','pLarge'),e=>e.code==='observation_too_large');
 assert.throws(()=>store.get('s2','pLarge'),e=>e.code==='observation_scope_mismatch');
 now=100;assert.throws(()=>store.get('s1','pLarge'),e=>e.code==='observation_expired');
});
test('unobserved gaps provide a non-expandable error instead of pretending a node is missing',()=>{
 const service=new ObservationService(),g=graph('pGap');g.gaps=[{id:'gap1',parent:'n1',kind:'unobserved',reason:'budget'}];service.remember('s1',g);
 assert.throws(()=>service.expand('s1','pGap','gap1'),e=>e.code==='observation_gap_not_expandable');
});
test('daemon keeps requested overview when retention rejects, and never advertises unavailable expand',async t=>{
 const {context}=await fixture(t,'<main><h1>Results</h1>'+Array.from({length:20},(_,i)=>`<p>Row ${i}<a href="/item/${i}">Details</a></p>`).join('')+'</main>');
 const sessions=new SessionStore(context),opened=await sessions.open('https://example.test');const daemon=new BrowserDaemon({...getConfig(),learningDisabled:true});daemon.sessions=sessions;daemon.context=context;daemon.chrome.ensureConnected=async()=>context;
 daemon.observations=new ObservationService(new ObservationStore({maxObservationBytes:50}));
 const result=await daemon.dispatchUnlocked('page.snapshot',{sessionId:opened.id,format:'hwm',mode:'overview',nodeBudget:10});const v=parseHwm(result.hwm);
 assert.equal(v.header.view,'overview');assert.equal(v.header.retention.reason,'observation_too_large');
 assert.equal(result.snapshot.contextGraph,undefined);assert.ok(v.entries.filter(e=>e.type==='node').length<result.context.nodes);
 assert.ok(v.entries.some(e=>e.tag==='gap'&&e.attrs.kind==='unavailable'&&e.attrs.reason==='observation_too_large'));
 assert.ok(!v.entries.some(e=>e.tag==='gap'&&'expand' in e.attrs));
});
test('list excerpts mark every truncated field and keep Unicode boundaries',async t=>{
 const {page}=await fixture(t,'<main><ul>'+Array.from({length:3},(_,i)=>`<li><h2>${'😀'.repeat(130)}${i}</h2><a href="/item/${i}">Details</a><span>${'x'.repeat(250)}tail</span></li>`).join('')+'</ul></main>');await page.goto('https://example.test');
 const result=await listItems(page);assert.equal(result.found,true);
 for(const item of result.items){assert.equal(item.textTruncated,true);assert.equal(item.titleTruncated,true);assert.ok(item.textLength>item.textShown);assert.equal(Array.from(item.text).length,item.textShown);assert.equal(Array.from(item.title).length,item.titleShown);assert.ok(!/[\uD800-\uDBFF]$/.test(item.text));}
});
