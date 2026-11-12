---
name: hyper-browsing-apnews
description: Site knowledge for AP News (apnews.com, www.apnews.com).
version: 1.0.0
---

# AP News

## Search

search with {query}; list_items returns headlines with dates in the text.

## Saved actions

- `search`: News search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
