# 검증 조건

개선된 hyper-browsing 단일 방법, 원래 10개 시나리오를 각3회, 총30회. 모델 gpt-6-luna, medium. 각 시행 독립 새 Chrome 관리 프로필/daemon. en-US,1440x900,headless 시작 및 제품의 단일 headed 복구 허용. 학습 비활성화. browser-use/바닐라 실행 없음. 원본60회 비교 실험 보존.

4개 checkpoint 모두 증거로 충족해야 strict success. 실행 completed/page ready/verify 일부 APPLIED만으로 전체 성공 판정하지 않는다. root가 command 원문으로 검토한다. 실패 제거/대체하지 않는다. 네트워크와 사이트 변경 등으로 이전 날짜 성적과 인과 비교 불가.

시간: setup 제외 첫 브라우저 호출 시작부터 마지막 호출 종료까지 taskWallMs. browserCommandMs는 wrapper 실행시간 합. agentWallMs와 toolOccupiedMs를 별도 수집; nonToolMs는 그 차이의 근사치이며 순수 사고시간은 측정할 수 없어 null로 보고. wrapper 호출 수/에이전트 도구 호출 수는 의미가 다르므로 분리. 45회/8분 상한. 프로세스 실행 중 재전송 금지; 시행별 lock 및 사전 sequence 예약으로 중복 로그 방지.

외부 보고에는 결과/관측 오류/타임스탬프/도구 범주만 내보내며 내부 사고 내용, 토큰, 계정 프로필은 제외.


사용자 범위 변경: 2026-10-14 eBay까지 완료된 첫4회만 보고. 3회 반복/30회 계획은 중단되어 수행되지 않았다. Best Buy는 중단된 추가 시행이며 제외, Booking은 준비만 하고 미실행. 실패 시행을 성공으로 대체하지 않았다. 새 browser-use/바닐라 시행은 전혀 없다. 비교 열은 기존2026-10-13 동결60회 결과를 읽기만 해서 재사용한다.
