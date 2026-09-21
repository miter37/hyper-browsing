---
name: adaptive-web-agent-tradingview
description: Site-specific knowledge and operational quirks for TradingView (tradingview.com), maintained by hyper-browsing.
version: 0.3.0
metadata:
  tags: [browser, site-specific, tradingview, charts, stocks, crypto, canvas]
  category: automation
---

# TradingView (`tradingview.com`) Site Skill Knowledge

## Overview
트레이딩뷰는 전 세계 주식, 암호화폐, 지수, 원자재를 실시간 차트로 시각화하는 글로벌 금융 플랫폼입니다.

## Known Quirks & Proven Solutions

### 1. Canvas/WebGL 장벽과 HUD Overlay 역이용 기법 (CRITICAL METHODOLOGY)
- **난제**: 
  - 차트 영역 내부에 10개 이상의 `<canvas>` 엘리먼트가 겹쳐 렌더링되며, 캔들스틱과 지표는 DOM 텍스트가 아닌 순수 픽셀로 그려집니다.
- **돌파 해법**:
  - 트레이딩뷰는 스크린 리더와 사용자 편의를 위해 캔버스 바로 위에 **동기화된 실시간 HUD DOM 레이어(`valuesWrapper-*`, `legend-*`)**를 유지합니다.
  - 이 레이어의 텍스트 노드를 파싱하면 캔버스 내부의 실시간 시가(O), 고가(H), 저가(L), 종가(C), 거래량(V), 등락률 데이터를 0.1초 만에 텍스트로 가로챌 수 있습니다.

### 2. 다이렉트 심볼 딥링크 아키텍처
- URL 포맷: `https://kr.tradingview.com/chart/?symbol={EXCHANGE}:{TICKER}`
  - 바이낸스 비트코인: `BINANCE:BTCUSDT`
  - 나스닥 엔비디아: `NASDAQ:NVDA`
  - 한국거래소 삼성전자: `KRX:005930`

## Universal Deterministic Runner
- 파일 경로: [`sites/tradingview/scripts/tradingview_runner.mjs`](sites/tradingview/scripts/tradingview_runner.mjs)

### CLI Usage:
```bash
# 1. 암호화폐 실시간 OHLCV 및 등락률 조회
node sites/tradingview/scripts/tradingview_runner.mjs quote --symbol "BINANCE:BTCUSDT"

# 2. 미국 주식 실시간 OHLCV 조회
node sites/tradingview/scripts/tradingview_runner.mjs quote --symbol "NASDAQ:NVDA"

# 3. 국내 주식 실시간 OHLCV 조회
node sites/tradingview/scripts/tradingview_runner.mjs quote --symbol "KRX:005930"
```
