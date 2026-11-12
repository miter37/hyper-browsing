---
name: hyper-browsing-espn
description: Site knowledge for ESPN (www.espn.com, espn.com).
version: 1.0.0
---

# ESPN

## Search

search groups results by kind (teams, articles); list_items returns the group headings, so read the cards with read_text.

## Scores

scoreboard with {league}; each game card holds teams and scores; list_items picks 'TOP PERFORMERS' blocks, read the game cards instead.

## Saved actions

- `search`: Search ESPN for {query}
- `scoreboard`: Scoreboard of {league} (nba, nfl, mlb, nhl, college-football)

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
