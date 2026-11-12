---
name: hyper-browsing-imdb
description: Site knowledge for IMDb (www.imdb.com, imdb.com).
version: 1.0.0
---

# IMDb

## Search

find_title with {query}; list_items returns titles (localized to the browser language).

## Detail

A title page is /title/tt.../; rating and year are near the top (read_text on the hero section).

## Saved actions

- `find_title`: Title search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
