import { randomUUID } from 'node:crypto';
import { sanitizeObservation, type ObservationGraph } from './observation';
import { redactContent, redactUrl } from '../../utils/strings';
import type { Attributes, Json } from './view';
export class ObservationError extends Error { constructor(public code:string){super(code);} }
export interface StoredObservation {session:string;graph:ObservationGraph;header:Attributes;expiresAt:number}
interface StoredComparison {id:string;session:string;before:string;after:string;changes:Attributes[];result?:Attributes;expiresAt:number}
type Options={ttlMs?:number;maxObservations?:number;maxComparisons?:number;maxBytes?:number;maxObservationBytes?:number;clock?:()=>number};
export function cleanStoredJson(value:Json,key=''):Json{
 if(typeof value==='string')return ['node','obs','ref','request','requestId','session','sessionId','document','after-request','opener-session'].includes(key)?value:['url','href','action'].includes(key)?redactUrl(value):redactContent(value);
 if(Array.isArray(value))return ['selected','parts','refs','source-nodes'].includes(key)?value:value.map(v=>cleanStoredJson(v,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,value.field==='selected'&&['old','new'].includes(k)?v:cleanStoredJson(v,k)]));return value;
}
/** Bounded ephemeral public data. Serialized bytes are a budget estimate, not JS heap size. */
export class ObservationStore {
 private observations=new Map<string,{value:StoredObservation;bytes:number}>();
 private comparisons=new Map<string,{value:StoredComparison;bytes:number}>();
 private rejected=new Map<string,{session:string;reason:string;expiresAt:number}>();
 private readonly limits:Required<Options>;
 constructor(options:Options={}){this.limits={ttlMs:300000,maxObservations:32,maxComparisons:32,maxBytes:16*1024*1024,maxObservationBytes:2*1024*1024,clock:Date.now,...options};for(const [k,v]of Object.entries(this.limits))if(k!=='clock'&&(!Number.isFinite(v)||Number(v)<=0))throw new Error('Invalid observation store limit');}
 private prune(){const now=this.limits.clock();for(const [id,e]of this.rejected)if(e.expiresAt<=now)this.rejected.delete(id);for(const [id,e]of this.observations)if(e.value.expiresAt<=now)this.observations.delete(id);for(const [id,e]of this.comparisons)if(e.value.expiresAt<=now||!this.observations.has(e.value.before)||!this.observations.has(e.value.after))this.comparisons.delete(id);}
 private reject(session:string,id:string,reason:string){if(!this.rejected.has(id)){while(this.rejected.size>=this.limits.maxObservations)this.rejected.delete(this.rejected.keys().next().value!);this.rejected.set(id,{session,reason,expiresAt:this.limits.clock()+this.limits.ttlMs});}return {ok:false as const,reason};}
 private bytes(){return [...this.observations.values(),...this.comparisons.values()].reduce((n,e)=>n+e.bytes,0);}
 private room(bytes:number){while(this.bytes()+bytes>this.limits.maxBytes){const c=this.comparisons.keys().next().value;if(c){this.comparisons.delete(c);continue;}const o=this.observations.keys().next().value;if(!o)return false;this.observations.delete(o);this.prune();}return true;}
 put(session:string,graph:ObservationGraph,header:Attributes={}):{ok:true;observation:string;expiresAt:number}|{ok:false;reason:string}{
  if(!graph||graph.version!=='0.2'||typeof graph.observation!=='string'||typeof graph.document!=='string'||!Array.isArray(graph.nodes)||!graph.nodes.length||graph.nodes.length>6000||!Array.isArray(graph.edges)||!Array.isArray(graph.gaps)||!Array.isArray(graph.matches))throw new ObservationError('invalid_observation_graph');
  const seen=new Set<string>(),refs=new Set<string>();for(const [i,n]of graph.nodes.entries()){
   if(!n||typeof n.id!=='string'||seen.has(n.id)||!n.attrs||typeof n.attrs!=='object'||Array.isArray(n.attrs)||i===0&&(n.parent!==null||n.kind!=='document')||i>0&&(typeof n.parent!=='string'||!seen.has(n.parent))||n.actionRef&&(refs.has(n.actionRef)||!/^e\d+$/.test(n.actionRef)))throw new ObservationError('invalid_observation_graph');
   seen.add(n.id);if(n.actionRef)refs.add(n.actionRef);
  }
  this.prune();const rejected=this.rejected.get(graph.observation);if(rejected&&rejected.session!==session)throw new ObservationError('observation_scope_mismatch');const existing=this.observations.get(graph.observation);if(existing){if(existing.value.session!==session)throw new ObservationError('observation_scope_mismatch');if(JSON.stringify(existing.value.graph)!==JSON.stringify(sanitizeObservation(structuredClone(graph))))throw new ObservationError('observation_id_conflict');return {ok:true,observation:graph.observation,expiresAt:existing.value.expiresAt};}
  const value:StoredObservation={session,graph:sanitizeObservation(structuredClone(graph)),header:cleanStoredJson(header) as Attributes,expiresAt:this.limits.clock()+this.limits.ttlMs};
  const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>this.limits.maxObservationBytes||bytes>this.limits.maxBytes)return this.reject(session,graph.observation,'observation_too_large');
  while(this.observations.size>=this.limits.maxObservations){this.observations.delete(this.observations.keys().next().value!);this.prune();}
  if(!this.room(bytes))return this.reject(session,graph.observation,'observation_store_full');this.rejected.delete(graph.observation);this.observations.set(graph.observation,{value,bytes});return {ok:true,observation:graph.observation,expiresAt:value.expiresAt};
 }
 get(session:string,id:string):StoredObservation{this.prune();const e=this.observations.get(id);if(!e){const rejected=this.rejected.get(id);if(rejected&&rejected.session!==session)throw new ObservationError('observation_scope_mismatch');throw new ObservationError(rejected?.reason??'observation_expired');}if(e.value.session!==session)throw new ObservationError('observation_scope_mismatch');return structuredClone(e.value);}
 latest(session:string):StoredObservation|undefined{this.prune();const item=[...this.observations.values()].reverse().find(e=>e.value.session===session);return item?structuredClone(item.value):undefined;}
 compare(session:string,before:string,after:string,changes:Attributes[],result?:Attributes){
  this.get(session,before);this.get(session,after);const value:StoredComparison={id:'cmp'+randomUUID().replace(/-/g,''),session,before,after,changes:cleanStoredJson(changes) as Attributes[],...(result?{result:cleanStoredJson(result) as Attributes}:{}),expiresAt:this.limits.clock()+this.limits.ttlMs};
  const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>this.limits.maxObservationBytes||bytes>this.limits.maxBytes)throw new ObservationError('comparison_too_large');
  while(this.comparisons.size>=this.limits.maxComparisons)this.comparisons.delete(this.comparisons.keys().next().value!);
  if(!this.room(bytes))throw new ObservationError('comparison_store_full');this.get(session,before);this.get(session,after);this.comparisons.set(value.id,{value,bytes});return structuredClone(value);
 }
 getComparison(session:string,id:string){this.prune();const e=this.comparisons.get(id);if(!e)throw new ObservationError('comparison_expired');if(e.value.session!==session)throw new ObservationError('observation_scope_mismatch');return {...structuredClone(e.value),before:this.get(session,e.value.before),after:this.get(session,e.value.after)};}
 clearSession(session:string){for(const [id,e]of this.observations)if(e.value.session===session)this.observations.delete(id);for(const [id,e]of this.rejected)if(e.session===session)this.rejected.delete(id);this.prune();}
 stats(){this.prune();return {observations:this.observations.size,rejectedObservations:this.rejected.size,comparisons:this.comparisons.size,serializedBytes:this.bytes(),...this.limits,clock:undefined};}
}
