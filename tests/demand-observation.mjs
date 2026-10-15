import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserOptions} from './browser-options.mjs';
import {captureSnapshot} from '../src/runtime/snapshot.ts';
async function fixture(t,html){const browser=await chromium.launch(browserOptions());t.after(()=>browser.close());const page=await browser.newPage();await page.setContent(html);return page;}
test('map facts mask sensitive URL paths before delivery, including null-origin URLs',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main>Ready</main>');
 const service=new DemandObservationService();t.after(()=>service.close());
 await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<main>Ready</main>'}));
 await page.goto('https://fixture.invalid/account/person@example.com/token_abcdefghijklmnop?q=hidden');
 const map=await service.map(page,'s');assert.ok(!map.url.includes('person@example.com'));assert.ok(!map.url.includes('token_abcdefghijklmnop'));assert.equal(map.queryAvailable,true);
 await page.goto('data:text/html,<main>person@example.com token_abcdefghijklmnop</main>');
 const opaque=await service.map(page,'s');assert.ok(!opaque.url.includes('person@example.com'));assert.ok(!opaque.url.includes('token_abcdefghijklmnop'));
});
test('content delivery retracts removed names and accessibility declarations',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><section aria-label="Old label" aria-hidden="true"><p>Content</p></section></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),args={map:map.map,panel:map.panels.find(p=>p.role==='main').id,want:'content'};
 const first=await service.read(page,'s',args),node=first.data.find(d=>d.name==='Old label');assert.ok(node);
 await page.locator('section').evaluate(el=>{el.removeAttribute('aria-label');el.removeAttribute('aria-hidden');});
 const next=await service.read(page,'s',{...args,since:first.delivery}),patch=next.data.find(d=>d.id===node.id);
 assert.ok(patch?.unavailableFields?.includes('name'));assert.ok(patch?.unavailableFields?.includes('aria-hidden'));
});
test('map delivery retracts optional panel names that are no longer observed',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main aria-label="Old panel"><button>Action</button></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const first=await service.map(page,'s'),panel=first.panels.find(p=>p.name==='Old panel');assert.ok(panel);
 await page.locator('main').evaluate(el=>el.removeAttribute('aria-label'));
 const next=await service.map(page,'s',{since:first.delivery});assert.ok(next.panels.some(p=>p.id===panel.id&&p.unavailableFields?.includes('name')));
});
test('native read targets reject semantic DOM recycling even after a fresh panel capture',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><p data-id="original">Original item</p></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),args={map:map.map,panel:map.panels[0].id,want:'content'};
 const first=await service.read(page,'s',args),old=first.data.find(d=>d.kind==='paragraph').id;
 await page.locator('p').evaluate(el=>{el.setAttribute('data-id','new-item');el.textContent='Different item';});
 await assert.rejects(()=>service.read(page,'s',{...args,target:old}),e=>e.code==='read_target_not_found');
 const fresh=await service.read(page,'s',args),current=fresh.data.find(d=>d.kind==='paragraph').id;assert.notEqual(current,old);
 await assert.rejects(()=>service.read(page,'s',{...args,target:old}),e=>e.code==='read_target_not_found');
 assert.ok(JSON.stringify(await service.read(page,'s',{...args,target:current})).includes('Different item'));
 await page.locator('p').evaluate(el=>{el.setAttribute('data-id','original');el.textContent='Original item';});
 const back=await service.read(page,'s',{...args,since:first.delivery});assert.ok(back.data.some(d=>d.kind==='paragraph'&&d.id!==old));
 await assert.rejects(()=>service.read(page,'s',{...args,target:old}),e=>e.code==='read_target_not_found');
});
test('queried native content identifies matching fields without labelling contextual ancestors as matches',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<main><article><h2>Destination</h2><a href="/find?q=New%20York">Hotels</a><p>New York City</p></article></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const read=await service.read(page,'s',{map:map.map,panel:map.panels[0].id,want:'content,controls',query:'New York'});
 assert.equal(read.query,'New York');
 const link=read.data.find(d=>d.href==='/find?q=New%20York');assert.ok(link?.match?.some(m=>m.field==='href.query'),JSON.stringify(read.data));
 assert.ok(read.data.some(d=>d.parent===link.id&&d.text==='Hotels'));
 assert.ok(read.data.some(d=>d.text==='New York City'&&d.match?.some(m=>m.field==='text')));
 assert.ok(read.data.filter(d=>d.kind==='region'||d.kind==='item').every(d=>!d.match));
});
test('a definition term query retains the full inline signature and its following definition only',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<main><h1>File API</h1><dl><dt><span>Path.</span><strong>read_text</strong><span>(encoding=None)</span></dt><dd><p>Return decoded contents as a string.</p></dd><dt>write_text(data)</dt><dd><p>UNRELATED_DEFINITION</p></dd></dl></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const read=await service.read(page,'s',{map:map.map,panel:map.panels[0].id,want:'content',query:'read_text'});
 assert.ok(read.data.some(d=>d.text==='Path.'));assert.ok(read.data.some(d=>d.text==='(encoding=None)'));
 assert.ok(read.data.some(d=>d.text==='Return decoded contents as a string.'));assert.ok(!JSON.stringify(read.data).includes('UNRELATED_DEFINITION'));
 const term=read.data.find(d=>d.tag==='dt'),definition=read.data.find(d=>d.tag==='dd');assert.ok(term&&definition);assert.equal(term.parent,definition.parent);
});
test('changing a query retracts an old match on a node still included as context',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><p>First city <em>Second city</em></p></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),args={map:map.map,panel:map.panels[0].id,want:'content'};
 const first=await service.read(page,'s',{...args,query:'First city'});const id=first.data.find(d=>d.text==='First city ')?.id;assert.ok(id);
 const second=await service.read(page,'s',{...args,query:'Second city',since:first.delivery});
 assert.ok(second.data.some(d=>d.id===id&&d.unavailableFields?.includes('match')));
});
test('a text query preserves nearby qualifying words and their real DOM group instead of returning a bare amount',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<main>'+Array.from({length:400},(_,i)=>`<p>Earlier paragraph ${i}</p>`).join('')+'<div><h2>Device A</h2><div><span>Free delivery on orders over </span><span>$49</span></div><div><span>Price </span><span>$19</span></div></div><div><h2>Device B</h2><p>UNRELATED_PRODUCT</p></div></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const read=await service.read(page,'s',{map:map.map,panel:map.panels[0].id,want:'content',query:'$49'});
 const amount=read.data.find(d=>d.text==='$49'),qualifier=read.data.find(d=>d.text==='Free delivery on orders over ');
 assert.ok(amount&&qualifier,JSON.stringify(read.data));
 const ancestors=node=>{const ids=[];for(let p=read.data.find(d=>d.id===node.parent);p;p=read.data.find(d=>d.id===p.parent))ids.push(p.id);return ids;};
 assert.ok(ancestors(amount).some(id=>ancestors(qualifier).includes(id)&&read.data.find(d=>d.id===id)?.kind==='group'));
 assert.ok(!JSON.stringify(read.data).includes('UNRELATED_PRODUCT'));
});
test('URL masking is explicit in both small controls and content reads',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<main><a href="https://shop.example/product/a-very-long-readable-product-description-with-wireless-connectivity-and-long-battery-life?token=private-value">Product</a></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const control=map.panels.flatMap(p=>p.controls??[]).find(c=>c.name==='Product');assert.ok(control?.redacted?.includes('href'));
 const read=await service.read(page,'s',{map:map.map,panel:map.panels[0].id,want:'content,controls'});assert.ok(read.data.some(d=>d.href&&d.redacted?.includes('href')));
 assert.ok(!JSON.stringify(read).includes('private-value'));
});
test('lightweight rooted snapshot never builds a graph or returns controls/text outside its root',async t=>{
 const page=await fixture(t,'<header><button>Outside</button><p>Do not read me</p></header><main><input aria-label="Find" value="A"><button>Inside</button><p>Local words</p></main>');
 const root=await page.locator('main').elementHandle();t.after(()=>root.dispose());
 const snap=await captureSnapshot(page,{root,context:false,lightweight:true,waitMs:0});
 assert.equal(snap.contextGraph,undefined);assert.ok(snap.elements.some(e=>e.name==='Inside'));assert.ok(!snap.elements.some(e=>e.name==='Outside'));
 assert.equal(snap.diagnostics?.bodyTextLength,undefined);
 const content=await captureSnapshot(page,{root,context:true,lightweight:true,waitMs:0});
 assert.ok(content.contextGraph.nodes.some(n=>n.text==='Local words'));assert.ok(!JSON.stringify(content.contextGraph).includes('Do not read me'));
});
test('map is a bounded outline, never sends the article or full graph, and preserves a dialog',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<header><input type="search" aria-label="Search"><button>Menu</button></header><main><h1>Article</h1>'+Array.from({length:1000},(_,i)=>`<p>BODY_ONLY_${i}</p>`).join('')+'</main><div role="dialog" aria-label="Notice"><button>Close</button></div>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 assert.equal(map.kind,'map');assert.ok(map.panels.some(p=>p.role==='main'));assert.ok(map.panels.some(p=>p.role==='dialog'));assert.ok(!JSON.stringify(map).includes('BODY_ONLY_'));
 assert.ok(Buffer.byteLength(JSON.stringify(map))<8000);assert.equal(map.contextGraph,undefined);
 const main=map.panels.find(p=>p.role==='main');const read=await service.read(page,'s',{map:map.map,panel:main.id,want:'content',limit:40});
 assert.ok(JSON.stringify(read).includes('BODY_ONLY_0'));assert.ok(!JSON.stringify(read).includes('BODY_ONLY_999'));assert.equal(read.coverage.complete,false);
});
test('panel outline does not promote article headers or borrow a nested navigation heading as the main name',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<header><h2>Site</h2></header><main><nav><h2>Contents</h2></nav><h1>Reference document</h1><article><header><h2>Card title</h2></header><p>Body</p><footer>By author</footer></article></main><footer>Site footer</footer>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 assert.equal(map.panels.filter(p=>p.role==='banner').length,1);
 assert.equal(map.panels.filter(p=>p.role==='contentinfo').length,1);
 assert.equal(map.panels.find(p=>p.role==='main')?.name,'Reference document');
 assert.ok(map.panels.some(p=>p.role==='navigation'&&p.name==='Contents'));
});
test('small map prioritizes observed form inputs and excludes passive dialog containers from its control samples',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<header><a href="#">Logo</a><button>Menu</button><button>Categories</button><input type="search" aria-label="Find items"></header><main><h1>Page</h1></main><div role="dialog" aria-label="Notice"><button>Close</button><button>Continue</button></div>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 assert.ok(map.panels.find(p=>p.role==='banner')?.controls?.some(c=>c.role==='searchbox'&&c.name==='Find items'));
 const dialog=map.panels.find(p=>p.role==='dialog');assert.ok(dialog);assert.ok(dialog.controls?.every(c=>c.role!=='dialog'));
 assert.ok(map.panels.every(p=>(p.controls?.length??0)<=2));
});
test('scoped rich explanation folds its stored graph to fit the byte budget instead of discarding usable detail',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<main><h1>Options</h1>'+Array.from({length:60},(_,i)=>`<button>Option ${i} ${'ordinary description '.repeat(7)}</button>`).join('')+'</main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const detail=await service.explain(page,'s',{map:map.map,panel:map.panels[0].id,byteBudget:5000});
 assert.ok(detail.hwm,JSON.stringify(detail));assert.ok(Buffer.byteLength(detail.hwm)<=5000);assert.ok(detail.hwm.includes('@end'));
 assert.ok(detail.hwm.includes('kind="folded"'));
 assert.ok(service.detailed.view('s',detail.observation,{mode:'overview',nodeBudget:60}).hwm.length>detail.hwm.length);
 await page.evaluate(()=>document.title='ordinary title '.repeat(500));
 const tooLarge=await service.explain(page,'s',{map:map.map,panel:map.panels[0].id,byteBudget:1500});assert.equal(tooLarge.reason,'detail_budget_exceeded');assert.ok(tooLarge.observation);
});
test('a control found through nearby text retains that derived hint without renaming the control',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><div><span>Adults</span><div><button>-</button><span>2</span><button>+</button></div></div></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const read=await service.read(page,'s',{map:map.map,panel:map.panels[0].id,want:'controls',query:'Adults'});
 const minus=read.data.find(d=>d.name==='-');assert.equal(minus?.hint,'Adults');assert.equal(minus?.hintSource,'snapshot-nearby-text-v1');
});
test('unnamed controls retain viewport geometry without adding geometry to every named control',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');
 const page=await fixture(t,'<main><button style="position:fixed;left:10px;top:40px;width:20px;height:20px"><svg aria-hidden="true"></svg></button><button style="position:fixed;left:110px;top:40px;width:20px;height:20px"><svg aria-hidden="true"></svg></button><button style="position:fixed;top:100px">Named</button></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');
 const read=await service.read(page,'s',{map:map.map,panel:map.panels[0].id,want:'controls'}),unnamed=read.data.filter(d=>d.role==='button'&&!d.name);
 assert.equal(unnamed.length,2);assert.deepEqual(unnamed.map(d=>d.viewportBox?.[0]),[10,110]);assert.ok(unnamed.every(d=>d.viewportBox?.length===4));
 assert.equal(read.data.find(d=>d.name==='Named')?.viewportBox,undefined);
});
test('a scoped read accepts an issued action ref but rejects foreign-panel and stale refs without navigating',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><a href="/entry"><span>Candidate</span><span>4.8 · 120 reviews</span></a></main><aside><button>Other</button></aside>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),main=map.panels.find(p=>p.role==='main'),aside=map.panels.find(p=>p.role==='complementary');
 const ref=main.controls.find(c=>c.role==='link').ref;
 const read=await service.read(page,'s',{map:map.map,panel:main.id,target:ref,want:'content,controls'});assert.ok(JSON.stringify(read.data).includes('4.8 · 120 reviews'));assert.equal(page.url(),'about:blank');
 await assert.rejects(()=>service.read(page,'s',{map:map.map,panel:main.id,target:aside.controls[0].ref,want:'content'}),e=>e.code==='read_target_not_found');
 await page.locator('main a').evaluate(el=>el.replaceWith(el.cloneNode(true)));
 await assert.rejects(()=>service.read(page,'s',{map:map.map,panel:main.id,target:ref,want:'content'}),e=>e.code==='stale_ref');
});
test('a scoped reference read follows an open shadow host within the panel',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><div id="component"></div></main>');
 await page.locator('#component').evaluate(el=>{el.attachShadow({mode:'open'}).innerHTML='<a href="/shadow">Shadow candidate <span>4.9 stars</span></a>';});
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),main=map.panels.find(p=>p.role==='main');const ref=main.controls.find(c=>c.role==='link').ref;
 const read=await service.read(page,'s',{map:map.map,panel:main.id,target:ref,want:'content'});assert.ok(JSON.stringify(read.data).includes('4.9 stars'));
});
test('native content preserves explicit aria-hidden boundaries and their changed declaration',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><div aria-hidden="true"><span>Template</span><a href="/placeholder">Placeholder</a></div><p>Visible content</p></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),args={map:map.map,panel:map.panels[0].id,want:'content'};
 const first=await service.read(page,'s',args);const boundary=first.data.find(d=>d['aria-hidden']==='true');assert.ok(boundary);assert.ok(first.data.some(d=>d.parent===boundary.id));
 await page.locator('[aria-hidden]').evaluate(el=>el.setAttribute('aria-hidden','false'));
 const after=await service.read(page,'s',{...args,since:first.delivery});assert.ok(after.data.some(d=>d.id===boundary.id&&d['aria-hidden']==='false'));
});
test('scoped content keeps item ownership and delivery suppresses only received fields of the same target',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<header><p>Outside</p></header><main><ul><li>Mouse A <b>$18.40</b><a href="/a">Details</a></li><li>Mouse B <b>$16.00</b><a href="/b">Details</a></li></ul><input aria-label="Place" value="Seoul"><input type="password" value="private-secret"></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),panel=map.panels.find(p=>p.role==='main').id;
 const options={map:map.map,panel,want:'content,controls,state'};const first=await service.read(page,'s',options);const serialized=JSON.stringify(first);
 assert.ok(serialized.includes('Mouse B'));assert.ok(serialized.includes('$16.00'));assert.ok(!serialized.includes('Outside'));assert.ok(!serialized.includes('private-secret'));
 assert.ok(first.data.some(x=>x.kind==='item'));assert.ok(first.data.filter(x=>x.text).every(x=>x.parent));
 const second=await service.read(page,'s',{...options,since:first.delivery});assert.equal(second.data.length,0);assert.ok(second.known>0);
 await page.locator('input[aria-label=Place]').evaluate(el=>el.value='Busan');
 const third=await service.read(page,'s',{...options,since:second.delivery});assert.ok(third.data.some(x=>x.value==='Busan'));assert.ok(!JSON.stringify(third.data).includes('Mouse A'));
 const independent=await service.read(page,'s',options);assert.ok(JSON.stringify(independent.data).includes('Mouse A'));
 await assert.rejects(()=>service.read(page,'s',{...options,since:first.delivery,consumer:'other'}),e=>e.code==='delivery_scope_mismatch');
});
test('old panel aliases reject DOM replacement, cross-session use and expiry instead of rebinding',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><p>Original</p></main>');let now=0;
 const service=new DemandObservationService({clock:()=>now,ttlMs:100});t.after(()=>service.close());const map=await service.map(page,'s');const options={map:map.map,panel:map.panels[0].id,want:'content'};
 await assert.rejects(()=>service.read(page,'other',options),e=>e.code==='scope_mismatch');
 await page.locator('main').evaluate(el=>el.replaceWith(el.cloneNode(true)));
 await assert.rejects(()=>service.read(page,'s',options),e=>e.code==='scope_stale');now=100;
 await assert.rejects(()=>service.read(page,'s',options),e=>e.code==='scope_expired');
});
test('repeated map delivers only new panel facts and read can reuse controls actually received in the map',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><input aria-label="Place" value="Seoul"><p>Article</p></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const first=await service.map(page,'s');
 const again=await service.map(page,'s',{since:first.delivery});assert.equal(again.map,first.map);assert.equal(again.panels.length,0);
 const read=await service.read(page,'s',{map:first.map,panel:first.panels[0].id,want:'controls',since:again.delivery});assert.ok(!JSON.stringify(read.data).includes('Seoul'));
 const other=await service.map(page,'s');assert.ok(other.panels.length>0);
 await page.locator('input').fill('Busan');const changed=await service.map(page,'s',{since:again.delivery});assert.ok(changed.panels.some(p=>p.controls?.some(c=>c.value==='Busan')));
});
test('long text is bounded before recording delivery and can be requested in full without losing its tail',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const text='ordinary words '.repeat(1500)+'THE_END';const page=await fixture(t,'<main><p>'+text+'</p></main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s');const args={map:map.map,panel:map.panels[0].id,want:'content'};
 const short=await service.read(page,'s',args);assert.ok(Buffer.byteLength(JSON.stringify(short))<12000);assert.ok(short.data.some(d=>d.textTruncated));
 const full=await service.read(page,'s',{...args,since:short.delivery,textLimit:30000,byteBudget:40000});assert.ok(JSON.stringify(full.data).includes('THE_END'));
 const blockedArgs={...args,target:short.data.find(d=>d.text)?.id,textLimit:30000,byteBudget:1500};let blocked=await service.read(page,'s',blockedArgs);if(blocked.coverage.nextOffset!==undefined)blocked=await service.read(page,'s',{...blockedArgs,offset:blocked.coverage.nextOffset});assert.ok(blocked.coverage.requiredByteBudget>1500);assert.equal(blocked.coverage.nextOffset,undefined);
});
test('disappearing requested state is retracted and controls pagination can reach beyond 600',async t=>{
 const {DemandObservationService}=await import('../src/runtime/observation/service.ts');const page=await fixture(t,'<main><button aria-expanded="true">Toggle</button>'+Array.from({length:605},(_,i)=>`<button>B${i}</button>`).join('')+'</main>');
 const service=new DemandObservationService();t.after(()=>service.close());const map=await service.map(page,'s'),args={map:map.map,panel:map.panels[0].id,want:'controls',limit:60,byteBudget:40000};
 const first=await service.read(page,'s',args);assert.equal(first.coverage.nextOffset,60);
 await page.locator('button').first().evaluate(el=>el.removeAttribute('aria-expanded'));
 const next=await service.read(page,'s',{...args,since:first.delivery});assert.ok(next.data.some(d=>d.unavailableFields?.includes('expanded')));
 const tail=await service.read(page,'s',{...args,offset:600});assert.ok(tail.data.some(d=>d.name==='B604'));
 const detail=await service.explain(page,'s',{...args,byteBudget:1500});assert.ok(detail.observation);if(detail.hwm)assert.ok(Buffer.byteLength(detail.hwm)<=1500);else assert.equal(detail.reason,'detail_budget_exceeded');
 await page.locator('main').evaluate(el=>el.insertAdjacentHTML('afterbegin','<input aria-label="Long field" value="'+ 'ordinary words '.repeat(10)+'">'));
 const preview=await service.read(page,'s',{...args,query:'Long field'});assert.ok(preview.data.some(d=>d.valuePreview===true));
 const exact=await service.read(page,'s',{...args,want:'state',query:'Long field',since:preview.delivery});assert.ok(exact.data.some(d=>d.value?.length>60));
});
