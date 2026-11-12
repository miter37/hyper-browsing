---
name: hyper-browsing-booking
description: Site knowledge for Booking.com (www.booking.com, booking.com).
version: 1.0.0
---

# Booking.com

## Search

hotels with {place}, {checkin}, {checkout}, {adults}; verify checkin/checkout/group_adults in the URL. list_items returns property cards (title and link).

## Prices

Card prices are for the whole stay; some cards say taxes are added. The first cards can be ads ('광고' / 'Ad').

## Popups

A sign-in promotion opens on the first visit; it is closed automatically.

## Saved actions

- `hotels`: Stays in {place} from {checkin} to {checkout} (YYYY-MM-DD) for {adults} adults

Run them with `run_saved_action` (MCP) or `webctl run <id>`; inputs are the names in braces.

## When an action stops working

The engine marks a failing version and says what failed. Finish the task by observing the page, then repair the smallest part with `site_repair` (an element or a URL template). Read actions that find a moved control again repair themselves once they verify.
