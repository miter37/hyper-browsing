---
name: adaptive-web-agent-skyscanner
description: Site-specific knowledge and operational quirks for Skyscanner (skyscanner.co.kr), maintained by 37web.
version: 0.3.0
metadata:
  tags: [browser, site-specific, skyscanner, flights, travel]
  category: automation
---

# Skyscanner (`skyscanner.co.kr`) Site Skill Knowledge

## Overview
스카이스캐너는 전 세계 항공권, 호텔, 렌터카를 가격 비교하고 최저가를 탐색하는 여행 메타서치 플랫폼입니다.

## Known Quirks & Proven Solutions

### 1. PerimeterX (HUMAN Security) 안티봇 차단 메커니즘
- **특징**: 스카이스캐너는 고도화된 안티봇 솔루션인 **PerimeterX (HUMAN Security)**를 전면 적용하고 있습니다.
- **차단 트리거**:
  1. CDP나 자동화 제어 플래그(`navigator.webdriver`)가 감지되거나,
  2. 항공권 직접 검색 URL(`/transport/flights/...`)로 헤드리스 상태에서 다이렉트 진입할 경우 즉시 캡차 챌린지 페이지(`/sttc/px/captcha-v2/index.html`)로 리다이렉트됩니다.
- **대응 전략 (Bypass Pattern)**:
  - 사용자가 열려 있는 실제 Chrome 브라우저 프로필 창(`webctl browser reveal` 또는 기본 브라우저 창)에서 캡차 1회 통과(버튼 길게 누르기) 시 PerimeterX 쿠키(`_px*`)가 영구 프로필에 저장되어 이후 정상 쿼리가 가능해집니다.
  - 에이전트는 검색 쿼리를 표준 Skyscanner URL 구조에 맞게 생성하여 사용자에게 직접 제공하거나 세션 통과 후 파싱합니다.

### 2. 항공권 검색 URL 규칙 (Deterministic URL Architecture)
- **기본 포맷**:
  ```
  https://www.skyscanner.co.kr/transport/flights/{출발지도시코드}/{도착지도시코드}/{출발일YYMMDD}/{도착일YYMMDD}/?adultsv2={성인수}&cabinclass={좌석등급}&ref=home
  ```
- **도시/공항 코드 규칙 (City Code vs Airport Code)**:
  - 서울 전체: `sela` (인천: `icn`, 김포: `gmp`)
  - 도쿄 전체: `tyoa` (하네다: `hnd`, 나리타: `nrt`)
  - 오사카 전체: `osaa` (간사이: `kix`)
  - 방콕 전체: `bkkt` (수완나품: `bkk`)
  - 파리 전체: `pari` (샤를드골: `cdg`)
- **날짜 형식**: `YYMMDD` (예: 2026년 10월 15일 → `261015`)

## Universal Deterministic Runner
- 파일 경로: [`sites/skyscanner/scripts/runner.mjs`](sites/skyscanner/scripts/runner.mjs)

### CLI Usage:
```bash
# 1. 항공권 다이렉트 검색 URL 빌드 (서울 -> 도쿄, 2026-10-15 ~ 2026-10-18)
node sites/skyscanner/scripts/runner.mjs build-url --origin SELA --dest TYOA --depart 2026-10-15 --return 2026-10-18

# 2. 브라우저 실시간 검색 수행 및 봇 차단 상태 감지
node sites/skyscanner/scripts/runner.mjs search --origin SELA --dest TYOA --depart 2026-10-15 --return 2026-10-18 --adults 1
```
