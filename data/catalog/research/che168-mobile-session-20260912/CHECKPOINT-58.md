# Domestic Che168: 58 captured detail records

Captured and preserved on 2026-09-12; checkpoint 16:09 UTC. 58 unique nonempty domestic mobile detail records, +24 versus checkpoint 34. Two empty navigation snapshots are excluded and preserved under incomplete/ and in the raw journal.

| Capture evidence | Count |
|---|---:|
| Unique nonempty detail records | 58 |
| Explicit full-cash-price boxes | 54 |
| Listing-bound gallery URL captures | 57 |
| At least some technical table rows | 47 |
| A captured engine horsepower row | 28 |
| Published from this mobile collection | 0 |
| Verified exact landed calculations | 0 |

These are capture-completeness counts, not successful parser, provenance, age, price or publication acceptance. A horsepower row alone does not certify the exact calculation. Missing data remains needs_data; totalRub is null. Some tables remain partial. No photo binaries are stored. The full 58-record parser audit was not run; old audit.json still applies only to the 29-record snapshot.

`session-full-58.json.gz` is the self-contained UTF-8 JSON file archive (files map), including captures and revisions, technical rows, image URLs, selection observations, incomplete capture evidence and collector helpers. `capture-inventory-58.json` lists each captured ID and its completeness.

Collection used the existing public mobile domestic browser session. This turn repeatedly encountered browser-control Runtime.evaluate timeouts and two execution-context resets, with saved files surviving. A source bot challenge was not observed in this mobile session during this resumed collection. Browser control errors are not evidence of a fresh source access block.

The collector now separates opening a detail page from reading it, checks the actual route before acting on a listing, excludes completely unloaded snapshots, preserves each successful record and skips known IDs. Source-price and gallery completion are still not universal. No unattended crawler or GitHub China run is active from this work. No new publication, production merge, main/market marker change or quality-gate change was made. Thousands of usable published cars have not been achieved.

Resume using the existing browser tab after verifying its live state. Load session-collector.mjs (resume), then fast-session-helper.mjs (attach) with the supported browser handles. Execute one step at a time and inspect navigation/error results; do not blindly loop on a failed transition. Enrichment remains separate from initial detail capture.
