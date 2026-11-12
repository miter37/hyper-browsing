---
name: hyper-browsing-target
description: Site knowledge for Target (www.target.com, target.com).
version: 1.0.0
---

# Target

## Search

search or search_price_low with {query}; list_items returns product cards.

## Saved actions

- `search`: Product search for {query}
- `search_price_low`: Product search for {query}, lowest price first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
