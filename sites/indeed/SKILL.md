---
name: hyper-browsing-indeed
description: Site knowledge for Indeed (www.indeed.com, indeed.com).
version: 1.0.0
---

# Indeed

## Search

jobs or jobs_newest with {query} and {location}; list_items returns job titles; company, place and pay are in the card text.

## Detail

Clicking a card opens its detail in a side pane (the URL gains vjk=...).

## Saved actions

- `jobs`: Job search for {query} in {location}
- `jobs_newest`: Job search for {query} in {location}, newest first

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
