---
name: hyper-browsing-walmart
description: Site knowledge for Walmart (www.walmart.com, walmart.com).
version: 1.0.0
---

# Walmart

## Search

search or search_price_low with {query}; list_items returns product cards with price in the text.

## Blocks

Walmart can show a 'press and hold' human check; stop if it appears.

## Saved actions

- `search`: Product search for {query}
- `search_price_low`: Product search for {query}, lowest price first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
