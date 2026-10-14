# 미국 비SNS 웹사이트 브라우징 비교 실험 사전 계획

2026-10-13. 시행 전 고정. 대상은 목적표집이며 미국 전체 인기 순위 상위 10개라는 주장이 아니다.

## 비교 조건

- 방법 A: D:/APPs/browser-use의 설치된 browser-use CLI (Python browser-use 0.13.11, browser-harness CLI 0.1.13).
- 방법 B: D:/APPs/hyper-browsing 프로젝트의 SKILL.md·명령·스크립트. 현재 working tree의 코드 해시를 시행 전 보존한다.
- 모든 시행의 판단자는 독립 Luna(gpt-6-luna) 서브에이전트이며 reasoning_effort=medium, fork_turns=none. 같은 시나리오·입력·판정 기준을 전달한다. 외부 모델 API를 사용하지 않는다.
- 10개 사이트 × 2개 방법 × 3회 = 60회. 새 에이전트·새 프로필·새 세션. SNS 제외. 로그인·계정·결제·구매·게시·발송 없음.
- 사이트 학습·노하우 저장·러너/액션 생성·수정·승격은 금지. A의 domain skills/telemetry/recording을 끄고 B의 자동 학습 관찰 기록도 끈다. 실험 중 제품 수리 금지. 인프라 오류만 별도 기록하고 대응한다.
- 양쪽 동일 Chrome 실행 파일, 초기 headless, 1440×900, en-US. 계정 없는 프로필. B 자동 headed 폴백은 제품 기능이며 전환 횟수·시간을 기록한다. A는 제공되는 기능 내 headed 전환 가능 여부를 기록한다.
- A의 CLI에는 표시 모드 변경 기능이 없어 공통 실험 환경 관리기로 headed 재시작을 한 번 허용한다. 이 환경 복구는 browser-use 고유 기능으로 주장하지 않으며 추가 시간·호출을 기록한다. 웹페이지 수행은 계속 browser-use에서만 한다. 따라서 '제품의 고유 headed 복구 비교'와 '조건을 최대한 맞춘 UI 수행 비교'를 구분한다.
- 미국 이용 사이트 선정이며 실행 머신/IP가 미국이라고 가정하지 않는다. 실제 locale/시간대/네트워크 조건을 보고한다.
- 동일 도메인 시행이 동시에 실행되지 않게 한다. 순서는 방법·반복을 교차 배치하며, 최대 3개 서로 다른 사이트 시행을 동시에 수행한다. 공용 browser-use 백엔드를 격리할 수 없으면 해당 방법은 직렬화한다.
- 수행 상한: 8분, 브라우저 명령 45회. CAPTCHA/인간 확인은 한 차례 기본 제품 복구 후 차단으로 기록하고 중지한다. CAPTCHA 우회 없음. 예산 종료·부분 수행·차단도 결과에 포함한다. 실패 시행을 성공 시행으로 교체하지 않는다.

## 허용 동작과 성공 판정

홈페이지에서 시작해 UI로 검색·조건 선택·세부 화면 진입·추출을 수행한다. 관찰하지 않은 깊은 URL, 사이트 API, 검색 엔진 캐시, 외부 HTTP로 정답을 가져오는 행위는 금지한다. 도구의 페이지 DOM 읽기·스크린샷·관찰한 요소/링크 사용은 허용한다. 사용자 과업의 대표적 액션 세트이며 정확히 같은 내부 클릭 수를 요구하지 않는다.

각 과업은 4개 사전 정의 체크포인트가 있다. 명시적 화면/URL/페이지 텍스트 증거로 판정하며 4/4만 strict success다. 1~3은 partial, 0은 failed/blocked. 가격·날씨 같은 동적 값의 3회 일치를 요구하지 않는다. 요구 조건이 적용된 결과를 확인해야 한다. 실패나 null 값을 성공으로 주장하지 않는다. 전체 검증 결과와 불확실성을 함께 기록한다.

## 계측

- 첫 브라우저 명령부터 최종 증거까지의 task wall time. 브라우저 준비 시간과 정리 시간은 별도.
- 서브에이전트 배정부터 완료까지의 agent wall time, 도구 명령 횟수, 관찰/탐색/조작/검증 횟수, 오류·재시도·headed 전환.
- 명령 시작/종료, stdout/stderr 원문, 결과 요약, 서브에이전트 최종 보고와 세션 trace를 보존한다. 계정/쿠키/토큰은 내보내지 않는다.
- 내부 사고 시간은 직접 관측되지 않는다. 비도구 시간 = agent wall time - 측정된 도구 점유 시간(겹치는 구간은 합집합). 이 값에는 모델 추론·출력·오케스트레이션·대기·기록이 포함되므로 '순수 사고 시간'으로 표시하지 않는다. 세션 reasoning 메시지 구간 추정치가 가능하면 별도 한계와 함께 기록한다.
- 모형/서비스 token_usage가 제공되면 추출하고, 제공되지 않으면 NA로 표시한다. 수치 추정·날조 금지.
- n=3/셀의 탐색적 결과로 median/min/max·성공 횟수·체크포인트 점수를 보고한다. 모집단 우월성, 의미 없는 유의성 또는 60회가 독립 사이트 60개라는 주장을 하지 않는다. 사이트 단위 대응 비교와 차단 포함/제외 관점을 나누어 설명한다.

## 대상 선정 근거

[Similarweb 미국 전체 순위, 2026년 9월](https://www.similarweb.com/top-websites/united-states/)의 Google·Amazon, [미국 전자상거래 순위](https://www.similarweb.com/top-websites/united-states/e-commerce-and-shopping/)의 Amazon·Walmart·eBay, [미국 전자상거래 업체 분석](https://www.similarweb.com/blog/sales/selling-to-ecommerce/top-ecommerce-companies-usa/)의 Best Buy, [Semrush 미국 여행 순위](https://www.semrush.com/trending-websites/us/travel-and-tourism)의 Booking·Expedia를 참고했다. Wikipedia·Weather.com·IMDb는 지식·날씨·영화 탐색을 대표하는 보완 표본이다. 구체적인 보완 표본 순위는 확인하지 않은 채 단정하지 않는다.

## 산출물

## 인프라 수정 기록

초기 B 래퍼가 fast-path 종료 코드 42를 실제 webctl.cmd처럼 일반 런처로 넘기지 않았다. `forms`를 호출한 r1_booking_hb 첫 시도가 영향을 받았다. 해당 원본은 무효 인프라 시행으로 보존하며, 동일한 입력·새 프로필·독립 Luna로 다시 시행한다. 성공 여부와 무관하게 같은 기준을 적용한다. 이후 래퍼는 종료 42일 때 원래 프로젝트 런처를 호출한다. 제품 코드·시나리오·학습 정책은 바꾸지 않는다. 이 수정과 진행 중 명령 정리 대기 계측 변경은 제품 성능 개선으로 주장하지 않는다.

scenarios.json / trials.json / versions.json / result.json(시행별) / commands.jsonl / 원문 tool 출력 / 집계 CSV / report.ko.md / 재현·수정 우선순위 목록. 공개용 보고서와 원시 trace를 분리하며, 공개 파일에는 최소 증거·집계만 넣는다.
