# Catalog quality hardening — 2026-08-21

This checkpoint describes the production invariants implemented after the Japan/gallery/power incident.

## Inventory policy

- Japan: model year 2010+, 30-day normal retention, 30,000 target, four scheduled runs per month.
- Other live markets: model year 2020+, daily refresh, 3-day normal retention.
- A source failure is not evidence that its listings were sold/removed. Rows older than normal retention receive bounded outage grace (default 2x normal retention) unless the source completed an authoritative live cycle with fresh output.
- Volume targets are crawl/publication goals, not fake-success gates and not permission to publish invalid records.

## Business priority

- Build the first 80% of each market from vehicles <= 8,000,000 RUB delivered price and <= 160 hp when those values are known.
- Fill the remaining 20% only after the priority quota is reached.

## Photos

- Up to 30 source-bound photos per offer.
- Two credible photos are enough to keep an otherwise valid offer, but collection continues toward 30.
- High-volume production stores source URLs instead of duplicating image binaries in Object Storage.
- Obvious promo/banner/thumbnail/service assets are rejected by URL evidence.
- JPAuc detail images are restricted to the same lot-image host family as the listing image, preventing page-wide marketing graphics from entering the lot gallery.
- Source-specific exterior metadata remains preferred over generic image guessing. URL rules alone are not claimed to solve semantic exterior/interior classification for every website.

## Power safety

- Documented/source-exact horsepower is never overwritten by model-wide knowledge.
- When an untrusted source horsepower value materially conflicts with one uniquely matched vehicle-knowledge variant, the exact variant wins and the conflict is recorded.
- Model-wide representative power never blindly replaces a conflicting source value. If no unique variant can resolve a large conflict, horsepower fails closed instead of publishing a confidently wrong number.

## Execution safety

- Automatic market crawls use one sequential queue so markets never collect concurrently.
- A failed market does not prevent the next market in the queue from attempting its run.
- Existing cross-market preservation and regression guards remain mandatory.
