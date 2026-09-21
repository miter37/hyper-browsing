---
name: adaptive-web-agent-coinbase
description: Site-specific knowledge and operational quirks for Coinbase (coinbase.com), maintained by hyper-browsing.
version: 0.3.0
metadata:
  tags: [browser, site-specific, coinbase, crypto, market-cap, prices]
  category: automation
---

# Coinbase (`coinbase.com`) Site Skill Knowledge

## Overview
코인베이스(Coinbase)는 전 세계 디지털 자산 시세, 시가총액, 트렌드 및 암호화폐 거래를 제공하는 글로벌 대표 거래소입니다.

## Known Quirks & Proven Solutions

### 1. Market Explore Table Extraction
- **경로**: `https://www.coinbase.com/explore`
- **DOM 구조**:
  - `table tbody tr` 노드에 암호화폐 랭킹, 이름, 티커 심볼, 원화(KRW)/달러 실시간 시세, 24시간 등락률이 포함되어 있습니다.
  - 비인가 계정 접근 시 일부 행에 아이콘 폰트(󰟶)나 가입 유도 링크가 노출되므로 이를 필터링하여 순수 토큰명/가격만 정제합니다.

## Universal Deterministic Runner
- 파일 경로: [`sites/coinbase/scripts/coinbase_runner.mjs`](sites/coinbase/scripts/coinbase_runner.mjs)

### CLI Usage:
```bash
# 1. 상위 암호화폐 실시간 시세 및 24h 변동률 조회
node sites/coinbase/scripts/coinbase_runner.mjs explore --limit 10
```
