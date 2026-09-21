---
name: adaptive-web-agent-linkedin
description: Site-specific knowledge and operational quirks for LinkedIn (linkedin.com), maintained by hyper-browsing.
version: 0.3.0
metadata:
  tags: [browser, site-specific, linkedin, career, networking, feeds, virtual-dom]
  category: automation
---

# LinkedIn (`linkedin.com`) Site Skill Knowledge

## Overview
링크드인은 전 세계 비즈니스 네트워킹, 기업 채용, 전문가 프로필 및 업계 피드를 제공하는 글로벌 플랫폼입니다.

## Known Quirks & Proven Solutions

### 1. 난독화된 클래스네임과 가상화 뷰포트 (Virtual DOM Recycling)
- **난제**: 
  - 링크드인 피드는 정적인 태그나 고정된 BEM 클래스 대신 난독화된 해시 클래스(예: `_646798e5 _462ca1db`)를 다수 사용하며, 화면 밖의 게시물은 가상 돔에서 삭제(Unmount)됩니다.
- **돌파 해법 (Leaf Container Isolation)**:
  - 클래스네임에 의존하지 않고, 리액션 키워드(`Like`, `Comment`, `좋아요`)를 포함하며 적정 텍스트 길이를 가진 최하위 리프(Leaf) 컨테이너 엘리먼트를 식별하여 안전하게 추출합니다.

### 2. Search Results URL Architecture
- 검색 경로는 카테고리별로 정형화되어 있어 클릭 없이 다이렉트 진입이 가능합니다:
  - 사람(인물) 검색: `https://www.linkedin.com/search/results/people/?keywords={keywords}`
  - 채용공고 검색: `https://www.linkedin.com/search/results/jobs/?keywords={keywords}`
- 검색 결과 카드의 고유 프로필 링크(`a[href*="/in/"]`) 및 채용 링크(`a[href*="/jobs/view/"]`)를 중복 제거(Set)하여 구조화합니다.

## Universal Deterministic Runner
- 파일 경로: [`sites/linkedin/scripts/linkedin_runner.mjs`](sites/linkedin/scripts/linkedin_runner.mjs)

### CLI Usage:
```bash
# 1. 내 프로필 및 로그인 상태 조회
node sites/linkedin/scripts/linkedin_runner.mjs me

# 2. 피드 최신 글 안전 조회
node sites/linkedin/scripts/linkedin_runner.mjs feed --limit 5

# 3. 특정 키워드로 인물(People) 검색
node sites/linkedin/scripts/linkedin_runner.mjs search --keywords "AI Trader" --type people --limit 10

# 4. 특정 키워드로 채용공고(Jobs) 검색
node sites/linkedin/scripts/linkedin_runner.mjs search --keywords "Frontend Engineer" --type jobs --limit 10
```
