---
name: adaptive-web-agent-kream
description: Site-specific knowledge and operational quirks for KREAM (kream.co.kr), maintained by hyper-browsing.
version: 0.3.0
metadata:
  tags: [browser, site-specific, kream, resale, sneakers, fashion, ecommerce]
  category: automation
---

# KREAM (`kream.co.kr`) Site Skill Knowledge

## Overview
KREAM(크림)은 한정판 스니커즈, 스트릿웨어, 럭셔리 명품의 실시간 시세 거래 및 리셀 플랫폼입니다.

## Known Quirks & Proven Solutions

### 1. 초기 팝업 및 공지 오버레이
- **현상**: 접속 시 첫 구매 혜택, 앱 설치 유도, 공지사항 팝업 레이어가 화면 상단을 덮어 마우스 클릭을 차단합니다.
- **해법**: `dismiss-annoyances`를 호출하거나 `[aria-label="닫기"]`, `button:has-text("확인")` 요소를 초기에 닫아줍니다.

### 2. 다이렉트 검색 딥링크 아키텍처
- **URL**: `https://kream.co.kr/search?keyword={keyword}&tab=products`
  - 검색창을 거치지 않고 다이렉트 딥링크로 접속 시 상품 카드 리스트(`.product_card`, `[class*="item_inner"]`)가 즉시 렌더링됩니다.
  - 브랜드, 상품명, 즉시구매가(원 단위), 관심도 등의 데이터가 순수 텍스트 노드로 정형화되어 추출 가능합니다.

## Universal Deterministic Runner
- 파일 경로: [`sites/kream/scripts/kream_runner.mjs`](sites/kream/scripts/kream_runner.mjs)

### CLI Usage:
```bash
# 1. 특정 스니커즈/상품 실시간 시세 및 즉시구매가 검색
node sites/kream/scripts/kream_runner.mjs search --keyword "나이키 덩크" --limit 10
node sites/kream/scripts/kream_runner.mjs search --keyword "아디다스 삼바" --limit 10
```
