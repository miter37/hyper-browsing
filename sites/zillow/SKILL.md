---
name: hyper-browsing-zillow
description: Site knowledge for Zillow (www.zillow.com, zillow.com).
version: 1.0.0
---

# Zillow

## Search

homes with {place}; list_items returns listing addresses. Price, beds and baths are in each card's text.

## Blocks

Zillow may answer HTTP 403 or show a 'press and hold' human check, especially after several visits in a row (seen on 2026-11-12); the action then reports blocking. Stop and tell the user; do not retry in a loop.

## Saved actions

- `homes`: Homes for sale in {place} (for example 'Austin, TX')

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
