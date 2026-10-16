import type {Page} from 'playwright';
import {executePrimitive,type PrimitiveParams} from '../../engine/execute';
import type {ActionKind} from '../../engine/interact';
import {referencesFor} from '../references';
import {paceBeforeTarget} from '../../engine/input-pacing';
import {prepareFollow,observeFollow} from './follow';
import {findGoal,findReadyGoal,type GoalFinding} from './observe';
import {parseTask,parseFollow} from './schema';
import {prepareTransition,waitForTransition} from './transition';
import {actionEvidence,taskResult} from './result';
import {prepareRecovery,observeRecovery,hasNewLinkedRegion,type RecoveryBaseline} from './recovery';

interface Runtime {requestId?:string;execute?:(page:Page,kind:ActionKind,params:PrimitiveParams)=>Promise<Record<string,any>>}
/** No RPC re-entry, no semantic guessing, no retries of mutations. */
export async function runTask(page:Page,input:unknown,runtime:Runtime={}){
 const task=parseTask(input),started=Date.now(),deadline=started+task.timeoutMs,steps:any[]=[];let lastFinding:GoalFinding|undefined;
 const execute=runtime.execute??executePrimitive;let recoveryBaseline:RecoveryBaseline|undefined;
 const finish=async(reason?:string,extra:Record<string,any>={})=>taskResult({ok:!reason,kind:'task',execution:steps.some(s=>s.action?.execution==='outcome_unknown')?'outcome_unknown':!reason?'completed':steps.some(s=>s.action?.execution==='completed')?'partial':'not_started',
  ...(reason?{reason}:{}),steps,remaining:task.steps.length-steps.length,...(lastFinding?{finding:lastFinding}:{}),...extra,
  ...(reason&&(steps.length||['target_not_found','target_incomplete'].includes(reason))?{recovery:await observeRecovery(page,recoveryBaseline)}:{}),durationMs:Date.now()-started});
 try{
 for(const step of task.steps){
  if(Date.now()>=deadline)return await finish('task_budget');
  const inputPacing=await paceBeforeTarget();
  if(Date.now()>=deadline)return await finish('task_budget');
  let ref:string;
  if('ref' in step.target)ref=step.target.ref;
  else{let found;try{found=await findReadyGoal(page,step.target,steps.length?Math.min(deadline,Date.now()+task.waitMs):Date.now(),()=>hasNewLinkedRegion(page,recoveryBaseline));}catch{return await finish('target_observation_failed');}if(found.status!=='unique'||found.candidates[0]?.actionable!==true||found.candidates[0]?.disabled===true)return await finish('target_'+(found.candidates[0]?.disabled?'disabled':found.reason??found.status),{finding:found,...(found.pageState?{pageState:found.pageState}:{})});ref=found.candidates[0].ref!;}
  const metadata=referencesFor(page).metadata(ref);if(metadata?.actionable===false)return await finish('target_not_actionable');
  let baseline;try{baseline=await prepareTransition(page,step.expect);}catch{return await finish('baseline_unavailable');}
  const followBaseline=step.follow&&step===task.steps.at(-1)?await prepareFollow(page,step.follow,ref):undefined;
  try{
   if(!baseline.valid)return await finish('baseline_incomplete');
   if(Date.now()>=deadline)return await finish('task_budget');
   await recoveryBaseline?.dispose();recoveryBaseline=await prepareRecovery(page,ref);
   let action;try{action=await execute(page,step.action.op,{ref,value:step.action.value,key:step.action.key,option:step.action.option,submit:step.action.submit,confirmed:step.action.confirmed,goalDriven:true,localContext:step===task.steps.at(-1)&&!step.follow,inputPacing,deadline,targetStates:'ref' in step.target?undefined:step.target.states,timeoutMs:Math.max(1,Math.min(5000,deadline-Date.now()))});}
   catch{action={ok:false,execution:'outcome_unknown',reason:'execution_exception'};}
   const record:any={id:step.id,...(runtime.requestId?{requestId:runtime.requestId,stepId:runtime.requestId+':'+step.id}:{}),ref,action:actionEvidence(action)};steps.push(record);
   lastFinding=undefined;
   if(action.execution!=='completed'||action.ok!==true){
    let finding;if(step.follow)try{finding=await findGoal(page,step.follow);}catch{/* Preserve original action outcome. */}
    return await finish(action.confirmationRequired?'confirmation_required':action.reason??'action_not_completed',{...(finding?{finding}:{}),...(action.effect?.pageState?{pageState:action.effect.pageState}:{})});
   }
   if(action.effect?.newSessions?.length)return await finish('new_context_requires_selection');
   if(step.expect){try{const {finding,...verification}=await waitForTransition(page,step.expect,baseline,ref,Math.min(deadline,Date.now()+task.waitMs),()=>hasNewLinkedRegion(page,recoveryBaseline));record.verification=verification;lastFinding=finding;}catch{record.verification={status:'unconfirmed',reason:'observation_failed'};}
    if(record.verification.status!=='confirmed')return await finish('postcondition_unconfirmed');
   }
   if(step.follow){try{lastFinding=followBaseline?await observeFollow(page,step.follow,followBaseline,Math.min(deadline,Date.now()+task.waitMs)):await findGoal(page,step.follow);}catch{return await finish('follow_observation_failed');}
    if(lastFinding.readiness?.status==='not_ready')return await finish(undefined,{recovery:await observeRecovery(page,recoveryBaseline)});
   }
  }finally{await followBaseline?.dispose();await baseline.dispose().catch(()=>{});}
 }
 return await finish();
 }finally{await recoveryBaseline?.dispose();}
}
/** Same transition contract for a single existing command; validate before invoking it. */
export async function executeWithFollow(page:Page,params:PrimitiveParams,input:unknown,execute:()=>Promise<Record<string,any>>){
 const follow=parseFollow(input);
 if(follow.expect?.fields&&!params.ref)throw Object.assign(new Error('field_verification_requires_ref'),{execution:'not_started'});
 const baseline=await prepareTransition(page,follow.expect);
 const followBaseline=follow.follow?await prepareFollow(page,follow.follow,params.ref):undefined;
 let recoveryBaseline:RecoveryBaseline|undefined;
 try{
  if(!baseline.valid)return {ok:false,execution:'not_started',reason:'baseline_incomplete'};
  recoveryBaseline=await prepareRecovery(page,params.ref);
  const action=await execute();let verification,finding,observationError;
  try{
   if(action.ok===true&&action.execution==='completed'&&follow.expect){const observed=await waitForTransition(page,follow.expect,baseline,params.ref??'',Date.now()+follow.waitMs,()=>hasNewLinkedRegion(page,recoveryBaseline));const {finding:verifiedFinding,...status}=observed;verification=status;finding=verifiedFinding;}
   if(follow.follow&&!(verification?.status==='unconfirmed'&&verification.reason==='new_linked_region'))finding=action.ok===true&&action.execution==='completed'&&verification?.status!=='unconfirmed'&&followBaseline?await observeFollow(page,follow.follow,followBaseline,Date.now()+follow.waitMs):await findGoal(page,follow.follow);
  }catch{observationError='follow_observation_failed';}
  const stalled=action.ok!==true||action.execution!=='completed'||verification?.status==='unconfirmed'||observationError||follow.follow&&['not_found','incomplete'].includes(finding?.status??'');
  return taskResult({...action,...(verification?{verification}:{}),...(finding?{finding}:{}),...(observationError?{observationError}:{}),...(stalled?{recovery:await observeRecovery(page,recoveryBaseline)}:{})});
 }finally{await followBaseline?.dispose();await baseline.dispose();await recoveryBaseline?.dispose();}
}
