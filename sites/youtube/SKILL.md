---
name: hyper-browsing-youtube
description: Site knowledge for YouTube (www.youtube.com, youtube.com).
version: 1.0.0
---

# YouTube

## Search

search action with {query}; list_items returns video titles. Filters (duration, upload date) are in the Filters dialog; after choosing one the URL carries an sp=... value.

## Reading

Views, age and length are in each card's text; durations appear only after the card scrolls into view. The first card can be an ad.

## Saved actions

- `search`: Video search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
