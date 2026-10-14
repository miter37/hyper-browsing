import { createHash } from 'node:crypto';
import type { ObservationGraph } from './observation';
import type { HwmView, NodeLine, RecordLine, Json } from './view';
export interface ProjectionOptions {mode?:'full'|'overview'|'focus';focus?:string;nodeBudget?:number;textBudget?:number;changeBudget?:number;comparisonId?:string;focusNodes?:string[];changeIds?:string[];exact?:boolean}
export interface Fold {nodes?:string[];field?:string;changes?:string[]}
/** Pure projection over one frozen graph. Defaults preserve the old full tree. */
export function projectView(original:HwmView,graph:ObservationGraph,options:ProjectionOptions={}){
 const view=structuredClone(original),mode=options.mode??'full',budget=options.nodeBudget??120,textBudget=options.textBudget??(mode==='full'?Number.MAX_SAFE_INTEGER:240);
 for(const n of [budget,textBudget,options.changeBudget??40])if(!Number.isSafeInteger(n)||n<1)throw new Error('Projection budgets must be positive integers');
 const token='v'+createHash('sha256').update(JSON.stringify([mode,options.focus??null,budget,textBudget,options.changeBudget??null,options.comparisonId??null,options.focusNodes??null,options.changeIds??null,options.exact??false])).digest('hex').slice(0,16);
 view.header.view=mode;view.header['projection-id']=token;
 if(mode!=='full')view.header['detail-projection']='raw-geometry-in-full-or-inspect';
 const aliases=new Map(graph.nodes.map(n=>[n.id,n.actionRef??n.id])),byId=new Map(graph.nodes.map(n=>[n.id,n])),reverse=new Map([...aliases].map(([id,ref])=>[ref,id]));
 const resolve=(ref:string)=>byId.has(ref)?ref:reverse.get(ref.replace(/^@(?=e\d+$)/,''));
 const descendants=(id:string)=>graph.nodes.filter(n=>{let p:string|null=n.id;while(p){if(p===id)return true;p=byId.get(p)?.parent??null;}return false;}).map(n=>n.id);
 const selected=new Set<string>();const add=(id:string)=>{for(let n=byId.get(id);n&&!selected.has(n.id);n=n.parent?byId.get(n.parent):undefined)selected.add(n.id);};
 add(graph.nodes[0].id);
 if(mode==='full'&&!options.focusNodes)graph.nodes.forEach(n=>add(n.id));
 else if(mode==='focus'||options.focusNodes){
  let seeds=options.focusNodes;
  if(!seeds){const id=resolve(options.focus??'');if(!id)throw new Error('Unknown focus node');let node=byId.get(id)!;
   if(!options.exact){for(let parent=node.parent?byId.get(node.parent):undefined;parent;parent=parent.parent?byId.get(parent.parent):undefined)if(['item','paragraph','form','fieldset','row','dialog'].includes(parent.kind)){node=parent;break;}}
   seeds=descendants(node.id);
  }
  for(const id of seeds){if(!byId.has(id))throw new Error('Unknown focus node');if(selected.size<budget||id===resolve(options.focus??''))add(id);}
 }else{
  if(options.nodeBudget===undefined)for(const node of graph.nodes)if(node.actionRef){add(node.id);let owner=node.parent?byId.get(node.parent):undefined;while(owner&&!['item','paragraph','row','form','fieldset'].includes(owner.kind))owner=owner.parent?byId.get(owner.parent):undefined;
   if(owner){const ids=descendants(owner.id),index=ids.indexOf(node.id),start=Math.max(0,index-8);for(const id of ids.slice(start,index+9))add(id);}
  }
  const priority=[...graph.matches.map(m=>byId.get(m.node)!).filter(Boolean),...graph.nodes.filter(n=>['dialog','heading','region'].includes(n.kind)),...graph.nodes.filter(n=>n.actionRef&&n.attrs.view!=='outside'),...graph.nodes.filter(n=>n.kind==='paragraph'),...graph.nodes];
  // Each candidate gets its bounded item/paragraph context, rather than a flat control list.
  for(const n of priority){if(selected.size>=budget)break;add(n.id);if(n.kind==='heading')for(const id of graph.outline?.find(h=>h.node===n.id)?.parts??[])add(id);
   let item=n.parent?byId.get(n.parent):undefined;while(item&&!['item','paragraph'].includes(item.kind))item=item.parent?byId.get(item.parent):undefined;
   if(item)for(const id of descendants(item.id))if(selected.size<budget)add(id);
  }
 }
 if(mode==='focus')for(const node of graph.nodes)if((node.kind==='dialog'||node.role==='dialog')&&!node.attrs.rendering&&!node.attrs.hidden)descendants(node.id).forEach(add);
 // Keep explicit external endpoints and their original ancestors. Text within labels remains readable.
 let changed=true;while(changed){const size=selected.size;for(const edge of graph.edges)if(selected.has(edge.from)||selected.has(edge.to)){add(edge.from);add(edge.to);for(const id of [edge.from,edge.to])if(byId.get(id)?.tag==='label')descendants(id).forEach(add);}changed=size!==selected.size;}
 const keep=new Set<string>();const protect=(ref:string)=>{const id=reverse.get(ref)??ref;if(byId.has(id))keep.add(id);};
 for(const edge of graph.edges){keep.add(edge.from);keep.add(edge.to);}for(const gap of graph.gaps)keep.add(gap.parent);
 for(const entry of view.entries)if(entry.type==='record'){
  for(const item of entry.items){if(!item.literal)protect(item.ref);for(const k of ['refs','selected','parts','source-nodes'])if(Array.isArray(item.attrs[k]))for(const id of item.attrs[k])if(typeof id==='string')protect(id);if(typeof item.attrs.form==='string')protect(item.attrs.form);}
  for(const k of ['before','after']){const a=entry.attrs[k];if(a&&typeof a==='object'&&!Array.isArray(a)&&a.obs===graph.observation&&typeof a.node==='string')protect(a.node);}
 }
 const children=new Map<string,string[]>();for(const n of graph.nodes)if(n.parent)children.set(n.parent,[...(children.get(n.parent)??[]),n.id]);
 const shapes=new Map<string,string>();for(const n of graph.nodes.slice().reverse())shapes.set(n.id,createHash('sha256').update(JSON.stringify([n.kind,n.tag??null,n.role??null,Object.keys(n.attrs).sort(),(children.get(n.id)??[]).map(id=>shapes.get(id))])).digest('hex').slice(0,16));
 const repeated=new Map<string,Map<string,string[]>>();for(const [parent,ids]of children){const groups=new Map<string,string[]>();for(const id of ids){const hash=shapes.get(id)!;groups.set(hash,[...(groups.get(hash)??[]),id]);}if([...groups.values()].some(ids=>ids.length>1))repeated.set(parent,groups);}
 const collapsed=new Set<string>();if(mode!=='full')for(const n of graph.nodes){
  if(!selected.has(n.id)||n.kind!=='group'||!['div','span'].includes(n.tag??'')||n.name!==undefined||n.actionRef||n.role||keep.has(n.id)||(children.get(n.id)?.length??0)!==1)continue;
  if(Object.keys(n.attrs).some(k=>!['box','space','view','id'].includes(k))||n.attrs.id)continue;collapsed.add(n.id);
 }
 const folds:Record<string,Fold>={},foldedTargets:Record<string,string>={},gaps:RecordLine[]=[];let ordinal=0;
 const gap=(attrs:Record<string,Json>,fold:Fold)=>{const id='f'+token+'_'+(++ordinal);folds[id]=fold;gaps.push({type:'record',tag:'gap',id,attrs:{kind:'folded',...attrs,expand:id},items:[]});return id;};
 const omitted=new Map<string,string[]>();for(const n of graph.nodes)if(!selected.has(n.id)){let parent=n.parent;while(parent&&(!selected.has(parent)||collapsed.has(parent)))parent=byId.get(parent)?.parent??null;const owner=parent??graph.nodes[0].id;omitted.set(owner,[...(omitted.get(owner)??[]),n.id]);}
 for(const [parent,ids]of omitted){const omittedSet=new Set(ids),roots=ids.filter(id=>!omittedSet.has(byId.get(id)?.parent??''));const hash=roots.length?shapes.get(roots[0]):undefined;const sample=(children.get(parent)??[]).find(id=>selected.has(id)&&shapes.get(id)===hash);const uniform=sample&&roots.every(id=>byId.get(id)?.parent===parent&&shapes.get(id)===hash);
  const id=gap({scope:'nodes',reason:uniform?'repeated-shape':'view-budget',parent:aliases.get(parent)!,...(uniform?{sample:aliases.get(sample!),rule:'observed-tree-shape-v1'}:{}),range:{roots:roots.map(id=>({node:aliases.get(id)!,order:byId.get(id)!.order})),'roots-complete':true},nodes:{min:ids.length,exact:true},items:{min:roots.length,exact:true},'source-observation':graph.observation,expand:token},{nodes:ids});for(const node of ids)foldedTargets[aliases.get(node)!]=id;}
 const nodes:NodeLine[]=[];const depths=new Map<string,number>();for(const line of view.entries.filter((e):e is NodeLine=>e.type==='node')){
  const id=reverse.get(line.id)!;if(!selected.has(id)||collapsed.has(id))continue;let parent=byId.get(id)?.parent??null;const via:string[]=[];while(parent&&collapsed.has(parent)){via.push(aliases.get(parent)!);parent=byId.get(parent)?.parent??null;}
  line.parent=parent?aliases.get(parent)!:null;line.depth=line.parent?(depths.get(line.parent)??0)+1:0;depths.set(line.id,line.depth);if(via.length)line.attrs.via=via;
  if(repeated.has(id))line.attrs['repeated-shapes']={rule:'observed-tree-shape-v1','source-scan-complete':graph.scan.complete,groups:[...repeated.get(id)!].map(([shape,ids])=>({shape,sample:aliases.get(ids[0])!,items:{min:ids.length,exact:true}}))};
  if(line.primary){const points=Array.from(line.primary.value);if(points.length>textBudget){line.primary.value=points.slice(0,textBudget).join('');const field=['heading','paragraph','text'].includes(line.kind)?'text':'accessible-name';line.attrs['primary-length']=points.length;line.attrs['primary-shown']=textBudget;line.attrs['primary-length-unit']='unicode-code-point';gap({scope:'field',reason:'string-budget',node:line.id,parent:line.id,field,chars:{min:points.length-textBudget,exact:true},unit:'unicode-code-point','source-observation':graph.observation,expand:token},{nodes:[id],field});}}
  if(mode!=='full'){delete line.attrs.box;delete line.attrs.space;}
  nodes.push(line);
 }
 const links=new Map<string,{refs:string[];basis:string}>(),redacted:RecordLine['items']=[];
 for(const n of graph.nodes)if(n.kind==='link'&&typeof n.attrs.href==='string'){
  if(n.attrs.href.includes('<redacted')){redacted.push({ref:n.attrs.href,literal:true,attrs:{refs:[aliases.get(n.id)!],total:{min:1,exact:true},'refs-complete':true,'destination-identity':'redacted'}});continue;}
  let href=n.attrs.href,basis='resolved-url';try{href=new URL(href,graph.url).href;}catch{basis='raw-href';}links.set(href,{refs:[...(links.get(href)?.refs??[]),aliases.get(n.id)!],basis});
 }
 const index:RecordLine={type:'record',tag:'links',id:'lDestinations',attrs:{rule:'url-resolution-v1',complete:graph.scan.complete,scope:'observed-nodes'},items:[...[...links].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([href,{refs,basis}])=>({ref:href,literal:true,attrs:{refs,total:{min:refs.length,exact:true},'refs-complete':true,basis}})),...redacted]};
 const records=view.entries.filter((e):e is RecordLine=>e.type==='record');let changes=records.filter(e=>e.tag==='change');
 if(options.changeIds)changes=changes.filter(e=>options.changeIds!.includes(e.id));
 else if(options.comparisonId&&changes.length>(options.changeBudget??40)){
  // A budgeted diff buries the decisive signals (url/title) under a flood of unchanged lines; hoist changed url/title to the front so they always survive the cut.
  const signal=(c:RecordLine)=>{const field=String(c.attrs.field??'');return (field==='url'||field==='title')&&c.attrs.op!=='unchanged';};
  const signals=changes.filter(signal),rest=changes.filter(c=>!signal(c));
  const hidden=rest.slice(Math.max(0,(options.changeBudget??40)-signals.length)),counts:Record<string,Json>={};for(const c of hidden){const op=String(c.attrs.op);const prior=counts[op] as {min:number;exact:boolean}|undefined;counts[op]={min:(prior?.min??0)+1,exact:true};}
  if(hidden.length)gap({scope:'changes',reason:'change-budget',comparison:options.comparisonId,'changes-complete':true,'before-scan-complete':Boolean(view.header['before-scan-complete']),'after-scan-complete':graph.scan.complete,total:{min:hidden.length,exact:true},counts,range:{first:hidden[0].id,last:hidden.at(-1)!.id},expand:token,attribution:'observed-after'},{changes:hidden.map(e=>e.id)});changes=[...signals,...rest].slice(0,options.changeBudget??40);
 }
 view.entries=[...records.filter(e=>['result','state','outline'].includes(e.tag)),...nodes,...records.filter(e=>['edge','candidates'].includes(e.tag)),...(index.items.length?[index]:[]),...records.filter(e=>e.tag==='gap'),...gaps,...changes];
 view.header['projection-budget']={requested:budget,shown:nodes.length,closureMayExceed:true};
 return {view,folds,foldedTargets,projection:token};
}
