# HWM 0.2 — 최종 설계 방향과 최소 구현 인계안

작성: 2026-10-14 14:54:59 +09:00 (Asia/Seoul) · GPT-6 (Codex)

상태: 설계 인계 문서. HWM 0.2 런타임 구현·성능 검증 완료 보고가 아니다.

이 문서는 사용자와 확정한 목표, HWM 0.1 이후 논의, Claude Opus 5.5와 교환한 의견, 기존 실험 기록 검토를 종합한다. 다음 작업자는 핵심 계약을 구현으로 옮기고 실제 출력으로 검증하면 된다. 모든 세부 기호를 더 논의하기 위해 구현을 무기한 미루지 않는다.

## 1. 목적과 취지

웹의 내용·맥락·소속·순서·위치·관계·상태·변화를 최대한 기계적이고 결정적인 알고리즘으로 수집·계산하고, 정해진 문법으로 LLM에 전달한다. LLM은 이 근거로 의미와 다음 행동을 판단한다.

단순한 컨트롤 목록이나 평탄한 텍스트를 넘어, 다음 질문에 답할 근거를 제공하는 것이 목적이다.

- 이 값은 어느 항목·섹션·문서에서 나온 것인가?
- 같은 이름의 요소 중 지금 요청에 맞는 대상은 무엇인가?
- 이 항목은 입력란의 후보인가, 다른 영역의 링크인가?
- 입력값·선택 상태·결과 문구가 각각 어떻게 보이는가?
- 조작 후 무엇이 변했으며 무엇은 확인하지 못했는가?
- 지금 출력에 없는 내용은 실제로 없는가, 접었는가, 읽지 못했는가?

기존 앱이 무용하다는 전제로 시작하지 않는다. 현재 요소 참조, 상태 확인, 후보 반환, 문맥, 결과 관찰은 유효한 기반이다. 개선 목표는 이 기반에서 정보 누락·출처 혼합·추가 탐색을 줄이는 것이다.

기호 변경 자체의 성능 향상을 가정하지 않는다. 특히 기대하는 이득은 본문과 관계를 함께 수집하여 한 번의 관찰에서 다음 판단의 근거를 더 충분히 전달하는 데 있다. CAPTCHA·접근 거부·네트워크 오류를 문법이 해결한다고 주장하지 않는다.

## 2. 사용자와 확인한 대원칙

1. **특정 사이트용 예외를 공통 엔진과 문법에 누적하지 않는다.** 도메인, 특정 쿼리 키, 특정 사이트 문구에 기반한 업무 의미 판정 규칙을 만들지 않는다. 사이트 기록은 범용 규칙의 검증 사례다. 의도된 사이트별 자산·절차와 공통 엔진의 예외 분기를 혼동하지 않는다.
2. **LLM에 풍부하고 정확한 판단 근거를 전달한다.** 기계적으로 계산할 수 있는 관계는 적극적으로 제공한다. 사실, 계산, 추정, 미관찰을 구별한다. 업무 의미·과업 충족 여부를 근거 없이 앱이 대신 확정하지 않는다.
3. **축약해도 관계의 흔적을 보존한다.** 조상·연결·순서·출처를 조용히 없애지 않는다. 생략 범위와 추가 관찰 가능성을 표시한다.
4. **결정성의 기준은 동일 관찰 데이터다.** 같은 관찰 그래프·규칙 버전·옵션이면 같은 출력이어야 한다. 같은 URL의 동적 페이지가 항상 같다는 뜻이 아니다.
5. **판단 불가는 정상적인 정보다.** 근거가 부족한 상태를 false, 비어 있음, 성공, 안전으로 치환하지 않는다.

## 3. 0.1 이후 핵심 변경

| 항목 | 0.2 방향 |
| --- | --- |
| 표현 | 단일 관찰 그래프에서 hwm/graph와 hwm/view 생성 |
| LLM 가독성 | 유지 조상 관계를 들여쓰기로 표현하고 제목·핵심 관계를 가까이 배치 |
| 내용 | 본문·가격 문구·평점·재고·설명을 조작 요소와 같은 구조에 포함하는 일을 최우선 구현 |
| 검색 | query/scope/match와 후보의 소속·선택 근거 제공 |
| 이름 | text / accessible-name / display / actionRef 구분 |
| 상태 | URL 파라미터·폼 값·status 문구를 출처와 함께 나란히 표시 |
| 그룹 | 선택된 노드 참조와 관찰 완결성 제공 |
| 변화 | 필드 변화·비교 불가·관찰 범위 내 변화 없음·문서 교체·새 탭 표현 |
| 반복 | 구조 설명은 공유하되 항목별 차이는 보존; 초기 문법은 한 줄 한 노드 |
| 누락 | 종류(kind)와 원인(reason)을 구별 |
| 위치 | 이미 얻은 좌표·클리핑 보존, 비싼 추가 관계 계산은 후순위/요청 기반 |
| 검증 | 표현 효과와 추가 수집 효과를 분리해 측정 |

본문·표·인라인 링크 보존은 0.1에도 요구돼 있었다. 0.2에서 새롭게 명확해진 것은 구현 우선순위와 실제 출력 계약이다.

## 4. 아키텍처와 현재 코드 연결

```text
브라우저 관찰 + 기존 실행 참조
            ↓
단일 관찰 그래프 (노드·관계·출처·범위·상태)
            ├─ hwm/graph: 상세 레코드·검증·보관
            ├─ hwm/view: overview / focus / full
            └─ 관찰 간 비교: 변화 + 실행 결과 연결
```

두 직렬화는 같은 모델을 사용한다. 뷰를 만들기 위해 독립적으로 의미를 추측하거나 브라우저를 다시 읽지 않는다. 새 수집이 필요하면 새 관찰을 생성한다.

연결 지점은 다음과 같다. 구현 전에 최신 파일과 다른 에이전트의 변경을 확인한다.

- `src/runtime/snapshot.ts`: 현재 요소·상태·문맥 수집을 구조·본문 그래프로 확장.
- `src/runtime/discovery-tools.ts`: forms/list 결과가 동일 그래프의 범위·관계·노드를 참조하도록 정리.
- `src/runtime/references.ts`: 기존 실행 참조와 가드를 활용. HWM 전용 실행 참조 시스템을 중복 구축하지 않음.
- `src/runtime/output.ts`: 현재 compact 출력이 snapshot이나 변화값을 생략하는 경로를 고려해 HWM 전용 투영을 둠.
- `src/engine/page-state.ts` 및 기존 effect/popups 경로: 문서 상태·열린 UI·새 세션·변화를 공통 모델에 연결.
- CLI/서버: 기존 JSON 호환 경로를 유지하고 명시적인 형식 선택으로 시작. `--format hwm`은 제안 옵션이며 현재 지원을 주장하지 않음.

정확한 새 파일명은 구현 시 정하되, 관찰 모델·뷰 렌더러·변화 비교를 분리한다. 불필요한 거대 프레임워크를 만들지 않는다.

## 5. 첫 단계부터 지킬 데이터 계약

### 5.1 관찰과 실행 참조

- 관찰 ID, 세션 ID, 문서 인스턴스 ID, 관찰 시각을 구분한다.
- 모든 정본 노드에는 ID가 있다. 텍스트 노드도 예외가 아니다. 뷰에서 주소를 일부 숨기는 최적화는 나중에 가능하다.
- 노드 ID는 관찰용, actionRef는 실행용이다. 두 주소를 혼동하지 않는다.
- 동일 ID 문자열이 다른 관찰에서 같은 대상이라는 보장은 없다. 비교 시 실제 추적 근거를 사용한다.
- 노드가 같은지 확인하지 못하면 같은 노드의 값 변경으로 합치지 않고 추가/제거 또는 비교 불가로 표현한다.
- 참조가 오래됐거나 의미가 바뀐 경우 현재 페이지를 다시 관찰한다. 비슷한 대상으로 임의 대체하지 않는다.

### 5.2 이름·본문·표시

| 필드 | 계약 |
| --- | --- |
| text | 취득 방법을 명시한 본문 조각. 원문 순서와 문단·목록·셀 경계를 보존 |
| accessible-name | 확인한 접근 가능한 이름. 미확인일 때 display를 대신 넣지 않음 |
| display | 선택적인 표시용 합성 문자열. 결합 규칙 버전과 source 노드 목록을 정본에 유지 |
| actionRef | 기존 참조 계층이 발급한 조작 대상 주소 |

접근 가능한 이름의 출처는 attribute(aria-label 등), labelledby, native-label, contents, alt, title 등 수집기가 실제 확인한 범주로 고정한다. placeholder만 읽었으면 placeholder로 표시하고 접근 가능한 이름이라고 자동 승격하지 않는다. 복수 근거는 정본에 배열로 유지할 수 있다.

시각적으로 숨김과 접근성 트리에서 숨김을 구분한다. aria-hidden이나 clip만으로 텍스트 중복을 판정하지 않는다. 초기에는 같은 항목 내 정확한 중복의 표시 축약만 고려하며 원래 노드·출처는 정본에 남긴다. 서로 다른 카드의 같은 가격은 합치지 않는다.

### 5.3 구조와 관계

- 들여쓰기는 유지한 composed-tree 조상 관계다. 장식용 래퍼만 축약하며 원본 직접 부모와 다를 수 있다.
- 실제 heading/section/article 등의 구조와 제목 레벨로 만든 파생 개요를 구분한다. 파생 섹션을 실제 부모처럼 끼워 넣지 않는다.
- 명시적 관계: label, form owner, controls, describes, owns, table header 등.
- 기하학적 관계: above/below/left-of/overlaps 및 규칙이 명시된 근접.
- 파생 문맥: 제목 개요·반복 구조 등 규칙 버전을 가진 계산.
- 관계의 종점은 선언된 노드다. 해소되지 않은 속성은 unresolved로 기록하고 가짜 대상 노드를 만들지 않는다.
- 같은 href는 같은 동작의 증명이 아니다. 목적지 색인에서 참조를 묶어 보여줄 수 있지만 실행 노드를 합치거나 대표를 자동 선택하지 않는다.

### 5.4 URL·수치·시간

- 원본 href, 기준 URL, 해석한 절대 URL을 구분한다. 비교용 정규화가 실행 목적지를 바꾸면 안 된다.
- URL도 JSON 문자열로 인용한다. 쿼리는 중복 키와 순서를 보존할 수 있는 쌍 배열로 유지한다.
- hrefDiff는 origin/path/query/fragment의 기계적 차이다. 안전성·검색·구매 등의 의미 분류가 아니다.
- `href="#"`는 이동 없음이라는 뜻이 아니다. target 속성도 실제 새 탭 생성과 구분한다.
- 페이지에 표시된 숫자와 실제 관찰한 노드 수를 분리한다.
- 단위·표 레이블·지역·상대 날짜·관찰 시각의 소속을 유지한다. 요청 locale, html lang, 브라우저 시간대, 사이트에 명시된 시간대는 서로 다른 사실이다.

### 5.5 범위와 누락

| kind | 의미 |
| --- | --- |
| folded | 수집했지만 이번 표현에서 접음 |
| unobserved | 아직 수집하지 않음 |
| unavailable | 접근/취득하지 못함 |
| redacted | 값이 마스킹됨 |

reason은 budget, query-filter, capture-error 등 별도 원인이다. 원인 미확정을 허용한다. 불투명한 요소를 보고 closed-shadow라고 추측하지 않는다.

스캔 완료는 선언한 범위 안에서의 완료다. 정상 출력 종료와 별개다. 완전한 DOM 수집을 웹의 무한 목록 전체 수집으로 해석하지 않는다.

실행 결과의 not_started/completed/outcome_unknown, 오류, 요청 ID를 유지한다. 실행 완료·관찰된 변화·사용자 과업 충족은 각각 다른 사실이다.

## 6. 초기 hwm/view 문법 제안

초기 구현은 별도 인라인 자식 압축 문법을 만들지 않는다. **한 줄은 한 노드이며 속성은 그 줄에 둔다.** 관계·상태 투영·변화·누락은 예약 레코드로 구별한다.

```text
document := header LF { node-line LF | record LF } end [LF]
header   := "@hwm " observation-id " version=\"0.2\"" { SP attribute }
node-line:= indent node-id SP kind { SP attribute }
record   := record-tag SP record-id { SP attribute }
record-tag := @edge | @state | @candidates | @result | @change | @gap
end      := "@end " observation-id { SP attribute }
indent   := 두 칸의 배수인 공백; 첫 노드 깊이는 0
attribute:= key "=" JSON-value
```

- JSON-value는 한 줄 JSON 값이다. 문자열·URL은 항상 인용한다. 객체/배열 내부 공백은 JSON 파서로 소비하므로 단순 공백 split 파서를 쓰지 않는다.
- ID·kind·key는 제한된 ASCII 식별자다. ID의 접두사로 실행 가능성을 결정하지 않는다. 실행 가능성은 actionRef로 표시한다.
- 속성 중복은 오류다. 필드 순서와 레코드 출력 순서는 고정한다. 노드는 유지 트리 전위 순회와 원래 형제 순서로 출력한다. 간선은 문서화한 순서로 정렬한다.
- 들여쓰기 증가는 한 단계만 가능하며 부모는 직전 상위 깊이의 노드다. 레코드는 최상위에 쓰며 노드 스택을 변경하지 않는다. 관련 범위는 parent/from/to 등으로 명시한다.
- 첫 노드는 document 루트다. 일반 노드 ID는 관찰 안에서 유일하며 graph/view가 같은 ID를 사용한다. 헤더/end는 같은 관찰 ID다.
- view의 text/name/display 등은 해당 출처를 나타내는 필드다. 인용된 모든 문자열이 반드시 원문이라는 잘못된 범례를 쓰지 않는다. 합성 display도 인용한다.
- 정본과 뷰 모두 같은 버전의 관찰 모델이다. 알 수 없는 버전은 명시적으로 처리하며 조용히 다른 의미로 파싱하지 않는다.
- @state는 원본 노드/URL의 투영, @candidates는 검색 결과의 참조 목록이다. @result는 명령 실행 메타데이터로 관찰 트리와 구별한다.
- @change는 before/after 관찰 참조와 비교 범위를 가진다. 새 탭 등 문서 수준 이벤트도 이 레코드에서 구별한다.
- @end가 없으면 전송이 잘렸음을 인지해야 한다. complete=true는 메시지 종료의 완결성이며 모든 웹 내용 수집을 뜻하지 않는다.

이 문법은 두 안을 구현 가능한 최소 형태로 묶은 권고안이다. 기존 CLI 명령이 아니다. 구현자가 같은 계약을 더 간결한 표기로 옮길 수 있으나 예시·파서·범례를 함께 일관되게 변경해야 한다.

## 7. 우선 구현할 세 가지 출력

아래 예시는 모두 합성 fixture다. 과거 사이트 DOM을 복원했다고 주장하지 않는다. 생략 없이 표현한 작은 fixture이며 actionRef는 예시다.

### 7.1 본문과 조작 요소가 함께 있는 구조 출력

**목표:** 가격 문구·평점·설명·배송 상태를 별도 평탄 eval로 읽지 않고, 어느 항목 소속인지 보존한 채 읽는다.

```hwm
@hwm p1 version="0.2" session="s1" document="d1" url="https://example.test/search" view="overview" scan={"scope":"fixture","complete":true}
n1 document
  g1 region tag="main"
    h1 heading text="Results" text-source="dom-text" level=1
    g2 list
      g3 item
        t1 text text="Wireless Mouse A" text-source="dom-text"
        t2 text text="$18.40" text-source="dom-text"
        t3 text text="Free shipping" text-source="dom-text"
        n2 link accessible-name="Details" name-source="contents" actionRef="e31" href="/item/a"
      g4 item
        t4 text text="Wireless Mouse B" text-source="dom-text"
        t5 text text="$16.00" text-source="dom-text"
        t6 text text="$8 shipping" text-source="dom-text"
        n3 link accessible-name="Details" name-source="contents" actionRef="e32" href="/item/b"
@end p1 complete=true
```

수집 규칙:

- 본문은 소유하는 텍스트 조각으로 수집하고, 부모에 자식 전체 innerText를 중복 복사하지 않는다.
- 문단·목록·표·인라인 링크의 순서와 경계를 보존한다. 코드/pre 등의 공백·개행은 별도 정규화 정책을 적용한다.
- 조작 요소가 포함하는 본문 조각과 accessible-name의 중복은 출처로 연결한다. 두 표현을 서로 다른 독립 사실처럼 세지 않는다.
- price/product 같은 업무 이름을 자동으로 붙이지 않는다. 위의 $18.40과 배송 문구는 원문이며 해석은 LLM이 한다.
- 표는 행·셀·헤더 관계, 이미지/canvas는 확보한 alt/caption과 시각 정보 미취득 범위를 남긴다.

최소 완료 기준: 각 텍스트와 링크의 항목 소속을 복원할 수 있고, 다른 항목의 값이 섞이지 않으며, 내용이 없는 상태와 출력에서 접은 상태를 구별한다.

### 7.2 소속·일치 근거가 붙은 후보 출력

**목표:** 이름만 같은 링크, href 때문에 검색된 요소, 추천 카드와 입력 후보를 구분할 근거를 제공한다.

```hwm
@hwm p2 version="0.2" session="s1" document="d2" url="https://example.test/find" view="focus" scan={"scope":"fixture","complete":true}
n1 document
  g1 form
    n2 control role="combobox" accessible-name="Enter destination" name-source="aria-label" actionRef="e41" value="" expanded=false
  g2 group
    h1 heading text="Trending destinations" text-source="dom-text" level=2
    n3 link accessible-name="New York, United States" name-source="contents" actionRef="e42" href="/city/new-york"
  g3 group
    n4 link accessible-name="Hotels" name-source="contents" actionRef="e43" href="/search?city=New%20York"
@candidates q1 query="New York" scope="n1" matches=[{"node":"n3","field":"accessible-name"},{"node":"n4","field":"href.query","transform":"url-search-params-v1"}] complete=true
@end p2 complete=true
```

후보 출력은 검색어가 일치한 영역만 잘라내지 않고 이해에 필요한 조상과 연결 대상을 유지한다.

구현 확인점:

- query/scope/match를 제공하고 부분 일치·정규화·URL decode 등의 검색 규칙에 버전을 붙인다.
- 동일 이름 후보의 소속·상태·주변 제목·href 차이를 예산 축약으로 없애지 않는다.
- 입력란의 controls 등이 확인됐을 때만 후보 목록과의 명시적 관계를 출력한다. 단어 일치로 연결을 만들지 않는다.
- 조작을 방해하는 열린 dialog나 실제 interceptor를 focus에서 누락하지 않는다. aria-modal만으로 배경 전체가 가려졌다고 단정하지 않는다.
- 실제 후보와 조작 대상은 기존 reference 계층에서 일관되게 연결한다. 축약한 표시 이름을 locator로 변환하지 않는다.

최소 완료 기준: 이름만 같은 두 대상, href만 일치한 대상, 별도 추천 영역의 대상을 구별할 수 있다. 전체 후보 수와 표시한 후보 수 및 누락을 구분한다.

### 7.3 값과 주변 상태의 변화 출력

**목표:** 입력/클릭 완료를 과업 성공으로 오해하지 않고, 다음 행동을 판단할 수 있게 한다.

```hwm
@hwm p11 version="0.2" session="s1" document="d2" url="https://example.test/find" view="focus" scan={"scope":"fixture","complete":true}
n1 document
  g1 form
    n2 control role="combobox" actionRef="e51" accessible-name="Enter destination" name-source="aria-label" value="" expanded=false
  g9 dialog accessible-name="Sign in" name-source="aria-label" open=true
@result x1 request="req7" execution="completed"
@state st1 form="g1" fields=[{"node":"n2","value":""}] complete=true
@change c1 before={"observation":"p10","node":"n2"} after={"observation":"p11","node":"n2"} field="value" old="New York City" new="" identity-basis="tracked-dom-node" attribution="observed-after" request="req7"
@change c2 before={"observation":"p10","scope":"n1"} after={"observation":"p11","node":"g9"} kind="added" attribution="observed-after" request="req7"
@end p11 complete=true
```

이 예시는 p10에 입력값과 dialog 부재를 실제로 관찰했다는 fixture 전제다. 실행 요청의 입력값을 이전 관찰값으로 대체하면 안 된다. 사전 관찰이 없으면 old를 꾸며내지 않고 비교 불가를 표시한다.

구현 요점:

- 대상의 값·checked·selected·expanded 등과 연결된 목록·폼·dialog를 비교한다.
- unchanged는 같은 필드·범위의 두 관찰로 한정한다. 비교하지 않은 부분을 변화 없음으로 표현하지 않는다.
- DOM 동일성이 확인되지 않으면 값 변경 대신 추가/제거 또는 비교 불가로 남긴다. 같은 DOM 노드여도 의미 재사용 여부는 기존 참조 가드로 별도 확인한다.
- URL 파라미터, 폼 값, role=status/aria-live 텍스트는 각 출처를 유지해 나란히 보여준다. 서로 일치한다는 판정을 자동으로 붙이지 않는다.
- aria-busy는 해당 노드의 상태다. 페이지 전체 로딩 상태로 자동 확장하지 않는다.
- 새 탭은 별도 문서/세션으로, opener는 관찰한 관계로 연결한다. 클릭 직후 생성됐다는 사실과 확정적인 인과관계를 구별한다.
- outcome_unknown과 요청 상태 조회를 유지한다. 관찰 불명 상태에서 명령 자동 재전송을 유도하지 않는다.

최소 완료 기준: 실행 완료, 값 확인, 상태 변화, 작업 성공을 구별한다. 값 불일치·새 dialog·새 문서·변화 미관찰을 손실 없이 표현한다.

## 8. 상태 투영·펼침·예산

### 상태 투영

@state는 원본 데이터의 참조 뷰다. 별도 상태 데이터베이스를 만들지 않는다. 그룹 선택값은 선택된 노드 ID와 이름을 함께 참조한다. 일부만 관찰한 그룹에서 선택 없음으로 확정하지 않는다.

### overview / focus / full

- overview: 문서 개요, 주요 영역, 조작 요소와 연결된 본문, 예산 내 반복 항목의 차이, 누락 표시.
- focus: 선택 대상과 필요한 조상·외부 관계 종점·제목·현재 방해 상황. 선택 영역만 잘라 문맥을 없애지 않음.
- full: 선언한 수집 범위의 상세 내용. 접근 불가·미렌더링 영역까지 안다는 뜻이 아님.

expand는 이미 보유한 동일 관찰 데이터를 펼친다. inspect의 box 등 추가 계산이 브라우저 재접근을 필요로 하면 새 관찰 시각과 ID로 반환한다. 예전 DOM과 새 좌표를 한 관찰로 섞지 않는다.

### 비용과 압축

- 초기 예산 숫자는 이해도와 실제 출력 측정 후 정한다. 문서 앞부분부터 선착순으로 자르지 않고 조상·관계 종점·누락 표시를 유지한다.
- 처음에는 한 줄 한 노드다. 항목 한 줄에 여러 자식 노드를 쓰는 압축은 자식 경계가 정의되기 전에는 사용하지 않는다.
- 반복 형상은 구조 설명만 공유한다. 항목별 중요한 차이를 앱이 의미 추론으로 고르지 않고 관찰된 텍스트·상태를 보존한다. 추가 축약 시 누락을 표시한다.
- 비싼 hit test와 여러 줄 rect는 viewport의 관련 대상이나 inspect 중심으로 시행한다. 이미 확보한 위치 정보는 버리지 않는다.
- 형태만 있는 상자 요약은 후순위다. 가시성·크기·중복·행/열 판정 규칙을 명시하고 로딩 의미를 붙이지 않는다.

## 9. 범위에서 분리할 것

- 사이트별 도메인·쿼리·문구 예외 및 업무 의미 사전.
- 위험도 정책 교체. risk.ts는 공통 사실 추출을 공유할 수 있지만 hrefDiff로 무해성을 판정하지 않는다. 실행 직전 실제 대상 확인을 유지한다.
- Playwright 교체, 별도 CDP 엔진, 새로운 거대 학습/메모리 시스템.
- 기본 OCR/비전 해석. 필요하면 별도 출처를 갖는 확장으로 설계한다.
- 새 브라우저 비교 실험. 이번 인계는 기존 기록과 HB 구현 계획에 관한 것이다.
- 설치된 Codex 스킬 업데이트. 현재 개발 레포의 작업이다.

## 10. 구현 단계와 완료 기준

| 단계 | 산출물 | 완료 기준 |
| --- | --- | --- |
| 0 | 모델·직렬화·참조·누락 계약과 fixture | 문법 모호함 없이 파싱, 잘린 메시지/중복 ID/끊긴 관계 검출 |
| 1 | 본문+조작 구조 출력, query/scope/match 후보 | 소속·순서·검색 근거 보존; 기존 실행 참조와 동일 대상 |
| 2 | 문서 사실·상태 투영·그룹 값 | source 참조와 완결성 보존; 미관찰을 false로 바꾸지 않음 |
| 3 | 값과 주변 상태의 변화 | before/after·동일성·실행 결과 구별; 새 탭 전달 |
| 4 | focus/expand, 링크 색인, 반복 압축 | 줄여도 조상·관계 종점·차이·누락 유지 |
| 5 | 추가 공간 관계·형태 요약 | 규칙의 결정성·비용·이해 이득 확인 |

첫 구현 묶음의 중심은 7장의 세 출력이다. 단계 1~3을 작은 범위의 수집기/렌더러로 연결하고 실제 출력으로 검사한다. 각 단계에서 필요한 회귀 검증을 함께 수행한다. 기본 계약은 후속 단계로 미루지 않는다.

## 11. 검증 계획

### 11.1 문법과 관찰 계약

- parse/serialize 의미 보존, 문자열의 따옴표·개행·가짜 표식 이스케이프.
- 중복 ID, 부모 순환, 미해소 관계, 관찰 간 잘못된 참조, 종료 누락 검출.
- 동일 그래프·옵션의 결정적 출력. 캡처 시각이 다른 별도 관찰을 같다고 요구하지 않음.
- 마스킹 후 노드·관계 보존. URL과 폼 값에도 기존 마스킹 정책 적용.
- 전체 텍스트를 부모·자식에 중복 복사하지 않고 인라인 링크 순서 보존.

### 11.2 이해도 과제

| 과제 | 기대 판단 |
| --- | --- |
| 같은 Details 링크 두 개 | 각 항목의 소속으로 구분 |
| New York 검색 결과 | 단어 일치만으로 입력 후보라고 단정하지 않음 |
| href에만 query 일치 | 반환 이유를 식별 |
| 라디오 일부만 관찰 | 선택 없음으로 확정하지 않음 |
| 입력 후 값 공백·dialog 추가 | 관찰을 읽되 원인을 추측해 성공/실패로 단정하지 않음 |
| 목록 가격·상세 이동 오류 | 값 출처와 과업 미충족 구별 |
| 새 탭 | 기존 탭 URL 불변을 전체 무변화로 해석하지 않음 |
| 예보 숫자·Today | 단위/레이블/시간대 근거 부족을 인지 |
| 합성 이름·실행 참조 | 표시 문자열을 실행용 정확 이름으로 간주하지 않음 |
| 접힘·접근 불가 | 추가 조회로 얻을 수 있는 범위를 구분 |

정답에는 판단 불가를 포함한다. 직전 클릭 성공 여부는 실행 완료·관찰 변화·사용자 과업 충족으로 나눠 묻는다.

### 11.3 비교 실험의 공정성

1. 표현 실험: 같은 관찰 정보를 평탄 출력, 0.1 graph, 0.2 view로 표현한다. 한쪽에만 근거를 더 넣지 않는다.
2. 수집 실험: 본문·관계를 추가 수집한 효과를 별도로 비교한다. 기존 출력에 없던 정보를 추가한 이득을 문법 효과로만 보고하지 않는다.
3. 실사용 실험: 동일 HB 환경·시나리오에서 비교하며 학습을 비활성화한다. CAPTCHA·접근 거부·환경 오류는 별도 집계한다. 다른 브라우징 제품을 새로 시험하는 범위가 아니다.

지표: 관계/대상 이해 정확도, 과잉 주장, 추가 관찰 호출, 작업 성공, 입력 토큰, 수집·직렬화·총작업 시간. eval 사용은 목적별 보조 지표다. eval이 줄어도 토큰과 시간이 크게 늘면 효율 개선이라고 단정하지 않는다.

수집 시간 +30% 같은 수치는 검증된 기준이 아니라 초기 가설로만 다룬다. 초기 성과를 특정 비율로 약속하지 않는다.

## 12. 검토한 기록과 근거 해석

GPT-6가 직접 원시 HB 명령을 확인한 사이트: Best Buy, Amazon, Booking.com, eBay, Weather.com, IMDb. Expedia는 선별 시 확인했으나 CAPTCHA 중심 실패여서 심층 분석에서 제외했다. 추가 Wikipedia/Walmart/Expedia 사례는 Claude의 누적 기록에서 전달받은 것으로, 직접 검증한 사실과 구별한다.

| 사이트 | 핵심 관찰 | 설계로 일반화한 것 |
| --- | --- | --- |
| Best Buy | 필터 그룹을 반복 목록으로 반환; 빈 상품 영역; 목록 값과 상세 출처 혼동 | 범위·그룹 근거·숫자 종류·값 출처 |
| Amazon | 축약 이름 no_match; 짧은 이름의 복수 후보 | 이름/표시/참조 분리와 후보 차이 |
| Booking | 도시 추천과 검색 후보 혼재; 중복 필터; overlay | match·소속·명시 연결·관련 상태 |
| eBay | 이미지/제목/watch 후보; 상세 팝업 | 같은 그룹/목적지/행동 구분, 문서 간 변화 |
| Weather | 값이 포함된 이름 변화; 단위와 상대 날짜 | 안정적 참조, 내용 조각, 단위·시간 출처 |
| IMDb | 보이는 이름으로 정확 일치 실패; 평점 주변 다른 숫자 | 수집 이름과 실행 이름 구별, 하위 영역 |

누적 기록의 최신 정정에 따르면 Claude는 전체 eval 사용과 내용 읽기 eval을 구별했다. 기존에 전달한 16/30을 snapshot 포기율로 부르는 것은 부정확하며, 내용 읽기 eval은 13개 시행·19개 명령으로 재분류했다고 기록했다. 이 수치는 이번 작성자가 독립 재계산한 값은 아니다. 후속 실험은 목적별 분류 정의와 명령 근거를 함께 보존해야 한다.

근거 문서:

- [누적 발견과 에이전트 간 정정](common_findings.md)
- [0.1 원안](WEB-CONTEXT-MARKUP.md)
- [초기 비교 보고서](../benchmarks/us-web-2026-10-13/report.ko.md)
- [시행별 검증 근거](../benchmarks/us-web-2026-10-13/evidence.json)
- [후속 HB 시행 결과](../benchmarks/hb-validation-2026-10-14/results.json)

원시 명령 링크는 common_findings.md의 사이트별 항목을 참조한다. 로컬 .runtime 자료는 공개 패키지에 포함되지 않을 수 있다.

## 13. 다음 작업자에게

1. 이 문서와 common_findings.md의 최신 항목, 현재 작업 트리를 확인한다. 다른 작성자의 변경을 덮어쓰지 않는다.
2. 단계 0의 핵심 계약과 작은 이해도 fixture를 만든다. 과거 예시에 남은 들여쓰기/속성 혼용을 그대로 구현하지 않는다.
3. 본문+조작 구조, 소속+일치 근거 후보, 값+주변 상태 변화의 세 출력을 최소 구현한다.
4. 기존 JSON 경로와 실행 참조 동작을 유지하면서 실제 HWM 출력의 정확도와 비용을 측정한다.
5. 결과를 common_findings.md에 날짜·시간·모델명과 함께 누적한다. 정정은 이전 기록을 지우지 말고 추가 항목으로 남긴다.

최종 판단 기준은 문법의 복잡함이나 생성한 파일 수가 아니라 **LLM이 더 풍부한 근거를 받아 덜 헤매고 정확하게 작업을 끝내는가**다.
