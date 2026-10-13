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

현재 스냅샷 참조가 있으면 아래 locator 대신 `--ref @e27`을 사용할 수 있습니다. ref는 locator·`--nth`·`--within`·`--all`과 함께 쓰지 않습니다.

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
webctl click --session ID --ref @e27 [--confirm] [--observe] [--verbose]
webctl hover --session ID --ref @e27
webctl fill --session ID --ref @e28 --value TEXT
webctl select --session ID --ref @e29 --option TEXT
webctl press --session ID --ref @e28 --key Enter [--confirm]
webctl extract --session ID --ref @e28 [--read text|value|attribute] [--attribute NAME]
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
