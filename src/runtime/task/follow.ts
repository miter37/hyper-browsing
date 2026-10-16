import type {Page,JSHandle,ElementHandle} from 'playwright';
import {referencesFor} from '../references';
import {findGoal,type GoalFinding} from './observe';
import {parseFollowGoal} from './schema';
import {REGION_GUARD} from '../observation/scoping';
import {DEEP_WALK_JS} from '../../engine/page-state';

export interface FollowBaseline {signature?:string;document?:string;linked?:JSHandle;origin?:JSHandle;dispose():Promise<void>}
const signature=(f:GoalFinding)=>JSON.stringify([f.document,f.scope,f.coverage?.complete,f.candidates]);
/** Capture only the requested facts and explicit HTML/ARIA connection, never infer UI intent. */
export async function prepareFollow(page:Page,input:unknown,ref?:string):Promise<FollowBaseline>{
 const goal=parseFollowGoal(input),baseline:FollowBaseline={document:referencesFor(page).documentIdentity(),dispose:async()=>{await baseline.linked?.dispose().catch(()=>{});await baseline.origin?.dispose().catch(()=>{});}};
 try{
  if(goal.scope==='origin'){
   if(!ref)return baseline;
   const resolved=await referencesFor(page).resolve(ref);if(!('locator' in resolved))return baseline;
   const {state}=await referencesFor(page).snapshotState();
   baseline.origin=await state.evaluateHandle((s:any,{ref,script})=>eval(script)(s,ref),{ref,script:`(s,ref)=>{
    ${DEEP_WALK_JS}
    const parent=n=>n.parentElement||n.getRootNode()?.host;
    const owner=node=>{if(node?.form)return node.form;for(let n=node;n;n=parent(n))if(n.matches('form,[role=form]'))return n;};
    const target=s.targets.get(ref)?.deref();let root=owner(target);
    if(!root){
     const ancestors=[];for(let n=target;n&&n!==document.body;n=parent(n))ancestors.push(n);
     const forms=new Set();deepWalk(el=>{
      if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName))return false;
      const linked=(el.getAttribute('aria-controls')||'').split(/\\s+/).filter(Boolean).map(id=>el.getRootNode().getElementById?.(id));if(el.popoverTargetElement)linked.push(el.popoverTargetElement);
      if(linked.some(n=>ancestors.includes(n))){const form=owner(el);if(form)forms.add(form);}
     },4000);
     if(!walkDiagnostics.complete||forms.size>1)return null;
     if(forms.size===1)root=[...forms][0];
    }
    if(!root)for(let n=target?parent(target):null;n&&n!==document.body&&!root;n=parent(n))if(n.matches('dialog,[role=dialog],[role=menu],[role=listbox],fieldset,[role=group],section'))root=n;
    return root?{ref:new WeakRef(root),guard:(${REGION_GUARD})(root)}:null;
   }`});
   return baseline;
  }
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
 const goal=parseFollowGoal(input);
 let last:GoalFinding;let linked=false;
 for(;;){
  linked=false;
  let selection:JSHandle|undefined,root:ElementHandle|undefined,blocked=false;
  try{
   await referencesFor(page).settleNavigation();
   if(goal.scope==='origin'){
    if(baseline.origin&&baseline.document===referencesFor(page).documentIdentity()){
     const h=await baseline.origin.evaluateHandle((before:any,guard)=>{const root=before?.ref?.deref();return root?.isConnected&&eval('('+guard+')')(root)===before.guard?root:null;},REGION_GUARD);
     root=h.asElement()??undefined;if(!root)await h.dispose();
    }
    if(!root)return {ok:true,kind:'goal',status:'incomplete',reason:'origin_region_stale',candidates:[],coverage:{complete:false,matched:0,shown:0,truncated:false},readiness:{status:'not_ready',basis:'origin-region'}};
   }
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
   last=blocked?{ok:true,kind:'goal',status:'not_found',reason:'linked_region_not_ready',scope:{kind:'linked-region'},coverage:{complete:false,matched:0,shown:0,truncated:false},candidates:[]}:await findGoal(page,goal.scope==='origin'?{...goal,scope:'document'}:goal,root);
  }finally{await root?.dispose();await selection?.dispose();}
  const ready=!blocked&&last.ok&&last.coverage?.complete===true&&last.candidates.length>0;
  if(ready){last.readiness={status:!linked&&baseline.signature===signature(last)?'unchanged':'ready',basis:goal.scope==='origin'?'origin-region':linked?'linked-region':'requested-goal'};return last;}
  // Incomplete collection and invalid scopes need agent judgment, not repeated scans.
  if(Date.now()>=deadline||!blocked&&(!last.ok||last.status==='incomplete')){
   last.readiness={status:'not_ready',basis:goal.scope==='origin'?'origin-region':linked?'linked-region':'requested-goal'};return last;
  }
  await new Promise(r=>setTimeout(r,Math.min(100,Math.max(0,deadline-Date.now()))));
 }
}
