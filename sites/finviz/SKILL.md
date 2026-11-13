---
name: adaptive-web-agent-finviz
description: Site-specific knowledge for finviz.com, generated and maintained by Adaptive Web Agent.
version: 0.1.0
metadata:
  hermes:
    tags: [browser, site-specific, adaptive-web-agent, finance]
    category: automation
---

# finviz.com Site Skill

Read this before working on finviz. It covers what's actually needed to succeed quickly - not
every page on the site. `site.yaml`/`actions.ts` cover stock quotes, the screener, market/ticker
news, the three calendar sections (earnings/dividends/economic) and insider trading. Groups,
Futures, Forex, Crypto, and Portfolio are intentionally not encoded - use Discovery Mode if you
need them.

## Start here: actions that always run

`insider_trades` and `stock_fundamentals` are page-script actions: they run in every setup (the
code actions further down need WEBAGENT_ALLOW_CODE_ACTIONS=1 and are refused without it). Both
read finviz's server-rendered pages with same-site GET fetches, so one call covers many pages.

```
run_saved_action insider_trades      {"minValue":700000,"minMarketCap":"10B"}   # large buys, large caps, with market cap
run_saved_action insider_trades      {"ticker":"KMI","type":"all"}              # one company's history (years back)
run_saved_action insider_trades      {"owners":"insiders"}                      # officers/directors only, no 10% owners
run_saved_action stock_fundamentals  {"tickers":"KMI,CVS,ROK","fields":"Market Cap,P/E,Insider Own"}
```

## Insider trading pages

- `insidertrading.ashx` lists the latest ~200 Form 4 rows. URL parameters: `tc=1` buys, `tc=2`
  sales; `o=-transactionValue` largest first; `or=-10` without 10% owners, `or=10` only 10%
  owners; `t=TICKER` one company's full history (the list itself only spans the last 1-2 weeks,
  and an older large buy drops off it as new filings arrive).
- "Repeated buying" needs the ticker history (`ticker` input or `t=`): the latest list alone shows
  one week. A 10% owner (a fund, a parent company) is not an officer: say which one it is.
- Values are per filing row; one person's several rows on one day are separate purchases.

## Reading tables by hand

- `read_table` reads the insider list (an HTML table, 200 rows in one call; filter with
  `where`, e.g. Value >= 700000) and the screener results.
- The screener is a grid drawn on a canvas: its cells are in the page as zero-size elements, so
  `read_text`/`list_items` see nothing. `read_table` reads it (columns: Ticker, Company, Market
  Cap, ...). `screener.ashx?v=111&f=cap_largeover&t=A,B,C` screens a ticker list in one load
  (`cap_largeover` = market cap over $10B).

## Code actions (need WEBAGENT_ALLOW_CODE_ACTIONS=1)

```bash
webctl run get_stock_price      --session $S --site finviz --input '{"ticker":"NVDA"}'
webctl run get_stock_snapshot   --session $S --site finviz --input '{"ticker":"NVDA"}'
webctl run get_stock_news       --session $S --site finviz   # needs a quote page already open
webctl run get_analyst_ratings  --session $S --site finviz   # needs a quote page already open
webctl run get_insider_trades   --session $S --site finviz   # needs a quote page already open
webctl run run_screener         --session $S --site finviz --input '{"filters":"cap_large,sec_technology","order":"-change"}'
webctl run get_market_news      --session $S --site finviz
webctl run get_earnings_calendar   --session $S --site finviz --input '{"date":"2026-09-17"}'
webctl run get_dividends_calendar  --session $S --site finviz
webctl run get_economic_calendar   --session $S --site finviz
```

`get_stock_snapshot` is usually the right first call for a ticker: one action gets price,
change, company name, and the full fundamentals grid together. Ratings/insiders/news need a
quote page already open (call `get_stock_price` or `get_stock_snapshot` first).

`run_screener`/calendar actions take optional input; omit it for finviz's own defaults (full
screener, current week).

## Three things that will trip you up

1. **`webctl goto` reports `network: "busy"` on almost every finviz page. That is normal, not a
   failure.** finviz keeps loading ads/trackers indefinitely, so the network never truly goes
   idle. Don't retry or treat it as an error - the page is fully usable.

2. **An empty array from a calendar action is often the correct answer, not a bug.** Many days
   have zero earnings/dividends. Only worry if `get_earnings_calendar` etc. throws or the site
   otherwise looks broken.

3. **The video-ad player's close button does not respond to a mouse click, even `--force`.**
   It's a Connatix custom element whose handler only reacts to a real keyboard Enter after
   focus. If you're doing manual Discovery instead of using the encoded actions (which already
   call `dismiss_ad_overlay` for you):
   ```bash
   webctl press --session $S --css "[part='inner-close-button']" --key Enter
   ```
   A mouse `click`/`click --force` will often report success without actually closing it -
   verify with a screenshot before trusting it.

## If you extend this site's knowledge

- The screener is a canvas-drawn grid (`[role=grid]`, cells `[role=gridcell]` with no size, rows
  `display:contents`); calendar tables may sit in a shadow root. Read either with `read_table`,
  or in code with Playwright locators; a plain `querySelectorAll` cannot see into a shadow root.
- Prefer page-script actions (`op: script` in site.yaml, like `insider_trades`) for new reads:
  they run without the code-action switch. Fetch other finviz pages with `fetch()` and parse them
  with `DOMParser` instead of navigating page by page.
- Ticker news (`#news-table`, on the quote page) and market news (`tr.news_table-row`, on
  `/news.ashx`) look similar but have different cell layouts (2 cells vs. 3, with a leading
  spacer cell). Don't assume one's structure for the other - `parseNewsRows` already handles
  both, parameterized by which page you're on.
- `dismiss_ad_overlay` intentionally never promotes past `encoded`: "no player was open" is a
  correct, common outcome, not a verifiable postcondition. Don't force a `verify:` onto it.
