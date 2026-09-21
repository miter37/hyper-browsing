---
name: adaptive-web-agent-new_land_naver_com
description: Site-specific knowledge and operational quirks for new.land.naver.com, maintained by Adaptive Web Agent.
version: 0.3.0
metadata:
  hermes:
    tags: [browser, site-specific, adaptive-web-agent, naver-land]
    category: automation
---

# new.land.naver.com Site Skill Knowledge

## Known Quirks & Proven Solutions

### 1. API-First Complex Search & Area Discovery (MANDATORY RULE)
- **Anti-Pattern**: NEVER rely on external web searches (Google/SERP) or fragile DOM search inputs (`#search_input`) to find complex IDs or area types. External searches frequently hallucinate outdated or split rental complex numbers, and DOM inputs trigger 30s timeouts on SPA rendering.
- **Solution**: Inside the browser session, directly query Naver Land's internal API via in-page CDP fetch:
  ```javascript
  const res = await page.evaluate(async (keyword) => {
    const r = await fetch(`https://new.land.naver.com/api/search?keyword=${encodeURIComponent(keyword)}`);
    return await r.json();
  }, keyword);
  // res.complexes[0].complexNo -> exact target complex ID in < 100ms
  ```

### 2. Complex Detail View Dismissal on Map Click
- **Quirk**: Clicking on the background map canvas (`#region_map`, coordinates `(x, y)`) dismisses the currently open complex detail panel and resets the URL back to generic complexes view.
- **Solution**: To close the trade or area filter popup layers, **never click the map**. Instead, **click the filter button itself again (`re-toggle`)** or the dedicated close button (`.btn_close_panel`).

### 3. Physical Events vs Synthetic Click
- **Quirk**: Synthetic DOM `.click()` on custom checkbox labels (e.g. `label[for="address_group2"]` for `동일매물 묶기`) can timeout or fail to trigger Vue/React state updates.
- **Solution**: Query the element via CDP/in-page evaluation and check `.checked` state, or dispatch physical pointer events.

### 4. List structure, item clicks & deduplication
- **Quirk**: The article list is `.item_list--article > .infinite_scroll > .item` DIVs (~20 rendered, virtualized) — NOT `li`; `li` locators time out and synthetic `.click()` on items does nothing.
- **Solution**: Physical bounding-box mouse click (Playwright `page.mouse.click` at item center) → URL gains `&articleNo=` and the detail panel renders `a.complex_link` tabs (단지정보 / 시세실거래가 / 동호수공시가격). Multiple agents post the same unit; dedupe by `${dong}_${area}_${floor}_${price}`.

### 5. Real Transaction Price (실거래가) extraction — navigation trap
- The 시세 `a.complex_link` exists ONLY inside a selected-complex detail panel. Clicking it without one (generic text search) navigates AWAY to the map list view. Correct chain: physical-click an item → click its panel's 시세 complex_link → in-panel 실거래가 text-click → fires `/api/complexes/{no}/prices`, `prices/real`, `buildings/{pyeongtype|landprice}` (+`dongNo` from `buildings/list`). Then replay `prices/real?tradeType=A1|B1|B2&areaNo=<numeric>&type=table&page=N`: `realPriceOnMonthList[].realPriceList[]` = dealPrice(매매)/leasePrice(전세)/rentPrice(월세; dealPrice=0 on B1/B2), floor, date. Panel area tabs = numeric `areaNo` = the complex's `input[id^=housesize]` values (per-complex; never hardcode).

## Reusable Deterministic Scripts
- **Unified Naver Land Runner (`land.mjs`)**: [`sites/new_land_naver_com/scripts/land.mjs`](sites/new_land_naver_com/scripts/land.mjs)
  ```bash
  # 1. 단지 검색
  node sites/new_land_naver_com/scripts/land.mjs search --keyword "마포래미안푸르지오"

  # 2. 평형/면적 목록 조회
  node sites/new_land_naver_com/scripts/land.mjs areas --complex 104917

  # 3. 매물 통합 조회 (거래방식, 평형, 건수 제한)
  node sites/new_land_naver_com/scripts/land.mjs listings --name "마포래미안푸르지오" --trade "매매" --pyeong 30 --limit 15
  ```
