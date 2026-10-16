# 동일 10개 과업: 과거 HB와 현재 HB 재시험

2026-10-16 · 독립 gpt-6-luna / medium · 사이트당1회 · 학습 OFF · 순차 실행

현재 10/10개 준비 기록, 감사 완료 10개. 성공 5, 부분 2, 차단 3, 실패 0.

이번에는 현재 프로젝트 HB만 새로 실행했다. browser-use와 바닐라 브라우저 대조군은 실행하지 않았다. 과거 값은 2026-10-13 HB의 사이트별3회 중앙값이며 현재는1회다. 사이트 상태·가격·차단 조건이 달라질 수 있어 인과적 향상률이나 통계적 우월성을 주장하지 않는다.

브랜치: feat/goal-driven-core-relay, HEAD: b26b845a693db945eff9dd99268149ae18dac0b4, 미커밋 소스 해시 동결. 실험 중 변경된 동결 파일: 0.

## 과업 결과와 시간

| 사이트 | 과거 성공/3 | 현재 단계/4 | 결과 | 과거 시간(초) | 현재 시간(초) | 과거 호출 | 현재 호출 | 최종 모드 |
|---|---:|---:|---|---:|---:|---:|---:|---|
| google | 0/3 | 1/4 | 차단 | 52.1 | 74.0 | 7 | 9 | headed |
| amazon | 3/3 | 4/4 | 성공 | 115.3 | 103.4 | 17 | 24 | headless |
| walmart | 0/3 | 1/4 | 차단 | 41.4 | 110.5 | 11 | 11 | headed |
| ebay | 3/3 | 4/4 | 성공 | 124.6 | 95.7 | 24 | 15 | headed |
| bestbuy | 0/3 | 2/4 | 부분 | 213.2 | 268.9 | 33 | 45 | headed |
| booking | 3/3 | 2/4 | 부분 | 208.6 | 228.5 | 32 | 45 | headless |
| expedia | 1/3 | 0/4 | 차단 | 32.3 | 28.3 | 1 | 1 | headed |
| wikipedia | 3/3 | 4/4 | 성공 | 47.8 | 122.0 | 11 | 21 | headed |
| weather | 3/3 | 4/4 | 성공 | 156.8 | 93.9 | 25 | 21 | headed |
| imdb | 3/3 | 4/4 | 성공 | 129.9 | 66.1 | 17 | 9 | headed |

## 해석과 우선 개선점

- eBay·Weather·IMDb는 이번 시행에서 시간과 호출이 함께 감소했다. Amazon은 시간이 소폭 줄었지만 호출은 늘었고, 명시적 legacy JSON snapshot 하나가 약1.9MB를 생성했다. 성공만으로 효율이 좋아졌다고 볼 수 없다.
- Wikipedia는 과업을 완료했지만 과거보다 느렸다. 입력 뒤 Enter에서 DOM 분리가 발생했고, 형식 오류와 불필요한 자동 headed 전환이 비용을 만들었다.
- Booking은 과거3회 모두 성공했으나 이번에는 날짜가 유지되지 않고 무료 취소도 적용하지 못했다. 관찰된 호텔 가격은 기본1박 가격이며 요청한2박 가격이 아니다. 원인은 이번 기록만으로 확정하지 않는다.
- Best Buy는 검색과 브랜드 필터까지만 완료했다. 종료 후 root가 확인한 스크린샷에서는 주요 상품 행이 빈 상태였다. 에이전트는 스크린샷 경로를 받았어도 이미지를 열어 보지 않았다.
- Google·Walmart·Expedia는 접근 제한이 관찰됐다. Google·Expedia의 headed 전환 후 접근 가능성은 확인하지 못했으므로 headed에서도 실패했다고 확대하지 않는다.
- 우선 후보는 요청 스키마/오류의 명료화, 모드 전환 후 현재 세션·상태 전달, 큰 출력 우회 경로 제한, 닫힌 자동완성에서 후속 읽기 범위 전환, 입력 후 DOM 교체 복구다. 사이트 이름·문구에 맞춘 실행 예외는 제안하지 않는다.

상세 공통 후보: [improvement-candidates.ko.md](improvement-candidates.ko.md). 아래 과정 감사는 원시 명령에 대조한 기술 기록이다.

시간은 첫 브라우저 명령부터 마지막 증거 조회까지다. 브라우저 준비·정리와 최종 보고 작성은 제외한다. headless 시도가 실패해 전환한 시간은 포함한다. 차단으로 일찍 끝난 시행을 빠른 성공과 동일시하지 않는다.

## 비용과 출처

| 사이트 | CLI 대기 합(초) | CLI 원문 출력(KiB) | 실제 도구 전달 텍스트(KiB) | 에이전트 전체(초) | 실패 호출 | 프로젝트 스킬 확인 |
|---|---:|---:|---:|---:|---:|---|
| google | 49.4 | 5.5 | 52.6 | 87.9 | 4 | 확인 |
| amazon | 25.5 | 1908.3 | 123.7 | 122.7 | 4 | 확인 |
| walmart | 78.2 | 10.3 | 53.6 | 125.0 | 1 | 확인 |
| ebay | 40.4 | 36.9 | 111.0 | 113.7 | 2 | 확인 |
| bestbuy | 91.6 | 81.9 | 137.4 | 297.0 | 8 | 확인 |
| booking | 46.9 | 105.1 | 190.0 | 266.7 | 3 | 확인 |
| expedia | 28.3 | 0.7 | 24.4 | 44.5 | 0 | 확인 |
| wikipedia | 37.2 | 38.6 | 87.1 | 141.9 | 7 | 확인 |
| weather | 30.5 | 31.5 | 89.4 | 125.8 | 3 | 확인 |
| imdb | 36.7 | 18.3 | 90.2 | 88.1 | 0 | 확인 |

CLI 출력량은 생성된 stdout 전체다. 실제 도구 전달 텍스트는 세션에 남은 tool-output 텍스트 바이트 합으로 스킬/명령 참조 읽기도 포함한다. 도구 출력 잘림 때문에 둘은 다르다. 이미지·시스템 프롬프트·사용자 입력은 텍스트 합에 포함하지 않는다. 실제 토큰 사용량은 results-live.json의 제공된 tokenUsage만 사용하며 바이트를 토큰으로 추정하지 않는다. 명령 사이 시간을 순수 사고시간으로 부르지 않는다.

## 사이트별 과정 감사

### google

- Initial English name query on Korean-rendered Google returned no match despite requested en-US; role lookup succeeded.
- Agent wrote a malformed input goal then recovered via combobox role.
- Parallel reveal/snapshot invalidated the session; old session queried, session command malformed; second reveal returned sessions but agent stopped without reading.
- Action.effect.pageState=ready while following finding.pageState=blocked; consumers must distinguish observation times, success of submission from task success.

### amazon

- Search query initially scoped to open shopping alert returned zero; document scope succeeded.
- Malformed run task and goal payloads; CLI limit20 above goal cap12 produced opaque invalid_goal errors.
- Logitech checkbox query was zero because filter is a link. Broad name queries repeated before outline/content revealed Apply Logitech filter.
- Valid Apply and Remove filter controls proved brand application; observed product detail was then opened correctly.
- Final bounded content query provided actual price/shipping; no full body eval or site learning.
- Explicit snapshot --format json at010 generated1,900,170 raw stdout bytes; total raw output about1.95MB. Actual delivered tool text may be truncated, so raw output is not the same as LLM input.

### walmart

- Session open already switched headless to headed; agent did not use that fact and repeated browser reveal twice.
- Malformed task used actions instead of steps and top-level follow; opaque invalid_task then corrected from command reference.
- Final submit follow stayed tied to the closed autocomplete region (linked_region_not_ready) rather than search results; recovery alone did not identify block until next read.
- No sorting or product detail reached. CAPTCHA result is external access failure; repeated mode changes and goal schema mistakes are separate agent/interface costs.

### ebay

- Invalid task schema once then valid direct fill-submit.
- Risk classifier required per-action confirmation for a requested filter; agent used explicit confirm, no site exception.
- Buy It Now/New filter selection was followed by actual applied URL and removal controls.
- New tab session was used directly without opening unrelated tabs; seller query returned containing card plus separate links, requiring ownership interpretation.
- No full graph snapshot or body eval; 15 calls vs historical median24.

### bestbuy

- Observed country selection ref became stale; recovery contained country links; agent used semantic target next.
- Manual headed reveal was initiated after UI/ref trouble without confirmed access block; this deviates from access-restriction-only manual fallback policy.
- Search re-triggered country chooser; selecting country from actual UI then reached results.
- Brand checkbox and URL proved Logitech filter application.
- Repeated product-name/price/text searches and list/scroll calls did not yield actionable result cards. No screenshot fallback to determine whether content existed visually; one skip-link click was intercepted.
- Command032 screenshot inspected by root after completion: Logitech chip visibly selected, result count3648, but visible main result rows blank; not merely an inaccessible product label. No image viewing call observed in Luna trace, so screenshot path itself did not give Luna visual evidence.
- After empty results, multiple text queries/scrolls consumed remaining budget; observed viewport had no product cards. Distinguish unrendered site content from missing DOM extraction. Whole-page absence and exact rendering failure cause remain unproven.

### booking

- Initial multiword phrase query produced zero; help, scope switch and controls read added calls before filling destination.
- A sign-in popup interfered with first fill; dismissed before successful destination entry.
- Autocomplete was selected, calendar dates were clicked, but submission navigated to an undated city listing. Do not infer successful date application from clicks completing.
- Dates were re-entered and Search retried; dates again absent. Exact cause is unproven; requires generic form/transition evidence rather than a site exception.
- Repeated zero-match cancellation queries added calls without obtaining a new control scope;45-call limit reached.
- Hotel facts are from a one-night default listing. Agent correctly qualified that these do not answer requested two-night/free-cancellation pricing.

### expedia

- Initial home navigation triggered automatic headless-to-headed fallback with captcha evidence.
- Only one browser call. Agent treated fallback reason as final access state and stopped without a post-switch observation. This is incomplete fallback handling, not proof that headed failed.
- No search/date/filter/detail step completed; no bypass or learning attempted.

### wikipedia

- Two invalid_task and two invalid_follow requests preceded useful input. Full task/follow envelopes remain difficult for Luna despite reading project skill.
- Fill-submit008 detached during Enter, outcome_unknown and automatic headed fallback reason error. This is not evidence of an access restriction.
- After observation, another fill-submit011 had the same detach error; existing autocomplete was then selected successfully. No speculative ref replacement.
- Content searches Crew/landed/born answered the task without full-body eval. Exact guessed date phrases returned zero before broader content terms worked.
- Multiple NeilArmstrong candidates were shown; an explicitly observed link was selected and correct article verified.21calls versus historical median11.

### weather

- Location search required opening current-location control rather than assuming a visible search textbox; observed NewYork selection reached10Day directly.
- Old More ref returned stale_ref twice; a guessed role/name produced no_match; fresh find More then successful ref click recovered.
- Local More dialog effect immediately exposed Fahrenheit checked=true and Celsius false; no extra unit mutation was needed.
- Forecast read maintained row ordering and explicitly distinguished Tonight from first dated row Fri16, avoiding high/low/precipitation mixing.
- Agent omitted stale-ref/no-match failures from difficulties; root separately records3 failed calls.

### imdb

- Automatic headed fallback on initial home;agent correctly inspected returned session before continuing,unlike Google/Expedia.
- Home fill+submit succeeded in one action;exact combined title/year phrase returned zero before broader title query found observed1994film.
- Title facts and ordered TopCast were obtained with two small content searches;no fullbody eval or stored assets.
- Nine browser calls versus historical median17;no rejected browser calls. Correct outcome despite generic fallback cost.

## 한계와 프로토콜 이탈

- 모든 사이트는 독립 프로필과 headless 설정으로 시작을 요청했다. Weather는 페이지 접속 전 Chrome 시작 실패로 자동 headed 전환돼 최초 준비 상태부터 headed였다. Wikipedia도 접근 제한이 아닌 detached-element 오류에 자동 전환됐다. 이는 제한 시에만 전환하라는 조건의 예외/이탈이다. 사이트 간 headed 설정은 상속하지 않았다. generic headless_failure 자체는 접근 제한을 입증하지 않는다.
- Google 첫 시행에서 동시 wrapper 호출로 순번6/8이 중복돼 일부 원시 command 파일이 덮어써졌다. append-only 메타데이터에9호출/시간/바이트가 남아 있다. 이후 wrapper에 순차 잠금을 추가했다. Google을 재시행하거나 유리한 결과로 교체하지 않았다.
- Google과 Expedia는 headed 전환 후 새 화면을 관찰하지 않아 headed에서의 차단 지속 여부는 미확인이다. Walmart는 이미 headed인 상태에서 reveal을 반복했다. Best Buy의 수동 reveal은 접근 제한 확인 없이 시작됐고 root가 일반 프로토콜 준수 메시지1회를 보냈다. 사이트 해법·선택자·정답 개입은 없었다.
- Luna가 적은 어려움 목록과 실제 오류 로그가 달랐다. 점수와 과정은 root가 별도로 감사했다.
- 예전과 현재는 명령 묶음·관찰 구조가 다르므로 호출 수만으로 효율을 단정하지 않는다. 이번10개 동안 제품 코드는 수정하지 않았다.

원래 과업과 체크포인트: [scenarios.json](../us-web-2026-10-13/scenarios.json). 실행 규칙: [protocol.md](protocol.md). 정량 결과: [results-live.json](results-live.json). 동결: [versions.json](versions.json). 원시 페이지·프로필·세션은 .runtime/hb-retest-2026-10-16에 별도 보관한다.
