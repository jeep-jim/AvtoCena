# Free Japan collection — 2026-09-16

User authorized collecting as much as public sources provide, without a 10,000 target and without buying access. This supersedes plans to buy a Japan feed.

Branch: ops/japan-free-sweep-20260916. Production catalog is not modified by these workflows.

## Active runs
- Initial five-source collection: https://github.com/jeep-jim/AvtoCena/actions/runs/35079001913
- Separate full-make Carvector follow-up: workflow japan-free-carvector-all.yml on this branch. The initial legacy adapter defaulted to /stat/toyota/corolla and produced 135 REVIEW records; do not describe this as complete Japan coverage.
- Discovery: https://github.com/jeep-jim/AvtoCena/actions/runs/35078481286

## Verified during implementation
- Direct public HTML discovery returned 200 for JPtrade, Tokai, Prestige, JPAuc, Carvector, JPCarsHub.
- Prestige collection subsequently returned HTTP 403 with a JavaScript/cookie challenge and stopped. Do not switch to the legacy production egress bridge. Crawler explicitly disables it.
- Cyprus discovery returned HTTP 403; no bypass attempted.
- JPCarsHub exact hammer price not established. Public count is not accepted sold evidence.
- JPtrade real fixture /stat/30124028: sold, 2026-09-14, 1,058,000 JPY, Honda N-Box 2021, seven gallery images after excluding the auction sheet.
- Tokai real fixture /toyota/copen/?auc_id=1882655979: 1,667,000 JPY, 2026-09-15, five gallery URLs plus sheet; no explicit sold status parsed, so retained for review.
- Parser checks: sold fixture accepted; unsold, zero-price, stale, future, one-photo variants rejected.

## Collection contract
- Public GET navigation for JPtrade and Tokai; existing public adapters for JPAuc and Prestige.
- Carvector full-make run uses public /stat/ HTML with existing page, sort and year filter parameters.
- Raw records and unsupported/missing data retained for review, never promoted to verified sold or production.
- HTML chunks <=250 records, adapter chunks <=250; summaries/checkpoints retained.
- Workers have a three-hour collection budget and save pending navigation/cursor. No record-count target.
- Initial aggregate deduplicates qualified candidates by full date/venue/lot/make/model/year; fallback identity is source+sourceId. Does not merge mismatching photographs.
- Gallery URLs are not proof of successful image loading on avtocena.com. publicationReady remains false.
- Each workflow uploads source and aggregate artifacts, retention 14 days. Preserve useful data before expiration.
- Initial summary will be committed to data/japan-free-discovery/collection-summary.json on this branch. Full-make Carvector summary: carvector-all-summary.json.
- Separate Carvector follow-up is NOT automatically joined into the initial run aggregate; join its artifacts when reviewing final results.
- No other markets, deployment configuration, secret values, or production storage changed.

## Next verification
Read completed runs and artifacts; report actual counts per source. Verify external gallery loading, auction dates, price semantics and actual sold status before production import. If collected pagination is incomplete, extend only observed public navigation and resume from saved evidence.
