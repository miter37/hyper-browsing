import {redactContent} from '../../utils/strings';

export interface LocalControlContext {
 basis:'dom-ancestor';tag:string;role?:string;text:string;textTruncated?:boolean;
 values:Array<{tag:string;type?:string;role?:string;value?:string;valueTruncated?:boolean;checked?:boolean;redacted?:boolean}>;
 controlIndex:number;controlCount:number;complete:boolean;
}

/** Bounded DOM facts for otherwise unnamed controls. No labels or business roles are inferred. */
export const CONTROL_CONTEXT_JS=String.raw`
function localControlContext(target,boundary){
 if(target===boundary)return;
 const selector='button,input:not([type=hidden]),select,textarea,a[href],summary,[role=button],[role=checkbox],[role=radio],[role=option],[role=menuitem],[role=spinbutton]';
 if(!target.matches(selector))return;
 const parent=el=>el.parentElement||el.getRootNode()?.host;
 const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
 for(let root=parent(target),depth=0;root&&depth<4&&root!==document.body&&root!==document.documentElement;root=parent(root),depth++){
  const controls=[],values=[],parts=[],stack=[root];let seen=0,fields=0;
  while(stack.length&&seen++<64){
   const node=stack.pop();
   if(node.nodeType===3){const text=clean(node.textContent);if(text)parts.push(text);continue;}
   if(node.nodeType!==1||/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(node.tagName))continue;
   const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')continue;
   if(node.matches(selector)){
    controls.push(node);
    if(/^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)){fields++;if(values.length<2){
     const field={tag:node.localName,...(node.tagName==='INPUT'?{type:node.type}:{}),role:node.getAttribute('role')||undefined};
     if(secret(node))field.redacted=true;
     else{const value=String(node.value??'');field.value=value.slice(0,80);if(value.length>80)field.valueTruncated=true;if(/^(checkbox|radio)$/.test(node.type))field.checked=node.checked;}
     values.push(field);
    }}
    continue;
   }
   if(secret(node))continue;
   const children=[...(node.shadowRoot?.childNodes||[]),...node.childNodes];
   for(let i=children.length-1;i>=0;i--)stack.push(children[i]);
  }
  // A small shared ancestor is a structural fact. Do not merge neighbouring widget rows.
  const index=controls.indexOf(target),text=clean(parts.join(' '));
  if(controls.length>4)break;
  if(index>=0&&text&&!values.some(v=>v.value===text))return {
   basis:'dom-ancestor',tag:root.localName,role:root.getAttribute('role')||undefined,
   text:text.slice(0,96),...(text.length>96?{textTruncated:true}:{}),values,
   controlIndex:index,controlCount:controls.length,
   complete:!stack.length&&fields<=2&&text.length<=96&&!values.some(v=>v.valueTruncated)
  };
  if(root===boundary||/^(FORM|MAIN|NAV|ASIDE|DIALOG)$/.test(root.tagName)||/^(dialog|alertdialog|menu|listbox)$/.test(root.getAttribute('role')||''))break;
 }
}
`;

export function sanitizeLocalContext(local:LocalControlContext):LocalControlContext{
 return {...local,text:redactContent(local.text),values:local.values.map(v=>({...v,...(v.value!==undefined?{value:redactContent(v.value)}:{})}))};
}
