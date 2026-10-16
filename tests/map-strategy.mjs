import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserOptions} from './browser-options.mjs';
import {captureMap} from '../src/runtime/observation/map.ts';
import {DemandObservationService} from '../src/runtime/observation/service.ts';
import {scrollPage} from '../src/runtime/discovery-tools.ts';
import {executePrimitive} from '../src/engine/execute.ts';
import {mapCommandToRpc} from '../scripts/webctl-rpc.mjs';
import {findGoal} from '../src/runtime/task/observe.ts';

test('widget reads expose native constraints without guessing units or editing readonly fields',async t=>{
 const page=await fixture(t,'<main><input aria-label="Start" readonly value="Choose"><input aria-label="Minimum" type="range" min="10" max="90" step="5" value="20" aria-valuetext="20 or more"><p>USD per night</p></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const m=await service.map(page,'s');
 const r=await service.read(page,'s',{at:m.at,panel:m.panels.find(p=>p.role==='main').id,want:'controls',repeat:true});
 assert.equal(r.data.find(n=>n.name==='Start').native.readonly,true);
 assert.deepEqual(r.data.find(n=>n.name==='Minimum').native,{type:'range',min:'10',max:'90',step:'5',valueText:'20 or more'});
 const found=await findGoal(page,{terms:['Minimum']});assert.equal(found.candidates[0].native.step,'5');
 const state=await service.read(page,'s',{at:m.at,panel:m.panels.find(p=>p.role==='main').id,want:'state',repeat:true});
 assert.equal(state.data.find(n=>n.name==='Minimum').native.min,'10');
 assert.ok(!JSON.stringify(m).includes('valueText'));
});

test('visible headings exclude content clipped by a nested scrolling ancestor',async t=>{
 const page=await fixture(t,'<main><div style="height:100px;overflow:auto"><h2>First month</h2><div style="height:160px"></div><h2>Second month</h2><div style="height:400px"></div></div></main>');
 const service=new DemandObservationService();t.after(()=>service.close());
 const m=await service.map(page,'s',{viewport:true});assert.ok(!JSON.stringify(m.panels).includes('Second month'));
 await page.locator('main > div').evaluate(el=>el.scrollTop=200);
 const next=await service.map(page,'s',{viewport:true});assert.ok(!JSON.stringify(next.panels).includes('First month'));assert.match(JSON.stringify(next.panels),/Second month/);
});

test('panel scroll moves its unique owner and rejects ambiguous owners without moving the document',async t=>{
 const page=await fixture(t,'<main><div style="height:100px;overflow:auto"><div style="height:900px">Months</div></div></main><div style="height:1800px"></div>');
 const service=new DemandObservationService();t.after(()=>service.close());const m=await service.map(page,'s');
 const result=await service.scroll(page,'s',{at:m.at,panel:m.panels.find(p=>p.role==='main').id,distance:200});
 assert.equal(result.owner.kind,'element');assert.equal(result.owner.after[1],200);assert.equal(await page.evaluate(()=>scrollY),0);
 await page.setContent('<main><div style="height:100px;overflow:auto"><div style="height:900px">A</div></div><div style="height:100px;overflow:auto"><div style="height:900px">B</div></div></main><div style="height:1800px"></div>');
 const m2=await service.map(page,'s');
 await assert.rejects(service.scroll(page,'s',{at:m2.at,panel:m2.panels.find(p=>p.role==='main').id,distance:200}),/scroll_owner_ambiguous/);
 assert.equal(await page.evaluate(()=>scrollY),0);
 await page.setContent('<main><p>No inner scrolling owner</p></main><div style="height:1800px"></div>');
 const m3=await service.map(page,'s');
 await assert.rejects(service.scroll(page,'s',{at:m3.at,panel:m3.panels.find(p=>p.role==='main').id,distance:200}),e=>e.code==='scroll_owner_not_found'&&e.execution==='not_started');
 assert.equal(await page.evaluate(()=>scrollY),0);
});

test('small widget focus prefers named enabled inputs over unnamed disabled decoration',async t=>{
 const page=await fixture(t,`<main><button aria-controls="widget" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('widget').hidden=false">Choose</button></main><div id="widget" hidden><button disabled></button><button disabled></button><input aria-label="Minimum" type="number" min="0"><button>Set</button></div>`);
 const service=new DemandObservationService();t.after(()=>service.close());await service.map(page,'s');
 const result=await service.afterAction(page,'s',await executePrimitive(page,'click',{locator:{role:'button',name:'Choose',exact:true}}));
 assert.deepEqual(result.focus.controls.map(c=>c.name),['Minimum','Set']);assert.equal(result.focus.controls[0].native.min,'0');
 assert.ok(Buffer.byteLength(JSON.stringify(result.focus))<4000);
});

async function fixture(t,html){
 const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1200,height:800}});await page.setContent(html);return page;
}
async function map(t,page){const m=await captureMap(page);t.after(()=>m.roots.dispose());return m;}

test('panel names stay explicit; visible headings remain separate evidence across nested headers',async t=>{
 const page=await fixture(t,'<main><header><h1>Document title</h1></header><h2>First subsection</h2><h2 style="display:none">CSS pollution</h2></main>');
 const m=await map(t,page),main=m.allPanels.find(p=>p.role==='main');
 assert.equal(main.name,undefined);assert.deepEqual(main.headings,['Document title','First subsection']);
 await page.locator('main').evaluate(el=>el.setAttribute('aria-label','Explicit title'));
 const next=await map(t,page);assert.equal(next.allPanels.find(p=>p.role==='main').name,'Explicit title');
});

test('deep main columns become separate DOM-root panels despite header and footer',async t=>{
 const page=await fixture(t,`<header>Header</header><main><div><div style="display:flex;gap:20px"><div id="left" style="width:260px;height:1300px"><h2>Options</h2><button>Change</button></div><div id="right" style="width:850px;height:1600px"><h2>Entries</h2><article>Item one</article><article>Item two</article></div></div></div></main><footer>Footer</footer>`);
 const m=await map(t,page),columns=m.allPanels.filter(p=>p.basis==='sibling-layout-v1');
 assert.equal(columns.length,2);assert.deepEqual(columns.map(p=>p.horizontal),['left','right']);
 for(const p of m.panels)if(p.parent)assert.ok(m.panels.some(a=>a.id===p.parent));
 assert.ok(columns.every(p=>p.parent===m.allPanels.find(p=>p.role==='main').id));
});

test('repeated card grid is one list boundary, not one panel per card',async t=>{
 const page=await fixture(t,`<main><div style="display:grid;grid-template-columns:repeat(3,1fr)">${Array.from({length:12},(_,i)=>`<article><h2>Card ${i}</h2><p>Details</p><button>Open</button></article>`).join('')}</div></main>`);
 const m=await map(t,page);assert.ok(m.allPanels.length<=3);assert.ok(m.allPanels.some(p=>p.basis==='repeated-children-v1'));assert.ok(!m.allPanels.some(p=>p.headings?.[0]==='Card 1'));
});

test('visible content read follows the viewport and clips independent scroll containers',async t=>{
 const page=await fixture(t,`<main><p>Above viewport only</p><div style="height:1000px"></div><section><p>Current content marker</p><button>Current action</button></section><div style="height:1000px"></div></main>`);
 const service=new DemandObservationService();t.after(()=>service.close());const m=await service.map(page,'s');
 await page.evaluate(()=>scrollTo(0,1000));
 const r=await service.read(page,'s',{at:m.at,panel:m.panels.find(p=>p.role==='main').id,want:'content,controls',visible:true,includeChildren:true});
 assert.equal(r.range,'viewport');assert.match(JSON.stringify(r.data),/Current content marker/);assert.doesNotMatch(JSON.stringify(r.data),/Above viewport only/);
 await page.setContent('<main><div style="height:100px;overflow:auto"><p>Visible line</p><div style="height:500px"></div><p>Clipped line</p></div></main>');
 const m2=await service.map(page,'s');const r2=await service.read(page,'s',{at:m2.at,panel:m2.panels.find(p=>p.role==='main').id,want:'content',visible:true,includeChildren:true});
 assert.doesNotMatch(JSON.stringify(r2.data),/Clipped line/);
});

test('expanded explicit controls expose roleless work surface with the same map scope',async t=>{
 const page=await fixture(t,'<main><button aria-controls="popup" aria-expanded="true">Choose</button></main><div id="popup"><h2>Month</h2><button>Next month</button></div>');
 const m=await map(t,page);assert.ok(m.allPanels.some(p=>p.basis==='aria-controls-expanded'&&p.headings?.includes('Month')));
});

test('scroll reports actual movement and owner; viewport response is local and contains no stale top controls',async t=>{
 const page=await fixture(t,'<main><button>Top only</button><div style="height:1000px"></div><p>Current marker</p><div style="height:1000px"></div></main>');
 const service=new DemandObservationService();t.after(()=>service.close());await service.map(page,'s');
 const scrolled=await scrollPage(page,{distance:1000});assert.equal(scrolled.owner.kind,'document');assert.equal(scrolled.owner.after[1],1000);
 const current=await service.map(page,'s',{viewport:true});assert.equal(current.range,'viewport');assert.doesNotMatch(JSON.stringify(current),/Top only/);assert.ok(current.panels.length>0);
 assert.ok(Buffer.byteLength(JSON.stringify(current))<4000);
 const missing=await scrollPage(page,{selector:'#missing'});assert.equal(missing.scrolled,false);assert.equal(missing.reason,'scroll_target_not_found');
});

test('CLI passes visible read scope through the actual RPC entry point',()=>{
 const rpc=mapCommandToRpc(['read'],{session:'s',at:'F1',want:'content'},new Set(['visible']));assert.equal(rpc.params.visible,true);
});

test('opening a roleless controlled surface returns its fresh controls without a whole-page map',async t=>{
 const page=await fixture(t,`<main><button aria-controls="popup" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('popup').hidden=false">Choose</button></main><div id="popup" hidden><h2>New choices</h2><button>First choice</button><button>Second choice</button></div>`);
 const service=new DemandObservationService();t.after(()=>service.close());await service.map(page,'s');
 const result=await service.afterAction(page,'s',await executePrimitive(page,'click',{locator:{role:'button',name:'Choose',exact:true}}));
 assert.equal(result.execution,'completed');assert.ok(result.focus);assert.ok(result.focus.headings.includes('New choices'));
 assert.deepEqual(result.focus.controls.map(c=>c.name),['First choice','Second choice']);assert.notEqual(result.focus.kind,'map');
});

test('same-document replacement refreshes a broken map while value edits do not',async t=>{
 const page=await fixture(t,`<main><button onclick="document.getElementById('column').outerHTML='<aside>New region</aside>'">Replace</button><aside id="column">Old region</aside><input aria-label="Query"></main>`);
 const service=new DemandObservationService();t.after(()=>service.close());const m=await service.map(page,'s');
 const filled=await service.afterAction(page,'s',await executePrimitive(page,'fill',{locator:{role:'textbox',name:'Query',exact:true},value:'test'}));assert.notEqual(filled.focus?.kind,'map');
 const result=await service.afterAction(page,'s',await executePrimitive(page,'click',{locator:{role:'button',name:'Replace',exact:true}}));
 assert.equal(result.focus?.kind,'map');assert.notEqual(result.focus.map,m.map);assert.equal(result.execution,'completed');
});

test('offscreen text does not exhaust the visible-content output node budget',async t=>{
 const page=await fixture(t,`<main>${Array.from({length:450},(_,i)=>`<p>Earlier line ${i}</p>`).join('')}<section id="now"><p>Deep viewport marker</p></section><div style="height:1200px"></div></main>`);
 const service=new DemandObservationService();t.after(()=>service.close());const m=await service.map(page,'s');await page.locator('#now').scrollIntoViewIfNeeded();
 const r=await service.read(page,'s',{at:m.at,panel:m.panels.find(p=>p.role==='main').id,want:'content',visible:true});
 assert.match(JSON.stringify(r.data),/Deep viewport marker/);assert.ok(JSON.stringify(r).length<16000);
});

test('viewport heading evidence does not retract the whole-panel heading evidence',async t=>{
 const page=await fixture(t,'<main><h1>Document title</h1><div style="height:1000px"></div><h2>Current section</h2><div style="height:1000px"></div></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const first=await service.map(page,'s');await page.evaluate(()=>scrollTo(0,1000));
 const now=await service.map(page,'s',{viewport:true,since:first.delivery});
 const main=now.panels.find(p=>p.role==='main'||p.id===first.panels.find(p=>p.role==='main').id);
 assert.deepEqual(main.visibleHeadings,['Current section']);assert.ok(!main.unavailableFields?.includes('headings'));assert.equal(main.headings,undefined);
});
