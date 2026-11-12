---
name: hyper-browsing-bestbuy
description: Site knowledge for Best Buy (www.bestbuy.com, bestbuy.com).
version: 1.0.0
---

# Best Buy

## Country splash

Outside the US the site first asks to choose a country; intl=nosplash (in the search template) skips that page.

## Search

search with {query}; list_items may return only the first few cards until the page is scrolled (smart_scroll).

## Saved actions

- `search`: Product search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
