---
name: hyper-browsing-ebay
description: Site knowledge for eBay (www.ebay.com, ebay.com).
version: 1.0.0
---

# eBay

## Search

search or search_price_low (_sop=15) with {query}; list_items returns 60 listings per page.

## Frames

Ad frames are listed under frames; listings are on the page itself.

## Saved actions

- `search`: Listing search for {query}
- `search_price_low`: Listing search for {query}, lowest price plus shipping first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
