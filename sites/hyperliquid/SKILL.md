---
name: adaptive-web-agent-hyperliquid
description: Site-specific knowledge and operational quirks for Hyperliquid (app.hyperliquid.xyz), maintained by 37web.
version: 0.3.0
metadata:
  tags: [browser, site-specific, hyperliquid, perps, dex, crypto]
  category: automation
---

# Hyperliquid (app.hyperliquid.xyz) Site Skill Knowledge

## Overview
Hyperliquid is an L1 decentralized perpetual exchange and DeFi ecosystem supporting high-throughput trading, staking, yield/earn lending markets, vaults, and prediction markets (outcomes).

## Ecosystem Menus & Architecture

1. **Trade (`/trade`)**:
   - Perpetual futures with up to 40x leverage (BTC: 40x, ETH: 25x, SOL: 20x, HYPE: 10x).
   - Order types: Limit, Market, Stop Market, Take Profit, and Trailing Stop.
2. **Outcomes (`/outcomes`)**:
   - On-chain prediction markets across Crypto (e.g. HYPE touches 100), TradFi, Economics (FOMC rates), and Sports.
3. **Earn (`/earn`)**:
   - Money market lending & borrowing: supply quote assets (USDC, USDT) to earn yields, or supply HYPE/BTC as collateral to borrow against.
4. **Vaults (`/vaults`)**:
   - Protocol Vaults (HLP - Hyperliquid Liquidity Provider) and User Copy-trading Vaults.
5. **Staking (`/staking`)**:
   - Hyperliquid L1 PoS consensus staking: delegate native HYPE tokens to validators to earn protocol staking rewards.
6. **Sub-Accounts (`/subAccounts`) & API (`/API`) & Multi-Sig (`/multiSig`)**:
   - Programmatic trading and enterprise wallet security infrastructure.

## Internal API Discovery (API-First Best Practice)
Hyperliquid exposes an ultra-fast, public JSON-RPC endpoint:
* **Endpoint**: `POST https://api.hyperliquid.xyz/info`
* **Common Request Payloads**:
  - All Perps & Market Context: `{"type": "metaAndAssetCtxs"}`
  - Spot Metadata: `{"type": "spotMetaAndAssetCtxs"}`
  - User State: `{"type": "clearinghouseState", "user": "<0xAddress>"}`

## Reusable Deterministic Runner
- Path: [`sites/hyperliquid/scripts/runner.mjs`](sites/hyperliquid/scripts/runner.mjs)

### CLI Usage:
```bash
# 1. 24시간 거래대금 기준 상위 코인 목록 조회
node sites/hyperliquid/scripts/runner.mjs markets --limit 10

# 2. 특정 코인(HYPE, BTC, ETH, SOL 등) 실시간 가격/펀딩비/OI/거래량 조회
node sites/hyperliquid/scripts/runner.mjs ticker --coin HYPE
node sites/hyperliquid/scripts/runner.mjs ticker --coin BTC
```
