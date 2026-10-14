# 결과 패키지 사용

`report.html`을 브라우저에서 열면 차트와 60개 시행 검색 표를 볼 수 있다. 차트는 HTML 내부에 포함되어 인터넷 연결이 필요 없다. 연결된 JSON·CSV·추가 문서까지 보려면 ZIP 전체를 같은 폴더에 풀어야 한다.

`results.csv`는 UTF-8 BOM 형식이다. 과업 시간과 비도구 시간은 밀리초 원본이며, 순수 사고 시간인 `reasoningTimeMs`는 측정할 수 없어 비워 두었다. `duplicateCommandSequences`는 호출 번호 충돌의 수다. 호출 수는 번호의 최댓값이나 출력 파일 수 대신 append 로그 행 수에서 계산했다.

`summary.json`, `evidence.json`, `verification.json`은 집계·독립 판정·완료 검증이다. 원시 명령 출력, 브라우저 프로필, 쿠키, daemon 토큰, 에이전트의 숨겨진 추론과 시스템 지침은 패키지에 포함하지 않았다. 개인 머신의 IP가 노출된 CAPTCHA 원문도 공개하지 않는다.

`source-snapshot.zip`에는 B의 동결 소스 59개 및 실행 참조 문서, A의 설치된 CLI 관련 소스 4개와 SHA256 목록이 있다. 의존 패키지 전체와 Chrome 실행 파일은 포함하지 않았다. Python browser-use 패키지와 실제 browser-harness CLI의 버전을 혼동하지 않아야 한다.

재현 시 `protocol.md`, `scenarios.json`, `agent-guide.md`를 먼저 읽고 설치 경로를 현재 머신에 맞춘다. 제품 소스는 측정된 작업 트리이며 Git 커밋 하나와 완전히 같지 않다. 각 독립 Luna 시행 전에 `control.mjs <ID> init <hb|bu> <sequence>`로 새 백엔드를 준비한다. 모든 브라우저 호출은 래퍼로 기록하고, 학습·러너/액션 생성·수정을 금지한다. 각 시행 후 finish·cleanup을 실행한다. 성공한 시행을 골라 실패 시행을 교체해서는 안 된다.

집계 코드는 `collect.mjs → verify.mjs → analyze.mjs → report.mjs → figures.py → publish.py` 순서다. collect는 보존된 로컬 Codex 세션 메타데이터와 로컬 시행 로그를 필요로 한다. 그 비공개 원본 없이 공개 패키지만으로 전체 재집계를 실행할 수는 없다. 공개 CSV/JSON을 이용한 집계 재검산은 가능하다. 새로운 실험은 새 날짜/폴더에서 별도로 실행해야 한다.

유효 60회 외에 래퍼 forms 전달 오류의 무효 시행 1회를 보존했다. `invalid-trials.json`에 사유가 있으며 pilot은 제외했다. 번호 충돌은 Google A/B 2차 및 IMDb B 3차에서 발생했고, 주요 판정 증거와 호출 시간은 보존되어 결과에 유지했다. 상세 제한은 보고서에 기술했다.
