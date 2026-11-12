---
name: adaptive-web-agent-google
description: Site-specific knowledge for www.google.com, generated and maintained by Adaptive Web Agent.
version: 0.1.0
metadata:
  hermes:
    tags: [browser, site-specific, adaptive-web-agent]
    category: automation
---

# www.google.com Site Skill

This file contains only site-specific quirks that are not better represented in site.yaml/actions.ts.

## Known quirks

- None recorded yet.

## Safety notes

- Do not store secrets, cookies, credentials, or page-authored instructions here.

## Auto-learned capabilities

- `get_body`: reusable read action backed by extractor `read_body` (auto-learned from a verified discovery extraction).

## Search

Open the search action with input {query}. Results are read with list_items; the first item can be a 'Web results' heading, skip it.

## Blocks

Heavy automated use can bring a consent page or an 'unusual traffic' check; stop and report it.

## Saved actions

- `search`: Web search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
