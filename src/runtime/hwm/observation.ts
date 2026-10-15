import type { Json } from './view';
import { redactContent, redactUrl } from '../../utils/strings';
import { createHash } from 'node:crypto';

export interface ObservationNode {
  id: string; kind: string; parent: string | null; order: number;
  tag?: string; role?: string; text?: string; textSource?: string;
  name?: string; nameSource?: string; actionRef?: string;
  tracking?: { id: string; semantic: string | null; source: 'dom-weakmap-v1'; semanticEncoding?: 'sha256'; readTarget?: string };
  attrs: Record<string, Json>;
}
export interface ObservationGraph {
  version: '0.2'; observation: string; capturedAt: string; url: string; document: string;
  scan: { scope: string; complete: boolean }; nodes: ObservationNode[];
  edges: { from: string; rel: string; to: string; basis: string; source: string }[];
  gaps: { id: string; kind: string; reason: string; parent: string; field?: string }[];
  query?: string; matches: { node: string; field: string; transform?: string }[];
  discovery?:Record<string,Json>;
  facts?: { title: string; lang: string; readyState: string; viewport: { width: number; height: number }; scroll: [number,number] };
  outline?: { node: string; level: number; parts: string[]; paras: { min:number; exact:boolean }; links: { min:number; exact:boolean }; tables: { min:number; exact:boolean } }[];
  state?: {
    params: [string,string][]; complete: boolean;
    fields: { node: string; form?: string; value?: Json; redacted?: boolean; checked?: Json }[];
    groups: { node: string; selected: string[] | null; complete: boolean }[];
    status: { node: string; parts: string[]; complete: boolean; display?: string }[];
  };
}

/** Structural identity boundary, not mutable content/value equality. Used at issue and resolve. */
export const OBSERVATION_SEMANTIC_GUARD = `dom=>{
  const chain=[];let el=dom.nodeType===1?dom:dom.parentElement;
  for(let depth=0;el&&depth<64;depth++,el=el.parentElement||el.getRootNode().host)
    chain.push([el.localName,...['id','data-key','data-id','href','role','type'].map(k=>el.getAttribute(k))]);
  return el?null:JSON.stringify(chain);
}`;
/** Called inside the existing snapshot evaluation, before the page can change between captures. */
export const CONTEXT_COLLECTOR = `(opts, picked, queryNodes=[]) => {
  const nodes=[{id:'n1',kind:'document',parent:null,order:0,attrs:{}}], edges=[], gaps=[], matches=[];
  const ids=new WeakMap(), elementById=new Map(), seen=new WeakSet(), orders=new Map(), refNodes=new Map(picked.map(m=>[m.el,m.entry]));
  const limit=opts.contextLimit, textLimit=120000; let textCount=0, visits=0, complete=true;
  const required=new Set();for(const {el}of picked)for(let p=el;p&&p!==document.documentElement;p=p.parentElement||p.getRootNode().host)required.add(p);
  for(const {el}of picked){const local=[el,...[el.previousSibling,el.nextSibling].filter(Boolean)],owner=el.closest('li,p,tr,fieldset,[role=dialog],dialog');if(owner)local.push(owner);let count=0;while(local.length&&count++<32){const node=local.pop();required.add(node);if(node.childNodes)for(const child of Array.from(node.childNodes).reverse())local.push(child);}}
  for(const dom of queryNodes){required.add(dom);for(let p=dom.parentElement;p&&p!==document.documentElement;p=p.parentElement||p.getRootNode().host)required.add(p);
    let owner=dom.parentElement?.closest('p,li,tr,dt,dd');
    if(!owner)for(let p=dom.parentElement;p&&p!==document.body;p=p.parentElement){const length=(p.textContent||'').length;if(p.childNodes.length>1&&length<=1000&&length>(dom.textContent||'').length+8){owner=p;break;}}
    owner||=dom.parentElement?.closest('article,section')||dom.parentElement;
    const local=owner?[owner]:[];if(owner?.localName==='dt')for(let d=owner.nextElementSibling;d?.localName==='dd';d=d.nextElementSibling)local.push(d);let count=0;while(local.length&&count++<64){const n=local.pop();required.add(n);for(const child of Array.from(n.childNodes||[]).reverse())local.push(child);}}
  const clean=s=>String(s||'').replace(/\\s+/g,' ').trim();
  const semanticGuard=${OBSERVATION_SEMANTIC_GUARD};
  const track=dom=>{
    if(!opts.refs?.observedIds)return undefined;
    let id=opts.refs.observedIds.get(dom);if(!id){id=opts.refs.observedNext++;opts.refs.observedIds.set(dom,id);}
    const semantic=semanticGuard(dom);let read;
    if(opts.refs.observedReadIds&&opts.refs.observedTargets){
      read=opts.refs.observedReadIds.get(dom);
      if(!read||read.guard!==semantic||!opts.refs.observedTargets.has(read.id)){
        if(read)opts.refs.observedTargets.delete(read.id);
        read={id:opts.refs.observedReadNext++,guard:semantic};opts.refs.observedReadIds.set(dom,read);
        opts.refs.observedTargets.set(read.id,{node:new WeakRef(dom),guard:semantic});
        while(opts.refs.observedTargets.size>6000)opts.refs.observedTargets.delete(opts.refs.observedTargets.keys().next().value);
      }
    }
    return {id:opts.document+':'+id,semantic,source:'dom-weakmap-v1',...(read?{readTarget:'N'+read.id}:{})};
  };
  nodes[0].tracking={id:opts.document+':document',semantic:'document',source:'dom-weakmap-v1'};
  const gap=(parent,reason,kind='unobserved',field)=>{gaps.push({id:'gap'+(gaps.length+1),kind,reason,parent,...(field?{field}:{})});if(kind!=='redacted')complete=false;};
  const kindFor=(el)=>{
    const tag=el.localName,role=el.getAttribute('role');
    if(/^h[1-6]$/.test(tag)||role==='heading')return 'heading';
    if(tag==='a'&&el.hasAttribute('href'))return 'link';
    if(/^(input|button|select|textarea|summary)$/.test(tag)||/^(button|textbox|combobox|searchbox|checkbox|radio|switch|option|tab|menuitem)$/.test(role||''))return 'control';
    return ({p:'paragraph',ul:'list',ol:'list',li:'item',table:'table',tr:'row',td:'cell',th:'cell',form:'form',fieldset:'fieldset',dialog:'dialog',img:'image',figure:'figure',iframe:'frame',main:'region',section:'region',article:'region',nav:'region',header:'region',footer:'region',aside:'region'})[tag]||'group';
  };
  const add=(data,parent)=>{const order=orders.get(parent)||0;orders.set(parent,order+1);const node={id:'n'+(nodes.length+1),parent,order,...data};nodes.push(node);return node;};
  const start=opts.root||document.body;
  const stack=start?[{dom:start,parent:'n1',pre:false}]:[];
  if(!start)gap('n1','document-not-available','unavailable');
  while(stack.length){
    const work=stack.pop(),dom=work.dom;
    if(nodes.length>=6000){gap(work.parent,'context-capacity','unavailable');break;}
    if(seen.has(dom))continue;seen.add(dom);
    if(++visits>60000){gap(work.parent,'budget');break;}
    // Mandatory descendants have their ancestry reserved. Do not traverse an
    // omitted subtree and silently flatten its rendering/privacy boundaries.
    if(nodes.length>=limit&&!required.has(dom)){if(!gaps.some(g=>g.reason==='budget'&&g.parent===work.parent))gap(work.parent,'budget');continue;}
    try{
      if(dom.nodeType===3){
        let text=work.pre?dom.data:dom.data.replace(/\\s+/g,' ');if(!text.trim())continue;
        if(textCount+text.length>textLimit){gap(work.parent,'text-budget');break;}textCount+=text.length;
        add({kind:'text',text,textSource:'dom-text',tracking:track(dom),attrs:work.via?.length?{'via-dom':work.via}:{}},work.parent);continue;
      }
      if(dom.nodeType!==1)continue;
      const el=dom,tag=el.localName;if(/^(script|style|noscript|template)$/.test(tag))continue;
      const style=styleOf(el);
      const role=el.getAttribute('role')||implicitRole(el,tag);
      const significant=/^(body|main|section|article|nav|header|footer|aside|h[1-6]|p|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|form|fieldset|legend|label|dialog|input|button|select|option|textarea|a|summary|details|img|iframe|slot|pre|code)$/.test(tag)||role||required.has(el)||el.attributes.length||el.childElementCount>1||style.overflowX!=='visible'||style.overflowY!=='visible';
      if(!significant&&style.display!=='none'&&style.visibility!=='hidden'&&!el.hidden&&!el.shadowRoot){for(const child of Array.from(el.childNodes).reverse())stack.push({dom:child,parent:work.parent,pre:work.pre,via:[...(work.via??[]),tag]});continue;}
      if(style.display==='none'||style.visibility==='hidden'||el.hidden){
        const attrs={hidden:Boolean(el.hidden),rendering:{display:style.display,visibility:style.visibility,source:'dom-cssom-v1'},...(work.via?.length?{'via-dom':work.via}:{})};
        if(kindFor(el)==='heading')attrs.level=/^h[1-6]$/.test(tag)?Number(tag.slice(1)):Number(el.getAttribute('aria-level'))||null;
        for(const k of ['id','aria-hidden','aria-busy','aria-expanded','aria-controls','aria-owns']){const v=el.getAttribute(k);if(v!==null)attrs[k]=v;}
        const node=add({kind:kindFor(el),tag,...(role?{role}:{}),tracking:track(el),attrs},work.parent);
        ids.set(el,node.id);elementById.set(node.id,el);gap(node.id,'not-rendered');continue;
      }
      const kind=kindFor(el), attrs=work.via?.length?{'via-dom':work.via}:{};
      for(const k of ['id','href','target','placeholder','type','aria-hidden','aria-live','aria-controls','aria-labelledby','aria-describedby','aria-owns']){const v=el.getAttribute(k);if(v!==null)attrs[k]=v;}
      if(style.overflowX!=='visible'||style.overflowY!=='visible'||el.scrollLeft!==0||el.scrollTop!==0)attrs['layout-boundary']={overflow:[style.overflowX,style.overflowY],client:[el.clientWidth,el.clientHeight],extent:[el.scrollWidth,el.scrollHeight],offset:[el.scrollLeft,el.scrollTop],source:'dom-cssom-v1'};
      if(kind==='heading')attrs.level=/^h[1-6]$/.test(tag)?Number(tag.slice(1)):Number(el.getAttribute('aria-level'))||null;
      const rect=rectOf(el);attrs.box=[rect.x,rect.y,rect.width,rect.height];attrs.space='n1';
      attrs.view=rect.width<=0||rect.height<=0?'no-box':rect.bottom<=0||rect.right<=0||rect.top>=innerHeight||rect.left>=innerWidth?'outside':rect.top<0||rect.left<0||rect.bottom>innerHeight||rect.right>innerWidth?'partial':'inside';
      const node=add({kind,tag,...(role?{role}:{}),tracking:track(el),attrs},work.parent);ids.set(el,node.id);elementById.set(node.id,el);
      const ref=refNodes.get(el);if(ref&&ref.ref)node.actionRef=ref.ref;
      if(ref)for(const key of ['hint','context','popup','clipped','transparent','selectedText','testId','label','nameTruncated'])if(ref[key]!==undefined)attrs[key]=ref[key];
      if(ref?.hint)attrs['hint-source']='snapshot-nearby-text-v1';if(ref?.context)attrs['context-source']='snapshot-heading-v1';
      if(ref)for(const key of ['checked','selected','expanded','pressed','disabled'])if(ref[key]!==undefined&&attrs[key]===undefined)attrs[key]=ref[key];
      // Only explicit naming sources are claimed here; legacy display names are not silently promoted.
      const aria=el.getAttribute('aria-label'), labelled=el.getAttribute('aria-labelledby');
      if(aria!==null){node.name=clean(aria);node.nameSource='aria-label';}
      else if(labelled){const root=el.getRootNode();const labels=labelled.split(/\\s+/).map(id=>root.getElementById?.(id));if(labels.every(Boolean)){node.name=clean(labels.map(e=>e.textContent).join(' '));node.nameSource='labelledby';}else attrs.uncollected=['accessible-name'];}
      else if(el.labels&&el.labels.length){node.name=clean(Array.from(el.labels).map(labelText).join(' '));node.nameSource='native-label';}
      else if(tag==='fieldset'&&el.querySelector(':scope > legend')){node.name=clean(el.querySelector(':scope > legend').textContent);node.nameSource='native-label';attrs['name-source-element']='legend';}
      else if(tag==='img'&&el.hasAttribute('alt')){node.name=el.getAttribute('alt');node.nameSource='alt';}
      if(ref?.name&&node.name!==ref.name){attrs.display=ref.name;attrs['display-rule']='snapshot-name-v1';if(!node.name)attrs.uncollected=['accessible-name'];}
      if(/^(input|textarea|select)$/.test(tag)){
        const sensitive=secret(el);
        if(sensitive){attrs.redactedFields=['value'];gap(node.id,'sensitive-field','redacted','value');if(tag==='textarea'){gap(node.id,'sensitive-field','redacted','text');continue;}}
        else attrs.value=el.value;
        if(el.type==='checkbox'||el.type==='radio')attrs.checked=el.indeterminate?'mixed':el.checked;
      }
      if('disabled' in el)attrs.disabled=Boolean(el.disabled);
      if(tag==='option')attrs.selected=el.selected;
      for(const k of ['checked','expanded','selected','pressed','busy']){const v=el.getAttribute('aria-'+k);if(v!==null){
        attrs['aria-'+k]=v;
        const native=(k==='checked'&&tag==='input'&&(el.type==='checkbox'||el.type==='radio'))||(k==='selected'&&tag==='option');
        if(native){attrs[k+'-source']='native-property';if(v!==String(attrs[k]))attrs[k+'-conflict']=true;}
        else{attrs[k]=v==='true'?true:v==='false'?false:v==='mixed'?'mixed':null;attrs[k+'-source']='aria';}
      }}
      if(tag==='dialog'||tag==='details')attrs.open=el.open;
      if(tag==='iframe'){gap(node.id,'frame-not-scanned');continue;}
      let children;
      if(el.shadowRoot){const shadow=nodes.length<limit?add({kind:'shadow',attrs:{mode:'open'}},node.id):null;if(!shadow){gap(node.id,'budget');break;}children=Array.from(el.shadowRoot.childNodes).map(dom=>({dom,parent:shadow.id,pre:work.pre}));}
      else if(tag==='slot'){const assigned=el.assignedNodes({flatten:true});children=Array.from(assigned.length?assigned:el.childNodes).map(dom=>({dom,parent:node.id,pre:work.pre}));}
      else children=Array.from(el.childNodes).map(dom=>({dom,parent:node.id,pre:work.pre||tag==='pre'||tag==='code'}));
      for(let i=children.length-1;i>=0;i--)stack.push(children[i]);
    }catch{gap(work.parent,'capture-error','unavailable');}
  }
  // Relationships come from actual attributes/DOM APIs, never domain names or business vocabulary.
  const pending=[...elementById.values()];const walked=new WeakSet();let relationVisits=0;
  while(pending.length&&relationVisits++<12000){const el=pending.pop();if(walked.has(el))continue;walked.add(el);
    try{const from=ids.get(el);if(from){
      const edge=(target,rel,basis,source)=>{const to=ids.get(target);if(to)edges.push({from,rel,to,basis,source});else if(target){const n=nodes.find(n=>n.id===from);(n.attrs.unresolved||(n.attrs.unresolved=[])).push({rel,source,reason:'target-not-observed'});}};
      if(el.localName==='label'&&el.control)edge(el.control,'labels','html','label.control');
      if(el.form)edge(el.form,'form','html','element.form');
      for(const [attr,rel] of [['aria-controls','controls'],['aria-owns','owns']])for(const id of (el.getAttribute(attr)||'').split(/\\s+/).filter(Boolean)){const target=el.getRootNode().getElementById?.(id);edge(target,rel,'aria',attr);if(!target){const n=nodes.find(n=>n.id===from);(n.attrs.unresolved||(n.attrs.unresolved=[])).push({rel,source:attr,reason:'id-not-resolved'});}}
    }
    }catch{complete=false;}
  }
  if(pending.length){gap('n1','relation-budget');}
  const fields=[], groups=[], status=[];
  const nodeMap=new Map(nodes.map(n=>[n.id,n]));
  const inside=(node,parent)=>{let cur=node.parent;while(cur){if(cur===parent)return true;cur=nodeMap.get(cur)?.parent;}return false;};
  const scopeIncomplete=id=>gaps.some(g=>g.kind!=='redacted'&&(g.parent===id||inside(nodeMap.get(g.parent)||{},id)))||gaps.some(g=>g.parent==='n1'&&/budget|document|capture/.test(g.reason));
  const closestOwner=(el,selector)=>{for(let p=el.parentElement||el.getRootNode().host;p;p=p.parentElement||p.getRootNode().host){if(p.matches(selector))return p;}return null;};
  for(const node of nodes){
    const el=elementById.get(node.id);if(!el)continue;
    if(node.kind==='control'&&(Object.prototype.hasOwnProperty.call(node.attrs,'value')||node.attrs.redactedFields?.includes('value'))){
      const form=el.form?ids.get(el.form):undefined;
      fields.push({node:node.id,...(form?{form}:{}),...(node.attrs.redactedFields?.includes('value')?{redacted:true}:{value:node.attrs.value}),...(Object.prototype.hasOwnProperty.call(node.attrs,'checked')?{checked:node.attrs.checked}:{})});
    }
    const isSelect=node.tag==='select', isFieldset=node.tag==='fieldset', role=node.role;
    if(isSelect||isFieldset||role==='radiogroup'||role==='tablist'){
      const selector=isSelect?'option':role==='tablist'?'[role=tab]':role==='radiogroup'?'input[type=radio],[role=radio]':'input[type=checkbox],input[type=radio],[role=checkbox],[role=radio]';
      const ownerSelector=isSelect?'select':role==='tablist'?'[role=tablist]':role==='radiogroup'?'[role=radiogroup]':'fieldset,[role=radiogroup],[role=tablist]';
      const members=Array.from(el.querySelectorAll(selector)).filter(m=>closestOwner(m,ownerSelector)===el);
      const known=members.map(m=>nodeMap.get(ids.get(m))).filter(Boolean);
      const field=isSelect||role==='tablist'?'selected':'checked';
      const observed=known.filter(m=>typeof m.attrs[field]==='boolean');
      const selected=observed.filter(m=>m.attrs[field]===true).map(m=>m.id);
      const shadowMissing=Array.from(el.querySelectorAll('*')).some(n=>n.shadowRoot);
      const groupComplete=members.length===observed.length&&!scopeIncomplete(node.id)&&!shadowMissing&&!known.some(m=>m.attrs[field+'-conflict']);
      const selection=observed.length||groupComplete?selected:null;
      node.attrs.selected=selection;node.attrs['selected-complete']=groupComplete;
      groups.push({node:node.id,selected:selection,complete:groupComplete});
    }
    if(role==='status'||(node.attrs['aria-live']&&node.attrs['aria-live']!=='off')){
      status.push({node:node.id,parts:nodes.filter(n=>n.kind==='text'&&inside(n,node.id)).map(n=>n.id),complete:!scopeIncomplete(node.id)});
    }
  }
  const query=opts.query?.replace(/\\s+/g,' ').trim().toLowerCase();
  if(query)for(const n of nodes){for(const [field,value]of [['text',n.text],['accessible-name',n.name],['href',n.attrs.href]])if(typeof value==='string'&&value.toLowerCase().includes(query))matches.push({node:n.id,field});
    if(typeof n.attrs.display==='string'&&n.attrs.display.toLowerCase().includes(query))matches.push({node:n.id,field:'display',transform:'snapshot-name-v1'});
    if(typeof n.attrs.href==='string'&&n.attrs.href.includes('?')){const params=new URLSearchParams(n.attrs.href.split('?')[1].split('#')[0]);if([...params].some(([k,v])=>k.toLowerCase().includes(query)||v.toLowerCase().includes(query)))matches.push({node:n.id,field:'href.query',transform:'url-search-params-v1'});}
  }
  return {version:'0.2',observation:opts.observation,document:opts.document,capturedAt:new Date().toISOString(),url:location.href,scan:{scope:opts.scope||'main-document-and-open-shadow',complete},nodes,edges,gaps,...(opts.query?{query:opts.query}:{}),matches,
    facts:{title:document.title,lang:document.documentElement?.lang||'',readyState:document.readyState,viewport:{width:innerWidth,height:innerHeight},scroll:[scrollX,scrollY]},
    discovery:{controls:picked.filter(m=>!ids.has(m.el)).map(m=>Object.fromEntries(Object.entries(m.entry).filter(([key])=>!key.startsWith('_'))))},
    state:{params:Array.from(new URLSearchParams(location.search)),fields,groups,status,complete:complete&&groups.every(g=>g.complete)}};
}`;

/** Redact content fields, not opaque IDs/ref strings. Keep long prose instead of the legacy 500-char cap. */
export function sanitizeObservation(graph: ObservationGraph): ObservationGraph {
  const clean = (value: Json): Json => typeof value === 'string' ? redactContent(value) : Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clean(v)])) : value;
  const sanitized: ObservationGraph = { ...graph, url: redactUrl(graph.url), query: graph.query === undefined ? undefined : redactContent(graph.query), nodes: graph.nodes.map(n => ({ ...n,
    ...(n.tracking?{tracking:{...n.tracking,semanticEncoding:'sha256',semantic:n.tracking.semantic===null?null:n.tracking.semanticEncoding==='sha256'&&/^[a-f0-9]{64}$/.test(n.tracking.semantic)?n.tracking.semantic:createHash('sha256').update(n.tracking.semantic).digest('hex')}}:{}),
    ...(n.text === undefined ? {} : { text: redactContent(n.text) }), ...(n.name === undefined ? {} : { name: redactContent(n.name) }),
    attrs: {...Object.fromEntries(Object.entries(n.attrs).map(([k,v])=>[k,['href','action'].includes(k)&&typeof v==='string'?redactUrl(v):['placeholder','value','display','hint','context','label','popup','selectedText','testId','aria-label','aria-labelledby','aria-describedby','aria-controls','aria-owns','id'].includes(k)?clean(v):v])),
      ...(['href','action'].some(k=>typeof n.attrs[k]==='string'&&redactUrl(n.attrs[k] as string)!==n.attrs[k])?{redactedFields:[...new Set([...(Array.isArray(n.attrs.redactedFields)?n.attrs.redactedFields:[]),...['href','action'].filter(k=>typeof n.attrs[k]==='string'&&redactUrl(n.attrs[k] as string)!==n.attrs[k])])]}:{})},
  })),
    ...(graph.facts?{facts:{...graph.facts,title:redactContent(graph.facts.title)}}:{}),
    ...(graph.discovery?{discovery:clean(graph.discovery) as Record<string,Json>}:{}),
    ...(graph.state?{state:{...graph.state,params:graph.state.params.map(([k,v])=>[redactContent(k),/password|secret|token|api.?key/i.test(k)?'<redacted>':redactContent(v)] as [string,string]),fields:graph.state.fields.map(f=>({...f,...(f.value===undefined?{}:{value:clean(f.value)})}))}}:{}),
  };
  const byId=new Map(sanitized.nodes.map(n=>[n.id,n]));
  if(sanitized.state)sanitized.state.status=sanitized.state.status.map(status=>({...status,display:status.parts.map(id=>byId.get(id)?.text??'').join('').replace(/\s+/g,' ').trim()}));
  const inside=(node:ObservationNode,parent:string):boolean=>{let cur=node.parent;while(cur){if(cur===parent)return true;cur=byId.get(cur)?.parent??null;}return false;};
  const prefix={paragraph:[0],link:[0],table:[0]},headings:{node:ObservationNode;index:number;end:number;parts:string[]}[]=[],stack:typeof headings=[];
  const headingById=new Map<string,typeof headings[number]>();
  for(const [index,node]of sanitized.nodes.entries()){
    for(const kind of ['paragraph','link','table'] as const)prefix[kind].push(prefix[kind].at(-1)!+(node.kind===kind?1:0));
    if(node.kind==='heading'&&typeof node.attrs.level==='number'){
      while(stack.length&&Number(stack.at(-1)!.node.attrs.level)>=node.attrs.level)stack.pop()!.end=index;
      const entry={node,index,end:sanitized.nodes.length,parts:[] as string[]};headings.push(entry);stack.push(entry);headingById.set(node.id,entry);
    }
    if(node.kind==='text')for(let parent=node.parent;parent;parent=byId.get(parent)?.parent??null){const entry=headingById.get(parent);if(entry)entry.parts.push(node.id);}
  }
  sanitized.outline=headings.map(({node,index,end,parts})=>{const count=(kind:keyof typeof prefix)=>({min:prefix[kind][end]-prefix[kind][index+1],exact:sanitized.scan.complete});return {node:node.id,level:Number(node.attrs.level),parts,paras:count('paragraph'),links:count('link'),tables:count('table')};});
  return sanitized;
}
