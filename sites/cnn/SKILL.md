---
name: hyper-browsing-cnn
description: Site knowledge for CNN (www.cnn.com, edition.cnn.com).
version: 1.0.0
---

# CNN

## Search

search with {query}; outside the US it redirects to edition.cnn.com. list_items returns headlines.

## Saved actions

- `search`: News search for {query}, newest first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
