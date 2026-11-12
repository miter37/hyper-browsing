---
name: hyper-browsing-nytimes
description: Site knowledge for The New York Times (www.nytimes.com, nytimes.com).
version: 1.0.0
---

# The New York Times

## Search

search with {query}; list_items returns headlines.

## Paywall

Article bodies can be cut by the subscription wall; report what is visible.

## Saved actions

- `search`: Article search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
