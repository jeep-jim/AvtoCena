# AvtoCena catalog source playbook

Updated: 2026-08-08

This document is the operating contract for the 18 required catalog sources. It records only behavior verified from source adapters, GitHub-hosted runner probes, or readiness artifacts. A green 3-card readiness is a functional gate, not proof of scale. Production must keep source identity and source URLs and must never substitute knowledge-base values for missing source fields.

## Global collection rules

- Backfill and incremental refresh are separate operations. Daily refresh must prefer cursors/IDs/hashes and only detail-fetch new or changed vehicles.
- Markets run independently and in parallel. One blocked source must not erase or corrupt the last verified data from other sources.
- Source `200 OK` is not enough: challenge/interstitial/login HTML must be classified as blocked.
- Photos must belong to the exact vehicle/lot. No stock, model-level, unrelated dealer, or cross-source galleries for used/auction records.
- Missing source fields remain missing. Do not fill engine, power, trim, drivetrain, price or photos from vehicle knowledge.
- Auction history requires an explicit published result/final price when the card is labelled `auction_result`. A start price or statistical average is not a sale result.
- Production readiness is source-specific; a generic parser may be used only when its exact field and gallery binding is demonstrated for that source.
- High-volume certification asks for `up to 30K`. If a live source exposes fewer unique records, verified source exhaustion is valid; repeating/fabricating records to hit 30K is forbidden.
- The source-only collector preserves adapter fields and must not run generic `normalizeVehicleOfferSpecs()` over exact source values.

## Current verified status

| Market | Required source | Source ID | Current runner state | Verified blocker / behavior | Next engineering action |
|---|---|---|---|---|---|
| UAE | Dubizzle | `dubizzle_uae_open` | BLOCKED | GitHub-hosted runner receives Imperva/Incapsula `Pardon Our Interruption` despite HTTP 200; no listing data reaches parser. | Keep explicit anti-bot classification. Use an allowed execution path that can obtain real public listing HTML/API; do not bypass with fake/fallback cards. |
| UAE | DubiCars | `dubicars_uae_exact` | PASS | Dedicated exact source passed strict 1/10/100/1000 testing and current readiness. | Use incremental cursor/ID refresh in production; full backfill only when necessary. |
| Korea | Encar | `encar_direct` | PASS | Current required-source readiness passes. | Preserve dedicated Encar flow; scale with source-safe concurrency and incremental IDs. |
| Korea | K Car | `kcar_korea_open` | PASS | Current required-source readiness passes after dedicated source work. | Preserve dedicated K Car flow; scale incrementally and independently from Encar. |
| Europe | mobile.de | `mobile_de_open` | BLOCKED | GitHub-hosted runner gets HTTP 403 before listing parse. | Determine permitted runner/network/API path; keep source isolated until then. |
| Europe | AutoScout24 | `autoscout_europe_open` | PASS | Dedicated SSR/frontend-data adapter passes current readiness. | Scale with exact listing/detail IDs and delta refresh. |
| Georgia | MyAuto | `myauto_georgia_list` | BLOCKED | GitHub-hosted runner list request returns HTTP 403. | Probe alternate official/public data route or permitted execution network. |
| Georgia | AutoPapa | `autopapa_georgia_open` | BLOCKED | GitHub-hosted runner list request returns HTTP 403. | Probe alternate official/public data route or permitted execution network. |
| China | Che168 Global used | `autohome_used_china_open` | PASS / SOURCE EXHAUSTED | Dedicated API adapter uses `globalapi.che168.com`. Source-exhaustion certification scanned 174 pages, saw 4,150 rows and accepted 4,114 strict unique cards; 31 core rows and 5 gallery rows were rejected. Source finished normally. | Treat 4,114 as the verified strict inventory from that run. Daily refresh should use API pages/IDs incrementally rather than re-detailing the whole source. |
| China | Dongchedi | `dongchedi_china_open` | LOGIN BLOCKED | All tested used-car/library routes return HTTP 200 but redirect to `/login-required?...`; zero inventory reaches runner. | Needs permitted authenticated/alternate data path. Do not treat the login shell as parser drift. |
| China | Guazi | `guazi_china_open` | PASS | Current required-source readiness passes. | Keep exact source identity and scale via incremental IDs. |
| China | Autohome new | `autohome_new_china_open` | PASS 10 AFTER POWER FIX / 100 RUNNING | Exact config parsing is now section-bound. Canary proves H10 spec `77258`: engine max 167 hp / 123 kW, basic overall max 440 kW, motor total 435 hp / 320 kW and system 598 hp / 440 kW. Corrected strict 10 recertification passed with 10 unique cards and no gate problems. The earlier 1000 result is retained only as a pre-fix diagnostic and is not accepted as final certification. | Continue corrected ladder 100 -> 1000 -> up to 30K; each stage must pass the section-bound power canary and source-only gate. |
| Japan | JPAuc completed auctions | `jpauc_japan_past_open` | RESULT PRICE UNSOLVED | Multi-step past search works and real rows with `Status: Sold` are visible. Exact Aleado lot images are available, but tested sold details still show `End Price: N/A`; `/API/auction/history/<model/chassis-code>` returned empty arrays. Start price must not be used as sold price. | Continue only with an exact final-price contract tied to the lot. Until then keep this source out of `auction_result` publication. |
| Japan | CarVector statistics | `carvector_japan_stat_open` | GALLERY BLOCKER | Core rows normalize, but current public path yields insufficient exact images; readiness rejects sampled cards on gallery minimum. | Determine authenticated/official photo route if available; otherwise keep source non-ready without weakening gallery gate. |
| Japan | Prestige Japan auctions | `prestige_japan_auctions_open` | PASS 10 EXACT SOLD / 100 RUNNING | Dedicated adapter uses the verified `Past` + `Non-USS only` search contract, exact `car_id` detail pages and only accepts `Current Status = Sold` with a positive published `Final Price`. Exact AJES lot photos are bound to the detail. Strict 10 passed with 10 unique exact sold results, zero core/image rejects and no gate problems. | Continue strict ladder at 100, then 1000 and up to 30K only after each successful report. |
| Japan | Auction Data Search | `auctiondatasearch_japan_open` | LOGIN / STRUCTURE BLOCKER | Public landing is reachable but actual auction/stat data appears behind login/free registration; no unauthenticated exact result contract verified. | Determine permitted authenticated data path; never infer result records from landing/search snippets. |
| Japan | JP Center | `jpcenter_japan_catalog_open` | STRUCTURE DRIFT | HTTP 200 (~55.5 KB), generic parser finds zero cards. | Inspect current frontend/API/listing link structure and build dedicated adapter only after exact binding is understood. |

## Source-specific notes

### Dubizzle UAE

Observed on GitHub-hosted runners: Chrome-like requests return a 6,183-byte Imperva/Reese interstitial titled `Pardon Our Interruption`; bot-like profiles return Incapsula incident pages. HTTP 200 must therefore be treated as blocked unless actual vehicle markers are present. `dubizzle-exact-source.ts` classifies these challenge pages explicitly.

### DubiCars UAE

Dedicated exact adapter is the reference for source-only behavior: exact detail URL, source fields, exact gallery, source-safe pacing/retry. Its historical 1000-card certification proved the adapter can scale, but the long sequential 30k workflow is not a daily-refresh design.

### Korea: Encar / K Car

Both required sources currently pass the functional readiness gate. They remain separate adapters and update independently; a failure in one cannot prevent the other market feed from persisting verified data.

### Europe: AutoScout24 / mobile.de

AutoScout24 uses a dedicated SSR/frontend-data adapter and passes. mobile.de currently blocks the GitHub runner with 403, so changing selectors will not fix it; network/API access must be solved first.

### Georgia: MyAuto / AutoPapa

Both currently reject GitHub-hosted runner traffic with 403 at listing stage. Keep them classified as access blockers rather than parser-zero failures.

### China: Che168 Global used

Verified live API contract:
- search: `https://globalapi.che168.com/api/v1/search`
- required app id: `_appid=2046`
- paging fields: `pageindex`, `pagesize`
- list identity: `infoid`
- exact detail: `/api/v1/carinfo/<infoid>`
- exact public detail URL: `https://global.che168.com/en/detail/<infoid>`
- exact detail gallery: `catepiclist`, high-resolution URLs under `erscglobal2.autoimg.cn/.../1400x0_c42_autohomecar__...`

The verified source-exhaustion run scanned 174 pages and saw 4,150 listing rows. 4,114 unique cards survived the strict core/gallery contract, with 31 core rejects and 5 image rejects. This is a legitimate `up to 30K` result; never duplicate rows to manufacture 30,000.

### China: Autohome new cars

Dedicated adapter reads the current list under `car.autohome.com.cn/price/...`, binds a numeric `specId`, converts the displayed `万` list price to exact CNY, opens `www.autohome.com.cn/spec/<specId>/` and `car.autohome.com.cn/config/spec/<specId>.html`, and preserves exact config values. Exact product images are restricted to the Autohome product-image CDN path.

A power-field audit found that parameter ID `1185` appears in more than one configuration section. The previous adapter could therefore read basic overall maximum power as engine maximum power. The corrected adapter binds power values by both parameter and exact section: engine maximum power from `发动机`, overall maximum from `基本参数`, and motor/system values from `电动机`. For electrified vehicles motor/system maximum values remain raw source data and are never relabelled as customs 30-minute power.

The exact canary for spec `77258` verifies: engine 167 hp / 123 kW; overall maximum 440 kW; motor total 435 hp / 320 kW; system 598 hp / 440 kW. Corrected target 10 passed with 10 unique cards and no gate problems. The earlier 1000 run happened before this semantic correction, so it does not satisfy the corrected ladder and recertification was restarted from 10.

### China: Dongchedi

On the GitHub runner, current used-car and library URLs resolve to a login-required shell. This is an access-path problem, not a CSS/regex problem; repeated selector rewrites are not useful until an allowed data path exists.

### Japan: JPAuc

The dedicated `JpaucPastAdapter` performs the multi-step past-auction session (date -> makers -> models -> listing) and successfully sees rows. Real rows can be `Status: Sold`, and their lot images are tied to exact date/auction/lot identifiers through Aleado. The current source still lacks a verified final-price field for sampled sold lots; details can show `End Price: N/A`. Therefore `startPrice` must never become `sourcePrice` of an `auction_result`, and the statistical `/API/auction/price/...` route is not an exact sale price.

### Japan: generic past-auction wrappers

Both generic past-auction wrapper layers require an explicit `auctionResultPriceVerified`/`resultPriceVerified` or `auctionPriceKind=published_result` marker before setting `sold` / `auction_result`. A merely positive parsed price is not enough.

### Japan: Prestige Motorsport

The public `/auctions/` page exposes a real search form and AJAX flow. The dedicated adapter resolves maker/model IDs, calls `search_results_car_dev` with `auction-date=Past`, filters `auction_name[]=2` (`Non-USS only`) and paginates by `limit_start`. It then opens exact `auction-vehicle-display/?car_id=...` details.

A result enters the strict catalog only when the exact detail says `Current Status: Sold` and publishes a positive `Final Price`. `Not sold`, `Sold by negotiation` and `Not yet available` do not become sold results. Exact photos are limited to the lot-bound AJES image URLs. The known canary `oWw3Q9WWIb1hfR` verifies 2017 Toyota Alphard S A Package, frame `AGH30W`, ARAI Oyama lot 1726, grade 3.5, final price 1,263,000 JPY and exact AJES gallery. Strict target 10 passed: 10 unique exact sold records, zero core rejects, zero image rejects and no gate problems.

### Japan: CarVector

Current samples have usable core identity but no credible public gallery in the runner path. Do not reduce the five-image production gate simply to make the source green.

## Certification ladder

For an adapter whose source contract is understood and whose structure/readiness probe is clean, certify source-only behavior in stages: `1 -> 10 -> 100 -> 1000 -> up to 30K`. The high-volume stage is a backfill/stress test, not the daily update mechanism. Incremental production refresh should stop once known unchanged IDs/hashes dominate and should detail-fetch only new/changed records.
