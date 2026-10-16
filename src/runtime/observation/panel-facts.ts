/** Shared bounded region facts. A descendant heading is evidence, never a region name. */
export const PANEL_FACTS_JS=String.raw`
 const panelParent=el=>el.parentElement||el.getRootNode()?.host;
 const panelContains=(root,node)=>{for(let p=node;p;p=panelParent(p))if(p===root)return true;return false;};
 const panelClean=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,120);
 const panelVisible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const panelInView=el=>{
  let left=0,top=0,right=innerWidth,bottom=innerHeight;
  for(let p=panelParent(el);p;p=panelParent(p)){const s=getComputedStyle(p),r=p.getBoundingClientRect();
   if(/^(auto|scroll|hidden|clip)$/.test(s.overflowX)){left=Math.max(left,r.left+p.clientLeft);right=Math.min(right,r.left+p.clientLeft+p.clientWidth);}
   if(/^(auto|scroll|hidden|clip)$/.test(s.overflowY)){top=Math.max(top,r.top+p.clientTop);bottom=Math.min(bottom,r.top+p.clientTop+p.clientHeight);}
  }
  return Array.from(el.getClientRects()).some(r=>r.width>0&&r.height>0&&r.right>left&&r.left<right&&r.bottom>top&&r.top<bottom);
 };
 const panelFacts=(el,otherRoots=[],viewportOnly=false)=>{
  let name='',nameSource;
  const labels=(el.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean).map(id=>el.getRootNode().getElementById?.(id));
  if(labels.length&&labels.every(Boolean)){name=panelClean(labels.map(n=>n.textContent).join(' '));nameSource='labelledby';}
  else if(el.hasAttribute('aria-label')){name=panelClean(el.getAttribute('aria-label'));nameSource='aria-label';}
  const headings=[],stack=[el];let visits=0;
  while(stack.length&&visits++<160){const n=stack.pop();if(n!==el&&otherRoots.includes(n))continue;
   if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)||n.hidden||getComputedStyle(n).display==='none'||getComputedStyle(n).visibility==='hidden')continue;
   if(n.matches('h1,h2,h3,h4,h5,h6,[role=heading]')&&panelVisible(n)&&(!viewportOnly||panelInView(n))){const text=panelClean(n.innerText);if(text&&!headings.includes(text))headings.push(text);if(headings.length===2)break;}
   const children=n.shadowRoot?Array.from(n.shadowRoot.children):n.localName==='slot'&&n.assignedElements().length?n.assignedElements({flatten:true}):Array.from(n.children);
   for(let i=children.length-1;i>=0;i--)stack.push(children[i]);
  }
  return {...(name?{name,nameSource}:{}),...(headings.length?{headings}:{})};
 };
`;
