# Haiku 실사용 시험 — 보완점 기록

- 시작: 2026-10-13 · 브랜치 `feat/booster-lessons` (미커밋 코드로 실행)
- 방식: dom-booster `docs/all-experiments-catalog.md`의 실사이트 과제를 Haiku 서브에이전트가 hyper-browsing
  스킬로 1회씩 수행(헤드리스, 격리 프로필). 비교 실험이 아니다. 세션 기록을 읽고 "더 빠르고, 정확하고,
  효율적이려면 스킬·스크립트에서 무엇을 바꾸면 되는가"를 기록한다.
- 원칙: 특정 사이트용 해법 금지. 원인을 일반화하고 일반 해법만 제안한다.
- 과제 목록: 카탈로그 #3~#38 중 중복 통합(Newegg 5/37, GitHub 11/38, Airbnb 4/6) → 33개. 로컬 합성 픽스처(#1, #2) 제외.

## 과제별 결과

| # | 과제 | 결과 | 명령 수 | 시간 | 주요 막힘 |
|---|---|---|---|---|---|
| T01 | httpbin 폼 채우기 | 성공 | webctl 12 (Bash 9) | 26초 | 없음. 확인을 위해 forms 재호출 |
| T03 | Newegg SAMSUNG+2TB | 부분(2TB 실패) | webctl 26 (eval 6) | 105초 | 2TB가 hover로 열렸는데도 clipped 판정으로 클릭 거부 |
| T04 | DemoQA 폼 | 성공 | webctl 13 | 30초 | 없음. fill 값 확인에 forms 재호출 |
| T05 | Selenium 웹 폼 | 부분(비밀번호 확인 불가) | webctl 16 | 30초 | select 선택 명령 없음, 틀린 실패 이유 |
| T07 | Wikipedia 서울 → 한국어 | 성공 | webctl 9 | 24초 | 같은 링크 2개(추천·전체 목록)로 모호성 거부 1회 |
| T06 | Wikipedia 고급 검색(Help+Wikipedia) | 실패 | webctl 36 | 166초 | 라벨 부분일치로 "Not these words"에 입력, 지우기 실패 |
| T08 | GitHub 고급 검색 | 성공(eval 5회) | webctl 23 | 69초 | select 명령 없음, 숨은 칸을 목록에서 못 봄, 헤더·폼 Search 버튼 모호 |
| T10 | Yahoo Finance 5Y·Weekly | 성공 | webctl 16 | 56초 | 첫 --query가 빈 결과, role=option 클릭이 숨은 요소로 10초 낭비 |
| T09 | Craigslist 자전거·가격·사진 | 성공 | webctl 22 | 83초 | 열린 패널이 다른 버튼을 덮음, 버튼 이름이 행동 뒤 바뀜, 이동 직후 빈 snapshot |
| T11 | HN Algolia 정렬·기간 | 성공 | webctl 18 | 48초 | effect가 SPA 갱신 전에 측정돼 urlChanged:false, 결과 수를 간접 추론 |
| T12 | IKEA 색상 Black | 성공 | webctl 10 | 36초 | --label 클릭이 이유 없이 timeout(role 지정은 성공) |
| T13 | Gutenberg 제목순 정렬 | 성공 | webctl 7 | 18초 | --query "sort"가 정렬 버튼("Popularity ▼")을 못 찾음, 메뉴 열림이 effect에 안 보임 |
| T14 | Open Library 읽기 가능 필터 | 성공 | webctl 13 | 40초 | 필터 토글이 snapshot에 없음(스크린샷으로 발견), 한국어 UI로 영어 검색어 불일치 |
| T15 | arXiv 고급 검색 cs | 성공 | webctl 11 | 36초 | Search 버튼 2개에 맥락 없음, 결과 목록 읽기가 모호성 |
| T17 | Hugging Face Text Generation + qwen | 성공 | webctl 17 | 40초 | 필터가 닫힌 대화상자 안이라 --query로 못 찾음, 대화상자 열림이 effect에 안 보임 |
| T16 | Steam 태그 Singleplayer | 성공(eval DOM 클릭) | webctl 23 (eval 6) | 99초 | 보이는 태그인데 role/text 지정이 숨은 요소만 잡아 not_visible 반복, clipped 힌트가 막힌 동작 안내 |
| T18 | MDN Fetch API | 성공 | webctl 11 | 29초 | 결과 목록이 shadow DOM 안이라 snapshot에 없음(스크린샷으로 발견) |
| T20 | Python 문서 asyncio | 성공 | webctl 6 | 18초 | 제목·요약 링크가 같은 주소로 모호성 1회(F21) |
| T19 | Internet Archive texts | 실패 | webctl 15 (eval 2) | 44초 | snapshot 0개·body 텍스트 0 → 에이전트는 "렌더 안 됨"으로 판단. 앱 전체가 shadow DOM 안(추정, F41) |
| T21 | Stack Overflow 필터 | 실패(Cloudflare 차단) | webctl 15 | 43초 | 필터 적용 후 봇 확인 화면. 스킬이 차단을 알리지 않음 |
| T22 | GitLab 정렬 | 실패(503) | webctl 9 | 51초 | 시작 페이지 503. 장애/차단 구분 불가, 상태 코드 미제공 |
| T23 | Kaggle 검색·Most Votes | 성공 | webctl 13 | 30초 | press의 effect가 URL 변화를 놓침(F33), 결과 영역이 한 덩어리 name(F06) |
| T24 | MIT OCW quantum·Physics | 성공 | webctl 15 | 46초 | 아이콘 글꼴 글자가 이름에 섞여 role 지정 실패, --label Physics가 카드 3개와 모호 |
| T25 | W3Schools <input> | 성공 | webctl 6 | 24초 | 없음. 이동 후 제목 확인에 snapshot 1회 |
| T26 | Arch 패키지 nginx·Extra·x86_64 | 성공 | webctl 17 | 50초 | select 명령 없음(F16)으로 클릭·화살표 키 우회, select name이 옵션 전체(F20) |
| T27 | Docker Hub Official Image | 실패 | webctl 12 (eval 3) | 43초 | 창 너비 ~764px로 사이트가 모바일 배치 → 필터 사이드바가 닫힌 서랍 안 |
| T28 | Commons galaxy → Video | 성공 | webctl 11 | 29초 | 없음. snapshot에 같은 정보가 headings·elements·tabpanel로 3번 반복 |
| T29 | Can I Use grid | 부분(비율 못 읽음) | webctl ~30 (eval 15) | 91초 | 검색 결과·기능 페이지 내용이 snapshot·eval에 안 보임. wait-for(Playwright)는 텍스트를 찾음 → shadow DOM(F41) |
| T30 | crates.io async·All-Time Downloads | 성공 | webctl 19 | 59초 | snapshot에 암묵적 역할이 없어 --role searchbox 실패, 첫 결과 확인에 snapshot 3회 |
| T31 | crates.io serde_json Repository | 성공 | webctl 14 | 34초 | --query가 context를 검색하지 않아 2회 조회, 후보 context로 nth 6 선택 |
| T32 | Wikivoyage → Deutsch | 성공 | webctl 8 | 21초 | 메뉴 연 클릭이 observed:false라 snapshot 1회 추가(F05/F40) |
| T33 | USPS 주소 폼 | 성공(State는 eval) | webctl 20 (eval 6) | 47초 | select 명령 없음(F16): fill 실패, 키 입력 무효, eval로 설정 |
| T02 | Airbnb 서울·날짜·인원 검색 | 성공 | webctl 35 | 89초 | wait-idle 9회(회당 ~3.5초), 클릭 효과 미관찰, --query 무력 |

## 보완점 (일반화, 누적)

형식: **ID — 문제 (관찰된 과제)** → 일반 원인 → 제안 해법 · 우선순위

- **F01 — 행동 응답마다 긴 `learning` 블록 (T01)** → fill/click 응답이 siteDir, journal 경로, requiredNextStep 문장을
  매번 반복해 토큰을 쓰고 핵심(성공 여부)을 가린다 → 행동 응답에는 `learning_pending: true` 한 줄만, 상세는
  `learning status`에서 · 중
- **F02 — fill이 결과값을 돌려주지 않음 (T01)** → 입력이 실제로 들어갔는지 보려면 forms/snapshot을 한 번 더 불러야
  한다 → fill 응답에 입력 후 값(비밀 칸은 [HIDDEN])과 일치 여부 `matches: true`를 넣는다 · 상
- **F03 — 명령별 소요 시간이 안 보임 (T01)** → click 3회에 7초(회당 약 2초), fill 3회는 1초. 어디서 느린지 에이전트도
  우리도 알 수 없다 → 모든 응답에 `durationMs` 포함, 느린 단계 원인 측정 · 중
- **F04 — 방문만 해도 `sites/<host>/` 빈 템플릿 생성 (T01)** → learning 이벤트가 사이트 폴더를 즉시 만든다(T01에서
  sites/httpbin 생성). 저장소가 시험 방문으로 오염된다 → 실제로 지식을 기록할 때 폴더를 만들고, 그 전에는
  `.runtime`에만 기록 · 중
- **F05 — 클릭 효과가 대상 밖에서 일어나면 `observed:false` (T02)** → 추천 항목 클릭은 입력칸 값을, 날짜 클릭은 달력·
  요약 문구를, 인원 +버튼은 옆 숫자를 바꾼다. effect는 대상 자신과 URL만 본다 → effect에 페이지 단위 변화 요약 추가:
  입력·select 값 변화, checked/expanded/selected/pressed 변화, 열리고 닫힌 dialog, 상호작용 요소 수 증감(최대 5개) · 상
- **F06 — 컨테이너의 name이 하위 전체 텍스트라 `--query`가 무력 (T02)** → role이 있는 컨테이너(dialog, group,
  listbox 등)의 name을 innerText 전체로 잡아 거의 모든 질의에 걸리고 출력이 커진다 → 다른 후보를 품은 요소는
  aria-label만 name으로 쓰고, 그 외 name은 100자로 자르기. 질의는 자기 이름 기준 · 상
- **F07 — wait-idle이 매번 ~3.5초 (T02)** → networkidle(최대 3초)을 먼저 기다리는데 광고·추적이 계속 도는 사이트는
  거의 항상 상한까지 간다. T02에서 9회 ≈ 30초(전체의 1/3) → DOM 변화 정지를 기준으로 하고 network는 짧게(≤1초),
  또 click/fill 뒤에 짧은 안정화를 내장해 별도 wait-idle 필요를 줄이기 · 상
- **F08 — `extract`가 추적 중인 사이트 자산을 자동 수정 (T02)** → "읽기는 안전하니 즉시 기록" 설계 때문에
  sites/airbnb/site.yaml에 testid 기반 액션이 자동 추가됨(시험 방문이 저장소를 바꿈) → 자동 기록은 `.runtime`에
  모아 두고, 에이전트가 명시적으로 확정할 때만 sites/에 반영 (F04와 같은 뿌리) · 상
- **F09 — "첫 번째 항목 읽기"도 모호성 거부 (T02)** → 목록 읽기는 여러 값이 정상인데 extract가 ambiguous로 끝난다
  (후보 목록에 답이 있었지만 값이 아닌 이름) → `extract --all`(최대 20개 값 배열) 추가, 모호성 응답의 후보에도
  읽은 값을 담기 · 중
- **F10 — `identify`가 알려진 사이트의 액션을 설명하지 않음 (T02)** → "known: airbnb"만 알려줘 에이전트가 액션을
  쓸지 판단 못 함 → identify 응답에 액션 id·한 줄 설명·입력 목록 요약 포함 · 하
- **F11 — `clipped` 오탐으로 열린 하위 메뉴 클릭을 거부 (T03)** → 내 구현이 도형(조상 overflow 교차)만 보고 판정.
  hover로 하위 목록이 열려 2TB가 실제로 보이는데도 계속 거부 → 화면 안이면 대상 중심의 hit-test(elementFromPoint가
  대상이나 그 자손)를 우선하고, hit-test가 실패할 때만 clipped로 거부. 화면 밖이면 먼저 스크롤 후 판정 · 최상
- **F12 — 섹션 머리글 클릭이 접기였는데 알 수 없음 (T03)** → "Capacity" 클릭이 섹션을 접었지만 effect는 observed:false
  → F05의 페이지 단위 변화 요약에 "새로 숨겨진/드러난 상호작용 요소 수"를 포함 · 상
- **F13 — 클릭 가능한 span(SHOW MORE 등)이 snapshot에 없음 (T03)** → 후보가 a/button/input/[role] 뿐이라 cursor:pointer
  span 컨트롤을 못 찾고 eval로 갔다 → `--query`가 있으면 일반 텍스트 일치도 찾아, 그 텍스트의 가장 가까운
  클릭 가능 조상(cursor:pointer, tabindex, onclick)을 `textHits`로 돌려주기 · 상
- **F14 — `--query` 결과가 문서 순서라 핵심이 밀려남 (T03)** → "2TB"로 찾으면 상품 링크(이름에 2TB 포함)가 먼저 나오고
  필터 label은 상한 뒤로 → 정확히 같은 이름 > 앞부분 일치 > 포함 순으로 정렬 · 중
- **F15 — 이미지 링크의 name이 비어 href만 보임 (T03)** → innerText는 img alt를 포함하지 않는다 → name이 없으면
  내부 img alt, title, aria-labelledby 순으로 채우기 · 중
- **F16 — `<select>` 옵션 선택 명령이 없음 (T05)** → 선언형 러너엔 selectOption이 있지만 에이전트 CLI엔 없다. fill은
  select에서 실패하고 화살표 키로 우회(명령 5개) → `webctl select <locator> --option "Two"`(텍스트·값으로) 추가, fill이
  select를 만나면 같은 동작으로 위임 · 최상
- (F16 재확인 T08·T26: select 선택에 5~6회 소모. 이번 시험에서 가장 자주 나온 비용)
- **F17 — 실패 이유 분류 오류 (T05)** → "Element is not an <input>" 오류가 not_visible로 분류돼 잘못된 힌트("숨겨져
  있다")를 줬다(재시도 대기 문구의 "to be visible"에 걸림) → 요소 종류 오류를 먼저 `wrong_element`로 분류하고
  알맞은 명령(select 등)을 안내 · 상
- **F18 — 비밀 칸은 입력 확인 수단이 없음 (T05)** → forms가 [HIDDEN]으로만 보여 줘 맞게 들어갔는지 모른다 →
  fill 응답에 값 노출 없이 `matches: true`와 길이를 돌려주기 (F02와 함께) · 중
- **F19 — forms가 커스텀 콤보박스(React-select 등)를 모름 (T04)** → `input/select/textarea`만 봐서 role=combobox
  위젯과 그 표시값이 빠진다 → `[role=combobox]`, `[aria-haspopup=listbox]`를 필드로 포함하고 보이는 선택값 표시 · 중
- **F20 — select의 name·label이 옵션 전체 텍스트 (T05)** → snapshot이 select name을 innerText(모든 옵션 이어붙임)로,
  label을 감싸는 label 전체 텍스트(옵션 포함)로 잡는다. effect의 value도 option 값("1")만 보임 → select는 name을
  label 자신의 텍스트(컨트롤 텍스트 제외)·aria-label로, 상태는 선택된 옵션 텍스트로. 감싸는 label 텍스트에서
  안쪽 컨트롤 텍스트를 빼는 것은 모든 입력에 적용 · 상
- **F21 — 같은 목적지 링크 중복도 모호성으로 거부 (T07)** → "한국어" 링크가 추천 목록과 전체 목록에 같은 href로 2개
  있어 거부됐고 에이전트는 임의로 nth 0을 골랐다 → 후보가 모두 같은 href(또는 같은 form·같은 동작)를 가리키면
  동등한 것으로 보고 첫 번째를 실행, 응답에 `equivalentMatches: N` 표시 · 상
- **F22 — 맥락으로 고를 수단이 nth뿐 (T07)** → candidates에 `context`가 있어도 다시 지정하려면 순번을 써야 한다 →
  `--within "<제목/구역 이름>"` 추가(해당 제목을 가진 가장 가까운 컨테이너로 범위 축소) · 중
- (T07 긍정) `transparent: true` 표시가 Wikipedia 언어 버튼(투명 input)을 바로 찾게 해 줬다. 9회·24초로 끝남.
- **F23 — 모호성 후보에 입력칸의 label이 없음 (T06)** → 후보 설명이 aria-label·innerText만 써서 input 3개가
  `{tag:"input"}`로만 나왔다. 에이전트가 nth 1을 찍어 "Not these words"에 입력 → 후보마다 label/placeholder/name
  속성/현재 값을 담기 · 최상
- (F23 보강, T20) 후보에 href도 넣어야 같은 이름 링크 중 목적지로 고를 수 있다.
- **F24 — 부분일치 이름이 여럿일 때 정확 일치를 우선하지 않음 (T06, T08)** → `--label "These words"`가 "Not these
  words", "One of these words"에도 걸린다. Playwright 기본이 부분일치라서 → 여러 개가 걸리고 그중 정확히 같은
  이름(대소문자·공백 무시)이 하나면 그것을 자동 선택하고 `resolvedBy: "exact"` 표시 · 최상
- **F25 — 0개 일치는 5초 대기 후 "timeout"만 (T06, T08)** → `--role button --name "Advanced options"`처럼 역할이 틀리면
  아무것도 안 걸리는데 이유를 모른다 → 0개면 즉시 `no_match`와 함께 이름이 비슷한 요소 5개(역할 무시, 태그·역할
  표시)를 제안 · 상
- **F26 — snapshot에 입력값이 없음 (T06)** → 칸에 무엇이 들어 있는지 볼 수 없어 이전 실수가 남은 걸 몰랐다 →
  텍스트 입력의 현재 값(비밀 칸 제외, 60자)을 `value`로 표시 · 상
- **F27 — 숨겨진 일치 요소는 목록에서 아예 사라짐 (T08)** → 접힌 섹션 안의 select가 snapshot에 없어 "있는데 숨었는지"
  "없는지" 구분 불가 → `--query` 사용 시 숨은 일치 요소도 `hidden: true`로(최대 10개) 보여 주고 가장 가까운
  펼치기 컨트롤(aria-expanded=false, summary 등)을 함께 제시 · 상
- **F28 — fill이 값을 못 바꿔도 ok (T06)** → 태그형 입력(칩)에서 `fill --value ""`가 ok였지만 값이 남았다 → F02의 읽기
  확인으로 불일치 시 `ok:false, reason: "value_mismatch"`와 실제 값 반환 · 상
- **F29 — 숨은 일치만 있으면 10초 낭비 후 실패 (T10)** → `--role option --name Weekly`가 숨은 option만 맞아, 보이길
  5초 기다리고 다시 클릭 5초 시간초과. 같은 글자의 보이는 요소는 다른 역할이었다 → 보이는 일치가 0이고 숨은
  일치만 있으면 대기 없이 `reason: "hidden_only"`, 숨은 개수, 같은 이름의 보이는 요소(역할 무시)를 즉시 반환 · 상
- (F06 재확인, T10) 페이지 래퍼 div가 name으로 페이지 전체 텍스트를 가져 `--query`마다 걸리고 출력이 커진다.
- **F30 — 페이지 이동 직후 snapshot이 비어 있음 (T09)** → 링크 클릭 effect는 urlChanged:true인데 바로 찍은 snapshot은
  elements []. 렌더링 전이라 에이전트가 wait-idle을 추가 → urlChanged가 일어난 행동은 응답 전에 load 이벤트 +
  짧은 DOM 안정화를 기다리고, snapshot도 요소가 0이면 잠깐 기다렸다 다시 찍기 · 상
- **F31 — 가로막는 요소가 "열린 패널의 바깥 덮개"인지 알려주지 않음 (T09)** → interceptedBy가 `cl-clickable-scrim`
  이었지만 "열려 있는 다른 패널을 먼저 닫거나 적용하라"는 뜻을 에이전트가 추론해야 했다 → 가로막는 요소가 화면
  대부분을 덮는 투명·반투명 덮개면 `reason: "blocked_by_open_panel"`과 함께 열린 dialog/패널 이름, Escape 힌트 · 중
- **F32 — 행동 뒤 버튼 이름이 바뀌어 다음 지정이 빗나감 (T09)** → 가격 적용 뒤 "+"가 "₩10-500"으로 바뀌는 식.
  F05의 페이지 단위 변화 요약에 "이름이 바뀐 요소(전→후)"를 포함 · 중
- **F33 — effect를 너무 일찍 측정 (T11)** → 클릭 후 250ms 고정 대기라, 약 0.5초 뒤 URL을 바꾸는 SPA에서 urlChanged:false가
  나오고 에이전트가 wait-idle + snapshot을 더 부른다 → 고정 대기 대신 "DOM 변화가 300ms 멈출 때까지, 최대
  1.5초" 기다린 뒤 측정 (F07, F30과 같은 안정화 함수 공유) · 상
- **F34 — 상호작용 요소가 아닌 텍스트(결과 수 등)를 찾을 수단이 없음 (T11, T13 예상)** → "N results" 같은 상태
  문구는 snapshot 대상이 아니어서 다른 단어로 간접 추론 → `find-text "<문자열>"` 명령(보이는 텍스트 노드 검색,
  주변 문맥·가장 가까운 제목·가장 가까운 클릭 가능 조상 반환). F13의 textHits와 같은 구현 · 상
- **F35 — "timeout"만으로는 원인을 알 수 없음 (T12, T06, T08)** → `--label "Black 489"`가 투명 input을 잡고 12초 뒤
  timeout. Playwright 호출 로그(불안정·가려짐·화면 밖 등)는 버려졌다 → 오류에 Playwright 호출 로그의 마지막
  2~3줄을 `log`로 포함하고, "not stable", "receives events" 등도 분류 · 상
- **F36 — dismiss-annoyances 보고에 이미 닫힌 모달이 잔뜩 (T12)** → `--close` 상태의 숨은 래퍼 12개가 overlays에 나열돼
  잡음 → 화면 면적 0, opacity 0, pointer-events:none, visibility hidden인 것은 보고에서 제외 · 하
- **F37 — 컨트롤 앞의 안내 문구("Sort by:")가 이름에 없음 (T13, T10)** → 버튼 이름이 현재값("Popularity ▼",
  "Daily")뿐이라 기능 단어(sort, frequency)로 찾을 수 없다 → 같은 컨테이너에서 바로 앞에 있는 짧은 텍스트(콜론으로
  끝나거나 30자 이하)를 `hint`로 붙이고 `--query`가 이것도 검색. aria-haspopup이면 `popup: "menu|listbox"` 표시 · 중
- (F05 재확인, T13) 메뉴를 연 클릭이 observed:false. 새로 나타난 menu/listbox/dialog를 effect에 표시해야 한다.
- **F38 — 브라우저 언어가 한국어라 영어 과제와 UI가 어긋남 (T14, T02)** → 데몬 Chrome의 Accept-Language가 ko라
  Open Library는 한국어 UI, Airbnb는 .co.kr로 이동. 영어 단어로 `--query` 하면 못 찾는다 → 데몬/세션 단위
  `--locale`(Accept-Language·navigator.language) 설정 지원, 기본값은 환경변수로 · 중
- (F13·F34 재확인, T14) 클릭 가능한 토글(a/span)이 snapshot에 없어 에이전트가 스크린샷을 보고 텍스트로 클릭했다.
- **F39 — 후보 맥락이 제목뿐이라 "어느 폼의 버튼"인지 모름 (T15, T08)** → 헤더 검색 버튼과 고급 검색 폼 버튼이
  같은 이름. 제목이 없는 쪽은 context가 비었다 → context를 단계적으로: 고유 제목 → 소속 form(aria-label, legend,
  id·name) → 랜드마크(header/nav/main/footer/dialog 이름) · 상
- (F09 재확인, T15) 결과 목록 첫 항목 읽기가 ambiguous 50개로 끝남 → `extract --all`/`--first` 필요.
- **F40 — 열린 dialog·menu·listbox를 snapshot이 따로 알려주지 않음 (T17, T13, T09)** → 열려 있는지 headings로만
  추론했다 → snapshot 최상위에 `open: [{role, name}]`(보이는 dialog/menu/listbox/aria-modal)를 두고, 열린 dialog가
  있으면 그 안 요소를 먼저 나열 · 상
- (F27·F05·F14 재확인, T17) 닫힌 패널 안 필터는 --query에 안 걸림, 대화상자 연 클릭이 observed:false, 결과 카드가
  --query 결과를 덮음.
- **F41 — snapshot·forms·dismiss가 shadow DOM과 iframe 안을 못 봄 (T18)** → document.querySelectorAll만 써서 웹
  컴포넌트(MDN 검색 결과) 안 요소가 통째로 빠짐. 클릭은 Playwright가 shadow를 뚫어 성공했다(보는 것과 하는 것이
  불일치) → 열린 shadow root를 재귀 탐색, 같은 출처 iframe도 포함(요소에 `frame` 표시). dom-booster L6 교훈 · 최상
- (F41 재확인, T19·T29) Internet Archive와 Can I Use도 내용이 shadow DOM 안이라 snapshot·light-DOM eval이 비어 보였다.
  에이전트는 "렌더 안 됨"으로 오판했다. 이번 시험 실패·부분 사례 중 3건(T18 우회, T19, T29)의 공통 원인.
- **F42 — 같은 글자의 다른 요소를 안내하지 않음 (T16)** → `--role button --name Singleplayer`, `--text Singleplayer`가
  숨은 사본만 잡아 5초씩 4번 not_visible. 보이는 진짜 태그(span)는 그 이름의 버튼이 아니었다 → F29의 hidden_only
  응답에 "같은 글자를 가진 보이는 요소" 목록(태그·역할·바로 쓸 수 있는 지정자)을 포함 · 상
- **F43 — clipped 힌트가 "hover"만 안내 (T16)** → 대상이 스크롤 가능한 박스(max-height + overflow)에 가려진 경우엔
  hover가 아니라 박스 스크롤이 답 → 잘림을 만든 조상이 스크롤 가능(scrollHeight > clientHeight)하면
  `reason: "scroll_container"`로 구분하고 자동으로 scrollIntoView 후 재판정 · 상
- **F44 — "요소 0개"의 이유를 알려주지 않음 (T19, T18, T09)** → 렌더 전인지, shadow DOM 안인지, 필터에 안 걸린
  것인지 구분 불가. 에이전트가 eval로 light DOM만 보고 "빈 페이지"로 오판 → 0개일 때 진단 필드: shadow host 수,
  iframe 수, body 텍스트 길이, readyState, 직전 urlChanged 여부 · 상
- **F45 — 봇 확인 화면을 알려주지 않음 (T21)** → Cloudflare 확인 화면에서도 click은 성공, snapshot은 평범한 페이지처럼
  보였다. 에이전트가 3번 더 확인한 뒤에야 알아챔 → 모든 행동·snapshot 응답에서 확인 화면 표지(제목 "Just a
  moment"류, URL `__cf_chl`, challenge iframe, 알려진 확인 문구)를 감지해 `blocked: {kind, hint}`를 붙이고
  `browser reveal`(사람 처리) 안내 · 중
- **F46 — 이동 결과에 HTTP 상태가 없음 (T22)** → session open/goto가 id·url·title만 돌려줘 503을 제목으로만 알았다 →
  주 문서 응답의 status, 최종 URL(리다이렉트 포함)을 넣고, 4xx/5xx·확인 화면이면 `pageProblem` 표시 · 중
- **F47 — 결과 목록을 항목 단위로 읽을 수단이 없음 (T23, T15, T02, T08)** → 첫 결과 제목을 얻으려 거대한 name이나
  모호성 후보 목록을 뒤져야 했다 → `list` 명령: 반복되는 같은 구조의 형제(카드·행·li) 묶음을 찾아 항목마다
  {제목(첫 링크/제목 텍스트), href, 짧은 부가 텍스트}를 N개 반환. `--query`로 묶음 선택 · 상
- **F48 — 아이콘 글꼴 글자가 이름에 섞임 (T24)** → "Filter arrow_drop_down"처럼 Material Icons 합자 텍스트가 name에
  들어가 그 이름으로 지정하면 실패 → name 계산에서 아이콘 글꼴(font-family에 Icons/Symbols, aria-hidden 아이콘
  요소) 텍스트 제외. 0개 일치 시 F25 제안에 정규화 이름 일치도 포함 · 중
- (F24 재확인, T24) `--label Physics`가 체크박스 1 + 카드 3에 걸림. 정확 일치 우선이면 바로 해결.
- **F49 — 이동한 클릭의 결과에 새 페이지 제목·h1이 없음 (T25, T18, T20)** → urlChanged:true 뒤 거의 항상 snapshot을
  한 번 더 불러 제목을 확인 → effect에 urlChanged면 새 title과 첫 h1을 포함 · 중
- **F50 — 헤드리스 창이 좁아 모바일 배치로 바뀜 (T27)** → 뷰포트가 약 764px라 데스크톱 사이드바(필터)가 서랍으로
  숨었다. 에이전트는 토글을 못 찾고 실패 → 기본 뷰포트를 데스크톱 크기(예: 1440×900)로, 세션/데몬 단위
  `--viewport` 설정 지원. snapshot에 viewport 크기 표시 · 최상
- (F27 재확인, T27) 숨은 일치(닫힌 서랍 속 "Docker Official Image")를 snapshot이 알려주지 않음.
- **F51 — 검색어 입력과 제출이 항상 2회 (T28, T15, T23, T24, T11)** → fill 후 같은 지정자로 press Enter를 매번 반복 →
  `fill ... --submit`(입력 후 Enter, 이동·결과 effect 포함) · 하
- **F52 — snapshot에 암묵적 역할이 없음 (T30, T24)** → role 속성이 있을 때만 role을 보여줘서, 검색창(input
  type=search → searchbox), 체크박스, 링크 등을 어떤 `--role`로 지정해야 할지 모른다 → 태그·type에서 계산한 암묵적
  역할을 role로 표시(명시 role이 있으면 그것) · 상
- **F53 — `--query`가 context(소속 카드 제목)를 검색하지 않음 (T31)** → "serde_json"으로 찾으면 그 카드의 Repository
  링크는 안 나온다 → context를 먼저 계산하고 질의에 포함. `--within`(F22)과 함께 쓰면 카드 단위 선택이 한 번에 · 중
- **F54 — 빈 자동 템플릿 때문에 identify가 "known"인데 액션 0개 (T31)** → 이전 방문이 만든 sites/crates 빈 템플릿이
  "알려진 사이트"로 잡혀 에이전트를 헷갈리게 함 (F04·F08과 같은 뿌리) → 액션·지식이 없는 사이트는 known:false ·
  상(F04와 함께)

## 스킬 외 문제

- T21 Stack Overflow: 헤드리스에서 Cloudflare 봇 확인(필터 적용 직후). 사이트 정책.
- T22 GitLab: explore 페이지가 503 (재시도 2회 동일). 장애인지 헤드리스 차단인지 미확인. (사이트 차단, 과제 자체 문제 등)


## 집계 (33개)

- 성공 25 (그중 eval 우회 3: T08, T16, T33) · 부분 3 (T03, T05, T29) · 실패 5 (T06, T19, T27 + 사이트 문제 T21 차단, T22 503)
- 가장 큰 비용: select 선택 명령 없음(T05·T08·T26·T33), shadow DOM 미탐색(T18·T19·T29), 좁은 창(T27),
  모호성·0개 일치의 정보 부족(T06·T16·T10), 대상 밖 변화를 못 보는 effect(T02·T11·T13·T17·T32).
- 시험 부산물: 데몬이 방문한 사이트마다 `sites/<host>/` 템플릿 생성(31개), extract가 추적 중인 sites/airbnb 수정.
  시험 후 모두 삭제·원복함.

## 수정 계획 (보완점 → 작업 묶음)

모두 일반 규칙. 사이트 이름·고유 class 사용 금지.

| 묶음 | 내용 | 보완점 |
|---|---|---|
| W1 보기: shadow DOM | snapshot·forms·list·변화 감지가 열린 shadow root를 재귀 탐색. 요소 0개면 진단(shadow host 수, iframe 수, body 텍스트 길이, readyState) | F41, F44 |
| W2 보기: 이름·역할·값 | 다른 컨트롤을 품은 컨테이너는 aria 이름만; 감싸는 label에서 컨트롤 텍스트 제외(select 등); 아이콘 글꼴·aria-hidden 텍스트 제외; img alt·svg title 대체; 암묵적 역할 표시; 앞 안내 문구 `hint`; 텍스트 입력의 `value`; `popup` | F06, F15, F20, F26, F37, F48, F52 |
| W3 보기: 질의 | 정확 일치 > 앞부분 > 포함 순 정렬; 반복 링크의 소속 제목(context)도 검색; 숨은 일치 `hidden`(펼칠 컨트롤 제시); 상호작용 요소가 아닌 텍스트 일치 `textHits`(가장 가까운 클릭 가능 조상); 열린 dialog/menu `open`; viewport 표시 | F13, F14, F27, F34, F40, F53 |
| W4 지정 해석 | 여러 개면 정확 일치 하나를 자동 선택; 모두 같은 href면 동등 처리; 후보에 label·placeholder·href·value; context를 제목→form→랜드마크로; `--within`; 보이는 일치 0이면 숨은 일치만인지 즉시 판별하고 같은 글자의 보이는 요소 제안; 0개면 비슷한 이름 제안 | F21, F22, F23, F24, F25, F29, F39, F42 |
| W5 조작 신뢰성 | clipped 판정에 hit-test 우선, 스크롤 컨테이너는 자동 스크롤 후 재판정; 오류 분류(요소 종류 오류, 불안정 등)와 Playwright 로그 2~3줄; 덮개가 막으면 `blocked_by_overlay` | F11, F17, F31, F35, F43 |
| W6 새 명령 | `select <locator> --option`(네이티브·커스텀 콤보박스), fill이 select면 위임; fill 결과 값 읽기·불일치 실패(비밀 칸은 일치 여부만); `fill --submit`; `extract --all`; `list`(반복 항목 읽기) | F02, F09, F16, F18, F28, F47, F51 |
| W7 안정화와 effect | 공용 안정화(DOM 300ms 정지, 최대 1.5초; 이동 시 load 대기); wait-idle은 network 1초 상한 후 DOM 기준; effect에 페이지 단위 변화(입력값·상태 변화, 열리고 닫힌 dialog/menu, 상호작용 요소 수 증감), 이동 시 새 title·h1·HTTP status; 봇 확인 화면 감지 `blocked` | F05, F07, F12, F30, F32, F33, F45, F46, F49 |
| W8 학습 부산물 | 행동 응답의 learning 블록을 `learning_pending` 한 줄로; 방문만으로 sites/ 폴더 생성 금지(.runtime 기록만); extract 자동 기록은 `--learn`일 때만; 액션 없는 사이트는 identify에서 known:false 취급, identify에 액션 요약 | F01, F04, F08, F10, F54 |
| W9 브라우저 환경 | 헤드리스 창 기본 1440×900(`WEBAGENT_WINDOW_SIZE`), `session open --viewport`, `--locale`(Accept-Language) | F38, F50 |
| W10 잡음·계측 | dismiss 보고에서 안 보이는 덮개 제외; 모든 응답에 `durationMs` | F03, F36 |

검증: `npx tsc --noEmit`, `tests/discovery-lessons.mjs`에 새 사례(shadow DOM, 정확 일치 우선, 같은 href, select 명령,
fill 읽기, clipped hit-test, effect 페이지 변화, list) 추가 후 실행. Haiku 재시험은 사용자 요청 시.

## 재시험 (수정 후, 실패·부분 과제만, 같은 프롬프트·조건)

| # | 이전 | 재시험 | 메모 |
|---|---|---|---|
| T19 Internet Archive | 실패 | 실패 | 이번엔 snapshot이 shadow root 455개를 탐색(진단 정상). 그러나 필터 패널 `collection-facets`의 shadow 내용이 빈 `<slot>` 하나, 크기 0 — 헤드리스에서 필터 데이터가 그려지지 않음(직접 확인). 스킬로 고를 대상이 없음 → 사이트 측 |
| T06 Wikipedia 고급 검색 | 실패 | 성공 (webctl 39, 157초) | 정확 일치·suggestions·list가 도움. 남은 비용: 헤더 검색창 Enter가 제목 일치 문서로 이동(사이트 동작), back 1회 ~10초, 펼칠 때 역할이 searchbox→combobox로 바뀌어 no_match 2회, 체크 상태가 back 뒤 되살아남(bfcache 폼 복원) |
| T21 Stack Overflow | 실패(차단) | 실패(차단) | 필터 값은 fill/click 응답으로 바로 확인(valueMatches, stateChanges). Apply 클릭 effect가 status 429·`blocked: bot-challenge`를 알려 즉시 중단(webctl 15, 43초). 차단은 사이트 정책 |
| T22 GitLab | 실패(503) | 성공 (webctl 15, 44초, eval 1) | 이전 503은 일시 장애로 보임. 새 `select`가 정렬 콤보박스를 한 번에 변경, effect가 URL 변화 확인. 남은 문제: `list`가 결과 대신 사이드바 목록을 고름(eval 1회), 토큰 입력은 fill 후 값이 비어 valueMatches:false(경고 문구가 혼란) |
| T27 Docker Hub | 실패 | 성공 (webctl 15, 33초) | 창 1440×900에서 데스크톱 필터가 보임(F50 효과). textHits의 `use`로 바로 클릭. 남은 문제: `list`가 바닥글 링크 묶음을 고름, 메뉴 항목의 체크 상태(menuitemcheckbox 등)를 snapshot이 못 보여줌 |
| T05 Selenium 폼 | 부분 | 성공 (webctl 12, 21초) | `select`로 드롭다운 1회, fill의 valueMatches·비밀번호 `[HIDDEN:5]`로 확인. 남은 문제: select 응답이 옵션 값("2")을 줌 → 보이는 글자로 수정함 |
| T03 Newegg | 부분 | 부분 (webctl 30, eval 7) | SAMSUNG은 effect.valueChanges로 즉시 확인. 2TB는 하위 목록이 hover로 열리지 않고, 부모 체크박스("1TB to 3.9TB")를 선택해야만 펼쳐지는 구조(직접 확인, 높이 0 유지). "정확히 두 개만"과 사이트 구조가 충돌 → clipped 응답에 `collapsedUnder`(그룹 이름, 머리글이 체크박스인지, 토글) 추가함 |
| T29 Can I Use | 부분 | 성공 (webctl 24, eval 8) | 전역 지원 97.46% 확인. 남은 문제: 결과 카드 링크가 shadow DOM 안 display:contents 링크라 snapshot·list가 놓침, 컨트롤이 아닌 h3 클릭이 조용히 무효과 → 둘 다 수정함 |

### 재시험 요약

- 8개 중 성공 5 (T05, T06, T22, T27, T29), 부분 1 (T03, 사이트 구조), 실패 2 (T19 필터 미렌더링, T21 Cloudflare 차단 — 둘 다 사이트 측).
  전체 33개 기준으로는 성공 30, 부분 1, 실패 2.
- 재시험 8회 동안 `sites/` 폴더 생성 0건 (W8 확인).
- 재시험에서 나온 추가 수정(결정적 테스트 44/44): `list`가 메뉴·머리글·바닥글·사이드바 묶음을 건너뛰고 본문을 우선,
  shadow DOM 안 카드와 display:contents 링크 인식; clipped 응답에 `collapsedUnder`; 컨트롤이 아닌 요소 클릭이 무효과면
  가장 가까운 링크 안내(`effect.note`); select 응답이 옵션 값 대신 보이는 글자.
- 남은 과제(미수정): back 1회 ~10초, 펼칠 때 역할이 바뀌는 검색창(searchbox→combobox), 토큰/칩 입력의 valueMatches 경고 문구,
  메뉴 항목 체크 상태(menuitemcheckbox) 표시.
