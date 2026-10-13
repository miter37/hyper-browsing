# 학습과 자산 복구

학습은 브라우징의 종료 조건이 아니다. 엔진은 방문·관찰·자산 상태를 제공하고, 에이전트가 현재 요청을 수행한 뒤 유용한 경험만 선택해 저장한다. 별도의 백그라운드 생성 서비스는 없다.

## 기준과 제한

| 최근 30일 작업수 | 가능한 저장 |
|---|---|
| 1회 | 사이트 고유 노하우: 작업당 최대 3항목·총 600자 |
| 2회 이상 | 관찰한 액션 능력: 일반 작업당 생성·개선 1개 |
| 7회 이상 | 기존 액션을 참조하는 얕은 탐색 러너 |

한 작업 세션에서 같은 사이트를 여러 번 이동·새로고침해도 1회다. 같은 날의 독립 작업은 별도로 센다. 현재 버전부터 집계하며 과거 기록을 추정하지 않는다. 이미 등록된 사이트는 사이트ID로 묶고, 미등록 사이트는 호스트로 구분한다. 기존 직접 CDP 업무 러너를 사용하는 에이전트도 먼저 작업 세션에서 사이트를 관찰해야 방문이 집계된다.

기준을 넘겨도 생성할 가치가 없다면 건너뛴다. 사용자 작업과 무관하게 전 화면을 순회하거나 모든 이벤트를 저장하지 않는다. 사용자에게 명시적으로 자동화·기억을 요청받았을 때만 `requested: true`로 방문·생성 한도를 제외할 수 있다.

## 명령

Windows에서는 `bin\webctl.cmd`, 다른 환경에서는 `bin/webctl`을 사용한다. 아래의 `webctl`은 해당 명령의 약칭이다. JSON은 PowerShell 인용 문제를 피하도록 `--input-file`로 전달한다.

```text
webctl learning status --session ID
webctl learning notes --session ID
webctl learning notes --session ID --capability lodging-search
webctl learning notes save --session ID --input-file notes.json
webctl learning action save --session ID --input-file action.json
webctl overview save --session ID --input-file overview.json
webctl overview run --session ID --site SITE_ID
webctl asset status ACTION --session ID
webctl asset report ACTION --session ID --reason wrong_result
webctl learning finish --session ID --input-file finish.json
```

`learning notes`의 기본 응답은 색인이고, capability를 선택하면 본문을 반환한다. `learning finish`와 `learning status`는 데몬 없이도 실행할 수 있다. 세션을 닫으면 미정리 관찰은 `observed_only`, 작업 상태는 `unknown`으로 기록한다. 종료 자체만으로 작업 성공을 추정하지 않는다.

노하우 예제:

```json
{"notes":[{"capability":"lodging-search","conditions":"desktop; date filter","text":"날짜 선택 후 적용을 눌러야 검색 조건에 반영된다. 결과 화면의 날짜를 다시 확인한다."}]}
```

동일한 capability와 conditions는 새 파일을 만들지 않고 갱신한다. 개인별 기록과 노하우는 로컬에 남는다.

액션 예제: 먼저 실제 목표 요소를 `extract`로 읽고 그 결과가 요청과 일치하는지 확인한다.

```json
{
  "id":"read_count",
  "capability":"read-result-count",
  "scope":"현재 관찰한 결과 화면의 건수. 다른 언어·화면은 미검증.",
  "elements":{"result_count":{"strategies":[{"testId":"result-count"}]}},
  "extractors":{"count":{"element":"result_count","read":"text"}},
  "action":{
    "risk":"read",
    "implementation":{"kind":"declarative","steps":[]},
    "returns":{"extractor":"count"},
    "verify":[{"type":"extractor_equals","extractor":"count","value":"{expected}"}]
  },
  "validationInput":{"expected":"0"}
}
```

입력 템플릿은 `{name}` 형식이다. `validationInput`은 비어 있는 선언형 절차로 값만 추출하는 액션을 1회 검증하는 데만 사용하고 YAML에는 저장하지 않는다. 클릭·입력·코드 실행이 있는 액션은 risk가 read로 적혀 있어도 자동 재실행하지 않고 다음 승인된 실제 작업에서 검증한다. 새 URL 템플릿·선택자·조건은 관찰한 사실만 제공한다. 저장된 검증의 의미가 실제 요청을 충족하는지는 에이전트가 확인해야 한다. 공유 요소·추출기를 변경하려면 새 이름을 사용해 기존 액션을 보존한다. 코드 액션의 구현 수정은 에이전트가 `actions.ts`에서 수행하며 기존 보안 검사와 버전 검증을 따른다.

탐색 러너 예제:

```json
{"routes":[{"url":"https://example.com/listings","label":"숙소 목록","readOnly":true}]}
```

현재 화면에서 보이는 같은 출처의 링크이고, 해당 작업에서 `goto`로 실제 방문해 관찰한 읽기 경로만 등록한다. 입력값·계정별 검색 조건이 든 URL은 마니페스트에 보관하지 않는다. query 없는 구조적 URL을 사용한다. 시작 화면과 링크로 한 번 이동한 화면만, 자식 최대 2개·30초를 탐색한다. 추가 화면은 임시 탭에서 열고 닫으며 원래 작업 화면은 유지한다.

`sites/<site>/scripts/<site>_overview.mjs`는 공통 데몬 경로를 사용하는 작은 진입점이다. 화면·경로 마니페스트는 `.runtime/learning/overviews/`에 남아 Git에 포함되지 않는다. 기존 액션은 실행 명령으로 참조하고, 발견한 버튼·링크는 미검증 후보로 표시한다. 임의 클릭·입력·제출, 업무 수행·대량 수집은 하지 않는다. 성공적인 기존 액션의 현재 입력·상태 조건은 실제 실행 전에 다시 확인한다.

자동 갱신은 구조나 능력이 달라졌을 때만 최대 7일에 한 번이다. 기존 업무 러너는 보존하며 미검증 러너를 무조건 실행하는 빠른 경로는 사용하지 않는다.

완료 예제:

```json
{"taskStatus":"succeeded","decision":"skipped","reason":"one_off"}
```

작업 상태: `succeeded / failed / partial / unknown`. 학습 판단: `saved / merged / skipped / observed_only`. 저장하지 않기로 판단한 것도 정상적인 완료다.

필요하면 finish JSON의 `additionalDurationMs`에 에이전트가 측정한 학습·수정 추가 시간을 넣는다. 엔진 저장·탐색 실행 시간과 학습 판단은 `.runtime/learning/events.jsonl`, 액션의 버전별 실행·성공 증거는 기존 metrics에 기록한다.

## 실패 후 복구

1. 오류와 검증 결과를 읽는다. 로그인·일시적 로딩·네트워크·차단은 환경 문제로 구분한다.
2. 선택자·화면 변경 또는 잘못된 결과가 확인되면 해당 버전의 자동 사용을 보류한다. `asset report`의 이유는 `wrong_result / structure / locator` 중 하나다.
3. 현재 화면을 관찰하고 기본 도구로 사용자 요청을 수행한다. 쓰기 작업은 적용 여부부터 확인하며 불명확한 결과를 재실행하지 않는다.
4. 성공한 경로를 검증한 다음 기존 액션·마니페스트의 실패 부분만 수정한다. 기존 자산의 복구는 2·7작업 기준과 7일 주기의 예외다.
5. 수정 후보와 추가 읽기 검증은 각각 1회로 제한한다. 새로운 코드의 검증에 실패해도 사용자 작업 성공은 별도로 보고한다. 고장 난 버전은 보류한다.
6. 쓰기 액션은 수정 후 구조를 검사하고, 다음 승인된 실제 작업에서 검증한다. 승격 테스트를 위해 메시지·결제·예약을 다시 수행하지 않는다.

엔진은 오류·버전·`recovery`·`fallbackRequired`를 전달한다. 재탐색과 파일 수정은 이 지침을 읽는 에이전트가 담당한다. 실행 결과가 없다는 이유로 성공했다고 보고하지 않는다. 탐색 러너 실패도 같은 흐름으로 처리하며 `overview save`는 보류된 기존 마니페스트를 수정할 때 주기·방문 제한을 제외한다.

구현·선택자·검증 조건·참조 정의가 바뀌면 새 해시로 성공 증거를 분리한다. 저장된 버전의 의미 있는 검증 성공 1회는 candidate, 독립 작업 2회는 verified다. `extractor_exists`만으로는 승격하지 않는다. 옛 성공 로그는 표시용으로 보존하지만 수정본의 승격에는 사용하지 않는다. 단계 표시와 현재 버전의 증거·보류 상태를 구별한다.

## 보관과 검증

관찰은 세션당 최대 500개의 구조적 이벤트만 남기며 입력값·전체 DOM·응답 본문을 보관하지 않는다. 세션 종료 시 오래된 관찰을 정리해 30일·전체 10MB 한도를 적용한다. 노하우와 실행 자산은 이 정리 대상이 아니다. 일반 액션 정의를 Git에 공유하기 전에는 개인정보·계정별 URL·페이지 지시문이 없는지 확인한다.

```text
npm run typecheck
npm run test:learning
npm run test:scenarios
```

브라우저 테스트는 임시 프로필과 로컬 응답만 사용한다. Chrome이 기본 경로에 없으면 `PW_CHROMIUM_PATH`에 Chrome 또는 설치된 Chromium 실행 파일을 지정한다. 실제 사이트의 로그인을 재현하거나 외부 쓰기를 수행하지 않는다.
