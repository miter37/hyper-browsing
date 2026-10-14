# 라이브 브라우징 트라이얼 — 교훈 세트 1 (2026-10-14)

목적: webctl로 실제 사이트를 operate하며 생긴 애로사항과, 사람이었다면 바로 했을 대안을 남긴다.
이 문서의 관찰은 `C:\Users\miter\.agents\skills\hyper-browsing`에 설치된 skill 기준이며, 이 레포 코드는 수정하지 않았다.

범위: 5개 사이트 × 1세트. (2~4세트는 같은 파일에 추가 예정)

| # | 사이트 | 시도한 것 | 결과 |
|---|---|---|---|
| 1 | news.ycombinator.com | 세션 open, dismiss-annoyances 0건, `--query` 스냅샷, 제목 클릭→외부 사이트 | 성공 (클릭 후 새 탭/이동 확인은 eval로만) |
| 2 | wikipedia.org → ko.wikipedia.org | dismiss 1건(오버레이 2개 제거), forms 1폼, `fill --label` + Enter→문서 이동 | 성공 |
| 3 | hn.algolia.com | forms(placeholder 입력), Enter → URL 쿼리 갱신, 결과 텍스트 추출 | 성공 |
| 4 | finance.naver.com → stock.naver.com | forms가 GNB 44체크박스를 잡음, `fill --placeholder "종목명"` → 자동완성 11건, 자동완성 링크 href 조합으로 종목 상세 진입 | 성공 ( forms는 무용, 우회 필요) |
| 5 | imdb.com/title/tt0111161 | dismiss 1건(닫기 버튼 클릭), headings 18개, 구조화 selector로 출연진 6명 | 부분 성공 (평점·줄거리 selector 미스) |

## 애로사항과 대안

**L01 — `wait-idle`이 데몬 RPC와 이름이 안 맞는다.** `{"ok":false,"error":"Unknown RPC method: page.waitIdle"}`. 문서에는 존재하는 명령으로 안내된다. 레포의 `UPGRADE-PLAN-dom-booster-lessons.md`가 이미 같은 결함을 적어뒀고, 설치본에도 살아 있다.
→ 사람이라면: 에러 문장을 보고 5초 만에 RPC 등록부(`page.waitForIdle` 추정)를 찾아 한 줄 고친다. 대신 이번엔 `goto` 응답의 `network:"settled"`와 `eval` 폴링으로 대체했다.

**L02 — `--format hwm`을 주어도 출력이 일반 JSON 스냅샷이다.** HN item 페이지에서 `--format hwm --mode overview --node-budget 40`을 두 번 실행했으나 반환은 `snapshot.elements` 배열(수백 개 `<a>`)이었고 `@page`/`@node` 레코드는 한 줄도 없었다. 즉 현재 설치본에서 HWM은 CLI 표면이 없다.
→ 사람이라면: 출력 바이트가 같은데 옵션만 무시되는 걸 보면 옵션 파싱 지점과 출력 projection 지점을 5분 안에 확인한다. 결과 판독은 어차피 eval/JSON이라 실무진은 안 막혔다.

**L03 — 성공한 명령도 exit code 42를 준다.** `identify`(known:false), `forms`가 그랬다. `&&`로 chaining하면 두 번째 명령이 실행되지 않아 한쪽 출력이 사라진다.
→ 사람이라면: exit code만 보고 재시도하지 않는다. 이번엔 명령을 `&`로 붙이거나 따로 실행했다. "성공인데 nonzero"는 문서에도 없고 가이드에도 없다.

**L04 — `--query`가 name 텍스트 전체와 매칭되어 빈 결과를 낸다.** IMDb에서 `--query "평점"`은 `elements: []` + `truncated: true`를 냈고 headings만 18개 남았다. 긴 name(뉴스 제목 문자열)이 많은 페이지에서는 query가 오히려 독이다.
→ 사람이라면: query가 빈 결과를 주면 query를 빼거나 한 단어씩 좁히기보다, 즉시 `eval`로 structured selector를 쓴다. `elements: []`와 `truncated: true`가 동시에 나오는 상태를 "매칭 실패"로 읽지 않게 표시하면 좋겠다.

**L05 — `forms`가 실제 검색 폼 대신 GNB 서비스 체크박스 44개를 잡아냈다.** stock.naver.com의 종목 검색(`placeholder="종목명·지수명 입력"`)은 React 합성 입력이라 implicit_form에 안 들어가고, 폼 판정에는 "읽은 알림 삭제" 버튼이 submitter로 올라왔다. 실제 검색은 `fill --placeholder "종목명"`으로 성공했다.
→ 사람이라면: 화면을 보는 순간 검색창은 위쪽이라고 안다. forms 출력이 페이지 상단 검색창을 빠뜨리면 placeholder 기준 fallback이라도 먼저 보여주면 좋겠다.

**L06 — SPA 페이지에서 `goto` 응답 title이 직전 페이지 것과 같고 h1이 비어 있다.** stock.naver.com 종목 상세로 `goto`한 직후 응답 title은 "Npay 증권"(이전 홈과 동일)이었고, 같은 eval의 h1도 ""였다. 실제 제목("삼성전자", headings)은 그 다음 snapshot에서야 나왔다.
→ 사람이라면: SPA는 load 완료가 곧 렌더 완료가 아님을 알므로 짧은 재확인 한 번을 넣는다. `network:"settled"`를 신뢰하고 바로 판독하면 "제목 없는 페이지"로 오판한다.

**L07 — `list --session ID`는 `Unknown command`다.** 세션은 `session list`, 탭은 `tab list`.
→ 사람이라면: help 또는 `session list`를 먼저 친다.

**L08 — learning siteId가 호스트 표기로 갈라진다.** wikipedia.org는 `wikipedia`(접두 제거), ko.wikipedia.org는 `ko_wikipedia_org`, stock.naver.com은 `stock_naver_com`로 생성됐다. 같은 사이트의 하위 호스트가 서로 다른 자산 트리를 갖는다.
→ 사람이라면: register 도메인 기준으로 정규화한다. fill/press 후 뜨는 "Reusable discovery is still unencoded"는 이 라운드에선 항상 떴고, 자산화 여부를 판단할 단서가 약했다.

**L09 — exit code와 별개로 stdout가 `more`에 걸려 멈춘다.** 스냅샷 출력을 파일로 redirect해 `type | more +0`으로 보니 페이저가 계속 떠서 120초 타임아웃이 났다.
→ 사람이라면: 출력이 클 걸 알면 `--limit`를 주거나 eval로 필요한 필드만 뽑는다.

## 교훈

- 관찰 판독은 `snapshot`의 elements 배열보다 `eval`(구조화 selector)이 가장 빠르고 정확하다. HWM은 현재 CLI에서 관측되지 않으므로 판독 전략의 기본값이 될 수 없다.
- SPA 라우팅 사이트(네이버 증권)는 `goto` 직후 응답만 믿지 말고 한 번 더 관찰해야 한다.
- 성공/실패 판정에는 exit code가 쓸모가 없다. 항상 응답 JSON의 필드(`ok`, `url`, `title`, `elements`)로 판단한다.
- 폼·입력 수동 탐색은 대체로 실패하고 `--placeholder` 직접 fill이 성공했다. forms는 참고 자료일 뿐이다.

---

# 세트 2 (2026-10-14)

| # | 사이트 | 시도한 것 | 결과 |
|---|---|---|---|
| 6 | news.ycombinator.com/form | session open→`title:""`, snapshot elements 0개, eval body `"Unknown."` | 페이지 자체가 빈 응답 (HN 존재하지 않는 경로) |
| 7 | musicbrainz.org/release/<UUID> | open→"Release not found", headings 1개, nav 링크 다수 | 404 페이지를 성공적으로 판독 |
| 8 | ecosia.org (URL 검색) | open→`__cf_chl_tk` 쿼리가 붙은 URL, 실제 결과는 렌더됨. dismiss 1건(Accept 클릭), 결과 목록에서 위키 링크 클릭→ko.wikipedia 이동 | 성공 (Cloudflare 자동 통과, 한글 쿼리 1자 변형) |
| 9 | ko.wikipedia.org (Ecosia 결과 클릭 유입) | click 시 `url`은 이동했는데 eval title이 "" | 재관찰 필요 |
| 10 | duckduckgo.com | `fill --placeholder "Search"` 30초 타임아웃 → eval로 input 목록 → `textarea[name=q]` 발견 → `fill --css`+press Enter로 검색 성공, 결과는 h2로만 추출 | 성공 (우회 2회) |

## 애로사항과 대안 (세트 2)

**L10 — URL로 넘긴 한글 검색어가 1자 변형됐다.** Ecosia에 `%EA%B4%91%EB%8C%84%EC%97%AD`로 `광대역`을 넘겼는데 페이지 title은 "광댄역 인터넷 - Ecosia"였다. 결과 자체는 정상이라 실해로 이어지진 않았다.
→ 사람이라면: 인코딩 자체는 바로 맞춘다. `open --url`이 query를 재인코딩하는 지점을 확인한다. 실무는 결과 목록을 보고 이상하면 query만 고쳐 재실행한다.

**L11 — `session open` 결과가 가짜 URL을 보일 수 있다.** Ecosia open 응답의 url이 `...&__cf_chl_tk=9WfVr...` (Cloudflare challenge 토큰)였다. 실제 페이지는 정상 렌더였다.
→ 사람이라면: URL만 보지 않고 `eval`로 `location.href`와 body를 확인한다. 자동 통과되는 challenge 토큰을 "차단"으로 오독하지 않으면 된다.

**L12 — 검색창의 placeholder가 언어별로 다르거나 없다.** DuckDuckGo 한국어에서 placeholder는 "개인 정보 노출 없이 검색"이었고, 영어 "Search"를 준 `fill --placeholder`는 30초를 다 채우고 타임아웃했다. 실제 입력창은 `textarea[name=q]`였다.
→ 사람이라면: 30초를 기다리지 않는다. input 목록을 한 줄의 eval로 뽑으면 3초면 끝난다. `fill` 실패 메시지에 후보 input 목록을 넣어주면探索가 한 번 줄어든다.

**L13 — 30초 기본 타임아웃이 그대로 노출된다.** 같은 실패가 30초×N회로 누적되어 1세트에 버리는 시간이 크다. 스킬 문서의 "fail fast 3~5초" 원칙이 CLI fill 경로엔 안 적용돼 있다.
→ 사람이라면: `timeout` 옵션을 주거나 즉시 eval로 전환한다. 기본값을 5초로 줄이면 같은 실패를 6배 빠르게 인식한다.

**L14 — 페이지가 비어 있어도 "빈 관찰"이라는 신호가 약하다.** HN /form은 snapshot 기준 `elements: []`, `headings: []`, `title: ""`이 전부였다. body에 "Unknown."이라는 1단어가 있다는 건 eval로만 알 수 있었다. `truncated: false`까지 나와 "완전한 빈 페이지"로 보인다.
→ 사람이라면: 빈 스냅샷이면 body 텍스트 한 줄을 먼저 읽는다. snapshot이 elements가 0개일 때 bodyTextLength를 함께 주는 게 자연스럽다.

**L15 — 이동 후 title이 빈 문자열로 반환된다 (SPA가 아님).** click으로 Ecosia→Wikipedia로 이동했는데 같은 응답 이후 eval의 title이 ""였다. URL은 정확히 이동한 상태였다.
→ 사람이라면: 이 사이트는 loading이 title보다 늦다는 것을 화면으로 안다. 재관찰 한 번이면 해결된다.

**L16 — 결과 목록을 잡는 selector가 사이트마다 전부 다르다.** Ecosia(a 태그 name에 URL+제목 2중 노출), DuckDuckGo(article selector 실패, h2 성공)에서 재사용 가능한 selector가 없었다.
→ 사람이라면: 결과를 "링크 제목+목적지"로 정규화하는 `api-sniff` 또는 extract 템플릿을 먼저 쓴다. 사이트마다 eval selector를 짜는 건 사람도 같은 노동이다.

## 교훈 (세트 2)

- 검색창 탐색은 `forms`/`placeholder`보다 input 목록 eval이 가장 빠르다 (DuckDuckGo 30초 실패 → eval 1회 성공).
- 404·빈 페이지도 "관찰 실패"가 아니라 유효한 관찰로 읽어야 한다. 현재 출력은 이를 구별해주지 않는다.
- 실패 타임아웃이 기본 30초인 명령(fill/click)이 가장 큰 시간 낭비 지점이다.

---

# 세트 3 (2026-10-14)

| # | 사이트 | 시도한 것 | 결과 |
|---|---|---|---|
| 11 | en.wikipedia.org 특수:RecentChanges (URL 인코딩) | dismiss 1건, `--query "diff"`→elements 0개, eval로 body+폼 확인 | 페이지는 정상, 특수 페이지의 항목이 snapshot elements에 안 잡힘 |
| 12 | stockanalysis.com/stocks/ | eval로 테이블 501행 헤더 4열 + 행 4개 즉시 추출 | 성공 (테이블 관찰은 eval이 가장 빠름) |
| 13 | weather.gov | forms가 폼 3개를 정확히 분석, fill(`#inputstring`)+click(`#btnSearch`)→이동 없음 → URL 템플릿으로 `goto` 성공(날씨 좌표 변환), 결과 selector는 미스 | 부분 성공 |
| 14 | old.reddit.com | open→로그인 리다이렉트(reason=lor2), 다른 공개 경로 goto→역시 로그인 벽 | 스킬 원칙대로 우회 중지 |
| 15 | hltv.org/matches | eval `.match-row`/`a.match` 0건 → snapshot에서 live.match-row 링크 10+개 확인 | eval selector 실패 / snapshot 성공 |

## 애로사항과 대안 (세트 3)

**L17 — submit 버튼 클릭이 이번엔 이동을 만들지 않았다.** weather.gov는 폼 action이 명시적인 GET(`forecast.weather.gov/zipcity.php`)인데 `click --css "#btnSearch"` 후에도 URL이 `www.weather.gov/`에 그대로 있었다. input의 value는 정상으로 세팅돼 있었고, 같은 요청을 URL 템플릿(`zipcity.php?inputstring=New+York,%20NY`)로 `goto`해 성공했다.
→ 사람이라면: forms 출력이 이미 action URL을 줬으므로 화면 클릭보다 그 URL에 값을 붙인다. 폼의 action이 GET이면 "폼 제출 = URL 조합"이라 보는 게 사람 사고다. 클릭이 성공(true)인데 URL이 안 움직인 경우에만 재시도한다.

**L18 — 사이트마다 DOM이 다르지만 snapshot은 항상 쓸만하고 eval은 자주 미스다.** HLTV는 `a.match` selector가 0건이었고 snapshot은 LIVE 경기를 잡았다. Wikipedia RecentChanges는 `--query "diff"`가 0건이었다(실제 diff 링크는 thousands but name 텍스트에 "diff"가 없음).
→ 사람이라면: eval selector를 처음부터 맞추려 하지 않는다. snapshot을 먼저 보고 실제 name/text를 확인한 뒤 eval을 쓴다. "selector 0건"과 "페이지에 없음"을 즉시 구별하려면 eval에도 매칭 실패 문구가 필요하다.

**L19 — 로그인 벽은 정직하게 표시된다.** old.reddit.com이 `reason=lor2`로 로그인 페이지로 리다이렉트했고 body에 "이전 Reddit 웹사이트를 이용하려면 로그인하세요"가 그대로 있었다. 스킬 원칙(우회 금지)을 지키면 끝이었다.
→ 사람이라면: 브라우저 reveal 후 로그인 요청. 다만 로그인 상태가 아닌 headless 환경에서 old.reddit는 콘텐츠 접근성 테스트용으로도 막혀 있으니 대안 사이트가 필요하다.

**L20 — 좌표를 만드는 검색 폼은 URL 템플릿이 더 정확하다.** weather.gov의 `zipcity.php`는 "New York, NY"를 받아 최종적으로 `MapClick.php?...textField1=40.7198&textField2=-73.993`으로 리다이렉트했다. `network:"busy"` 상태에서 즉시 eval한 결과는 h1(title)만 보이고 본문 bold만 잡혔다.
→ 사람이라면: 리다이렉트 체인이 긴 페이지는 한 번 더 관찰한다. `network:"busy"`를 반환할 때 "busy"라는 문자 그대로보다, 결과 h1/title이 이미 "7-Day Forecast 40.71N 73.98W"로 들어왔으므로 상태보다 제목이 더 빠른 신호였다.

## 교훈 (세트 3)

- GET 폼은 forms 출력이 준 action URL로 직접 `goto`하는 편이 클릭·제출보다 빠르고 검증하기 쉽다.
- eval(selector) 실패는 흔하다. snapshot → 실제 텍스트 확인 → eval 순서가 기본 흐름이 되어야 한다.
- 로그인 벽·리다이렉트 루프는 강제 우회 대신 상태를 확인하고 다음로 넘어가는 게 총 시간을 아낀다.

---

# 세트 4 (2026-10-14)

| # | 사이트 | 시도한 것 | 결과 |
|---|---|---|---|
| 16 | coinbase.com/explore | eval로 가격 테이블 11행 즉시 추출(₩ 통화), `api-sniff` 0건 | 성공 / sniff 미검출 (exit 42) |
| 17 | godaddysites.com | open→"404 Not Found" 제목 | 404를 제목으로 판독 |
| 18 | worldtimebuddy.com | dismiss 1건, forms 1개, `fill #location` "Seoul"→자동완성 미발생, URL 템플릿 `goto`→"Unable to Complete Request" | 부분 실패 2회 |
| 19 | pubchem.ncbi.nlm.nih.gov | dismiss 0건, forms 1개(label 일치), `fill --label`+Enter→`#query=caffeine` SPA 이동, 결과 링크 3개 | 성공 (모범 사례) |
| 20 | gbif.org/species/2439824 | open→`__cf_chl_tk` challenge title "Loading https://..." → eval 시 `/taxon/6JW2` 최종 도달 + h1 "Pectinator Blyth, 1856" | 성공 (자동 통과) |

## 애로사항과 대안 (세트 4)

**L21 — 자동완성 위젯은 fill 이후 DOM에 바로 나타나지 않는다.** worldtimebuddy `#location`에 "Seoul"을 넣은 직후 eval한 `.ui-menu-item`/`[class*=suggest] li`는 0건이었다. (autocomplete이 XHR 왕복 + 렌더를 거치므로 "fill과 동시"에는 없다.)
→ 사람이라면: 키 입력을 몇 번 나누어 주거나 300ms 정도의 변화 대입을 인정한다. 이 앱 자체도 fill을 `type`처럼 처리하지는 않는다. 사람이면 마우스로 몇 글자 타이핑하면서 기다리는 걸음과 같다. `fill --type`류 옵션이나 "fill 후 결과 등장까지 대기"가 있으면 한 단계 줄어든다.

**L22 — 실패 상태를 알려주는 페이지가 404만은 아니다.** 세계시간버디의 URL 템플릿 요청은 제목이 "Unable to Complete Request"인 서버 처리 거부 페이지였다. 404와 마찬가지로 body를 읽기 전까지는 "페이지가 없는지/처리 실패인지를" CLI는 알려주지 않는다.
→ 사람이라면: body 첫 문장을 본다. 상태 페이지도 결국 관찰 데이터이므로 지금 설계(제목·본문 노출)는 차악이고, `blocked`류 상태와 서버 처리 실패를 구분할 신호가 하나 있으면 좋겠다.

**L23 — `api-sniff`가 성공 응답인데 JSON API가 0건이다.** coinbase explore에서 테이블은 잘 뽑혔는데 sniff는 `count: 0`에 exit 42였다. SSR(서버 렌더)이라 브라우저가 JSON API 왕복을 안 한 결과로 보는 게 맞다.
→ 사람이라면: 0건을 "실패"로 보지 않고 "이 페이지는 API가 없다"로 읽는다. `truncated`처럼 "0 vs 검사 실패"를 표시하는 신호가 출력에 필요하다. (L04/L08과 같은 계열.)

**L24 — challenge 페이지의 제목은 "Loading https://…"다.** gbif에서 `session open` 반환 title이 `Loading https://www.gbif.org/species/2439824`였다. 실제 eval 시점에는 `/taxon/6JW2`로 최종 도달했고 h1 속명까지 정상이었다.
→ 사람이라면: "Loading" 제목과 "차단"을 구분한다. 2~3초 재관찰하면 되고 challenge 토큰 URL(Ecosia L11)처럼 자동 통과 계열로 취급하면 된다. 다만 `session open` 결과만 본 상태에서 "로딩 중"을 "실패"로 읽으면 이상한 갈림길에 선다.

**L25 — 모범 사례가 하나 나왔다.** PubChem은 dismiss 0건, `forms` 1개가 label까지 정확히 일치, `fill --label "Search PubChem"`+press Enter로 URL hash가 `#query=caffeine`으로 바뀌고 결과 링크(`a[href*="/compound/"]`)가 바로 잡혔다. 우회도 타임아웃도 0회였다.
→ 사람이 한 것과 같은 경로다: 화면 보고 → label 찾음 → 입력 → Enter → 결과 확인. 앱이 이상적인 상태(네이티브 form, 명시 label, SPA hash 라우팅)면 도구가 그대로 작동한다는 기준 사례로 남긴다.

## 교훈 (세트 4)

- SSR 페이지(coinbase)는 eval 테이블 추출이 최선이고 `api-sniff`는 참고용이다.
- "실패한 것처럼 보이는 성공"(autocomplete 미발생, 상태 페이지, sniff 0건)을 구분하는 신호가 현재 출력에는 부족하다.
- PubChem 패턴은 학습 자산화 후보로서의 기준이 된다: 폼이 명시고 label이 정확하며 Enter 라우팅인 사이트.

---

# 전체 종합 (1~20회 공통)

## 시간 낭비의 실제 정체

| 패턴 | 원인 | 사람 속도 | 도구 동작 |
|---|---|---|---|
| 실패 인식 | 기본 30초 타임아웃(fill/click) | 3~5초 | 30초×시도 횟수 |
| 입력창 탐색 | forms/placeholder가 실제 입력창을 놓침 | 화면 한 번 보면 끝 | eval 1~2회(성공) 또는 30초 실패(placeholder) |
| 결과 selector | 사이트마다 구조가 다름 | 역시 매번 새 selector | eval 미스 시 snapshot으로 재확인 |
| 상태 오판 | exit 42, 빈 관찰, "Loading"/"Unable" 제목 | body 한 줄로 판단 | 추가 관찰 1~2회 |

## 앱을 위한 제안 (수정 지시 아님 — 야간 작업의 재료)

1. **타임아웃을 실패가 아니라 정보로**: `--timeout-ms`를 fill/click에도 노출하고, 기본값을 5초대로. `Unknown RPC`류 오류처럼 "무엇을 시도했고 무엇이 안 됐는지"를 응답에 남긴다.
2. **입력창 대안을 fill 실패 응답에**: 매칭 실패 시 후보 input 5개(name/placeholder/visible)를 같이 주면 agent의 eval 한 번을 아낀다.
3. **관찰 상태 신호**: `title`/`body`가 404·서버 거부·challenge·빈 페이지임을 나타내는 짧은 상태 필드(예: `pageStatus: ok|not_found|server_error|challenge|empty`). 지금도 판단은 되지만 매번 body를 읽는 노동이 있다.
4. **GET 폼은 action URL을 1급으로**: forms 출력이 준 action+params로 `build-url`류 액션을 만들면 weather.gov식 제출 실패를 피한다.
5. **`--format hwm`을 실제로 작동하게 하거나 옵션을 제거**: 현행은 옵션을 줘도 JSON이 나온다. 현재로선 agent가 HWM을 해석할 기회가 없다.
6. **`wait-idle` RPC 이름 수정**: 이미 알려진 단일 결함이고(L01), 이동 대기 루프의 기본 도구다.
7. **성공 exit code 통일**: 42를 고집하지 말고 0으로(성공), 실패와 구분 가능하게. `&&` 체이닝이 안 깨진다.

## 잘 작동한 것

- `eval` 중심 관찰: 테이블(stockanalysis 501행), 카드(stock.naver 자동완성), 리스트(hltv), 표 데이터 등 모든 구조 추출의 기본값으로 신뢰 가능.
- `--label`/`placeholder`/`--css` 직접 fill: forms가 놓친 입력창을locator로 직접 지정하면 대부분 한 번에 성공.
- dismiss-annoyances: 쿠키 배너·오버레이가 클릭을 막는 상황을 대부분 미리 제거.
- 로그인/CAPTCHA 원칙: old.reddit처럼 벽이면 정직하게 멈추는 동작은 합리적.
