import type {Page,ElementHandle} from 'playwright';
import {captureSnapshot,type SnapshotElement} from '../snapshot';
import {referencesFor} from '../references';
import {cleanStoredJson} from '../hwm/store';
import {parseGoal} from './schema';
import {inspectPageState} from '../../engine/page-state';

export interface GoalFinding {
 ok:boolean;kind:'goal';status?:'unique'|'ambiguous'|'not_found'|'incomplete';reason?:string;
 document?:string;capturedAt?:string;url?:string;scope?:any;
 urlPreview?:string;urlTruncated?:boolean;
 pageState?:any;
 readiness?:{status:'ready'|'unchanged'|'not_ready';basis:'requested-goal'|'linked-region'};
 coverage?:{complete:boolean;matched:number;shown:number;truncated:boolean};candidates:SnapshotElement[];
}
/** Uses the same collector, naming and guarded references as ordinary HB observations. */
export async function findGoal(page:Page,input:unknown,within?:ElementHandle):Promise<GoalFinding>{
 const goal=parseGoal(input),references=referencesFor(page);let root:ElementHandle|undefined;
 try{
  if(within)root=(await within.evaluateHandle(el=>el)).asElement()??undefined;
  else if(typeof goal.scope==='object'){
   const resolved=await references.resolve(goal.scope.ref);if('ok' in resolved)return {ok:false,kind:'goal',reason:resolved.reason,candidates:[]};
   const state=await references.snapshotState(),handle=await state.state.evaluateHandle((s:any,id:string)=>s.targets.get(id)?.deref()??null,goal.scope.ref);
   root=handle.asElement()??undefined;if(!root){await handle.dispose();return {ok:false,kind:'goal',reason:'stale_ref',candidates:[]};}
  }
  const snapshot=await captureSnapshot(page,{root,goal,limit:goal.limit,maxVisits:goal.maxVisits,context:false,lightweight:true,waitMs:0,controlOffset:0});
  const complete=snapshot.observation?.complete===true&&snapshot.collectionTiming?.documentChanged!==true;
  const matched=snapshot.controlPage?.total??snapshot.elements.length;
  const pageState=matched===0?await inspectPageState(page,snapshot.observation,0):undefined;
  const result=cleanStoredJson({ok:true,kind:'goal',status:!complete?'incomplete':matched===0?'not_found':matched===1?'unique':'ambiguous',document:snapshot.collectionTiming?.document,capturedAt:snapshot.capturedAt,url:snapshot.url,
   ...(pageState?{pageState}:{}),scope:{...snapshot.goalScope,tree:'main-document-and-open-shadow'},coverage:{complete,matched,shown:snapshot.elements.length,truncated:!!snapshot.truncated},candidates:snapshot.elements} as any) as unknown as GoalFinding;
  while(Buffer.byteLength(JSON.stringify(result))>goal.byteBudget&&result.candidates.length){
   result.candidates.pop();result.coverage!.shown=result.candidates.length;result.coverage!.truncated=true;
   if(matched&&!result.candidates.length){result.status='incomplete';result.reason='response_budget';}
  }
  if(Buffer.byteLength(JSON.stringify(result))>goal.byteBudget&&result.url){result.urlPreview=result.url.slice(0,256);result.urlTruncated=true;delete result.url;}
  if(Buffer.byteLength(JSON.stringify(result))>goal.byteBudget&&result.pageState)result.pageState={state:result.pageState.state,detailTruncated:true};
  return result;
 }finally{await root?.dispose();}
}

/** Wait only for the next target to become available. Never retries an action or resolves ambiguity. */
export async function findReadyGoal(page:Page,input:unknown,deadline:number,onUnexpected?:()=>Promise<boolean>):Promise<GoalFinding>{
 const started=Date.now();
 for(;;){
  const found=await findGoal(page,input);
  const absent=found.ok&&found.status==='not_found'&&found.coverage?.complete===true;
  const disabled=found.status==='unique'&&found.candidates[0]?.disabled===true;
  if(!absent&&!disabled||Date.now()>=deadline)return found;
  if(absent&&Date.now()-started>=250&&onUnexpected&&await onUnexpected())return {...found,reason:'new_linked_region'};
  await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(0,deadline-Date.now()))));
 }
}
