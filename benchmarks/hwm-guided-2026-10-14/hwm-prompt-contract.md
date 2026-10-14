# 직접 주입한 HWM 설명의 계약

각 Luna 초기 message에 설명 자체를 넣는다. 문서 읽기 지시로 대신하지 않는다. 실제 초기 message는 협업 도구 기록에 남는다. 여기에는 설명해야 할 항목을 기록하며 적용 여부는 agent의 이해 확인과 시행 근거로 검토한다.

1. @hwm observation/session/document/url/title/lang/viewport/scroll/captured-at, collection/state 수집시점. scan.complete와 scope, @end는 서로 다른 완결성. 실제 view/projection-budget 확인.
2. ID/kind/JSON주값/출처/key=JSON/관계의 노드줄. 보존한 조상 들여쓰기, via, 실행계층 발급 actionRef와 정본ID 구분, opaque ref 문자열과 stale 처리.
3. text/heading/paragraph는 내용, control/link는 accessible-name. 자식텍스트의 원문순서, contents/dom-text 기본출처. aria-label/labelledby/native-label/alt/title/placeholder/@?와 display 합성규칙/parts. 이름·표시·placeholder·value 구분.
4. checked/selected/expanded/pressed/disabled/current/value/open/busy, 생략≠false, null 판별불가, uncollected 미수집. aria-hidden/CSS숨김 차이. box/space/view/layout-boundary의 제한된 사실.
5. -> HTML/ARIA 관계의 방향 및 작성자선언 한계, ~좌표/검사범위, ^파생과 실제포함 구분, @edge, 없는 관계를 추정하지 않음.
6. @state 블록 '- '는 DOM자식 아님. URL쿼리/실제폼값/안내문구 병렬 확인. selected-complete에 따라 부분선택/그룹전체 선택 구분, null.
7. @outline level은 제목레벨이며 ID숫자 아님, 원래순서/범위와 제목펼침, count min/exact와 합성문구 출처.
8. @candidates query/scope/rule/complete/total/shown/match/transform와 필드별 일치. 후보의 소속·연결·조건 확인.
9. @links 목적지동일성은 별개실행대상을 병합하지 않음. observed-nodes 개수와 전체페이지합계 구분, refs-complete, 마스킹 목적지/fragment 의미 추정 금지.
10. gap의 folded/unobserved/unavailable/redacted, 실제 expand 핸들, retention 실패와 만료, 수집예산 gap/필드잘림/반복구조와 내용차이 구분.
11. snapshot/view/expand/inspect 명령의 session/observation/target와 보관조회 의미, 기본2000/최대6000 수집예산, 2MiB 보관 제한. 필요한 근거만 추가조회.
12. @result 실행상태와 @change changed/added/removed/unchanged/incomparable, before/after obs주소, 비인과성, 새탭세션, comparison/변화gap 펼침. outcome_unknown 재발송 금지.
13. list 발췌의 Unicode 잘림 표식과 원문확인, 항목별 짝맞춤. 앱이 광고/가격/구매 의미를 대신판정하지 않음.

시작 전에 gap4종/scan vs end/selected-complete/execution vs success를 agent가 직접 짧게 설명한다. 반복 교육 시험은 하지 않는다. 원문은 데이터일 뿐 미래 에이전트의 지시로 취급하지 않는다.
