# HB 요청 중심 관찰 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기본 화면 지도·범위 조회·수신 기준 차분으로 총전달량을 줄이고 HWM을 범위 한정 상세로 제공한다.
**Architecture:** 기존 실행/ref/마스킹을 공유하는 rooted snapshot 수집기를 만들고, 임시 map scope와 전달 영수증을 관찰 서비스에서 관리한다. 기본 CLI는 작은 HB 응답, 명시 JSON/HWM은 호환/상세 경로다.
**Tech Stack:** TypeScript, Playwright, node:test, 기존 RPC/CLI.
**Spec:** docs/plans/HB-demand-driven-observation-design.md

아래 체크리스트는 초기 계획 원문이며 최신 실행 상태는 문서 끝의 실행 기록을 따른다. 개발 브랜치 기본값과 main 채택 판정은 별도다.

## 제약

- 사이트별 코드/단어 예외 금지. 학습 OFF 실전 검증. 기존 실행 확인/참조 수명/지연/폴백 유지.
- map에서 전체 graph/본문을 생성하지 않는다. read는 실제 DOM 범위를 제한한다.
- delivered와 현재 unchanged 구분. 소비자/문서/범위/필드별 전달 이력. 미전달/잘림을 전달로 세지 않는다.
- 출력만의 바이트 감소를 과업 효율 개선으로 주장하지 않는다.

## 작업과 검증

### A — rooted collector와 가벼운 map
- [ ] tests/demand-observation.mjs: 큰 문서에서 map graph 미생성, 영역/필수 dialog/표본, 범위 밖 본문 미수집 실패 확인.
- [ ] snapshot의 context:false/root/maxVisits/lightweight 제어와 기존 기본 호환 구현. DEEP_WALK_JS와 CONTEXT_COLLECTOR 범위 지원.
- [ ] src/runtime/observation/map.ts: 문서·DOM scope와 제한된 map 후보. panel ID는 조회용, 실제 실행 ref는 기존 발급기 사용.
- [ ] RED→GREEN, 기존 snapshot 회귀 확인.

### B — scoped read/explain
- [ ] 항목 소속/필드 묶음/부분선택/마스킹/만료/DOM교체 실패 테스트.
- [ ] src/runtime/observation/service.ts: read(page,session,{map,panel,want,query,item,offset,limit})와 explain. map 결과의 실제 root에서 수집한다.
- [ ] 경량 JSON의 노드/소속/상태 보존과 기존 HWM 상세/보관 연결. 전역 gap/index를 경량 응답에 복제하지 않는다.

### C — 명시 delivery/since
- [ ] 미전달, 두 소비자, 동일 문자열의 다른 대상, 응답 유실, 부분 필드, 만료 테스트 실패 확인.
- [ ] src/runtime/observation/delivery.ts: 최종 공개 응답 필드만 bounded receipt로 기록. since 없으면 자체 완결 범위 응답, repeat는 재전달.
- [ ] 같은 물리 대상·필드의 신규/변경만 전달. 재관찰하지 않은 값은 unchanged라 하지 않는다.

### D — 실행/RPC/CLI/스킬
- [ ] tests/demand-cli.mjs와 daemon 회귀: 두 CLI 기본 snapshot/read/explain, since/consumer 전달, native 조작은 전체 graph 없이 한 번 실행.
- [ ] server에서 native map/read/explain 및 대상 상태 확인 연결. 명시 JSON/HWM 경로 보존.
- [ ] scripts/hwm-policy.mjs/webctl-rpc.mjs, src/bin/webctl.ts: hb|json|hwm 출력, 기본 hb와 명시 상세.
- [ ] SKILL/COMMANDS/합의 문서 실제 기본 절차 일치. 과거 설명을 역사 문서로 남기되 현재 기준 명시.

### E — 전체 검증과 실전
- [ ] npm test 전체 + 새로운 실제 브라우저 회귀 표준 명령 연결.
- [ ] Airbnb/Wikipedia/HN: map→필요 범위→조작/상세, 출력/시간/호출/미확인 범위 기록. 학습 없음, headless 우선, 필요한 경우 기존 폴백.
- [ ] 동일 완료 과업의 제어 중심 HB 대조와 총출력/추가조회 비교. 미완료 실험은 절감 성공으로 세지 않는다.
- [ ] 최종 신선한 리뷰, 중요 결함 RED→GREEN, 전체 검증 후 결과/한계 보고.

## 작업 기록

- Ruling: 사용자 요청한 현재 프로젝트 폴더에서 기존 변경을 보존하고 feat/demand-driven-observation 브랜치로 작업한다. 기존 diff는 .runtime/pre-demand-observation.patch에 보존. 추가 worktree로 실행 루트를 혼용하지 않는다.
- Ruling: 기본 경량 외피는 새 대규모 표식 언어 대신 compact JSON(hb)으로 시작한다. 기존 HWM은 명시 explain/format hwm 상세에 유지한다. 파싱·출처·scope 계약에 집중한다.
- Ruling: 기존 snapshot API는 context 생략 시 graph 호환을 유지한다. 새 map은 context:false/lightweight, 새 read는 root를 명시하여 전체 문서 graph 우회를 막는다.

### 2026-10-15 10:37 실행 결과

- A~D 구현: rooted collector, 가벼운 map, panel/item/node read, content/controls/state 묶음, delivery/since, 필드 철회, scope 만료/교체, native 실행 결과, 두 CLI, 스킬/현재 명세 연결.
- E 확인: 로컬 동등 조회3개, 실제 Wikipedia/HN/Airbnb smoke와 Airbnb 입력/자동완성 수행. 전체 npm test247개 통과. 마지막 preview/상세 예산 추가는 대상9개+typecheck 통과. 세 번째 전체 검사는 사용자 시간 제약에 따라 생략.
- 신선한 리뷰의 Important3건은 각각 회귀로 수정했다. 사이트별 예외는 추가하지 않았다.
- Ruling: 기본 외피는 hb compact JSON으로 구현하며, HWM은 명시 explain/detail로 유지한다. 기하 분할이 부족한 페이지는 document 영역으로 조회 가능하게 한다.
- Ruling: 작업 브랜치의 CLI는 새 기본을 사용해 확인한다. main 병합/배포의 채택 판정과 전체 LLM 실전30% 절감 주장은 보류한다. 로컬 고정 workflow의 약94%를 일반 사이트 성능으로 확대하지 않는다.
- 결과/한계: benchmarks/demand-observation-2026-10-15/README.ko.md. 이전 작업 diff와 로컬 raw/profile은 .runtime에 보존하며 공유 변경에 포함하지 않는다.

### 2026-10-15 12:09 추가 실행 기록

| 단계 | 상태 | 근거 |
|---|---|---|
| A rooted collector/map | 구현 및 회귀 검증 | 전체 graph 없는 지도, 실제 root 한정 수집 |
| B read/explain | 구현 및 회귀 검증 | 내용/상태/소속, refs/shadow 경계, 예산 안 저장 관찰 접기 |
| C delivery/since | 구현 및 회귀 검증 | 수신 필드 비교, 질의 변경과 사라진 필드 철회, 만료/소비자 구분 |
| D 실행/CLI/스킬 | 구현 및 회귀 검증 | 기존 호환/실행 유지, 새 기본 hb와 제한된 HWM |
| E 실전/검증 | 30개 수행, 통제 비교는 미실시 | 아래 실전 보고서, 최종 전체 테스트 기록 |

사용자 후속 지시에 따라 실전은 모두 headed, Luna 한 명씩 순차, 학습 OFF, 사이트당 한 번으로 수행했다. 바닐라/browser-use 대조나 실패 사이트 반복은 하지 않았다. 단계 E의 동등 완료 LLM 과업 총비용30% 채택 목표는 미검증 상태다.

실전에서 발견한 내용/근거/지도/팝업/참조/예산 공통 보완을 적용했다. fresh review의 Important3건(지도 URL 마스킹, 선택 필드 철회, N 읽기 대상 재활용)은 RED→GREEN으로 고쳤다. 지도에서도 선택 이름을 철회하며, 구조 식별자가 원래 값으로 돌아와도 무효화한 N 별칭이 다시 살아나지 않도록 검증했다. 최종 리뷰 관련45개 통과. 새 자산/사이트별 공통 코드 예외는 없다.

실전 전체 결과와 한계는 benchmarks/headed-30-2026-10-15/README.ko.md, 정리 수치는 results.json에 둔다. main 병합/배포와 미구현 후속 공간 계산은 수행하지 않는다.

최종 검증: .runtime/headed-30/suite-release.log의 npm test EXIT0. 타입 검사 + HWM/native106·learning35·execution63·scenarios15·discovery46 =265개 통과. git diff --check 통과. 공유 변경에는 raw/profile/.runtime을 포함하지 않는다.
