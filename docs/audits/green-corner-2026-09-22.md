# Akebono Green Corner — 22 September 2026

Owner requested a separate fixed-stock Japan section from https://akebono.world/green/lots/727977, all current cars, FOB plus RUB 45,000, ten-card home/catalog showcases, and an independent non-auction schedule.

Public anonymous source query: POST https://akebono.world/graphql/catalog/open, operation greenCornerLots, objectPartner objectTypes auto, isSold false, awaiting false. Full read completed with 448 unique listings and 3,584 image URLs. Five listings use the source subgroup oneprice; these are fixed stock too. Eighteen current listings expose a discounted FOB; valid, unexpired discounts are respected. Mileage is supplied in thousands of km. The example lot's actual year is 2015 even though yearForCustom says 2018; yearForCustom is not substituted for vehicle year. Video URLs are excluded from image galleries.

## Price scope

The owner clarified the final pricing requirement in the continuation chat: use FOB as the vehicle price and the ordinary full Japan calculation; replace only logistics with RUB 45,000 indexed to JPY. The initial FOB-plus-fee-only implementation below is superseded.

At the first successful stock publication, capture the official JPY unit rate and date and store an immutable global logistics anchor in the conditional snapshot: amountJpy = 45,000 / initialRateRub. Each offer carries that anchor. Later imports reuse it, including for new listings; it is never rebased on each refresh. Customer calculation uses logisticsRub = round(amountJpy * currentOfficialRateRub), once, as the existing logistics line. FOB remains the seller price without logistics. All other Japan cost rows and the payment plan use the shared engine. Missing anchor or missing vehicle parameters block a full quote rather than inventing inputs. No source fuel type is assumed.

Continuation verification: TypeScript passed; 15 focused tests passed, including full Green versus Japan cost-row parity, a single logistics line, sum-to-total, unchanged input, and yen-rate changes. Earlier fixture RUB 597,000 is obsolete: the same fixture now has FOB RUB 552,000 and logistics is separate. Production deployment is pending at this checkpoint.

## Isolation and automation

Snapshot: catalog/green-corner/current.json, separate from the six-market manifest and Japanese auction checkpoints. Conditional publication uses the pre-collection ETag. Complete, stable pagination, unique IDs, valid stock fields, source photos and fresh official rates are required. Empty or >10% shrink replacements are rejected. Existing RUB 15m cap remains. No auction retention or non-Japan model-year quota is applied to fixed stock.

Workflow: catalog-refresh-green.yml, daily 23:47 UTC wake-up on the same continuous 72-hour calendar as non-auction markets. New stock starts at page one. Bounded source retries and the existing watchdog are enabled. Access refusals and quality guard failures are not bypassed.

## Historical verification before the owner clarification

- All 448 downloaded public listings normalize successfully.
- Six focused pricing, discount, source pagination and retention tests passed.
- Full initial local suite: 1,554 passed, four stale six-card text assertions failed; those assertions were updated for the requested ten-card behavior and all 50 affected tests passed.
- TypeScript passed.
- CI on 64f7c9439340d258c70492a67b921dd90322ce53 passed.
- Local rendered section at 1,440 and 390 px: 24 cards on the first page, no horizontal overflow, no sold-auction text; example detail returned the same fixture-bound RUB 597,000, no JavaScript errors. External originals were separately verified HTTP 200 (2.86 MB and 3.86 MB). The same first image at the source 400x300 rendition is HTTP 200, 400x300 px and 31,418 bytes; covers use it with original-image fallback.
- Production section/import not yet published at this checkpoint; PR #1125 is a draft.

## Concurrent original recovery

China published 25,991 (was 19,368), 80/20 achieved, Autohome 1,277 / 25,991 = 4.913%. Japan published 14,019 and passed current-projection consistency checks; its next continuation was dispatched automatically. Korea 13,598, Europe 21,414 internal, Georgia 7,888. UAE publication still running at the last check.

A fresh Europe collection completed but its publication stopped safely: 42,194,162,968 current bucket bytes + 8,548,385,592 projected bytes + 5 GB reserve exceed the 50 GB budget. Stale maintenance reported only 26.57 GB and skipped cleanup. PR #1126 fixes current-size checking and bounded cleanup/retry without weakening six-hour grace or current/previous generation protection. Original VPN-specific loading and intermittent production 502s remain unconfirmed/unresolved.
