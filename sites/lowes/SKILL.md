---
name: hyper-browsing-lowes
description: Site knowledge for Lowe's (www.lowes.com, lowes.com).
version: 1.0.0
---

# Lowe's

## Search

search with {query}; the page is slow (about 10 s) before list_items finds the cards.

## Saved actions

- `search`: Product search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
