---
name: hyper-browsing-etsy
description: Site knowledge for Etsy (www.etsy.com, etsy.com).
version: 1.0.0
---

# Etsy

## Search

search or search_price_low with {query}. Prices follow the browser's region (the page title names it).

## Blocks

The first response can be HTTP 403 from a bot check that then lets the page through; if a captcha stays, stop.

## Saved actions

- `search`: Item search for {query}
- `search_price_low`: Item search for {query}, lowest price first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
