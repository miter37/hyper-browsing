# HWM0.2 문법 직접 안내 후 과거 난항 사이트 수행

사이트마다 Luna/medium 초기 프롬프트에 HWM 표식과 명령 의미를 직접 넣었다. 설명 목록은 [프롬프트 계약](hwm-prompt-contract.md), 조건과 선정 근거는 [프로토콜](protocol.md)에 기록했다. 단회·HB만·학습OFF·한 agent씩 순차 시행. 성능 인과효과를 측정한 통제실험은 아니다.

## Best Buy — 부분 완료 (2/4)

- 시작 전에 agent가 gap4종, scan/end, 선택집합의 완결성, 실행완료와 성공을 올바르게 설명했다. 그 설명은 실제 초기 message에서 직접 제공한 것이다.
- 홈 UI 검색 wireless mouse 확인. Logitech URL facet, native checkbox checked, 선택 칩 상태를 함께 확인했다.
- 필터 적용 후 실제 화면의 상품 영역이 비어 상세 링크를 찾지 못했다. full 관찰(6000 수집상한)/query/screenshot/DOM anchor 조회로 확인했다. 가격·평점·리뷰 수는 추정하지 않았다. CAPTCHA나 지속적인 접근 제한은 관찰하지 않았다.
- 첫 CLI~마지막 근거: 315.57초. CLI35회, 실패응답2회, 명령 소요 합78.01초, 실제 eval1회. agent의 evalFallbacks 목록에는 JSON query snapshot도 들어 있어 wrapper 인자 기준으로 eval 횟수를 정정했다.
- HWM 사용: saved focus/inspect/expand, 상태/URL 쿼리, 정확한 folded 핸들. stale_ref는 새관찰 후 복구했고 outcome_unknown은 request status 및 화면으로 확인하여 동일 클릭을 재발송하지 않았다.
- 문법 설명 후에도 빈 결과 화면은 해결되지 않았다. 올바른 판단/복구는 긍정적 증거이나 더 빠르거나 성공률이 높아졌다는 증거로 일반화하지 않는다.
- 근거: `.runtime/hwm-guided-20261014/bestbuy-1/command-016~024.json`, 032~035, result.json. cleanup 완료. root의 해법 제공이나 답 정정은 없었다.

## Walmart — 완료 (4/4)

- 시작 전 문법을 정확히 설명했다. 초기 프롬프트에 표식/조회 규칙을 직접 제공했다.
- 홈UI 검색 wireless mouse; Price: Low to High를 고르고 View results로 적용. URL q=wireless+mouse&sort=price_low를 확인했다.
- 관찰된 상품 카드/링크를 inspect로 짝맞춘 뒤 상세 진입. 제목: WZXPWT 2.4GHz Wireless Gaming Mouse: 6-Key Optical Mouse with USB Receiver, 2000 DPI - Red, 3.9 x 2.4 x 1.4.
- 상세 URL: https://www.walmart.com/ip/WZXPWT-2-4GHz-Wireless-Gaming-Mouse-6-Key-Optical-Mouse-with-USB-Receiver-2000-DPI-Red-3-9-x-2-4-x-1-4/10624611588?classType=VARIANT&from=/search
- 현재 표시 Now $1.99. 배송 도착 Oct24–Oct28/$4.49. root가 command-045의 실제 스크린샷을 확인했다. **제목에 Red가 포함돼 있지만 실제 선택 색상은 Black**이다. Red 옵션에도 같은 가격이라는 주장으로 쓰지 않는다. 배송 대상 Sacramento,95829가 표시된 현재 상태의 안내이며 일반 배송조건으로 확대하지 않는다.
- 초기 검색 후 loading에서 제품이 headless→headed 자동전환했다. 이후 라디오 선택 응답에 human-verification 신호가 있었으나 후속 화면은 정상 Filters 모달이고 적용/결과가 진행됐다. 신호의 원인이 오탐인지 일시적인 실제 challenge인지 확정하지 않으며 지속차단으로 집계하지 않는다. 추가 reveal/CAPTCHA우회 없음.
- 최초 CLI~마지막근거 248.87초, CLI45회(상한), 실패응답3회, 명령소요합51.95초. 실제 eval10회(실패한 --expression 인자 호출 포함). agent의 요약 fallback목록보다 많으므로 원시 인자로 집계한다.
- HWM으로 값·URL·카드소속·참조를 읽었지만 여러 추가 DOM조회/스크린샷이 필요했다. 잘못된 focus='n', eval --expression 인자 등 수행 절차 오류도 남았다. 교육 제공은 오류가 모두 사라졌다는 뜻이 아니다.
- 중간 차단보고와 최종경과가 달라 root가 시점별 근거를 요청했다. 해법이나 조작 대상은 제공하지 않았다. agent가 정리한 결과에 root가 색상/배송지역의 관찰 한정을 추가했다.
- 근거: walmart-1 command-006(자동전환), 035~037(필터적용), 040~042(상품짝맞춤/상세), 043~045(상세정보), result.json. cleanup 완료.

## Expedia — 부분 완료 (1/4)

- 시작 전에 직접 받은 HWM 문법의 이해를 설명했다. 목적지 선택과 달력 날짜 2026-11-17~19일의 화면 요약은 확인했다.
- Done 버튼이 화면/스크롤 경계 문제로 활성 조작되지 않아 날짜 적용과 검색 결과를 검증하지 못했다. 성인2/객실1, 평점필터, 숙소이름/평점/가격은 미검증이다.
- agent가 홈진입을 별도 passed로 세었으나 사전 과업의4체크포인트에서는 목적지 선택만 완료로 집계한다. 날짜선택요약을 적용된 검색조건으로 인정하지 않는다.
- 최초CLI~최종근거254.42초, CLI45회, 실제 eval15회(실패호출 포함). agent의fallback목록은실제호출보다적어원시인자로집계했다. 중단은 명령수 상한이며 8분 시간초과라는 중간 설명은 원시로그와 달라 정정한다. 순수 사고시간은 미측정이다.
- 추가 Tab/현재focus DOM읽기 반복으로 예산을 소진했다. 개념 이해와 실제 컨트롤 접근 효율은 별개다. 정상 dialog의 scroll/layout-boundary와 해당컨트롤 위치에 도달하는 경로를 공통적으로 보강할 근거다.
- headed 전환 없음, CAPTCHA 차단 관찰 없음. cleanup 완료. 근거: expedia-1 command-027~029(날짜선택/Done실패), 030~045(추가조회), result.json.

## 결론과 후속 후보

세 초기 메시지에 문법 설명 자체를 직접 넣었고 세 agent가 핵심개념을 정확히 설명했다. 결과는 Walmart완료, BestBuy/Expedia부분완료다. 문법교육이 충분하면 모든 난항이 해결된다는 가설은 이번 결과로 지지되지 않는다. 날짜/조건 적용과 실행완료를 구분한 근거 읽기는 확인됐지만 효율 문제가 남았다.

우선순위: 실제query/matches 우선 overview 투영; dialog/폼/스크롤범위에서 원하는컨트롤과주변내용을찾는공통조회; 부분수집과실제빈그리드의범위확인; 불필요한전역DOM읽기/Tab반복줄이기. 특정도메인 예외나 사이트의 표시가격을 추정하는 규칙은 추가하지 않는다.

세 사이트 n=1이며 최신제품/동적사이트상태/지침이과거와다르다. 과거전체성공 0/3이던 Walmart가이번성공했어도 문법설명의인과효과로단정하지않는다. vanilla/browser-use비교/학습/사이트자산화/실험중제품수정은없었다. 수치원본은 metrics.json, 원시명령은 .runtime/hwm-guided-20261014에보존했다.
