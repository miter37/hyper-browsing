---
name: hyper-browsing-amazon
description: Site knowledge for Amazon (www.amazon.com, amazon.com).
version: 1.0.0
---

# Amazon

## Search

search or search_price_low with {query}; list_items returns product cards. 'Sponsored' cards come first.

## Delivery country

Prices and delivery follow the browser's delivery country (a notice offers to change it); do not change the address without the user.

## Blocks

Typing into the home page search box has led to a human-verification checkpoint; opening the search URL directly worked. If a checkpoint appears, stop.

## Saved actions

- `search`: Product search for {query}
- `search_price_low`: Product search for {query}, lowest price first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
