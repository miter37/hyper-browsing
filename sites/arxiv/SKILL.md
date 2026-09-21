---
name: adaptive-web-agent-arxiv
description: Site-specific knowledge and operational quirks for arXiv (arxiv.org), maintained by hyper-browsing.
version: 0.3.0
metadata:
  tags: [browser, site-specific, arxiv, research, papers, ai, ml]
  category: automation
---

# arXiv (`arxiv.org`) Site Skill Knowledge

## Overview
arXiv는 컴퓨터 과학, 인공지능, 수학, 물리학 등의 최신 학술 논문 프리프린트(Preprint)가 매일 가장 빠르게 등재되는 글로벌 연구 저장소입니다.

## Known Quirks & Proven Solutions

### 1. Recent Listings Structure
- **URL**: `https://arxiv.org/list/{category}/recent` (예: `cs.AI`, `cs.LG`, `cs.CL`, `cs.CV`)
- **DOM 계층 구조**:
  - 논문 목록은 `<dl>` 태그 아래 `<dt>`(논문 식별자, PDF 다운로드 링크)와 `<dd>`(제목, 저자, 서브젝트)의 1:1 매칭 쌍으로 구성됩니다.
  - 제목은 `.list-title` 내부에 위치하며 접두사 `Title:`를 제거하여 정제합니다.

### 2. Search & Abstract Direct Parsing
- 검색 결과는 `https://arxiv.org/search/?query={query}&searchtype=all` 경로로 렌더링되며, 개별 초록은 `https://arxiv.org/abs/{arxiv_id}`에서 `blockquote.abstract`를 추출합니다.

## Universal Deterministic Runner
- 파일 경로: [`sites/arxiv/scripts/arxiv_runner.mjs`](sites/arxiv/scripts/arxiv_runner.mjs)

### CLI Usage:
```bash
# 1. 인공지능(cs.AI) 또는 머신러닝(cs.LG) 최신 등재 논문 조회
node sites/arxiv/scripts/arxiv_runner.mjs recent --category cs.AI --limit 15
node sites/arxiv/scripts/arxiv_runner.mjs recent --category cs.LG --limit 15

# 2. 특정 주제(예: Agentic, World Model) 논문 검색
node sites/arxiv/scripts/arxiv_runner.mjs search --query "Agentic Coding" --limit 10

# 3. 특정 논문 상세 초록(Abstract) 전문 조회
node sites/arxiv/scripts/arxiv_runner.mjs abstract --id "2609.12345"
```
