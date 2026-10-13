import crypto from 'node:crypto';

/** A missed reply never proves a transmitted action did not run. No retries live here. */
export async function postRpc({endpoint,token,method,params={},timeoutMs=35000,requestId=crypto.randomUUID()}) {
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
    return {fallbackAllowed:refused,rpcOk:false,result:{ok:false,execution:refused?'not_started':'outcome_unknown',reason:refused?'daemon_unreachable':'transport_uncertain',requestId,error:error.message,
      hint:refused?'Daemon connection was refused before dispatch.':'Do not resend. Query request status or observe the page to establish whether the action applied.'}};
  } finally {clearTimeout(timer);}
}
