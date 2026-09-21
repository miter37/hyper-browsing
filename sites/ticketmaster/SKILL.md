---
name: adaptive-web-agent-ticketmaster-sg
description: Site-specific knowledge and operational quirks for ticketmaster.sg, maintained by 37web.
version: 0.3.0
metadata:
  tags: [browser, site-specific, ticketmaster, concerts, ticketing]
  category: automation
---

# ticketmaster.sg Site Skill Knowledge

## Overview
Ticketmaster Singapore (`ticketmaster.sg`) provides event schedules, concert ticketing, and venue seat maps in Singapore.

## Known Quirks & Proven Solutions

### 1. Activity Listing & Direct URL
- **URL Structure**: Main listing is located at `https://ticketmaster.sg/activity`. Detail pages follow `https://ticketmaster.sg/activity/detail/<activity_id>`.
- **Date Format**: Event cards typically render dates in `DD MMM YYYY (Day)` format (e.g. `17 Oct 2026 (Sat.)` or multi-day ranges `17 Oct 2026 (Sat.) ~ 18 Oct 2026 (Sun.)`).

### 2. Event Extraction via Card Links
- Event links use standard anchors matching `a[href*="/activity/detail/"]`.
- Extracting inner text along with the parent card container yields clean date, title, and venue information without triggering bot mitigations.

### 3. Connection & Process Hygiene
- Use Playwright CDP connection (`9223` or `9222`).
- Always run scripts wrapped in `try ... finally { process.exit(0); }` to prevent hanging Node.js child processes.

## Universal Deterministic Runner
- Path: [`sites/ticketmaster/scripts/runner.mjs`](sites/ticketmaster/scripts/runner.mjs)

### CLI Commands:
```bash
# 1. 특정 월별 또는 키워드로 싱가포르 공연 목록 조회
node sites/ticketmaster/scripts/runner.mjs list --month "Oct 2026" --limit 20
node sites/ticketmaster/scripts/runner.mjs list --keyword "PLAVE"

# 2. 특정 공연 상세 페이지 정보 조회
node sites/ticketmaster/scripts/runner.mjs detail --url "https://ticketmaster.sg/activity/detail/26sg_plave"
```
