import {randomBytes,createHash} from 'node:crypto';
export interface Unit {key:string;data:Record<string,any>;collected?:string[]}
export interface DeliveryOptions {since?:string;consumer?:string;repeat?:boolean}
interface Receipt {session:string;document:string;consumer:string;expires:number;fields:Map<string,string>;bytes:number}
export const observationError=(code:string)=>Object.assign(new Error(code),{code,execution:'not_started'});
/** Only final public fields are recorded. No baseline is inferred from a browser tab. */
export class DeliveryLedger {
 private receipts=new Map<string,Receipt>();
 constructor(private ttlMs=300000,private clock=Date.now){}
 private prune(){for(const [id,r]of this.receipts)if(r.expires<=this.clock())this.receipts.delete(id);}
 validate(session:string,document:string,options:DeliveryOptions={}){
  this.prune();const prior=options.since?this.receipts.get(options.since):undefined;
  if(options.since&&!prior)throw observationError('delivery_expired');
  if(prior&&(prior.session!==session||prior.document!==document||options.consumer&&options.consumer!==prior.consumer))throw observationError('delivery_scope_mismatch');
 }
 publish(session:string,document:string,units:Unit[],options:DeliveryOptions={}){
  this.prune();const prior=options.since?this.receipts.get(options.since):undefined;
  if(options.since&&!prior)throw observationError('delivery_expired');
  if(prior&&(prior.session!==session||prior.document!==document||options.consumer&&options.consumer!==prior.consumer))throw observationError('delivery_scope_mismatch');
  const consumer=options.consumer??prior?.consumer??'C'+randomBytes(6).toString('hex'),fields=new Map(prior?.fields),data:Record<string,any>[]=[];let known=0;
  for(const unit of units){const changed:Record<string,any>={id:unit.data.id};let added=false;
   for(const field of unit.collected??[])if(unit.data[field]===undefined&&fields.has(unit.key+'|'+field)){
    (changed.unavailableFields??=[]).push(field);fields.delete(unit.key+'|'+field);added=true;
   }
   for(const [field,value]of Object.entries(unit.data)){if(field==='id'||value===undefined)continue;const key=unit.key+'|'+field,hash=createHash('sha256').update(JSON.stringify(value)).digest('hex');
    if(options.repeat||fields.get(key)!==hash){changed[field]=value;added=true;}fields.set(key,hash);
   }if(added)data.push(changed);else known++;
  }
  const bytes=Buffer.byteLength(JSON.stringify([...fields]));if(bytes>1024*1024)throw observationError('delivery_too_large');
  while(this.receipts.size>=64||[...this.receipts.values()].reduce((s,r)=>s+r.bytes,0)+bytes>1024*1024)this.receipts.delete(this.receipts.keys().next().value!);
  const delivery='D'+randomBytes(8).toString('hex');this.receipts.set(delivery,{session,document,consumer,fields,expires:this.clock()+this.ttlMs,bytes});return {delivery,consumer,data,...(known?{known}:{})};
 }
 clearSession(session:string){for(const [id,r]of this.receipts)if(r.session===session)this.receipts.delete(id);}
 clear(){this.receipts.clear();}
}
