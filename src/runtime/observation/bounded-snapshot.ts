import type {PageSnapshot} from '../snapshot';

/** Full graphs stay in the observation store or an explicitly saved file, never implicit CLI output. */
export function boundedSnapshot(snapshot:PageSnapshot,budget=14000,retained=false){
 const {contextGraph,...data}=snapshot;const folded:Record<string,number>={};
 const result:any={...data};
 const arrays=['elements','headings','open','hidden','textHits','collapsed'];
 for(const key of arrays)if(Array.isArray(result[key]))result[key]=[...result[key]];
 for(const key of ['url','title'])if(typeof result[key]==='string'&&result[key].length>2048){result[key+'Length']=result[key].length;result[key]=result[key].slice(0,2048);result[key+'Truncated']=true;}
 const size=()=>Buffer.byteLength(JSON.stringify(result));
 while(size()>budget){const largest=arrays.filter(k=>result[k]?.length).sort((a,b)=>JSON.stringify(result[b]).length-JSON.stringify(result[a]).length)[0];if(!largest)break;
  const n=result[largest].length,keep=Math.floor(n/2);folded[largest]=(folded[largest]??0)+n-keep;result[largest]=result[largest].slice(0,keep);
 }
 if(contextGraph&&retained)result.contextRef={observation:contextGraph.observation};
 if(contextGraph||Object.keys(folded).length)result.projection={...(contextGraph?{graph:'not-inlined'}:{}),...(Object.keys(folded).length?{folded}:{}),next:'Use scoped read/explain or an explicitly saved file.'};
 if(Object.keys(folded).length)result.truncated=true;
 return result;
}

/** Transport boundary also covers explicit action/diff observations and request-status envelopes. */
export function boundedObservationOutput(value:any):any{
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const result={...value};
 for(const key of ['snapshot','after','before'])if(result[key]?.contextGraph)result[key]=boundedSnapshot(result[key],14000,Boolean(value.observation)&&value.retention?.ok!==false);
 if(result.result&&typeof result.result==='object')result.result=boundedObservationOutput(result.result);
 return result;
}
