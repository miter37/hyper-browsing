import type {Page,ElementHandle,JSHandle} from 'playwright';
import {DEEP_WALK_JS} from '../../engine/page-state';
import {referencesFor} from '../references';
import {redactContent} from '../../utils/strings';
import {SCOPING_JS,REGION_GUARD} from './scoping';

export interface OutlineItem {id:string;name:string;level:number|null;parent?:string;nameTruncated?:boolean}
const SCRIPT=`opts=>{
 ${DEEP_WALK_JS}
 ${SCOPING_JS}
 const headings=[];
 deepWalk(el=>{if(!scopeAllows(el))return false;
  if(!scopeSelected(el))return;
  if(!/^H[1-6]$/.test(el.tagName)&&el.getAttribute('role')!=='heading')return;
  const style=getComputedStyle(el);if(el.hidden||style.display==='none'||style.visibility==='hidden')return false;
  const level=/^H[1-6]$/.test(el.tagName)?Number(el.tagName[1]):Number(el.getAttribute('aria-level'))||null;
  const name=String(el.textContent||'').replace(/\\s+/g,' ').trim();headings.push({el,level,name});
 },8000,opts.root);
 const matches=opts.query?headings.filter(h=>h.name.toLowerCase().includes(opts.query.toLowerCase())):headings;
 const stack=[],parents=new Map();for(const h of headings){while(stack.length&&(h.level===null||stack.at(-1).level>=h.level))stack.pop();parents.set(h,stack.at(-1));if(h.level!==null)stack.push(h);}
 opts.state.sectionIds||=new WeakMap();opts.state.sectionNext||=1;
 const register=h=>{
  const guard=(${REGION_GUARD})(h.el)+'|'+h.el.textContent+'|'+h.level;
  let saved=opts.state.sectionIds.get(h.el);
  if(!saved||saved.guard!==guard||!opts.boundaries[saved.id]){
   if(saved)delete opts.boundaries[saved.id];saved={id:'S'+opts.state.sectionNext++,guard};opts.state.sectionIds.set(h.el,saved);
  }
  opts.boundaries[saved.id]={ref:new WeakRef(h.el),guard:(${REGION_GUARD})(h.el),section:true,headingText:h.el.textContent,level:h.level,parent:opts.panel,scopeRoot:new WeakRef(opts.root),scopeGuard:(${REGION_GUARD})(opts.root)};return saved.id;
 };
 const items=matches.slice(opts.offset,opts.offset+opts.limit).map(h=>{const id=register(h),parent=parents.get(h);return {id,name:h.name.slice(0,120),level:h.level,...(h.name.length>120?{nameTruncated:true}:{}),...(parent?{parent:register(parent)}:{})};});
 const keys=Object.keys(opts.boundaries).filter(k=>opts.boundaries[k].section);while(keys.length>128)delete opts.boundaries[keys.shift()];
 return {items,complete:walkDiagnostics.complete,total:matches.length,retainedSections:Object.keys(opts.boundaries).filter(k=>opts.boundaries[k].section)};
}`;
/** Headings only: no prose graph, field values or per-node layout measurements. */
export async function captureOutline(page:Page,root:ElementHandle,boundaries:JSHandle,options:{panel:string;query?:string;offset:number;limit:number;includeChildren?:boolean;section?:JSHandle;viewportOnly?:boolean}){
 const state=await referencesFor(page).snapshotState();
 const value=await page.evaluate(({script,opts})=>eval(`(${script})`)(opts),{script:SCRIPT,opts:{...options,root,boundaries,state:state.state}});
 return {...value,items:value.items.map((item:OutlineItem)=>({...item,name:redactContent(item.name)}))};
}
