import {randomBytes} from 'node:crypto';
import type {Page} from 'playwright';
import {observationError,type DeliveryOptions} from './delivery';

export interface Continuation extends DeliveryOptions {map:string;panel?:string;target?:string;item?:number}
interface Entry {page:Page;session:string;document:string;value:Continuation;expires:number;bytes:number}
/** Explicit acknowledgement of a returned response, never a tab-global "last response". */
export class Continuations {
 private entries=new Map<string,Entry>();
 constructor(private clock=Date.now,private ttl=300000){}
 private prune(){for(const [id,e]of this.entries)if(e.expires<=this.clock()||e.page.isClosed())this.entries.delete(id);}
 issue(page:Page,session:string,document:string,value:Continuation){
  this.prune();const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>1024*1024)throw observationError('continuation_too_large');
  while(this.entries.size>=256||[...this.entries.values()].reduce((n,e)=>n+e.bytes,0)+bytes>1024*1024)this.entries.delete(this.entries.keys().next().value!);
  const id='F'+randomBytes(6).toString('hex');this.entries.set(id,{page,session,document,value:{...value},expires:this.clock()+this.ttl,bytes});return id;
 }
 resolve(page:Page,session:string,document:string,id:string){
  this.prune();const e=this.entries.get(id);if(!e)throw observationError('continuation_expired');
  if(e.page!==page||e.session!==session||e.document!==document)throw observationError('continuation_scope_mismatch');return {...e.value};
 }
 clearSession(session:string){for(const [id,e]of this.entries)if(e.session===session)this.entries.delete(id);}
 clear(){this.entries.clear();}
}
