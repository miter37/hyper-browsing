# 요청 중심 HB 구현 및 확인 기록

2026-10-15 · GPT-6 Codex · feat/demand-driven-observation

## 구현한 기본 흐름

기본 CLI 형식은 hb(compact JSON)다. 첫 snapshot은 패널 지도와 소수 컨트롤 표본을 만들며 전체 본문 graph를 만들지 않는다. read는 실제 패널/항목/노드 DOM 범위에서 요청한 content/controls/state만 읽는다. since는 실제 수신한 delivery의 필드 기준이며 없으면 해당 요청 범위를 자체 완결적으로 반환한다. HWM은 explain 또는 명시 --format hwm에 유지한다.

이미 전달한 이름·값을 다시 출력하지 않되 이번에 실제 읽은 범위만 비교한다. 같은 문구의 다른 노드를 합치지 않는다. requested 상태 필드가 사라지면 unavailableFields로 이전 근거를 철회한다. 패널 별칭은 문서/물리 DOM에 묶고, 조회 경계 교체/만료/다른 세션/다른 소비자의 영수증을 거부한다. 기존 실행 ref/epoch/guard·입력 간격·위험 판정·중복 요청 방지는 유지했다.

조작 기본 응답은 기존 실행 계층의 actual effect와 delivery를 반환한다. 전후 전체 본문 graph를 덧붙이지 않는다. HWM 상세가 기본16KB 예산을 넘으면 큰 문자열을 쏟지 않고 observation/크기/좁힐 대상/명시 예산 확대 안내를 반환한다. 기존 명시 JSON/HWM과 extract/list/forms/eval 경로는 유지한다.

## 실전 확인

프로젝트 SKILL/절대경로 launcher, 별도 런타임·프로필에서 headless=true/learningDisabled=true. 서브 에이전트에 사이트 작업을 맡기거나 외부 설치 스킬을 쓰지 않았다. vanilla/browser-use 실험은 하지 않았다. 작업 종료 후 이 실험의 전용 세션·Chrome·데몬만 정리했다.

| 확인 | 첫 지도 | 필요한 범위 조회 | 같은 범위 의도적 재조회 |
|---|---:|---:|---:|
| Wikipedia Apollo 11, Command Module Pilot 검색 | 4,258 bytes | 7,323 bytes | 842 bytes / data0 |
| Hacker News 첫 화면 본문 일부 | 1,017 bytes | 11,208 bytes | 382 bytes / data0 |
| Airbnb 첫 화면, Where 검색 | 2,193 bytes | 751 bytes | 359 bytes / data0 |

위 표는 구현 중간의 smoke 확인이다. coverage는 일부였으며 Wikipedia는 주·예비 승무원 관련 행을 함께 보여줘 해석이 필요했고, HN은 본문 전체가 아닌96개 단위만 표시했다. 이 수치를 전체 질문 완료 비용/성공률 또는 동일 범위 압축으로 사용하지 않는다. 그 뒤 리뷰 수정에서 지도 중복 표본 제거, 본문 패널 우선순위와 무의미 구조 페이지의 document fallback을 보완했다.

최종에 가까운 새 데몬으로 Airbnb를 추가 확인했다:

| 단계 | 전달량 |
|---|---:|
| 첫 지도 | 2,719 bytes |
| Where 입력창 범위 조회 | 752 bytes |
| 같은 조회를 since로 반복(테스트 목적) | 359 bytes |
| New York 입력 결과 | 869 bytes |
| 입력 후 New York 자동완성 범위 조회 | 1,676 bytes |

실제 입력은 completed/ok=true였고 자동완성 후보 원문을 확인했다. 위5개 응답 합계6,375 bytes이며, 불필요한 의도적 재조회359 bytes를 빼면6,016 bytes다. 지도/검색창/입력/후보 조회의 작은 흐름이며 숙소 검색·날짜·필터까지 완료한 과업으로 세지 않는다. 초기 session open/관리 상태 조회와 cleanup 출력은 이 합계에서 제외했다. 과거167KB는 다른 검색 결과 화면의 풍부한 snapshot이므로 같은 정보의 절감률로 비교하지 않는다.

원시 CLI 응답은 로컬 .runtime/demand-live-check.log, .runtime/demand-airbnb-action.log, .runtime/demand-live-20261015/에 보관한다. 마스킹된 후보·부분 범위만 보고 미확인 전체를 추측하지 않았다.

## 짧은 동등 조회 비용 확인

local-costs.mjs는 고정 로컬 문서3개에서 제어 중심 HB snapshot+실제 HB extract와 새 HB map+scoped read를 비교한다. 둘 다 호출2회이고 필요한 목표 텍스트/값이 실제 포함됐는지 확인했다. 학습은 없다. 제어 중심 snapshot은 context:false로 실제 graph 생성을 끄고, 이전 비교와 같이 성능 진단은 제외한 pretty JSON을 사용한다.

첫 측정의 예시 값: 항목 본문32.9KB→2.0KB, 지정 문단29.7KB→1.5KB, 지정 입력값20.1KB→1.4KB. 반복 측정 원시는 local-costs.json에 있다. 이 제한된 workflow의 중앙 절감은 약94%였다.

이것은 LLM의 실전 작업/최적 선택 실험이 아니다. 대상 locator를 처음부터 알면 기존 extract 한 번이 더 작을 수 있다. 새 방식도 그런 요청에 지도/조회 단계를 강제하지 않는다. 측정은 현재 채택한 snapshot→조회 흐름에서 필요한 정보만 읽는 이득을 보여주며, 모든 과업의30% 절감을 입증하지 않는다. 작은 고정 표본의 시간은 CLI·모델 사고·실제 사이트 지연을 대표하지 않는다.

## 검증과 리뷰

- 핵심 계약의 RED→GREEN을 먼저 확인했다. 사용자 요청에 따라 과도한 반복 실험 대신 범위/전달/실행 경계에 집중했다.
- 전체 npm test EXIT=0: 타입 검사 + HWM89/learning35/execution62/scenarios15/discovery46 =247개 통과 (.runtime/demand-full-suite-final.log).
- 신선한 읽기 전용 리뷰에서 Important3건: 사라진 상태 필드 철회 누락, 컨트롤600개 이후 페이지네이션, 바이트 부족 시 비전진 continuation. 모두 실제 회귀로 재현·수정했다.
- 그 뒤 긴 값의 미리보기 표시와 explain 바이트 예산을 보완하고 대상9개 및 타입 검사를 다시 통과했다 (.runtime/demand-last-targeted.log). 전체 검사를 세 번째로 반복하지 않았다.
- 기존 JSON snapshot에서 명시 context:false를 그대로 전달해 graph가 빠진 호환 회귀를 발견하여, 호환 RPC는 context:true, 새 경량 수집만 false로 구분했다.

## 남은 검증 범위

기하 패널 분할은 보수적이며 모든 사이트 레이아웃의 완벽한 지도를 보장하지 않는다. map의 표본 밖 컨트롤과 아직 읽지 않은 본문은 read로 얻는다. 큰 자료는 coverage/nextOffset/잘림을 확인해야 한다. 반복 조회는 전송량이 작아져도 실제 재수집 비용이 있으므로 스킬에서 먼저 피한다.

전체 LLM 과업의 성공률·총토큰·총시간 우월성은 아직 별도 검증 대상이다. 이번에는 프로젝트 브랜치의 기본 흐름을 구현·확인했으며 main 병합/배포나 실전 우월성 확정은 하지 않았다.
