import type {Page,JSHandle,ElementHandle} from 'playwright';
import {DEEP_WALK_JS} from '../../engine/page-state';
import {PRIVATE_FIELD_SCRIPT} from '../private-fields';
import {referencesFor} from '../references';
import {captureSnapshot} from '../snapshot';
import {cleanStoredJson} from '../hwm/store';

// No text/values leave the page in the baseline. Weak references do not retain detached DOM.
const HELPERS=`${DEEP_WALK_JS}
 const parent=el=>el.parentElement||el.getRootNode()?.host;
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
 const controls='button,input:not([type=hidden]),select,textarea,a[href],summary,[role=button],[role=option],[role=menuitem],[role=spinbutton]';
 const open='dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true],[role=menu],[role=listbox],[popover]:popover-open';
`;
export interface RecoveryBaseline {document:string;handle:JSHandle;dispose():Promise<void>}
export async function prepareRecovery(page:Page,targetRef?:string):Promise<RecoveryBaseline|undefined>{
 try{
  const refs=referencesFor(page),{state}=await refs.snapshotState(),document=refs.documentIdentity();
  const handle=await page.evaluateHandle(({script,state,targetRef})=>eval(`(${script})`)(state,targetRef),{state,targetRef,script:`(state,targetRef)=>{${HELPERS}
   const seen=new WeakSet();deepWalk(el=>{if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName))return false;if(visible(el))seen.add(el);},8000);
   const target=state.targets.get(targetRef)?.deref();return {seen,complete:walkDiagnostics.complete,target:target?new WeakRef(target):null};
  }`});
  return {document,handle,dispose:()=>handle.dispose().catch(()=>{})};
 }catch{return undefined;}
}

/** Early yield is limited to a new region explicitly linked by the action target. */
export async function hasNewLinkedRegion(page:Page,baseline?:RecoveryBaseline):Promise<boolean>{
 if(!baseline||baseline.document!==referencesFor(page).documentIdentity())return false;
 try{return await page.evaluate(({script,before})=>eval(`(${script})`)(before),{before:baseline.handle,script:`before=>{${HELPERS}
  if(!before.complete)return false;
  const target=before.target?.deref();if(!target?.isConnected)return false;
  const tree=target.getRootNode(),linked=(target.getAttribute('aria-controls')||'').split(/\\s+/).filter(Boolean).map(id=>tree.getElementById?.(id));
  if(target.popoverTargetElement)linked.push(target.popoverTargetElement);
  let candidate;
  for(const root of linked){
   if(!root?.isConnected||before.seen.has(root)||!visible(root))continue;
   let available=false,busy=false;deepWalk(el=>{
    if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName))return false;
    if(!visible(el))return;
    if(el.getAttribute('aria-busy')==='true'||el.getAttribute('role')==='progressbar')busy=true;
    if(el.matches(controls)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true')available=true;
   },512,root);
   if(available&&!busy&&walkDiagnostics.complete){candidate=root;break;}
  }
  if(!candidate){before.yieldCandidate=null;return false;}
  const now=performance.now();if(before.yieldCandidate?.node.deref()!==candidate){before.yieldCandidate={node:new WeakRef(candidate),at:now};return false;}
  return now-before.yieldCandidate.at>=100;
 }`});}catch{return false;}
}

/** One bounded, read-only fallback. Never interprets business intent or retries an action. */
export async function observeRecovery(page:Page,baseline?:RecoveryBaseline){
 const refs=referencesFor(page),document=refs.documentIdentity();
 let selection:JSHandle|undefined;
 try{
  const compatible=baseline?.document===document;
  selection=await page.evaluateHandle(({script,before})=>eval(`(${script})`)(before),{before:compatible?baseline!.handle:null,script:`before=>{${HELPERS}
   const fresh=[],opened=[];
   deepWalk(el=>{if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName))return false;if(!visible(el))return;
    if(el.matches(open))opened.push(el);
    if(before?.complete&&!before.seen.has(el)&&before.seen.has(parent(el))&&(el.matches(controls)||el.querySelector(controls)))fresh.push(el);
   },8000);
   const selected=[];const add=(el,basis)=>{if(!el||el===document.body||el===document.documentElement||!visible(el)||selected.some(s=>s.el===el||s.el.contains(el)))return;selected.push({el,basis});};
   const linked=before?.yieldCandidate?.node.deref();
   if(linked&&before.complete&&!before.seen.has(linked))add(linked,'newly-visible');
   if(!selected.length)for(const el of fresh) add(el,'newly-visible');
   if(!selected.length)for(const el of opened.slice(-1))add(el,'current-open-region');
   if(!selected.length){const target=before?.target?.deref();if(target?.isConnected)add(parent(target),'target-surroundings');}
   return {roots:selected.slice(0,3),complete:walkDiagnostics.complete&&selected.length<=3,baselineComplete:before?.complete===true};
  }`});
  const meta=await selection.evaluate((v:any)=>({count:v.roots.length,complete:v.complete,baselineComplete:v.baselineComplete}));
  const output:any={kind:'local-observation',source:'observed-after-stop',document,baselineComplete:meta.baselineComplete,complete:meta.complete,regions:[]};
  if(!compatible&&baseline)output.documentChanged=true;
  for(let i=0;i<meta.count;i++){
   const node=await selection.evaluateHandle((v:any,i:number)=>v.roots[i].el,i),root=node.asElement() as ElementHandle;
   try{
    const detail=await root.evaluate((el,script)=>eval(`(${script})`)(el),`root=>{${DEEP_WALK_JS}${PRIVATE_FIELD_SCRIPT}
     let text='',truncated=false;deepWalk(el=>{if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)||secret(el))return false;
      const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')return false;
      for(const n of el.childNodes)if(n.nodeType===3){const part=(n.textContent||'').replace(/\\s+/g,' ').trim();if(part){text+=(text?' ':'')+part;if(text.length>600){text=text.slice(0,600);truncated=true;return false;}}}
     },512,root);return {tag:root.localName,role:root.getAttribute('role')||undefined,text,textTruncated:truncated||!walkDiagnostics.complete};
    }`);
    const snapshot=await captureSnapshot(page,{root,context:false,localContext:true,lightweight:true,limit:8,maxVisits:512,waitMs:0});
    const basis=await selection.evaluate((v:any,i:number)=>v.roots[i].basis,i);
    const controls=snapshot.elements.filter(e=>e.ref).map(({ref,tag,role,name,nameTruncated,value,checked,selected,disabled,expanded,placeholder,label,href,redacted,viewportBox,owner,local})=>({ref,tag,role,name,nameTruncated,value,...(value?.length===60?{valuePreview:true}:{}),checked,selected,disabled,expanded,placeholder,label,href,redacted,viewportBox,owner,local}));
    output.regions.push({basis,...detail,controls,coverage:{complete:snapshot.observation?.complete===true&&!snapshot.truncated,shown:controls.length,observed:snapshot.controlPage?.total??controls.length}});
    if(!output.regions.at(-1).coverage.complete||detail.textTruncated)output.complete=false;
   }finally{await node.dispose();}
  }
  if(document!==refs.documentIdentity())return {kind:'local-observation',complete:false,reason:'document_changed_during_recovery',regions:[]};
  if(!output.regions.length){output.complete=false;output.reason='no_local_region';output.next='Observe the current page or a screenshot; do not replay completed actions.';}
  const safe=cleanStoredJson(output) as any;
  // Truncation is explicit; it never changes the original action/verification outcome.
  while(Buffer.byteLength(JSON.stringify(safe))>4000){
   safe.complete=false;safe.truncated=true;
   const region=safe.regions.at(-1);if(!region)break;
   if(region.controls.length){region.controls.pop();region.coverage.shown=region.controls.length;region.coverage.complete=false;}
   else if(region.text){region.text='';region.textTruncated=true;}
   else safe.regions.pop();
  }
  return safe;
 }catch{return {kind:'local-observation',complete:false,reason:'recovery_observation_failed',regions:[]};}
 finally{await selection?.dispose().catch(()=>{});}
}
