import type {Page,ElementHandle,JSHandle} from 'playwright';
import {REGION_FACTS_JS} from '../../engine/action-region';
import {SCOPING_JS,REGION_GUARD} from './scoping';
import {redactContent} from '../../utils/strings';

// Structural facts only. Never classify a control by its label or guess a widget's purpose.
const SCRIPT=`opts=>{
 ${REGION_FACTS_JS}
 ${SCOPING_JS}
 const current=describe(opts.root,scopeAllows).current,found=[];
 const add=(el,relation,basis,via)=>{if(!el?.isConnected||!visible(el)||secret(el)||found.some(e=>e.el===el&&e.relation===relation))return;found.push({el,relation,basis,via});};
 const anchors=[];for(let n=opts.root,i=0;n&&n!==document.body&&i<4;n=parent(n),i++)anchors.push(n);
 if(anchors.some(n=>n.id))deepWalk(el=>{
  if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName))return false;
  const targets=(el.getAttribute('aria-controls')||'').split(/\\s+/).filter(Boolean).map(id=>el.getRootNode().getElementById?.(id));
  if(!contains(opts.root,el)&&targets.some(n=>anchors.includes(n)))add(el,'controlled-by','aria-controls',targets.includes(opts.root)?undefined:'ancestor');
  if(el.popoverTargetElement&&anchors.includes(el.popoverTargetElement)&&!contains(opts.root,el))add(el,'controlled-by','popovertarget',el.popoverTargetElement===opts.root?undefined:'ancestor');
 },4000);
 const externalComplete=walkDiagnostics.complete;
 deepWalk(el=>{
  if(!scopeAllows(el)){if(scopeExcluded.has(el)&&visible(el)){const s=getComputedStyle(el);if(/^(auto|scroll)$/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+1)add(el,'scroll-owner','overflow-y');}return false;}
  if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)||secret(el))return false;
  if(!visible(el))return;
  const s=getComputedStyle(el);if(/^(auto|scroll)$/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+1)add(el,'scroll-owner','overflow-y');
  for(const id of (el.getAttribute('aria-controls')||'').split(/\\s+/).filter(Boolean)){
   const target=el.getRootNode().getElementById?.(id);if(target&&!contains(opts.root,target))add(target,'controls','aria-controls',el===opts.root?undefined:'descendant');
  }
  if(el.popoverTargetElement&&!contains(opts.root,el.popoverTargetElement))add(el.popoverTargetElement,'controls','popovertarget',el===opts.root?undefined:'descendant');
 },512,opts.root);
 const form=opts.root.form||anchors.find(n=>n.matches('form,[role=form]'));if(form&&form!==opts.root)add(form,'form-owner',opts.root.form?'html-form':'dom-ancestor');
 const complete=externalComplete&&walkDiagnostics.complete&&found.length<=4;
 const related=found.slice(0,4).flatMap(entry=>{
  const el=entry.el,guard=(${REGION_GUARD})(el);
  let id=Object.keys(opts.boundaries).find(id=>!opts.boundaries[id].section&&opts.boundaries[id].ref?.deref()===el&&opts.boundaries[id].guard===guard);
  if(!id){if(Object.keys(opts.boundaries).length>=128)return [];let n=1;while(opts.boundaries['P'+n])n++;id='P'+n;opts.boundaries[id]={ref:new WeakRef(el),guard,auxiliary:true};}
  let identity=opts.state.observedIds.get(el);if(!identity){identity=opts.state.observedNext++;opts.state.observedIds.set(el,identity);}
  const r=el.getBoundingClientRect();return [{id,identity,role:(el.getAttribute('role')||({FORM:'form',MAIN:'main',DIALOG:'dialog'})[el.tagName]||'region').slice(0,40),basis:entry.basis,relation:entry.relation,...(entry.via?{via:entry.via}:{}),position:r.bottom<0?'above':r.top>=innerHeight?'below':'partial',...(entry.relation==='scroll-owner'?{boundary:'scroll'}:{})}];
 });
 return {current,related,coverage:{complete:complete&&related.length===found.length,observed:found.length,shown:related.length}};
}`;

/** Reuses the current scope registry. Related scopes are explicit links or actual scroll owners. */
export async function captureWorkSurface(page:Page,root:ElementHandle,boundaries:JSHandle,state:JSHandle,options:{section?:JSHandle;includeChildren?:boolean}={}){
 const value=await page.evaluate(({script,opts})=>eval(script)(opts),{script:SCRIPT,opts:{...options,root,boundaries,state}});
 return JSON.parse(redactContent(JSON.stringify(value))) as {current:Record<string,any>;related:Array<{id:string;identity:number;role:string;basis:string;relation:string;via?:string;position:string;boundary?:string}>;coverage:{complete:boolean;observed:number;shown:number}};
}
