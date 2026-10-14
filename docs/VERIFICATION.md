# 읽기 전용 결과 검증

`webctl verify --session ID --input-file checks.json`은 현재 화면을 읽어 기대값과 비교한다. 클릭·입력·학습·자산 저장 없이 사용하며 최대 20개 조건, 전체 5초 예산이다. 파일의 최상위 필드는 `checks` 배열이다.

```json
{
  "checks": [
    {"type":"url_param","name":"checkin","expected":"2026-11-17"},
    {"type":"url_param","name":"checkout","expected":"2026-11-19"},
    {"type":"element","target":{"ref":"e27"},"read":"checked","op":"equals","expected":true},
    {"type":"element","target":{"locator":{"label":"Adults","exact":true}},"read":"value","op":"equals","expected":"2"},
    {"type":"element","target":{"locator":{"css":"[data-testid=property-card]"},"nth":0},"read":"text","op":"contains","expected":"2 nights"}
  ]
}
```

참조·locator·라벨·카드 구조는 현재 페이지에서 관찰한 것만 지정한다. 위 예시는 한 사이트의 보편적인 선택자를 뜻하지 않는다. URL 조건과 화면의 적용 조건, 읽은 가격의 숙박 기준을 함께 확인한다.

| 조건 | 입력 |
|---|---|
| URL 쿼리 | `type: url_param`, `name`, 문자열 `expected`. 같은 이름의 값이 여러 개면 UNKNOWN |
| 요소 | `type: element`, `target`, `read`, `op`, 필요 시 `expected` |
| 대상 | 기존 locator 또는 ref 하나. locator에는 `nth`·`within` 가능; ref에는 불가 |
| 읽기 | `text`, `value`, `attribute`, `checked`, `selected`. attribute는 속성 이름 필요 |
| 비교 | `equals`, `contains`, `exists`. 텍스트는 공백을 정리한 뒤 대소문자를 구분한다 |
| 기대값 | checked/selected는 boolean, 다른 읽기는 문자열. exists는 기대값 생략 |

모든 조건의 판정과 근거를 반환한다. 확인된 불일치가 하나라도 있으면 NOT_APPLIED, 전부 충족하면 APPLIED, 모호함·오래된 ref·읽기 실패·예산 종료·페이지 교체는 UNKNOWN이다. 빈 배열은 UNKNOWN이며 로딩·차단·부분 관찰 페이지에서도 성공을 인증하지 않는다. 비밀번호·결제·OTP 필드는 반환값을 숨긴다.

APPLIED는 **지정한 조건에 대한 읽기 검증**이다. 이전 쓰기가 실행됐다는 증거, 구매 승인, 조건에서 빠진 사용자 요구까지의 성공을 뜻하지 않는다. 결과가 0개인 화면도 적용 조건과 정상 결과 안내를 확인하면 유효하며 결과가 반드시 하나 이상이어야 한다는 조건을 자동 추가하지 않는다.
