import type {Page,ElementHandle} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {referencesFor} from '../references';
import {captureSnapshot} from '../snapshot';

export interface LookupOptions {goalId?:string;visualReviewed?:string}
interface State {page:Page;session:string;document:string;navigation:number;misses:number;expires:number;ambiguities?:Set<string>;pending?:Promise<any>}
/** Query wording and scope changes are retries, not evidence of task progress. Never retries a mutation. */
export class VisualRetry {
 private states=new Map<string,State>();
 constructor(private directory=path.join(os.tmpdir(),'hyper-browsing-visual'),private clock=Date.now){}
 private state(page:Page,session:string,options:LookupOptions={}){
  if(options.goalId!==undefined&&!/^[\w-]{1,64}$/.test(options.goalId))throw Object.assign(new Error('invalid_goal_id'),{execution:'not_started'});
  for(const [key,s]of this.states)if(s.expires<=this.clock()||s.page.isClosed())this.states.delete(key);
  const refs=referencesFor(page),key=JSON.stringify([session,options.goalId??'current-step']);let state=this.states.get(key);
  if(!state||state.page!==page||state.document!==refs.documentIdentity()||state.navigation!==refs.navigationRevision()){
   while(this.states.size>=64)this.states.delete(this.states.keys().next().value!);
   state={page,session,document:refs.documentIdentity(),navigation:refs.navigationRevision(),misses:0,expires:this.clock()+300000};this.states.set(key,state);
  }
  return state;
 }
 async before(page:Page,session:string,options:LookupOptions={}){
  await referencesFor(page).settleNavigation();const state=this.state(page,session,options);
  if(!state.pending)return undefined;
  const visual=await state.pending;
  // This is a consumer acknowledgement, not proof that an external model actually viewed the file.
  if(options.visualReviewed===visual.id){state.pending=undefined;state.misses=0;return undefined;}
  return {ok:false,kind:'visual-fallback',execution:'not_started',reason:'visual_review_required',retry:{misses:state.misses,remaining:0},visual};
 }
 async result(page:Page,session:string,result:any,options:LookupOptions={},scopeRef?:string|ElementHandle,uniqueTarget=true){
  if(result.kind==='goal'&&result.status==='ambiguous'&&uniqueTarget&&!result.known&&result.candidates?.length){
   const state=this.state(page,session,options);
   // Compare evidence, not query wording or match terms. A new choice set is useful input for the LLM.
   const evidence=result.candidates.map((c:any)=>JSON.stringify(Object.fromEntries(['ref','tag','role','name','text','value','checked','selected','disabled','owner','local','viewportBox'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]])))).sort();
   const key=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
   state.ambiguities??=new Set();
   if(!state.ambiguities.has(key)){if(state.ambiguities.size>=8)state.ambiguities.delete(state.ambiguities.values().next().value!);state.ambiguities.add(key);return result;}
   // The same choices were already delivered: one relookup has not advanced the step.
   state.misses=Math.max(1,state.misses);
  }
  const missed=result.kind==='goal'?(['not_found','incomplete'].includes(result.status)||uniqueTarget&&result.status==='ambiguous')&&!result.known:Array.isArray(result.data)&&!result.data.length&&!result.known;
  if(!missed)return result;
  const state=this.state(page,session,options);state.misses++;state.expires=this.clock()+300000;
  if(state.misses>=2&&!state.pending)state.pending=this.capture(page,state,scopeRef);
  return {...result,retry:{misses:state.misses,remaining:Math.max(0,2-state.misses)},...(state.pending?{visual:await state.pending}:{next:'Adjust the scope, role or query once; another miss switches to screenshot.'})};
 }
 progress(page:Page,session:string,result:any){
  const actions=result.steps?.map((s:any)=>s.action)??[result];
  if(actions.some((a:any)=>a?.execution==='completed'&&a?.effect?.observed===true))for(const [key,s]of this.states)if(s.page===page&&s.session===session)this.states.delete(key);
 }
 private async capture(page:Page,state:State,scopeRef?:string|ElementHandle){
  const id='V'+randomBytes(8).toString('hex'),file=path.join(this.directory,id+'.png');let clip:any,root:ElementHandle|undefined,ownsRoot=false;
  try{
   if(scopeRef){const resolved=typeof scopeRef==='string'?await referencesFor(page).resolve(scopeRef):{locator:scopeRef};if('locator'in resolved){
    if(typeof scopeRef==='string'){
     const references=await referencesFor(page).snapshotState(),handle=await references.state.evaluateHandle((s:any,id:string)=>s.targets.get(id)?.deref()??null,scopeRef);
     root=handle.asElement()??undefined;ownsRoot=!!root;if(!root)await handle.dispose();
    }else root=scopeRef;
    if(root)clip=await root.evaluate((el:Element)=>{const r=el.getBoundingClientRect(),x=Math.max(0,r.x),y=Math.max(0,r.y),width=Math.min(innerWidth,r.right)-x,height=Math.min(innerHeight,r.bottom)-y;return width>=80&&height>=80?{x,y,width,height}:undefined;});
   }}
   await fs.mkdir(this.directory,{recursive:true});await page.screenshot({path:file,...(clip?{clip}:{}),timeout:3000});
   let affordances:any={};
   try{
    const snap=await captureSnapshot(page,{root,context:false,lightweight:true,controlsOnly:true,viewportOnly:true,localContext:true,controlOffset:0,limit:8,maxVisits:2500,waitMs:0});
    const controls:any[]=[];let bytes=2;
    for(const e of snap.elements){const c=Object.fromEntries(Object.entries(e).filter(([k])=>['ref','tag','role','name','value','checked','selected','disabled','interaction','owner'].includes(k)));const size=Buffer.byteLength(JSON.stringify(c))+1;if(bytes+size>1800)break;controls.push(c);bytes+=size;}
    affordances={controls,controlsCoverage:{complete:snap.observation?.complete===true&&!snap.truncated&&controls.length===snap.elements.length,observed:snap.controlPage?.total??snap.elements.length,shown:controls.length},controlsCapturedAt:snap.capturedAt};
   }catch{affordances={controlsCoverage:{complete:false,reason:'capture_unavailable'}};}
   await referencesFor(page).settleNavigation();
   if(state.document!==referencesFor(page).documentIdentity()||state.navigation!==referencesFor(page).navigationRevision())return {id,status:'unavailable',reason:'page_changed_during_screenshot',mustRead:true};
   return {id,status:'captured',file,scope:clip?'requested-region':'viewport',...(clip?{clip}:{}),...affordances,mustRead:true,next:'Open this file with view_image (or the host image tool). A file path is not a viewed image. Match visual.controls to the image and use the observed ref when sufficient. Otherwise use --visual-reviewed '+id+' for one scoped lookup.'};
  }catch{return {id,status:'unavailable',reason:'screenshot_failed',mustRead:true,next:'Capture and open a manual screenshot; after image review acknowledge this ID with --visual-reviewed '+id+'. Do not continue blind text retries.'};}
  finally{if(ownsRoot)await root?.dispose().catch(()=>{});}
 }
 clearSession(session:string){for(const[key,s]of this.states)if(s.session===session)this.states.delete(key);}
 clear(){this.states.clear();}
}
