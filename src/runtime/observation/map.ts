import type {Page,JSHandle,ElementHandle} from 'playwright';
import {DEEP_WALK_JS} from '../../engine/page-state';
import {redactContent} from '../../utils/strings';
import {referencesFor} from '../references';
import {REGION_GUARD} from './scoping';
import {PANEL_FACTS_JS} from './panel-facts';

export interface Panel {id:string;role:string;name?:string;nameSource?:string;headings?:string[];visibleHeadings?:string[];basis:string;position:string;horizontal?:string;boundary?:string;identity?:number;parent?:string;section?:boolean;auxiliary?:boolean}
export const PANEL_GUARD=REGION_GUARD;
const SCRIPT=`({offset,state,viewportOnly})=>{
 ${DEEP_WALK_JS}
 ${PANEL_FACTS_JS}
 const candidates=[],seen=new Set(),roles={HEADER:'banner',NAV:'navigation',MAIN:'main',ASIDE:'complementary',FOOTER:'contentinfo',DIALOG:'dialog'};
 const landmarks=new Set(['banner','navigation','main','complementary','contentinfo','dialog','alertdialog','search','menu','listbox']);
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const add=(el,role,basis)=>{if(seen.has(el)||!visible(el))return;seen.add(el);candidates.push({el,role,basis});};
 const examined=[];
 deepWalk(el=>{if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName))return false;
  if(examined.length<600)examined.push(el);
  if(el.getAttribute('aria-expanded')==='true'&&visible(el))for(const id of (el.getAttribute('aria-controls')||'').split(/\\s+/)){const target=el.getRootNode().getElementById?.(id);if(target)add(target,target.getAttribute('role')||'region','aria-controls-expanded');}
  if(el.matches('[popover]:popover-open'))add(el,el.getAttribute('role')||'region','open-popover');
  const explicit=el.getAttribute('role');const role=explicit||roles[el.tagName];if(!landmarks.has(role))return;
  if(!explicit&&/^(HEADER|FOOTER)$/.test(el.tagName)&&el.parentElement?.closest('article,aside,main,nav,section,[role=article],[role=main],[role=navigation],[role=complementary],[role=region]'))return;
  if(role!=='dialog'&&role!=='alertdialog'&&el.closest('nav,header,footer,[role=banner],[role=navigation],[role=contentinfo]')!==el&&el.parentElement?.closest('nav,header,footer,[role=banner],[role=navigation],[role=contentinfo]'))return;
  add(el,role,el.hasAttribute('role')?'aria':'html');
 },8000);
 if(candidates.length<2&&document.body)for(const el of document.body.children){const r=el.getBoundingClientRect();if(r.width*r.height>=innerWidth*innerHeight*.08)add(el,'region','geometry');}
 if(!candidates.some(p=>p.role==='main'||p.role==='region')&&document.body)add(document.body,'document','html');
 // Large sibling columns: actual DOM roots only, bounded independently of landmarks.
 // Repeated children are one list/grid, never a panel for every card or row.
 const contentRoots=candidates.filter(p=>['main','document','region'].includes(p.role)).map(p=>p.el);
 for(const el of examined){
  if(candidates.length>=64)break;
  if(!contentRoots.some(root=>panelContains(root,el))||seen.has(el)||el.closest('nav,aside,article,li,tr,[role=listitem],[role=row]')||!visible(el))continue;
  const children=Array.from(el.children),r=el.getBoundingClientRect();
  if(children.length<3||children.length>300||r.width<innerWidth*.25||r.height<innerHeight*.25)continue;
  const signature=n=>n.tagName+'|'+(n.getAttribute('role')||'')+'|'+Array.from(n.children).slice(0,4).map(c=>c.tagName).join(',');
  const shape=signature(children[0]),same=children.filter(n=>signature(n)===shape);
  if(same.length<3||same.length<children.length*.75)continue;
  if(el.matches('ul,ol,tbody,[role=list],[role=grid]')||same.every(n=>n.matches('article,li,[role=listitem]')))add(el,'region','repeated-children-v1');
 }
 for(const el of examined){
  if(candidates.length>=64)break;
  if(!contentRoots.some(root=>panelContains(root,el))||el.closest('nav,aside,header,footer,dialog,article,li,tr,[role=listitem],[role=row],[role=dialog],[role=menu],[role=listbox]'))continue;
  if(el.children.length<2||el.children.length>4||!visible(el))continue;
  const children=Array.from(el.children).filter(n=>visible(n)&&!n.matches('script,style,template'));
  if(children.length<2||children.length>3||children.every(n=>n.matches('article,li,tr,[role=listitem],[role=row]')))continue;
  const boxes=children.map(n=>n.getBoundingClientRect());
  if(!boxes.every(r=>r.width>=Math.max(160,innerWidth*.13)&&r.height>=innerHeight*.3))continue;
  const left=boxes.slice().sort((a,b)=>a.left-b.left);
  if(!left.every((r,i)=>!i||r.left>=left[i-1].right-2&&Math.min(r.bottom,left[i-1].bottom)-Math.max(r.top,left[i-1].top)>=innerHeight*.2))continue;
  for(const child of children)add(child,'region','sibling-layout-v1');
 }
 for(const el of examined){if(candidates.length>=64)break;if(!contentRoots.some(root=>panelContains(root,el))||!visible(el))continue;
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);
  if(el!==document.body&&r.width>=180&&r.height>=180&&/(auto|scroll)/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+1)add(el,el.getAttribute('role')||'region','scroll-container-v1');
 }
 const priority={dialog:0,alertdialog:0,menu:0,listbox:0,banner:1,main:2,search:3,complementary:4,document:5,region:5,navigation:6,contentinfo:7};
 const ranked=candidates.slice().sort((a,b)=>(priority[a.role]??6)-(priority[b.role]??6)),ordered=[];
 const place=p=>{if(ordered.includes(p))return;const ancestors=candidates.filter(a=>a!==p&&panelContains(a.el,p.el));for(const a of ancestors)if(!ordered.includes(a))place(a);ordered.push(p);};
 for(const p of ranked)place(p);
 const all=ordered.slice(0,128),roots={},panels=[];
 const contains=(root,node)=>{for(let p=node;p;p=p.parentElement||p.getRootNode().host)if(p===root)return true;return false;};
 for(const [i,{el,role,basis}]of all.entries()){
  const id='P'+(i+1),r=el.getBoundingClientRect();
  const observedFacts=panelFacts(el,all.filter(p=>p.el!==el&&panelContains(el,p.el)).map(p=>p.el),viewportOnly);
  const {headings,...named}=observedFacts;const facts=viewportOnly?{...named,...(headings?{visibleHeadings:headings}:{})}:observedFacts;
  const position=r.bottom<0?'above':r.top>=innerHeight?'below':r.top<0||r.bottom>innerHeight?'partial':r.top<innerHeight*.2?'top':r.left<innerWidth*.2&&r.width<innerWidth*.5?'left':'center';
  const s=getComputedStyle(el),boundary=(/(auto|scroll)/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+1||/(auto|scroll)/.test(s.overflowX)&&el.scrollWidth>el.clientWidth+1)?'scroll':undefined;
  let identity=state.observedIds.get(el);if(!identity){identity=state.observedNext++;state.observedIds.set(el,identity);}
  const ancestors=all.filter(p=>p.el!==el&&contains(p.el,el));const parent=ancestors.find(p=>!ancestors.some(other=>other!==p&&contains(p.el,other.el)));
  const horizontal=r.width>=innerWidth*.8?'full':r.left+r.width/2<innerWidth*.45?'left':r.left+r.width/2>innerWidth*.55?'right':'center';
  roots[id]={ref:new WeakRef(el),guard:(${PANEL_GUARD})(el)};panels.push({id,role,...facts,basis,position,horizontal,identity,...(parent?{parent:'P'+(all.indexOf(parent)+1)}:{}),...(boundary?{boundary}:{})});
 }
 const selected=new Set();let end=offset,depthOmitted=0;
 for(;end<panels.length;end++){const chain=[];for(let p=panels[end];p;p=panels.find(a=>a.id===p.parent))if(!selected.has(p.id))chain.unshift(p.id);if(selected.size+chain.length>8){if(!selected.size&&chain.length>8){depthOmitted++;continue;}break;}for(const id of chain)selected.add(id);}
 const shown=panels.filter(p=>selected.has(p.id));
 return {roots,panels:shown,allPanels:panels,coverage:{complete:walkDiagnostics.complete&&ordered.length<=128&&!depthOmitted,candidates:ordered.length,shown:shown.length,...(depthOmitted?{depthOmitted,next:'read parent outline'}:{}),structureComplete:walkDiagnostics.complete&&examined.length<600&&candidates.length<64,...(end<panels.length?{nextOffset:end}:{})},title:document.title,readyState:document.readyState};
}`;
export async function captureMap(page:Page,offset=0,viewportOnly=false){
 const state=await referencesFor(page).snapshotState();
 const result=await page.evaluateHandle(({script,offset,state,viewportOnly})=>eval(`(${script})`)({offset,state,viewportOnly}),{script:SCRIPT,offset,state:state.state,viewportOnly});
 try{const data=await result.evaluate((v:any)=>({panels:v.panels,allPanels:v.allPanels,coverage:v.coverage,title:v.title,readyState:v.readyState}));
  const roots=await result.getProperty('roots');const clean=(p:Panel)=>({...p,...(p.name?{name:redactContent(p.name)}:{}),...(p.headings?{headings:p.headings.map(redactContent)}:{}),...(p.visibleHeadings?{visibleHeadings:p.visibleHeadings.map(redactContent)}:{})});return {...data,title:redactContent(data.title),panels:data.panels.map(clean),allPanels:data.allPanels.map(clean),roots};
 }finally{await result.dispose();}
}
export async function panelRoot(roots:JSHandle,id:string):Promise<ElementHandle>{
 const handle=await roots.evaluateHandle((entries:any,{id,guard})=>{const e=entries[id],el=e?.ref.deref();return el?.isConnected&&eval(`(${guard})`)(el)===e.guard?el:null;},{id,guard:PANEL_GUARD});
 const element=handle.asElement();if(!element){await handle.dispose();throw Object.assign(new Error('Panel target no longer matches the observed DOM'),{code:'scope_stale',execution:'not_started'});}return element;
}
