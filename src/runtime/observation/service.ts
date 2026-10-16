import type {Page,JSHandle,ElementHandle} from 'playwright';
import {randomBytes} from 'node:crypto';
import {captureSnapshot,type SnapshotElement} from '../snapshot';
import {referencesFor,normalizeReference} from '../references';
import {captureMap,panelRoot,type Panel} from './map';
import {DeliveryLedger,observationError,type DeliveryOptions,type Unit} from './delivery';
import {ObservationService} from '../hwm/service';
import {OBSERVATION_SEMANTIC_GUARD,type ObservationGraph} from '../hwm/observation';
import {cleanStoredJson,ObservationStore} from '../hwm/store';
import {redactContent,redactUrl} from '../../utils/strings';
import {Continuations} from './continuation';
import {captureOutline} from './outline';
import {REGION_GUARD,SCOPING_JS} from './scoping';
import {DEEP_WALK_JS} from '../../engine/page-state';
import {findGoal,type GoalFinding} from '../task/observe';
import {compactCodeBlocks} from './code-blocks';

interface Scope {session:string;document:string;page:Page;roots:JSHandle;panels:Panel[];expires:number}
export interface ReadOptions extends DeliveryOptions {at?:string;map?:string;panel?:string;want?:string;query?:string;item?:number;target?:string;offset?:number;limit?:number;textLimit?:number;byteBudget?:number;includeChildren?:boolean}
type ScopedOptions=ReadOptions&{map:string;panel:string};
const number=(value:unknown,fallback:number,max:number)=>{if(value===undefined)return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw observationError('invalid_read_budget');return n;};
const publicId=(n:ObservationGraph['nodes'][number])=>n.actionRef??n.tracking?.readTarget??'N'+(n.tracking?.id.split(':').at(-1)??n.id);
const controlCollected=['role','tag','name','nameTruncated','label','placeholder','href','redacted','value','valueTruncated','valuePreview','checked','selected','current','expanded','pressed','disabled','popup','clipped','context','hint','hintSource','viewportBox'];
const compactControl=(e:SnapshotElement)=>{const value=Object.fromEntries(Object.entries(e).filter(([k,v])=>v!==undefined&&['ref',...controlCollected].includes(k)));if(e.hint)value.hintSource='snapshot-nearby-text-v1';if(typeof e.value==='string'&&e.value.length===60)value.valuePreview=true;return value;};
const passiveMapRoles=new Set(['dialog','alertdialog','menu','menubar','listbox','tablist','radiogroup','tree','region','main','banner','contentinfo','navigation','group','list','listitem','table','row','cell','heading','status','form','search']);
const mapControl=(e:SnapshotElement)=>['input','button','select','textarea','a','label','summary'].includes(e.tag)||!passiveMapRoles.has(e.role??'');
const mapPriority=(e:SnapshotElement)=>e.current&&e.current!=='false'?-1:['searchbox','textbox','combobox'].includes(e.role??'')?0:e.role==='button'?1:2;
/** Live selective reads plus scoped, explicit delivery receipts; no learning dependency. */
export class DemandObservationService {
 private scopes=new Map<string,Scope>();private ledger:DeliveryLedger;private continuations:Continuations;private ttl:number;private clock:()=>number;
 readonly detailed:ObservationService;
 async find(page:Page,session:string,input:unknown,options:DeliveryOptions={}){
  this.ledger.validate(session,referencesFor(page).documentIdentity(),options);
  const found=await findGoal(page,input);if(!found.ok)return found;
  return this.deliverGoal(session,found,options);
 }
 private deliverGoal(session:string,found:GoalFinding,options:DeliveryOptions={}){
  const units=found.candidates.map(c=>({key:found.document+'/'+c.ref,data:{id:c.ref!,...c},collected:[...controlCollected,'text','textTruncated','nameSource','owner','local','match','actionable']}));
  const {data,...receipt}=this.receipt(session,found.document!,units,options);
  return {...found,...receipt,candidates:data.map(({id,...c})=>({ref:id,...c}))};
 }
 goalResult(page:Page,session:string,result:any,options:any={}){
  const output=this.result(page,session,result,options);
  if(result.finding?.ok&&result.finding.document===referencesFor(page).documentIdentity()){
   try{
   const finding=this.deliverGoal(session,result.finding,{since:output.delivery,consumer:output.consumer});
   const {delivery,consumer,...evidence}=finding;output.finding=evidence;output.delivery=delivery;output.consumer=consumer;
   if(options.map&&output.at)output.at=this.at(page,session,{map:options.map,panel:options.panel,delivery,consumer});
   }catch{output.observationError='goal_delivery_unavailable';}
  }
  return output;
 }
 constructor(options:{clock?:()=>number;ttlMs?:number;detailed?:ObservationService}={}){
  this.clock=options.clock??Date.now;this.ttl=options.ttlMs??300000;this.ledger=new DeliveryLedger(this.ttl,this.clock);
  this.continuations=new Continuations(this.clock,this.ttl);
  this.detailed=options.detailed??new ObservationService(new ObservationStore({maxBytes:14*1024*1024}));
 }
 private async prune(){for(const [id,s]of this.scopes)if(s.expires<=this.clock()||s.page.isClosed()){this.scopes.delete(id);await s.roots.dispose().catch(()=>{});}}
 private async scope(page:Page,session:string,map:string){await this.prune();const s=this.scopes.get(map);if(!s)throw observationError('scope_expired');if(s.session!==session||s.page!==page)throw observationError('scope_mismatch');if(s.document!==referencesFor(page).documentIdentity())throw observationError('scope_stale');return s;}
 prepare(page:Page,session:string,input:any){
  if(!input.at)return {...input,_deliveryDocument:referencesFor(page).documentIdentity()};
  if(input.map!==undefined||input.since!==undefined||input.consumer!==undefined)throw observationError('conflicting_continuation');
  const value=this.continuations.resolve(page,session,referencesFor(page).documentIdentity(),input.at);
  const scope=this.scopes.get(value.map);if(!scope||scope.expires<=this.clock())throw observationError('scope_expired');
  if(scope.page!==page||scope.session!==session||scope.document!==referencesFor(page).documentIdentity())throw observationError('scope_stale');
  this.ledger.validate(session,scope.document,value);
  if(value.panel&&input.panel&&value.panel!==input.panel)throw observationError('continuation_scope_mismatch');
  return {...value,...input,map:value.map,panel:input.panel??value.panel,target:input.target??value.target,item:input.item??value.item,since:value.since,consumer:value.consumer,_deliveryDocument:referencesFor(page).documentIdentity()};
 }
 private scoped(page:Page,session:string,input:ReadOptions):ScopedOptions{const value=this.prepare(page,session,input);if(!value.map||!value.panel)throw observationError('scope_required');return value;}
 private at(page:Page,session:string,value:{map:string;panel?:string;target?:string;item?:number;delivery?:string;consumer?:string}){return this.continuations.issue(page,session,referencesFor(page).documentIdentity(),{map:value.map,panel:value.panel,target:value.target,item:value.item,since:value.delivery,consumer:value.consumer});}
 async map(page:Page,session:string,input:DeliveryOptions&{at?:string;offset?:number}={}){
  const options=this.prepare(page,session,input);
  await this.prune();const document=referencesFor(page).documentIdentity(),captured=await captureMap(page,number(options.offset,0,10000));
  if(document!==referencesFor(page).documentIdentity()){await captured.roots.dispose();throw observationError('scope_stale');}
  while(this.scopes.size>=16){const key=this.scopes.keys().next().value!;await this.scopes.get(key)!.roots.dispose().catch(()=>{});this.scopes.delete(key);}
  const same=[...this.scopes].find(([,s])=>s.page===page&&s.session===session&&s.document===document&&JSON.stringify(s.panels.filter(p=>!p.section).map(p=>[p.id,p.identity,p.role,p.parent]))===JSON.stringify(captured.allPanels.map((p:Panel)=>[p.id,p.identity,p.role,p.parent])));
  const map=same?.[0]??'M'+randomBytes(6).toString('hex');
  if(same){const sections=same[1].panels.filter(p=>p.section);await captured.roots.evaluate((fresh:any,old:any)=>{for(const [id,e]of Object.entries(old) as [string,any][])if(e.section&&e.ref?.deref()?.isConnected)fresh[id]=e;},same[1].roots);captured.allPanels.push(...sections);await same[1].roots.dispose().catch(()=>{});}
  this.scopes.set(map,{page,session,document,roots:captured.roots,panels:captured.allPanels,expires:this.clock()+this.ttl});
  try{
   const panels:any[]=[],units:Unit[]=[],seenRefs=new Set<string>();let remaining=12;
   for(const p of captured.panels){const root=await panelRoot(captured.roots,p.id);try{
    const snap=await captureSnapshot(page,{root,boundaries:captured.roots,context:false,lightweight:true,maxVisits:160,limit:12,waitMs:0});
    const controls=remaining>0?snap.elements.filter(e=>mapControl(e)&&!seenRefs.has(e.ref!)).sort((a,b)=>mapPriority(a)-mapPriority(b)).slice(0,Math.min(2,remaining)).map(compactControl):[];for(const c of controls)seenRefs.add(c.ref as string);remaining-=controls.length;
    const {identity,...panel}=p;panels.push({...panel,...(controls.length?{controls}:{}),more:'read'});
    units.push({key:map+'/'+p.id,data:{id:p.id,...panel,more:'read'},collected:['name','boundary']});
    for(const control of controls)units.push({key:document+'/'+control.ref,data:{id:control.ref,kind:'control',...control,parent:p.id},collected:controlCollected});
   }finally{await root.dispose();}}
   const url=new URL(page.url()),rawUrl=url.origin==='null'?url.href:url.origin+url.pathname,safeUrl=redactUrl(rawUrl),pageFacts={id:'PAGE',title:captured.title,url:safeUrl,queryAvailable:Boolean(url.search),...(safeUrl!==rawUrl?{redacted:['url']}:{})};
   units.push({key:map+'/PAGE',data:pageFacts,collected:['redacted']});const delivered=this.receipt(session,document,units,options);
   const changed=delivered.data,outputPanels=panels.flatMap(p=>{const patch=changed.find(d=>d.id===p.id),controls=(p.controls??[]).flatMap((c:any)=>{const d=changed.find(d=>d.id===c.ref);return d?[d]:[];});if(!patch&&!controls.length)return [];return [{id:p.id,...patch,...(controls.length?{controls}:{} )}];});
   const facts=changed.find(d=>d.id==='PAGE');const {data,...receipt}=delivered;
   return {ok:true,kind:'map',map,at:this.at(page,session,{map,...receipt}),source:'live',document,...(facts?Object.fromEntries(Object.entries(facts).filter(([k])=>k!=='id')):{}),coverage:captured.coverage,panels:outputPanels,...receipt,...(!options.since?{next:['read --at HANDLE --panel PANEL --want outline|controls|content|state','explain: scoped HWM']}:{})};
  }catch(e){await captured.roots.dispose().catch(()=>{});this.scopes.delete(map);throw e;}
 }
 private receipt(session:string,document:string,units:Unit[],options:DeliveryOptions){return this.ledger.publish(session,document,units,options);}
 private async root(page:Page,session:string,options:ScopedOptions){
  const scope=await this.scope(page,session,options.map);if(!scope.panels.some(p=>p.id===options.panel))throw observationError('panel_not_found');
  const panel=scope.panels.find(p=>p.id===options.panel)!;
  const anchor=await panelRoot(scope.roots,options.panel);let section:JSHandle|undefined;
  let root=anchor;
  if(panel.section){
   try{section=await scope.roots.getProperty(options.panel);if(!await section.evaluate((e:any)=>e.ref?.deref()?.textContent===e.headingText&&e.level!==null))throw observationError('scope_stale');const h=await section.evaluateHandle((e:any,guard)=>{const r=e.scopeRoot?.deref();return r?.isConnected&&eval(`(${guard})`)(r)===e.scopeGuard?r:null;},REGION_GUARD);const el=h.asElement();if(!el){await h.dispose();throw observationError('scope_stale');}root=el;}catch(e){await section?.dispose();await anchor.dispose();throw e;}await anchor.dispose();
  }
  if(options.item!==undefined||options.target){try{
   let selected:ElementHandle|null=null;
   if(options.target){const target=normalizeReference(options.target),actionRef=/^e\d+$/.test(target);if(!actionRef&&!/^N\d+$/.test(target))throw observationError('invalid_read_target');
    const references=referencesFor(page);if(actionRef){const resolved=await references.resolve(target);if(!('locator' in resolved))throw observationError('stale_ref');}const state=await references.snapshotState();
    const h=await state.state.evaluateHandle((s:any,{target,actionRef,root,guard})=>{const entry=actionRef?null:s.observedTargets?.get(Number(target.slice(1))),n=actionRef?s.targets?.get(target)?.deref():entry?.node.deref();if(!actionRef&&(!n||entry.guard===null||entry.guard!==eval(`(${guard})`)(n)))return null;const el=n?.nodeType===3?(n.parentElement||n.getRootNode().host):n;if(!el?.isConnected)return null;for(let p=el;p;p=p.parentElement||p.getRootNode().host)if(p===root)return el;return null;},{target,actionRef,root,guard:OBSERVATION_SEMANTIC_GUARD});selected=h.asElement();if(!selected)await h.dispose();
   }else{const item=number(options.item,1,10000);if(item<1)throw observationError('invalid_item');
    const h=await root.evaluateHandle((el,item)=>{const selector='li,[role=listitem],article,tr,[role=row]';const all=[...(el as Element).querySelectorAll(selector)];return all.filter(n=>{const ancestor=n.parentElement?.closest(selector);return !ancestor||!el.contains(ancestor);})[item-1]??null;},item);selected=h.asElement();if(!selected)await h.dispose();
   }
   if(!selected)throw observationError('read_target_not_found');
   if(section){const allowed=await page.evaluate(({script,opts,node})=>eval(script)(opts,node),{script:`(opts,node)=>{${DEEP_WALK_JS}${SCOPING_JS}return scopeSelected(node);}`,opts:{root,section,boundaries:scope.roots,includeChildren:options.includeChildren},node:selected});if(!allowed){await selected.dispose();throw observationError('read_target_not_found');}await section.dispose();section=undefined;}
   await root.dispose();return {root:selected,scope,section};
  }catch(e){await section?.dispose();await root.dispose();throw e;}}
  return {root,scope,section};
 }
 async read(page:Page,session:string,input:ReadOptions){
  const options=this.scoped(page,session,input),want=(options.want??'controls').split(',');if(want.some(w=>!['outline','controls','content','state'].includes(w)))throw observationError('invalid_read_fields');
  if(want.includes('outline')){if(want.length!==1)throw observationError('outline_requires_separate_read');return this.outline(page,session,options);}
  const limit=number(options.limit,60,2000),offset=number(options.offset,0,10000);if(!limit)throw observationError('invalid_read_budget');
  const {root,scope,section}=await this.root(page,session,options);
  try{
   const graphNeeded=want.includes('content')||want.includes('state');
   const snapshot=await captureSnapshot(page,{root,section,boundaries:scope.roots,includeChildren:options.includeChildren,context:graphNeeded,lightweight:true,limit:Math.min(600,graphNeeded?limit+offset:limit),...(graphNeeded?{}:{controlOffset:offset}),contextLimit:Math.min(6000,Math.max(300,(limit+offset)*4)),scope:options.map+'/'+options.panel,query:options.query,waitMs:0});
   if(scope.document!==referencesFor(page).documentIdentity()||!await root.evaluate(el=>el.isConnected))throw observationError('scope_stale');
   let units:Unit[]=[];let complete=snapshot.observation?.complete!==false&&!snapshot.truncated;
   if(snapshot.contextGraph){const g=snapshot.contextGraph;this.detailed.remember(session,g);complete=complete&&g.scan.complete;units=this.units(g,want,Boolean(options.query));
    if(options.query){const byId=new Map(g.nodes.map(n=>[n.id,n])),children=new Map<string,typeof g.nodes>(),textCounts=new Map<string,number>(),textLengths=new Map<string,number>();
     for(const n of g.nodes)if(n.parent){const list=children.get(n.parent)??[];list.push(n);children.set(n.parent,list);}
     for(const n of [...g.nodes].reverse()){const count=(textCounts.get(n.id)??0)+(n.text?1:0),length=(textLengths.get(n.id)??0)+(n.text?.length??0);textCounts.set(n.id,count);textLengths.set(n.id,length);if(n.parent){textCounts.set(n.parent,(textCounts.get(n.parent)??0)+count);textLengths.set(n.parent,(textLengths.get(n.parent)??0)+length);}}
     const matches=new Set(g.matches.map(m=>m.node)),keep=new Set<string>(),expanded=new Set<string>();for(const n of g.nodes)if(matches.has(n.id)){
     let owner=n;for(let p=byId.get(n.parent??'');p;p=byId.get(p.parent??''))if(['heading','item','row','paragraph','fieldset'].includes(p.kind)||p.tag==='dt'||p.tag==='dd'){owner=p;break;}
     if(owner===n)for(let p=byId.get(n.parent??'');p&&p.kind!=='document'&&p.kind!=='region';p=byId.get(p.parent??'')){const length=textLengths.get(p.id)??0;if(p.kind==='group'&&(textCounts.get(p.id)??0)>=2&&length<=1000&&length>(n.text?.length??options.query.length)+8){owner=p;break;}}
     if(owner.kind==='heading'){const start=g.nodes.indexOf(owner),level=Number(owner.attrs.level);let end=g.nodes.findIndex((m,i)=>i>start&&m.kind==='heading'&&Number(m.attrs.level)<=level);if(end<0)end=g.nodes.length;g.nodes.slice(start,end).forEach(m=>keep.add(m.id));}
     else {const roots=new Set([owner.id]);if(owner.tag==='dt'){const siblings=children.get(owner.parent??'')??[];for(let i=siblings.findIndex(m=>m.id===owner.id)+1;i<siblings.length&&siblings[i].tag==='dd';i++)roots.add(siblings[i].id);}
      const stack=[...roots];while(stack.length){const id=stack.pop()!;if(expanded.has(id))continue;expanded.add(id);keep.add(id);for(const child of children.get(id)??[])stack.push(child.id);}}
     let cur:typeof n|undefined=n;while(cur){keep.add(cur.id);cur=byId.get(cur.parent??'');}}
     const matchedKeys=new Set(g.nodes.filter(n=>keep.has(n.id)).map(publicId));units=units.filter(u=>matchedKeys.has(u.data.id)||u.data.ref&&snapshot.elements.some(e=>e.ref===u.data.ref));
     const matchFields=new Map<string,{field:string;transform?:string}[]>();for(const {node,field,transform} of g.matches){const n=byId.get(node);if(n){const id=publicId(n),list=matchFields.get(id)??[];list.push({field,...(transform?{transform}:{})});matchFields.set(id,list);}}
     for(const unit of units){const matches=matchFields.get(unit.data.id);unit.collected=[...new Set([...(unit.collected??[]),'match'])];if(matches?.length)unit.data.match=matches;}
    }
   }else units=snapshot.elements.map(e=>({key:scope.document+'/'+e.ref,data:{id:e.ref,kind:'control',...compactControl(e)},collected:controlCollected}));
   if(want.includes('content')&&snapshot.contextGraph)units=compactCodeBlocks(snapshot.contextGraph,units,publicId);
   const textLimit=number(options.textLimit,1200,120000),byteBudget=number(options.byteBudget,12000,200000);if(textLimit<1||byteBudget<1500)throw observationError('invalid_read_budget');
   const total=graphNeeded?units.length:snapshot.controlPage?.total??units.length,shown:Unit[]=[];let used=1000,textTruncated=false,requiredByteBudget=0;
   for(const raw of units.slice(graphNeeded?offset:0,(graphNeeded?offset:0)+limit)){const unit=structuredClone(raw);for(const field of ['text','name','display','value'])if(typeof unit.data[field]==='string'){
     unit.collected=[...new Set([...(unit.collected??[]),field+'Truncated',field+'Length'])];
     const chars=Array.from(unit.data[field]);if(chars.length>textLimit){unit.data[field+'Truncated']=true;unit.data[field]=chars.slice(0,textLimit).join('');unit.data[field+'Length']=chars.length;textTruncated=true;}
    }const cost=Buffer.byteLength(JSON.stringify(unit.data));if(used+cost>byteBudget){if(!shown.length)requiredByteBudget=1000+cost;break;}used+=cost;shown.push(unit);
   }
   const coverage={complete:complete&&!textTruncated&&offset===0&&total<=shown.length,observed:total,shown:shown.length,...(textTruncated?{textTruncated:true,detail:'read target with larger textLimit/byteBudget'}:{}),...(requiredByteBudget?{requiredByteBudget,target:units[graphNeeded?offset:0]?.data.id,detail:'increase byteBudget or reduce textLimit'}:total>offset+shown.length?{nextOffset:offset+shown.length}:{})};
   const delivered=this.receipt(session,scope.document,shown,options);
   const children=scope.panels.filter(p=>!p.section&&p.parent===options.panel).map(({identity,...p})=>p);
   const at=this.at(page,session,{map:options.map,panel:options.panel,target:options.target,item:options.item,...delivered});
   return {ok:true,kind:'read',map:options.map,panel:options.panel,at,source:'live',want,extent:options.includeChildren?'subtree':'own',...(children.length&&!options.includeChildren?{boundaries:{excludedPanels:children.length,next:'read --at HANDLE --want outline'}}:{}),...(options.query?{query:options.query}:{}),capturedAt:snapshot.capturedAt,coverage,...delivered,...(snapshot.hidden?.length?{hidden:snapshot.hidden}:{}),...(snapshot.collapsed?.length?{collapsed:snapshot.collapsed}:{}),...(delivered.known?{comparison:'same-delivered-fields-read-now'}:{}),...('nextOffset' in coverage?{nextRead:{at,want:want.join(','),query:options.query,item:options.item,offset:coverage.nextOffset,includeChildren:options.includeChildren,source:'live'}}:{})};
  }finally{await section?.dispose();await root.dispose();}
 }
 private units(g:ObservationGraph,want:string[],groups=false):Unit[]{
  const content=want.includes('content'),controls=want.includes('controls'),state=want.includes('state'),kept=new Map<string,string>(),units:Unit[]=[];
  const byId=new Map(g.nodes.map(n=>[n.id,n])),childCounts=new Map<string,number>();for(const n of g.nodes)if(n.parent)childCounts.set(n.parent,(childCounts.get(n.parent)??0)+1);
  for(const n of g.nodes){if(n.kind==='document')continue;let parent=n.parent;while(parent&&!kept.has(parent))parent=byId.get(parent)?.parent??null;
   const stateKeys=['value','checked','selected','selected-complete','current','expanded','pressed','disabled','busy','open','aria-hidden'];
   const isState=state&&stateKeys.some(k=>k in n.attrs),isControl=(controls||state)&&['control','link'].includes(n.kind),isContent=content&&(['region','heading','paragraph','text','list','item','table','row','cell','form','fieldset','dialog','link','image'].includes(n.kind)||['dl','dt','dd'].includes(n.tag??''));
   if(!isState&&!isControl&&!isContent&&!(content&&('aria-hidden' in n.attrs||n.attrs.rendering))&&!(content&&groups&&n.kind==='group'&&((childCounts.get(n.id)??0)>1||n.role||n.attrs['layout-boundary'])))continue;
   const id=publicId(n),data:Record<string,any>={id,kind:n.kind,parent:parent?kept.get(parent):'panel'};
   if(n.role)data.role=n.role;if(n.name!==undefined)data.name=n.name;else if(typeof n.attrs.display==='string')data.display=n.attrs.display;
   if(content&&'aria-hidden' in n.attrs)data['aria-hidden']=n.attrs['aria-hidden'];if(content&&n.attrs.rendering)data.rendering=n.attrs.rendering;
   if(isControl&&!data.name&&!data.display&&Array.isArray(n.attrs.box))data.viewportBox=n.attrs.box.map(v=>typeof v==='number'?Math.round(v):v);
   if(['dl','dt','dd'].includes(n.tag??''))data.tag=n.tag;
   if(content&&n.text!==undefined)data.text=n.text;if(n.actionRef)data.ref=n.actionRef;
   if(n.kind==='heading')data.level=n.attrs.level;
   if((content||controls)&&typeof n.attrs.href==='string')data.href=n.attrs.href;
   if(controls||state)for(const k of stateKeys)if(k in n.attrs)data[k]=k==='selected'&&Array.isArray(n.attrs[k])?(n.attrs[k] as string[]).map(id=>{const member=g.nodes.find(m=>m.id===id);return member?publicId(member):id;}):n.attrs[k];
   if(n.attrs.redactedFields)data.redacted=n.attrs.redactedFields;
   if(n.attrs.view)data.view=n.attrs.view;
   const collected=['role','name','display','ref','redacted','view','viewportBox',...(content?['text','tag','level','href','aria-hidden','rendering']:[]),...(controls||state?[...stateKeys,'valuePreview']:[])];
   kept.set(n.id,id);units.push({key:n.actionRef?g.document+'/'+n.actionRef:g.scan.scope+'/'+n.tracking?.id+'/'+n.tracking?.semantic+'/'+id,data,collected});
  }
  if(state&&g.state){units.push({key:g.document+'/url',data:{id:'URL',kind:'url',params:g.state.params}});for(const status of g.state.status){const n=g.nodes.find(n=>n.id===status.node);if(n)units.push({key:g.document+'/status/'+n.tracking?.id,data:{id:publicId(n),kind:'status',text:status.display??'','text-complete':status.complete}});}}
  return units;
 }
 async explain(page:Page,session:string,input:ReadOptions){const options=this.scoped(page,session,input),{root,scope,section}=await this.root(page,session,options);try{
  const snapshot=await captureSnapshot(page,{root,section,boundaries:scope.roots,includeChildren:options.includeChildren,context:true,lightweight:true,scope:options.map+'/'+options.panel,query:options.query,limit:24,contextLimit:800,waitMs:0});
  if(scope.document!==referencesFor(page).documentIdentity())throw observationError('scope_stale');if(!snapshot.contextGraph)throw observationError('capture_failed');
  const remembered=this.detailed.remember(session,snapshot.contextGraph);if(!remembered.ok)throw observationError(remembered.reason);
  const requested=number(options.limit,60,2000),byteBudget=number(options.byteBudget,16000,200000);let rendered=this.detailed.view(session,snapshot.contextGraph.observation,{mode:'overview',nodeBudget:requested}),detailBytes=Buffer.byteLength(rendered.hwm),fitted=rendered,selected=requested;
  if(detailBytes>byteBudget){let low=1,high=Math.max(0,requested-1),found=false;while(low<=high){const mid=Math.floor((low+high)/2),candidate=this.detailed.view(session,snapshot.contextGraph.observation,{mode:'overview',nodeBudget:mid});if(Buffer.byteLength(candidate.hwm)<=byteBudget){fitted=candidate;selected=mid;found=true;low=mid+1;}else high=mid-1;}
   if(!found)return {ok:false,execution:'completed',kind:'explain',reason:'detail_budget_exceeded',map:options.map,panel:options.panel,observation:rendered.observation,detailBytes,byteBudget,hint:'Narrow --item/--target, or explicitly raise --byte-budget. The observation is stored; nothing was executed again.'};
  }
  return {kind:'explain',map:options.map,panel:options.panel,at:input.at,...fitted,...(selected<requested?{byteLimited:true,nodeBudget:selected}:{})};
 }finally{await section?.dispose();await root.dispose();}}
 private async outline(page:Page,session:string,options:ScopedOptions){
  const {root,scope,section}=await this.root(page,session,options);
  try{
   const offset=number(options.offset,0,10000),limit=number(options.limit,24,24);if(!limit)throw observationError('invalid_read_budget');
   const captured=await captureOutline(page,root,scope.roots,{panel:options.panel,query:options.query,offset,limit,includeChildren:options.includeChildren,section});
   if(scope.document!==referencesFor(page).documentIdentity())throw observationError('scope_stale');
   const retained=new Set(captured.retainedSections);scope.panels=scope.panels.filter(p=>!p.section||retained.has(p.id));
   for(const h of captured.items)if(h.level!==null&&!scope.panels.some(p=>p.id===h.id))scope.panels.push({id:h.id,role:'section',section:true,name:h.name,parent:options.panel,basis:'heading-outline-v1',position:'unknown'});
   const children=scope.panels.filter(p=>!p.section&&p.parent===options.panel).filter(p=>!options.query||p.name?.toLowerCase().includes(options.query.toLowerCase())).map(({identity,...p})=>p);
   const units:Unit[]=[],shown:typeof captured.items=[];let bytes=700;let childrenShown=0;
   for(const p of children.slice(0,8)){const data={...p,kind:'panel'},size=Buffer.byteLength(JSON.stringify(data))+50;if(bytes+size>1800)break;bytes+=size;childrenShown++;units.push({key:options.map+'/'+p.id,data,collected:['name','boundary','parent']});}
   for(const h of captured.items){const data={id:h.id,kind:'section',name:h.name,level:h.level,basis:'heading-outline-v1',...(h.parent?{headingParent:h.parent}:{}),...(h.nameTruncated?{nameTruncated:true}:{}),...(h.level===null?{readable:false,reason:'heading-level-unknown'}:{})};const size=Buffer.byteLength(JSON.stringify(data))+50;if(bytes+size>4000)break;bytes+=size;shown.push(h);units.push({key:options.map+'/'+h.id,data,collected:['nameTruncated','headingParent']});}
   const delivered=this.receipt(session,scope.document,units,options),at=this.at(page,session,{map:options.map,panel:options.panel,...delivered});
   const data=delivered.data.map(d=>({...d,...(scope.panels.some(p=>p.id===d.id)?{at:this.at(page,session,{map:options.map,panel:d.id,...delivered})}:{})}));
   return {ok:true,kind:'outline',map:options.map,panel:options.panel,at,source:'live',want:['outline'],extent:options.includeChildren?'subtree':'own',...(options.query?{query:options.query}:{}),rule:'heading-outline-v1',childrenCoverage:{observed:children.length,shown:childrenShown,complete:childrenShown===children.length},...delivered,data,coverage:{complete:captured.complete&&offset===0&&shown.length===captured.total&&childrenShown===children.length,observed:captured.total,shown:shown.length,...(offset+shown.length<captured.total?{nextOffset:offset+shown.length}:{})},...(offset+shown.length<captured.total?{nextRead:{at,want:'outline',query:options.query,offset:offset+shown.length,limit,includeChildren:options.includeChildren,source:'live'}}:{})};
  }finally{await section?.dispose();await root.dispose();}
 }
 /** Read-only enrichment. Execution outcomes survive every observation error. */
 async afterAction(page:Page,session:string,result:any,options:any={}){
  const regions=result.effect?.page?.regions as Array<{id:number;role:string}>|undefined;
  const output:any=this.result(page,session,result,options);if(output.effect?.page)delete output.effect.page.regions;
  let temporaryRoots:JSHandle|undefined;
  try{
   if(output.execution==='not_started')return output;
   const document=referencesFor(page).documentIdentity();
   if(options._deliveryDocument&&options._deliveryDocument!==document){const map=await this.map(page,session,{consumer:options.consumer});return {...output,delivery:map.delivery,consumer:map.consumer,at:map.at,focus:map};}
   if(regions?.length){
    const state=await referencesFor(page).snapshotState();
    const roots=await state.state.evaluateHandle((s:any,{regions,guard})=>{const entries:any={};for(const [i,r]of regions.entries()){const e=s.regionTargets?.get(r.id),el=e?.ref.deref();if(el?.isConnected&&eval(`(${guard})`)(el)===e.guard)entries['P'+(i+1)]={ref:new WeakRef(el),guard:e.guard};}return entries;},{regions,guard:REGION_GUARD});
    temporaryRoots=roots;
    const valid=await roots.evaluate((entries:any)=>Object.keys(entries));if(!valid.length){await roots.dispose();return output;}
    const panels:Panel[]=await roots.evaluate((entries:any)=>Object.entries(entries).map(([id,e]:[string,any])=>{const el=e.ref.deref();return {id,role:el.getAttribute('role')||el.localName,name:el.getAttribute('aria-label')||el.querySelector('h1,h2,h3,[role=heading]')?.textContent||'',basis:el.hasAttribute('role')?'aria':'html',position:'observed-after'};}));
    for(const p of panels){p.identity=regions[Number(p.id.slice(1))-1].id;p.name=redactContent(p.name??'').slice(0,120);}
    const origin=options.map?this.scopes.get(options.map):undefined;
    const compatible=(s:Scope)=>s.page===page&&s.session===session&&s.document===document&&s.expires>this.clock();
    const originMatches=origin&&compatible(origin)&&panels.every(p=>origin.panels.some(old=>!old.section&&old.identity===p.identity));
    const same=originMatches?[options.map,origin] as [string,Scope]:[...this.scopes].find(([,s])=>{const base=s.panels.filter(p=>!p.section);return compatible(s)&&base.length===panels.length&&base.every((p,i)=>p.identity===panels[i].identity);});
    let map:string;
    if(same){map=same[0];await roots.dispose();}else{while(this.scopes.size>=16){const key=this.scopes.keys().next().value!;await this.scopes.get(key)!.roots.dispose().catch(()=>{});this.scopes.delete(key);}map='M'+randomBytes(6).toString('hex');this.scopes.set(map,{page,session,document,roots,panels,expires:this.clock()+this.ttl});}temporaryRoots=undefined;
    if(same)for(const p of panels)p.id=same[1].panels.find(old=>!old.section&&old.identity===p.identity)!.id;
    const focused=this.scopes.get(map)!;const foci:any[]=[];
    for(const p of panels){
     const base={map,panel:p.id,since:output.delivery,consumer:output.consumer};
     if(map===options.map&&p.id===options.panel){const read=await this.read(page,session,{...base,want:'content,controls,state',limit:60,byteBudget:4000});output.delivery=read.delivery;output.consumer=read.consumer;foci.push({role:p.role,name:p.name,...read});continue;}
     const root=await panelRoot(focused.roots,p.id);try{
      const snapshot=await captureSnapshot(page,{root,context:false,lightweight:true,limit:9,maxVisits:512,waitMs:0});
      const controls=snapshot.elements.filter(e=>mapControl(e));const small=panels.length===1&&['menu','listbox'].includes(p.role)&&controls.length<=8&&!snapshot.truncated&&snapshot.observation?.complete!==false&&Buffer.byteLength(JSON.stringify(controls.map(compactControl)))<=2000;
      const selected=(small?controls:controls.slice(0,2)).map(compactControl);
      const delivered=this.receipt(session,document,selected.map(c=>({key:document+'/'+c.ref,data:{id:c.ref,kind:'control',...c},collected:controlCollected})),{since:output.delivery,consumer:output.consumer});output.delivery=delivered.delivery;output.consumer=delivered.consumer;
      const at=this.at(page,session,{map,panel:p.id,...delivered});foci.push({map,panel:p.id,at,role:p.role,...(p.name?{name:p.name}:{}),source:'observed-after',...(small?{items:delivered.data}:{controls:delivered.data,next:'read --at HANDLE --want controls|content|state'}),coverage:{complete:small,shown:selected.length,observed:snapshot.controlPage?.total??controls.length}});
     }finally{await root.dispose();}
    }
    output.focus=foci.length===1?foci[0]:foci;output.at=foci.length===1?this.at(page,session,{map,panel:panels[0].id,delivery:output.delivery,consumer:output.consumer}):this.at(page,session,{map,delivery:output.delivery,consumer:output.consumer});
   }
  }catch(e:any){output.observationError=e.code??'focused-observation-failed';}finally{await temporaryRoots?.dispose().catch(()=>{});}
  return output;
 }
 result(page:Page,session:string,result:any,options:DeliveryOptions&{ref?:string;map?:string;panel?:string;target?:string;item?:number}={}){
  const output:any=cleanStoredJson(JSON.parse(JSON.stringify(result)));for(const field of ['snapshot','hwm','changes','log','stack'])delete output[field];
  const units:Unit[]=[];if(options.ref&&output.execution!=='not_started'){
   const data:Record<string,any>={id:options.ref};for(const [field,change]of Object.entries(output.effect?.targetChanged??{}))if(change&&typeof change==='object'&&'after' in change)data[field]=(change as any).after;
   if(Object.keys(data).length>1)units.push({key:referencesFor(page).documentIdentity()+'/'+options.ref,data});
  }
  let receipt:any={};try{const {data,...meta}=this.receipt(session,referencesFor(page).documentIdentity(),units,options);receipt=meta;}catch(e:any){receipt={deliveryReset:e.code??'delivery_unavailable'};}
  return {kind:'result',...output,...receipt,...(options.map&&receipt.delivery?{at:this.at(page,session,{map:options.map,panel:options.panel,target:options.target,item:options.item,...receipt})}:{}),scope:'reported-effects',...(output.reason==='ambiguous'?{next:'read candidates or explain the target panel'}:{})};
 }
 async clearSession(session:string){for(const [id,s]of this.scopes)if(s.session===session){this.scopes.delete(id);await s.roots.dispose().catch(()=>{});}this.ledger.clearSession(session);this.continuations.clearSession(session);this.detailed.clearSession(session);}
 async close(){for(const s of this.scopes.values())await s.roots.dispose().catch(()=>{});this.scopes.clear();this.ledger.clear();this.continuations.clear();}
}
