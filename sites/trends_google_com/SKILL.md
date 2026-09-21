---
name: adaptive-web-agent-trends_google_com
description: Site-specific knowledge and operational quirks for trends.google.com, maintained by Adaptive Web Agent.
version: 0.2.0
metadata:
  hermes:
    tags: [browser, site-specific, adaptive-web-agent, google-trends]
    category: automation
---

# trends.google.com Site Skill

## Known Quirks & Proven Solutions

### 1. The `networkidle` Timeout Trap (CRITICAL)
- **Quirk**: Google Trends continuously streams telemetry, analytics (e.g. `play.google.com/log`, `batchexecute`), and ad beacon packets in the background. Because of this, network requests never drop to zero.
- **Problem**: Using `waitUntil: "networkidle"` will ALWAYS hang and trigger Playwright's 30,000ms (30-second) timeout.
- **Solution**: 
  - NEVER use `networkidle` on `trends.google.com`.
  - ALWAYS use `waitUntil: "domcontentloaded"` with an explicit short delay (`await page.waitForTimeout(2000)`).
  - Use fast RSS/API extraction (`https://trends.google.com/trending/rss?geo=US`) evaluated directly in the session context.

### 2. Massive Hidden DOM & Dropdown Layers
- **Quirk**: The Country/Region and Category selector layers render hundreds of hidden list items into the DOM, which can cause token explosions or unconstrained snapshot freeze.
- **Solution**: Query only target table rows (`tr, [role='row']`) and limit results (e.g. `items.slice(0, 20)`).

### 3. TrustedHTML Restriction
- **Quirk**: In-browser `DOMParser().parseFromString()` fails on modern Google properties due to TrustedHTML policy.
- **Solution**: Fetch the raw response text from the browser session, and parse regex or XML in Node.js runtime.

## Reusable Deterministic Scripts
- **Fast US Trending Scraper**: [`sites/trends_google_com/scripts/get-trends-fast.mjs`](sites/trends_google_com/scripts/get-trends-fast.mjs)
- **Trending RSS Feed Parser**: [`sites/trends_google_com/scripts/parse-rss.mjs`](sites/trends_google_com/scripts/parse-rss.mjs)

## Auto-learned capabilities

- `get_tbody`: reusable read action backed by extractor `read_tbody` (auto-learned from a verified discovery extraction).
