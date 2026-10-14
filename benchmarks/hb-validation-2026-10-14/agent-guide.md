# hyper-browsing 독립 검증

지정된 1회만 수행하는 Luna 에이전트. 한국어로 기록한다. 다른 시행 결과, 이전 benchmark 보고서/원시 로그, 사이트 자산을 읽지 않는다. 사이트 학습/러닝/노하우 저장/runner/action 생성 및 수정 절대 금지. 제품 코드/설정/프로필 수정 금지.

처음 읽기: 이 지침, scenarios.json 지정 항목, 프로젝트 SKILL.md 및 필요한 docs/COMMANDS.md, EXECUTION.md, BROWSER.md, VERIFICATION.md. 설치된 다른 경로의 스킬을 읽지 않는다.

모든 브라우저 명령은 전용 wrapper만: node --import tsx benchmarks/hb-validation-2026-10-14/control.mjs <ID> hb <webctl 명령>
root가 이미 독립 프로필/daemon을 준비했다. 첫 동작은 session open --url <홈URL> --viewport 1440x900 --locale en-US. 바닐라/브라우즈유즈/직접 Playwright/CUA/web검색/외부 HTTP 사용 금지. eval은 현재 DOM 관찰만 허용, API 호출 및 직접 DOM 쓰기 금지. 관찰하지 않은 깊은 검색 URL로 UI 생략 금지.

한 번에 짧은 명령 하나만 실행하고 응답을 읽는다. 실행 중이면 poll만 하며 재전송 금지. 8분 또는 45 wrapper 호출 상한, 실패도 정상 실험 결과. CAPTCHA는 제품의 한 번 기본 복구 후에도 남으면 blocked로 종료하며 우회 금지. 구매/장바구니/예약/로그인/게시/개인정보 입력 금지. confirmationRequired이면 대상과 위험도 먼저 관찰; 허용된 검색/필터 대상임이 입증된 경우에만 --confirm 가능, 실구매/결제는 금지.

snapshot의 e번호는 현재 화면 전용. stale_ref이면 다시 관찰. nameTruncated이면 --name을 잘린 문자열로 만들지 않는다. effect.newSessions가 있으면 원하는 탭의 sessionId를 명시적으로 선택하고 새로 관찰한다. observationRequired/headedFallback이면 새 화면 확인 후 이어간다. outcome_unknown은 동일 쓰기를 재시도하지 않는다.

검색/필터/날짜/인원/단위는 UI에서 적용된 값을 독립 확인한다. 가능하면 verify --input-file로 요청 조건과 실제 표시값을 검증하되 APPLIED는 입력한 검사 범위만 의미한다. 조건 일부만 검사하고 전체 성공으로 주장하지 않는다. 화면 차단/로딩/불완전이면 성공 판정 금지. 정상 0결과는 요청 조건이 적용됐다면 정상 검색 가능하나 필요한 상품/숙소 정보가 없으면 마지막 checkpoint false.

전용 결과 폴더: .runtime/hb-validation-20261014/trials/<ID>. result-draft.json에 아래 형식 작성하고 wrapper <ID> finish <draft절대경로> 실행한다. cleanup/session close는 root 담당.

{ "site":"지정사이트", "repeat":1, "status":"succeeded|partial|blocked|failed", "checkpoints":[{"passed":true,"evidence":"현재 화면의 구체적 증거","commandSequence":1,"url":"관찰URL"}], "output":{}, "difficulties":[{"type":"분류","detail":"구체적문제","firstCommand":1,"recovery":"실제대응","resolved":false}], "existingAssetsUsed":false, "notes":"불확실성" }

checkpoints는 시나리오 순서대로 4개 필수. 읽지 못한 값은 null. 최종 응답은 status/4점수/핵심 난점/결과 경로. root는 실시간 로그를 검토해 별도 판정한다.
