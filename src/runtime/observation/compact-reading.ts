import type {ObservationGraph,ObservationNode} from '../hwm/observation';
import type {Unit} from './delivery';

/** Presentation-only omissions; names, item boundaries, state reads and explicit query matches survive. */
export function compactReading(graph:ObservationGraph,units:Unit[],publicId:(n:ObservationNode)=>string,options:{state:boolean;query:boolean}){
 const counts={hidden:0,icons:0,repeatedLabel:0,wrappers:0};
 if(options.state||options.query)return {units,counts,omitted:0};
 const nodes=new Map(graph.nodes.map(n=>[n.id,n])),byPublic=new Map(graph.nodes.map(n=>[publicId(n),n])),available=new Map(units.map(u=>[u.data.id,u]));
 const endpoints=new Set(graph.edges.flatMap(e=>[e.from,e.to]));
 const childrenByParent=new Map<string,Unit[]>();for(const u of units){const list=childrenByParent.get(u.data.parent)??[];list.push(u);childrenByParent.set(u.data.parent,list);}
 const removed=new Set<string>();
 for(const unit of units){const n=byPublic.get(unit.data.id);if(!n||n.actionRef||endpoints.has(n.id)||n.name!==undefined||n.attrs.redactedFields||n.attrs['layout-boundary'])continue;
  const stateful=Object.keys(n.attrs).some(k=>['value','checked','selected','current','expanded','pressed','disabled','busy','open','unresolved'].includes(k));if(stateful)continue;
  const rendering=n.attrs.rendering as any;
  if(['group','control','image'].includes(n.kind)&&!n.role&&!childrenByParent.has(unit.data.id)&&rendering&&(rendering.display==='none'||rendering.visibility==='hidden')){removed.add(unit.data.id);counts.hidden++;continue;}
  if(n.kind!=='text'||!n.text)continue;
  let ariaHidden=false,label:string|undefined;
  for(let p=nodes.get(n.parent??'');p;p=nodes.get(p.parent??'')){
   if(p.attrs['aria-hidden']==='true'||p.attrs['aria-hidden']===true)ariaHidden=true;
   if(p.actionRef){const owner=available.get(publicId(p));label=owner?.data.name??owner?.data.display;break;}
   if(['item','row','cell','paragraph','heading'].includes(p.kind)||p.tag==='pre'||p.tag==='code')break;
  }
  if(ariaHidden&&/^[\s\uE000-\uF8FF]+$/u.test(n.text)){removed.add(unit.data.id);counts.icons++;}
  else if(label!==undefined&&label.trim()===n.text.trim()){removed.add(unit.data.id);counts.repeatedLabel++;}
 }
 // An aria-hidden icon wrapper with no remaining children carries no new content.
 for(const unit of [...units].reverse()){
  const n=byPublic.get(unit.data.id);if(!n||n.kind!=='group'||n.role||n.name!==undefined||n.actionRef||endpoints.has(n.id)||n.attrs['aria-hidden']!=='true'||Object.keys(n.attrs).some(k=>!['box','view','space','aria-hidden','rendering'].includes(k)))continue;
  const children=childrenByParent.get(unit.data.id)??[];if(children.length&&children.every(u=>removed.has(u.data.id))){removed.add(unit.data.id);counts.wrappers++;}
 }
 const result=units.filter(u=>!removed.has(u.data.id)).map(u=>{
  let parent=u.data.parent;while(removed.has(parent))parent=available.get(parent)?.data.parent??'panel';
  return parent===u.data.parent?u:{...u,data:{...u.data,parent}};
 });
 return {units:result,counts,omitted:removed.size};
}
