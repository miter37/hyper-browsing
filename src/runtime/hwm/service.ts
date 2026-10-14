import { ObservationStore, ObservationError } from './store';
import type { ObservationGraph } from './observation';
import type { Attributes } from './view';
import { renderObservation } from './renderer';
import type { ProjectionOptions, Fold } from './projection';
interface Plan {session:string;observation:string;comparison?:string;folds:Record<string,Fold>;bytes:number}
/** All retrieval methods operate on stored public data; no Page, Chrome or learning dependency. */
export class ObservationService {
 private plans=new Map<string,Plan>();
 constructor(public store=new ObservationStore()){}
 remember(session:string,graph:ObservationGraph,header:Attributes={}){return this.store.put(session,graph,header);}
 latest(session:string){return this.store.latest(session)?.graph;}
 rememberComparison(session:string,before:ObservationGraph,after:ObservationGraph,changes:Attributes[],result?:Attributes){
  for(const graph of [before,after])if(!this.remember(session,graph).ok)throw new ObservationError('observation_too_large');
  return this.store.compare(session,before.observation,after.observation,changes,result);
 }
 private render(session:string,observation:string,options:ProjectionOptions={},comparison?:ReturnType<ObservationStore['getComparison']>){
  const saved=this.store.get(session,observation);let projection='';
  const hwm=renderObservation(saved.graph,{session,extraHeader:{...saved.header,retention:{expiresAt:saved.expiresAt,...(comparison?{comparison:comparison.id}:{} )},...(comparison?{'before-scan-complete':comparison.before.graph.scan.complete}:{})},
   projection:{...options,...(comparison?{comparisonId:comparison.id}:{})},...(comparison?{before:comparison.before.graph,changes:comparison.changes,result:comparison.result}:{}),
   onProjection:p=>{
    projection=p.projection;if(!Object.keys(p.folds).length)return;const key=observation+':'+p.projection;const bytes=Buffer.byteLength(JSON.stringify(p.folds));
    if(bytes>4*1024*1024)throw new ObservationError('projection_too_large');
    this.plans.delete(key);while(this.plans.size>=32||[...this.plans.values()].reduce((n,p)=>n+p.bytes,0)+bytes>4*1024*1024)this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(key,{session,observation,comparison:comparison?.id,folds:structuredClone(p.folds),bytes});
   }});
  return {ok:true,observation,projection,...(comparison?{comparison:comparison.id}:{}),hwm};
 }
 view(session:string,observation:string,options:ProjectionOptions={}){return this.render(session,observation,options);}
 comparison(session:string,id:string,options:ProjectionOptions={}){const c=this.store.getComparison(session,id);return this.render(session,c.after.graph.observation,options,c);}
 private fold(session:string,observation:string,id:string){this.store.get(session,observation);const plan=[...this.plans.values()].find(p=>p.observation===observation&&p.session===session&&id in p.folds);if(!plan)throw new ObservationError('projection_expired');return {plan,fold:structuredClone(plan.folds[id])};}
 expand(session:string,observation:string,target:string){
  const saved=this.store.get(session,observation),g=saved.graph;
  if(g.gaps.some(gap=>gap.id===target))throw new ObservationError('observation_gap_not_expandable');
  if(target.startsWith('fv')){const {fold}=this.fold(session,observation,target);if(fold.changes)throw new ObservationError('comparison_required');return this.render(session,observation,{mode:'focus',focusNodes:fold.nodes,nodeBudget:6000,textBudget:Number.MAX_SAFE_INTEGER,exact:true});}
  const node=g.nodes.find(n=>n.id===target||n.actionRef===target.replace(/^@(?=e\d+$)/,''));if(!node)throw new ObservationError('observation_node_not_found');
  if(node.kind==='heading'&&typeof node.attrs.level==='number'){
   const start=g.nodes.indexOf(node);const end=g.nodes.findIndex((n,i)=>i>start&&n.kind==='heading'&&typeof n.attrs.level==='number'&&n.attrs.level<=Number(node.attrs.level));
   return this.render(session,observation,{mode:'focus',focusNodes:g.nodes.slice(start,end<0?undefined:end).map(n=>n.id),nodeBudget:6000,textBudget:Number.MAX_SAFE_INTEGER,exact:true});
  }
  return this.render(session,observation,{mode:'focus',focus:node.id,nodeBudget:6000,textBudget:Number.MAX_SAFE_INTEGER,exact:true});
 }
 inspect(session:string,observation:string,target:string){
  const g=this.store.get(session,observation).graph,node=g.nodes.find(n=>n.id===target||n.actionRef===target.replace(/^@(?=e\d+$)/,''));if(!node)throw new ObservationError('observation_node_not_found');
  const ancestors=[];for(let parent=node.parent;parent;){const p=g.nodes.find(n=>n.id===parent)!;ancestors.unshift(p);parent=p.parent;}
  return {ok:true,observation,document:g.document,capturedAt:g.capturedAt,node,ancestors,edges:g.edges.filter(e=>e.from===node.id||e.to===node.id),gaps:g.gaps.filter(g=>g.parent===node.id)};
 }
 expandChanges(session:string,comparison:string,target:string){
  const c=this.store.getComparison(session,comparison),{fold,plan}=this.fold(session,c.after.graph.observation,target);if(plan.comparison!==comparison||!fold.changes)throw new ObservationError('comparison_scope_mismatch');
  const result=this.render(session,c.after.graph.observation,{mode:'full',changeIds:fold.changes},c);return {...result,changes:c.changes.filter((_,i)=>fold.changes!.includes('c'+(i+1)))};
 }
 clearSession(session:string){this.store.clearSession(session);for(const [id,p]of this.plans)if(p.session===session)this.plans.delete(id);}
}
