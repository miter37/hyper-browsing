# Luna 수행 지침

당신은 지정 사이트 한 곳의 과업을 정확히1회 수행한다. 사용자는 중간 보고·질문 없이 작업에 집중하라고 명시했다. commentary로 계획/진행을 말하지 말고 도구를 수행하고 마지막 결과만 반환한다. 다른 시행/과거 정답/실험 보고서는 읽지 않는다.

반드시 `D:/APPs/hyper-browsing/SKILL.md`를 먼저 읽는다. 우리 프로젝트의 그 문서·스크립트만 사용한다. browser-use는 절대 사용하지 않는다. 설치된 다른 hyper-browsing 스킬, vanilla Playwright, CUA, web 검색, 사이트 API/외부 HTTP도 금지한다. 필요한 명령 참조는 프로젝트 docs/COMMANDS.md만 읽는다. 사이트 학습·노하우·러너/액션 생성/수정 금지, 제품 코드 변경 금지.

root가 사이트 전용의 새 headed Chrome과 daemon을 준비했다. 이번에는 처음부터 headed다. browser reveal로 다시 시작하지 않는다. 모든 브라우저 조작/관찰은 아래 wrapper로 순차 수행한다. 변경과 관찰을 동시에 보내지 않는다. SESSION은 session open 응답의 id다. JSON은 자신의 trial 폴더의 실제 파일로 작성한다. 다른 Chrome/CDP/daemon을 열지 않는다.

```
node --import tsx D:/APPs/hyper-browsing/benchmarks/booking-delivery-fix-2026-10-16/control.mjs SITE cli session open --url HOME --viewport 1440x900 --locale en-US
node --import tsx D:/APPs/hyper-browsing/benchmarks/booking-delivery-fix-2026-10-16/control.mjs SITE cli find --session SESSION --query TEXT
node --import tsx D:/APPs/hyper-browsing/benchmarks/booking-delivery-fix-2026-10-16/control.mjs SITE cli run --session SESSION --input-file D:/APPs/hyper-browsing/.runtime/booking-delivery-fix-2026-10-16/SITE/task.json
```

홈 UI에서 출발한다. 이미 관찰한 링크만 따른다. 깊은 검색URL이나 선택자를 추측해 UI를 생략하지 않는다. 마지막 입력이면 fill+submit으로 같은 입력에 Enter를 보내고 마지막 결과를 읽는다. 중간 expect는 필요한 경우만, 최대4개 알려진 조작을 묶는다. 현재 목표만 find하고 모호할 때 소속/현재값을 보고 결정한다. 메뉴의 국소 응답에 답이 있으면 다시 요청하지 않는다. broad 본문 eval은 기본 경로가 아니며 필요한 작은 읽기를 먼저 사용한다. 이름/role/힌트/현재값/href는 서로 다른 근거다. HWM은 필요한 explain에서만 요청하며, SKILL의 범례를 따른다.

처음부터 headed다. 차단이 확인되면 현재 상태를 기록하고 종료한다. CAPTCHA 우회나 사용자 호출, 반복 reveal은 하지 않는다.

첫 브라우저 명령부터8분/45호출 상한. 부족한 정보를 추측하지 않는다. 로그인/구매/장바구니/예약확정/발송/게시 금지. 과업에 명시된 화면·가격 조건을 읽기만 한다. 확인된 검색·필터 적용이 위험도 확인을 요구하면 그 허용된 동작에만 confirmed를 쓸 수 있다.

끝나면 자신의 trial에 final.json을 쓰고 `... SITE finish ABS_FINAL_JSON`으로 저장한다. JSON: status(succeeded|partial|failed|blocked), checkpoints:[{passed:boolean,evidence:string}] 4개, output(확인한 답과URL), difficulties:[{stage,issue,evidence,handling}], uncertainties, usedProjectSkill:true, usedBrowserUse:false. 가능하면 증거에 command-NNN 번호를 적는다. root가 cleanup하므로 브라우저 정리를 위해 불필요한 호출을 하지 않는다. 최종 메시지는 결과 요약만 반환한다.

같은 단계는 동일 goal-id로 유지한다. 현재 프로젝트 SKILL의 이미지 폴백 규칙을 따른다. 이미지와 함께 받은 visual.controls에 충분한 근거가 있으면 관찰된 ref로 바로 수행한다. 본문 질의는 --content로 구분한다.

# 후속 Luna 실험의 도구 출력 계약

2026-10-16 사용자 확정. 과거 시행의 지침·결과는 소급 변경하지 않는다.

진행 에이전트는 아래 문구를 후속 Luna의 최초 수행 프롬프트에 직접 포함한다. 프로젝트 SKILL.md 사용 지시와 사이트별 과업·실험 제한은 별도로 함께 전달한다.

> HB 명령을 실행하는 호스트 도구의 max_output_tokens는 30000으로 설정한다. 내부 exec_command와 바깥 functions.exec 양쪽에 출력 제한이 있으면 둘 다 30000으로 둔다(functions.exec는 첫 줄 @exec의 max_output_tokens 설정). 플랫폼이 그 값을 지원하지 않으면 허용 최대값을 사용하고 제한 사실을 기록한다. 30k는 출력 허용 상한이며 HB의 limit/byte-budget을 늘리거나 불필요한 정보를 요청하라는 뜻이 아니다. 도구 응답에 truncated output, tokens truncated 등 잘림 표시가 있으면 해당 응답은 일부만 읽은 것이다. 저장된 원본 응답에서 누락된 필요한 부분만 읽거나, 현재의 좁은 범위를 --repeat로 다시 조회한다. 실제로 받지 못한 부분에 delivery/known을 근거로 알고 있다고 판단하지 않는다. 출력 복구를 위해 클릭·입력·제출을 재실행하지 않는다.

감사 시 실제 도구 호출의 상한과 잘림 발생·복구 여부를 확인한다. HB의 coverage.complete=false나 접힘은 호스트 도구의 출력 잘림과 별도로 집계한다. 결과 비교에는 생성 stdout과 실제 전달 텍스트를 구분하고 이미지 비용은 따로 다룬다.
