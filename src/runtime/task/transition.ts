import type {Page,ElementHandle,JSHandle} from 'playwright';
import {createHash} from 'node:crypto';
import {referencesFor} from '../references';
import {readTarget} from '../../engine/interact';
import {DEEP_WALK_JS} from '../../engine/page-state';
import {PRIVATE_FIELD_SCRIPT} from '../private-fields';
import {findGoal,type GoalFinding} from './observe';
import type {Expect} from './schema';

const REGION_SCRIPT=`root=>{
 ${DEEP_WALK_JS}
 ${PRIVATE_FIELD_SCRIPT}
 if(!root.isConnected)return {complete:false,attached:false};
 const parts=[];let busy=false,characters=0;
 deepWalk(el=>{if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)||secret(el))return false;
  const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden')return false;
  if(el.getAttribute('aria-busy')==='true')busy=true;
  const text=Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').replace(/\\s+/g,' ').trim();characters+=text.length+String(el.value||'').length;
  if(text.length>2048||characters>64000){walkIssue('region_budget');return false;}
  parts.push([el.localName,el.getAttribute('role'),el.getAttribute('aria-selected'),el.getAttribute('aria-checked'),el.checked,el.value,text]);
 },4000,root);
 return {complete:walkDiagnostics.complete,attached:true,busy,signature:JSON.stringify(parts)};
}`;
async function regionState(handle:ElementHandle){
 const state=await handle.evaluate((root,script)=>eval(`(${script})`)(root),REGION_SCRIPT).catch(()=>({complete:false,attached:false}));
 return {...state,signature:state.signature?createHash('sha256').update(state.signature).digest('hex'):undefined};
}
export interface TransitionBaseline {document:string;introduced?:JSHandle;region?:ElementHandle;signature?:string;valid:boolean;dispose():Promise<void>}
export async function prepareTransition(page:Page,expect?:Expect):Promise<TransitionBaseline>{
 const refs=referencesFor(page),baseline:TransitionBaseline={document:refs.documentIdentity(),valid:true,dispose:async()=>{await Promise.allSettled([baseline.region?.dispose(),baseline.introduced?.dispose()]);}};
 try{
  if(expect?.introduced){const found=await findGoal(page,expect.introduced);baseline.valid=found.ok&&found.coverage?.complete===true;
   const {state}=await refs.snapshotState();baseline.introduced=await state.evaluateHandle((s:any,ids)=>new WeakSet(ids.map(id=>s.targets.get(id)?.deref()).filter(Boolean)),found.candidates.map(c=>c.ref!));
   // The full initial set is needed; truncated output cannot prove introduction.
   if(found.coverage?.truncated)baseline.valid=false;
  }
  if(expect?.changed){const resolved=await refs.resolve(expect.changed.ref);if('ok' in resolved){baseline.valid=false;return baseline;}
   const {state}=await refs.snapshotState(),node=await state.evaluateHandle((s:any,id:string)=>s.targets.get(id)?.deref()??null,expect.changed.ref);const handle=node.asElement();
   if(!handle){await node.dispose();baseline.valid=false;return baseline;}
   baseline.region=handle;const before=await regionState(handle);baseline.signature=before.signature;baseline.valid=baseline.valid&&before.complete&&before.attached;
  }
  return baseline;
 }catch{await baseline.dispose();throw Object.assign(new Error('transition_baseline_unavailable'),{execution:'not_started'});}
}
export async function waitForTransition(page:Page,expect:Expect,baseline:TransitionBaseline,targetRef:string,deadline:number){
 let finding:GoalFinding|undefined,reason='condition_not_observed';let checks=0;
 do{
  checks++;let confirmed=baseline.valid;const iterationDocument=referencesFor(page).documentIdentity();
  if(expect.fields){const resolved=await referencesFor(page).resolve(targetRef);
   if('ok' in resolved){confirmed=false;reason='target_replaced';}else{const state=await readTarget(page,resolved.locator,expect.fields);confirmed=confirmed&&state.matchesExpected===true;}
  }
  if(expect.url){const url=new URL(page.url());confirmed=confirmed&&(expect.url.pathname===undefined||url.pathname===expect.url.pathname)&&(expect.url.includes===undefined||url.href.includes(expect.url.includes));}
  if(expect.changed){const state=baseline.region?await regionState(baseline.region):undefined;
   const changed=state?.attached&&state.complete&&!state.busy&&state.signature!==baseline.signature;
   confirmed=confirmed&&!!changed;if(!state?.attached)reason='scope_replaced';
  }
  for(const goal of [expect.goal,expect.introduced])if(goal){const observed=await findGoal(page,goal);finding=observed;confirmed=confirmed&&observed.status==='unique';
   if(goal===expect.introduced){let introduced=baseline.document!==observed.document;
    if(!introduced&&baseline.introduced){const {state}=await referencesFor(page).snapshotState();introduced=await page.evaluate(({state,before,ids})=>ids.some(id=>{const node=(state as any).targets.get(id)?.deref();return !!node&&!(before as WeakSet<Element>).has(node);}),{state,before:baseline.introduced,ids:observed.candidates.map(c=>c.ref!)});}
    confirmed=confirmed&&introduced;
   }
  }
  if(iterationDocument!==referencesFor(page).documentIdentity()){confirmed=false;reason='document_changed_during_verification';}
  if(confirmed)return {status:'confirmed' as const,checks,...(finding?{finding}:{})};
  if(Date.now()>=deadline)break;
  await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(0,deadline-Date.now()))));
 }while(Date.now()<=deadline);
 return {status:'unconfirmed' as const,reason,checks,...(finding?{finding}:{})};
}
