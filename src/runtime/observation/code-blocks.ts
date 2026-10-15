import type {ObservationGraph,ObservationNode} from '../hwm/observation';
import type {Unit} from './delivery';

/** A read projection only: the stored graph retains all syntax nodes and relationships. */
export function compactCodeBlocks(graph:ObservationGraph,units:Unit[],publicId:(node:ObservationNode)=>string):Unit[]{
 if(!graph.scan.complete)return units;
 const children=new Map<string,ObservationNode[]>();for(const node of graph.nodes)if(node.parent){const list=children.get(node.parent)??[];list.push(node);children.set(node.parent,list);}
 const available=new Map(units.map(unit=>[unit.data.id,unit])),replacements=new Map<string,Unit>(),omitted=new Set<string>();
 for(const pre of graph.nodes){
  if(pre.tag!=='pre'||pre.actionRef||pre.role||pre.name!==undefined||pre.attrs.rendering||pre.attrs['aria-hidden']!==undefined)continue;
  const descendants:ObservationNode[]=[],stack=[...(children.get(pre.id)??[])].reverse();
  while(stack.length){const node=stack.pop()!;descendants.push(node);for(const child of [...(children.get(node.id)??[])].reverse())stack.push(child);}
  // Do not fold interactive, named, hidden or stateful descendants into source text.
  if(descendants.some(n=>n.actionRef||n.name!==undefined||n.role||!['group','text'].includes(n.kind)||n.attrs.rendering||Object.keys(n.attrs).some(k=>k.startsWith('aria-')||['busy','open','selected','checked','expanded','pressed','value','redactedFields','uncollected','layout-boundary'].includes(k))))continue;
  const ids=new Set([pre.id,...descendants.map(n=>n.id)]);
  if(graph.gaps.some(g=>ids.has(g.parent))||graph.edges.some(e=>ids.has(e.from)||ids.has(e.to)))continue;
  const texts=descendants.filter(n=>n.kind==='text');if(!texts.length||texts.some(n=>!available.has(publicId(n))))continue;
  const members=[pre,...descendants].map(publicId),first=units.find(u=>members.includes(u.data.id));if(!first)continue;
  const id=publicId(pre),text=texts.map(n=>n.text??'').join('');
  const match=members.flatMap(source=>(available.get(source)?.data.match??[]).map((m:Record<string,any>)=>({...m,source})));
  replacements.set(first.data.id,{key:graph.scan.scope+'/'+pre.tracking?.id+'/'+pre.tracking?.semantic+'/'+id,
   data:{id,kind:'code',tag:'pre',parent:first.data.parent,text,source:'pre-text-v1',...(match.length?{match}:{}),...(pre.attrs.view?{view:pre.attrs.view}:{}),...(pre.attrs['layout-boundary']?{'layout-boundary':pre.attrs['layout-boundary']}:{})},
   collected:['text','source','tag','parent','view','layout-boundary','match']});
  for(const member of members)omitted.add(member);
 }
 return units.flatMap(unit=>replacements.has(unit.data.id)?[replacements.get(unit.data.id)!]:omitted.has(unit.data.id)?[]:[unit]);
}
