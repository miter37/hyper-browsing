# 라이브 테스트 교훈 누적 문서

목적: 실제 사이트에서 겪은 애로사항과 교훈을 하나에 누적한다. 모든 커밋에 포함한다.
원칙: 사이트별 맞춤 수정을 하지 않고, LLM에게 웹 내용을 더 잘 전달하는 일반적 스킬/스크립트 보완으로 환원한다.

## 누적 교훈

### HWM 0.2 라이브 확인 (2026-10-14)
- 레포 버전 `bin/webctl.cmd snapshot --format hwm --mode overview`는 `@hwm`, `@gap`, `@end`를 실제 출력한다. 기존에 설치본에서 보이던 `--format hwm` 무시는 feat/hwm-0.2에서 해결됐다.
- `view`와 `expand`도 같은 관찰 ID와 gap `expand` 핸들을 사용해 저장된 관찰을 상세 조회한다. 이는 HWM의 "없음/생략됨/펼칠 수 있음" 구분과 정확히 맞는다.
- `session open`이 `status`, `setupStatus`, `pageState`, `durationMs`, `requestId`를 반환하도록 개선됐다. 예전처럼 title만 보고 상태를 오판할 위험이 줄었다.
- Wikipedia overview에서는 folded gap이 다수 나왔고, 한 gap의 expand가 99개 노드의 repeated-shape을 드러냈다. 사이트마다 selector를 짜지 않아도 반복 구조를 일반 규칙으로 축약하는 방향이 유효하다.

## 다음 라운드 체크리스트
- HWM 출력의 크기가 너무 크면 node/text budget과 expand를 조합해 단계적으로 읽는다.
- 상태 페이지·로그인·challenge는 HWM의 gap/pageState 신호로 먼저 분류하고, body 일부만 읽는다.
- 각 액션의 effect는 클릭 true가 아니라 `@change`와 재관찰로 검증한다.
- 새 교훈은 이 문서에 번호를 매기지 않고 사이트/날짜 섹션으로 추가한다.

## 세트 1 (2026-10-15)

- Wikipedia에서 HWM overview는 동작했지만, eval을 첫 paragraph selector로 좁혔더니 내부 링크가 1개처럼 나왔다. 실제로는 HWM이 더 많은 링크를 접어 두고 있었으므로, "HWM gap"과 "eval 0개"를 같은 의미로 읽으면 안 된다. eval은 어떤 scope를 조회했는지 결과를 명확히 표시할 필요가 있다.
- Amazon best sellers에서는 name 기반 링크가 배지("Amazon's Choice")에 매칭되어 클릭 후 URL이 그대로였다. 클릭 자체가 아니라 효과와 URL 이동을 재확인해야 하며, HWM의 `@change`가 다수 `unchanged`인 것이 핵심 신호였다.
- IMDb는 250개 행을 하나의 repeated-shape gap으로 접었다. expand가 기본 6000노드로 열려 1,576노드 출력이 한 번에 나온 뒤 페이저에서 멈췄다. large gap은 반드시 `--node-budget`로 제한해야 한다.
- Booking은 challenge URL과 `pageState.evidence:"missing document"`로 시작했지만 이후 자동 통과되어 폼과 검색 결과를 제공했다. challenge와 서버 실패를 title 한 줄로 단정하면 안 된다.
- Booking 검색에서 Enter는 autocomplete만 닫고 destination input value가 `""`로 남았다. HWM `@change`가 value가 비어 있음을 정확히 보여줬고, 폼 action URL로 destination을 조합해야 이동이 완성됐다.
- Airbnb는 126개 링크가 있었지만 `--role link --name "5.0"`는 평점 배지에 매칭되어 exit 1로 끝났다. 결과 카드의 목적지 링크를 name 텍스트로 잡는 방식은 카드 구조에서 특히 위험하다.
- Google Finance는 `data-testid` selector가 0개였지만 snapshot의 heading과 status로 페이지 상태를 확인할 수 있었다. 사이트 전용 selector가 없다는 사실과 페이지 내용이 없다는 사실은 다르다.
- Trip.com은 정상 200 페이지이면서 "0 properties found"를 h1에 두었다. 빈 검색 결과도 실패가 아니라 데이터이며, 상태 페이지와 빈 결과를 구분해야 한다.
- Metacritic은 redirect로 `/browse/games/`가 `/browse/game/`가 됐다. URL redirect도 HWM의 document/url 변화로 추적해야 하며, 요청 URL만 신뢰하면 안 된다.
- BoardGameGeek는 페이지네이션 "Next »" 클릭이 page 2로 이동했다. text locator는 잘 동작했지만 첫 항목의 title을 잡는 selector가 페이지네이션과 섞여 재사용하기 어려웠다.

### 1세트에서 적용한 일반 보완
- `close --session ID`를 `session close`와 같은 의미의 별칭으로 지원한다.
- `expand --node-budget/--text-budget`이 projection까지 전달되게 해 대형 gap을 통제된 크기로 연다.
- HWM command-result header의 `result-only-observation`을 `transient-command-result`로 바꿔, 보존 관찰이 아니라는 의미를 명확히 한다.
- CLI 도움말에 실제 지원되는 close 별칭을 표시한다.

## 세트 2 (2026-10-15)

- Wikipedia 내부 링크 관찰에서 `#mw-content-text a[href^="/wiki/"]`를 첫 문단에서만 센 eval 결과가 "1개"로 나왔다. HWM overview가 보여준 링크 후보와 관점 자체가 다르므로 eval의 스코프를 명시하지 않으면 "링크가 1개뿐"이라고 오해하기 쉽다. eval 응답도 어떤 selector를 몇 번째 노드까지 스캔했는지 보여주는 편이 좋다.
- TMDB 정렬 dropdown은 `forms`가 `select-one`과 options 텍스트, `selectedText`까지 정확히 드러냈지만, 실제 select action은 `#sort_by` value를 바꾸지 못했다. 원인은 `hidden=true`인 native select와 `role=combobox`인 custom control이 분리돼 있기 때문이다. 폼 관찰과 조작 대상을 구분해 보여주면 agent가 custom control을 먼저 찾는 실수를 줄일 수 있다.
- TMDB의 custom combobox는 value에 모든 옵션 텍스트를 공백 없이 이어 붙여 노출했다. combobox처럼 접힌 control의 value는 "현재 선택값"이 아니라 "버블링된 옵션 전체"일 수 있다는 신호를 주는 편이 안전하다.
- Al Jazeera 경제 페이지에서 `eval`로 `a[href*="/en/"]`를 세면 2개였고, HWM overview는 같은 문서의 링크를 다수 접어 두고 있었다. eval 결과의 숫자와 HWM의 "링크 후보"는 스코프가 다르다. 현재 eval 응답은 `@result`의 `value`만 주고 어떤 selector로 몇 노드를 스캔했는지 표시하지 않아 "링크가 2개뿐"으로 오독되기 쉽다.
- Straits Times `/world/asia`가 `/global`로 redirect됐다. `session open`과 `@hwm` header의 `url`은 최종 URL을 반영하고, 카드 링크의 href가 `.../asia/<redacted-long-token>?ref=visual-stories`처럼 마스킹돼 있어 `destination-identity="redacted"` 표시 자체가 "대체 URL로 이동한다"는 신호였다. redirect 추적은 잘 작동했다.
- Straits Times carousel(`div.slick-track`)의 `list`는 13개 중 8개만 노출했고, `@change`는 클릭 후에도 대부분 `unchanged`였다. `@change`가 무수히 `unchanged`인 것 자체가 "클릭이 페이지를 바꾸지 않았다"는 유효한 신호지만, change 목록이 커서 핵심 신호(URL 변화)가 묻히는 문제가 있다.
- Hacker News `list`는 rows를 잘 잡았지만 `title`이 "otobrglez" 같은 user 필드에 매칭됐다. 제목 링크가 `span.titleline > a`에 있는데 list의 `field="title"`이 다른 노드를 골랐다. repeated-list의 "title"이 카드마다 다른 규칙으로 결정되는 문제다.
- Hacker News의 single-key shortcut(`press` `n`)은 키 입력 자체가 통하지 않아 URL이 그대로였다. `@change`가 전부 `unchanged`인 것이 유효한 신호였고, eval `location.href`로 최종 확인했다.
- Hacker News `batch`는 `page.extract`/`page.evaluate`를 받지 못했다. schema가 `op: fill|select`만 허용하기 때문이다. 오류 메시지는 zod JSON이라 `--input-file` 없이 shell에 JSON을 넘기면 따옴표가 깨져 해석 실패가 겹친다.
- Fandom은 404 페이지가 `pageState.state:"ready"`이면서 `status:404`, title "This wiki does not exist"를 반환했다. HWM h1과 heading outline이 그 내용을 정확히 드러냈다. 상태 페이지 관측은 잘 작동한다.
- Wikipedia `Special:Export`의 XML은 HWM graph가 `tag="mediawiki"`, `tag="siteinfo"` 등 실제 XML 요소이름을 노출했다. `scan.complete:true`까지 나오며 `xmlns`까지 추적 가능했다. XML 문서도 HWM이 구조적으로 전달한다.

### 2세트에서 적용한 일반 보완
- `page.evaluate` 응답이 `{value, scope:'eval-expression', expression, url}`이 됐다. eval 숫자는 "그 expression이 스코프한 범위"의 값임을 응답이 스스로표시해, HWM의 접힌 링크 후보와 eval 카운트를 같은 의미로 오독하는 것을 막는다.
- change-budget로 잘려 나가는 diff에서 url/title이 바뀐 `@change`를 앞으로 끌어올렸다. unchanged 수백 줄에 결정적인 URL/title 변화 신호가 묻히지 않도록, budget truncation 전에 signal change를 앞에 배치한다. hidden gap의 range는 감춰진 change가 실제로 있을 때만 emit한다.

## 세트 3 (2026-10-15)

- rg.gov는 DNS 해석 실패로 `page.goto: net::ERR_NAME_NOT_RESOLVED`가 `session open`의 `navigationError`로 반환됐다. `title:""`, `setupStatus:"ready"`와 함께 navigationError가 뜨니 "빈 페이지"가 아니라 "접근 실패"임이 구별됐다. DNS/네트워크 실패가 title만으로는 상태 페이지와 헷갈릴 수 있는데, navigationError 필드가 그 차이를 명시했다.
- timeanddate.com overview에서 `@gap reason="frame-not-scanned"`가 처음 나왔다. 기존 `not-rendered`(렌더 안 됨)와 달리 "iframe 자체를 스캔 대상에서 뺐다"는 별개의 원인 표식이다. HWM이 gap reason으로 원인을 세분화해 "왜 안 보이는지"를 구분해 주는 좋은 사례. 이미 observation.ts의 일반 규칙이라 사이트 분기가 아니다.
- weather.gov와 allrecipes.com overview는 각각 510노드/926노드 gap을 하나의 repeated-shape로 접었다. expand 없이 overview와 budget만으로도 페이지 골격(heading outline, 주요 링크)을 파악할 수 있었고, 대형 gap은 `--node-budget`로 단계적으로 열어야 함이 다시 확인됐다.

### 3세트에서 적용한 일반 보완
- `page.evaluate`의 응답이 `{value, scope:'eval-expression', expression, url}`이 됐다. 라이브에서 HN 항목 링크 60개를 셨을 때 `scope="eval-expression"`과 expression 전문이 노출돼, "60개"가 그 expression의 스코프임을 응답이 스스로 말한다.
- `batch`가 `op:"extract"`(`read`/`all`/`limit`/`attribute`)를 받도록 했다. fill/select와 섞어 쓸 수 있게 됐고, `all:true`는 `webctl extract --all`과 같은 규칙(가시성 있는 매치를 페이지 순서로 전부 읽음)으로 ambiguity 오탐 없이 목록을 읽는다. 라이브에서 제목 3개 추출이 `execution:"completed"`로 확인됐다.

## 세트 4 (2026-10-15, 10 사이트: github/rtings/sciencedaily/everydayhealth/skysports/cricbuzz/bbcgoodfood/khanacademy/indeed/rottentomatoes)

- `session open --session s4a`로 열었으나 이은 `snapshot --session s4a`는 `Unknown session: s4a`였다. 세션 key는 daemon이 응답 `id`로 부여하는 값이고, 요청 시 넘긴 이름은 쓰이지 않는다. `session list`가 실제 key를 보여주므로, 첫 호출의 응답 id를 이후 호출에서 재사용하는 규칙이 필요하다.
- rottentomatoes overview에는 `@gap reason="not-rendered"`가 75개, khanacademy 20개, bbcgoodfood 28개, indeed 18개였다. lazy-load 페이지에서 화면 밖 콘텐츠가 "없음"이 아니라 "아직 렌더 안 됨"으로 individual 표기됐다. gap이 많아도 HWM은 그 개수와 위치를 그대로 정보로 전달하고 있었다.
- `--node-budget 20`을 요청해도 `projection-budget`의 `shown`이 25~32로 나왔다. `closureMayExceed:true`가 함께 표시돼 "요청보다 많이 보이는 이유"가 응답 안에서 설명됐다. 노드 예산은 hard cap이 아니라 closure(부모-자식 완성)에 따라 늘어나는 유도값이다.
- `eval`은 `--expression`이 아니라 `--expr`을 요구한다(`Missing --expr`로 파라미터 이름을 알려준다). `--expr "1+1"`은 `value=2`와 `scope="eval-expression"`, expression 전문을 함께 반환해, 그 숫자가 페이지 값이 아니라 expression이 스코프한 결과임을 응답이 스스로 말했다(3세트 보완의 라이브 재확인).
- `snapshot --mode focus`를 `--focus REF` 없이 단독 호출하면 출력이 비었다. focus는 overview에서 본 노드 id를 시드로 요구한다. 도구가 조용히 빈 출력을 낸 점 자체가 관찰 대상이었다.

### 4세트에서 적용한 일반 보완
- CLI 도움말에 빠져 있던 `eval --expr`, `scroll`, `wait-for` usage를 추가했다. 4세트에서 `--expression`이라 잘못 추정해 헤맨 것이 help 문서의 일반 결함이었고, `eval` 결과는 페이지 그래프가 아니라 expression의 스코프라는 주석까지 함께 표기했다(사이트 무관한 문서 보완).
- session key(응답 id 사용), large not-rendered, budget 초과 표시(`closureMayExceed`), focus의 `--focus` 요구는 기존 일반 규칙이 이미 정확히 전달하고 있음을 라이브로 재확인했고, 코드 보완은 불요했다.

## 세트 5 (2026-10-15, 10 사이트: nytimes/guardian/reuters/bloomberg/cnbc/ft/wired/techcrunch/theverge/arstechnica)

- 뉴스 10개 사이트 overview에서 `not-rendered` gap이 NYT 138개, Bloomberg 111개, FT 104개, TechCrunch 86개 등으로 나왔다. lazy-load 뉴스 페이지에서 화면 밖 전체가 individual gap으로 표기되는 것이 정상이 됐다. gap이 수십~백 단위여도 HWM은 "어디가 안 렌더됐는지"를 위치와 함께 유지했다.
- `frame-not-scanned`가 8개 사이트(Reuters 2, Bloomberg 5, CNBC 3, Wired 2, TechCrunch 3, Verge 4, Ars 2 등)에서 나왔다. 광고/임베드 iframe이 스캔 제외되는 일반 규칙이 뉴스 도메인에서도 동일하게 작동했다(사이트 분기 없음).
- Guardian에서 `reason="budget"` gap이 73개로 이질적으로 많았다. 다른 뉴스 사이트(7~24개)와 비교해 특히 많았는데, dense한 카드 markup에서 노드 예산이 먼저 소진된 것이다. gap의 reason 분포 자체가 페이지 구조 신호로 읽혔다.
- Bloomberg(`/asia`), CNBC(`/world/?region=world`)는 geo redirect로 최종 URL이 달라졌고, header의 `url`과 title(Bloomberg Asia)이 최종 상태를 정확히 반영했다. redirect 추적은 세트 2에 이어 재확인됐다.
- Ars Technica는 header의 `ready-state`가 10개 중 유일하게 `interactive`였다(나머지 complete). 같은 `pageState.state:"ready"`라도 스냅샷 시점의 ready 단계 완결도가 다를 수 있음을 header가 구별해 줬다.
- DuckDuckGo lite 테스트에서 `session open`이 `status:202`이면서 `blocked:{kind:"bot-challenge", evidence:"cloudflare challenge markers", hint:...}`와 `pageState.state:"blocked"`를 반환했다. 202가 "통과"가 아니라 챌린지 상태임을 응답이 스스로 말했다.

### 5세트에서 적용한 일반 보완
- CLI 도움말의 `batch` 줄에 `# fill / select / extract in one round trip` 주석을 추가했다. 3세트에서 extract를 지원하는 것으로 넓혔는데 help에는 여전히 명령 종류가 없어, 새 사용자는 batch로 목록 읽기를 할 수 있는지 알 수 없었다(사이트 무관한 문서 보완, 라이브로 반영 확인).

## 세트 6 (2026-10-15, 10 사이트: msn/usatoday/npr/pbs/aljazeera/dw/euronews/apnews/nbcnews/abc_net_au)

- MSN(`ko-kr`)은 open 시점 `pageState`가 `{state:"unknown", evidence:"no meaningful page content"}`였다가, 수 초 뒤 overview에서 lang="ko-kr"·shown 33·not-rendered 61개로 실제 콘텐츠가 잡혔다. "의미 있는 콘텐츠 없음"이 영구 판정이 아니라 시점 관측임을 재관찰이 정정했다.
- Wikipedia 급이 아닌 뉴스 사이트에서 not-rendered gap이 NPR 404개, AP 173개, Euronews 128개, NBC 111개, USA Today 107개까지 나왔다. gap이 4백 개를 넘어도 projection은 헤더·outline·folded gap을 유지하며 크기를 예산 안에 유지했다.
- Dw.com은 `/en` 요청이 `/en/top-stories/s-9097`로 redirect됐고 header의 url/title이 최종 상태를 반영했다(redirect 추적 재확인). ABC.net.au `/news`도 동일하게 `/`로 정리됐다.
- Al Jazeera와 AP는 `ready-state:"interactive"`(나머지 complete)였다. 세트 5 Ars에 이어, 헤더의 ready-state가 사이트 무관하게 스냅샷 시점의 완결도를 구별하는 일관 신호임을 재확인했다.
- DNS 실패(존재하지 않는 도메인) 재현에서 `session open`이 `navigationError`와 함께 `pageState:{state:"ready"}`를 반환했다. `title:""`와 navigationError로 "접근 실패"는 구별됐지만, pageState만 보는 사용자에게는 "로딩 완료"로 오독될 여지가 있었다.
- observe 후속 재관찰(s6 세션 재스냅샷)은 동일 projection-id 재사용과 새 observation id로 재관찰임을 표시했다. 재관찰 동작 자체는 일관됐다.

### 6세트에서 적용한 일반 보완
- navigation 실패(session.open에 url이 있었고 navigationError가 난 경우)의 응답에 DOM probe를 돌리지 않고 `pageState:{state:"navigation_failed", evidence:첫 줄 오류}`를 싣도록 했다. about:blank/error 페이지의 DOM을 probe해 `state:"ready"`라고 광고하던 구멍을 막는다. 라이브에서 `ERR_NAME_NOT_RESOLVED` 도메인으로 `state:"navigation_failed"`와 evidence를 확인했다(사이트 무관 규칙; daemon 재기동 후 검증).

## 세트 7 (2026-10-15, 10 사이트: mercadolivre/shopee/lazada/ebay/gmarket_co_uk/alibaba/etsy/newegg/bestbuy/target)

- Shopee는 open 응답에서는 title이 비어 `state:"unknown"`이었는데, 이은 overview의 header url이 `/verify/captcha?...`로 잡혔다. open 시점에는 미처 모르고 재관찰이 captcha URL로 정체명을 밝힌 사례였다. 헤더 url이 관찰 시점마다 갱신돼 상태를 정정한다.
- gmarket.co.uk는 parked 도메인이어서 `/forsale.godaddy.com/...`로 이동했고, 첫 title에 `Loading https://forsale.godaddy.com/...`이라는 리다이렉트 중간 단계 텍스트가 그대로 담겼다. header url/title이 최종 페이지(forsale 페이지)로 갱신돼 추적됐다.
- Etsy는 `status:403` + `blocked:{kind:"captcha", evidence:"captcha frame on a nearly empty page"}` + `pageState.state:"blocked"`가 함께 나왔다. 상태코드와 blocked 근거가 한 응답에서 챌린지를 교차 확인했다.
- eBay 액션 혼합 관찰: forms가 form action=`/sch/i.html`(GET)과 `#gh-ac`(name=_nkw)을 노출 → fill 후 재관찰 `@state`에 값 유지 → Enter 제출 → header url이 `/sch/i.html?_nkw=raspberry+pi`로 바뀌고 title이 "Raspberry Pi for sale | eBay". diff의 document change가 `op:"incomparable", reason:"document-identity-changed", replacement:"unconfirmed"`로 나왔다 — 이동이 일어난 것은 분명하되 이전 document와 새 document의 동일성을 주장하지 않는 규칙이 의도대로 작동했다.
- 같은 결과 페이지의 list는 container=`ul.srp-results.srp-list`, total=60, otherGroups=18로 카드 5개를 `field="title"` 텍스트 + 링크 + price 포함 paragraph로 정확히 읽었다. 카드 href의 긴 토큰은 `<redacted-long-token>` + `destination-identity="redacted"`로 마스킹됐지만 항목별 링크는 유지됐다.
- Newegg overview는 not-rendered gap이 266개였고, Lazada는 lang=""(속성 없음)인데도 title/heading outline이 잡혔다. lang 결손이 콘텐츠 관찰을 막지 않았다.

### 7세트에서 적용한 일반 보완
- 코드 보완은 불요였다. navigation diff의 `incomparable/document-identity-changed`, blocked+captcha 교차 확인, parked/redirect 추적, list의 title 필드와 destination redaction은 전부 기존 일반 규칙이 사이트 무관으로 작동함을 라이브로 확인했다.

## 세트 8 (2026-10-15, 10 사이트: booking/airbnb/expedia/agoda/kayak/skyscanner/tripadvisor/trivago/hotels/pricesearcher)

- geo-redirect가 10개 중 6개에서 한 번에 확인됐다: booking→`index.ko.html`, airbnb(.com)→`airbnb.co.kr`, kayak→`kayak.co.kr/?ispredir=true`, agoda→`/ko-kr/?ds=...`, hotels→`kr.hotels.com/?locale=ko_KR`, skyscanner.net→`skyscanner.co.kr`. header의 url/title/lang이 최종 지역화 상태를 반영했다(redirect 추적 규칙의 대규모 재확인).
- Skyscanner는 open 단계의 title이 "항공권 비교..."로 정상처럼 보였지만, 재관찰 header url이 `/sttc/px/captcha-v2/index.html?...`였고 `registeredReferences:0`·not-rendered 2개뿐이었다. 재관찰이 open 시점의 낙관적 상태를 captcha로 정정했다(Shopee와 같은 패턴).
- Pricesearcher(Coming Soon 페이지)는 `scan.complete:true`가 나왔다. 10개 세트에서 scan이 완결된 첫 페이지로, "gap이 없다"가 실제로 콘텐츠가 적기 때문임을 header가 보증했다. 단순 페이지에서 overview는 gap 없이 outline complete=true로 끝났다.
- Booking/agoda/kayak/trivago/hotels은 한국어 localized 페이지로 열렸고 lang=ko/ko-KR/ko-kr 표기가 문서마다 달라도(`ko` vs `ko-KR` vs `ko-kr`) outline과 heading이 동일 규칙으로 잡혔다.
- airbnb는 open 응답의 title이 `Loading https://www.airbnb.co.kr/`(intermediate)였고 pageState evidence가 `missing document`였다가, overview에서 최종 한국어 타이틀과 shown 21로 정정됐다. intermediate title도 헤더에 그대로 남는 것을 관찰했다.

### 8세트에서 적용한 일반 보완
- 코드 보완은 불요였다. redirect/지역화 추적, captcha 정정 재관찰, scan.complete 보증은 전부 기존 일반 규칙의 사이트 무관 동작으로 확인됐다.

## 세트 9 (2026-10-15, 10 사이트: apple/microsoft/netflix/spotify/adobe/salesforce/shopify/stripe/canva/figma)

- Spotify(open.spotify.com)는 open 응답이 `state:"unknown"/"no meaningful page content"`였고 title도 "Spotify – Web Player"였는데, overview에서는 lang="ko"·shown 25·title "Spotify - Web Player: Music for everyone"로 실제 웹플레이어 셸이 잡혔다. SPA 셸 페이지에서 open→snapshot 정정이 다시 작동했다.
- Microsoft 한국어 페이지는 overview `shown`이 49(requested 25)로 가장 컸고 not-rendered 365개도 최다였다. `closureMayExceed` 설명 아래 예산의 2배가 넘어가도 출력 총량은 다른 사이트와 같은 예산 범위로 유지됐다.
- Figma는 `/ko-kr/` redirect와 함께 `frame-not-scanned`가 10개 나왔다. 마케팅 페이지의 임베드 영상/위젯 iframe이 스캔 제외되는 일반 규칙이 재확인됐다.
- geo redirect가 microsoft(`/ko-kr`), netflix(`/kr/`), salesforce(`/kr/?ir=1`), shopify(`/kr`), canva(`/ko_kr/`), figma(`/ko-kr/`)에서 확인돼, redirect 규칙의 사이트 무관성이 40개 사이트 표본에서 일관됨이 재입증됐다.
- Apple은 not-rendered 75개 외 gap reason이 view-budget뿐이었고, adobe 135개, shopify 66개 등 마케팅 페이지들도 lazy-load 패턴이 뉴스와 같은 규칙으로 표기됐다.

### 9세트에서 적용한 일반 보완
- 코드 보완은 불요였다. SPA 정정 재관찰, budget 초과 표시, frame 제외, redirect 추적이 모두 사이트 무관 일반 규칙으로 작동함을 확인했다.

## 세트 10 (2026-10-15, 10 사이트: dropbox/slack/zoom/atlassian/google_cloud/aws/digitalocean/vercel/github_blog/hashicorp)

- zoom.us는 `/ko`로, hashicorp는 `/ko`, aws는 `/ko/`, slack은 `/intl/ko-kr/`로 geo-redirect됐다. 헤더 url/title/lang이 최종 지역화 상태를 반영하는 규칙이 100개 사이트 전체에서 일관되게 재확인됐다.
- DigitalOcean의 collection-timing에서 referenceStateMs 38.7ms·resultTransferMs 702ms로 세트 전체에서 가장 느린 캡처였다. collection-timing phases가 사이트별 캡처 원가 차이를 그대로 노출했다(어디가 느렸는지를 응답이 자체 보고).
- Slack은 `frame-not-scanned` 0, dropbox 1, hashicorp 1 등 SaaS 마케팅 페이지의 iframe이 규칙대로 스캔 제외됐다. github.blog(뉴스형) 0, vercel 0 등 frame 없는 페이지는 reason 자체가 없었다 — gap reason 분포가 페이지 유형 신호로 계속 유효했다.
- 10개 중 8개(드롭박스/슬랙/줌/구글클라우드/AWS/디지털오션/해시코프)가 한국어 localized 페이지로 열렸고, `closureMayExceed:true` 하에서 shown 15~28로 모두 예산 근처에 수렴했다.
- Atlassian, Vercel, GitHub Blog는 lang="en"系로 남아 redirect가 없었고, redirect 유무와 무관하게 동일 overview 규격이 출력됐다.

### 10세트에서 적용한 일반 보완
- 코드 보완은 불요였다. redirect/지역화, frame 제외, budget 수렴, collection-timing 자가 보고까지 전부 기존 일반 규칙의 사이트 무관 동작으로 확인됐다.

## 100사이트 종합 (세트 1~10 재확인된 일반 규칙)
- 상태 신호: `session open`의 status/setupStatus/pageState(+evidence)/navigationError/blocked가 1차 분류를 담당하고, 재관찰 overview가 시점 정정(shopee/skyscanner/spotify/airbnb 패턴)을 담당했다.
- gap reason 분포(view-budget/not-rendered/budget/frame-not-scanned)는 페이지 유형(lazy 뉴스/SPA/마케팅/단순)을 사이트 무관로 식별했다.
- diff는 document 교체를 `incomparable/document-identity-changed`(replacement:"unconfirmed")로, 이동·value 변경은 signal change로 보존했다.
- eval은 `--expr`이며 결과는 expression 스코프로 자체 표기됐다. batch는 fill/select/extract를 한 왕복에서 받았다.
- 이번 10세트에서 새로 넣은 일반 보완: navigation_failed pageState(6세트), help의 eval/scroll/wait-for/batch 주석(4·5세트), batch extract(3세트), eval scope(2세트), change signal hoist(2세트) — 모두 사이트 분기 없음.
