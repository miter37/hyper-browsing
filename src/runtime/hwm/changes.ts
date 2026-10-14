import type { Page } from 'playwright';
import { captureSnapshot } from '../snapshot';
import type { ObservationGraph, ObservationNode } from './observation';
import type { Attributes, Json } from './view';
import { renderObservation } from './renderer';
import { redactContent, redactUrl } from '../../utils/strings';

/** Physical identity evidence, never text/URL/position similarity. No causal or task-success inference. */
export function compareObservations(before: ObservationGraph, after: ObservationGraph, request?: string): Attributes[] {
  const changes: Attributes[] = [];
  const address = (g: ObservationGraph, n: ObservationNode): Json => ({obs:g.observation,node:n.id});
  const emit = (attrs: Attributes) => changes.push({ ...attrs, causal:false, ...(request?{'after-request':request}:{}) });
  const rootBefore = before.nodes[0], rootAfter = after.nodes[0];
  if (!rootBefore || !rootAfter) throw new Error('Observation graph root required');
  if (before.document !== after.document) {
    emit({op:'incomparable',subject:'document',reason:'document-identity-changed',replacement:'unconfirmed',before:address(before,rootBefore),after:address(after,rootAfter),'before-document':before.document,'after-document':after.document});return changes;
  }
  if(before.scan.scope!==after.scan.scope){emit({op:'incomparable',reason:'scope-mismatch',before:address(before,rootBefore),after:address(after,rootAfter)});return changes;}
  const tracked = (n: ObservationNode) => n.tracking?.source === 'dom-weakmap-v1' ? n.tracking.id : undefined;
  const index = (g: ObservationGraph) => {
    const map = new Map<string,ObservationNode>();
    for(const n of g.nodes){const id=tracked(n);if(id){if(map.has(id))throw new Error('Duplicate DOM tracking identity');map.set(id,n);}}
    return map;
  };
  const old = index(before), current = index(after);
  const stateFields=['value','checked','selected','expanded','pressed','disabled','busy','open','href'];
  const values = (n:ObservationNode) => ({...(n.text===undefined?{}:{text:n.text}),...(n.name===undefined?{}:{'accessible-name':n.name}),...Object.fromEntries(stateFields.filter(k=>k in n.attrs).map(k=>[k,n.attrs[k]]))}) as Attributes;
  const canonical = (value:Json,field:string,g:ObservationGraph):Json => field==='selected'&&Array.isArray(value)?value.map(id=>g.nodes.find(n=>n.id===id)?.tracking?.id??null):value;
  for(const n of before.nodes){
    const id=tracked(n), next=id?current.get(id):undefined;
    if(!next){emit({op: id&&before.scan.complete&&after.scan.complete?'removed':'incomparable',before:address(before,n),reason:id?'not-observed-after':'identity-unavailable',scope:after.scan.scope});continue;}
    const pair={before:address(before,n),after:address(after,next)};
    if(!n.tracking?.semantic||!next.tracking?.semantic){emit({op:'incomparable',...pair,reason:'semantic-guard-incomplete'});continue;}
    if(n.tracking?.semantic!==next.tracking?.semantic){emit({op:'incomparable',...pair,reason:'semantic-identity-changed'});continue;}
    const a=values(n),b=values(next);
    for(const field of new Set([...Object.keys(a),...Object.keys(b)])){
      if(/<redacted(?:-[^>]*)?>/.test(JSON.stringify([a[field],b[field]]))){emit({op:'incomparable',...pair,field,reason:'redacted'});continue;}
      const incomplete=field==='selected'&&(n.attrs['selected-complete']!==true||next.attrs['selected-complete']!==true);
      if(field==='selected'&&!incomplete){
        const unconfirmed=(value:Json,g:ObservationGraph,other:Map<string,ObservationNode>)=>Array.isArray(value)&&value.some(id=>{const member=g.nodes.find(n=>n.id===id),tid=member&&tracked(member),peer=tid?other.get(tid):undefined;return !member?.tracking?.semantic||!peer?.tracking?.semantic||member.tracking.semantic!==peer.tracking.semantic;});
        if(unconfirmed(a[field],before,current)||unconfirmed(b[field],after,old)){emit({op:'incomparable',...pair,field,reason:'selection-identity-unconfirmed'});continue;}
      }
      if(!(field in a)||!(field in b)||a[field]===null||b[field]===null||incomplete){emit({op:'incomparable',...pair,field,reason:incomplete?'partial-selection':'field-not-comparable'});continue;}
      const equal=JSON.stringify(canonical(a[field],field,before))===JSON.stringify(canonical(b[field],field,after));
      emit({op:equal?'unchanged':'changed',...pair,field,identity:'tracked-dom-node',old:a[field],new:b[field]});
    }
    if(Array.isArray(n.attrs.redactedFields)||Array.isArray(next.attrs.redactedFields))emit({op:'incomparable',...pair,field:'value',reason:'redacted'});
  }
  for(const n of after.nodes){const id=tracked(n);if(!id||!old.has(id))emit({op:id&&before.scan.complete&&after.scan.complete?'added':'incomparable',after:address(after,n),reason:id?'not-observed-before':'identity-unavailable',scope:before.scan.scope});}
  return changes;
}

/** One execution only. Result status and registered popup facts do not become task-success evidence. */
export async function observeExecution<T extends { execution?: string }>(page:Page,session:string,execute:()=>Promise<T>,request?:string,format:'json'|'hwm'='hwm',publish?:(data:{before?:ObservationGraph;after:ObservationGraph;changes:Attributes[];result:Attributes;header:Attributes})=>Record<string,unknown>,options:{lightweight?:boolean;query?:string;before?:ObservationGraph}={}) {
  const before=options.lightweight?{contextGraph:options.before}:await captureSnapshot(page,{context:true,references:undefined,waitMs:0});
  const result=await execute();
  let snapshot;
  try{snapshot=await captureSnapshot(page,{context:true,waitMs:0,...(options.lightweight?{query:options.query,limit:24,contextLimit:800}:{})});}catch{return {...result,observationError:'capture-failed'};}
  const a=before?.contextGraph,b=snapshot.contextGraph;
  if(!b)return {...result,snapshot,observationError:'capture-failed'};
  const changes:Attributes[]=a?compareObservations(a,b,request):[{op:'incomparable',reason:options.lightweight?'no-prior-observation':'prior-capture-failed',causal:false}];
  const clean=(value:Json,key=''):Json=>typeof value==='string'?key==='url'||key==='href'?redactUrl(value):['sessionId','ref','request','requestId'].includes(key)?value:redactContent(value):Array.isArray(value)?value.map(v=>clean(v)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k)])):value;
  const resultAttrs=clean(JSON.parse(JSON.stringify({...result,...(request?{request}:{})}))) as Attributes;
  const effect=resultAttrs.effect;
  if(effect&&typeof effect==='object'&&!Array.isArray(effect)&&Array.isArray(effect.newSessions))for(const popup of effect.newSessions){
    if(!popup||typeof popup!=='object'||Array.isArray(popup))continue;
    changes.push({subject:'session',op:typeof popup.sessionId==='string'?'added':'incomparable',...(typeof popup.sessionId==='string'?{after:{session:popup.sessionId}}:{reason:'popup-session-unavailable'}),source:'playwright-popup-event','opener-session':session,details:popup,causal:false,...(request?{'after-request':request}:{})});
  }
  if(publish){try{return {...result,snapshot,changes,...publish({before:a,after:b,changes,result:resultAttrs,header:JSON.parse(JSON.stringify({'collection-timing':snapshot.collectionTiming,'state-observation':snapshot.stateObservation}))})};}catch{return {...result,snapshot,changes,observationError:'publication-failed'};}}
  if(format==='json')return {...result,snapshot,changes};
  try{return {...result,snapshot,changes,hwm:renderObservation(b,{session,result:resultAttrs,changes,before:a,extraHeader:JSON.parse(JSON.stringify({'collection-timing':snapshot.collectionTiming,'state-observation':snapshot.stateObservation}))})};}
  catch{return {...result,snapshot,changes,observationError:'projection-failed'};}
}
