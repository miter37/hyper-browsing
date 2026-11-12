---
name: hyper-browsing-wikipedia_en
description: Site knowledge for Wikipedia (English) (en.wikipedia.org).
version: 1.0.0
---

# Wikipedia (English)

## Reading

Infobox: read_text css table.infobox. A section: read_text read=section on its heading. Language versions are links in the 'languages' menu.

## History

The View history tab lists revisions newest first (#pagehistory li).

## Saved actions

- `search`: Full-text search for {query}
- `open_article`: Open the article {title} (spaces as underscores)

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
