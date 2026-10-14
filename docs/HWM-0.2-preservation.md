# 기존 능력과 HWM의 정보 보존

2026-10-14 · GPT-6 Codex. 하나의 관찰을 에이전트에게 전달하며 별도 탐색 엔진을 만들지 않는다.

| 기존 정보/능력 | 통합된 표현 | 보존 원칙 |
| --- | --- | --- |
| 역할·이름·레이블·placeholder | 노드 주 값/출처, display, 속성 | 기존 합성 이름은 display-rule로 표시하고 확인한 accessible-name과 구분 |
| 실행 ref·stale guard | 노드 별칭, 불투명 epoch ref | 같은 DOM 대상만 실행. 실제 resolve 때 핸들 확보/검증 |
| hint/context/popup/testId | 노드 속성과 알고리즘 출처 | 사이트 업무 의미를 새로 붙이지 않음 |
| clipped/transparent/selectedText | 노드 속성 | 원래 판정·상태 그대로 보존 |
| 숨김 요소/openWith/textHits/collapsed | discovery 후보 레코드 | 미발급 ref를 지어내지 않음. 민감 필드 본문은 후보에서도 제외 |
| 본문·가격·안내·표/항목 | 원문 순서의 text 및 유지 조상 | 의미 이름으로 재분류하지 않고 소속/순서 보존 |
| query와 후보 | query/scope/match 및 기존 발견 후보 | 본문 일치도 수집 전 예약. 선택 대상 우선 |
| 폼/그룹/URL 조건/status | 노드 상태와 @state | 부분 선택 집합과 완결성 구분. 서로 일치한다고 앱이 판정하지 않음 |
| list/forms/eval | 같은 노드 문법과 @result | 실제 수집 값만 변환. result-only 관찰은 expand를 약속하지 않음 |
| 명령 효과·오류·차단·폴백·배치 단계 | @result + @change | 완료/관찰 변화/사용자 성공을 구분. UNKNOWN을 완료로 덮어쓰지 않음 |
| 스크롤·프레임·숨김·미수집 | box/view/layout-boundary 및 @gap | 위치는 기존 측정값을 보존. 5단계의 추가 공간 계산은 미구현 |
| 저장·inspect·expand | 동일 마스킹 관찰/비교의 TTL 보관 | 옛 관찰을 현재 DOM으로 대체하지 않음 |

빈 단일 자식 래퍼의 수집 압축은 `via-dom` 태그 경로를 남긴다. 정본 투영에서 생략한 보유 노드는 `via` ID로 조회한다. 상태·속성·역할·실행 참조·관계·스크롤·구조 분기는 보존한다.

overview/focus는 원시 box/space 숫자를 생략하고 `detail-projection=raw-geometry-in-full-or-inspect`로 상세 축약을 선언한다. 기존 view(inside/outside/partial)와 스크롤 경계는 유지한다. full과 inspect에는 같은 정본 좌표가 남으며 새 공간 관계를 계산하지 않는다.

기본 명령은 HWM/overview이며 JSON은 스크립트 호환 직렬화다. 원래 능력을 쓰려면 별도 방식으로 돌아가야 하는 구조를 두지 않는다. 일반 조작은 보유 이전 관찰 + 조작 후 주변 관찰을 비교하고, 명시적인 상세 전후 조회는 유지한다.
