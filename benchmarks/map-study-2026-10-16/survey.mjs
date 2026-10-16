import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const ROOT=process.cwd(), OUT=path.join(ROOT,'.runtime/map-study-2026-10-16/study');
const sites=[
 ['wikipedia','https://en.wikipedia.org/wiki/Apollo_11','article'],
 ['mdn','https://developer.mozilla.org/en-US/','docs-search'],
 ['github','https://github.com/microsoft/playwright/issues','issues'],
 ['hackernews','https://news.ycombinator.com/','ranked-table'],
 ['arxiv','https://arxiv.org/','academic-search'],
 ['pypi','https://pypi.org/','package-search'],
 ['npm','https://www.npmjs.com/','package-search'],
 ['stackoverflow','https://stackoverflow.com/questions','questions'],
 ['booking','https://www.booking.com/','travel-form'],
 ['airbnb','https://www.airbnb.com/','travel-form'],
 ['ebay','https://www.ebay.com/','shopping'],
 ['bestbuy','https://www.bestbuy.com/','shopping'],
 ['ikea','https://www.ikea.com/us/en/','shopping-menu'],
 ['googlemaps','https://www.google.com/maps','map-app'],
 ['openstreetmap','https://www.openstreetmap.org/','map-app'],
 ['google','https://www.google.com/','web-search'],
 ['duckduckgo','https://duckduckgo.com/','web-search'],
 ['bbc','https://www.bbc.com/','news'],
 ['reuters','https://www.reuters.com/','news'],
 ['allrecipes','https://www.allrecipes.com/','recipe'],
 ['archive','https://archive.org/','media-search'],
 ['gutenberg','https://www.gutenberg.org/','library'],
 ['python','https://docs.python.org/3/','docs-sidebar'],
 ['react','https://react.dev/learn','docs-sidebar'],
 ['typescript','https://www.typescriptlang.org/docs/','docs-sidebar'],
 ['w3c','https://www.w3.org/WAI/tutorials/','tutorial-navigation'],
 ['weather','https://www.weather.gov/','weather-map'],
 ['nasa','https://www.nasa.gov/','media-menu'],
 ['rust','https://doc.rust-lang.org/book/','book-sidebar'],
 ['nodejs','https://nodejs.org/api/','api-index'],
];
const probe=`(()=>{
 const norm=s=>String(s||'').replace(/\\s+/g,' ').trim();
 const box=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round)};
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
 const sample=e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),label:e.getAttribute('aria-label'),heading:norm(e.querySelector('h1,h2,h3')?.textContent).slice(0,90),box:box(e),textLength:norm(e.innerText).length,controls:e.querySelectorAll('input,button,select,textarea,a[href],[role=button]').length});
 const landmarks=[...document.querySelectorAll('header,nav,main,aside,footer,dialog,[role=main],[role=region],[role=complementary],[role=dialog],[role=search],[role=listbox],[role=menu]')].filter(visible);
 const splits=[];for(const e of [...document.querySelectorAll('body,main,section,div')].slice(0,6000)){
  if(splits.length>=10)break;const s=getComputedStyle(e);if(!/flex|grid/.test(s.display)||!visible(e))continue;
  const children=[...e.children].filter(c=>visible(c)&&c.getBoundingClientRect().width>120&&c.getBoundingClientRect().height>100);
  if(children.length<2||children.length>6)continue;const b=e.getBoundingClientRect();if(b.width*b.height<innerWidth*innerHeight*.2)continue;
  splits.push({display:s.display,direction:s.flexDirection,box:box(e),children:children.map(sample)});
 }
 return {url:location.href,title:document.title,readyState:document.readyState,viewport:[innerWidth,innerHeight],scroll:[scrollX,scrollY],bodyTextLength:norm(document.body?.innerText).length,landmarkCount:landmarks.length,landmarks:landmarks.slice(0,18).map(sample),headings:[...document.querySelectorAll('h1,h2,h3,[role=heading]')].filter(visible).slice(0,24).map(e=>({tag:e.tagName,text:norm(e.textContent).slice(0,100),box:box(e)})),splits};
})()`;
async function cli(args){return new Promise(resolve=>{const p=spawn(process.execPath,['--import','tsx','benchmarks/map-study-2026-10-16/control.mjs','study','cli',...args],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>{let data;try{data=JSON.parse(out)}catch{data={raw:out.slice(0,2000)}}resolve({code,data,stderr:err});});});}
async function load(id){return JSON.parse(await fs.readFile(path.join(OUT,id+'.json'),'utf8'));}
async function save(id,data){await fs.writeFile(path.join(OUT,id+'.json'),JSON.stringify(data,null,2));}
function summary(id,r){const m=r.map?.data||r.open?.data||{},d=r.probe?.data||{};return {id,session:r.session,url:m.url,title:m.title,pageState:m.pageState,mapError:m.observationError,coverage:m.coverage,panels:m.panels?.map(p=>({id:p.id,role:p.role,name:p.name,parent:p.parent,position:p.position,controls:p.controls?.map(c=>({role:c.role,name:c.name,ref:c.ref}))})),diagnostics:{textLength:d.bodyTextLength,landmarkCount:d.landmarkCount,headings:d.headings?.slice(0,8),splits:d.splits?.slice(0,4)},screenshot:r.shot?.data?.file};}
const [op,a,b,...rest]=process.argv.slice(2);
if(op==='visit')for(const [id,url,kind]of sites.slice(Number(a),Number(a)+Number(b))){
 const open=await cli(['session','open','--url',url,'--viewport','1440x900','--locale','en-US']);const session=open.data.id;const r={id,url,kind,session,open};
 if(session){r.probe=await cli(['eval','--session',session,'--expr',probe]);r.shot=await cli(['screenshot','--session',session]);}
 await save(id,r);console.log(JSON.stringify(summary(id,r)));
}
else if(op==='cli'){const r=await load(a);console.log(JSON.stringify(await cli([b,'--session',r.session,...rest])));}
else if(op==='known'){const r=await load(a);const [name,action,...extra]=rest;const m=r.map?.data||r.open.data;const matches=m.panels?.flatMap(p=>p.controls||[]).filter(c=>c.role===b&&c.name===name)||[];if(matches.length!==1)throw Error('Observed map target not unique: '+matches.length);const response=await cli([action,'--session',r.session,'--role',b,'--name',name,'--exact',...extra]);await save(a+'-action-'+Date.now(),{id:a,target:matches[0],response});console.log(JSON.stringify(response));}
else if(op==='state'){const r=await load(a);r.map=await cli(['snapshot','--session',r.session]);r.probe=await cli(['eval','--session',r.session,'--expr',probe]);r.shot=await cli(['screenshot','--session',r.session]);await save(a+'-'+(b||'after'),r);console.log(JSON.stringify(summary(a,r)));}
else if(op==='close'){const r=await load(a);console.log(JSON.stringify(await cli(['session','close','--session',r.session])));}
else throw Error('visit/start/count, cli/site/command/args, state/site/tag, close/site');
