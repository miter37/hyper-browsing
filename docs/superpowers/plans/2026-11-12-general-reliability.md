# General browser reliability audit

## Goal and design

Run sequential, fresh Luna (xhigh) testers against at most 30 distinct public sites. Each round uses the current core tools without site notes, saved actions, or site-specific hints. The controller diagnoses observed failures, adds a reproducible regression, implements the smallest general correction, then starts a fresh tester on different sites. Prefer the local MCP protocol; report transport limitations explicitly.

No domain-specific branches, selectors, URL recipes, or site instructions are acceptable fixes. Persist public test evidence only. Do not submit external writes, bypass login/CAPTCHA, or expose browser credentials. A blocked site is not a passing site. Navigation alone is not task completion.

## Execution

- [x] Inspect working tree, skill, MCP server and test commands; initial working tree is clean.
- [x] Run baseline test suite and record failures. Baseline transport test used an unreliable 30 ms arrival assumption; replace the timeout race with response loss after server receipt.
- [x] Round 1: one Luna tester. A fresh explicit profile failed before the first page loaded; stop on this general defect rather than fill the site quota.
- [x] For each confirmed core defect: reproduce; document general cause; write and run failing test; fix; run focused tests and applicable full checks. Unexplained task failures remain explicit limitations.
- [x] Start a fresh Luna tester after the preceding round and fix cycle. Give tool instructions and task goals, without previous site workarounds. Preserve completed results when a tester stops for a fix.
- [x] Continue across varied site types until representative tasks pass or 30 distinct sites have been tried.
- [x] Review final diff for domain-specific behavior, run full suite and report actual coverage, unresolved failures and evidence.

## Verified corrections so far

1. Prepare the explicit Chrome user-data directory before using it as the subprocess working directory. Await spawn/error events so startup failures reject normally instead of crashing and leaving the startup lock. Both regressions failed before the correction and passed afterward with a real Chrome launch.
2. Return `not_started` for MCP launcher or credential failures before daemon dispatch. A real stdio test with a failing launcher reproduced `outcome_unknown` before the correction; MCP/distribution checks then passed.
3. Initial diagnostics isolated the intermittent headed integration setup failure to `Chrome exited during startup with code 0`. A successful launcher may hand off to a browser process; keep waiting for CDP under the existing deadline instead of switching display modes. A delayed-CDP launcher regression failed before the correction and passed afterward. The scenario runner also contains existing POSIX-only cases that return early on Windows; its reported total is not a count of Windows execution coverage.
4. Recognize repeated option panels from their controls and inherit that context when reading child choices. Do not infer filtering from query-only URLs or short text alone: ordinary query-ID records and short rows with a Compare checkbox remain content. Independent review caught those false negatives; direct regressions failed before correction, then passed. The retained real page had returned `found:false` rather than its filter sidebar (request `03657d0a-ae86-46f6-a242-23bf3873ba9c`); missing real results remain incomplete, not fabricated success. Recheck that public task in final regressions.
5. A read-only card title may be covered by a same-destination anchor. Resolve the carrier only inside a bounded common non-landmark container, require identical HTTP(S) destination, reject downloads, and inspect its risk independently. Use a normal actionable click, never force or replay. Different destinations, query variants, write controls and unrelated overlays stay refused. Synthetic regression failed before the correction; live MCP verification opened exactly one prepared destination and read its content (`2a244cba-6a10-4d42-aed2-5b84c6a884c7`, `f5f6cec9-11b1-46eb-a287-1e4d06faacff`).
6. Detect visible picture-selection human-verification panels through verification intent, images, selectable controls and prominence, including English/Korean prompts without site markers or ARIA dialog roles. Ordinary polls, inline article examples and hidden widgets remain unblocked. The localized regression failed first; new and existing challenge tests passed afterward. The original live challenge was not revisited or solved.
7. Detect bare denial titles phrased as a sentence on short pages. An explanatory article negative prevents matching a phrase embedded in a normal title. Synthetic denial sentences failed before the change and passed afterward; the blocked live page was not revisited.
8. A complete Submit search/query label on a structurally recognized search submission does not override its read semantics. Arbitrary Submit tokens, longer labels and compact SubmitOrder actions remain protected. Actual Enter/button submissions and negative payment, account deletion, save, unknown POST, Submit order, SubmitApplication and write-path cases passed after failing regressions. Action-ID inference and conservative CamelCase protection remain unchanged; compound product names can still require confirmation.
9. Section text excludes nonrendering script/style/template/noscript siblings and display:none subtrees. Hidden headings do not truncate following prose. Native innerText retains descendants that explicitly override an inherited hidden visibility. An independent reviewer reproduced the latter regression; the expanded fixture and reviewer repro passed after correction.

## Independent review

Fresh Luna review found and reproduced scale-dependent click drift and two content-list false negatives. The controller added RED regressions, corrected page-space click offsets using the same bounding-box/border contract as Playwright, removed URL/text-length-only exclusion, and preserved selectable short rows. All three original repros passed independent final closure; scaled iframe/popup behavior was also checked. Reports: `engine-review.md`, `engine-review-followup.md`, `engine-review-final.md` under the audit evidence directory.

## Trial ledger

- Round 1: Wikipedia attempted; browser startup prevented page access. Common startup defect fixed.
- Round 2: MDN, GitHub, BBC, OpenStreetMap: four useful read-only tasks passed. Evidence IDs independently checked against the actual MCP transcripts.
- Round 3: YouTube and Naver passed. Amazon search/filter UI worked but primary results were unavailable; false-positive filter extraction fixed. Booking was interrupted after destination entry; eBay not started. Nine distinct sites attempted so far.
- Round 4: eBay and IKEA passed including real list extraction; Etsy blocked by CAPTCHA. Airbnb exposed the covered-link issue, then passed controller verification after the general fix. Google Maps not started. Thirteen distinct sites attempted so far.
- Round 5: Maps, Indeed and Tripadvisor passed (real lists and details); DuckDuckGo and Walmart were blocked. The former exposed localized picture-verification detection; the latter was already identified as CAPTCHA. Eighteen distinct sites attempted.
- Round 6: Reddit, Allrecipes and IMDb passed; NYT required an account for the article; ESPN was opened but interrupted before interaction while the controller tightened click boundaries. Twenty-three distinct sites attempted.
- Round 7: Apple, Microsoft and KREAM passed; Zillow denied access and Britannica required a subscription. Twenty-eight distinct sites attempted. Parent checked evidence IDs and corrected copied limitation text and two transposed UUIDs in the audit records without changing outcomes.
- Round 8: YES24 detail content and Reuters public article excerpts passed. Reuters recovered from an initial challenge through the existing automatic fallback, then showed an account gate after the available excerpts; no gate bypass occurred. Thirty distinct sites reached.
- Round 9: Wikipedia now passed after startup fixes. Booking remained incomplete: selected dates appeared, but Search reset the form in both reference and freshly resolved locator attempts. Actual task conditions were not verified on results; no site-specific fix was inferred.
- Round 10: Amazon, ESPN, Airbnb and Apple passed final live regressions. Booking remained incomplete in an independent date-specific attempt. Final bounded result: 30 services, 23 public read tasks passed, 6 access-gated, 1 incomplete. The final full suite passed; source hashes matched the tested version. All latest cited UUIDs were checked against actual MCP responses, and owned trial processes were cleaned.

## Evidence

Round records: `D:/tmp/hyper-browsing-audit-20261112/`. Public domains and task outcomes belong in audit records, not in runtime heuristics. Regression fixtures use synthetic pages to exercise the failing structure or timing independent of a real site.

## Review focus

Dynamic DOM and stale references; repeated or ambiguous controls; false success after navigation; browser/MCP lifecycle recovery; output truncation and unavailable frame content. Preserve unknown-action outcomes and never repeat uncertain mutations automatically.
