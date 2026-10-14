# HWM 0.2 실전 수행 결과

사이트별 1회, Luna 한 명씩 순차 수행. HB만 사용하고 학습은 비활성화했다. 실험 중 제품 코드는 변경하지 않는다. 이 문서는 결과가 나오는 대로 누적한다.

## Wikipedia — 부분 완료

- 실제 표 근거: Personnel → Prime crew. Command Module Pilot은 Michael Collins.
- `/wiki/Neil_Armstrong` 링크: HWM 색인에 수집된 참조는 9개. 그래프 scan.complete=false이므로 페이지 전체 합계는 미검증이다.
- 최초 명령~최종 조회 22.44초, CLI 4회, 명령 소요 시간 합계 5.82초. 환경 준비 2.20초. 순수 사고 시간은 측정하지 않았다.
- 실패 2회: 세션 생성 전 snapshot 요청(수행 절차 오류), 저장되지 않은 관찰에 inspect 요청(observation_expired).
- HWM retention=unavailable이라 저장 관찰 펼침이 불가능했다. 큰 출력이 overview 읽기 비용에도 영향을 줄 수 있다. 미보관 원인과 출력 크기는 후속 분석 대상이다.
- 헤드리스 유지, eval 0회. 프로세스 정리 완료. 전체 링크 합계를 검증하기 전에 에이전트가 정리하여 과업을 부분 완료로 기록했다. 재시행하지 않았다.
- 근거: `.runtime/hwm-live-20261014/wikipedia-1/command-003.json`, `command-004.json`, `result.json`.

## eBay — 감독 정정 후 완료

- Brand: Apple, Dell, HP, Lenovo, Logitech, Microsoft, Razer, Unbranded의 노출된 체크박스가 모두 미선택. see all이 있어 일부 목록이다.
- 앞선 네 카드의 Sponsored 표식을 스크린샷으로 확인. 일반1은 Wireless Mini Mouse, 일반2는 **2.4GHz Wireless Optical Mouse Mice USB Receiver Fit PC Laptop Computer Black@**.
- 일반2: **KRW1,879.02–KRW7,544.41**, **Free International Shipping from China**, https://www.ebay.com/itm/376580650925.
- 최초~최종 CLI 125.75초, 13회, 명령 소요 합계 32.47초(중첩 실행이 있어 벽시계 실행시간과 다름), 준비 2.01초. eval 0회, headed 전환 없음.
- root가 일반상품 두 번째의 순서 혼동을 지적했다. 에이전트는 스크린샷 추가 확인으로 정정했고 root도 마지막 스크린샷을 확인했다. 비감독 성공으로 집계하지 않는다.
- 최초 session open 중복으로 두 로그 sequence=1이 충돌했다. jsonl 시간·인자는 보존되지만 첫 원시 파일은 덮여 썼다. 이후 인프라에 중첩 명령 거부 잠금을 넣었다. 별도 재시행은 없다.
- 근거: ebay-1 command-007, 008, 009, 011, 013 및 result.json.

## GitHub Issues — 완료

- 초기 Open 170, 입력값 is:issue state:open.
- **입력 후 제출 직전**(command-007): URL에는 q 없음; 입력은 is:issue is:open label:bug; Open 170 표시 유지. 아직 제출한 새 조건의 결과가 아니다.
- 제출 후(command-008): URL q에 새 조건이 들어가고 No results matched your search가 표시됐다. 문서 동일성이 달라 HWM 필드 비교는 incomparable이며 성공을 추론하지 않았다.
- CLI 8회, eval 2회, headed 전환 없음. 에이전트의 최종 보고는 초기 상태와 입력 후 상태를 별도로 적었으며 root가 command-007의 Open 170을 추가 확인했다.
- 최초~최종 CLI 55.65초, 명령 소요 합계 11.63초.
- 에이전트는 개수 문구가 HWM에서 누락됐다고 설명했으나 실제 command-007 full에는 Open/170 텍스트가 있다. overview에서 접힌 정보의 발견 및 효율적인 펼침 문제와 진짜 수집 누락을 구분해야 한다.
- 근거: github-1 command-006(초기 상태), 007(제출 직전), 008(제출 후), result.json.

## MDN — 완료

- 검색 입력값 Array.prototype.map. 입력 직후 URL은 유지되고 Search results listbox와 3 results available 안내가 나타났다. map(), flatMap(), TypedArray map 후보를 구분했다.
- 정확한 후보 선택 후 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map 로 이동. 문서 제목 Array.prototype.map() - JavaScript | MDN.
- 첫 문단의 내용: 각 배열 요소에 제공한 함수를 호출한 결과로 새로운 배열을 만든다. 원문은 비공개 근거 로그에 보존했다.
- 최초~최종 CLI 122.48초, 20회, 명령 소요 합계 11.03초. eval 3회. 잘못된 unobserved gap 펼침 1회 실패. headed 전환 없음.
- HWM overview/focus/expand에서 소개를 못 찾았다. eval에서 article 없음, main의 첫 p 비어 있음, 첫 비어 있지 않은 p로 세 번째에 읽었다. 단순히 본문이 없는 문제가 아니라 본문 영역/순서/검색 범위를 찾는 비용을 분석할 필요가 있다.
- 에이전트 result.json의 자체 timings는 실제 명령시간과 불일치하므로 집계에 사용하지 않는다. 결과 파일을 hyphen 날짜 폴더에 작성해 root가 정규 시험 디렉터리로 복사했다. 로그/cleanup은 유실되지 않았다.
- 근거: mdn-1 command-008(입력 후), 009(후보 선택), 020(문단), result.json.

## Hacker News — 완료

- 2026-10-14 18:39:33 KST의 첫 페이지 1~10위 비교. 댓글 최대: 2위 **Gemini 4 Argon**, 1,298 points, 907 comments. https://news.ycombinator.com/item?id=50073879.
- 1~10위 댓글 수: 10, 907, 18, 438, 112, 108, 110, 765, 21, 76. 0개인 글 없음. 목록은 해당 관찰 시점에만 유효하다.
- 제목 행의 id, 다음 메타 행의 score_id와 item?id를 대조해 연결했다. 댓글 페이지의 제목/같은 ID/907 comments도 재확인했다.
- 최초~최종 CLI 53.17초, 6회, 명령 소요 합계 7.53초. HWM expand로 메타정보 읽음, eval 0회, headed 전환 없음.
- 근거: hn-1 command-004(상위10개), 006(댓글페이지), result.json. root도 command-004의 글ID/점수/댓글수를 확인했다.

## Booking.com — 부분 완료

- 로그인 홍보 팝업을 닫았다. 처음 fill은 입력이 유지되지 않았고, 팝업 종료와 입력창 관찰 뒤 New York 입력을 확인했다.
- List of suggested destinations 목록의 New York 항목을 본문 New York hotels 링크와 구분하여 선택했다.
- 초기 날짜는 Check-in date — Check-out date. 날짜를 선택하지 않고 Search를 누르자 https://www.booking.com/city/us/new-york.html 로 이동했다.
- 도시 페이지 제목의 From 가격 KRW201,728, 목록 제목 New York – 1785 hotels and places to stay. 개별 숙소 가격이나 날짜별 예약 가격을 검증한 것은 아니다.
- 관찰한 5 stars를 클릭하자 /searchresults.html로 이동했으나 호텔 목록이 없었다. wait-idle 후 재관찰해도 같고 pageState는 ready였다. 필터 적용과 목록 변화를 검증할 수 없었다. 이 상태만으로 CAPTCHA/접근 차단이라고 분류하지 않는다.
- 전환 후 Wed, Oct 14 — Thu, Oct 15 표시를 확인했다. 에이전트가 고른 날짜가 아니며 설정 원인은 미확정이다.
- 작업 CLI 33회, 최초 페이지 접속~최종 근거 186.76초. help/health/close 포함 총 CLI 37회. eval 1회. headed 전환 없음. root가 마지막 지연렌더링 확인을 요청한 감독 개입이 있다.
- cleanup 이후 health 요청이 런처를 통해 시험 데몬을 다시 시작하는 절차 문제가 있었다. 재접속 과업 시행은 없었다. 인프라에서 정리 후 명령을 거부하고 실제 데몬 PID도 정리하도록 보완했다. root가 최종 시험 데몬을 종료했다.
- 근거: booking-1 command-017~020(후보), 021~024(날짜없이검색), 027~034(필터/목록부재), result.json.

## 집계와 한계

| 사이트 | 결과 | 작업 CLI | 작업 시간 | eval |
|---|---|---:|---:|---:|
| Wikipedia | 부분 완료 | 4 | 22.4초 | 0 |
| eBay | 감독 정정 후 완료 | 13 | 125.8초 | 0 |
| GitHub Issues | 완료 | 8 | 55.6초 | 2 |
| MDN | 완료 | 20 | 122.5초 | 3 |
| Hacker News | 완료 | 6 | 53.2초 | 0 |
| Booking.com | 부분 완료 | 33 | 186.8초 | 1 |

작업 CLI 84회, 전체 기록 CLI 88회, eval 6회. 시간은 사이트별 작업 명령의 최초 시작~최종 근거이며 준비·정리 및 보고 작성 시간을 제외한다. 각 호출에는 여러 내부 브라우저 동작이 포함될 수 있어 클릭 횟수와 같지 않다. 사고 시간과 모델 토큰은 측정하지 않았다.

각 사이트 n=1, 비교군 없음. 4개 완료(그중 eBay 감독 정정), 2개 부분 완료이며 성능 개선률/일반 성공률을 추정하지 않는다. 모든 사이트 헤드리스로 수행했고 확인된 차단이 없어 headed fallback 경로는 이번 실험에서 검증하지 못했다. 부재/제로 결과를 성공으로 바꾸지 않았다.

보고서 작성 과정에서 원시 로그를 검토했으며 에이전트 보고만으로 누락 여부를 단정하지 않았다. 결과와 [보완 후보](improvement-candidates.md)는 제품 변경 **이전**의 관찰이다. 후속 회귀 테스트는 로컬 HTML에서 HB 수집·데몬·투영 경로를 검사하며 실사이트 재시행이 아니다.
