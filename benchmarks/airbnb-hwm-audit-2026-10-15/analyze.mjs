// Analysis-only experiments. No browser actions or product renderer changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseHwm,serializeHwm,validateHwm} from '../../src/runtime/hwm/view.ts';
const root=path.resolve(import.meta.dirname,'../..');
const dir=path.join(root,'.runtime/airbnb-hwm-audit-20261015');
const bytes=s=>Buffer.byteLength(s,'utf8');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>structuredClone(v);
let tokenizer;
try{const pkg=await import(pathToFileURL(path.join(dir,'tokenizer/node_modules/js-tiktoken/dist/index.js')).href);tokenizer=pkg.getEncoding('o200k_base');}catch(error){console.error('Token proxy unavailable:',error.message);}
const tokens=s=>tokenizer?tokenizer.encode(s).length:null;

function common(objects){
 const result={};for(const [key,value]of Object.entries(objects[0])){
  if(!objects.every(o=>Object.hasOwn(o,key)))continue;
  if(objects.every(o=>same(o[key],value)))result[key]=clone(value);
  else if(object(value)&&objects.every(o=>object(o[key]))){const nested=common(objects.map(o=>o[key]));if(Object.keys(nested).length)result[key]=nested;}
 }return result;
}
function delta(value,base){
 const result=clone(value);for(const [key,template]of Object.entries(base)){
  if(same(result[key],template))delete result[key];
  else if(object(template)&&object(result[key])){result[key]=delta(result[key],template);if(!Object.keys(result[key]).length)delete result[key];}
 }return result;
}
function merge(base,override){const result=clone(base);for(const [key,value]of Object.entries(override))result[key]=object(value)&&object(result[key])?merge(result[key],value):clone(value);return result;}
function bags(view){const all=[];for(const e of view.entries){all.push({owner:e,group:e.type==='node'?'node:'+e.kind+':'+(e.attrs.tag??''):'record:'+e.tag});if(e.type==='record')for(const item of e.items)all.push({owner:item,group:'item:'+e.tag+':'+item.literal});}return all;}

/** Explicit common-attribute templates; all text, states, IDs, relations and records survive. */
function templateExperiment(original){
 const v=clone(original),all=bags(v);let slot='hbTemplate';while(all.some(b=>Object.hasOwn(b.owner.attrs,slot)))slot+='_';
 const groups=new Map();for(const b of all){const key=b.group+':'+Object.keys(b.owner.attrs).sort().join('|');const entries=groups.get(key)??[];entries.push(b.owner);groups.set(key,entries);}
 const templates={};let uses=0;
 for(const owners of groups.values()){
  if(owners.length<3)continue;const base=common(owners.map(o=>o.attrs));if(!Object.keys(base).length)continue;
  const name='T'+Object.keys(templates).length;
  const savings=owners.reduce((sum,o)=>sum+bytes(JSON.stringify(o.attrs))-bytes(JSON.stringify({...delta(o.attrs,base),[slot]:name})),0)-bytes(JSON.stringify(base))-name.length-8;
  if(savings<120)continue;
  templates[name]=base;for(const owner of owners){owner.attrs={...delta(owner.attrs,base),[slot]:name};uses++;}
 }
 v.header['projection-experiment']='common-attribute-templates-v1';v.header['attribute-template-key']=slot;v.header['attribute-templates']=templates;
 const encoded=serializeHwm(v),decoded=parseHwm(encoded),definitions=decoded.header['attribute-templates'];
 for(const {owner}of bags(decoded)){const ref=owner.attrs[slot];if(ref!==undefined){const attrs={...owner.attrs};delete attrs[slot];owner.attrs=merge(definitions[ref],attrs);}}
 for(const key of ['projection-experiment','attribute-template-key','attribute-templates'])delete decoded.header[key];
 assert.deepEqual(decoded,original,'template projection must restore the entire original parsed message');
 assert.equal(serializeHwm(decoded),serializeHwm(original),'restored serialization must be byte-identical');
 // Standalone messages omit the store's folded-target map; preserve the same
 // validation result instead of mistaking legal folded refs for new failures.
 assert.deepEqual(validateHwm(decoded),validateHwm(original));
 return {text:encoded,templates:Object.keys(templates).length,uses,roundTripExact:true};
}

/** Detail abbreviation only: not called lossless. Original artifacts remain the sidecar. */
function detailExperiment(original){
 const v=clone(original);for(const e of v.entries)if(e.type==='node')delete e.attrs['repeated-shapes'];
 const timing=v.header['collection-timing'];if(object(timing)){delete timing.phases;delete timing.references;}
 v.header['detail-abbreviation']={fields:['node.repeated-shapes','collection-timing.phases','collection-timing.references'],access:'same-observation full view or original audit artifact',lossless:false};
 const text=serializeHwm(v);assert.deepEqual(validateHwm(parseHwm(text)),validateHwm(original));return text;
}
function breakdown(text){
 const result={};let section='header',indent=0;
 for(const line of text.trimEnd().split('\n')){if(line.startsWith('@'))section=line.split(' ')[0];else if(!line.startsWith('- '))section='nodes';const row=result[section]??={bytes:0,lines:0};row.bytes+=bytes(line+'\n');row.lines++;indent+=line.match(/^ */)[0].length;}
 return {sections:result,indentBytes:indent};
}
const commands=(await fs.readFile(path.join(dir,'commands.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),rows=[];
for(const command of commands){
 const raw=JSON.parse(await fs.readFile(path.join(dir,`command-${String(command.seq).padStart(3,'0')}.json`),'utf8'));
 if(!raw.stdout.startsWith('@hwm '))continue;
 const v=parseHwm(raw.stdout),canonical=serializeHwm(v);const lossless=templateExperiment(v),detail=detailExperiment(v),detailView=parseHwm(detail),combined=templateExperiment(detailView);
 const noShapes=clone(v);for(const e of noShapes.entries)if(e.type==='node')delete e.attrs['repeated-shapes'];
 const result=v.entries.find(e=>e.tag==='result')?.attrs;
 const row={seq:command.seq,command:command.args[0],durationMs:command.durationMs,rawBytes:raw.stdoutBytes,canonicalBytes:bytes(canonical),proxyTokens:tokens(canonical),...breakdown(canonical),nodes:v.entries.filter(e=>e.type==='node').length,changes:v.entries.filter(e=>e.tag==='change').length,execution:result?.execution??null,repeatedShapeBytes:bytes(canonical)-bytes(serializeHwm(noShapes)),lossless:{bytes:bytes(lossless.text),proxyTokens:tokens(lossless.text),templates:lossless.templates,uses:lossless.uses,roundTripExact:lossless.roundTripExact},detailOnly:{bytes:bytes(detail),proxyTokens:tokens(detail),lossless:false},combined:{bytes:bytes(combined.text),proxyTokens:tokens(combined.text),roundTripAgainstDetail:combined.roundTripExact,losslessAgainstOriginal:false}};
 rows.push(row);await fs.writeFile(path.join(dir,`prototype-${String(command.seq).padStart(3,'0')}.hwm`),lossless.text);
}
const paired=JSON.parse(await fs.readFile(path.join(dir,'paired-snapshot.json'),'utf8'));const {contextGraph,collectionTiming,stateObservation,...flat}=paired.snapshot;
const pairedHwm=rows.find(r=>r.seq===25);
const hashes=[];for(const file of ['SKILL.md','scripts/launcher.mjs','src/browserd/server.ts','src/runtime/hwm/renderer.ts','src/runtime/hwm/projection.ts'])hashes.push({file,sha256:createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')});
const report={at:new Date().toISOString(),site:'https://www.airbnb.com',headless:true,learningDisabled:true,tokenizer:tokenizer?'js-tiktoken o200k_base proxy; not Luna billing tokens':null,rows,paired:{observation:contextGraph.observation,controls:flat.elements.length,graphNodes:contextGraph.nodes.length,elementCenteredProjection:{bytes:bytes(JSON.stringify(flat)),proxyTokens:tokens(JSON.stringify(flat)),sameCapture:true,sameInformationAsHwm:false,description:'current snapshot without contextGraph/collectionTiming/stateObservation; not an old-engine run'},hwm:pairedHwm,graphJsonBytes:bytes(JSON.stringify(contextGraph))},commandCount:commands.length,setupFailure:commands[0].code!==0,hashes};
await fs.writeFile(path.join(import.meta.dirname,'results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({tokenizer:report.tokenizer,pair:{oldStyle:report.paired.elementCenteredProjection,hwmBytes:pairedHwm.canonicalBytes,hwmTokens:pairedHwm.proxyTokens},rows:rows.map(r=>({seq:r.seq,kb:(r.canonicalBytes/1000).toFixed(1),tokens:r.proxyTokens,templateKB:(r.lossless.bytes/1000).toFixed(1),templateTokens:r.lossless.proxyTokens,detailKB:(r.detailOnly.bytes/1000).toFixed(1),combinedKB:(r.combined.bytes/1000).toFixed(1),shapesKB:(r.repeatedShapeBytes/1000).toFixed(1)}))},null,2));
