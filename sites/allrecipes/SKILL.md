---
name: hyper-browsing-allrecipes
description: Site knowledge for Allrecipes (www.allrecipes.com, allrecipes.com).
version: 1.0.0
---

# Allrecipes

## Search

search with {query}; list_items titles can be image alt text: the recipe name is in the item text.

## Recipe

On a recipe page, ingredients and steps are under their headings: read_text read=section on 'Ingredients' or 'Directions'.

## Saved actions

- `search`: Recipe search for {query}

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
