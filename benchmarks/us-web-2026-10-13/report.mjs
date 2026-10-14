import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const s=JSON.parse(await fs.readFile(path.join(base,'summary.json'),'utf8'));
const rows=JSON.parse(await fs.readFile(path.join(base,'results-live.json'),'utf8'));
const scenarios=JSON.parse(await fs.readFile(path.join(base,'scenarios.json'),'utf8'));
const a=s.methods.bu,b=s.methods.hb,p=s.successfulPairSummary;
const names={google:'Google',amazon:'Amazon',walmart:'Walmart',ebay:'eBay',bestbuy:'Best Buy',booking:'Booking.com',expedia:'Expedia',wikipedia:'Wikipedia',weather:'Weather.com',imdb:'IMDb'};
const sec=v=>(v/1000).toFixed(1),pct=(n,d)=>(100*n/d).toFixed(1)+'%',num=v=>Number(v).toFixed(1);
const table=(head,data)=>'| '+head.join(' | ')+' |\n| '+head.map(()=>'---').join(' | ')+' |\n'+data.map(r=>'| '+r.join(' | ')+' |').join('\n');
const metrics=table(['항목','A · browser-use CLI','B · hyper-browsing'],[
 ['유효 시행',30,30],['전체 조건 성공',`${a.strictSuccess}/30 (${pct(a.strictSuccess,30)})`,`${b.strictSuccess}/30 (${pct(b.strictSuccess,30)})`],['체크포인트 충족',`${a.checkpointTotal}/120 (${pct(a.checkpointTotal,120)})`,`${b.checkpointTotal}/120 (${pct(b.checkpointTotal,120)})`],['부분 완료',a.statuses.partial,b.statuses.partial],['최종 차단',a.statuses.blocked,b.statuses.blocked],['실패',a.statuses.failed,b.statuses.failed],['종료까지 시간 중앙값 · 초',sec(a.taskWallMs.median),sec(b.taskWallMs.median)],['브라우저 명령 중앙값',num(a.browserCommands.median),num(b.browserCommands.median)],['에이전트 전체 시간 중앙값 · 초',sec(a.agentWallMs.median),sec(b.agentWallMs.median)],['전체 도구 호출 중앙값',num(a.agentToolCalls.median),num(b.agentToolCalls.median)],['비도구 시간 중앙값 · 초',sec(a.nonToolMs.median),sec(b.nonToolMs.median)],['추론 출력 토큰 중앙값',num(a.reasoningOutputTokens.median),num(b.reasoningOutputTokens.median)],['실제 headed 전환 시행',a.headedSwitches,b.headedSwitches]
]);
const sites=table(['사이트','A 성공/3','B 성공/3','A 점수 R1/R2/R3','B 점수 R1/R2/R3','A 시간 중앙값 [최소–최대] 초','B 시간 중앙값 [최소–최대] 초'],s.sites.map(x=>[names[x.site],x.bu.strictSuccess,x.hb.strictSuccess,x.bu.scores.join('/'),x.hb.scores.join('/'),`${sec(x.bu.taskWallMs.median)} [${sec(x.bu.taskWallMs.min)}–${sec(x.bu.taskWallMs.max)}]`,`${sec(x.hb.taskWallMs.median)} [${sec(x.hb.taskWallMs.min)}–${sec(x.hb.taskWallMs.max)}]`]));
const tasks=table(['사이트','대표 액션 세트'],scenarios.map(x=>[names[x.site],x.task]));
const paired=table(['사이트·반복','A 초','B 초','A 명령','B 명령'],s.successfulPairs.map(x=>[`${names[x.site]} · ${x.repeat}`,sec(x.buMs),sec(x.hbMs),x.buCommands,x.hbCommands]));
const corrections=rows.filter(r=>r.status!==r.claimedStatus||r.auditNotes?.includes('수정')||r.id==='r1_bestbuy_hb'||r.id==='r1_expedia_bu');
const md=`# 미국 비SNS 사이트 브라우징 비교 실험

2026년 10월 13일 · 탐색적 실사용 비교 · 독립 Luna 에이전트 · 학습 비활성화

## 핵심 결과

10개 사이트에서 두 방법을 각각 3회 수행한 **60개 유효 시행**을 원시 명령 출력과 대조했다. 전체 4개 체크포인트를 충족한 시행은 A ${a.strictSuccess}/30, B ${b.strictSuccess}/30이었다. 이 수치는 동일 Luna 판단자와 설치된 CLI/스킬 조합의 결과이며 브라우저 엔진만의 성능을 분리한 수치가 아니다.

측정된 가장 직접적인 개선 후보는 Windows 요소 참조 전달, 위험도 판정 오탐, 스냅샷 오류, 새 탭의 전달·초기 설정이다. CAPTCHA와 지역·언어 차이도 결과에 영향을 주므로 성공 차이를 모두 제품 차이로 돌릴 수 없다.

## 실험 범위와 조건

A는 설치된 browser-use CLI를 Python helper/AX·DOM 관찰·CDP 조작으로 사용했다. Python 패키지 browser-use 0.13.11, 실제 CLI browser-harness 0.1.13이다. browser_use.Agent SDK와 해당 제품의 자체 모델·프롬프트를 실행한 실험은 아니다. B는 현재 hyper-browsing 작업 트리의 SKILL.md와 webctl 스크립트·명령을 사용했다.

모든 시행은 gpt-6-luna, reasoning effort medium, 별도 맥락·프로필·Chrome/CDP·daemon으로 실행했다. 다른 시행의 해법이나 결과는 제공하지 않았다. 동일 도메인 동시 실행을 피하고 최대 3개 다른 사이트를 병렬 실행했다. 방법 순서를 사이트와 반복별로 교차했다. 최초 headless, 동일 Chrome 155.0.8059.40, 초기 요청 viewport 1440×900, 언어 en-US로 준비했다.

첫 브라우저 명령부터 8분, 래퍼 호출 45회가 상한이었다. 환경 reveal도 호출 예산에 포함된다. 진행 중 명령은 상태를 기다리고 같은 쓰기를 재전송하지 않도록 안내했다. CAPTCHA에는 한 기본 복구 후 중지했으며, 복구 방식·조기 중지 선택은 시행자마다 달랐다. 로그인·구매·예약 확정·게시를 수행하지 않았다.

**사이트 학습·노하우 저장·액션/러너 생성·수정·승격을 금지했다.** B 자동 학습 관찰을 설정으로 비활성화했고 자산 명령과 --learn을 래퍼에서 거부했다. A domain skills 및 telemetry/recording도 껐다. 따라서 이 실험은 학습 자산의 재사용 이득이나 자동 수리 효과를 검증하지 않는다.

B headed 폴백은 제품 기능이다. A에는 비교 환경 관리기를 통한 headed 재시작 1회를 허용했고 이후 웹 수행은 계속 browser-use로 했다. A의 이 복구는 고유 제품 기능이 아니며 시간에 포함된다. 실제 전환은 시작/종료 Chrome 상태로 세었다.

## 대표 시나리오

${tasks}

Google·Amazon·Walmart·eBay·Best Buy와 Booking·Expedia는 공개 미국 사이트/분야 순위 자료를 참고했다. Wikipedia·Weather.com·IMDb는 지식·날씨·영화 목적을 보완한다. **미국 전체 인기 상위 10개라는 표본은 아니다.** 선정 자료는 [Similarweb 미국 순위](https://www.similarweb.com/top-websites/united-states/), [미국 전자상거래 순위](https://www.similarweb.com/top-websites/united-states/e-commerce-and-shopping/), [전자상거래 업체 분석](https://www.similarweb.com/blog/sales/selling-to-ecommerce/top-ecommerce-companies-usa/), [Semrush 미국 여행 순위](https://www.semrush.com/trending-websites/us/travel-and-tourism)다.

## 성공 판정

사전에 고정한 4개 체크포인트를 화면·URL·현재 DOM 원문으로 확인했다. **4/4만 전체 성공**이다. 1~3점은 달성 단계의 진단값이다. 최종 원인이 사람 확인이나 접근 거부이면 점수가 일부 있어도 blocked로 분류했다. 일반 진입 UI 조작 실패는 failed로 구분했다. 4개 점수를 서로 독립적인 과업 4개처럼 해석하지 않는다.

체크포인트는 수행 중 충족 이력을 표시하므로 마지막 화면에서 모든 조건이 유지됐다는 뜻은 아니다. Booking A의 일부 2/4 결과에는 요청 날짜가 적용되지 않은 1박 도시 카드 읽기가 포함된다. 그 가격은 요청한 2박·무료 취소 가격으로 인정하지 않았고 전체 성공으로 집계하지 않았다. IMDb는 현재 DOM의 Top Cast 또는 관찰된 cast 링크로 배우를 확인하면 정보 과업 충족으로 인정했으며 물리적 스크롤 성공을 별도로 기록했다.

## 전체 집계

${metrics}

![사이트별 전체 성공 횟수](success-by-site.png)

종료 시간에는 성공·부분 완료·차단·실패가 모두 포함된다. 빨리 차단된 시행의 짧은 시간은 효율적인 작업 완료를 의미하지 않는다. 준비 시간은 별도 CSV에 기록하고 정리 시간은 과업 시간에서 제외했다.

## 사이트별 결과

${sites}

점수는 각 시행 0~4이다. 동적 가격·날씨가 3회 동일해야 한다는 조건은 두지 않았다. Weather의 New York City와 Manhattan 위치 세분화가 달라 예보 값이 달랐으며, 값의 차이를 도구 오류로 처리하지 않았다.

## 양쪽 모두 성공한 대응 시행의 시간

같은 사이트·반복에서 두 방법이 모두 성공한 ${p.n}쌍만 비교하면 A 시간 중앙값은 ${sec(p.buMedianMs)}초, B는 ${sec(p.hbMedianMs)}초였다. 각 쌍의 B/A 시간 비율 중앙값은 ${p.medianHbOverBu.toFixed(3)}이다. 성공한 일부 사례로 제한된 기술 통계이며 모든 사이트의 예상 시간이나 모집단 우월성을 뜻하지 않는다.

로그 번호 충돌이 있었던 시행을 포함한 쌍을 제외하면 ${s.successfulPairsWithoutNumberCollisions.n}쌍, B/A 비율 중앙값 ${s.successfulPairsWithoutNumberCollisions.medianHbOverBu.toFixed(3)}이다. 이 보조 집계는 계측 예외의 영향을 살펴보는 용도다.

${paired}

![둘 다 성공한 대응 시행 시간](successful-pairs-time.png)

## 시간·단계·추론 지표 해석

taskWallMs는 첫 브라우저 명령 시작부터 마지막 기록 명령 종료까지다. agentWallMs는 서브에이전트 배정부터 최종 완료까지여서 지침 읽기·증거 기록도 포함한다. browserCommandCount는 실제 기록된 브라우저 래퍼 호출 수이며 환경 reveal은 별도 표시했다. 호출 안에 여러 helper가 들어갈 수 있어 실제 클릭 수와 같지 않다. agentToolCalls는 파일 읽기·편집·폴링 등을 포함한 전체 도구 호출 수다.

내부 사고 시간은 직접 제공되지 않아 reasoningTimeMs는 빈 값이다. nonToolMs는 에이전트 전체 시간에서 도구 구간의 합집합을 뺀 값이며 추론·응답 생성·오케스트레이션·대기 등이 섞인다. **순수 사고 시간이라고 부르지 않는다.** 실제 reasoning_output_tokens를 함께 제공했다. input_tokens에는 캐시 입력이 포함되므로 CSV의 cachedInputTokens를 같이 봐야 하며 금액이나 순수 추론 비용은 추정하지 않았다.

A의 helper marker 수와 B의 명령 수는 추상화 수준이 달라 저수준 동작 수로 직접 비교하지 않았다. 모든 세션의 숨겨진 추론 내용·시스템 지침은 공개 산출물에서 제외했다.

## 시행 중 어려움과 개선 근거

Windows에서 따옴표 없는 @e 참조가 PowerShell 인자 전달에 실패했고, 의미 locator로 다시 관찰해 복구하는 경우가 많았다. Best Buy의 국가/상품 읽기 링크와 eBay 검색 필터가 외부 쓰기로 분류된 사례도 있었다. 스냅샷에서 잘린 긴 상품 이름으로 클릭을 요청하다 no_match를 겪은 뒤 headed 전환과 재탐색을 거친 사례가 확인됐다.

Walmart B 3차의 snapshot은 n.children is not iterable 예외로 끝났다. 별도 스크린샷에는 사람 확인 화면이 있었다. DOM 관찰 오류와 사이트 차단은 함께 발생했지만 같은 원인으로 단정하지 않았다. 상세 원인은 후속 재현이 필요하다.

A는 초기 빈 DOM, 입력값/포커스 유지, 스크롤 IPC 5초 timeout, 스크린샷 60초 timeout에서 어려움을 겪었다. Amazon 1차의 조기 종료 뒤 2·3차는 복구해 성공했으므로 첫 실패를 엔진의 영구 접근 불가로 해석하면 안 된다. Booking A에서는 선택한 날짜가 결과에 반영되지 않아 1박 카드로 끝난 사례가 있었다.

문제별 명령 ID, 수정 후보와 회귀 테스트 제안은 [개선 후보 문서](improvement-candidates.ko.md)에 정리했다. 제품 수정은 측정 종료 후 별도 작업으로 해야 한다.

## 독립 검토와 인프라 예외

root가 시행자의 자기 보고를 원시 출력과 대조했다. 대표적으로 Best Buy B 1차는 상세 읽기 미충족으로 3점에서 2점, Expedia A 1차는 도시 선택 증거 미충족으로 1점에서 0점으로 수정했다. Booking A 3차는 1·2차와 같은 단계 진단 기준을 적용해 일반 도시 카드 읽기를 인정하고 1점에서 2점으로 수정했으며, 요청한 2박 가격은 여전히 미검증이다. 최종 CAPTCHA에 도달한 부분 시행은 blocked, 일반 국가 선택 화면에서 진행이 멈춘 Best Buy A 3차는 failed로 분류했다. 변경 근거는 evidence.json의 auditNotes에 남겼다.

초기 B 측정 래퍼가 fast-path 종료 42를 실제 런처로 넘기지 않아 forms 명령을 지원하지 않는 인프라 오류가 있었다. 영향을 받은 Booking B 1차 원본은 성공 자기 보고였지만 무효로 보존하고, 결과와 무관하게 동일 기준의 새 Luna·프로필로 재시행했다. 유효 60회 외에 이 무효 1회가 실제 수행됐다. 파일은 invalid-trials.json으로 추적한다. 파일 수를 맞추기 위해 실제 실패를 성공 시행으로 교체하지 않았다. 준비용 pilot은 집계에서 제외했다.

제품 소스 59개 파일의 시행 전 해시를 보존했고 완료 검증에서 동결 상태를 확인한다. 래퍼 fallback 수정, 남은 시간에 따른 호출 timeout 상한, 도구 시간·headed 계측 보완은 인프라 변경으로 기록했다.

Google A/B 2차와 IMDb B 3차에서 느린 호출이 끝나기 전에 다음 조회를 보내 로그 번호가 충돌했다. 래퍼가 완료된 행 수로 번호를 배정해 두 호출이 같은 번호를 받았고 호출 출력 파일 하나씩이 덮어써졌다. 두 호출의 시간·인자·종료 코드는 append 로그에 모두 남아 실제 행 수로 집계했다. IMDb B 3차는 실제 19호출이며 주요 체크포인트 명령 7–19는 온전했다. Google A의 공식 페이지 증거와 Google B의 최종 CAPTCHA도 별도 보존 출력에서 확인해 시행을 유지했다. 이 3개 계측 예외는 CSV의 duplicateCommandSequences와 독립 판정에 표시했으며, 호출 파일 수로 계산한 저수준 동작 수는 비교에 사용하지 않았다. 향후 래퍼 번호 배정은 시작 시 원자적으로 예약해야 한다.

## 한계와 보고 가능한 결론

셀당 3회이며 10개 목적표집 사이트다. 동일 머신과 네트워크에서 실행해 CPU·네트워크·headed 창이 공유되고 사이트 차단 상태가 시간에 따라 달랐다. 순서를 교차했지만 완전 무작위 배정은 아니다. 반복별 개선을 학습 효과로 해석할 수 없다.

미국 사이트를 대상으로 했지만 미국 IP·시간대·배송지를 고정하지 않았다. 실행 머신은 Windows/Asia-Seoul 환경이고 Amazon은 대한민국 배송·KRW, eBay는 GBP/KRW 또는 USD를 표시했다. Google은 일부 한국어 UI를 보였다. 초기 en-US 요청만으로 실제 사이트 언어/지역이 같다고 보장할 수 없다. 팝업에서 929×917 viewport가 관찰된 사례도 있어 1440×900을 전 과정 보장했다고 주장하지 않는다.

따라서 외부 보고는 **이 환경에서 동일 Luna가 수행한 CLI/스킬 조합의 관찰 결과와 개선 근거**로 한정하는 것이 타당하다. browser-use SDK 전체, 순수 Playwright 엔진, 미국 사용자 모집단의 우열이나 통계적 유의성은 이 실험으로 입증하지 않았다.

## 제공 파일

- report.html: 차트가 포함된 단일 파일 보고서
- results.csv: 60개 시행의 점수·시간·호출·토큰 지표
- summary.json: 사이트·방법별 집계와 성공 대응쌍
- evidence.json: 공개용 최소 체크포인트 근거·출력·난점·독립 판정
- protocol.md / scenarios.json / agent-guide.md / versions.json: 고정 시나리오·지침·버전·해시
- invalid-trials.json / improvement-candidates.ko.md: 제외 시행과 개선 후보

원시 명령 로그·프로필·쿠키·daemon 토큰은 공개 패키지에 넣지 않았다. 필요한 원문 검증은 보존한 로컬 시행 로그를 이용할 수 있다.
`;
await fs.writeFile(path.join(base,'report.ko.md'),md);
console.log('Korean report written');
