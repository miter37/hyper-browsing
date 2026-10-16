import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const old='benchmarks/hb-retest-2026-10-16/',base='benchmarks/hb-headed-four-2026-10-16/';
let control=await fs.readFile(old+'control.mjs','utf8');
control=control.replaceAll('hb-retest-2026-10-16','hb-headed-four-2026-10-16').replace("benchmarks/us-web-2026-10-13/scenarios.json","benchmarks/hb-headed-four-2026-10-16/scenarios.json").replace("WEBAGENT_HEADLESS:'1'","WEBAGENT_HEADLESS:'0'").replace('46160+index','46260+index').replace('10160+index','10260+index');
await fs.writeFile(base+'control.mjs',control);
for(const file of ['monitor.mjs','analyze.mjs']){let s=await fs.readFile(old+file,'utf8');s=s.replaceAll('hb-retest-2026-10-16','hb-headed-four-2026-10-16').replaceAll('benchmarks/us-web-2026-10-13/scenarios.json','benchmarks/hb-headed-four-2026-10-16/scenarios.json').replaceAll('/root/retest_','/root/headed4_');await fs.writeFile(base+file,s);}
let guide=await fs.readFile(old+'agent-guide.md','utf8');guide=guide.replaceAll('hb-retest-2026-10-16','hb-headed-four-2026-10-16');
guide=guide.replace('root가 사이트 전용의 새 headless Chrome과 daemon을 준비했다.','root가 사이트 전용의 새 headed Chrome과 daemon을 준비했다. 이번에는 처음부터 headed다. browser reveal로 다시 시작하지 않는다.');
const start=guide.indexOf('headless에서 접근 제한이 확인되면'),end=guide.indexOf('첫 브라우저 명령부터',start);
guide=guide.slice(0,start)+'처음부터 headed다. 차단이 확인되면 현재 상태를 기록하고 종료한다. CAPTCHA 우회나 사용자 호출, 반복 reveal은 하지 않는다.\n\n'+guide.slice(end);
await fs.writeFile(base+'agent-guide.md',guide);
const previous=JSON.parse(await fs.readFile(old+'versions.json','utf8')),sourceHashes={};
for(const file of Object.keys(previous.sourceHashes)){sourceHashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}
await fs.writeFile(base+'versions.json',JSON.stringify({frozenAt:new Date().toISOString(),projectRoot:process.cwd(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:true,model:'gpt-6-luna',effort:'medium',headed:true,trialsPerSite:1,learning:false,sourceHashes},null,2));
console.log('Prepared isolated headed experiment; current product sources frozen.');
