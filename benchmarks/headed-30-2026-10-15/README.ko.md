# 헤디드 30개 사이트: 목적 수행과 공통 개선

2026-10-15 / GPT-6 Codex 주도, gpt-6-luna 수행.

사용자 승인: 사이트 1~2개씩 Luna 한 명에게 목표를 주고 수행을 관찰한다. 매 묶음 종료 후 근거를 분석하여 사이트 독립적인 스킬·스크립트 개선을 반복한다. 전부 headed, 프로젝트 스킬/런처만 사용, 사이트 학습 비활성. 기존 작업 변경분은 보존한다. 결제·예약·발송·계정 생성은 하지 않는다.

## 운영

- 한 사이트 한 과업. 목표 달성 또는 실제 접근 제한/해결되지 않는 막힘을 정직하게 보고한다. 과업당 대략 3~4분을 목표로 하되 강제 중단으로 실행 여부를 불명확하게 만들지 않는다.
- Luna는 문서의 필요한 부분과 현재 페이지를 보고 자율 수행한다. 주도 에이전트는 명령 기록을 관찰하고, 불필요한 반복·모호함·누락·팝업·실패복구·결과의 과잉 주장을 분석한다.
- 접근 차단은 제품 결함과 구분한다. 실패했다고 그 도메인용 분기나 의미 사전을 추가하지 않는다. 코드 수정은 작은 로컬 재현 → 실패 테스트 → 공통 수정 → 관련 검증으로 진행한다.
- 이 실험은 실행 중 제품이 바뀌는 탐색 실험이다. 사이트 간 시간/성공률을 통제 비교나 일반화된 성능 수치로 주장하지 않는다. 원시 기록은 개인정보가 섞일 수 있어 `.runtime`에만 둔다.
- 출력량 측정 자체를 과업에 넣지 않는다. 기존 결과를 다시 확인하느라 진행을 늦추지 않는다. 비용 평가는 필요할 때 실제 호출 기록으로만 한다.

## 과업 목록

| # | 사이트 | 실제 목표 |
|---|---|---|
| 1 | Wikipedia | Apollo 11 목차에서 승무원 표를 찾아 Command Module Pilot 이름과 원문 링크 |
| 2 | MDN | 검색 자동완성으로 Array.prototype.map 문서를 찾아 첫 설명과 반환값 설명 |
| 3 | Hacker News | 상위 10개 중 댓글 최다 글의 제목·점수·댓글수·댓글 URL |
| 4 | GitHub | microsoft/playwright 열린 bug 이슈를 검색하고 최신 후보 2개의 제목·번호·링크 |
| 5 | Open Library | Ursula K. Le Guin의 The Dispossessed를 찾아 저자·초판 연도·판본 링크 |
| 6 | Project Gutenberg | Pride and Prejudice를 찾아 저자·영문 HTML 읽기 링크 |
| 7 | Python docs | pathlib 문서에서 Path.read_text의 인자와 반환값을 확인 |
| 8 | npm | zod 패키지 페이지에서 표시 버전·설치명령·저장소 링크 |
| 9 | PyPI | httpx 패키지에서 표시 버전·Python 요구사항·프로젝트 문서 링크 |
| 10 | Stack Overflow | python list flatten 검색에서 실제 결과 2개 제목·투표·링크 |
| 11 | Amazon | wireless mouse 검색, 표시된 가격과 후기 근거로 서로 다른 후보 2개 |
| 12 | eBay | wireless mouse 검색, 일반 상품 2개의 이름·가격·배송·링크 |
| 13 | Best Buy | wireless mouse 검색, 평점·가격이 표시된 상품 2개 비교 |
| 14 | Walmart | wireless mouse 검색, 보이는 가격·배송/픽업 조건의 후보 2개 |
| 15 | Target | electric kettle 검색, 가격·평점 후보 2개 |
| 16 | IKEA | desk lamp 검색, 가격·상품 링크 후보 2개 |
| 17 | Etsy | ceramic mug 검색, 표시 가격·배송 조건 후보 2개 |
| 18 | Newegg | USB-C hub 검색, 가격·평점 후보 2개 |
| 19 | Booking.com | 서울 2026-11-10~12 성인1명 검색, 표시 총액·평점 후보 2개 |
| 20 | Expedia | 서울 같은 날짜 성인1명 검색, 표시 가격·평점 후보 2개 |
| 21 | Tripadvisor | 서울 명소에서 경복궁을 찾아 표시 평점·리뷰수·주소 |
| 22 | Airbnb | 서울 종로 2026-11-10~12 성인1명, 1박15만원 전후 후보 2개 |
| 23 | Google Maps | 서울시청 근처 카페 검색, 표시 평점·주소·지도 링크 후보 2개 |
| 24 | AllTrails | Los Angeles hiking 검색, 실제 거리·난이도가 표시된 코스 2개 |
| 25 | Yelp | San Francisco coffee 검색, 표시 평점·리뷰수·지역 후보 2개 |
| 26 | OpenTable | New York 식당에서 표시 평점·요리종류 후보 2개, 예약은 하지 않음 |
| 27 | Reuters | 기술 섹션에서 제목·게시 시각이 보이는 최신 기사 2개 |
| 28 | AP News | 과학 섹션에서 기사 하나를 찾아 제목·게시시각·첫 본문 문단 |
| 29 | Weather.com | Seoul 날씨 검색, 현재 기온·단위·관측/표시시각 |
| 30 | NPS | Yosemite 공식 페이지에서 방문 전 확인할 입장료·예약 안내와 출처 링크 |

## 누적 분석

아래에 묶음별 실제 결과와 개선·검증 근거를 누적한다.

### 01 — Wikipedia / MDN

- 둘 다 완료. Wikipedia 승무원 표의 Michael Collins와 링크, MDN 검색 후보를 통한 map 문서 진입 및 설명/반환값을 확인했다.
- 넓은 `Crew`, `returns` 쿼리가 소개문·예제를 반환하여 목표 절 확인에 추가 조회가 필요했다. native 출력에는 직접 일치한 필드가 없어 주변 맥락과 검색 근거를 구분하기 어려웠다.
- 개선: query가 있는 content/state read에서 그래프가 이미 가진 일치 근거만 해당 노드의 `match=[{field,transform?}]`로 전달한다. 문구를 재분류하거나 관련성을 추정하지 않는다. 쿼리도 응답에 병기한다. 조상에는 근거를 부여하지 않는다.
- 로컬 회귀 테스트: 변경 전 `query` 누락으로 실패 → text/href.query 근거와 조상 비일치 확인 통과. demand 테스트 10/10, typecheck 통과. 현장 추가 조회가 감소했는지는 아직 미측정이다.

### 02 — Hacker News / GitHub

- HN 완료: 상위 10개의 제목/메타데이터 관계를 유지해 댓글 최다 글과 링크를 확인했다. 내용 pagination이 4회 필요했으며 대량 상세 HWM은 사용하지 않았다.
- GitHub 부분 완료: 지정 검색을 실제 제출하고 URL/입력값을 확인했다. 사이트가 `Invalid value bug for label`을 표시하여 결과 2건은 확보하지 못했다. 이 경고를 제품 결함이나 로그인 차단으로 분류하지 않는다.
- 지도 점검: Wikipedia의 main 이름이 내부 목차의 Contents에서 유래했다. 로컬 재현에서 article 내부 header/footer까지 페이지 banner/footer로 승격하는 문제가 함께 확인됐다.
- 개선: 중첩 article/main/section 등의 암시적 header/footer는 페이지 landmark로 승격하지 않고, 패널의 제목은 다른 landmark 안에서 빌려오지 않는다. 명시적 ARIA 역할은 유지한다. 도메인/문구 조건 없음.
- 회귀: article header가 2개 banner로 나오는 RED 확인 → 수정 후 demand 11/11 및 typecheck 통과. query 변경 후 전체 npm test도 통과했다. 지도 변경 후 전체 검증은 최종 변경분까지 묶어 실시한다.

### 03 — Open Library / Project Gutenberg

- Open Library 부분 완료: 저자·초판 1974년·판본 링크는 검색 결과에서 확인. 상세 진입은 Human Verification에 막혀 그 이상을 확인하지 않았다. Gutenberg는 실제 검색/책 상세를 거쳐 Jane Austen 및 HTML 읽기 링크를 확인해 완료했다.
- 관찰: Search 이름이 붙은 버튼에 fill을 시도해 wrong_element, 이어 옛 snapshot --query 예시를 따라 scope_required가 발생했다. 스킬의 해당 예시를 현행 scoped read로 정정했다. 주도 에이전트가 이 충돌과 사용법을 중간에 전달했으므로 이 묶음은 무개입 성공 사례가 아니다.
- 앞선 Airbnb의 소형 팝업 문제를 공통 로컬 화면으로 재현했다. 기존 실패 응답은 큰 overlay 외에는 실제 가림 요소/닫기 후보를 주지 않았다.
- 개선: intercepted/timeout 때 target-center hit test로 확인한 요소와 가장 가까운 dialog/배치 경계, 그 안의 가시 버튼 최대 4개를 `obstruction`에 제공한다. 자동 클릭·자동 숨김·사이트 문구 분류는 하지 않는다. 텍스트는 기존 공통 마스킹을 거친다. 실패의 outcome_unknown은 그대로 보존한다.
- 재현 테스트 RED(진단 없음) → GREEN(소형 dialog와 닫기 버튼 정보, 실제 닫기/대상 클릭 없음). 스킬에는 자동닫기 0건 반복 대신 관찰된 방해 요소로 다음 행동을 판단하도록 짧게 안내했다.

### 04 — Python docs / npm

- 모두 완료. Python Path.read_text 표시 인자와 문자열 반환 설명, npm zod 표시 버전/설치/저장소 링크를 확인했다.
- Python에서는 인라인 span으로 나뉜 함수 이름만 검색 결과에 남고 바로 이어지는 정의 설명은 빠져, 문서 절의 offset 조회를 추가했다. npm은 클릭 직후 effect URL과 다음 snapshot URL 사이 시간차가 있었으나 다음 관찰로 목적지 진입을 확인했다.
- 개선: HTML 정의 목록 dl/dt/dd를 소실되지 않는 기존 group 노드로 보존하고 native content에 실제 tag를 전달한다. dt 안에서 일치한 경우 그 dt와 바로 뒤 dd들의 범위만 함께 제공하고 다음 dt의 설명은 포함하지 않는다. 함수/상품 의미 이름을 붙이지 않는다.
- 로컬 인라인 시그니처 재현 RED(앞 조각/뒤 설명 누락) → GREEN. demand/collector 23/23 통과, typecheck 통과. 실제 사이트의 개선 후 성공률 비교는 수행하지 않았다.

### 05 — PyPI / Stack Overflow

- PyPI 완료: 정확한 httpx 패키지(유사명과 구분)에서 버전 0.28.1, Python 3.8+, 문서 링크를 확인했다.
- Stack Overflow 차단: 검색창 입력/제출 뒤 nocaptcha / Human verification으로 이동. 결과 2개를 확인하지 못했고 우회 없이 종료했다. 페이지 진입이 가능했다고 검색 완료로 취급하지 않았다.
- 점검 보완: 검색어가 바뀌었을 때 이전 검색에서 직접 일치했던 노드가 이번에는 맥락으로만 포함될 수 있다. 기존 match를 현재 검색 근거처럼 남기지 않도록 같은 receipt의 unavailableFields로 철회한다. 로컬 RED→GREEN, demand 13/13 및 typecheck 통과. 이번 묶음의 차단을 고치기 위한 도메인 예외는 추가하지 않았다.

### 06 — Amazon / eBay

- Amazon 부분 완료로 정정: 검색·상품명·후기는 확인했으나 `$49 (KRW 65,676)`를 판매가로 단정한 초기 보고는 철회했다. 원시 출력에는 동일 카드의 숫자라는 근거만 있었고 판매가/배송 최소금액을 가르는 라벨이 충분하지 않았다. 주도 에이전트의 원시 로그 검토 후 Luna도 정정에 동의했다. 두 후보 모두 원문에 Sponsored Ad 표시가 있었다.
- eBay 미완료: 배송지 팝업으로 클릭이 가로막힌 뒤 관찰한 Dismiss로 처리하고 검색했다. 읽힌 범위에는 Shop on eBay 및 동일 샘플 링크/금액과 `derosnopS` 텍스트가 있어 일반 상품 2개를 검증하지 못했다. 이것을 사이트 전체가 고장 났다는 결론으로 확대하지 않는다.
- 발견: query가 있는 페이지의 nextOffset을 이어 읽으면서 query를 빠뜨려 다른 집합의 offset을 읽었다. 스킬에 같은 want/query/item/target 유지 규칙을 명시했다.
- 공통 개선: 금액만 남고 그 옆의 조건 문구가 없어지는 사례를 로컬로 재현했다. 질의 내용의 실제 DOM 분기 그룹과 주변 텍스트를 bounded context로 보존한다(비시맨틱 분기 fallback: 1,000자 이하, 추가 문맥 8자 초과, 필수 하위 탐색 최대 64개). 한 자식 래퍼 체인은 기본 출력에서 다시 줄이고 분기·역할·레이아웃 경계는 유지한다. 금액에 판매가/배송비 의미를 붙이지 않는다.
- 성능 점검: Amazon/eBay 넓은 query read가 각각 약 9초/7초 걸렸다. 반복 선형 검색을 노드/자식 색인과 한 번의 하위 순회로 바꿨다. 아직 실제 사이트의 전후 속도 개선으로 주장하지 않는다.
- 회귀: 수집 예산 뒤에 있는 금액에서 조건 문구 누락 RED → 실제 공통 조상과 원문 조건 보존 GREEN. demand/collector 25/25 및 typecheck 통과.

### 07 — Best Buy / Walmart

- Best Buy 완료: 국가 선택 뒤 실제 검색. Signature M650 L $39.99·4.8/2,566후기, MX Master 4 $119.99·4.7/347후기와 링크를 확인했다. 카드 이름·가격·후기 근거를 확인하되 이미지 carousel의 하위 item과 실제 상품 전체가 다르므로 target을 추가로 좁혔다.
- Walmart 차단: 검색 직후 Robot or human? / blocked 페이지로 이동. 누르기 CAPTCHA를 수행하지 않고 종료했다.
- 관찰: 긴 상품 URL slug가 공통 마스킹으로 `<redacted-long-token>`이 되어 전달된다. Luna가 실제 상품에 진입 후 location.href를 조회하여 URL을 확보했다. URL 보존을 위해 마스킹 정책을 무작정 완화하지 않고, 마스킹 사실을 명시할 수 있는지 점검한다.
- query 이어 읽기에서 같은 조건 유지가 실제 적용됐다. 본 실험은 프롬프트/제품이 함께 바뀌는 탐색이며 조회 감소나 속도 향상을 인과적으로 입증하지 않는다.

### 08 — Target / IKEA

- Target: electric kettle 실제 검색 URL/제목까지 확인했으나 `We couldn’t find a match for your search`가 표시되어 상품 추천은 미완료. 추가 읽기에도 카테고리만 있었고 제품을 만들어내지 않았다.
- IKEA 완료: privacy 팝업을 기존 dismiss-annoyances로 처리한 뒤 검색. Price 라벨이 붙은 TERTIAL $19.99 / FORSÅ $39.99와 실제 링크·설명을 확인했다.
- 공통 개선: URL이 마스킹되었으면 작은 컨트롤/지도/내용 모두 `redacted:["href"]`로 명시한다. 정본에도 redactedFields를 남긴다. URL을 복원하거나 마스킹 강도를 완화하지 않으며, 원래 요소의 실행 ref는 그대로 사용한다.
- 로컬 RED(마스킹은 있으나 표시 없음) → GREEN(작은 지도와 내용 조회 모두 표시, token 값은 계속 숨김). demand/collector/store 검증 및 typecheck 결과를 다음 검증 로그에 보존한다.

### 09 — Etsy / Newegg

- Etsy 차단: 진입 HTTP 403 + CAPTCHA 프레임. setupStatus ready를 사이트 성공으로 취급하지 않고 바로 종료했다.
- Newegg 완료: 실제 검색 후 Rosewill RHUB-M8 $29.99(비교가/할인액 구분), 4.6/7후기와 StarTech 309B-USBC-HUB $41.99(후기 미확인), 표시 배송 조건·링크를 확인했다. 좁은 list와 내용 조회를 함께 활용했다. PowerShell의 bare @ref 인용 문제 1회는 e… 형태로 바로 복구했다.
- 관찰: 첫 지도는 banner의 Close/All Categories만 제공해 검색 입력을 다시 찾아야 했고, dialog 자체가 control 샘플 한 자리를 차지했다.
- 개선: 지도 생성 시 기존의 bounded 160-node walk에서 후보 최대 12개를 살펴, 구조적 컨테이너는 샘플에서 제외하고 실제 searchbox/textbox/combobox를 우선 제공한다. 출력은 여전히 패널당 2개·전체 12개다. 페이지 목적/사이트 이름으로 우선순위를 정하지 않는다. 기존 상세 컨트롤 기능은 유지한다.
- 로컬 RED(입력 미표시) → GREEN(입력 우선·수동 dialog 중복 없음·2개 상한 유지), demand 16/16 및 typecheck 통과.

### 10 — Booking.com / Expedia

- 둘 다 부분 완료. Booking은 Seoul 및 11/10~12 선택을 확인했으나 기본 성인 2명에서 1명으로 바꾸지 못해 검색/추천을 하지 않았다. Expedia는 Seoul 선택 후 날짜/인원 설정을 완수하지 못했다. 검색 결과를 확인하지 않았으므로 가격 추천 성공으로 기록하지 않는다.
- Booking에서는 이름이 없는 조절 버튼을 controls의 추측 이름으로만 검색하고 content,controls/explain을 활용하지 않아 너무 일찍 멈췄다. 주도 에이전트가 이 점을 Expedia 수행 중 메시지로 전달했으므로 독립 무개입 시행은 아니다.
- Expedia explain은 실제 20,399B > 기본 16,000B로 내용 전체를 거절했다. 모호함 해소용 폴백이 아무 근거도 주지 않는 문제가 확인됐다.
- 개선: 재관찰 없이 이미 저장한 같은 그래프의 nodeBudget을 낮춰 정상 HWM 접힘 문법으로 byteBudget에 맞춘다. 최소 투영도 맞지 않으면 기존 detail_budget_exceeded/보관 observation을 반환한다. 문자열을 중간에서 자르거나 새 DOM과 섞지 않는다.
- 추가 점검: 기존 snapshot의 nearby hint로 매칭된 컨트롤에서 native projection이 hint를 버리고 있었다. 원래 이름은 그대로 두고 hint + source를 보존했다. 스킬에는 라벨과 컨트롤 소속을 함께 읽는 복구 흐름만 짧게 추가했다.
- 두 재현 RED → GREEN. demand 18/18 및 typecheck 통과. 이 수정으로 Booking/Expedia 과업이 완수됐다고 주장하지 않는다(재시행 안 함).

### 11 — Tripadvisor / Airbnb

- Tripadvisor 미완료: 경복궁 검색 URL/제출까지 도달했으나 관찰한 결과 범위에서 명소 카드/평점/주소를 확인하지 못했다. 전체 사이트 오류나 접근 차단으로 단정하지 않는다.
- Airbnb 부분 완료(링크 제한): 기존 `sites/airbnb/SKILL.md`에 저장되어 있던 검색 URL 절차를 사용하고, 지역·11/10~12·성인1명·2박 총액 필터를 UI/URL에서 검증했다. Hanse Stay Dongmyo 336,600원/2박·5.0/42후기, Buam-dong 316,000원/2박·4.97/58후기를 확인했다. URL 마스킹 때문에 공유 링크는 제공하지 않았다. 기존 사이트 자산 재사용 사례이며 일반 날짜 선택 UI의 개선 증거로 취급하지 않는다. 사이트 자산/러너는 수정하지 않았다.
- 비활성 작업에도 identify/learning notes를 시도해 불필요한 호출과 에러가 있었다. 스킬에서 기존 능력 조회는 필요할 때만, 학습 비활성 때 learning notes/finish는 건너뛰도록 흐름을 정리했다.
- 공통 보완: 이름 없는 인원/달력 버튼에는 위치 단서가 없었다. 이런 컨트롤에 한해서 현재 viewport CSS pixel box를 전달하고, 이름 있는 컨트롤에는 기본 좌표를 늘리지 않는다. 위치가 조작 의미를 결정하지 않으며 실행은 원래 ref로 한다.
- 위치 재현 RED(두 버튼 위치 구분 불가) → GREEN, demand 19/19 및 typecheck 통과.

### 12 — Google Maps / AllTrails

- Google Maps 완료: 서울시청 근처 두 카페의 표시 평점/후기·주소·상세 링크를 확인했다. GPS 권한은 요청/허용하지 않았다.
- AllTrails 미완료: Los Angeles, California를 fill --submit으로 입력했으나 California Natives라는 다른 자동완성 대상의 경로로 이동했고 로그인/가입 벽이 나타나 종료했다. 로그인의 존재와, 그 전에 이미 검색 대상이 어긋난 사실을 함께 기록한다. 올바른 LA 코스 검색을 검증한 것으로 취급하지 않는다.
- 스킬 보완: 자동완성의 중간 선택이 필요한 combobox에서는 fill과 선택/Enter를 나눈다. 추가 단계가 필요하더라도 잘못된 대상 진입을 줄이는 방향이며, 앱이 첫 후보를 의미적으로 대신 판단하도록 바꾸지 않는다.
- 그 외 공통 코드 수정은 하지 않았다. 두 사이트만을 위한 예외도 없다.

### 13 — Yelp / OpenTable

- Yelp: 진입 CAPTCHA/403으로 종료. 다른 후보를 추측하지 않았다.
- OpenTable 완료: NYC 명시 링크를 사용해 Tamarind - Tribeca 4.8/4,936·Indian, Balzem 4.7/718·Mediterranean 및 링크를 확인했다. 접힌 위치 섹션은 clipped 응답의 toggle 안내로 복구했다. 예약은 제출하지 않았다.
- API 공백 발견: 이미 받은 실행 ref로 해당 카드만 read --target 하려 했지만 N…만 허용하여 invalid_read_target이 발생했다. 자연스러운 범위 축소 요청을 지원하지 못한 경우다.
- 개선: 같은 panel 안의 발급된 유효 ref도 읽기 target으로 받는다. 기존 ref guard 검증과 물리적 panel 포함 검사를 모두 거친다. 다른 패널의 ref 및 교체된 ref는 거부하고, 읽기 중 링크 이동은 하지 않는다. N… 읽기와 실행 ref의 수명 규칙은 그대로다.
- 로컬 RED(invalid_read_target) → GREEN(내용 조회·비이동·외부 패널 거부·stale 거부), demand 20/20 및 typecheck 통과.

### 14 — Reuters / AP News

- Reuters 진입 401/CAPTCHA로 종료. AP Science는 기사 제목·Updated 시각·첫 본문 문단을 확인했다. Updated를 최초 게시시각으로 바꾸어 주장하지 않는다.
- AP는 privacy backdrop에 클릭이 가로막혔다. 자동닫기 후 재등장했으나 실제 `I Reject All (except Strictly Necessary)`를 관찰해 처리했다. 앱에 AP/OneTrust 전용 조건을 추가하지 않았다. backdrop의 별도 형제 패널까지 진단에 연결하지 못하는 한계는 남아 있다.
- ref target 추가 후 점검에서 open shadow 내부 target이 DOM contains만으로 거부되는 문제를 재현했다. 같은 패널의 shadow host 경로를 따라 포함 여부를 확인하도록 수정했다. 외부 패널을 허용하지 않는다.
- native projection은 이미 수집된 aria-hidden 선언과 rendering 경계를 버리고 있었다. 이 경계와 명시적 false로의 변경을 보존하도록 수정했다. 화면에서 보이는지나 상품 템플릿 여부를 앱이 판정하는 규칙은 만들지 않았다. eBay 사례의 원인을 이 수정으로 해결했다고 주장하지 않는다.
- 두 경계 재현 RED → GREEN. demand/collector 33/33, typecheck 통과.


### 15 — Weather.com / NPS

- Weather.com 완료: 실제 Seoul, South Korea 자동완성 후보를 선택했다. Now 70°F, 표시시각 11:53 AM GMT+9를 확인했다. 다른 시간대의 69/68도를 현재 값으로 섞지 않았다. 출처는 https://weather.com/kr/city/seoul/today 이며 관측일은 2026-10-15다.
- NPS 미완료: Find a Park의 Name 필터에서 실제 Yosemite National Park 항목을 찾았으나 선택을 마치지 못했다. 요금·예약 규칙은 미확인이다. Find a Park 링크를 요금 근거로 쓰지 않는다.
- 원시 명령 기준으로 blocked_by_overlay 클릭 응답이 5회, select 오류가 2회 있었다. ref→role/name→CSS로 바꾸어도 같은 장애가 반복됐다. 수행자의 요약보다 원시 기록이 많은 반복을 보여준다. 주도 에이전트가 중단/현상 확인을 요청한 개입이 있었다. 가림 진단이 있다는 것만으로 적절한 복구가 보장되지는 않는다.
- 이 단일 현상을 근거로 NPS 전용 분기·강제 클릭·DOM 조작 우회를 추가하지 않았다. 잘린/스크롤된 긴 선택목록에서 실제 클릭 가능 지점과 관찰된 방해 요소의 관계를 로컬 재현하는 것이 후속 후보다. 원인이 입증되지 않은 일반 클릭 엔진 변경은 하지 않았다.

## 전체 결과와 호출 기록

보수적으로 **완료 13, 부분 7, 미완료 5, 접근 차단 5**로 분류했다. 부분은 일부 실제 근거는 확보했으나 목표 전체를 확정하지 않은 경우다. Open Library는 필요한 검색 결과를 읽었으나 상세가 차단됐고, AP는 Updated만 확인하여 최초 게시시각은 미확인으로 둔다. 이 분류는 엄격한 외부 평가자의 합격 판정이나 일반 성공률이 아니다.

| # | 사이트 | 보수적 결과 | 세션 초 | 호출 | 입력 시도 | 조회 | eval |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Wikipedia | 완료 | 24 | 6 | 0 | 4 | 0 |
| 2 | MDN | 완료 | 40 | 12 | 3 | 7 | 0 |
| 3 | Hacker News | 완료 | 41 | 8 | 0 | 5 | 0 |
| 4 | GitHub | 부분 | 39 | 9 | 2 | 5 | 0 |
| 5 | Open Library | 부분 | 77 | 20 | 6 | 12 | 0 |
| 6 | Gutenberg | 완료 | 30 | 9 | 2 | 5 | 0 |
| 7 | Python docs | 완료 | 73 | 18 | 2 | 13 | 0 |
| 8 | npm | 완료 | 38 | 11 | 2 | 7 | 0 |
| 9 | PyPI | 완료 | 37 | 11 | 3 | 6 | 0 |
| 10 | Stack Overflow | 차단 | 32 | 9 | 2 | 4 | 0 |
| 11 | Amazon | 부분 | 83 | 14 | 2 | 8 | 0 |
| 12 | eBay | 미완료 | 80 | 13 | 5 | 6 | 0 |
| 13 | Best Buy | 완료 | 129 | 24 | 5 | 14 | 2 |
| 14 | Walmart | 차단 | 26 | 8 | 2 | 4 | 0 |
| 15 | Target | 미완료 | 51 | 12 | 2 | 7 | 0 |
| 16 | IKEA | 완료 | 46 | 11 | 2 | 6 | 0 |
| 17 | Etsy | 차단 | 7 | 2 | 0 | 0 | 0 |
| 18 | Newegg | 완료 | 85 | 18 | 2 | 12 | 0 |
| 19 | Booking.com | 부분 | 87 | 21 | 8 | 10 | 0 |
| 20 | Expedia | 부분 | 82 | 19 | 7 | 9 | 0 |
| 21 | Tripadvisor | 미완료 | 46 | 12 | 3 | 6 | 0 |
| 22 | Airbnb | 부분 | 41 | 9 | 0 | 4 | 0 |
| 23 | Google Maps | 완료 | 23 | 6 | 1 | 3 | 0 |
| 24 | AllTrails | 미완료 | 35 | 8 | 3 | 3 | 0 |
| 25 | Yelp | 차단 | 5 | 2 | 0 | 0 | 0 |
| 26 | OpenTable | 완료 | 123 | 27 | 5 | 18 | 0 |
| 27 | Reuters | 차단 | 6 | 2 | 0 | 0 | 0 |
| 28 | AP News | 부분 | 95 | 22 | 6 | 11 | 0 |
| 29 | Weather.com | 완료 | 61 | 13 | 3 | 8 | 0 |
| 30 | NPS | 미완료 | 196 | 34 | 15 | 11 | 3 |

합계 390회 helper 호출, 입력 시도 93회, 조회 208회, 실제 eval 5회다. eval은 Best Buy 2회(URL 확인)와 NPS 3회(선택목록 구조 확인)다. 실패 응답 31개는 명령 단계의 실패이며 사이트 실패 수와 다르다.

### 측정 범위

- 세션 초: session open 호출 시작부터 session close 완료까지의 벽시계 시간. 에이전트의 판단·호출 사이 대기·사이트 응답·CLI를 포함한다. 스킬 최초 읽기/에이전트 기동은 제외한다. 순수 사고시간은 분리 측정하지 않았다.
- 호출: 해당 구간의 helper 실행 횟수. 열기/닫기·도움말도 포함하며, 입력 시도는 click/fill/press/select/hover만 센다. 조회는 read/snapshot/explain/list/extract/forms다. scroll/navigate/관리 호출은 호출 합계에만 포함된다. 셸 파싱 실패로 helper에 도달하지 않은 시도는 원시 명령 합계에 없다.
- 전체 세션 시간 합계 1738초, 중앙값 43.5초. 차단으로 즉시 끝난 세션도 포함되므로 빠른 값이 성능 우위를 뜻하지 않는다. 개선·검증·세션 사이 시간을 뺀 합계이며 전체 작업 소요시간도 아니다.
- 과업마다 사이트와 난도가 다르고 중간에 제품/지침이 바뀌었다. 로컬 테스트가 실전과 겹친 구간도 있다. 바닐라/browser-use/동일 사이트 재시행 없이 한 번씩 수행했다. 전후 성능 비교·토큰 절감률·HWM 이해도 우월성을 입증하지 않는다. 토큰/청구량도 측정하지 않았다.
- 중간 개입: Open Library의 명령 예시 충돌, Amazon 가격 보고 정정, Expedia의 복구 흐름 안내, NPS의 반복 중단 요청 등이 있었다. 모두 무개입 수행이라고 주장하지 않는다. Airbnb는 기존 사이트 자산 재사용이며 일반 날짜 선택기의 성공 증거가 아니다.

## 이번에 보완한 공통 기능

1. 작은 지도에서 실제 입력칸 우선 표본, 중첩 landmark의 이름/역할 경계.
2. 내용 질의의 일치 필드와 실제 조상·인라인 정의·주변 조건 원문, 질의 변경 시 옛 근거 철회.
3. 작은 팝업의 target-center 가림 진단. outcome_unknown을 유지하고 자동 클릭하지 않는다.
4. 마스킹된 링크 표시, 기존 nearby hint 출처, 이름 없는 컨트롤의 제한된 위치 정보.
5. explain의 저장된 동일 그래프를 바이트 예산 안에서 접어 반환.
6. 같은 패널 안의 실행 ref로 읽기 범위 축소, open shadow 포함 확인, stale/다른 패널 거부.
7. 이미 수집한 aria-hidden/rendering 경계 보존.
8. 스킬의 scoped read·페이지네이션·자동완성 중간 선택·학습 OFF 흐름 정정.

사이트별 호스트·상품 문구로 안전도를 낮추거나 특정 버튼의 의미를 엔진이 대신 판정하는 규칙은 추가하지 않았다. 모든 제품 수정은 로컬 재현 회귀로 확인했으며 실제 실패 사이트를 재실행해 해결됐다는 주장은 하지 않는다.

## 남은 한계와 후속 우선순위

- 복잡한 날짜·인원 및 긴 사용자 정의 선택목록: 컨트롤 존재/가림 단서만으로 Luna가 목표를 완수하지 못했다. 작은 로컬 재현으로 클릭 가능성·스크롤 경계·소속 전달과 복구 흐름을 먼저 확인할 것.
- 긴 공개 상품 URL도 기존 토큰 마스킹에 걸린다. 마스킹 사실은 명확해졌으나 공유 링크 가용성 문제는 남는다. 보안값을 노출하지 않는 URL 정책 개선은 별도 검증할 것.
- backdrop와 형제 dialog가 분리된 경우 가림 진단이 닫기 후보를 찾지 못한다. AP는 실제 거부 버튼 관찰로 처리했지만 일반 진단의 범위는 제한적이다.
- eBay의 샘플 상품·뒤집힌 글자 사례: DOM/화면 차이를 확인하지 못했으므로 렌더링 원인이나 해결을 단정하지 않는다.
- 이미 충분한 정보 뒤 추가 조회하거나, 중간 선택 없이 제출하고, 같은 실패를 선택자만 바꿔 반복하는 행태는 여전히 있다. 스킬과 진단을 늘리는 것만으로 해결됐다고 말하지 않는다. 목적별 총시간/전체 응답 비용의 제한된 후속 검증이 필요하다.

## 최종 검증

- 현재 제품 전체 npm test: EXIT 0. 타입 검사, HWM/native 102, 학습 35, 실행 63, 시나리오 15, 탐색 46 = **261개 통과**. 원시 로컬 로그: .runtime/headed-30/suite-final.log.
- 마무리 코드 리뷰 및 그 후 보완 결과는 아래에 덧붙인다. 개인 프로필/전체 DOM/원시 실행 로그는 공유하지 않는다.

### 마무리 코드 리뷰

Critical 0 / Important 3건을 재현해 수정했다. 지도 URL의 공통 마스킹 누락, content 차분의 사라진 name/aria-hidden 철회 누락, 재활용 DOM의 옛 N 읽기 대상 통과다. 세 테스트가 모두 RED인 것을 먼저 확인했다. URL은 공개/해시 전에 마스킹하고, optional content 필드는 철회하며, N 대상은 발급 당시 구조 경계를 검증한다. 실제 DOM tracking.id와 읽기 별칭을 분리하여 재관찰 뒤에도 옛 별칭이 다른 항목을 가리키지 않는다. 관련44개·타입검사가 통과했다. 첫 수정 검증 중 handle.evaluateHandle의 문자열 사용 오류로 읽기 회귀4개가 발생하여 실제 함수 호출로 바로잡았고, 44개 모두 다시 통과했다. 사이트 예외는 추가하지 않았다.

동일한 필드 철회 문제를 지도 이름에서도 RED→GREEN으로 확인했다. 구조 식별자가 원래 값으로 돌아오는 경우도 검증하여 폐기한 N 별칭을 복구하지 않고 새 별칭의 필드를 다시 전달한다. 최종 관련45개 통과. 이후 새로운 로그 파일에서 실행한 **전체 npm test EXIT 0: 타입 검사 + 106/35/63/15/46 = 265개 통과**. 최종 로그는 .runtime/headed-30/suite-release.log다. git diff --check도 통과했다. 같은 파일을 사용한 이전 병행 로그의 쓰기 충돌 결과는 최종 검증 근거로 사용하지 않았다.
