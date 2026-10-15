# 명령 참조

기본 작업 흐름은 [SKILL.md](../SKILL.md), 실행·참조·배치 규칙은 [실행 안내](EXECUTION.md), 자산화와 복구는 [학습 안내](LEARNING.md)를 읽습니다. JSON은 --input-file로 전달합니다.

## 전체 명령

```bash
# --- health / browser ---------------------------------------------------
webctl health                       # daemon + Chrome status
webctl browser status               # which Chrome profile is in use, and why
webctl browser profiles             # every Chrome profile on this machine (index 0 = first)
webctl browser use --profile "Profile 1"   # pin a specific profile by name or directory
webctl browser use --auto           # back to the default: the first profile
webctl browser repair               # restart Chrome and reconnect after a crash
webctl browser reveal               # open a visible window (login/CAPTCHA/help needed)
webctl browser hide                 # back to headless (the default)

# --- sessions -----------------------------------------------------------
webctl session open [--url URL] [--viewport 1440x900] [--locale en-US]   # headless window is 1440x900 by default
webctl session list
webctl session close --session ID
webctl session close --all           # close every open tab (cleanup sweep)

# --- look at the page (read-only, always safe) --------------------------
webctl snapshot --session ID [--save] [--query "검색어"] [--limit N]   # live DOM elements (incl. shadow DOM); --query searches the whole page, best matches first
webctl list --session ID [--query TEXT] [--limit N]   # read repeated items (search results, cards, rows): title, href, text
webctl screenshot --session ID [--full-page]
webctl dismiss-annoyances --session ID     # auto-close cookie banners, modals & popups
webctl wait-idle --session ID              # wait until the DOM stops changing (actions already settle by themselves)
webctl wait-for --session ID (--text "..." | --css "...") [--timeout-ms 5000] # wait until specific element appears
webctl forms --session ID                  # analyze all forms, inputs, and submit buttons
webctl diff --session ID --before FILE     # compare before/after snapshot to detect changes & errors
webctl api-sniff --session ID              # capture clean JSON API calls from backend
webctl network start --session ID          # begin recording raw requests
webctl network stop  --session ID          # stop and return them
webctl eval --session ID --expr "JS..."    # evaluate JavaScript & extract structured data directly

# --- act on the page ----------------------------------------------------
webctl goto    --session ID --url URL
webctl click   --session ID <locator> [--confirm] [--force] [--observe]
webctl hover   --session ID <locator> [--observe] [--query TEXT]   # open hover menus / collapsed sub-lists
webctl back    --session ID      # history back (Alt+Arrow keys do nothing in headless Chrome)
webctl forward --session ID
webctl fill    --session ID <locator> --value TEXT [--submit]   # reads the value back (valueMatches; tokenized for chip inputs)
# --submit (Enter) submits the field's whole form: with several forms on a page (header search + advanced form),
# fill the field of the form you mean, or click that form's own submit button.
webctl select  --session ID <locator> --option "Text"           # <select> or custom dropdown, by option text (partial ok if unique)
webctl press   --session ID [<locator>] --key Enter
webctl scroll  --session ID [--direction down|up] [--distance 800] [--times 3] [--selector CSS] # trigger infinite scroll / lazy loading
webctl extract --session ID <locator> [--read text|value|attribute] [--attribute href] [--all [--limit N]] [--learn]
# --all: values of every visible match, in order. --learn: also encode the read as site knowledge.

# --- hyper core tools (고급 특화 도구) --------------------------------
node <skill>/scripts/tools.mjs user-intervene --reason "..." [--until-url URL] [--until-text TEXT]  # 캡차/로그인 인간 개입 요청 및 완료 대기
node <skill>/scripts/tools.mjs smart-scroll [--selector CSS] [--target-count N]                     # 가상 DOM 증발 방지 누적 스크롤러
node <skill>/scripts/tools.mjs sniff-ws [--duration SEC] [--filter REGEX] [--limit N]               # 실시간 웹소켓(WSS) 프레임 패킷 가로채기
node <skill>/scripts/tools.mjs download --url URL [--out PATH]                                       # 세션 인증 쿠키를 유지한 PDF/파일 직접 다운로드

# --- known-site execution ----------------------------------------------
webctl identify --session ID
webctl actions  --session ID
webctl run ACTION_ID --session ID [--input '{"key":"value"}' | --input-file input.json] [--confirm] [--site SITE_ID]
# PowerShell strips the inner quotes of --input JSON; use --input-file there.

# --- knowledge ----------------------------------------------------------
webctl site init --id SITE_ID (--host HOST | --session ID) [--name NAME]
webctl site validate [--id SITE_ID]
webctl registry build
webctl learning status --session ID
webctl metrics summary
```

`<locator>` is **exactly one** of these flags, optionally with `--exact`:

현재 스냅샷 참조가 있으면 아래 locator 대신 `--ref e27`을 사용할 수 있습니다. ref는 locator·`--nth`·`--within`·`--all`과 함께 쓰지 않습니다.

```bash
--role button --name "Save"      # preferred: accessible role + name
--label "Email"                  # form field by its label
--placeholder "Search"           # form field by placeholder
--testid save-button             # data-testid
--text "Save changes"            # visible text
--css "button[type=submit]"      # last resort only
```

Prefer them in that order. `--css` breaks when the site restyles; `--role` usually does not.

Add `--within "<text>"` to keep only matches whose card heading, form or landmark contains that text
(e.g. `click --role link --name Repository --within serde_json`). `--nth N` picks among visible matches.

How a locator resolves (nothing is done unless it resolves to one element):
- several visible matches, but exactly one has exactly that name/label/text → that one (`resolvedBy: "exact"`;
  `--label "These words"` no longer means "Not these words"); all links to the same href → one target
  (`resolvedBy: "same-href"`);
- otherwise `ambiguous: true` with `candidates` (`nth`, `role`, `name`, `label`, `placeholder`, `href`, `value`,
  `context` = heading / form / landmark) → re-run with `--nth N` or `--within`;
- only hidden matches → `reason: "hidden_only"` with `alternatives` (visible elements with the same words, each with
  ready-to-use flags in `use`); nothing at all → `reason: "no_match"` with `suggestions`. Roles in snapshot are the
  implicit ones too (input type=search → `searchbox`, select → `combobox`), so `--role` can be copied from it.

Actions give up after 5 s (`--timeout-ms N`) and say why: `reason` is `wrong_element` (e.g. fill on a <select>:
use `select`), `intercepted` (with `interceptedBy`), `blocked_by_overlay` (an open panel/dialog/backdrop covers the
page: finish or close it, or press Escape), `not_visible`, `not_stable`, `clipped`, `disabled`, `outside_viewport`
or `timeout`, plus `log` (Playwright's last steps). A target cut off by a scrolling container is scrolled into view
automatically; one inside a collapsed container is refused even with `--force` (`clipped`: hover or open its parent).
`hover` leaves the pointer there, so a following click on the revealed item works.

Every action waits for the page to settle and returns `effect`: `urlChanged` (+ `status`, new `title`, `h1`,
`blocked` when the new page is a bot check), `targetChanged`, `targetGone`, and `page` = changes elsewhere
(`valueChanges`, `stateChanges`, dialogs/menus `opened`/`closed`, `interactiveDelta`, `appeared`/`disappeared` button and
link names — a renamed control shows in both). `session open`/`goto` report `status`; `interstitial: "passed"` means a
bot check showed first and the real page followed (the status is the check's, e.g. 403). `observed: false` means
nothing visible changed. Every response has `durationMs`.

`snapshot` (open shadow roots included) gives `viewport`, `open` (visible dialogs/menus/listboxes), and elements with:
- state when present: `checked`, `selected`, `selectedText`, `expanded`, `pressed`, `disabled`; `value` of text
  fields (not secrets); `popup` (what it opens); `hint` = the words just before a control ("Sort by:");
- custom checkboxes whose real input is hidden appear as their visible `label`, carrying that input's `checked`;
- `transparent: true` = an invisible control lying on top of its look — that is the element to click;
- `clipped: true` = cut off by a collapsed container (hover/open its parent); `clipped: "scroll"` = inside a scrolling
  box (actions scroll to it);
- `context` = the card/section heading, on elements whose role+name repeats on the page;
- containers (elements holding other controls) have no text name, so `--query` hits the control, not the wrapper.
With `--query`: best matches first (exact name > starts with > contains; a repeated link also matches by its card
heading), `hidden` = matching controls that exist but are hidden (+ `openWith`: what probably reveals them), and
`textHits` = plain text matches (status lines like "489 items", span/div buttons) with a ready `use` locator.
`headings` are left out when you pass --query. `omitted` says how many matches were cut by the limit, per section. When nothing matches, `collapsed` lists closed
`<details>` and collapsed toggles (with `use` flags): many sites render a panel's controls only once it is opened, so
open the likely one and query again. A `<summary>` has no role usable with `--role`; click it by `--text`. An empty list comes with `diagnostics`;
`blocked` appears when the page is a bot-verification wall (stop, or ask the user with `browser reveal`).
`diff` lists `stateChanges` (e.g. checked false → true). `forms` (also inside shadow DOM) adds `group` (fieldset
legend), `selectedText`, `checked`, custom comboboxes (`role: "combobox"`) and `hidden: true` for hidden fields;
secret fields (password, card, one-time code) show `[HIDDEN]`.

실행 응답의 execution은 not_started / completed / outcome_unknown입니다. learning_pending은 작업 종료를 막지 않습니다. 자세한 정책은 learning status로 조회합니다.
Visiting a site no longer creates `sites/<site>/`; it is created when you encode knowledge (`site init`,
`extract --learn`). `identify` reports `known: true` only when the site has actions/URL templates/extractors, and
lists its actions.


## 요소 참조와 일회성 배치

```text
webctl snapshot --session ID [--query TEXT] [--limit N]
webctl click --session ID --ref e27 [--confirm] [--observe] [--verbose]
webctl hover --session ID --ref e27
webctl fill --session ID --ref e28 --value TEXT
webctl select --session ID --ref e29 --option TEXT
webctl press --session ID --ref e28 --key Enter [--confirm]
webctl extract --session ID --ref e28 [--read text|value|attribute] [--attribute NAME]
webctl batch --session ID --input-file commands.json [--verbose]
webctl request status --id REQUEST_ID [--verbose]
```

--ref는 --role/--css/--nth/--within/--all과 함께 사용할 수 없습니다. 번호는 현재 탭의 실제 요소만 가리키며 영구 지식에는 저장하지 않습니다. --learn으로 추출을 저장할 때도 현재 참조를 역할·이름·맥락 같은 의미 있는 선택자로 변환하며 다음 방문의 재검증이 필요합니다.

## 학습과 복구 명령

```text
webctl learning notes --session ID [--capability NAME]
webctl learning notes save --session ID --input-file notes.json
webctl learning action save --session ID --input-file action.json
webctl overview save --session ID --input-file overview.json
webctl overview run --session ID --site SITE_ID
webctl asset status ACTION --session ID [--site SITE_ID]
webctl asset report ACTION --session ID --reason wrong_result|structure|locator [--site SITE_ID]
webctl learning finish --session ID --input-file finish.json
```

## 읽기 전용 결과 검증

```text
webctl verify --session ID --input-file checks.json
```

최대 20개 명시 조건, 전체 기본 5초. 조건별 기대값·관찰값과 APPLIED/NOT_APPLIED/UNKNOWN을 반환한다. 실행이나 자산 저장은 하지 않는다. 입력 형식과 예시는 [VERIFICATION.md](VERIFICATION.md). 기존 @e27 참조를 PowerShell에 직접 전달할 때는 `--ref '@e27'`처럼 감싼다.
## 요청 중심 관찰과 HWM 상세

`webctl snapshot --session ID`는 본문 그래프 없이 패널 지도와 주요 컨트롤을 반환한다. 지도 응답의 `at`으로 `read --at HANDLE --panel PANEL --want outline`을 요청하면 제목·하위 패널을 읽는다. 해당 항목의 `at`으로 `read --at HANDLE --want content,controls,state`를 요청하면 그 범위만 현재 DOM에서 읽는다. outline은 다른 want와 묶지 않는다. 기본 read는 controls이며 본문 검색에는 content를 명시한다.

`at`은 지도·범위·전달 receipt·consumer를 묶은 불변 핸들이다. 다음 호출에는 실제 받은 최신 응답의 at을 사용한다. 지도 루트 핸들에는 panel을 지정할 수 있지만 패널에 묶인 핸들로 다른 panel을 고를 수 없다. `--at`과 `--map`/`--since`/`--consumer`를 함께 쓰면 conflicting_continuation이다. 기존 `--map MAP --panel PANEL --since DELIVERY` 호환 경로는 유지한다. --repeat는 알고 있는 필드도 다시 전달한다.

핸들 TTL은 5분이며 최대 256개/메타데이터 1MB다. 지도(최대16개)와 전달 ledger(최대64개/총1MB)가 먼저 제거될 수도 있다. continuation_expired/scope_expired/scope_stale/delivery_expired는 새 지도와 필요한 로컬 조회로 복구한다. 다른 문서·세션의 핸들은 거부한다. 핸들은 실행 ref나 쓰기 승인, 실행 대상의 패널 한정 검사를 대신하지 않는다. click/fill/select/press/hover/batch의 기본 hb 경로에서 전달 기준으로 사용할 수 있고 실행 ref guard는 별도로 적용된다. JSON/HWM 호환 실행이나 지원하지 않는 명령에 at을 주면 실행 전에 거부한다.

read의 `--query TEXT`, `--item N`, `--target N…또는발급된e…`, `--offset N`, `--limit N`, `--text-limit N`, `--byte-budget N`으로 범위를 좁힌다. 기본적으로 별도 하위 패널은 제외한다(extent=own). `--include-children`에서만 포함한다(extent=subtree). boundaries.excludedPanels는 제외한 직접 하위 패널 수이며 outline에서 선택할 수 있다. nextRead의 want/query/item/target/offset 조건을 유지해 이어 읽는다.

outline은 본문·값 수집 없이 제목을 최대24개, 하위 패널 최대8개와 함께 작은 예산으로 전달한다. 알려진 제목 레벨에 대해서만 섹션 at을 제공한다. 섹션은 원래 조회 루트 안에서 해당 제목부터 다음 같거나 높은 레벨 제목 전까지다. 이것은 heading-outline-v1 파생 범위이며 DOM 부모 관계가 아니다. 레벨 미확인은 readable=false다. coverage와 childrenCoverage는 제목과 하위 패널의 관찰·출력 범위를 따로 나타낸다. 일부 결과를 전체 목록으로 해석하지 않는다.

조작 응답의 focus에는 새로 열린 영역의 실제 범위가 들어간다. 단일 menu/listbox의 컨트롤이 8개 이하이고 항목 데이터가 2KB 이하인 완전 관찰에서는 items에 실제 역할·이름·실행 ref를 바로 제공한다. 더 크거나 일부면 컨트롤 표본과 로컬 read 경로를 제공한다. 같은 지도 안의 같은 열린 대화상자에서 조작하면 내용·컨트롤·상태 차분을 우선 전달한다. 문서 교체 후에는 작은 새 지도를 제공한다. observationError는 후속 관찰 실패이며 이미 실행된 명령을 다시 보내라는 뜻이 아니다. 관찰된 current는 aria-current의 원문 값이다.

`explain --at HANDLE`은 해당 범위 HWM 상세를 현재 DOM에서 읽는다. 기본 절차로 요청하지 않는다. 예산을 넘으면 같은 보관 그래프의 투영 노드 수를 줄이며 최소 투영도 맞지 않으면 detail_budget_exceeded다. view/expand/inspect는 보관된 과거 관찰 조회이며 live read와 시점을 혼합하지 않는다.

질의 read의 match는 실제 일치 필드, hint/hintSource는 주변 문구의 파생 근거다. 이름 없는 컨트롤의 viewportBox는 뷰포트 CSS 픽셀 [x,y,width,height]다. redacted에 href가 있으면 출력 링크가 마스킹되었다는 뜻이다. aria-hidden은 접근성 선언이며 rendering은 관찰한 CSS 사실로, 시각적 가림이나 과업 성공을 대신 판정하지 않는다. 이어 읽기 offset은 같은 want/query/item/target 집합에서만 사용한다.

명시적인 `--format hwm` snapshot은 기존 상세 관찰이고, `--format json` 또는 `WEBAGENT_OUTPUT_FORMAT=json`은 기존 스크립트 호환 JSON과 contextGraph를 반환한다. 이 두 상세 경로의 `--context-limit N`은 본문 수집 soft 한도(기본2000, 하드6000), `--limit`은 기존 컨트롤 한도다. hb 지도에는 적용되지 않는다. 새 read의 coverage.complete는 현재 요청 범위의 완결성, nextOffset은 추가 조회 위치, 문자열 Truncated/Length는 잘림 정보다. P…/N…는 읽기용, e…만 실행 참조다.

N… 읽기 대상도 발급 시점의 구조 식별 경계(id/data-key/data-id/href/role/type 및 조상)를 검증한다. 같은 DOM 객체가 다른 항목으로 재사용되면 옛 대상은 read_target_not_found로 거부하며 새 관찰은 새 N…을 발급한다. 본문·값의 단순 변경은 별개의 항목이라고 추정하지 않는다. 이 별칭은 실제 DOM 동일성을 추적하는 그래프 tracking.id와 별도이며, 전역·영구 식별자로 저장하지 않는다. content 차분에서 사라진 이름/접근성 선언 등 이미 전달한 선택 필드는 unavailableFields로 철회한다. 첫 지도 URL도 공통 마스킹을 거치며 마스킹한 경우 redacted:["url"]을 표시한다.

본문과 조작 요소의 조상·순서, 명시적 레이블/폼/ARIA 연결, 검색 `matches`의 일치 필드, 누락 `gaps`를 함께 제공한다. 프레임 내부는 이 단계에서 아직 수집하지 않고 `frame-not-scanned`로 표시한다. 조작 가능한 참조는 기존 요소 참조 계층에서 발급한 것만 연결한다.

기본 형식은 hb 지도/범위 응답이다. 명시 HWM의 기본 투영은 overview이며 full/focus/view/expand/inspect는 상세 경로다. 명시 JSON/HWM snapshot의 --save는 마스킹된 snapshot JSON과 그래프를 저장한다. hb map은 전체 그래프 파일 저장을 하지 않는다. 관리 명령과 inspect는 기본 JSON을 유지한다.

overview/focus에서 raw box/space는 full/inspect 상세로 옮기고 detail-projection으로 축약을 선언한다. 기본 view(inside/outside/partial)와 layout-boundary는 유지한다. 정본 노드에 actionRef가 없으면 기본 모드에서 read --map MAP --panel PANEL --want controls --query TEXT 또는 기존 --role/--name/--label/--within으로 선택할 수 있다. 정본 ID를 --ref로 실행하지 않는다. session open 결과의 세션 키는 id다.

그래프 수집 시점은 `collectionTiming`, 후속 페이지 상태/차단 진단은 `stateObservation`으로 구분된다. 중간 문서 교체는 부분 관찰로 표시한다. 같은 문서라는 사실이 두 시점의 DOM이 동일함을 보장하지 않는다.

2단계부터 그래프의 `facts`, `state`, `outline`도 제공한다. HWM의 `@state`에는 중복 키를 유지한 URL 파라미터, 폼 소유 관계가 있는 현재 입력값·체크 상태, 그룹 선택의 부분집합과 `selected-complete`, status/aria-live 문구와 원본 텍스트 참조가 나온다. `@outline`은 제목 레벨 기반 파생 개요이며 실제 DOM 부모를 바꾸지 않는다.

현재 그룹 요약은 native select, 명시적인 radiogroup/tablist, fieldset 안의 체크·라디오를 대상으로 한다. open shadow를 가로지르는 그룹의 전체 선택은 확정하지 않는다. 별도 그룹 근거가 없는 입력은 개별 필드 상태로 제공한다. `password`, `secret`, `token`, `api-key` 성격의 URL 쿼리 값과 입력값은 공개 출력에서 마스킹한다.

리뷰 보완으로 CSS 스크롤/클리핑 경계의 overflow 선언·client/scroll 크기·offset을 `layout-boundary`에 보존한다. 숨긴 컨테이너는 hidden/rendering/ARIA 선언과 not-rendered gap을 남기며 하위 내용을 읽지 않는다. `aria-hidden`과 실제 CSS 비렌더링은 서로 다른 사실이다.

`collectionTiming.phases`는 참조 상태 준비·페이지 평가·결과 전송·참조 바인딩·최종 해제 시간을 구분한다. `collectionTiming.references`는 호스트 등록 참조 수, 대기 중 해제, 누적 해제 완료/실패, 마지막 무효화 해제 시간을 보여준다. 이 값을 정확한 CDP 횟수나 브라우저 전체 메모리/GC 완료로 해석하지 않는다.

## HWM 관찰 간 변화 (단계 3)

```text
webctl fill --session ID --css input --value Boston --context
webctl click --session ID --ref e… --format hwm
webctl batch --session ID --input-file batch.json --format hwm
webctl diff --session ID --before saved-snapshot.json --format hwm
```

click/hover/fill/select/press/batch의 기본 hb는 기존 실행 계층의 결과/effect와 delivery만 반환한다. 전체 조작 후 그래프를 추가 생성하지 않는다. since는 이전 실제 수신 기준이며 다른 영역이 그대로라는 보장은 아니다. 실행은 한 번만 한다. 명시 --format hwm은 기존 보관 관찰과 대상 주변 관찰(limit24/context-limit800)의 @result/@change 상세를 유지한다. 이전 관찰이 없으면 no-prior-observation이다. --format json --context는 상세 snapshot.contextGraph와 changes를 제공한다.

diff의 `--before`에는 `snapshot --context --save`로 저장한 JSON 파일 또는 snapshot/contextGraph를 포함하는 명령 결과 JSON을 넣는다. HWM 텍스트를 입력 파일로 넣는 기능은 아니다. diff는 현재 화면을 읽으며 조작을 실행하지 않는다. 문서 식별이 달라지면 별도 사건으로 남기고 실제 문서 교체 여부는 미확정으로 표시한다.

실제 DOM 동일성을 확인한 필드만 changed/unchanged로 표시한다. 미수집·마스킹·부분 선택·동일성 미확인은 incomparable이며, 부분 관찰에서 누락된 노드를 removed로 판정하지 않는다. 새 탭은 실제 popup 이벤트와 등록된 session ID로 기록한다. 실행 완료와 사용자 과업 성공을 자동으로 같다고 판단하지 않는다.

## HWM 보관·펼침·투영 (단계 4)

```text
webctl snapshot --session ID --format hwm --mode overview --node-budget 120 --text-budget 240
webctl view --session ID --observation OBS --format hwm --mode focus --focus REF
webctl expand --session ID --observation OBS --target NODE_OR_GAP --format hwm --node-budget 80 --text-budget 160
webctl inspect --session ID --observation OBS --target NODE
webctl changes --session ID --comparison CMP --format hwm --change-budget 40
webctl expand --session ID --comparison CMP --target CHANGE_GAP --format hwm
```

OBS는 @hwm 관찰 ID 또는 contextGraph.observation, CMP는 조작/diff 결과의 comparison 또는 HWM 헤더 retention.comparison이다. JSON 명령에서 반환되는 observation도 같은 ID다. 펼침 대상은 노드의 정본 ID, 발급된 actionRef, 또는 @gap의 expand 값이다. inspect는 저장된 정본 노드/원래 조상/연결/누락을 JSON으로 반환한다. view/expand/changes는 --format hwm일 때 HWM, 그 외에는 동일 투영 AST를 JSON의 view로 반환한다.

노드·제목·노드 gap의 expand에 --node-budget/--text-budget을 지정할 수 있다. 같은 저장 관찰을 범위 안에서 투영하며 브라우저를 재조회하지 않는다. 필수 조상·관계 때문에 노드 예산은 soft이고, 문자열 예산은 주 문자열에 적용된다. 남은 내용은 folded로 표시한다. 예산을 생략하면 기존 상세 펼침 기본값(노드 6000, 주 문자열 자르지 않음)을 유지한다. 원본 관찰과 inspect 내용은 변경하지 않는다.

eval은 기본 hb에서 식의 원래 결과를 compact JSON으로 반환한다. 명시 HWM은 scope="eval-expression"과 최대240 code point 식 안내를 제공한다. 더 길면 expressionTruncated/expressionLength/expressionLengthUnit을 표시하며 결과 value는 이 안내 예산으로 자르지 않는다. --format json은 기존 원래 결과의 호환 직렬화를 유지한다.

`close --session ID`와 `close --all`은 각각 session close의 별칭이다. 두 CLI에서 같으며, --all은 본래 명시된 모든 탭 닫기와 같은 동작이다. session open의 navigationError가 있는 경우 실패한 문서의 DOM을 ready 근거로 삼지 않고 기존 navigation_error 상태와 첫 줄 오류를 제공한다.

원시 수집 gap(unobserved/unavailable/redacted)은 저장된 내용 접기가 아니다. `expand`에 원시 gap ID를 넘기면 `observation_gap_not_expandable`이다. `kind=folded`의 실제 `expand` 값만 접힌 내용을 조회하는 핸들이다.

보관 거절 시에는 `retention={ok:false,reason:...}`로 이유를 제공하고, 요청한 overview/focus와 문자열 예산을 유지한다. 저장되지 못한 숨김 내용은 `kind=unavailable`, `collected=true`, 보관 거절 reason, 원래 `omission-reason`을 표시하며 expand 핸들을 제공하지 않는다. 이는 수집하지 않은 내용과도 다르다. 거절 기록은 관찰 수 상한/TTL 안에서만 보관하며 해당 기간의 조회는 `observation_too_large`/`observation_store_full`을 반환한다. 기록까지 만료·퇴출되면 `observation_expired`이고 현재 화면으로 대체하지 않는다.

기존 `list`의 제목·본문 발췌에는 `titleTruncated/textTruncated`, 원문 및 표시 길이(`titleLength/titleShown`, `textLength/textShown`)와 `lengthUnit=unicode-code-point`를 붙인다. 잘린 발췌에 문구가 없다는 이유로 전체 항목에 없다고 판단하지 않는다. 전체 내용을 확인하려면 HWM의 해당 항목을 펼치거나 새 관찰을 요청한다.

명시 full은 수집 범위 전체를 표시한다. overview는 주요 구조와 요소의 항목/문단 맥락을 예산 안에서 선택하고 나머지를 접는다. focus는 대상의 항목/문단/폼 맥락, 원래 조상, 명시 연결의 외부 종점·레이블과 렌더링된 dialog 선언을 보존한다. dialog를 실제 가림 요소라고 단정하지 않는다. 필수 조상·관계 폐쇄로 node-budget을 초과할 수 있으며 projection-budget에 표시한다. 기본 노드 예산은 120, overview/focus 문자열 예산은 Unicode code point 240개다. full은 별도 문자열 예산을 주지 않으면 자르지 않는다. 명시 HWM의 기본 모드는 overview다. 일반 명령 기본은 hb 지도/범위 응답이다. node-budget을 지정하지 않은 일반 관찰은 선택된 기존 실행 요소와 조상/항목 맥락을 우선 유지한다.

단일 자식의 정보 없는 div/span 래퍼만 뷰에서 축약한다. via에는 원래 조상 ID를 남기며 inspect로 보존된 정보를 읽을 수 있다. 분기·이름·상태·실행·연결·개요·스크롤·gap 경계는 축약하지 않는다. 반복 구조 표시는 observed-tree-shape-v1의 kind/tag/role/속성 이름/자식 구조에 따른 사실이며 내용·값이 같다는 뜻이 아니다. 접은 항목의 원문·상태는 저장 그래프에서 펼친다.

링크 색인은 같은 정규화 URL의 발급 ref를 나열한다. 대표를 선택하거나 실행 대상을 병합하지 않는다. 정규화할 수 없는 href는 raw-href로 표시하고, 마스킹된 URL은 같은 목적지로 묶지 않고 개별 ref와 destination-identity=redacted로 남긴다.

관찰/비교의 조회 유효기간은 저장 시점부터 5분이며 접근으로 연장하지 않는다. 기본 관찰 32개, 비교 32개, 공용 직렬화 예산 16MiB, 단일 항목 2MiB이며 FIFO로 퇴출한다. 프로젝트 계획은 최대 32개/4MiB로 별도 제한한다. 이 수치는 해당 보관 계층의 직렬화 예산으로 전체 Node/Chrome 메모리 한도가 아니다. 만료 데이터는 읽기/쓰기 시 정리한다. 조회 불가 시 observation_expired, comparison_expired 또는 projection_expired이며 현재 브라우저를 재조회하지 않는다. session close는 해당 보관을 지운다. 과거 ref의 실행 유효성과 저장 관찰의 조회 유효기간은 별개다.

@gap scope=nodes에는 원래 roots/order 범위와 누락한 노드/항목 개수가, scope=field에는 필드·잘린 code point 개수가 나온다. 큰 roots 목록은 overview/focus에서 order-bounds(원래 형제 인덱스의 최소/최대, 연속 범위 보장 아님)와 roots-detail="expand"로 접는다. expand는 정확한 노드/소속/순서를 같은 관찰에서 복구하는 gap ID다. scope=changes에는 보유 변화 목록의 완결성과 이전/이후 관찰 완결성을 따로 표시하며, 원래 비교의 변화 ID 범위를 보관한다. 부분 관찰의 누락을 실제 삭제로 바꾸지 않는다. 만료·퇴출 후에는 옛 관찰을 새 화면으로 대체하지 않는다.

overview/focus의 전역 @links 색인은 최대 12개 목적지/항목 JSON 4096 bytes의 안내 예산으로 투영하며 중복 목적지를 먼저 예약한다. 각 노드 href와 개별 실행 ref는 유지한다. index-complete=false는 저장 관찰의 색인 중 일부만 출력했다는 뜻이고, complete는 원래 수집 범위의 완결성이므로 별개다. 접힌 scope=links gap은 생략한 색인 항목/참조 수와 expand를 제공한다. 펼치면 같은 관찰의 전체 색인을 반환한다(추가 출력 비용 있음). full은 색인을 접지 않는다. repeated-shapes의 상세 구조 해시/단일 항목 그룹과 성능 phases/references는 기본 출력에서 상세 축약하며 detail-sections에 경로를 표시한다. 수집 시 문서 교체/시점 불일치 근거, 본문·소속·상태·위치 경계는 유지한다.
## 목표 중심 코어

`find`/`run`은 기본 작은 HB JSON을 반환한다. 프로젝트 경로의 webctl을 사용한다. 조회·계획은 사이트 학습 자산을 만들지 않는다.

```text
webctl find --session ID --query TEXT [--role ROLE] [--fields name,text] [--exact] [--scope active|document] [--scope-ref REF] [--content] [--limit 5]
webctl find --session ID --input-file goal.json [--since DELIVERY --consumer CONSUMER] [--repeat]
webctl run --session ID --input-file task.json
webctl fill --session ID --ref REF --value VALUE --then-file next.json
```

`--headless-only`은 요청의 자동 headed 폴백을 막는다. 기본 정책은 그대로다. 실패한 계획은 모드를 전환해도 자동 재실행하지 않는다. 실행 예산은 새 동작의 시작을 제한하며 이미 시작된 동작을 취소·롤백했다고 주장하지 않는다.

목표 파일: terms(최대8개), fields(name/text/label/placeholder/value/href), roles(선택), exact, scope(active/document 또는 {ref}), states(value/checked/selected/expanded/pressed/disabled), actionableOnly(기본true), limit(기본5/최대12), byteBudget(근거 기본4000/최대16000), maxVisits(기본12000/최대20000). `--content`는 actionableOnly=false다. 후보 접힘과 부분 수집은 다르다. 반환 status와 coverage를 함께 읽는다. 전송 receipt 등 작은 메타데이터는 근거 예산에 추가된다.

`task.json` 예시(이름은 현재 페이지에서 관찰한 값으로 작성):

```json
{
  "steps": [
    {
      "id": "type-place",
      "target": {"terms": ["Destination"], "fields": ["name"], "exact": true},
      "action": {"op": "fill", "value": "Seoul"},
      "expect": {
        "fields": {"value": "Seoul"},
        "introduced": {"terms": ["Seoul"], "roles": ["option"], "exact": true}
      }
    },
    {
      "id": "choose-place",
      "target": {"terms": ["Seoul"], "roles": ["option"], "exact": true},
      "action": {"op": "click"},
      "expect": {"goal": {"terms": ["Dates"], "roles": ["dialog"], "actionableOnly": false}}
    }
  ],
  "waitMs": 3000,
  "timeoutMs": 20000
}
```

선언한 조건은 AND다. action은 click/fill/press/select/hover이며 필요한 value/key/option을 명시한다. target은 목표 또는 {ref}다. 조회가 유일해도 부분 수집이면 자동 실행하지 않는다. 중간 expect 누락, 모호함, 확인 필요, 결과 불명, 새 세션은 다음 단계를 중지한다. 마지막 단계에서 expect를 생략하면 동작 완료까지만 보고한다.

expect.goal은 현재 유일 후보를 확인하며 갱신 증거가 아니다. expect.exists는 완결된 조회에서 전달 가능한 후보가 한 개 이상 존재하는지 확인한다. introduced도 복수 일치를 허용하되 실제 DOM 동일성을 사용해 이전 일치 대상과 다른 후보가 있어야 한다. 조상 변화로 ref 문자열만 바뀐 것은 새 대상이라고 간주하지 않는다. 존재 검증은 실행 대상의 유일성 검증을 대신하지 않는다. 다음 target은 여전히 새로 찾은 유일 후보 또는 명시한 ref여야 한다. changed={ref}는 같은 지정 DOM 영역의 내용·상태 변화와 aria-busy를 검사하며 분리/교체됐으면 미확인이다. 이 영역의 변경 자체가 업무 성공이라는 뜻은 아니다. fields는 현재 target의 value/checked/selected/expanded/pressed/disabled를 확인한다. url={pathname,includes}는 명시한 항목 모두를 검사한다.

`next.json`은 {expect?,follow?,waitMs?}이며 expect/follow 중 하나는 필요하다. 기존 단일 명령의 `--then-file`에도 같은 조건을 사용한다. 후속 관찰 오류가 원래 실행 결과를 바꾸지 않는다. fields는 ref 대상으로만 지원한다.

기본 `read --want content`는 완결된 정본에서 조작·명시 관계·독립 상태가 없는 `<pre>`를 `kind="code", tag="pre", source="pre-text-v1"` 항목으로 투영한다. 텍스트 조각을 순서대로 연결하며 빈 줄·들여쓰기를 보존한다. 정본/inspect의 조각과 관계는 유지한다. 코드 id는 원래 pre의 조회 ID이므로 `read --target ID`로 범위를 다시 읽을 수 있다. 일부 수집 또는 내부 경계가 있으면 합치지 않는다. query가 적용된 코드의 match.source는 실제 일치 원문 노드의 ID다. 기본 textLimit/byteBudget을 그대로 적용하고 textTruncated/textLength를 남긴다. 작은 명시적 textLimit도 적용하며, 더 큰 한도로 재조회하면 이전 잘림 필드는 unavailableFields로 철회한다.

메뉴가 늦게 뜬다면 `{"expect":{"exists":{"terms":["관찰할 선택지"]}},"follow":{"terms":["관찰할 선택지"]}}`로 조건을 기다린 뒤 조회한다. follow만 지정하면 즉시 읽기다. 마지막 follow의 ambiguous/not_found/incomplete는 조회 결과로 반환하며 완료한 실행을 partial로 낮추지 않는다. 중간 follow의 모호함/불완전성은 다음 행동 전에 중단한다. 검증 finding은 follow가 없을 때도 최상위 finding으로 한 번만 전달한다.

`find --role combobox` 또는 `{"roles":["combobox"]}`는 이름 없는 입력을 포함해 역할로 조회한다. terms와 roles가 모두 없는 목표는 거부한다. 역할만 일치한 match는 field="role"로 표시한다. `find --text-limit N`/goal.textLimit는 기본500자, 상한4000자이며 byteBudget과 함께 적용한다. textTruncated/valueTruncated는 미리보기 잘림이다. 목록 항목·행·article의 owner.text는 최대160자의 같은 조상 원문이며 textTruncated가 있으면 일부다. `run ACTION --session ID`는 기존 저장 액션 실행, `run --input-file task.json --session ID`는 목표 계획 실행으로 구분한다.

RPC: `task.find`는 {sessionId,input:goal,since?,consumer?,repeat?}, `task.run`은 {sessionId,input:task}, 기존 page.click/fill/press/select/hover는 {then:{expect?,follow?,waitMs?}}를 받는다. 요청별 allowHeadedFallback=false는 CLI의 --headless-only와 같다. 실행 중에는 원래 requestId로 request.status를 조회하며 계획을 재전송하지 않는다.
