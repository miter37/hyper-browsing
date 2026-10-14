import {randomUUID} from 'node:crypto';
import {parseHwm,serializeHwm,type Attributes,type RecordLine} from './view';
import {renderObservation} from './renderer';
import {sanitizeObservation,type ObservationGraph} from './observation';
import {cleanStoredJson} from './store';

/** One language for all command results; the JSON wire object remains unchanged. */
export function renderCommandResult(result:any,scope:{session:string;document:string;url:string}):string{
 const raw=cleanStoredJson(JSON.parse(JSON.stringify(result??null)));
 const clean:Attributes=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{value:raw};
 for(const key of ['hwm','snapshot','changes'])delete clean[key];
 // This adapter is called only after dispatch returned. Completion is not task success.
 if(clean.execution===undefined)clean.execution=clean.ok===false?'outcome_unknown':'completed';
 const record:RecordLine={type:'record',tag:'result',id:'xResult',attrs:clean,items:[]};
 if(typeof result?.hwm==='string'){
  const view=parseHwm(result.hwm);view.entries=view.entries.filter(e=>!(e.type==='record'&&e.tag==='result'));view.entries.unshift(record);return serializeHwm(view);
 }
 const graph:ObservationGraph={version:'0.2',observation:'p'+randomUUID().replace(/-/g,''),document:scope.document,capturedAt:new Date().toISOString(),url:scope.url,scan:{scope:'command-result',complete:false},nodes:[{id:'n1',kind:'document',parent:null,order:0,attrs:{uncollected:['layout','page-content']}}],edges:[],gaps:[],matches:[]};
 const orders=new Map<string,number>();
 const append=(kind:string,parent:string,attrs:Attributes,text?:string)=>{const id='n'+(graph.nodes.length+1),order=orders.get(parent)??0;orders.set(parent,order+1);graph.nodes.push({id,kind,parent,order,attrs,...(text===undefined?{}:{text,textSource:'rendered-text'})});return id;};
 if(Array.isArray(clean.items)){
  const list=append('list','n1',{container:clean.container??null,total:clean.total??null});
  for(const item of clean.items as any[]){const {text,title,href,...attrs}=item;const id=append('item',list,attrs);append('paragraph',id,{},text??'');if(title)append('text',id,{field:'title',truncated:Boolean(item.titleTruncated)},title);if(href)append('link',id,{href,display:title??'', 'display-rule':'list-heading-or-link-v1',uncollected:['accessible-name','actionRef']});}
  delete clean.items;
 }else if(Array.isArray(clean.forms)){
  for(const form of clean.forms as any[]){const owner=append('form','n1',{id:form.formId??null,display:form.formName??'',action:form.action??null,method:form.method??null});for(const field of form.fields??[])append('control',owner,{...field,uncollected:['actionRef']});if(form.submitButton)append('control',owner,{...form.submitButton,uncollected:['actionRef']});}delete clean.forms;
 }
 return renderObservation(sanitizeObservation(graph),{session:scope.session,result:record.attrs,extraHeader:{retention:{ok:false,reason:'result-only-observation'}}});
}
