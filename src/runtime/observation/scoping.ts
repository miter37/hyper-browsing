export const REGION_GUARD=`el=>JSON.stringify([el.localName,el.id,el.getAttribute('role'),el.getAttribute('aria-label'),el.getAttribute('data-key'),el.getAttribute('data-id')])`;
/** Shared browser-side traversal fence for controls, prose, queries and outlines. */
export const SCOPING_JS=`
 const scopeExcluded=new Set();
 if(!opts.includeChildren&&opts.boundaries)for(const entry of Object.values(opts.boundaries)){
  if(entry.section)continue;const el=entry.ref?.deref();if(el&&el!==opts.root)scopeExcluded.add(el);
 }
 const scopeContains=(root,node)=>{for(let n=node;n;n=n.parentElement||n.getRootNode?.().host)if(n===root)return true;return false;};
 let scopeNodes=null,scopeAncestors=null,scopeEnd=null;
 if(opts.section){
  const start=opts.section.ref?.deref();
  if(!start?.isConnected||!scopeContains(opts.root,start)||start.textContent!==opts.section.headingText)throw new Error('section_stale');
  scopeNodes=new Set();scopeAncestors=new Set();for(let n=start;n;n=n.parentElement||n.getRootNode().host){scopeAncestors.add(n);if(n===opts.root)break;}
  let active=false;const level=opts.section.level,stack=[opts.root],seen=new WeakSet();let visits=0;
  while(stack.length&&visits<16000){const el=stack.pop();if(!el||seen.has(el))continue;seen.add(el);visits++;
   if(scopeExcluded.has(el))continue;
   if(el===start)active=true;
   else if(active&&el.nodeType===1&&(/^(H[1-6])$/.test(el.tagName)||el.getAttribute('role')==='heading')){
    const next=/^H[1-6]$/.test(el.tagName)?Number(el.tagName[1]):Number(el.getAttribute('aria-level'));
    if(next>0&&next<=level){scopeEnd=el;break;}
   }
   if(active)scopeNodes.add(el);
   let children=Array.from(el.childNodes||[]);
   if(el.shadowRoot)children=Array.from(el.shadowRoot.childNodes);
   if(el.localName==='slot'){const assigned=el.assignedNodes?.({flatten:true});if(assigned?.length)children=assigned;}
   for(let i=children.length-1;i>=0;i--)stack.push(children[i]);
  }
  if(stack.length&&!scopeEnd)throw new Error('section_scan_incomplete');
  if(!active)throw new Error('section_stale');
 }
 function scopeAllows(node){
  if(!scopeExcluded.size&&!scopeNodes)return true;
  const el=node.nodeType===1?node:node.parentElement||node.getRootNode().host;
  if(!el)return false;
  for(let p=el;p&&p!==opts.root;p=p.parentElement||p.getRootNode().host)if(scopeExcluded.has(p))return false;
  return !scopeNodes||scopeNodes.has(node)||(node.nodeType===1&&scopeAncestors.has(el));
 }
 // Traversal ancestors are needed for structure, but cannot widen a section read.
 function scopeInView(node){
  if(!opts.viewportOnly)return true;
  const el=node.nodeType===1?node:node.parentElement;if(!el)return false;
  let rects;if(node.nodeType===3){const range=document.createRange();range.selectNodeContents(node);rects=Array.from(range.getClientRects());}else rects=Array.from(el.getClientRects());
  let left=0,top=0,right=innerWidth,bottom=innerHeight;
  for(let p=el.parentElement||el.getRootNode().host;p;p=p.parentElement||p.getRootNode().host){const s=getComputedStyle(p),r=p.getBoundingClientRect();
   if(/^(auto|scroll|hidden|clip)$/.test(s.overflowX)){left=Math.max(left,r.left+p.clientLeft);right=Math.min(right,r.left+p.clientLeft+p.clientWidth);}
   if(/^(auto|scroll|hidden|clip)$/.test(s.overflowY)){top=Math.max(top,r.top+p.clientTop);bottom=Math.min(bottom,r.top+p.clientTop+p.clientHeight);}
  }
  return rects.some(r=>r.width>0&&r.height>0&&r.right>left&&r.left<right&&r.bottom>top&&r.top<bottom);
 }
 function scopeSelected(node){return scopeAllows(node)&&scopeInView(node)&&(!scopeNodes||(scopeNodes.has(node)&&!(scopeEnd&&scopeContains(node,scopeEnd))));}
`;
