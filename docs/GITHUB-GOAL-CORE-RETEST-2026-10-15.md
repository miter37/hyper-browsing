# GitHub 목표 코어 재수행 기록

작성: 2026-10-15 — GPT-6 Codex

## 조건과 현재 결과

`feat/goal-driven-core`의 9b2bdb1 코어, 프로젝트 SKILL과 CLI를 부모 에이전트가 직접 사용했다. 이전 Luna 실행과 모델·과업 구간이 다르므로 통제된 속도 비교가 아니다. dy1 관리 Chrome의 headed 세션을 사용했으며 학습 자산은 만들지 않았다.

사용자는 이전 tiger-wife 비공개 생성·별표·삭제 시나리오의 재수행을 요청했다. 로그인 메뉴에서 miter37과 생성 폼의 owner를 확인했고, 로그인 상태의 기존 저장소 경로 404를 확인한 뒤 새 저장소를 만들었다. Private 표시를 extract로, 별표는 Unstar 전환 및 삭제 확인창의 1 star로 확인했다.

최종 삭제 버튼을 누르자 `/miter37/tiger-wife/settings/delete`의 `Confirm access` 재인증 화면으로 넘어갔다. 당시에는 삭제 완료로 보고하지 않고 사용자의 직접 재인증을 기다렸다. 이후 재인증 후 성공 안내와 기존 경로404를 확인해 시나리오를 완료했다. 자격증명·코드는 채팅으로 받지 않았다. 기존·무관한 저장소는 삭제하지 않았다.

## 창 준비에서 발생한 잘못

사용자는 지금 열린 headed dy1을 요청했으나, 연결된 관리 Chrome은 headless였다. 부모가 browser reveal을 실행했고 기존 SessionStore.rebindContext가 이전 실험 URL 전체를 복원했다. 사용자가 탭을 모두 여는 이유를 지적했다. 부모의 초기 연결 판단/명령 선택 오류이며 목표 코어의 성능 이득으로 숨기지 않는다.

복원 중인 프로젝트 데몬을 중지한 뒤 같은 headed Chrome에 재연결했다. 부모가 이전 실험에서 만든 것으로 확인한 탭11개를 닫고 GitHub와 빈 탭만 남겼다. 다른 프로필로 바꾸거나 사용자의 임의 탭을 일괄 삭제하지 않았다. 이 준비 구간은 아래 GitHub 명령 계측에 포함되지 않는다.

## 단계별 관찰

1. 계정 메뉴 클릭 뒤 같은 응답에서 User navigation의 miter37 제목·프로필 링크를 받았다. 메뉴 전체 snapshot을 재요청하지 않았다.
2. Create new 메뉴 열기→New repository 선택을 한 run의 두 단계로 처리했다. 두 실행·URL 검증은 성공했으나 마지막 broad follow가 후보4개를 반환해 전체 결과가 follow_ambiguous/partial이 됐다. 실행 실패와 추가 선택 필요를 더 명확히 분리할 여지가 있다.
3. Repository name ref로 입력하고 같은 응답에서 Public 버튼을 받았다. Public 메뉴 열기→Private 선택을 한 run으로 처리하고 Private 버튼을 검증했다. 1.319초는 이 run 내부 시간이며 전체 과업 시간이 아니다.
4. Create repository 클릭 뒤 URL 검증3초 내에 완료되지 않아 postcondition_unconfirmed로 멈췄다. 제출은 반복하지 않았다. 다음 읽기에서 생성된 URL·owner 근거를 확인했고 Private 원문도 읽었다. 기본3초는 느린 서버 쓰기의 완료 보장이 아니다.
5. Star와 Star lists 후보를 구분해 실제 Star ref를 클릭했다. Unstar를 확인했다. 초기 응답은 disabled/loading 상태였으므로 이 순간만으로 서버 반영을 단정하지 않는다. 이후 삭제 확인창이 1 star를 표시했다.
6. Settings 링크 이동→Delete this repository 버튼을 찾아 확인창 열기를 한 run으로 처리했다(4.019초 내부 시간). 메뉴·설정 본문 전체를 스캔하지 않았다. 실제 dialog 이름이 Delete miter37/tiger-wife인지 확인했다.
7. 부모가 CLI에 --confirmed를 잘못 써 확인 요구/not_started가 한 번 발생했다. CLI는 --confirm이고 JSON/RPC 키는 confirmed다. 실행되지 않았음을 확인한 뒤 올바른 인자로 진행했다. 앱의 클릭 실패로 집계하지 않는다.
8. I want to delete→효과 확인 단계를 거쳐 현재 dialog의 저장소명·별표1개·입력 요구·비활성 삭제 버튼을 같은 응답에서 읽었다.
9. 요구된 miter37/tiger-wife 입력→현재 값 검증→삭제 버튼 활성 확인→최종 삭제 클릭을 한 run으로 수행했다. 기대한 프로필 URL 대신 Confirm access로 이동해 검증은 미확인으로 멈췄다. 삭제 클릭을 반복하지 않았다.

## 재인증 대기 직전 수치

- GitHub 계측 CLI 호출18회: find5/click5/press1/run5/fill1/extract1.
- 내부 논리 조작 시도16개, execution=completed15개. 나머지1개는 부모의 --confirmed 오기로 not_started다.
- CLI 공개 출력26,361B. 원시 RPC 전체·입력 파일·스킬 문서·부모 프롬프트 토큰은 포함하지 않는다.
- 명령 실행 시간 합32.206초. 첫 GitHub 조회부터 재인증 확인까지 벽시계313.423초. 차이는 코드/계획 파일 작성·부모 판단·도구 사이 시간 등을 포함하며 전부 사고시간이라고 부르지 않는다.
- 초기 모드 전환·탭 복원·정리는 제외했고 재인증 대기 이후 시간도 제외했다. 최종 성공률이나 전체 완료시간으로 쓰지 않는다.

이전 Luna 보고의 로그인 후49개 웹 호출/112,721B/약311초는 삭제 완료까지의 값이다. 이번은18개/26,361B/약313초에서 재인증 대기 상태이므로 전체 속도 개선율을 계산하지 않는다. 호출·출력 절감의 징후와 전체 지연은 따로 봐야 한다. 부모의 판단·입력 파일 작성 시간이 여전히 크다.

## 보완 후보

- 현재 headed 창 재사용과 모드 전환을 구분하고, 표시 변경 때 과거 사이트 전체를 암묵적으로 다시 열지 않는 정책이 필요하다. 사용자에게 허용받은 현재 작업의 탭 범위를 유지해야 한다.
- run의 마지막 follow가 복수라는 이유로 모든 동작이 끝난 과업을 partial 실패로 보이는 표현을 재검토한다. 실행 상태·계획 진행 가능 여부·다음 선택 필요를 분리한다.
- 쓰기 요청의3초 미확인은 재실행 근거가 아니다. request status와 현재 상태 확인으로 이어지는 동선을 더 직접적으로 안내해야 한다.
- 단일 --then-file의 expect만 쓴 경우 finding이 verification 안에 남아 receipt 등록과 최상위 finding 경로가 일관되지 않다. 현재 테스트에서는 그 ref를 바로 썼지만, 동일 정보 중복 전달 정책도 정렬해야 한다.
- CLI --confirm과 JSON confirmed를 스킬에서 가까이 설명하고, 모르는 플래그를 조용히 무시하는 정책을 검토한다.
- 비조작 span 원문을 찾는 경우엔 현재 goal 수집 대상이 부족할 수 있다. Private 표시는 기존 extract를 사용했다. 이름과 본문 수집을 혼동하지 말고 적절한 작은 읽기 경로를 유지한다.
- 추가 로컬 호환 진단에서 `mapCommandToRpc(['run','existing_action'], {session:'s'}, new Set())`가 기존 action.run 대신 task.run을 반환하는 명령 충돌을 재현했다. 실제 저장 액션은 실행하지 않았다. 새 계획 run은 두 번째 위치 인자가 없는 경우로 구분해야 한다. 이 GitHub 시나리오는 계획 run만 사용했으므로 해당 오류는 별개이며, 테스트 중 제품 코드는 변경하지 않았다.

원시 계측: `.runtime/github-goal-core-commands.jsonl`. 로그인·세션 관련 로컬 자료이므로 원시 파일을 Git에 올리지 않는다. 이후 재인증 결과는 이 문서에 누적한다.

17:10:30 재확인에서도 동일 Confirm access 화면이었다. 대기 중 추가로 저장소 삭제를 누르거나 자격증명을 조작하지 않았다.

## 재인증 후 최종 완료

사용자가 재인증을 완료했다고 알린 후 읽기만 수행했다. `/miter37?tab=repositories`에서 `Your repository "miter37/tiger-wife" was successfully deleted.` alert를 확인했다. 삭제 버튼을 다시 누르지 않았다. 이미 관찰한 저장소 URL로 재접속해 HTTP404와 Page not found 제목을 확인했다.

최종 계측은 CLI21회, 공개28,202B, 명령시간합36.389초, 벽시계634.825초(10분35초)다. 벽시계에는 재인증 대기·부모 분석·계획 파일 작성이 포함되고 초기 모드 전환·탭 정리는 포함되지 않는다. 관리 호출을 제외해도 이전49회/112,721B와는 모델·UI 노출·추가인증 조건이 다르다. 특히 이번 Settings는 화면에 링크로 바로 노출돼 이전 More 메뉴 경로와 달랐다.

새 코어가 실제로 처리한 묶음은 Create new→New repository, Public→Private, Settings→삭제확인창, 확인명입력→활성버튼선택이다. 모든 단계마다 모델에게 명령을 다시 쓰게 하지는 않았다. 그러나 부모의 작업 분절·입력 파일 작성 비용은 남았고, 이번 전체 실행이 이전보다 빨랐다고 주장하지 않는다.

판정: 목표 동반 조회와 짧은 확정 구간 실행은 작동했다. 서버 작업 지연과 재인증에서는 미확인 상태로 멈추고 읽기만으로 복귀했다. 표시 전환의 전체 탭 복원, 말단 follow 모호함의 partial 표시, expect-only finding/receipt 통합, 기존 run ACTION 호환 충돌은 후속 보완 대상이다. 이번 실험 도중 제품 코드는 고치지 않았다.
