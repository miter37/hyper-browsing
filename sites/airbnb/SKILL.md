---
name: adaptive-web-agent-airbnb
description: Site-specific knowledge, URL architecture, bilingual/currency controls, and automation runner for Airbnb (airbnb.com / airbnb.co.kr).
version: 0.5.0
metadata:
  tags: [browser, site-specific, airbnb, lodging, travel, automation, bilingual]
  category: automation
---

# Airbnb (`airbnb.com` / `airbnb.co.kr`) Site Skill Knowledge

## 1. 개요 및 특성 (Overview)
에어비앤비(Airbnb)는 전 세계 숙소 및 체험을 검색·예약하는 글로벌 숙박 플랫폼입니다.
- **글로벌 도메인 (`airbnb.com`) & 로컬 도메인 (`airbnb.co.kr`)**: 기본 언어와 통화의 초기값이 다를 수 있으나, 동일한 React 기반 동적 SPA 엔진과 URL 파라미터를 공유합니다.
- **다국어 및 통화 지원**: 브라우저 헤더의 언어 모달 또는 URL 파라미터를 통해 즉시 원하는 언어(예: 영어 US)와 통화(예: KRW 원화)로 전환 가능합니다.
- **지연 로딩(Lazy Loading) & 무한 스크롤**: 뷰포트 내 진입 시 카드 정보가 렌더링되므로 스크롤 이벤트 발생이 필수적입니다.

---

## 2. 언어 및 통화 설정 아키텍처 (Language & Currency Controls)

에어비앤비에서 언어(예: English US)와 통화(예: KRW)를 설정하는 데는 두 가지 검증된 경로가 있습니다.

### 2.1. 접근법 A: 결정론적 URL 파라미터 (권장 - 1초 완료)
모달 클릭 없이 URL 쿼리 파라미터만으로 언어와 통화를 즉시 강제 지정할 수 있습니다.
- `locale=en`: UI 언어를 영어로 설정 (한국어: `locale=ko`)
- `country_override=US`: 지역 및 포맷 기준 국가 지정
- `currency=KRW`: 표시 통화를 원화(₩)로 고정 (달러: `currency=USD`)

예시:
```text
https://www.airbnb.com/s/Jongno-gu--Seoul--South-Korea/homes?query=Jongno-gu%2C%20Seoul&locale=en&country_override=US&currency=KRW
```

### 2.2. 접근법 B: 대화형 UI 모달 조작 (UI Interactive Flow)
실제 사용자 세션이나 화면 검증이 필요할 때 브라우저 UI를 통해 선택합니다.
1. **언어/통화 버튼 클릭**:
   - `button[name="Choose a language and currency"]` (영어 상태)
   - `button[name="언어 및 통화 선택"]` (한국어 상태)
   - 공통 셀렉터: `button[aria-label*="language" i], button[aria-label*="언어" i]`
2. **다이얼로그 모달 감지**:
   - 컨테이너: `[role="dialog"]`
3. **언어 항목 선택**:
   - 영어 (미국): 다이얼로그 내부 텍스트 중 `English`와 `United States`를 포함하는 `a` 또는 `button` 요소 클릭.
   - 예시:
     ```javascript
     const target = Array.from(document.querySelectorAll('[role=dialog] a, [role=dialog] button'))
       .find(el => el.innerText.includes('English') && el.innerText.includes('United States'));
     target?.click();
     ```
4. **결과 검증**:
   - `document.documentElement.lang === "en"` 또는 URL에 `locale=en` 반영 확인.

---

## 3. 검증된 탐색 성공 방식 및 URL 아키텍처 (Proven Search Architecture)

복잡한 검색 UI 드롭다운 대신 **결정론적 URL 파라미터 조합**이 가장 안정적이고 빠릅니다.

### 3.1. 기본 검색 URL 포맷
```text
https://www.airbnb.com/s/{지역슬러그}/homes?{쿼리파라미터}
```
지역 슬러그 예시:
- 서울 종로구: `Jongno-gu--Seoul--South-Korea` 또는 `종로구--서울--대한민국`
- 서울 전체: `Seoul--South-Korea`

### 3.2. 핵심 쿼리 파라미터 (Query Parameters)

| 파라미터 | 설명 | 예시 값 |
| :--- | :--- | :--- |
| `query` | 검색 지역/키워드 (영문/한글) | `query=Jongno-gu%2C%20Seoul` |
| `checkin` | 체크인 날짜 (`YYYY-MM-DD`) | `checkin=2026-10-20` |
| `checkout` | 체크아웃 날짜 (`YYYY-MM-DD`) | `checkout=2026-10-24` |
| `min_beds` | 최소 침대 개수 | `min_beds=2` |
| `min_bedrooms` | 최소 침실 개수 | `min_bedrooms=1` |
| `adults` | 성인 인원수 | `adults=2` |
| `price_filter_input_type` | 요금 필터 기준 (`2`: 숙박 기간 총액 기준) | `price_filter_input_type=2` |
| `price_filter_num_nights` | 총 숙박 박수 | `price_filter_num_nights=4` |
| `price_min` | 최소 금액 (원화 KRW) | `price_min=1000000` |
| `price_max` | 최대 금액 (원화 KRW) | `price_max=1400000` |
| `locale` | 언어 코드 | `locale=en` |
| `currency` | 통화 코드 | `currency=KRW` |

### 3.3. 가격 필터 적용 시 필수 원칙 (Price Filter Model)
- 날짜를 지정한 상태에서는 기본적으로 **"전체 숙박 기간 총액(Total Price)"**으로 가격 필터가 동작합니다.
- 예: 1박당 약 300,000 KRW 예산으로 4박(10월 20일~24일)을 검색하는 경우:
  - 4박 총 예상 금액: `300,000 * 4 = 1,200,000 KRW`
  - 권장 필터 범위 (±15~20%): `price_min=1000000`, `price_max=1400000`
  - 필수 동반 파라미터: `price_filter_input_type=2&price_filter_num_nights=4`

---

## 4. DOM 요소 및 데이터 추출 패턴 (DOM Selectors & Extraction)

| 항목 | 선택자 (Selector) | 설명 |
| :--- | :--- | :--- |
| 언어/통화 버튼 | `button[aria-label*="language" i]`, `Choose a language and currency` | 모달 오픈 트리거 |
| 언어 모달 | `[role="dialog"]` | 언어/통화 탭 다이얼로그 |
| 숙소 카드 컨테이너 | `[data-testid="card-container"]` | 목록 내 각 숙소 카드 |
| 숙소 유형/지역 | `[data-testid="listing-card-title"]` | 예: "Apartment in Seoul", "Home in Seoul" |
| 숙소 이름/부제목 | `[data-testid="listing-card-subtitle"]` | 상세 제목 (예: "3BR Private Hanok") |
| 상세 링크 | `a[href*="/rooms/"]` | 숙소 ID 포함 URL (`/rooms/12345678`) |
| 평점 및 리뷰 | 내부 텍스트 중 `★`, `Rating`, `/^[0-9]\.[0-9]{1,2}/` | 예: `5.0 (17)`, `4.92 (216)` |
| 침대 및 객실 정보 | 내부 텍스트 중 `bedroom`, `bed`, `bath`, `침실`, `침대` | 예: `1 bedroom · 2 queen beds · 1 bath` |
| 요금 정보 | 내부 텍스트 중 `₩`, `$`, `total`, `night`, `총액` | 예: `₩1,201,093 total` |
| 배지 | `Guest favorite`, `Top guest favorite`, `Superhost` | 숙소 등급 배지 |

---

## 5. 지연 로딩 처리 (Lazy Loading Handling)
- 에어비앤비는 뷰포트 아래의 카드를 지연 렌더링하므로, 목록 조회 전 최소 2~3회 스크롤이 필요합니다.
- `webctl scroll --session $S --direction down --distance 1000 --times 3` 또는 `window.scrollBy(0, 800)`을 3회 반복합니다.

---

## 6. Windows 환경 실행 시 특수문자 주의사항 (Windows Shell Gotcha)
- Windows `cmd.exe` 및 배치 파일(`webctl.cmd`)에서는 `&` 기호가 명령어 구분자로 해석됩니다.
- URL에 쿼리 파라미터(`?a=1&b=2`)를 넘길 때 `webctl.cmd goto --url "http://...?a=1&b=2"`를 그대로 실행하면 뒷부분이 별도 명령어로 실행되어 오류가 발생합니다.
- **해결책**:
  1. `node <skill>/scripts/webctl-rpc.mjs goto --session <id> --url "..."`로 Node.js 스크립트를 직접 호출
  2. 또는 PowerShell 환경에서 이스케이프하거나 러너(`airbnb_runner.mjs`)를 활용

---

## 7. 범용 CLI 러너 사용법 (Deterministic Runners)

### 7.1. 검색 및 상세 정보 러너 (`airbnb_runner.mjs`)
스크립트 경로: `sites/airbnb/scripts/airbnb_runner.mjs`

```bash
# 1. 영어(US) + KRW 원화 기준으로 서울 종로구 2침대 숙소 검색 (1박 30만 원 예산)
node sites/airbnb/scripts/airbnb_runner.mjs search --domain airbnb.com --locale en --currency KRW --location "서울 종로구" --checkin 2026-10-20 --checkout 2026-10-24 --beds 2 --price-per-night 300000 --limit 10

# 2. 직접 총액 최소/최대 필터 적용 검색
node sites/airbnb/scripts/airbnb_runner.mjs search --domain airbnb.com --locale en --currency KRW --location "서울" --query "종로" --checkin 2026-10-20 --checkout 2026-10-24 --beds 2 --price-min 1000000 --price-max 1400000

# 3. 숙소 상세 정보 확인
node sites/airbnb/scripts/airbnb_runner.mjs detail --url "https://www.airbnb.com/rooms/1038100756772700307"
```

### 7.2. 언어 및 통화 설정 전문 러너 (`airbnb_locale.mjs`)
스크립트 경로: `sites/airbnb/scripts/airbnb_locale.mjs`
실사용 프로필 브라우저에서 언어와 통화 설정을 UI 클릭 기반으로 영구/즉각 전환하고 상태를 확인합니다.

```bash
# 1. 현재 에어비앤비 언어 및 프로필 상태 확인
node sites/airbnb/scripts/airbnb_locale.mjs status --domain airbnb.com

# 2. 영어 (United States)로 UI 언어 전환
node sites/airbnb/scripts/airbnb_locale.mjs set --lang "English (United States)" --domain airbnb.com

# 3. 한국어로 UI 언어 복원
node sites/airbnb/scripts/airbnb_locale.mjs set --lang "한국어" --domain airbnb.com
```
