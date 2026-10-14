# Expedia integrated HWM trial

- Trial: `expedia-1`
- Site: https://www.expedia.com/
- Commands: 8 HWM CLI commands; 0 eval calls; 0 CLI errors. Cleanup completed.
- Trial window: 2026-10-14 12:13:55.142–12:15:25.737 UTC (90.6 seconds). Pure reasoning time is not measured.
- Headed fallback: attempted and switched from headless to headed after the opener reported a CAPTCHA frame on a nearly empty page. A subsequent snapshot showed the Expedia homepage at `ready-state=complete`.
- Observed landing page: `https://www.expedia.com/`, title “Expedia Travel: Vacation Homes, Hotels, Car Rentals, Flights & More”. `Stays` was selected (`aria-selected=true`). The snapshot reported `scan.complete=false`, so it is a partial page observation.

## Requested tasks

| Task | Result | Evidence |
|---|---|---|
| Select Stays | Confirmed | The Stays tab was selected in the observed form. |
| Choose New York | Not completed | The visible “Where to?” button was observed, but no actionRef was issued. Its `n154` canonical node ID is read-only under the run instructions. |
| Set Nov 17–19, 2026; 2 adults; 1 room; run search | Not completed | No search was run. The home form showed “Fri, Oct 16 - Sat, Oct 17” and “2 travelers, 1 room”. |
| Apply Guest rating 9+ | Not completed | No results page was reached. |
| Confirm one result’s name, rating, and displayed price | Not completed | Homepage carousel cards were not treated as results for the requested search. |

`forms` returned a result-only observation with hidden form inputs and `actionRef` marked uncollected. The focused snapshot showed the visible “Where to?” button with an accessible name, but still no actionRef. I did not use the read-only `n154` ID as an action target, and did not retry the search or CAPTCHA.

## Command log and friction

| # | Duration | Command / outcome | Friction |
|---|---:|---|---|
| 1 | 20.50 s | Opened Expedia; session `task_0962dfd80c63` | Initial CAPTCHA heuristic triggered the built-in headed fallback. The opener response itself was blank in the terminal; its recorded JSON supplied the real session ID and fallback details. |
| 2 | 0.55 s | Snapshot | Broad overview included many unrelated homepage nodes; `scan.complete=false`. |
| 3 | 0.46 s | Snapshot query `Stays` | Query still returned a broad page projection; needed a targeted follow-up to identify the form. |
| 4 | 0.54 s | Forms | Fast-path fallback was used. Useful form information was present, but hidden inputs reported `actionRef` uncollected. |
| 5 | 0.10 s | List | Returned homepage carousel cards (16 total), not search results. |
| 6 | 0.42 s | Snapshot query `Stays` | The relevant form control was visible in the larger output, but query filtering did not isolate it. |
| 7 | 0.13 s | Focus on observed form node | Exposed the visible “Where to?” control as `n154`, still without an actionRef. |
| 8 | 0.11 s | Inspect `n154` | Confirmed its canonical node details and lack of an actionRef; no permitted action target remained. |

## Difficulties and improvement candidates

1. Provide an issued actionRef for the visible destination button so the supported CLI can open the destination picker.
2. Make visible-control actionRef availability explicit in `forms`, including a reason when it is unavailable.
3. Include the post-fallback landing state alongside the CAPTCHA-triggered headed fallback event, since the homepage loaded successfully after the automatic switch.

The trial-owned session/backend cleanup completed at 2026-10-14 12:15:25.737 UTC. Detailed command records are in `.runtime/hwm-integrated-20261014/expedia-1/commands.jsonl`.
