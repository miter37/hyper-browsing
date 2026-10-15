# 목표 중심 코어 구현 계획

> 구현 방식: superpowers:executing-plans로 현재 세션에서 순차 실행. 각 동작 계약은 실패 테스트를 먼저 확인한다.

목표: 실제 실행 ref를 공유하는 목표 조회·조작 후 조회·조건부 작은 계획을 정식 코어와 CLI에 제공한다.

설계: [GOAL-DRIVEN-CORE-DESIGN.md](../GOAL-DRIVEN-CORE-DESIGN.md).
기술: TypeScript, Zod, 기존 Playwright 실행 계층, Node test.
브랜치: `feat/goal-driven-core`. 사용자 지정 프로젝트 폴더에서 새 브랜치로 작업한다.

## 제약

- 도메인별 조건·용어 사전·첫 후보 자동 선택 금지.
- 조회는 기존 snapshot 수집의 이름·상태·참조를 공유. 전체 HWM 생성 금지.
- 후보 text/name/placeholder/value/href와 실제 소속을 구분.
- 계획 최대 4개 행동, 총 예산 기본/상한20초, 관찰 기본/상한3초.
- 결과 불명과 확인 요구는 중단. 완료 단계 재실행 금지. 계획 전체 confirmed 플래그 금지.
- 공개 자료는 공통 마스킹. 기존 명령과 학습 정책은 계속 지원.

## 단계별 산출물

- [x] 1. 공통 관찰: `snapshot.ts`에 선택적 goal 필터/소속/일치근거를 추가하고 `task/schema.ts`, `task/observe.ts`에서 검증·응답 구성. `tests/task-observe.mjs`: 중복 문구, aria-hidden 시각문구, shadow, dialog scope, 부분 수집, 마스킹, 실제ref 실행.
- [x] 2. 전환: `task/transition.ts`에 필드·새 후보·관련 범위 변경·URL 조건을 제한 시간 안에서 확인. `tests/task-run.mjs`: 늦은 목록과 오래된 후보, 무관한 광고 변경, 시간초과.
- [x] 3. 실행: `task/run.ts`에서 executePrimitive를 사용. 조회/단계 ID·부분 결과·예외 후보·계획 예산을 반환. `task/result.ts`에서 결과 마스킹과 요약. 동일 테스트에서 모호함·결과불명·확인 필요·이후 미실행 검증.
- [x] 4. 연결: `task.find`, `task.run` RPC와 `find`, `run` CLI. 기존 조작에는 `--then-file`로 같은 관찰/전환 계층 사용. `tests/task-cli.mjs`: RPC/CLI 일치, 요청ID 중복실행방지, 헤드리스정책, 학습없음.
- [x] 5. SKILL·COMMANDS·README: 목표 선언·작은 계획·B플랜·반복 조회 금지 안내. package.json 표준 테스트에 연결. 타입검사·신규/관찰/실행 회귀 후 새 브랜치에 커밋·푸시.

## 검증과 기록

각 테스트 묶음을 먼저 실패시킨 뒤 구현한다. 모든 신규 외부 사이트 테스트는 별도 필요가 생기기 전까지 추가하지 않는다. 로컬 실제 브라우저 fixture가 기본이다. 단계별 결과와 설계 보완은 아래 기록에 누적한다.

### 실행 기록

- 시작 기준: 3ed3d7d. 타입검사 및 관련61개 테스트 통과를 직전 확인했다.
- 결정: 별도 worktree를 만들지 않고 사용자가 지정한 개발 폴더에서 새 브랜치를 사용한다. 현재 런타임·프로젝트 실행 경로를 유지하며 이전 버전은 기존 브랜치에 보존되어 있다.

- 1~4단계 구현: 기존 snapshot 수집에서 goal 필터·시각 text·이름 출처·실제 소속·ref를 함께 생성한다. 별도 DOM 이름 검색기는 제품에 이식하지 않았다.
- 계획은 common executePrimitive를 사용하고 targeted 모드에서 기존 전역 probe/settle을 생략한다. 입력 pacing·위험 확인·ref guard는 유지한다. target.states는 실행 직전에 재검사한다.
- introduced의 이전 집합은 ref 문자열이 아니라 브라우저 WeakSet의 DOM 동일성이다. 조상 guard 변화만으로 ref가 바뀐 것을 새 결과로 오인하는 회귀를 먼저 실패시킨 뒤 수정했다.
- 결과는 마지막 관련 finding 한 번만 반환하며 근거 byteBudget과 전달 receipt를 사용한다. receipt 생성 실패도 이미 확인한 실행 결과를 바꾸지 않는다.
- 독립 코드 리뷰의 재현3건(aria-controls 포털 범위, 긴 scope.name 출력량, 120자 preview 비교오류)을 실패 테스트로 확인하고 수정했다. 긴 값은 브라우저 내부에서 비교하고 공개값만 축약한다.
- 스킬 사용성 확인3건: 이미 받은 메뉴ref 바로사용, introduced 미확인시중단, known=1시기존ref재사용을 검토 에이전트가 올바르게 해석했다. 기존 무조건 snapshot/at 문구는 필요한 read 경로에 한정했다.
- 검증 범위 결정: 이번 릴리스의 완료 조건은 코어 기능·회귀·문서 일치다. 동일 모델 외부사이트 A/B의 전체 시간/토큰 비교는 별도 후속 평가이며, 기능 완료를 성능 개선율 검증이라고 주장하지 않는다.
- 예산 해석: 20초는 새 동작·단계 시작과 관찰의 예산이다. 이미 실행 중인 primitive의 완료/불명 판정까지 강제 취소됐다고 주장하지 않는다. 초기값은 측정 후 조정한다.
- 최종 검증: npm test exit0. 타입검사, task31/HWM106/학습35/실행63/브라우저시나리오15/발견46, 총296개 통과. 원시 로그는 .runtime/goal-core-final-tests.log(로컬 전용).
- 실제 프로젝트 데몬을 새 소스로 재시작하고 기존 Chrome(headless, 동일 PID)을 재사용했다. 별도 data: 로컬 페이지에서 fast CLI와 native TS CLI find 성공, run 입력→필드검증→후속후보 확인 완료(994ms, 최종JSON약1545B; 로컬 단일 smoke로 전체성능지표 아님). 테스트 세션은 닫았다.
- 신규 외부 사이트 비교나 사이트 전용 수정은 하지 않았다. 새 브랜치만 원격에 게시한다.
