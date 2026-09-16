# Sferacar and parallel ProAuctions — 2026-09-16
User prioritized Sferacar and ProAuctions, requested faster maximal public collection.

Sferacar /auktsiony/ HTTP200, 12 auction cards per page, displayed total80697; paginator links through400. Current/future auctions are present: total is NOT verified completed sales or accessible unique count.
Public listing has separate initial/final JPY prices, source URL, source auction ID, make/model/year/chassis/mileage/engine/grade/venue/date/lot and three images in tested Honda Fit1881217155.
Fixture verified: final581000JPY, initial20000JPY,1300cc,2017,3imageURLs.
Run https://github.com/jeep-jim/AvtoCena/actions/runs/35107193462 reads lists using2workers,1second delay per request, no per-lot requests; dedup sourceID; chunks about250, checkpoints,3hourbudget. All publicationReady=false. finalPriceCandidate uses date<=today,92day window,year2010+,positive finalJPY,2images; does not prove sold status.
Potential pagination cap: need examine result and actual filter partitions before claiming access to80697. /statistika/ page uses different .card markup and RUB catalogue entries; this parser intentionally only extracts .auction-card, no made-up JPY.
ProAuctions additional run https://github.com/jeep-jim/AvtoCena/actions/runs/35107336571 starts page201 with2workers; original35105995247 continues frompage1. Dedupe overlapping sourceIDs when merging. Both stop and checkpoint on errors including429; no proxy or access-control bypass.
scripts/japan-proauctions-sweep.py now supports START_PAGE and2worker batches. Original run uses its original commit (single-worker).
No production changes.

## Verified follow-up
Initial fast ProAuctions run35107336571 had an overescaped detail-link regex and collected0. Fixed using BeautifulSoup DOM links. Corrected run35107480445 stopped on first listing with HTTP403 and saved checkpoint; do not call it active or successful collection. Public probe page201 separately had64 link occurrences, showing pagination content exists but access differs between requests. No evasion/retry escalation performed. Original ProAuctions run and Sferacar collection remain separate.
