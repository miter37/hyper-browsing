# 현재 HB · Booking 동일 조건 · 국소 상태 보완 후 headed 재시험

2026-10-16 · gpt-6-luna/medium · 프로젝트 SKILL.md · 사이트당1회 · 순차 수행 · 학습 OFF

브랜치 feat/goal-driven-core-relay, HEAD b26b845a693db945eff9dd99268149ae18dac0b4, 미커밋 현재 소스 포함. 동결 파일 변경 0개.

직전 headed Booking 시행과 검색어·날짜·인원·가격 조건이 같은 보완 후1회다. 이전 시행은 미완료였으므로 시간만 직접 비교하지 않는다. N=1로 일반적 개선 효과를 확정하지 않는다. 모든 시행은 처음부터 headed로 준비했다. browser-use/바닐라 비교는 실행하지 않았다.

| 사이트 | 결과 | 완료 단계 | 과업 시간(초) | 브라우저 호출 | 완료 입력 조작 | 생성 stdout(KiB) | 실제 도구 전달 텍스트(KiB) |
|---|---|---:|---:|---:|---:|---:|---:|
| booking | 성공 | 4/4 | 170.7 | 38 | 9 | 1577.1 | 167.3 |

과업 시간은 첫 브라우저 명령부터 마지막 증거 조회까지이며 준비·정리·최종 보고 작성은 제외한다. 실제 도구 텍스트에는 스킬·도움말 읽기가 포함되고, 생성 stdout과 출력 잘림 정도가 다르다. 명령 사이 시간을 순수 사고시간이라고 부르지 않는다. 토큰은 results-live.json의 실제 제공 사용량만 기록한다.

## booking

시드니,2027-01-10 체크인/2027-01-12 체크아웃,성인2명 객실1개. 1박KRW100000이상으로 검색하고 조건에 맞는 숙소1~2곳의 이름/평점/표시 가격/가격의 숙박기간 기준 확인. USD/AUD 가격을 임의 환산하지 말고 KRW 표시 사용. 정확한 하한이 UI에 없으면 사용가능한 가장 가까운 조건과 차이를 보고.

{
  "url": "https://www.booking.com/searchresults.html?label=<redacted>&aid=304142&ss=Sydney%2C+New+South+Wales+%28Sydney+Region%29%2C+Australia&dest_id=-1603135&dest_type=city&checkin=2027-01-10&checkout=2027-01-12&group_adults=2&no_rooms=1&group_children=0&nflt=price%3DKRW-100000-max-1",
  "stay": "Sydney, Australia; Jan 10–12, 2027 (2 nights); 2 adults, 1 room",
  "price_filter": "Minimum KRW 100,000 per night; applied in Booking.com UI; currency KRW",
  "properties": [
    {
      "name": "Shangri-La Sydney",
      "rating": "8.7 Excellent (9,037 reviews)",
      "displayed_price": "KRW 595,933 including taxes and fees",
      "period": "2 nights, 2 adults",
      "average_per_night_from_displayed_total": "KRW 297,966.5"
    }
  ]
}

- Initial modal was handled before destination entry,no value_mismatch or timedout backgroundclick this time.
- 010 response current.headings shows November2026/December2026;012 shows December2026/January2027. Agent stops advancing after2next-month actions and selects Jan10/12 instead of4advances then prematurestop.
- Monthlyclick responses1893/1847stdout bytes,including currentcontext plus boundedchoices. No fullpage dump required for calendar recovery.
- 020 searches with requested dates/occupancy and reaches actual searchresults.html,unlike original undated-city trial.
- 021-036 include broad/zero pricequeries,control lookup and one rejectedscoped snapshot before native Min slider filled037. Filter discovery remains less efficient than calendar.
- 038 scopedmatch returns entire named propertycard with rating/price/staylength kept together;agent reports1validcandidate and stops.
- No proof of general successrate or timing gains from one before/after;observed targeted improvement is currentmonth delivery and completing this formerlyunfinished task.
- 034/035 exact slider Min searches returnedzero.036 richgraph has Min/Max native range inputs at1x1CSSpx with aria-label names/values;033 scopedreadN303 had no usable control fields.037 direct semantic slider fill succeeds. Selective observation/execution discrepancy and large legacy fallback remain unresolved.

- 38calls/170.673sec. Previous same-condition headed trial stopped27calls/105.799sec with onlydestination completed,so lower prior time was not successful performance.
- Nightly297966.5 is arithmetic total/2,not a separately displayed nightly room rate.
- Agent difficulties=[] omits rejectedquery and repeatedfilter discovery;rawlog audit retains them.
- Product frozen during trial;no root coaching/site-specific selectors/no learning/no browser-use.
- 036 legacy JSON generated1522674stdout bytes;wholetrial1614952bytes. Actual tool-delivered text171268bytes includes skill/help and truncation,not equivalent to stdout.

## 실행 출처와 한계

| 사이트 | 초기 실제 headed | 프로젝트 스킬 읽기 | 실제 모델 | 금지 도구 관찰 | root 감사 |
|---|---|---|---|---|
| booking | 확인 | 확인 | gpt-6-luna | 없음 | 완료 |

Booking은2027-01-10~12,성인2명/객실1개로 해석했으며 1박10만원은KRW 기준이다. 기본값·다른 숙박기간 가격을 요청 조건 가격으로 간주하지 않는다. 차단이나 미제공은 해당 정보의 부재와 구분해 적었다. 상세 체크포인트는 각 trial의 audit.json, 원시 명령은 command-NNN.json에 보관한다.
