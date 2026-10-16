import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=process.cwd(),dir=path.join(root,'.runtime/filter-study-2026-10-16/study');
const probe=String.raw`(()=>{
 const text=e=>String(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,110);
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
 const box=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round)};
 const css=e=>{if(e.id)return '#'+CSS.escape(e.id);const a=[];for(let n=e;n&&n!==document.body;n=n.parentElement){a.unshift(n.localName+':nth-of-type('+(Array.from(n.parentElement?.children||[]).filter(c=>c.localName===n.localName).indexOf(n)+1)+')');if(a.length>=32)break;}const selector='body>'+a.join('>');return document.querySelector(selector)===e?selector:null};
 const controls=[...document.querySelectorAll('input,select,button,[role=button],[role=slider],[role=combobox],[role=spinbutton]')].filter(visible);
 const pick=e=>({tag:e.localName,role:e.getAttribute('role'),type:e.type,name:e.getAttribute('aria-label')||e.labels?.[0]?.innerText||e.getAttribute('placeholder')||text(e),value:e.type==='password'?'redacted':e.value,readonly:e.readOnly||undefined,min:e.min||e.getAttribute('aria-valuemin'),max:e.max||e.getAttribute('aria-valuemax'),step:e.step,now:e.getAttribute('aria-valuenow'),expanded:e.getAttribute('aria-expanded'),controls:e.getAttribute('aria-controls'),disabled:e.disabled||e.getAttribute('aria-disabled'),box:box(e)});
 const scrollers=[...document.querySelectorAll('body *')].slice(0,7000).filter(e=>{if(!visible(e))return false;const s=getComputedStyle(e);return /(auto|scroll)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+2&&e.clientHeight>100});
 return {url:location.href,title:document.title,viewport:[innerWidth,innerHeight],bodyLength:document.body?.innerText.length,controls:controls.filter(e=>e.matches('input,select,[role=slider],[role=combobox],[role=spinbutton]')||/date|check.in|check.out|when|calendar|price|budget|filter|apply|done|next|previous|month|departure|return|currency/i.test(text(e))).slice(0,45).map(pick),headings:[...document.querySelectorAll('h1,h2,h3,[role=heading]')].filter(visible).slice(0,12).map(text),scrollers:scrollers.slice(0,5).map(e=>({selector:css(e),box:box(e),offset:e.scrollTop,extent:e.scrollHeight,headings:[...e.querySelectorAll('h2,h3,[role=heading]')].slice(0,3).map(text)}))};
})()`;
async function cli(args){return new Promise(resolve=>{const p=spawn(process.execPath,['--import','tsx','benchmarks/filter-study-2026-10-16/control.mjs','study','cli',...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>{let data;try{data=JSON.parse(out)}catch{data={raw:out.slice(0,500),stderr:err.slice(0,500)}}resolve({code,data});});});}
const brief=r=>({id:r.id,session:r.session??undefined,map:(r.map?.data?{at:r.map.data.at,panels:r.map.data.panels?.map(p=>({id:p.id,role:p.role,name:p.name,headings:p.headings,basis:p.basis,controls:p.controls})),pageState:r.map.data.pageState}:undefined),probe:r.probe?.data,shot:r.shot?.data});
const [op,id,...args]=process.argv.slice(2),file=path.join(dir,id+'.json');
const load=()=>fs.readFile(file,'utf8').then(JSON.parse),save=r=>fs.writeFile(file,JSON.stringify(r,null,2));
if(op==='visit'){
 const open=await cli(['session','open','--url',args[0],'--viewport',args[1]||'1440x900','--locale','en-US']);const r={id,url:args[0],session:open.data.id,open,states:[]};await save(r);
 if(r.session){r.map=open;if(!open.data.panels?.length)r.map=await cli(['snapshot','--session',r.session]);r.probe=await cli(['eval','--session',r.session,'--expr',probe]);r.shot=await cli(['screenshot','--session',r.session]);await save(r);}
 console.log(JSON.stringify(brief(r)));
}else if(op==='cli'){
 const r=await load(),result=await cli([args[0],'--session',r.session,...args.slice(1)]);r.states.push({at:new Date().toISOString(),args,result});await save(r);console.log(JSON.stringify(result.data));
}else if(op==='state'){
 const r=await load(),state={tag:args[0],at:new Date().toISOString(),map:await cli(['snapshot','--session',r.session]),probe:await cli(['eval','--session',r.session,'--expr',probe]),shot:await cli(['screenshot','--session',r.session])};r.states.push(state);await save(r);console.log(JSON.stringify(brief({id,...state})));
}else if(op==='scroll-owner'){const r=await load(),p=[...r.states].reverse().find(s=>s.probe?.data?.scrollers?.length)?.probe.data;const selector=p?.scrollers[Number(args[0])||0]?.selector;if(!selector)throw Error('No observed validated selector');const result=await cli(['scroll','--session',r.session,'--selector',selector,'--distance',args[1]||'220']);r.states.push({tag:'observed-owner-scroll',selector,result});await save(r);console.log(JSON.stringify(result.data));}
else if(op==='probe'){const r=await load();const result=await cli(['eval','--session',r.session,'--expr',await fs.readFile(args[0],'utf8')]);r.states.push({tag:'diagnostic',at:new Date().toISOString(),result});await save(r);console.log(JSON.stringify(result.data));}
else if(op==='close'){const r=await load();console.log(JSON.stringify(await cli(['session','close','--session',r.session])));}
else throw Error('visit ID URL | cli ID COMMAND ... | state ID TAG | close ID');
