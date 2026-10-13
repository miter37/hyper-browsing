# Hyper-Browsing 업그레이드 계획 — Agent DOM Booster 개발 경험 이식

- 작성: 2026-10-13 · 상태: **계획 (구현 전)**
- 출처: `D:\APPs\dom-booster` (Browser Use용 Chrome 확장)의 규칙, 실사이트 A/B 실험 8단계,
  세션 기록 분석에서 얻은 교훈
- 범위: hyper-browsing의 **범용 도구층**(snapshot, forms, diff, click/fill, dismiss-annoyances, 테스트·평가).
  사이트별 자산(`sites/<site>/`)은 손대지 않는다.

---

## 0. 한 문단 요약

dom-booster의 규칙 절반은 "브라우저는 아는데 Browser Use가 버리는 정보(네이티브 label 이름 등)"를
DOM 속성으로 옮겨 주는 일이었다. hyper-browsing은 Playwright를 쓰므로 그 정보를 **직접 읽을 수 있다**.
그래서 규칙을 그대로 옮기지 않고, 교훈만 옮긴다.

1. 에이전트가 보는 목록(`snapshot`)에 **브라우저가 계산한 이름과 상태**를 싣는다.
2. 이름이 같은 요소가 여럿이면 **구분 맥락**을 붙인다.
3. 이름으로 대상을 고를 때 **조용히 첫 번째를 누르지 않는다**.
4. 클릭 뒤 **상태 변화까지 보여 준다**.
5. 페이지를 숨기거나 임의로 누르는 동작은 **명확한 증거가 있을 때만** 한다.
6. 이 모든 것을 **LLM 없는 고정 테스트**와 **판정 기준이 있는 A/B 실험**으로 검증한다.

---

## 1. 현재 hyper-browsing에서 확인한 사실 (코드 기준)

| 위치 | 현재 동작 | dom-booster 경험상 문제 |
|---|---|---|
| `src/runtime/snapshot.ts` | 후보 `a, button, input, select, textarea, [role], [data-testid]`. 최대 160개, 문서 순서 | `label`(커스텀 체크박스), `summary`, tabindex를 가진 span 같은 실제 조작 대상이 빠진다. 큰 페이지(Newegg 필터 570개)는 앞부분만 보인다 |
| 같은 파일 `isVisible` | `opacity === "0"`이면 제외 | Wikipedia·Wikivoyage 언어 메뉴처럼 **투명 체크박스가 진짜 조작 대상**인 경우 존재 자체가 사라진다(Browser Use에서 A 실패 원인) |
| 같은 파일, 이름 계산 | `aria-label \|\| innerText`, `labels[0]` | 다음 이름이 빠진다: aria-labelledby, `<svg><title>`(아이콘 버튼), 링크 안 `img alt`, fieldset legend 맥락 |
| 같은 파일, 출력 필드 | tag, role, name, text, testId, placeholder, label, href | **상태가 없다**: checked, selected, 선택값, expanded, pressed, disabled, required, 입력값 |
| 같은 파일, `querySelectorAll` | 문서만 탐색 | **열린 shadow root와 iframe 내부가 안 보인다** (Wikivoyage 언어 패널, GitHub 검색창은 shadow DOM 안) |
| `src/engine/locators.ts`, `server.ts` click/fill | `getByRole(...).first()` | "Repository" 링크 7개 중 **첫 번째를 조용히 누른다** (crates.io: 틀린 카드) |
| `compareSnapshots` (diff) | 키 = tag, role, name, text, testId | 체크·펼침처럼 **상태만 바뀐 변화는 diff에 안 잡힌다** |
| `dismissAnnoyances` | "확인", "OK", "Close" 등 버튼을 force 클릭. class에 modal, dialog, popup이 든 fixed 요소를 `display:none` | 확인 버튼이나 진짜 대화상자(날짜 선택, 언어 선택)를 **증거 없이** 누르거나 숨길 수 있다 |
| `webctl run --input '{...}'` | 명령줄 JSON | Windows PowerShell에서 따옴표가 깨진다. Phase 8 세션 10개 중 4개가 이 문제로 500 오류를 내며 턴을 잃었다 |
| `tests/` | chrome-manager 시나리오뿐 | snapshot 품질에 대한 결정적 테스트가 없다 |

---

## 2. 옮겨 올 교훈과 근거

| # | dom-booster 교훈 | 근거 (실험·규칙) |
|---|---|---|
| L1 | 이름은 **명시적 페이지 증거**에서만 만들고, 사이트가 준 값은 덮어쓰지 않는다 | SR-01/02/05/06 설계 원칙. 추측성 이름은 오답을 부른다 |
| L2 | 같은 이름이 반복되면 **가장 가까운 고유 제목**을 맥락으로 붙인다. 단 컨테이너에 제목이 1개이고, 그 제목을 다른 형제가 공유하지 않을 때만 | CT-01/CT-04. Wikivoyage에서 목차가 두 번 그려져 "Buy — Contents" 38개가 생긴 오탐 → distinct-heading 조건으로 해결 |
| L3 | 숨겨진 진짜 체크박스의 **체크 상태는 보이는 label에 투영**해야 에이전트가 확인할 수 있다 | SR-03. Newegg A는 체크됐는지 몰라 상태 조회 27회. C는 "— checked"로 2회 만에 확인 |
| L4 | select는 **현재 선택값**을 보여 줘야 한다 (옵션 목록 4개만 보이는 문제) | ST-02. USPS·GitHub에서 선택 확인에 턴 소모 |
| L5 | **투명 오버레이 컨트롤**은 숨김이 아니라 조작 대상이다 | VX-01. Wikipedia·Wikivoyage A 실패, C 성공 |
| L6 | 열린 shadow root와 iframe까지 내려가야 한다. 닫힌 shadow root와 결제 iframe은 제외 | 확장 v0.3 shadow/iframe 지원 |
| L7 | 비밀번호와 민감 입력칸은 이름이나 값을 다루지 않는다 | SR-01/02 password 제외 고정 테스트 |
| L8 | 검사에는 **시간 예산**이 필요하다 (50ms × 3회 초과 시 중단) | Newegg 30~43ms. 큰 페이지에서 비용이 폭증한다 |
| L9 | "클릭 성공"은 성공이 아니다. **상태 변화로 판정**한다 | Wikivoyage C: 클릭은 ok였지만 아무 변화 없음. Enter로만 열림 (약 200초 낭비) |
| L10 | 판정은 **페이지 상태(oracle)**로 하고, 에이전트의 자기 보고를 믿지 않는다 | 모든 A/B 실험의 원칙 |
| L11 | A/B는 **고정 빌드**, 시나리오당 1회, 동일 지시문으로 한다. 시간 차이는 에이전트 sleep, 백그라운드 실행, 턴 수, **페이지 변동**을 먼저 의심한다 | Phase 6–8 리뷰: "속도 향상" 대부분이 확장과 무관했다 (Newegg A와 C가 서로 다른 필터 목록을 봄) |
| L12 | 특정 사이트용 해법 금지. 원인을 일반화해 일반 규칙으로 푼다 | 사용자 원칙. 범용 도구층에 동일하게 적용 |

---

## 3. 업그레이드 항목

우선순위: **P0** = 정확도에 직결, 먼저. **P1** = 효율·안전. **P2** = 탐색적.

### P0-1. snapshot의 이름과 상태를 브라우저 접근성 계산으로 교체 (L1, L3, L4, L5, L6)
- **방법:** 자체 `innerText` 계산을 접근성 트리로 대체하거나 보강한다. 후보는 셋이고, Phase 0에서 고정 테스트로 비교해 고른다.
  1. Playwright `locator.ariaSnapshot()` (1.49+, 현재 1.55)
  2. CDP `Accessibility.getFullAXTree` (프레임별)
  3. 현재 eval 스크립트에 이름 계산 보강
- **출력에 추가할 필드:** `checked`, `selected`, `value`(비밀번호 제외), `expanded`, `pressed`, `disabled`, `required`, `level`
- **이름 출처:** label, aria-labelledby(여러 참조), svg title, img alt, legend
- **확인할 점:** 접근성 트리는 opacity 0 요소를 포함하므로 L5를 자연스럽게 해결할 가능성이 크다. display:none인 커스텀 체크박스는 트리에서 빠지므로 P0-3이 여전히 필요하다.
- **성공 기준:** 이식한 고정 테스트(§4)를 통과하고, 160개 상한에서 출력 토큰이 기존 대비 +30% 이내.

### P0-2. 반복 이름에 구분 맥락 붙이기 (L2)
- 같은 role과 이름이 2개 이상이면 각 항목에 `context: "<가장 가까운 고유 제목>"`을 붙인다.
- `name`은 **바꾸지 않는다**. 저장된 러너의 `exact` 이름 지정과 충돌하지 않게 하기 위해서다.
- 알고리즘은 CT-04를 그대로 옮긴다.
  - 최대 5단계 위 조상까지 탐색한다.
  - 그 컨테이너에 제목이 정확히 1개이고, 제목이 항목을 포함하지 않으며, 다른 반복 항목이 함께 들어 있지 않을 때만 붙인다.
  - 그룹 안에서 같은 제목을 공유하는 항목은 맥락을 버린다(distinct-heading).
  - nav와 footer에 중복된 링크는 제외한다.
- 제목 출처는 h1~h6, `[role=heading]`이다. `dt`, `legend`, `summary`는 고정 테스트로 오탐을 확인한 뒤 추가한다.

### P0-3. 숨은 네이티브 컨트롤의 상태를 보이는 label에 표시 (L3)
- 커스텀 체크박스·라디오(입력은 숨김, label이 보임)를 감지한다. 해당 label을 snapshot 후보에 넣고 `checked`를 붙인다.
- 판정 조건은 SR-03과 같다: label이 연결된 입력이 하나이고, 입력이 화면에 안 보이고, label은 보일 때.

### P0-4. 이름 지정이 모호하면 조용히 고르지 않기 (L2, L9)
- `click`과 `fill`에서 `locator.count() > 1`이면 **실행하지 않는다**. 대신 후보 목록(이름, P0-2 맥락, 순번)과 함께 `ambiguous` 오류를 돌려준다.
- 해결 옵션을 추가한다.
  - `--nth N`
  - `--within "<제목 텍스트>"`: 그 제목을 가진 가장 가까운 컨테이너로 범위를 좁힌다
- 예외: 선언형 러너 단계(`site.yaml`)는 현재 동작을 유지한다. 기존 자산이 깨지지 않게 하기 위해서다. 대신 메트릭에 "모호함 발생"을 기록한다.

### P1-1. 클릭 뒤 상태 변화 요약을 기본 제공 (L9)
- `click`, `press`, `fill` 응답에 가벼운 `effect` 필드를 기본으로 넣는다.
  - URL·제목 변경
  - 대상 요소의 expanded·checked·selected 변화
  - 새 dialog, role=alert
  - 상호작용 요소 수의 변화
- `compareSnapshots` 키에 상태 필드를 넣어 상태만 바뀐 변화도 잡는다.
- 변화가 전혀 없으면 `effect: "none"`과 함께 힌트를 준다. 예: "aria-expanded 컨트롤은 Enter 또는 Space로 시도". 이 키 입력 대체는 Wikivoyage에서 관찰한 근거이지만, 자동 재시도는 하지 않는다.

### P1-2. 큰 페이지에서의 잘림 처리 (L8)
- 160개 상한에 걸리면 무엇이 잘렸는지 요약한다(제목 영역별 개수). 예: `truncated: {"Brands": 120, "Capacity": 40}`
- `--query`가 P0-1의 이름·상태·맥락까지 검색하도록 확장한다.
- `--region "<제목>"` 옵션을 추가한다.
- snapshot 계산 시간을 측정해 응답에 `scanMs`로 넣는다. 예산 초과가 반복되면 경고를 낸다.

### P1-3. 펼치기 컨트롤과 숨은 항목 개수 (탐색적, L1 범위 안)
- `aria-expanded=false` 같은 펼치기 컨트롤이 있고 같은 그룹 안에 숨은 항목이 있으면 `hiddenItems: N`만 표시한다.
- 숨은 항목의 이름은 내보내지 않는다. 존재하지 않는 선택지를 추정하게 만드는 위험 때문이다.
- 근거: Newegg C가 "목록에 2TB가 없다"며 110초를 헤맸다.

### P1-4. dismiss-annoyances를 증거 기반으로 축소 (L1, L12)
- 범용 "확인", "OK", "Close" 텍스트 클릭을 **동의·쿠키 증거가 있는 컨테이너 안**으로 한정한다. 증거는 role=dialog 등이면서 consent, cookie, 개인정보 문구를 포함하는 것이다.
- class 키워드만으로 `display:none` 하던 동작은 **기본으로 끄고 보고만** 한다. `--force-hide`를 줄 때만 숨긴다.
- 숨기거나 누른 대상을 응답에 전부 나열해서, 되돌리거나 판단할 수 있게 한다.

### P1-5. Windows 입력 경로 (L11 측정 위생)
- `webctl run --input-file <json>`과 `--input-kv key=value` 형식을 추가한다.
- SKILL.md에 PowerShell용 예시를 넣는다.

### P2-1. forms 도구 보강
- `analyzeForms`에 다음을 추가한다.
  - fieldset legend 맥락(CT-02)
  - aria-labelledby 이름
  - select의 현재 선택 텍스트(ST-02)
  - 같은 label을 가진 칸의 구분 맥락. 예: GitHub의 "Updated before the date" 2개
- 비밀번호뿐 아니라 `autocomplete=cc-*`, `one-time-code` 등 민감 칸의 값도 숨긴다.

### P2-2. 자산 기록 시 안정적인 지정 방식 우선
- `encodeObservedExtraction`과 learning이 locator를 저장할 때 다음 순서로 선택한다.
  1. testid
  2. role + 원래 이름 + P0-4의 `within` 범위
  3. 텍스트
- 맥락이 붙은 이름이나 순번(`nth`)은 저장하지 않는다.

---

## 4. 검증 방법 (dom-booster의 test_rules.py 방식 이식)

1. **고정 테스트 묶음 (`tests/snapshot-fixtures/`):** dom-booster `m0/fixture/`에서 HTML을 가져온다.
   - sr01·sr02·variants: label 변형
   - ct01·ct04: 반복 이름. c1/c2 이중 목차, w1/w2 카드 안 쌍둥이, nav/footer 포함
   - sr03: 커스텀 체크박스
   - st02: select
   - sr05·sr06: 옵션, 아이콘
   - overlay.html: 투명 오버레이
   - dy01: 늦게 바뀌는 페이지
   - shadow/iframe 사례
2. **러너 `tests/snapshot-rules.mjs`:**
   - 로컬 HTTP 서버를 띄우고, 각 요소에 기대하는 이름·상태·맥락을 정의해 snapshot 결과와 비교한다.
   - `None`(붙으면 안 됨) 사례를 반드시 포함한다.
   - 비밀번호 칸에 값이 노출되지 않는지 검사한다.
3. **모호성 테스트:** ct04 카드 페이지에서 `click --role link --name Repository`가 `ambiguous`를 반환하는지 확인한다. `--within "CSS Flexbox"`로 정확한 카드가 눌리는지도 확인한다.
4. **실사이트 확인 (LLM 없음):**
   - 대상: crates.io 검색 결과, Wikivoyage Seoul, Newegg SSD, USPS ZIP, GitHub 고급검색. dom-booster Phase 8과 같은 페이지다.
   - 측정: snapshot 시간, 개수, 반복 이름 그룹 수, 맥락이 붙은 수, 상태 필드 수.
   - 브라우저는 **사용자 개인 프로필이 아닌 별도 프로필**을 쓴다.
5. **A/B (구현 후, 사용자가 실행):**
   - 업그레이드 전과 후를 각각 고정 커밋으로 둔다. 시나리오당 1회, 동일 지시문으로 실행한다.
   - 판정은 페이지 상태 oracle로 한다.
   - 기록: 첫 화면 지문(목록 개수 등)을 함께 남겨 페이지 변동을 가려낸다. 에이전트의 sleep과 백그라운드 실행은 금지한다.

---

## 5. 진행 순서

| 단계 | 내용 | 산출물 |
|---|---|---|
| 0 | 고정 테스트 묶음과 러너 구축. 현재 snapshot 기준선 측정. P0-1의 세 후보 비교 | `tests/snapshot-fixtures/`, `tests/snapshot-rules.mjs`, 기준선 결과 |
| 1 | P0-1, P0-3 (이름·상태·가시성·shadow·iframe) | snapshot.ts 개편, 테스트 통과 |
| 2 | P0-2, P0-4 (반복 맥락, 모호성 거부, `--within`, `--nth`) | snapshot.ts, locators.ts, server.ts, webctl.ts, SKILL.md |
| 3 | P1-1, P1-2, P1-5 (effect 요약, 잘림 요약, 입력 경로) | server.ts, discovery-tools.ts, webctl.ts |
| 4 | P1-4 (dismiss-annoyances 축소) | discovery-tools.ts, SKILL.md |
| 5 | P2 항목, 실사이트 확인, A/B 준비 | 결과 보고 |

각 단계는 이전 단계의 테스트가 모두 통과한 상태에서 시작하고, 끝나면 `npm run typecheck`와 고정 테스트를 다시 돌린다.

---

## 6. 위험과 호환성

- **출력 형식 변경:** SKILL.md와 기존 에이전트 사용법이 snapshot 필드에 의존한다. 필드는 **추가만** 하고 기존 필드 의미는 유지한다.
- **모호성 거부(P0-4):** 기존에 `.first()`에 우연히 의존하던 사용 흐름이 오류로 바뀐다. SKILL.md에 해결 방법(`--within`, `--nth`)을 명시하고, 선언형 러너는 예외로 둔다.
- **접근성 트리 비용:** 큰 페이지에서 느릴 수 있다. 0단계에서 측정한 뒤 선택한다.
- **dismiss-annoyances 축소:** 쿠키 배너 제거율이 떨어질 수 있다. 숨김을 끄는 대신 보고는 유지하고, `--force-hide`를 남긴다.
- **실제 Chrome 프로필:** 테스트와 실험은 별도 프로필을 쓴다. 사용자 프로필로는 실행하지 않는다.

---

## 7. 열린 질문 (사용자 결정 필요)

1. **모호성 처리:** 모호한 이름 지정을 오류로 바꾸는 것(P0-4)을 기본값으로 할지, 경고만 할지.
2. **dismiss-annoyances:** 숨기기 기본값을 끄는 것(P1-4)에 동의하는지.
3. **작업 위치:** 이 저장소의 `main`에서 바로 할지, 별도 브랜치에서 할지.

---

## 8. 진행 기록 (2026-10-13, 브랜치 `feat/booster-lessons`, 미커밋)

- 구현: P0-4(모호성 거부 + `--nth`), 상태 필드와 숨은 체크박스 label(P0-1 일부, P0-3), diff `stateChanges`,
  P1-4(dismiss 증거 기반, `--force-hide`). 결정적 테스트 `tests/discovery-lessons.mjs` 23/23
  (`npx tsx tests/discovery-lessons.mjs`, `PW_CHROMIUM_PATH`로 Chromium 지정 가능).
- 주의: browserd는 tsx로 실행되어 `page.evaluate`에 넘긴 함수 안의 이름 있는 내부 함수가 `__name` 오류로 깨진다.
  페이지 스크립트는 문자열이나 이름 없는 함수로 작성할 것.
- Sonnet 1회 실사용(격리 프로필, 헤드리스): crates 성공(후보 context로 `--nth 6` 선택, 단 결과 로딩 전 클릭은
  모호성 검사를 건너뛰고 첫 링크 클릭), Newegg 성공했지만 2TB는 eval 필요(snapshot 잘림, 접힌 하위 필터는 hover로만
  열림, 숨은 요소 클릭 30초 대기, `--force` 클릭이 아무것도 안 하고 clicked:true), Wikivoyage 성공(13 calls).
- 다음 후보: 보이는 매치 0개일 때 첫 매치가 보일 때까지 기다린 뒤 다시 세기; 클릭 기본 타임아웃 단축과 잘린/접힌
  요소 보고; `--query`를 상한 전 전체 후보에 적용; `wait-idle` RPC 이름 불일치(`page.waitIdle` vs `page.waitForIdle`).
- 2차 수정(미테스트, 타입 검사만 통과): 로딩 중 모호성 검사(첫 매치 대기 후 재계수); 조작 기본 5초 실패와 실패 이유
  (`intercepted`/`not_visible`/`clipped`/...); 잘린(clipped) 대상은 `--force`여도 거부; click/hover/press `effect` 요약과
  강제 클릭 무효과 경고; `hover`, `back`, `forward` 명령; snapshot `--query`를 상한 전 적용, `--limit`, `omitted` 요약,
  `clipped`/`transparent`/`context` 필드; forms `group`/`selectedText`/`checked`와 민감 칸 값 숨김; `run --input-file`;
  빠른 경로 `wait-idle` RPC 이름 수정. `tests/discovery-lessons.mjs`는 이 변경 뒤 다시 돌리지 않았다.
- 주의: 데몬은 방문한 사이트마다 `sites/<host>/` 빈 템플릿과 `.generated/target_sites.json` 항목을 자동으로 만든다.
  시험 실행 뒤에는 정리할 것(이번 Sonnet 실행분은 삭제함).
