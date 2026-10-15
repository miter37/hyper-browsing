// Replay saved public observations only. Never opens or rereads a website.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {parseHwm,serializeHwm} from '../../src/runtime/hwm/view.ts';
import {ObservationService} from '../../src/runtime/hwm/service.ts';
const dir=path.resolve('.runtime/airbnb-hwm-audit-20261015');
const pkg=await import(pathToFileURL(path.join(dir,'tokenizer/node_modules/js-tiktoken/dist/index.js')).href);
const tokenizer=pkg.getEncoding('o200k_base'),bytes=s=>Buffer.byteLength(s),tokens=s=>tokenizer.encode(s).length;
const snapshot=JSON.parse(await fs.readFile(path.join(dir,'paired-snapshot.json'),'utf8')).snapshot;
const original=parseHwm((await fs.readFile(path.join(dir,'paired-overview.hwm'),'utf8')).trimEnd()+'\n');
const service=new ObservationService();assert.equal(service.remember('audit',snapshot.contextGraph,original.header).ok,true);
const current=service.view('audit',snapshot.contextGraph.observation,{mode:'overview'}),view=parseHwm(current.hwm);
const pageNodes=v=>v.entries.filter(e=>e.type==='node').map(n=>{const c=structuredClone(n);delete c.attrs['repeated-shapes'];return c;});
assert.deepEqual(pageNodes(view),pageNodes(original),'all visible nodes, primary values, hierarchy, refs, attributes and relations must survive');
for(const tag of ['state','outline','candidates'])assert.deepEqual(view.entries.filter(e=>e.tag===tag),original.entries.filter(e=>e.tag===tag));
const linkGap=view.entries.find(e=>e.tag==='gap'&&e.attrs.scope==='links');assert.ok(linkGap);
const expanded=parseHwm(service.expand('audit',snapshot.contextGraph.observation,linkGap.id).hwm);
const oldIndex=original.entries.find(e=>e.tag==='links'),newIndex=expanded.entries.find(e=>e.tag==='links');
assert.deepEqual(newIndex.items,oldIndex.items,'index expansion must restore every original destination and ref exactly');
const report={at:new Date().toISOString(),scope:'same stored Airbnb observation; no new browsing',observation:snapshot.contextGraph.observation,
 tokenizer:'js-tiktoken o200k_base proxy; not model billing tokens',
 original:{bytes:bytes(serializeHwm(original)),proxyTokens:tokens(serializeHwm(original))},
 current:{bytes:bytes(current.hwm),proxyTokens:tokens(current.hwm)},
 fullIndexExpansion:{bytes:bytes(serializeHwm(expanded)),proxyTokens:tokens(serializeHwm(expanded)),destinations:newIndex.items.length},
 preserved:{visibleNodes:pageNodes(view).length,nodeDataExactExceptStructureDetail:true,stateOutlineCandidatesExact:true,fullDestinationRefsExact:true},
 note:'Detail folding, not lossless inline compression. Full index retrieval incurs additional output; full/expand recover stored details.'};
await fs.writeFile(path.join(import.meta.dirname,'diet-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
