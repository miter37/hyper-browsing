# 현재 HB 첫 지도 실험

현재 프로젝트 D:/APPs/hyper-browsing/SKILL.md를 먼저 실제로 읽는다. browser-use, 설치된 다른 HB, vanilla Playwright, CUA, 웹검색, 외부HTTP/사이트API 금지. 브라우저는 지정 wrapper만 순차 사용한다.

node --import tsx D:/APPs/hyper-browsing/benchmarks/entry-map-two-2026-10-16/control.mjs SITE cli session open --url HOME --viewport 1440x900 --locale en-US

이후에도 같은 wrapper SITE cli 명령만 사용한다. 한 사이트1회, 8분/45호출, 사이트별 새 headless 프로필이다. 실제 접근 제한이면 해당 사이트만 headed로 전환해 현재 상태를 관찰하고 이어간다. 자동 전환 응답을 먼저 확인하며 이미 headed면 reveal을 반복하지 않는다. 전환 후에도 사람 확인/접근제한이면 종료한다. CAPTCHA 우회·사용자 호출·로그인·구매·장바구니·예약확정 금지. 첫 지도를 읽고 실제 열린창부터 처리한다. 알려진 구간은 최대4개 조작으로 묶고 필요한 후속근거만 받는다. 이름·ref를 추측하지 않으며 과거결과는 읽지 않는다. 학습·자산·제품코드 수정 금지.

모든 JSON 입력과 final.json은 D:/APPs/hyper-browsing/.runtime/entry-map-two-2026-10-16/SITE/ 안에 쓴다. 최종 JSON은 status,checkpoints4개(passed/evidence/command번호),output,difficulties,uncertainties,usedProjectSkill:true,usedBrowserUse:false. wrapper SITE finish ABS_FINAL_JSON으로 저장한다. root가 정리한다. 중간 보고나 질문 없이 도구로 과업에 집중하고 마지막 결과만 보고한다.

# 후속 Luna 실험의 도구 출력 계약

2026-10-16 사용자 확정. 과거 시행의 지침·결과는 소급 변경하지 않는다.

진행 에이전트는 아래 문구를 후속 Luna의 최초 수행 프롬프트에 직접 포함한다. 프로젝트 SKILL.md 사용 지시와 사이트별 과업·실험 제한은 별도로 함께 전달한다.

> HB 명령을 실행하는 호스트 도구의 max_output_tokens는 30000으로 설정한다. 내부 exec_command와 바깥 functions.exec 양쪽에 출력 제한이 있으면 둘 다 30000으로 둔다(functions.exec는 첫 줄 @exec의 max_output_tokens 설정). 플랫폼이 그 값을 지원하지 않으면 허용 최대값을 사용하고 제한 사실을 기록한다. 30k는 출력 허용 상한이며 HB의 limit/byte-budget을 늘리거나 불필요한 정보를 요청하라는 뜻이 아니다. 도구 응답에 truncated output, tokens truncated 등 잘림 표시가 있으면 해당 응답은 일부만 읽은 것이다. 저장된 원본 응답에서 누락된 필요한 부분만 읽거나, 현재의 좁은 범위를 --repeat로 다시 조회한다. 실제로 받지 못한 부분에 delivery/known을 근거로 알고 있다고 판단하지 않는다. 출력 복구를 위해 클릭·입력·제출을 재실행하지 않는다.

감사 시 실제 도구 호출의 상한과 잘림 발생·복구 여부를 확인한다. HB의 coverage.complete=false나 접힘은 호스트 도구의 출력 잘림과 별도로 집계한다. 결과 비교에는 생성 stdout과 실제 전달 텍스트를 구분하고 이미지 비용은 따로 다룬다.

첫 접속에는 `session open --url`이 반환한 작은 패널 지도·열린 창·주요 컨트롤을 먼저 확인한다. 받은 지도에서 바로 조작할 수 있으면 같은 지도를 다시 요청하거나 버튼 이름을 추측해 검색하지 않는다. 지도 수집 실패 또는 기존 탭에 연결해 지도를 아직 받지 못한 경우에만 별도 snapshot으로 지도를 요청한다.
