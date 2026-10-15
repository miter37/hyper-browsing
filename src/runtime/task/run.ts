import type {Page} from 'playwright';
import {executePrimitive,type PrimitiveParams} from '../../engine/execute';
import type {ActionKind} from '../../engine/interact';
import {referencesFor} from '../references';
import {findGoal,type GoalFinding} from './observe';
import {parseTask,parseFollow} from './schema';
import {prepareTransition,waitForTransition} from './transition';
import {actionEvidence,taskResult} from './result';

interface Runtime {requestId?:string;execute?:(page:Page,kind:ActionKind,params:PrimitiveParams)=>Promise<Record<string,any>>}
/** No RPC re-entry, no semantic guessing, no retries of mutations. */
export async function runTask(page:Page,input:unknown,runtime:Runtime={}){
 const task=parseTask(input),started=Date.now(),deadline=started+task.timeoutMs,steps:any[]=[];let lastFinding:GoalFinding|undefined;
 const execute=runtime.execute??executePrimitive;
 const finish=(reason?:string,extra:Record<string,any>={})=>taskResult({ok:!reason,kind:'task',execution:steps.some(s=>s.action?.execution==='outcome_unknown')?'outcome_unknown':!reason?'completed':steps.some(s=>s.action?.execution==='completed')?'partial':'not_started',
  ...(reason?{reason}:{}),steps,remaining:task.steps.length-steps.length,durationMs:Date.now()-started,...(lastFinding?{finding:lastFinding}:{}),...extra});
 for(const step of task.steps){
  if(Date.now()>=deadline)return finish('task_budget');
  let ref:string;
  if('ref' in step.target)ref=step.target.ref;
  else{let found;try{found=await findGoal(page,step.target);}catch{return finish('target_observation_failed');}if(found.status!=='unique'||found.candidates[0]?.actionable!==true)return finish('target_'+(found.status??found.reason),{finding:found,...(found.pageState?{pageState:found.pageState}:{})});ref=found.candidates[0].ref!;}
  const metadata=referencesFor(page).metadata(ref);if(metadata?.actionable===false)return finish('target_not_actionable');
  let baseline;try{baseline=await prepareTransition(page,step.expect);}catch{return finish('baseline_unavailable');}
  try{
   if(!baseline.valid)return finish('baseline_incomplete');
   if(Date.now()>=deadline)return finish('task_budget');
   let action;try{action=await execute(page,step.action.op,{ref,value:step.action.value,key:step.action.key,option:step.action.option,confirmed:step.action.confirmed,goalDriven:true,deadline,targetStates:'ref' in step.target?undefined:step.target.states,timeoutMs:Math.max(1,Math.min(5000,deadline-Date.now()))});}
   catch{action={ok:false,execution:'outcome_unknown',reason:'execution_exception'};}
   const record:any={id:step.id,...(runtime.requestId?{requestId:runtime.requestId,stepId:runtime.requestId+':'+step.id}:{}),ref,action:actionEvidence(action)};steps.push(record);
   lastFinding=undefined;
   if(action.execution!=='completed'||action.ok!==true){
    let finding;if(step.follow)try{finding=await findGoal(page,step.follow);}catch{/* Preserve original action outcome. */}
    return finish(action.confirmationRequired?'confirmation_required':action.reason??'action_not_completed',{...(finding?{finding}:{}),...(action.effect?.pageState?{pageState:action.effect.pageState}:{})});
   }
   if(action.effect?.newSessions?.length)return finish('new_context_requires_selection');
   if(step.expect){try{const {finding,...verification}=await waitForTransition(page,step.expect,baseline,ref,Math.min(deadline,Date.now()+task.waitMs));record.verification=verification;lastFinding=finding;}catch{record.verification={status:'unconfirmed',reason:'observation_failed'};}
    if(record.verification.status!=='confirmed')return finish('postcondition_unconfirmed');
   }else if(steps.length<task.steps.length)return finish('verification_required');
   if(step.follow){try{lastFinding=await findGoal(page,step.follow);}catch{return finish('follow_observation_failed');}if(steps.length<task.steps.length&&lastFinding.status!=='unique')return finish('follow_'+(lastFinding.status??lastFinding.reason));}
  }finally{await baseline.dispose().catch(()=>{});}
 }
 return finish();
}
/** Same transition contract for a single existing command; validate before invoking it. */
export async function executeWithFollow(page:Page,params:PrimitiveParams,input:unknown,execute:()=>Promise<Record<string,any>>){
 const follow=parseFollow(input);
 if(follow.expect?.fields&&!params.ref)throw Object.assign(new Error('field_verification_requires_ref'),{execution:'not_started'});
 const baseline=await prepareTransition(page,follow.expect);
 try{
  if(!baseline.valid)return {ok:false,execution:'not_started',reason:'baseline_incomplete'};
  const action=await execute();let verification,finding,observationError;
  try{
   if(action.ok===true&&action.execution==='completed'&&follow.expect){const observed=await waitForTransition(page,follow.expect,baseline,params.ref??'',Date.now()+follow.waitMs);const {finding:verifiedFinding,...status}=observed;verification=status;finding=verifiedFinding;}
   if(follow.follow)finding=await findGoal(page,follow.follow);
  }catch{observationError='follow_observation_failed';}
  return taskResult({...action,...(verification?{verification}:{}),...(finding?{finding}:{}),...(observationError?{observationError}:{})});
 }finally{await baseline.dispose();}
}
