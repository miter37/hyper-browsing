import type { ObservationGraph } from './observation';
import { serializeHwm, validateHwm, type Attributes, type HwmView, type NodeLine, type RecordLine, type Relation } from './view';
import { projectView, type ProjectionOptions } from './projection';

/** Pure projection: no browser access, state mutation, site rules, or fresh observation. */
export function renderObservation(graph: ObservationGraph, options: { session: string; result?: Attributes; extraHeader?: Attributes; changes?: Attributes[]; before?: ObservationGraph; projection?:ProjectionOptions; retentionFailure?:string; onProjection?:(plan:ReturnType<typeof projectView>)=>void }): string {
  const aliases = new Map(graph.nodes.map(n => [n.id, n.actionRef ?? n.id]));
  const alias = (id: string): string => aliases.get(id) ?? id;
  const view: HwmView = { observation: graph.observation, header: {
    version: graph.version, session: options.session, document: graph.document, url: graph.url,
    view:'full', 'captured-at':graph.capturedAt, scan:graph.scan,
    collected:['text','text-source','accessible-name','name-source','display','href','value','state','relationships'],
    ...(graph.facts?{title:graph.facts.title,lang:graph.facts.lang,viewport:graph.facts.viewport,scroll:graph.facts.scroll,'ready-state':graph.facts.readyState}:{}),
    ...options.extraHeader,
  }, entries:[], end:'complete' };
  if (options.result) view.entries.push({ type:'record',tag:'result',id:'xResult',attrs:options.result,items:[] });
  if(graph.state){
    const state:RecordLine={type:'record',tag:'state',id:'stCurrent',attrs:{complete:graph.state.complete},items:[{ref:'url',literal:false,attrs:{params:graph.state.params}}]};
    for(const field of graph.state.fields)state.items.push({ref:alias(field.node),literal:false,attrs:{...(field.form?{form:alias(field.form)}:{}),...(field.redacted?{redacted:true}:{value:field.value??null}),...(field.checked===undefined?{}:{checked:field.checked})}});
    for(const group of graph.state.groups)state.items.push({ref:alias(group.node),literal:false,attrs:{selected:group.selected===null?null:group.selected.map(alias),'selected-complete':group.complete}});
    for(const status of graph.state.status)state.items.push({ref:alias(status.node),literal:false,attrs:{parts:status.parts.map(alias),'text-complete':status.complete,...(status.display===undefined?{}:{display:status.display,'display-rule':'status-descendant-text-v1'})}});
    view.entries.push(state);
  }
  if(graph.outline?.length){
    const byId=new Map(graph.nodes.map(n=>[n.id,n]));
    view.entries.push({type:'record',tag:'outline',id:'oHeadings',attrs:{rule:'heading-outline-v1',complete:graph.scan.complete},items:graph.outline.map(h=>({ref:alias(h.node),literal:false,attrs:{level:h.level,
      display:h.parts.map(id=>byId.get(id)?.text??'').join('').replace(/\s+/g,' ').trim(),'display-rule':'heading-descendant-text-v1','source-nodes':h.parts.map(alias),paras:h.paras,links:h.links,tables:h.tables}}))});
  }
  const depths = new Map<string, number>();
  for (const node of graph.nodes) {
    const depth = node.parent === null ? 0 : (depths.get(node.parent) ?? -1) + 1;
    if (node.parent !== null && !depths.has(node.parent)) throw new Error('Observation graph is not in parent-first order');
    depths.set(node.id,depth);
    const attrs: Attributes = { ...node.attrs, ...(node.tag ? {tag:node.tag} : {}), ...(node.role ? {role:node.role} : {}) };
    if(Array.isArray(attrs.selected))attrs.selected=attrs.selected.map(id=>typeof id==='string'?alias(id):id);
    const textKind = ['heading','paragraph','text'].includes(node.kind);
    const primary = textKind ? (node.text === undefined ? undefined : { value:node.text,source:node.textSource ?? null })
      : node.name === undefined ? undefined : { value:node.name,source:node.nameSource ?? null };
    // Paragraph/heading content is represented by child nodes instead of duplicating their innerText.
    if (!primary && textKind && node.kind !== 'text') attrs.content='children';
    if (textKind && node.name !== undefined) { attrs['accessible-name']=node.name;attrs['name-source']=node.nameSource ?? null; }
    const line: NodeLine = { type:'node',id:alias(node.id),kind:node.kind,parent:node.parent===null?null:alias(node.parent),depth,attrs,relations:[],...(primary?{primary}:{}) };
    view.entries.push(line);
  }
  const lines = new Map(view.entries.filter((e):e is NodeLine=>e.type==='node').map(e=>[e.id,e]));
  graph.edges.forEach((edge,i) => {
    const line=lines.get(alias(edge.from));
    if(line&&edge.rel!=='header-for')line.relations.push({rel:edge.rel,target:alias(edge.to),basis:edge.basis as Relation['basis'],qualifiers:{source:edge.source}});
    else view.entries.push({ type:'record',tag:'edge',id:'rEdge'+i,attrs:{from:alias(edge.from),to:alias(edge.to),rel:edge.rel,basis:edge.basis,source:edge.source},items:[] });
  });
  if (graph.query) {
    const candidates: RecordLine = { type:'record',tag:'candidates',id:'qMatches',attrs:{query:graph.query,scope:alias(graph.nodes[0].id),rule:'context-match-v1',total:graph.matches.length,shown:graph.matches.length,complete:graph.scan.complete},items:graph.matches.map(m=>({ref:alias(m.node),literal:false,attrs:{match:m.field,...(m.transform?{transform:m.transform}:{})}})) };
    view.entries.push(candidates);
  }
  if(graph.discovery){const items:RecordLine['items']=[];for(const kind of ['controls','hidden','textHits','collapsed']){
    const entries=graph.discovery[kind];if(Array.isArray(entries))for(const entry of entries)items.push({ref:kind,literal:true,attrs:{data:entry,basis:'derived',rule:'snapshot-discovery-v1'}});
  }if(items.length)view.entries.push({type:'record',tag:'candidates',id:'qDiscovery',attrs:{query:graph.query??'',scope:alias(graph.nodes[0].id),complete:graph.scan.complete,rule:'snapshot-discovery-v1'},items});}
  for (const gap of graph.gaps) view.entries.push({type:'record',tag:'gap',id:gap.id,attrs:{kind:gap.kind,reason:gap.reason,parent:alias(gap.parent),...(gap.field?{field:gap.field}:{})},items:[]});
  const priorAliases=new Map(options.before?.nodes.map(n=>[n.id,n.actionRef??n.id])??[]);
  const changeAddress=(value:unknown):any=>{
    if(!value||typeof value!=='object'||!('obs' in value)||!('node' in value))return value;
    const map=value.obs===graph.observation?aliases:value.obs===options.before?.observation?priorAliases:undefined;
    if(!map)throw new Error('Unknown change observation');
    const node=map.get(String(value.node));if(!node)throw new Error('Missing node in change observation');
    return {...value,node};
  };
  for(const [i,change]of (options.changes??[]).entries()){
    const attrs={...change};for(const key of ['before','after'])if(attrs[key])attrs[key]=changeAddress(attrs[key]);
    // Selection values contain node references in their respective observation scopes.
    if(attrs.field==='selected')for(const key of ['old','new'])if(Array.isArray(attrs[key]))attrs[key]=attrs[key].map(id=>typeof id==='string'?(key==='old'?priorAliases:aliases).get(id)??id:id);
    view.entries.push({type:'record',tag:'change',id:'c'+(i+1),attrs,items:[]});
  }
  const projected=projectView(view,graph,options.projection);
  if(options.retentionFailure)for(const entry of projected.view.entries)if(entry.type==='record'&&entry.tag==='gap'&&entry.attrs.kind==='folded'){
    entry.attrs['omission-reason']=entry.attrs.reason;entry.attrs.kind='unavailable';entry.attrs.reason=options.retentionFailure;entry.attrs.collected=true;delete entry.attrs.expand;
  }
  const issues = validateHwm(projected.view,{foldedTargets:projected.foldedTargets}); if (issues.length) throw new Error('Invalid HWM projection: '+JSON.stringify(issues));
  if(!options.retentionFailure)options.onProjection?.(projected);
  return serializeHwm(projected.view);
}
