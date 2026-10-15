import type {Page,JSHandle,ElementHandle} from 'playwright';
import {DEEP_WALK_JS} from '../../engine/page-state';
import {redactContent} from '../../utils/strings';
import {referencesFor} from '../references';

export interface Panel {id:string;role:string;name?:string;basis:string;position:string;boundary?:string;identity?:number}
export const PANEL_GUARD=`el=>JSON.stringify([el.localName,el.id,el.getAttribute('role'),el.getAttribute('aria-label'),el.getAttribute('data-key'),el.getAttribute('data-id')])`;
const SCRIPT=`({offset,state})=>{
 ${DEEP_WALK_JS}
 const candidates=[],seen=new Set(),roles={HEADER:'banner',NAV:'navigation',MAIN:'main',ASIDE:'complementary',FOOTER:'contentinfo',DIALOG:'dialog'};
 const landmarks=new Set(['banner','navigation','main','complementary','contentinfo','dialog','alertdialog','search']);
 const clean=s=>String(s||'').replace(/\\s+/g,' ').trim().slice(0,120);
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const add=(el,role,basis)=>{if(seen.has(el)||!visible(el))return;seen.add(el);candidates.push({el,role,basis});};
 deepWalk(el=>{if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName))return false;
  const explicit=el.getAttribute('role');const role=explicit||roles[el.tagName];if(!landmarks.has(role))return;
  if(!explicit&&/^(HEADER|FOOTER)$/.test(el.tagName)&&el.parentElement?.closest('article,aside,main,nav,section,[role=article],[role=main],[role=navigation],[role=complementary],[role=region]'))return;
  if(role!=='dialog'&&role!=='alertdialog'&&el.closest('nav,header,footer,[role=banner],[role=navigation],[role=contentinfo]')!==el&&el.parentElement?.closest('nav,header,footer,[role=banner],[role=navigation],[role=contentinfo]'))return;
  add(el,role,el.hasAttribute('role')?'aria':'html');
 },8000);
 if(candidates.length<2&&document.body)for(const el of document.body.children){const r=el.getBoundingClientRect();if(r.width*r.height>=innerWidth*innerHeight*.08)add(el,'region','geometry');}
 if(!candidates.some(p=>p.role==='main'||p.role==='region')&&document.body)add(document.body,'document','html');
 const priority={dialog:0,alertdialog:0,banner:1,main:2,search:3,complementary:4,document:5,region:5,navigation:6,contentinfo:7};
 const ordered=candidates.slice().sort((a,b)=>(priority[a.role]??6)-(priority[b.role]??6));
 const picked=ordered.slice(offset,offset+8),roots={},panels=[];
 for(const [i,{el,role,basis}]of picked.entries()){
  const id='P'+(offset+i+1),r=el.getBoundingClientRect();
  let name=clean(el.getAttribute('aria-label'));
  if(!name)name=clean((el.getAttribute('aria-labelledby')||'').split(/\\s+/).map(id=>el.getRootNode().getElementById?.(id)?.textContent||'').join(' '));
  if(!name)name=clean([...el.querySelectorAll('h1,h2,h3,[role=heading]')].find(h=>{for(let p=h.parentElement;p&&p!==el;p=p.parentElement){if(landmarks.has(p.getAttribute('role')||roles[p.tagName]))return false;}return true;})?.textContent);
  const position=r.bottom<0?'above':r.top>=innerHeight?'below':r.top<0||r.bottom>innerHeight?'partial':r.top<innerHeight*.2?'top':r.left<innerWidth*.2&&r.width<innerWidth*.5?'left':'center';
  const s=getComputedStyle(el),boundary=/(auto|scroll)/.test(s.overflowX+' '+s.overflowY)?'scroll':undefined;
  let identity=state.observedIds.get(el);if(!identity){identity=state.observedNext++;state.observedIds.set(el,identity);}
  roots[id]={ref:new WeakRef(el),guard:(${PANEL_GUARD})(el)};panels.push({id,role,...(name?{name}:{}),basis,position,identity,...(boundary?{boundary}:{})});
 }
 return {roots,panels,coverage:{complete:walkDiagnostics.complete,candidates:ordered.length,shown:picked.length,...(ordered.length>offset+8?{nextOffset:offset+8}:{})},title:document.title,readyState:document.readyState};
}`;
export async function captureMap(page:Page,offset=0){
 const state=await referencesFor(page).snapshotState();
 const result=await page.evaluateHandle(({script,offset,state})=>eval(`(${script})`)({offset,state}),{script:SCRIPT,offset,state:state.state});
 try{const data=await result.evaluate((v:any)=>({panels:v.panels,coverage:v.coverage,title:v.title,readyState:v.readyState}));
  const roots=await result.getProperty('roots');return {...data,title:redactContent(data.title),panels:data.panels.map((p:Panel)=>({...p,...(p.name?{name:redactContent(p.name)}:{})})),roots};
 }finally{await result.dispose();}
}
export async function panelRoot(roots:JSHandle,id:string):Promise<ElementHandle>{
 const handle=await roots.evaluateHandle((entries:any,{id,guard})=>{const e=entries[id],el=e?.ref.deref();return el?.isConnected&&eval(`(${guard})`)(el)===e.guard?el:null;},{id,guard:PANEL_GUARD});
 const element=handle.asElement();if(!element){await handle.dispose();throw Object.assign(new Error('Panel target no longer matches the observed DOM'),{code:'scope_stale'});}return element;
}
