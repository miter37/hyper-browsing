# 현재 HB · 변경 과업 4개 headed 재시험

2026-10-16 · gpt-6-luna/medium · 프로젝트 SKILL.md · 사이트당1회 · 순차 수행 · 학습 OFF

브랜치 feat/goal-driven-core-relay, HEAD b26b845a693db945eff9dd99268149ae18dac0b4, 미커밋 현재 소스 포함. 동결 파일 변경 0개.

이전 실험과 검색어·조건·브라우저 모드가 달라 동일 과업 성능 비교가 아니다. 모든 시행은 처음부터 headed로 준비했다. browser-use/바닐라 비교는 실행하지 않았다.

| 사이트 | 결과 | 완료 단계 | 과업 시간(초) | 브라우저 호출 | 완료 입력 조작 | 생성 stdout(KiB) | 실제 도구 전달 텍스트(KiB) |
|---|---|---:|---:|---:|---:|---:|---:|
| bestbuy | 성공 | 4/4 | 66.5 | 13 | 4 | 26.0 | 73.8 |
| booking | 부분 완료 | 1/4 | 105.8 | 27 | 8 | 49.4 | 106.1 |
| wikipedia | 성공 | 4/4 | 31.9 | 8 | 1 | 29.0 | 89.3 |
| walmart | 차단 | 1/4 | 15.4 | 4 | 2 | 6.2 | 62.5 |

과업 시간은 첫 브라우저 명령부터 마지막 증거 조회까지이며 준비·정리·최종 보고 작성은 제외한다. 실제 도구 텍스트에는 스킬·도움말 읽기가 포함되고, 생성 stdout과 출력 잘림 정도가 다르다. 명령 사이 시간을 순수 사고시간이라고 부르지 않는다. 토큰은 results-live.json의 실제 제공 사용량만 기록한다.

## bestbuy

홈에서 dell laptop 검색. Dell 노트북 상품 하나의 상세를 열어 이름, 표시 가격, 평점/리뷰 수를 확인. Logitech 필터나 이전 mouse 과업은 사용하지 않음.

{
  "product_name": "Dell - XPS Googlebook - 13.4\" 2.5K Touchscreen Laptop - Snapdragon X Elite X1E-80-100 2024 - 16GB Memory - 512GB Storage",
  "price": "$999.00",
  "rating": "4.0 out of 5 stars",
  "review_count": 1,
  "url": "https://www.bestbuy.com/product/<redacted-long-token>/J3K4L6QQFC/sku/6690181"
}

- Country chooser observed and actual UnitedStates link selected;no mode switch needed.
- Search/ProductSearch guessed queries did not find exact box;small map plus observed placeholder found input.
- Single fill+submit reached results and observed Dell link opened actual detail. Product content rendered,unlike previous mouse trial.
- Rating query included sponsored Acer product alongside main Dell. Owner main versus complementary and review anchor distinguish them;Luna chose correct4.0/1review.
- 13browser calls,no rejected commands. Detail price999.00 obtained without fullbody eval or learned assets.

- Agent final command numbers are shifted;actual files009-013 used here.
- Tool masks product slug as redacted-long-token,so returned URL is not a complete usable link. SKU6690181 remains visible;root does not reconstruct guessed URL.

## booking

시드니,2027-01-10 체크인/2027-01-12 체크아웃,성인2명 객실1개. 1박KRW100000이상으로 검색하고 조건에 맞는 숙소1~2곳의 이름/평점/표시 가격/가격의 숙박기간 기준 확인. USD/AUD 가격을 임의 환산하지 말고 KRW 표시 사용. 정확한 하한이 UI에 없으면 사용가능한 가장 가까운 조건과 차이를 보고.

Partial. Sydney selected: Sydney, New South Wales (Sydney Region), Australia. Intended dates Jan 10–12, 2027 (2 nights), 2 adults, 1 room, with minimum KRW 100,000 per night. Requested date range and price threshold were not applied, so no property names, ratings, or prices can be reported. Currency UI was KRW. Last observed page URL: https://www.booking.com/?chal_t=1792129027404&force_referer= .

- Sign-in overlay caused first fill value_mismatch and later click timeout;dismissed008,then fill009 succeeded. Initial popup evidence was not used promptly.
- snapshot--query without scope and find--roles gridcell were rejected;four total failed calls including overlay-related failures.
- Calendar Nextmonth clicked4times. Effects listed disappearing prior-month gridcell states,not a concise new month overview. Agent overshot January and current map026 showedFebruary2027.
- Two January-date queries returnedzero;panel read027 was incomplete with excludedPanels2. Agent stopped instead of obtaining visible current calendar/previous-month controls,despite budget remaining.
- No search submission means this trial did not reproduce the previous date-loss-on-submit problem. Main observed failure is calendar navigation/recovery and premature stopping.

- 27calls,under8minute/45call budget;agent stopped early without observed access block. Do not claim the site could not support the requested dates.
- Final agent command numbers are inaccurate:actual destination selection012,not007.
- Date query0 on current calendar does not prove January dates unavailable. No previous-month recovery or screenshot was attempted.

## wikipedia

홈 검색 UI에서 BTS를 검색하고 한국 음악 그룹 BTS 문서로 이동. 문서에서 그룹 소개와 멤버 이름 확인.

BTS is a South Korean boy band formed in 2010. The seven members named in the article introduction are Jin, Suga, J-Hope, RM, Jimin, V, and Jung Kook. Source: https://en.wikipedia.org/wiki/BTS

- Home fill+submit003 again returned detached-input outcome_unknown. Initial headed does not fix this common execution failure.
- Instead of retrying Enter,agent observed current BTS field and selected actual Koreanboyband autocomplete;correct document reached006.
- Broad panel read007 had233observed/60shown;queryformed read008 exposed introduction and all7member names with original paragraph/link ownership.
- Content read succeeded without fullbodyeval or HWM explain. Eightcalls,onefailedcommand,nolearning or modechanges.

- Activity information observed is formation2010,not necessarily debut date;do not relabel it as debut.
- No invalid task/follow errors this trial;one detached-input Enter failure remains.

## walmart

홈에서 cheese cake 검색. 먹는 치즈케이크 상품 중 가격/평점/리뷰 수/배송 또는 픽업 재고 근거로 괜찮은 후보1~2개 선택. 정확한 상품명/가격/크기나수량/평점/링크를 짝지어 보고. 구매/장바구니 금지.

Search was submitted from the Walmart homepage UI for “cheese cake”. The site presented a human-verification dialog, preventing search results and product inspection. No purchase or cart action was taken.

- Started headed and homepage loaded200. snapshot--query002 withoutscope was rejected;regular map003 showed actual search field.
- 004 directfill+submit delivered requestedquery and changedURL,then visible human-verification blocked results.
- Agent stopped on current headed block without repeatedreveal,blindsubmitretry,learning or bypass. Fourcalls,total2nonzeroexitcodes including accessblock.

- Agent final calls002 a homepage snapshot,but002 was rejected scope_required;actual map003.
- Search004 execution completed and submitted=true,but ok=false because observation saw CAPTCHA. Do not count this as an input that never ran.

## 실행 출처와 한계

| 사이트 | 초기 실제 headed | 프로젝트 스킬 읽기 | 실제 모델 | 금지 도구 관찰 | root 감사 |
|---|---|---|---|---|
| bestbuy | 확인 | 확인 | gpt-6-luna | 없음 | 완료 |
| booking | 확인 | 확인 | gpt-6-luna | 없음 | 완료 |
| wikipedia | 확인 | 미확인 | gpt-6-luna | 없음 | 완료 |
| walmart | 확인 | 확인 | gpt-6-luna | 없음 | 완료 |

Booking은2027-01-10~12,성인2명/객실1개로 해석했으며 1박10만원은KRW 기준이다. 기본값·다른 숙박기간 가격을 요청 조건 가격으로 간주하지 않는다. 차단이나 미제공은 해당 정보의 부재와 구분해 적었다. 상세 체크포인트는 각 trial의 audit.json, 원시 명령은 command-NNN.json에 보관한다.
