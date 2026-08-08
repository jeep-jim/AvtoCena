# AvtoCena catalog source playbook

Updated: 2026-08-08

This document is the operating contract for the 18 required catalog sources. It records only behavior verified from source adapters, GitHub-hosted runner probes, or readiness artifacts. A green 3-card readiness is a functional gate, not proof of 30k scale. Production must keep source identity and source URLs and must never substitute knowledge-base values for missing source fields.

## Global collection rules

- Backfill and incremental refresh are separate operations. Daily refresh must prefer cursors/IDs/hashes and only detail-fetch new or changed vehicles.
- Markets run independently and in parallel. One blocked source must not erase or corrupt the last verified data from other sources.
- Source `200 OK` is not enough: challenge/interstitial HTML must be classified as blocked.
- Photos must belong to the exact vehicle/lot. No stock, model-level, unrelated dealer, or cross-source galleries.
- Missing source fields remain missing. Do not fill engine, power, trim, drivetrain, price or photos from vehicle knowledge.
- Auction history requires an explicit published result/final price when the card is labelled `auction_result`. A start price is not a sale result.
- Production readiness is source-specific; a generic parser may be used only when its exact field and gallery binding is demonstrated for that source.

## Current verified status

| Market | Required source | Source ID | Current runner state | Verified blocker / behavior | Next engineering action |
|---|---|---|---|---|---|
| UAE | Dubizzle | `dubizzle_uae_open` | BLOCKED | GitHub-hosted runner receives Imperva/Incapsula `Pardon Our Interruption` despite HTTP 200; no listing data reaches parser. | Keep explicit anti-bot classification. Use an allowed execution path that can obtain real public listing HTML/API; do not bypass with fake/fallback cards. |
| UAE | DubiCars | `dubicars_uae_exact` | PASS | Dedicated exact source previously passed strict 1/10/100/1000 testing and current readiness. | Use incremental cursor/ID refresh in production; full backfill only when necessary. |
| Korea | Encar | `encar_direct` | PASS | Current required-source readiness passes. | Preserve dedicated Encar flow; scale with source-safe concurrency and incremental IDs. |
| Korea | K Car | `kcar_korea_open` | PASS | Current required-source readiness passes after dedicated source work. | Preserve dedicated K Car flow; scale incrementally and independently from Encar. |
| Europe | mobile.de | `mobile_de_open` | BLOCKED | GitHub-hosted runner gets HTTP 403 before listing parse. | Determine permitted runner/network/API path; keep source isolated until then. |
| Europe | AutoScout24 | `autoscout_europe_open` | PASS | Dedicated SSR/`__NEXT_DATA__` adapter passes current readiness. | Scale with exact listing/detail IDs and delta refresh. |
| Georgia | MyAuto | `myauto_georgia_list` | BLOCKED | GitHub-hosted runner list request returns HTTP 403. | Probe alternate official/public data route or permitted execution network. |
| Georgia | AutoPapa | `autopapa_georgia_open` | BLOCKED | GitHub-hosted runner list request returns HTTP 403. | Probe alternate official/public data route or permitted execution network. |
| China | Che168 used | `autohome_used_china_open` | STRUCTURE DRIFT | Current adapter completes one page with zero items and no HTTP error. Registered old China list routes no longer yield recognized cards. | Probe current Che168 global/search/dealer routes; only then replace listing adapter. |
| China | Dongchedi | `dongchedi_china_open` | STRUCTURE DRIFT | HTTP 200, ~13 KB, parser finds zero cards. | Inspect current page shell/API/frontend data route and build dedicated adapter. |
| China | Guazi | `guazi_china_open` | PASS | Current required-source readiness passes. | Keep exact source identity and scale via incremental IDs. |
| China | Autohome new | `autohome_new_china_open` | STALE ROUTE | Current configured route reaches 404/zero parse in readiness. | Probe current Autohome new-car inventory/spec data route and replace stale URL. |
| Japan | JPAuc completed auctions | `jpauc_japan_past_open` | SEMANTIC BUG | Listing parser sees 10 rows/page, but normalization saves 0 because it requires `startPrice`. Current adapter labels `catalogKind=auction_result` while assigning `sourcePrice=startPrice`; this is not acceptable as a completed-sale price. | Inspect past-lot detail/result fields and extract an explicit final/published result price. Do not publish start price as sale result. |
| Japan | CarVector statistics | `carvector_japan_stat_open` | GALLERY BLOCKER | Core rows normalize, but current public path yields 0 usable images; readiness rejects every sampled card on gallery minimum. | Determine authenticated/official photo route if available; otherwise keep source non-ready without weakening gallery gate. |
| Japan | Prestige Japan auctions | `prestige_japan_auctions_open` | CORE BINDING BUG | Parser returns rows and normalization runs, but every sample fails core readiness (`rejectedCore`); exact missing field still requires sample probe. | Inspect normalized sample fields and rebuild source-specific result adapter. |
| Japan | Auction Data Search | `auctiondatasearch_japan_open` | STRUCTURE DRIFT | HTTP 200 (~13.7 KB), generic parser finds zero cards. | Inspect current search/login/data structure and only use explicitly accessible result records. |
| Japan | JP Center | `jpcenter_japan_catalog_open` | STRUCTURE DRIFT | HTTP 200 (~55.5 KB), generic parser finds zero cards. | Inspect current frontend/API/listing link structure and build dedicated adapter. |
| Kyrgyzstan | Mashina.kg | `mashina_kyrgyzstan_exact` | PASS | Current required-source readiness passes. | Scale incrementally with exact listing/detail identity. |

## Source-specific notes

### Dubizzle UAE

Observed on GitHub-hosted runners: Chrome-like requests return a 6,183-byte Imperva/Reese interstitial titled `Pardon Our Interruption`; bot-like profiles return Incapsula incident pages. HTTP 200 must therefore be treated as blocked unless actual vehicle markers are present. `dubizzle-exact-source.ts` now classifies these challenge pages explicitly.

### DubiCars UAE

Dedicated exact adapter is the reference for source-only behavior: exact detail URL, source fields, exact gallery, source-safe pacing/retry. Its historical 1000-card certification proved the adapter can scale, but the long sequential 30k workflow is not a daily-refresh design.

### Korea: Encar / K Car

Both required sources currently pass the functional readiness gate. They must remain separate adapters and update independently; a failure in one cannot prevent the other market feed from persisting verified data.

### Europe: AutoScout24 / mobile.de

AutoScout24 uses a dedicated SSR/frontend-data adapter and passes. mobile.de currently blocks the GitHub runner with 403, so changing selectors will not fix it; network/API access must be solved first.

### Georgia: MyAuto / AutoPapa

Both currently reject GitHub-hosted runner traffic with 403 at listing stage. Keep them classified as access blockers rather than parser-zero failures.

### China: Guazi / Che168 / Dongchedi / Autohome new

Guazi is currently functional. Che168, Dongchedi and Autohome new must not remain generic `OpenMarketAdapter` assumptions once their current site structures are identified. The current registrations are useful diagnostics, not trusted production contracts.

### Japan: JPAuc

The dedicated `JpaucPastAdapter` performs the multi-step past-auction session (date -> makers -> models -> listing) and successfully sees rows. The current normalization is wrong for the intended semantics: `startPrice` is being used as `sourcePrice` on an `auction_result`. A completed-auction source may enter the public result catalog only when an explicit result/final price is tied to the exact lot. The current source status/date/lot/model/grade remain useful identifiers for detail probing.

### Japan: generic past-auction wrapper warning

`JapanAuctionFeedAdapter` currently marks every configured `kind: "past"` offer as `auctionResult: sold` and `auctionPriceKind: published_result` if the underlying generic parser merely found a positive price. That is too broad. Before production use, each past-auction source must prove that its parsed price is a final/result price, not start/ask/list price.

### Japan: CarVector

Current samples have usable core identity but no credible public gallery in the runner path. Do not reduce the five-image production gate simply to make the source green.

## Certification ladder

For an adapter whose source contract is understood and whose 3-card structure probe is clean, certify source-only behavior in stages: `1 -> 10 -> 100 -> 1000 -> up to 30K`. The high-volume stage is a backfill/stress test, not the daily update mechanism. Incremental production refresh should stop once known unchanged IDs/hashes dominate and should detail-fetch only new/changed records.
