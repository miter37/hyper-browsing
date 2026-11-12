---
name: hyper-browsing-craigslist
description: Site knowledge for craigslist (www.craigslist.org, craigslist.org).
version: 1.0.0
---

# craigslist

## Search

for_sale with {area} and {query}. The site redirects to www.craigslist.org/search/area/<area>; list_items returns up to 200 posts.

## Saved actions

- `for_sale`: For-sale search for {query} in area {area} (for example sfbay, newyork, austin)
- `for_sale_price_low`: For-sale search for {query} in {area}, lowest price first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
