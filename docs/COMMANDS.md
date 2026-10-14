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
## HWM 0.2 관찰 그래프 (단계 1A)

`webctl snapshot --session ID`는 기존 조작 요소와 본문·소속·관계를 같은 관찰에서 수집해 HWM으로 전달한다. `--format json` 또는 `WEBAGENT_OUTPUT_FORMAT=json`은 스크립트 호환 JSON과 contextGraph를 반환한다. `--context-limit N`은 본문 수집 soft 한도(기본 2000, 하드 최대 6000)다. 선택된 실행 요소와 조상·주변 내용은 한도보다 우선한다. `--limit`은 기존 컨트롤 목록 한도다.

본문과 조작 요소의 조상·순서, 명시적 레이블/폼/ARIA 연결, 검색 `matches`의 일치 필드, 누락 `gaps`를 함께 제공한다. 프레임 내부는 이 단계에서 아직 수집하지 않고 `frame-not-scanned`로 표시한다. 조작 가능한 참조는 기존 요소 참조 계층에서 발급한 것만 연결한다.

기본 형식은 HWM, 기본 투영은 overview다. full/focus/view/expand/inspect는 같은 관찰의 상세 조회이며 별도 브라우징 방식이 아니다. `--save`는 마스킹된 snapshot JSON과 그래프를 저장한다. 관리 명령과 inspect는 기본 JSON을 유지한다.

overview/focus에서 raw box/space는 full/inspect 상세로 옮기고 detail-projection으로 축약을 선언한다. 기본 view(inside/outside/partial)와 layout-boundary는 유지한다. 정본 노드에 actionRef가 없으면 snapshot --query 또는 기존 --role/--name/--label/--within으로 선택할 수 있다. 정본 ID를 --ref로 실행하지 않는다. session open 결과의 세션 키는 id다.

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

click/hover/fill/select/press/batch의 기본 HWM은 보관된 최근 관찰과 조작 후 대상 주변 관찰(limit=24, context-limit=800)을 비교해 @result/@change를 전달한다. 명령은 한 번만 실행한다. 이전 관찰이 없거나 만료되면 no-prior-observation이며 즉각적인 실행 전 상태를 지어내지 않는다. 명시 `--context`는 상세 전후 관찰을 요청한다. `--format json --context`에서는 snapshot.contextGraph와 changes로 같은 근거를 조회한다.

diff의 `--before`에는 `snapshot --context --save`로 저장한 JSON 파일 또는 snapshot/contextGraph를 포함하는 명령 결과 JSON을 넣는다. HWM 텍스트를 입력 파일로 넣는 기능은 아니다. diff는 현재 화면을 읽으며 조작을 실행하지 않는다. 문서 식별이 달라지면 별도 사건으로 남기고 실제 문서 교체 여부는 미확정으로 표시한다.

실제 DOM 동일성을 확인한 필드만 changed/unchanged로 표시한다. 미수집·마스킹·부분 선택·동일성 미확인은 incomparable이며, 부분 관찰에서 누락된 노드를 removed로 판정하지 않는다. 새 탭은 실제 popup 이벤트와 등록된 session ID로 기록한다. 실행 완료와 사용자 과업 성공을 자동으로 같다고 판단하지 않는다.

## HWM 보관·펼침·투영 (단계 4)

```text
webctl snapshot --session ID --format hwm --mode overview --node-budget 120 --text-budget 240
webctl view --session ID --observation OBS --format hwm --mode focus --focus REF
webctl expand --session ID --observation OBS --target NODE_OR_GAP --format hwm
webctl inspect --session ID --observation OBS --target NODE
webctl changes --session ID --comparison CMP --format hwm --change-budget 40
webctl expand --session ID --comparison CMP --target CHANGE_GAP --format hwm
```

OBS는 @hwm 관찰 ID 또는 contextGraph.observation, CMP는 조작/diff 결과의 comparison 또는 HWM 헤더 retention.comparison이다. JSON 명령에서 반환되는 observation도 같은 ID다. 펼침 대상은 노드의 정본 ID, 발급된 actionRef, 또는 @gap의 expand 값이다. inspect는 저장된 정본 노드/원래 조상/연결/누락을 JSON으로 반환한다. view/expand/changes는 --format hwm일 때 HWM, 그 외에는 동일 투영 AST를 JSON의 view로 반환한다.

원시 수집 gap(unobserved/unavailable/redacted)은 저장된 내용 접기가 아니다. `expand`에 원시 gap ID를 넘기면 `observation_gap_not_expandable`이다. `kind=folded`의 실제 `expand` 값만 접힌 내용을 조회하는 핸들이다.

보관 거절 시에는 `retention={ok:false,reason:...}`로 이유를 제공하고, 요청한 overview/focus와 문자열 예산을 유지한다. 저장되지 못한 숨김 내용은 `kind=unavailable`, `collected=true`, 보관 거절 reason, 원래 `omission-reason`을 표시하며 expand 핸들을 제공하지 않는다. 이는 수집하지 않은 내용과도 다르다. 거절 기록은 관찰 수 상한/TTL 안에서만 보관하며 해당 기간의 조회는 `observation_too_large`/`observation_store_full`을 반환한다. 기록까지 만료·퇴출되면 `observation_expired`이고 현재 화면으로 대체하지 않는다.

기존 `list`의 제목·본문 발췌에는 `titleTruncated/textTruncated`, 원문 및 표시 길이(`titleLength/titleShown`, `textLength/textShown`)와 `lengthUnit=unicode-code-point`를 붙인다. 잘린 발췌에 문구가 없다는 이유로 전체 항목에 없다고 판단하지 않는다. 전체 내용을 확인하려면 HWM의 해당 항목을 펼치거나 새 관찰을 요청한다.

명시 full은 수집 범위 전체를 표시한다. overview는 주요 구조와 요소의 항목/문단 맥락을 예산 안에서 선택하고 나머지를 접는다. focus는 대상의 항목/문단/폼 맥락, 원래 조상, 명시 연결의 외부 종점·레이블과 렌더링된 dialog 선언을 보존한다. dialog를 실제 가림 요소라고 단정하지 않는다. 필수 조상·관계 폐쇄로 node-budget을 초과할 수 있으며 projection-budget에 표시한다. 기본 노드 예산은 120, overview/focus 문자열 예산은 Unicode code point 240개다. full은 별도 문자열 예산을 주지 않으면 자르지 않는다. 기본 형식/모드는 HWM/overview다. node-budget을 지정하지 않은 일반 관찰은 선택된 기존 실행 요소와 조상/항목 맥락을 우선 유지한다.

단일 자식의 정보 없는 div/span 래퍼만 뷰에서 축약한다. via에는 원래 조상 ID를 남기며 inspect로 보존된 정보를 읽을 수 있다. 분기·이름·상태·실행·연결·개요·스크롤·gap 경계는 축약하지 않는다. 반복 구조 표시는 observed-tree-shape-v1의 kind/tag/role/속성 이름/자식 구조에 따른 사실이며 내용·값이 같다는 뜻이 아니다. 접은 항목의 원문·상태는 저장 그래프에서 펼친다.

링크 색인은 같은 정규화 URL의 발급 ref를 나열한다. 대표를 선택하거나 실행 대상을 병합하지 않는다. 정규화할 수 없는 href는 raw-href로 표시하고, 마스킹된 URL은 같은 목적지로 묶지 않고 개별 ref와 destination-identity=redacted로 남긴다.

관찰/비교의 조회 유효기간은 저장 시점부터 5분이며 접근으로 연장하지 않는다. 기본 관찰 32개, 비교 32개, 공용 직렬화 예산 16MiB, 단일 항목 2MiB이며 FIFO로 퇴출한다. 프로젝트 계획은 최대 32개/4MiB로 별도 제한한다. 이 수치는 해당 보관 계층의 직렬화 예산으로 전체 Node/Chrome 메모리 한도가 아니다. 만료 데이터는 읽기/쓰기 시 정리한다. 조회 불가 시 observation_expired, comparison_expired 또는 projection_expired이며 현재 브라우저를 재조회하지 않는다. session close는 해당 보관을 지운다. 과거 ref의 실행 유효성과 저장 관찰의 조회 유효기간은 별개다.

@gap scope=nodes에는 원래 roots/order 범위와 누락한 노드/항목 개수가, scope=field에는 필드·잘린 code point 개수가 나온다. expand는 조회 가능한 gap ID다. scope=changes에는 보유 변화 목록의 완결성과 이전/이후 관찰 완결성을 따로 표시하며, 원래 비교의 변화 ID 범위를 보관한다. 부분 관찰의 누락을 실제 삭제로 바꾸지 않는다. 만료·퇴출 후에는 옛 관찰을 새 화면으로 대체하지 않는다.
