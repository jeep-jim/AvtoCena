# Japan public collection: verification 2026-09-16

No production publication. User requested exact results and continuation.

## Confirmed saved data
Source-ID deduplication across original and Carvector-all artifacts:
- JPtrade 124, all status продано; 107 meet initial date/year/price/gallery-URL eligibility.
- Tokai 2271; 2126 positive parsed prices; no explicit sold status extracted. Make/model and engine extraction remains incomplete, not evidence that source lacks these fields.
- Carvector 1735 distinct source IDs across two passes, not 1600: original 135 do not overlap by source ID. Samples have empty images and canGetImages=false. No bypass of access controls.
- JPAuc 1640: sold 362, unsold 379, available 883, removed 4, status missing 12. No positive final price parsed. Three saved sold examples explicitly show End Price: N/A. Do not substitute average/start prices.
- Prestige zero, HTTP403.

Data: data/japan-free-discovery/saved-records-audit.json. These counts do not remove cross-source duplicates.

## Implemented
scripts/japan-free-html-sweep.py percent-encodes spaces/non-ASCII preserving existing escapes; restores checkpoint queue, counters, source IDs and part numbering; retries previously malformed URLs; follows data-href links.
Local checks: URL normalization/idempotence; zero-budget checkpoint resume preserves saved part, counters and normalized pending URLs.
Continuation run https://github.com/jeep-jim/AvtoCena/actions/runs/35096465537 restores original JPtrade artifact and allows three additional hours. No production side effects.
Verification run https://github.com/jeep-jim/AvtoCena/actions/runs/35096542264 reads original artifacts and checks candidate image GET responses, MIME, decoding, size and distinct SHA256. Image bytes are kept only in memory, not persisted. Stops requesting a host after access/rate limit responses.
Results stay publicationReady=false; decoding does not prove car/photo roles or integration/calculation readiness.

## Next
Inspect verification artifact and visually distinguish car photos from auction sheets/placeholders. Inspect continuation output. Improve Tokai attributes only from actual page evidence and establish explicit sold-price evidence before promoting. JPAuc requires final-price evidence; repeated collection alone cannot fix missing final prices. Avoid scaling Carvector without gallery availability. Deduplicate qualified records by exact auction identity with collision checks and preserve alternate sources.
