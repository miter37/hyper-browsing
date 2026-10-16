import type {Page,JSHandle,ElementHandle} from 'playwright';
import {referencesFor} from '../references';
import {findGoal,type GoalFinding} from './observe';
import {parseGoal} from './schema';

export interface FollowBaseline {signature?:string;document?:string;linked?:JSHandle;dispose():Promise<void>}
const signature=(f:GoalFinding)=>JSON.stringify([f.document,f.scope,f.coverage?.complete,f.candidates]);
/** Capture only the requested facts and explicit HTML/ARIA connection, never infer UI intent. */
export async function prepareFollow(page:Page,input:unknown,ref?:string):Promise<FollowBaseline>{
 const goal=parseGoal(input),baseline:FollowBaseline={dispose:async()=>{await baseline.linked?.dispose().catch(()=>{});}};
 try{
  const before=await findGoal(page,goal);baseline.document=before.document;if(before.ok&&before.coverage?.complete)baseline.signature=signature(before);
  if(ref&&goal.scope==='active'){
   const {state}=await referencesFor(page).snapshotState();
   baseline.linked=await state.evaluateHandle((s:any,id:string)=>{const node=s.targets.get(id)?.deref();return node?{target:new WeakRef(node),document,tree:node.getRootNode(),ids:(node.getAttribute('aria-controls')||'').split(/\s+/).filter(Boolean),popover:node.popoverTargetElement?new WeakRef(node.popoverTargetElement):null}:null;},ref);
  }
  return baseline;
 }catch{await baseline.dispose();return {dispose:async()=>{}};}
}

/** Read-only readiness: an absent result or closed linked popup may wait, a mutation never retries. */
export async function observeFollow(page:Page,input:unknown,baseline:FollowBaseline,deadline:number):Promise<GoalFinding>{
 let last:GoalFinding;let linked=false;
 for(;;){
  linked=false;
  let selection:JSHandle|undefined,root:ElementHandle|undefined,blocked=false;
  try{
   await referencesFor(page).settleNavigation();
   if(baseline.linked&&baseline.document===referencesFor(page).documentIdentity()){
    selection=await baseline.linked.evaluateHandle((before:any)=>{
     const target=before?.target?.deref();if(before?.document!==document)return {declared:false};
     const live=target?.isConnected,ids=live?(target.getAttribute('aria-controls')||'').split(/\s+/).filter(Boolean):before.ids;
     const tree=live?target.getRootNode():before.tree,popover=live?target.popoverTargetElement:before.popover?.deref();
     if(!ids.length&&!popover&&!before.ids.length&&!before.popover)return {declared:false};
     const roots=[...new Set([...ids.map((id:string)=>tree.getElementById?.(id)),...(popover?[popover]:[])])];
     const visible=roots.filter((el:any)=>{if(!el?.isConnected)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';});
     const root=visible.length===1?visible[0]:null;
     const busy=root&&(root.getAttribute('aria-busy')==='true'||Array.from(root.querySelectorAll('[aria-busy=true],[role=progressbar]')).some((el:any)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}));
     return {declared:true,root:root&&!busy?root:null};
    });
    if(selection){linked=await selection.evaluate((s:any)=>s.declared);if(linked){const h=await selection.getProperty('root');root=h.asElement()??undefined;if(!root)await h.dispose();blocked=!root;}}
   }
   last=blocked?{ok:true,kind:'goal',status:'not_found',reason:'linked_region_not_ready',scope:{kind:'linked-region'},coverage:{complete:false,matched:0,shown:0,truncated:false},candidates:[]}:await findGoal(page,input,root);
  }finally{await root?.dispose();await selection?.dispose();}
  const ready=!blocked&&last.ok&&last.coverage?.complete===true&&last.candidates.length>0;
  if(ready){last.readiness={status:!linked&&baseline.signature===signature(last)?'unchanged':'ready',basis:linked?'linked-region':'requested-goal'};return last;}
  // Incomplete collection and invalid scopes need agent judgment, not repeated scans.
  if(Date.now()>=deadline||!blocked&&(!last.ok||last.status==='incomplete')){
   last.readiness={status:'not_ready',basis:linked?'linked-region':'requested-goal'};return last;
  }
  await new Promise(r=>setTimeout(r,Math.min(100,Math.max(0,deadline-Date.now()))));
 }
}
