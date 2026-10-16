import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
const root=process.cwd(),dir='.runtime/map-study-2026-10-16/study';
const plans=[
 ['hackernews',[['cli','hackernews','scroll','--distance','850']]],
 ['arxiv',[['known','arxiv','link','Search','click']]],
 ['pypi',[['known','pypi','textbox','Search PyPI','fill','--value','playwright','--submit']]],
 ['npm',[]],
 ['stackoverflow',[['known','stackoverflow','button','More','click']]],
 ['booking',[['cli','booking','press','--key','Escape'],['known','booking','button','Select dates Check-in date — Check-out date','click']]],
 ['airbnb',[]],
 ['bestbuy',[['known','bestbuy','link','United States','click']]],
 ['ikea',[['known','ikea','button','Ok','click'],['known','ikea','button','Products','click']]],
 ['googlemaps',[['known','googlemaps','combobox','Google 지도 검색','fill','--value','Paris museums','--submit']]],
 ['openstreetmap',[['known','openstreetmap','textbox','Search','fill','--value','Paris','--submit']]],
 ['google',[]],
 ['duckduckgo',[['known','duckduckgo','combobox','Search with DuckDuckGo','fill','--value','Paris museums','--submit']]],
 ['bbc',[['known','bbc','button','Open menu','click']]],
 ['allrecipes',[['known','allrecipes','textbox','Search the site','fill','--value','vegetarian pasta','--submit']]],
 ['archive',[['known','archive','button','Toggle options','click']]],
 ['gutenberg',[['known','gutenberg','textbox','Search books','fill','--value','Alice','--submit']]],
 ['python',[['known','python','link',"What's new in Python 3.15?",'click']]],
 ['react',[['known','react','button','Search Ctrl K','click']]],
 ['typescript',[['known','typescript','combobox','Search the TypeScript site','fill','--value','generics']]],
 ['w3c',[['cli','w3c','scroll','--distance','850']]],
 ['weather',[['known','weather','textbox','Local forecast by "City, St" or ZIP code','fill','--value','New York','--submit']]],
 ['nasa',[['known','nasa','button','Explore','click']]],
 ['rust',[['known','rust','link','Foreword','click']]],
 ['nodejs',[['known','nodejs','link','Table of contents','click']]],
];
const run=args=>new Promise(resolve=>{const p=spawn(process.execPath,['benchmarks/map-study-2026-10-16/survey.mjs',...args],{windowsHide:true,cwd:root,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>resolve({code,out,err}));});
const start=Number(process.argv[2]||0),count=Number(process.argv[3]||5);
for(const [site,actions] of plans.slice(start,start+count)){
 const results=[];for(const action of actions){const r=await run(action);let d;try{d=JSON.parse(r.out)}catch{d={error:r.err||r.out}}results.push({action,result:d});}
 const state=await run(['state',site,'transition']);await fs.writeFile(dir+'/'+site+'-transition-actions.json',JSON.stringify(results,null,2));
 let data;try{data=JSON.parse(state.out)}catch{data={error:state.err||state.out}};
 console.log(JSON.stringify({site,actions:results.map(r=>({op:r.action,result:r.result?.data?{ok:r.result.data.ok,execution:r.result.data.execution,reason:r.result.data.reason,error:r.result.data.error,focus:r.result.data.focus?.role}:r.result})),state:data}));
}
