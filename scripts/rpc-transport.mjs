import crypto from 'node:crypto';

/** A missed reply never proves a transmitted action did not run. Only status reads may follow it. */
export async function postRpc({endpoint,token,method,params={},timeoutMs=35000,completionWaitMs=60000,requestId=crypto.randomUUID()}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(`${endpoint}/rpc`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({requestId,method,params}),signal:controller.signal});
    const payload=await response.json(); // Deadline includes reading/decoding the response body.
    const result=payload.ok ? payload.result : {...payload,execution:payload.execution || ([401,404].includes(response.status)?'not_started':'outcome_unknown')};
    return {fallbackAllowed:false,rpcOk:response.ok && payload.ok === true,
      result:result && typeof result==='object' && !Array.isArray(result)?{...result,requestId}:result};
  } catch(error) {
    const refused=error.cause?.code==='ECONNREFUSED';
    const uncertain={fallbackAllowed:refused,rpcOk:false,result:{ok:false,execution:refused?'not_started':'outcome_unknown',reason:refused?'daemon_unreachable':'transport_uncertain',requestId,error:error.message,
      hint:refused?'Daemon connection was refused before dispatch.':'Do not resend. Query request status or observe the page to establish whether the action applied.'}};
    clearTimeout(timer);
    if(refused || method==='request.status' || !(completionWaitMs>0))return uncertain;
    return await awaitCompletion({endpoint,token,requestId,completionWaitMs,uncertain});
  } finally {clearTimeout(timer);}
}

async function awaitCompletion({endpoint,token,requestId,completionWaitMs,uncertain}) {
  const started=Date.now(),deadline=started+Math.min(completionWaitMs,60000);
  let checks=0,requestState;
  while(Date.now()<deadline){
    // New status request IDs are separate; the original command is never posted again.
    const status=await postRpc({endpoint,token,method:'request.status',params:{requestId,verbose:true},timeoutMs:Math.min(2000,Math.max(1,deadline-Date.now())),completionWaitMs:0});
    checks++;
    if(!status.rpcOk)break;
    const value=status.result;
    requestState=value?.state;
    const recovery={kind:'request_status',checks,waitedMs:Date.now()-started};
    if(requestState==='completed'){
      const result=value.result;
      return {fallbackAllowed:false,rpcOk:true,result:result&&typeof result==='object'&&!Array.isArray(result)?{...result,execution:result.execution||value.execution||'completed',requestId,transportRecovery:recovery}:result};
    }
    if(requestState==='failed')return {fallbackAllowed:false,rpcOk:false,result:{ok:false,reason:'request_failed',execution:value.execution||'outcome_unknown',error:value.error,requestId,transportRecovery:recovery}};
    if(requestState!=='running')break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(250,Math.max(0,deadline-Date.now()))));
  }
  return {...uncertain,fallbackAllowed:false,result:{...uncertain.result,requestState,transportRecovery:{kind:'request_status',checks,waitedMs:Date.now()-started}}};
}
