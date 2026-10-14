# HWM 0.2 구현 기록

브랜치: feat/hwm-0.2

기준: docs/HWM-0.2-consent.md. 사용자 요청에 따라 기존 미커밋 문서를 유지한 채 새 브랜치에서 순차 구현한다. 기존 JSON/실행 정책을 보존한다.

## 단계

- [x] 0: 문법 모델·파서·직렬화·검증, 합성 fixture, 참조 재시작/경계 검증
- [x] 1A: 본문·소속·누락·검색 근거 관찰 그래프와 JSON 확장
- [x] 1B: 동일 그래프의 최소 HWM 렌더러와 CLI 형식 선택
- [x] 2: 문서 사실·폼·그룹 상태
- [x] 3: 동일성 근거가 있는 변화·문서/탭 변화
- [x] 4: 펼침·링크 색인·관계 보존형 압축
- [ ] 5: 비용 검증 후 공간/형태 정보

## 구현 결정

- 단계 0의 파서는 뷰 표현을 AST로 읽는다. graph 없이 접힌 종점을 검증할 수 없으면 무조건 유효로 처리하지 않고 검증 문맥을 요구한다.
- source 미확인과 기본 출처는 별도로 보존한다. JSON 문자열/배열/객체를 공백 split 없이 읽고 중복 키를 거부한다.
- 참조 재시작 보호는 기존 e숫자 형식과 명령 스키마를 유지하면서 프로세스별 난수 epoch를 문자열 접두사로 포함하는 방식을 시험한다. 숫자 전체를 Number로 변환하지 않는다. 충돌 방지는 충분한 난수 공간에 의존하며 절대적인 전역 유일성으로 표현하지 않는다.
- CLI/수집기에는 단계 0에서 아직 HWM을 노출하지 않는다. 실제 노출은 관찰 그래프와 renderer가 함께 준비된 단계에서 시행한다.

## 검증 기록

작업 중 결과와 수정 이유를 여기에 누적한다.

### 단계 0

- view AST, JSON 토크나이저, 파서/결정적 직렬화/검증기를 구현했다. 내용은 실행하지 않는다.
- 합의문 fixture 4개를 고정 저장했다. HWM 검증 14개가 통과했다.
- 별도 프로세스 두 개의 실제 HB capture/execute 테스트에서 이전 e1이 다른 대상의 클릭을 실행하는 것을 RED로 재현했다.
- 128비트 난수 epoch + 고정 폭 카운터를 e숫자 문자열로 발급해 재시작의 이전 참조를 stale_ref/not_started로 거부했다. 동일 노드/guard 재사용, guard 변경, 내비게이션, 블록 한계도 검증했다.
- npm test 전체 통과: typecheck, HWM 14, learning 35, execution 62, chrome-manager 15, discovery 46. 총 172개. 새 실사이트 비교는 수행하지 않았다.
- Ruling: 기존 e숫자 호환을 위해 ref가 길어졌다. 소비 토큰 영향은 이후 렌더러 비교에 포함한다. 숫자를 Number로 변환하면 정밀도가 손실되므로 opaque 문자열로 취급한다.

### 단계 1A

- 기존 snapshot의 같은 페이지 평가 안에서 contextGraph를 수집한다. 별도 시점의 DOM을 기존 요소 목록과 몰래 섞지 않는다.
- 본문 텍스트, 유지 조상·형제 순서, 문단/목록/표/폼 경계, 링크·컨트롤, 좌표와 뷰포트 교차 상태를 보존했다. open shadow/slot도 중복 없이 관찰한다.
- native label·form owner·ARIA controls/owns의 명시 관계와 해소되지 않은 종점 근거를 기록한다. 접근 가능한 이름은 확인한 명시 출처만 주장하고 기존 합성 이름은 display로 구분한다.
- query는 그래프를 평탄화/필터링하지 않고 matches에 일치 필드를 기록한다. href.query는 URLSearchParams로 해석한 근거를 표시한다.
- 수집 한도/텍스트 예산/숨긴 하위 트리/미수집 프레임/오류를 gap으로 표현한다. 프레임 내부, closed shadow, 모든 접근 가능한 이름 알고리즘은 완료 범위가 아니다. closed shadow를 추측하지 않는다.
- `webctl snapshot --context [--context-limit N]`으로 JSON에 그래프를 추가한다. normal/fast RPC 경로 모두 연결했다. 기본 JSON 의미는 유지된다.
- 기존 redactText의 길이 상한과 마스킹을 분리해 긴 본문을 보존했다. 비밀번호 계열 입력과 textarea 원문은 redacted gap으로 남긴다. opaque 참조는 내용 마스킹을 적용하지 않는다.
- RED: 관찰 그래프 미구현 상태의 5개 fixture 실패를 확인했다. 추가 textarea 마스킹 테스트도 RED 확인 후 수정했다.
- GREEN: HWM 관련 20개, typecheck 통과. 전체 npm test 178개 통과. git diff --check 통과.
- Ruling: 단계 1A 공개 옵션은 --context이며 HWM 텍스트 view가 아니다. 다음 1B는 동일 그래프를 view로 투영하고 형식 선택을 제공한다. 실사이트 성능 향상 수치는 아직 없다.

### 추가 리뷰 보완과 단계 1B

- result.partial을 파서/검증기에 허용하고 단계별 결과·중단 위치를 보존했다.
- same-href 첫 후보 자동 선택 분기를 제거하고 일반 모호함 반환으로 통일했다. 서로 다른 핸들러의 동일 href fixture에서 실행 전 거부를 검증했다. 기존 discovery의 기대도 비병합 계약으로 갱신했다.
- 같은 그래프 평가와 후속 상태/차단 진단의 시점을 구분했다. 문서 세대 ID, collectionTiming, stateObservation을 제공한다. 수집 후 문서 이동을 강제로 삽입한 fixture에서 원래 그래프 유지 + 부분 관찰을 검증했다.
- 순수 renderer가 노드/간선/후보/gap 전체에 같은 actionRef 별칭 맵을 적용한다. 원문과 명시적 이름, legacy display를 구분한다. DOM 재접근 없이 결정적으로 출력한다.
- paragraph/heading은 child text/link 구조를 유지하며 content=children으로 표시한다. 부모에 전체 본문을 반복 복사하지 않는다. 명세에 이 구현 세부를 기록했다.
- snapshot --format hwm을 normal/fast CLI와 실제 daemon에서 검증했다. 현재는 full 최소 투영이며 개요/focus/expand/보관 API는 후속 범위다. 아직 성능 우월성을 주장하지 않는다.
- 전체 npm test 통과: HWM 26 + 기존 158 = 184. 별도로 동일-href 정책 비용/정확성 로컬 실험 12회를 수행했다. 동등한 링크에서는 +1 호출/약 +1초/비교용 payload +136토큰, 다른 핸들러에서는 기존 첫 선택 0/3→범위 지정 3/3이었다. [실험](../../benchmarks/hwm-samehref-2026-10-14/README.ko.md).
- Ruling: 이름/출처의 명세를 실제 브라우저 계산 출처와 추정 대체로 구분했다. placeholder가 실제 naming source로 확인됐을 때 보존할 수 있으나 현재 수집기에서 임의 승격하지 않는다.
- 다음 작업: 단계 2의 문서 개요·폼·그룹 상태 투영, 이후 관찰 보관/만료를 구현한 뒤 expand 노출. 수집/표현/실사용 비교는 분리한다.

### 단계 2

- 같은 페이지 평가에서 title/html lang/readyState/viewport/scroll과 URL 파라미터 쌍을 수집했다. 요청 locale을 브라우저 언어로 추정하지 않는다.
- form owner API에 따른 외부 입력 연결, 현재 값·체크 상태·마스킹 여부를 @state에 투영했다. URL 조건과 입력 값의 일치를 자동 판정하지 않는다.
- native select, 명시적 radiogroup/tablist, fieldset 체크/라디오 선택을 요약한다. 중첩 그룹은 별도 소속으로 처리한다. 숨김·미수집·판별 불가·open shadow 경계가 있으면 selected-complete=false로 둔다. 그룹 근거가 없는 입력은 개별 상태만 제공한다.
- status/aria-live는 원문 조각 ID와 결정적인 display 결합 규칙을 함께 유지한다. 공개 그래프가 저장된 뒤 DOM이 바뀌어도 renderer가 새 내용을 읽지 않는다.
- heading-outline-v1은 원래 관찰 순서에서 다음 동일/상위 제목까지의 파생 범위다. 제목 표시의 source node, 문단·링크·표 관찰 개수와 exact를 유지하며 실제 부모를 바꾸지 않는다.
- URL의 민감 키 값과 state params를 공통 경계에서 마스킹한다. 전체 그래프·JSON·HWM에 짧은 token/password 값이 그대로 나오는 것을 fixture로 검사했다.
- native checked/selected와 충돌하는 ARIA 선언을 덮어쓰지 않는다. 실제 DOM 값, 원본 ARIA, source/conflict를 보존하고 그룹 완결성을 보류한다.
- RED→GREEN: 수집 상태·문서 사실·그룹 상태·개요·status display·ARIA 충돌 fixture를 순차 검증했다.
- 검증: 전체 npm test 189개 통과 후 마지막 ARIA 충돌 보완에서 HWM 32개와 typecheck를 재검증했다. 기존 비HWM 실행 코드에 마지막 보완은 적용되지 않는다. git diff --check도 확인한다.
- 다음은 단계 3의 before/after 변화와 문서/탭 사건 연결이다. 아직 서버 expand/inspect 보관 API나 실사이트 성능 향상을 주장하지 않는다.

### 단계 3

- DOM 요소/텍스트에 실행 ref와 구별되는 WeakMap 추적 ID를 추가했다. 관찰 순서가 바뀌어도 같은 실제 노드의 필드만 비교하고 동일 마크업으로 교체한 요소는 매칭하지 않는다.
- id/data-key/data-id/href/role/type 및 조상 조건의 해시를 보조 가드로 사용한다. 변경되거나 64단계 조상 한도를 넘으면 동일성 확인을 보류한다. 사이트별 의미 규칙은 없다.
- text/name/value/checked/selected/expanded/pressed/disabled/busy/open/href의 changed/unchanged/incomparable를 구현했다. 부분 선택, null/미수집/마스킹, 선택 항목의 의미 가드 변경을 그대로 보류한다. 마스킹으로 같아진 값은 unchanged가 아니다.
- 같은 문서/범위의 완결된 관찰에서만 added/removed를 표현한다. 부분 관찰의 누락은 삭제로 단정하지 않는다. 이전/이후 주소와 ref 별칭 맵을 구분한다.
- 실제 popup 이벤트와 등록 ID를 @result.effect.newSessions 및 subject=session @change로 전달한다. 링크 target으로 새 탭을 추측하지 않는다. 요청 ID를 보존하고 after-request를 연결하되 인과/과업 성공을 추론하지 않는다.
- click/hover/fill/select/press/batch에 --context/--format hwm을 연결했다. 실제 입력/팝업/배치 partial/읽기 전용 diff 경로를 테스트했다. 입력은 한 번만 실행하며 관찰 실패가 기존 실행 상태를 덮어쓰지 않는다.
- Ruling: 문서 세대 식별 변경은 실제 DOM 문서 교체의 증명이 아니다. document-identity-changed + replacement=unconfirmed로 표시한다. 해시 이동/daemon 재시작에서 오해를 줄이며, 실제 교체도 보수적으로 미확정일 수 있다는 비용이 있다.
- Ruling: 단계 3 diff는 명시적으로 제공한 이전 snapshot JSON을 사용한다. 파일의 진위를 인증하거나 실행 권한으로 사용하지 않는다. 서버 보관/TTL/expand는 단계 4로 유지한다. 사용자는 이전 JSON을 보관해야 한다는 비용이 있다.
- JSON에는 그래프/변화만, HWM에는 해당 투영을 출력해 두 형식의 읽기 비용을 중복시키지 않는다. full 선택 기능이며 실사이트 성능 우월성은 측정하지 않았다.
- RED→GREEN: 신규 변화 테스트 10개 및 기존 CLI의 normal/fast 액션·diff·batch 옵션 검증을 추가했다. 마스킹 값 동일성, 선택 항목 재사용, 깊은 조상, 실제 세션 등록, 부분 배치까지 확인했다.
- 검증: 최종 npm test 종료 0, HWM 42 + learning 35 + execution 62 + scenarios 15 + discovery 46 = 200개 통과. typecheck 포함. git diff --check 통과.
- 중간 회귀 한 번에서 기존 transport.mjs의 30ms 타임아웃 fixture가 첫 원 요청보다 상태 조회를 먼저 수신해 ids[0] 가정이 실패했다. 단독 통신 9개와 최종 전체 재실행은 통과했다. 통신 구현은 이 사유로 변경하지 않았다. 테스트의 부하 의존 타이밍 가정은 후속 개선 후보다.
- 다음은 단계 4의 제한된 관찰 보관·만료, expand/inspect, 링크 색인과 관계 보존 접기다.
### 0.2 外부 리뷰 보완 — 단계 4 준비

- 변화 접기를 op로 넣지 않고 gap 투영 확장으로 다루며, 보유 변화 목록의 완결성과 before/after DOM 관찰 완결성을 분리하도록 합의 명세를 보강했다. 비교 ID·관찰별 별칭·원래 범위를 함께 보관하는 계약을 추가했다. 실제 보관/펼침/접기 API는 아직 구현하지 않았다.
- 래퍼 축약과 하위 트리 접기를 구분하고 첫 축약 대상을 정보 없는 단일 자식 체인으로 제한했다. 관계 양 끝/실행/상태/개요/분기/스크롤/gap 경계를 보존한다. @outline 집계·제목 expand 범위는 뷰가 아닌 정본 순서를 기준으로 고정했다.
- 기존 collector에 aria-hidden과 CSS overflow/client/scroll 크기/offset 사실을 보강했다. 숨긴 요소도 경계 노드·원본 선언·미관찰 gap으로 남기되 하위 본문/입력값은 수집하지 않는다. 미확인 heading level은 null을 허용하고 레벨 기반 outline에서는 제외한다.
- renderer가 제3 관찰 주소를 이전 관찰 별칭으로 치환하던 잠재 경로를 발견했다. before/after 각각 정확한 관찰 맵에 있는 노드만 허용하도록 수정했다. removed/added에 동일 n2가 있지만 e41/e42로 달리 치환되는 fixture와 외부 관찰 거부를 RED→GREEN으로 검증했다.
- 참조 상태 준비/페이지 평가/결과 전송/바인딩/최종 handle 해제 시간을 분리했다. 참조 등록 수와 비동기 해제 대기·누적 완료/실패·무효화 해제 경과시간을 추가했다. 기존 epoch, 1200 등록 참조 상한과 stale_ref 가드는 유지했다.
- Ruling: registeredReferences는 호스트 등록 수이며 연결된 DOM/브라우저 RemoteObject 총수나 GC 완료를 증명하지 않는다. 해제 비동기 완료는 별도 측정한다. 메모리 누수 부재를 과잉 주장하지 않는 대신 추가 프로파일링은 남는다.
- HB 로컬 측정: 버튼 10/100/300개 각 3회. 300개 중앙값 전체 424.4ms, 페이지 평가 12.8ms, 전송 81.5ms, 바인딩 343.0ms. 순수 DOM 시간/정확한 CDP 호출 수/실사이트 결과가 아니다. 지연 바인딩의 검토 근거이며 방식 자체는 변경하지 않았다. benchmarks/hwm-reference-phases-2026-10-14에 코드·raw 결과·해석을 보존했다.
- 검증: 신규 5개 fixture와 기존 fixture의 unknown heading 보완을 RED→GREEN으로 확인. 같은 화면 12회 등록 수 유지, 문서 이동 후 해제, 경계 사실, 숨긴 본문 미노출, 주소별 별칭 검증. 최종 npm test EXIT=0: HWM 47 + learning 35 + execution 62 + scenarios 15 + discovery 46 = 205개 통과. typecheck 포함. git diff --check 통과.

### 단계 4 — 보관·조회·투영·접기

- ObservationStore/ObservationService를 추가했다. 세션 범위, 조회 TTL 5분(접근으로 연장하지 않음), FIFO 관찰/비교 각 32개, 공유 직렬화 16MiB/단일 항목 2MiB로 제한한다. 투영 계획은 별도 32개/4MiB다. 논리 만료는 읽기/쓰기에서 검사하고 지연 정리한다. 전체 Node/Chrome/RPC 메모리 상한을 주장하지 않는다.
- graph/비교를 마스킹·복사해 보관하고, 정본의 부모 순서/고유 ID·실행 ref를 검사한다. 부모 순환을 저장 전에 거부한다. public tracking 해시는 semanticEncoding=sha256으로 재마스킹에도 동일성을 보존한다.
- observation.view/expand/inspect/changes 및 CLI view/expand/inspect/changes를 연결했다. 저장 데이터 조회는 Chrome 연결/현재 DOM/학습을 호출하지 않는다. session close 시 보관을 정리한다. TTL/퇴출/범위 불일치가 명확한 오류로 나온다.
- 기본 JSON/full을 유지한다. overview/focus는 원래 조상·항목/문단/폼 맥락·외부 명시 관계/레이블·렌더링된 dialog 선언을 보존한다. 필수 폐쇄 때문에 node-budget은 soft이며 출력에 드러낸다. 실제 가림 판정은 하지 않는다.
- 정보 없는 단일 자식 div/span만 투영에서 축약하고 via로 원래 조상을 남긴다. 경계/상태/이름/분기/참조는 축약하지 않는다. 정본 개요와 제목 펼침 범위는 투영에서 재계산하지 않는다.
- 구조 해시는 kind/tag/role/속성 이름/자식 구조만 비교한다. 반복 구조와 실제 내용 동일성을 혼동하지 않는다. 미표시 노드의 roots/order, nodes/items 개수, 원래 텍스트와 상태를 보관한다. gap.expand는 실제 조회 가능한 gap ID다.
- 긴 주 문자열은 Unicode code point 단위로 접고 원래 길이/표시 길이/누락 개수·필드를 남긴다. full은 별도 텍스트 예산이 없으면 자르지 않는다. gap을 펼치면 같은 관찰의 원문을 읽는다.
- 링크 색인은 독립 실행 ref를 모두 보존한다. URL 해소 실패는 raw-href, 마스킹된 목적지는 개별 ref로 표시하며 병합하지 않는다. 관찰한 목록의 정확성과 전체 scan 완결성을 구분한다.
- 변화 gap은 별도 comparison ID/원래 변화 ID 목록을 보관하고 changes-complete와 before/after scan을 분리한다. removed의 이전 alias와 after의 alias를 각 관찰에서 해소한다. 상태/실행 ok/partial/outcome_unknown은 투영 성공으로 바뀌지 않는다. 보관 거부 시 full 근거와 retention unavailable를 반환한다.
- 별도 read-only 리뷰 1회에서 P1 직접 actionRef 펼침 오류, P1 기존 민감 필드 정책 불일치, P2 surrogate 절단을 재현했다. 각각 회귀 테스트 RED→GREEN으로 수정했다. secret(el)을 기존 snapshot/graph가 공유해 cc-*, one-time-code, cvc/cvv/otp/ssn, password/token/secret/api-key 값을 저장/inspect/expand에서도 제외한다.
- Ruling: 이 단계는 관찰 수집/투영/보관의 계약 검증이다. 캐시 예산은 직렬화 추정값이며 TTL은 조회 유효기간이다. 브라우저 GC/전체 힙 한도 또는 실사이트 성능 개선을 증명하지 않는다. 더 엄밀한 총 메모리 프로파일링은 별도로 남는다.
- Ruling: 필수 조상·관계·상태 맥락을 우선해 노드 예산을 soft로 두고 초과를 명시했다. 반복 항목의 모든 차이를 한 줄에 무조건 복사하지 않고 접힌 원문을 조회 가능하게 보관한다. 일부 작업에는 추가 펼침 호출이 필요할 수 있다. 기본 full/JSON은 유지한다.
- 최종 검증: npm test EXIT=0, HWM 60 + learning 35 + execution 62 + scenarios 15 + discovery 46 = 218개 통과. 마지막 CLI 도움말 보완 후 CLI 회귀 1개와 typecheck를 재확인했다. git diff --check 통과. 새 stage4 fixture는 store 4 + projection 8 + daemon 1 = 13개다.
- 다음: 단계 5의 선택적 위치/가림/가시 상자 계산과 비용 측정, 또는 기존 수집/B JSON/C HWM의 이해도·실사용 분리 검증. 4단계 완료가 HWM 우월성의 증거라는 주장은 하지 않는다.
## 2026-10-14 18:58:40 +09:00 — 실전 단회 후 공통 보완

- 6개 사이트 각각1회, Luna 순차(HB만/학습OFF). 상세 보고 benchmarks/hwm-live-2026-10-14/report.md, 후보 improvement-candidates.md. 제품 변경 전 결과이며 비교 성능개선율을 주장하지 않는다.
- 위 단계4의 '보관거부 시 full 출력' 정책을 정정한다. 실측 949,751바이트 폭증 원인이 projection 옵션 누락이었다. 이제 요청한 투영을 유지하고 미보관 숨김을 unavailable/collected=true/구체reason으로 표시하며 expand를 발급하지 않는다.
- 보관 거절 메타정보는 내용 없이 관찰 개수/TTL 상한 안에서 보존한다. 원시 gap의 펼침 불가와 목록 Unicode 잘림 메타정보도 공통계층에서 보완했다. 특정 사이트/버튼/광고 의미 분기를 추가하지 않았다.
- RED: tests/hwm-live-regressions.mjs 4/4 실패를 확인한 뒤 GREEN 4/4 통과. npm test 최종 EXIT=0: HWM64 + learning35 + execution62 + scenarios15 + discovery46 = 222개. typecheck 포함 통과. git diff --check 통과.
- 사이트별실행을 재시행하지 않았고 보완후실사이트효과는 미검증이다. 본문 우선 범위/수집 예산과 저장 후보 검색은 후속설계로 남겼다.

## 2026-10-14 21:08 +09:00 — GPT-6 Codex: 기존 능력과 HWM 통합

사용자의 목적을 다시 확정했다. 기존 도구와 HWM을 두 탐색 방식으로 나누는 것이 아니라, 기존 조작·발견 능력과 본문·소속·맥락을 한 관찰에 담아 전달한다. 일반 CLI는 HWM/overview, JSON은 같은 모델의 스크립트 호환 형식이다. 설치된 별도 스킬 사본은 손대지 않았다.

선택 실행 요소·본문 query·조상·주변 내용을 예산 앞에서 예약하고, 파생 display/hint/context와 숨김 발견/openWith/textHits/진단의 출처를 보존했다. 스타일/rect 재사용, 빈 단일 래퍼 via-dom 압축, 선형 개요와 지연 참조 핸들로 비용을 줄였다. 새로운 5단계 공간 계산은 구현하지 않았다.

일반 조작은 보유 이전 관찰과 대상 주변 조작 후 관찰을 비교한다. 전후 전체 이중 수집을 기본으로 강제하지 않는다. 이전 자료가 즉시 실행 전 상태라고 주장하지 않으며 없으면 no-prior-observation이다. TTL/메모리 제한을 재사용했고 별도 무제한 캐시는 두지 않았다.

신선한 최종 리뷰가 Important 4건을 실제 공통 HTML로 재현했다: forms optional undefined 문법 오류, forms 민감 필드/URL 마스킹 정책 불일치, textarea 내용의 discovery 후보 누출, 예산 뒤 본문 query/소속 유실. 같은 사례의 실패 테스트를 확인하고 정규화된 값·공통 private-field 정책·본문 query 예약으로 수정했다. 사이트별 예외는 추가하지 않았다.

최종 전체 npm test EXIT=0: HWM74 + learning35 + execution62 + scenarios15 + discovery46 = 232개와 타입 검사 통과. 기본 CLI/JSON 호환/참조 수명/새 팝업/배치 partial/결과 불명/저장 조회와 기존 discovery 검사를 포함한다. 정보 보존표 docs/HWM-0.2-preservation.md, 통합 계획 docs/plans/HWM-0.2-integration.md에 변경 근거를 남겼다. 실사용 우월성은 아직 단정하지 않는다.

## 2026-10-14 21:22 +09:00 — GPT-6 Codex: 통합 검증 마무리

기본 뷰의 raw box/space 상세를 full/inspect로 옮겼다. detail-projection으로 축약을 선언하고 기존 view/스크롤 경계와 정본 좌표는 보존한다. 새 공간 관계 계산은 하지 않았다. 해당 회귀를 RED→GREEN으로 확인한 최종 npm test EXIT=0: HWM75 + learning35 + execution62 + scenarios15 + discovery46 = 233개 및 타입 검사 통과.

신선한 브랜치 리뷰의 Important 4건을 공통 회귀로 수정했고 Critical/미해결 Minor는 없다. 고립된 로컬 수집 비용의 30/100/300항목 중앙값은 기준선 대비 -26.2%/-30.5%/+5.7%, p95는 -13.8%/-35.2%/+9.8%로 목표를 통과했다. 외부 실전 브라우저가 살아있던 노이즈 측정도 별도 보존했다. 렌더링과 출력량은 별도 수치다. 풍부해진 HWM 출력은 기존 제어 중심 JSON보다 크므로 전체 토큰 절감을 주장하지 않는다. 원시 수치와 한계는 benchmarks/hwm-integration-2026-10-14/README.ko.md에 남겼다.

통합 기본 흐름 실전은 Luna 한 명씩 각1회/학습OFF: Best Buy 국가선택 뒤 미진행, Walmart headed 후에도 CAPTCHA, Expedia 정상 홈 뒤 에이전트가 ref 없는 노드에서 조기 중단하여 모두 요청 체크포인트0/4. eval0은 성공 전에 중단한 결과라 효율증거가 아니다. Walmart pending 세션오류/재오픈과 초기 안내의 sessionId/id 오류, Expedia 역할·이름 선택법 미활용을 제품 실패와 구분했다. 기존 역할·이름·레이블·맥락 조작 능력은 회귀 검사로 유지됐고 프로젝트 스킬 안내도 보강했다. 재시행은 하지 않았다. 원시 집계/루트 정정은 benchmarks/hwm-integrated-live-2026-10-14/report.md에 있다.

Ruling: 이 통합의 완료 기준은 하나의 관찰 흐름/정보 보존/실행 호환/수집 비용 검사이며 실전 성공률·토큰 우월성은 별도 검증이다. 잘못 이해하면 아직 입증하지 않은 효율을 제품 강점으로 과장할 수 있으므로 측정 한계를 명시한다. main은 변경·병합·푸시하지 않고 승인된 feat/hwm-0.2 브랜치만 커밋/일반 푸시한다.
