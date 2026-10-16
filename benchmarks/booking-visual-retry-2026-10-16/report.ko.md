# 현재 HB · Booking 동일 조건 · 조회·시각 폴백 보완 후 headed 재시험

2026-10-16 · gpt-6-luna/medium · 프로젝트 SKILL.md · 사이트당1회 · 순차 수행 · 학습 OFF

브랜치 feat/goal-driven-core-relay, HEAD b26b845a693db945eff9dd99268149ae18dac0b4, 미커밋 현재 소스 포함. 동결 파일 변경 0개.

직전 headed Booking 시행과 검색어·날짜·인원·가격 조건이 같은 보완 후1회다. 직전 동일 조건 시행은 전체 완료였고 이번 시행은 가격 필터 적용에 실패했다. N=1로 일반적 개선 효과를 확정하지 않는다. 모든 시행은 처음부터 headed로 준비했다. browser-use/바닐라 비교는 실행하지 않았다.

| 사이트 | 결과 | 완료 단계 | 과업 시간(초) | 브라우저 호출 | 완료 입력 조작 | 생성 stdout(KiB) | 실제 도구 전달 텍스트(KiB) |
|---|---|---:|---:|---:|---:|---:|---:|
| booking | 부분 완료 | 2/4 | 266.0 | 32 | 8 | 92.0 | 154.3 |

과업 시간은 첫 브라우저 명령부터 마지막 증거 조회까지이며 준비·정리·최종 보고 작성은 제외한다. 실제 도구 텍스트에는 스킬·도움말 읽기가 포함되고, 생성 stdout과 출력 잘림 정도가 다르다. 명령 사이 시간을 순수 사고시간이라고 부르지 않는다. 토큰은 results-live.json의 실제 제공 사용량만 기록한다.

## booking

시드니,2027-01-10 체크인/2027-01-12 체크아웃,성인2명 객실1개. 1박KRW100000이상으로 검색하고 조건에 맞는 숙소1~2곳의 이름/평점/표시 가격/가격의 숙박기간 기준 확인. USD/AUD 가격을 임의 환산하지 말고 KRW 표시 사용. 정확한 하한이 UI에 없으면 사용가능한 가장 가까운 조건과 차이를 보고.

{
  "url": "https://www.booking.com/searchresults.html",
  "search": "Sydney, Australia; 2027-01-10 to 2027-01-12; 2 adults; 1 room; KRW displayed.",
  "properties": [
    {
      "name": "Mercure Sydney",
      "rating": "8.4 Very Good",
      "displayedPrice": "KRW 308,209, includes taxes and fees",
      "pricePeriod": "2 nights, 2 adults (whole stay)"
    },
    {
      "name": "Moxy Sydney Airport",
      "rating": "8.9 Excellent",
      "displayedPrice": "KRW 291,262, includes taxes and fees",
      "pricePeriod": "2 nights, 2 adults (whole stay)"
    }
  ],
  "priceFilter": "Not applied; visible per-night range remained KRW 40,000–KRW 1,000,000+."
}

- Luna used project SKILL.md, headed, no browser-use; one trial.
- Calendar misses009/010 triggered screenshot; actual host image calls confirmed, then gridcell query013 found both December/January candidates and selected correct January cell.
- Four actual tools.view_image calls in agent tool trace; image fallback did execute, not merely return file paths.
- Price searches020–026 stalled: text query budget does not match native slider name Min.; role-only goal requests022/023 invalid_goal.
- Critical delivery gap: raw command030 contains named native Min./Max. sliders and values40000/1000000 with keyboard=native-control; actual truncated tool text contains neither Min. nor Max. Luna therefore reported controls unavailable. Native capture fix works in raw output; actual consumer delivery remains inadequate.
- command030 returned1260 observed controls,47 shown,11016bytes. Agent requested small max_output_tokens and tool truncation hid relevant controls. No product source edits during trial.
- Generic wrappers still appear in goal candidates and panel control output; actionable-control priority is not consistently effective across paths.
- Two property-content queries without --content triggered another screenshot on ambiguity; data-selection intent remains mixed with unique action-target intent.
- After screenshot acknowledgements agent resumed textual scans; image fallback alone did not guarantee progress or a bounded overall recovery sequence.

- Strict original four-checkpoint rubric is2/4; Luna final.json rearranged checkpoints and claimed3/4, corrected here.
- FirstCLI→lastCLI265.988sec; previous identical complete trial170.673sec. N=1 does not establish general performance.
- stdout94258bytes vs1614952bytes (-94.16%); delivered tool text157996 vs171268bytes (-7.75%), includes skill/help. Images excluded from text bytes and image-token cost not separately available.

## 실행 출처와 한계

| 사이트 | 초기 실제 headed | 프로젝트 스킬 읽기 | 실제 모델 | 금지 도구 관찰 | root 감사 |
|---|---|---|---|---|
| booking | 확인 | 확인 | gpt-6-luna | 없음 | 완료 |

Booking은2027-01-10~12,성인2명/객실1개로 해석했으며 1박10만원은KRW 기준이다. 기본값·다른 숙박기간 가격을 요청 조건 가격으로 간주하지 않는다. 차단이나 미제공은 해당 정보의 부재와 구분해 적었다. 상세 체크포인트는 각 trial의 audit.json, 원시 명령은 command-NNN.json에 보관한다.

## 직전 동일 조건 대비

| 지표 | 직전 | 이번 |
|---|---:|---:|
| 결과 | 전체 완료 | 가격 하한 미적용 |
| 과업 시간 |170.673초|265.988초|
| 브라우저 호출 |38|32|
| 생성 stdout |1,614,952B|94,258B|
| 실제 도구 전달 텍스트(스킬·도움말 포함)|171,268B|157,996B|

이미지 4회 실제 열람 확인. 이미지 자체의 토큰·처리 비용은 텍스트 바이트에 포함하지 않았다. 호출과 생성량은 감소했지만 과업은 느려졌고 미완료다. 개선 성공으로 평가하지 않는다. 단일 시행이며 사이트 내용·모델 선택의 변동이 있다.
