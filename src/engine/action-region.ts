import type {Page} from 'playwright';
import {referencesFor,type ActionTarget} from '../runtime/references';
import {REGION_GUARD} from '../runtime/observation/scoping';
import {DEEP_WALK_JS} from './page-state';
import {PRIVATE_FIELD_SCRIPT} from '../runtime/private-fields';
import {redactContent} from '../utils/strings';

// Local facts only: no site names, calendar interpretation or guessed action semantics.
const HELPERS=`${DEEP_WALK_JS}${PRIVATE_FIELD_SCRIPT}
 const parent=el=>el.parentElement||el.getRootNode()?.host;
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const clean=s=>String(s||'').replace(/\\s+/g,' ').trim().slice(0,120);
 const contains=(root,node)=>{for(let n=node;n;n=parent(n))if(n===root)return true;return false;};
 const describe=root=>{
  const headings=[],values=[],status=[],choices=[];let controlCount=0,valueCount=0,statusCount=0,textTruncated=false;
  deepWalk(el=>{if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)||secret(el)||!visible(el))return false;
   if(el.matches('h1,h2,h3,h4,h5,h6,legend,[role=heading],[role=grid],[role=table]')){const raw=el.getAttribute('aria-label')||(/^(TABLE)$/.test(el.tagName)?el.querySelector('caption')?.textContent:el.matches('[role=grid],[role=table]')?'':el.textContent);const text=clean(raw);if(text&&!headings.includes(text))headings.push(text);if(String(raw||'').trim().length>120)textTruncated=true;}
   if(el.matches('[role=status],[aria-live]')){const text=clean(el.textContent);if(text){statusCount++;if(status.length<2)status.push(text);}}
   if(el.matches('input:not([type=hidden]),textarea,select')&&(!(el.type==='checkbox'||el.type==='radio')||el.checked)){valueCount++;if(values.length<3){const source=el.hasAttribute('aria-label')?'aria-label':el.labels?.length?'native-label':'placeholder',name=clean(el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.getAttribute('placeholder')),value=el.type==='checkbox'||el.type==='radio'?el.checked:String(el.value??'').slice(0,80);if(String(el.value??'').length>80)textTruncated=true;values.push({name,source,value});}}
   if(el.matches('button,input:not([type=hidden]),select,textarea,a[href],summary,[role=button],[role=option],[role=gridcell],[role=tab]')){controlCount++;if(choices.length<128)choices.push([el.localName,clean(el.getAttribute('aria-label')||el.textContent),el.getAttribute('aria-selected'),el.getAttribute('aria-expanded'),el.disabled,el.getAttribute('aria-disabled')]);}
  },512,root);
  const result={source:'current-local-dom',role:root.getAttribute('role')||root.localName,name:clean(root.getAttribute('aria-label'))||undefined,headings:headings.slice(0,3),values,status,controlsObserved:controlCount,complete:walkDiagnostics.complete&&headings.length<=3&&valueCount<=3&&statusCount<=2&&!textTruncated};
  return {current:result,signature:JSON.stringify([result,choices])};
 };
`;
export interface ActionRegion {document:string;id:number;signature:string;obstructed?:boolean;obstruction?:any}
/** Bind a weak local boundary before mutation so detached controls do not cause guessed rebinding. */
export async function prepareActionRegion(page:Page,target:ActionTarget,capture=true):Promise<ActionRegion|undefined>{
 try{
  const refs=referencesFor(page),{state}=await refs.snapshotState();
  const result=await target.evaluate((el,{script,state,capture})=>eval(`(${script})`)(el,state,capture),{state,capture,script:`(el,state,capture)=>{${HELPERS}
   const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
   let obstruction,hitTarget;
   if(r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight){const tree=el.getRootNode(),hit=tree.elementFromPoint?.(x,y)||document.elementFromPoint(x,y);
    if(hit&&!contains(el,hit)&&!(hit.tagName==='LABEL'&&hit.control===el))for(let n=hit;n;n=parent(n))if(n.matches('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true],[popover]:popover-open')&&!contains(n,el)){obstruction=n;hitTarget=hit;break;}
   }
   if(!obstruction&&!capture)return null;
   let root=obstruction;
   if(!root)for(let n=parent(el),depth=0;n&&n!==document.body&&n!==document.documentElement&&depth<8;n=parent(n),depth++){
    if(n.matches('main,header,footer,nav,[role=main],[role=banner],[role=navigation]'))break;
    if(n.matches('section,article,form,fieldset,table,dialog,[role=dialog],[role=alertdialog],[role=group],[role=grid],[role=region]')||n.querySelector('h1,h2,h3,h4,h5,h6,legend,[role=heading],[role=grid]')){root=n;break;}
   }
   if(!root||!visible(root))return null;
   let id=state.observedIds.get(root);if(!id){id=state.observedNext++;state.observedIds.set(root,id);}
   state.regionTargets.set(id,{ref:new WeakRef(root),guard:(${REGION_GUARD})(root)});while(state.regionTargets.size>64)state.regionTargets.delete(state.regionTargets.keys().next().value);
   const detail=describe(root);
   const nodeInfo=node=>({tag:node.localName,role:node.getAttribute('role')||undefined,name:clean(node.getAttribute('aria-label'))||undefined});
   const buttons=obstruction?[...obstruction.querySelectorAll('button,[role=button],input[type=button],input[type=submit]')].filter(node=>visible(node)&&!secret(node)):[];
   return {id,signature:detail.signature,...(obstruction?{obstructed:true,obstruction:{test:'target-center',hit:nodeInfo(hitTarget),container:nodeInfo(root),controls:buttons.slice(0,4).map(node=>({...nodeInfo(node),name:clean(node.getAttribute('aria-label')||node.textContent)})),'controls-complete':buttons.length<=4}}:{})};
  }`});
  return result?{...result,document:refs.documentIdentity()}:undefined;
 }catch{return undefined;}
}
export async function observeActionRegion(page:Page,before?:ActionRegion){
 if(!before)return undefined;
 try{
  const refs=referencesFor(page);await refs.settleNavigation();if(before.document!==refs.documentIdentity())return undefined;
  const {state}=await refs.snapshotState();
  const result=await page.evaluate(({script,state,before})=>eval(`(${script})`)(state,before),{state,before,script:`(state,before)=>{${HELPERS}
   const entry=state.regionTargets.get(before.id),root=entry?.ref.deref();if(!root?.isConnected||!visible(root)||(${REGION_GUARD})(root)!==entry.guard)return null;
   const detail=describe(root);return detail.signature!==before.signature||before.obstructed?detail.current:null;
  }`});
  return result?JSON.parse(redactContent(JSON.stringify(result))):undefined;
 }catch{return undefined;}
}
