# Six-market integrity incident — 2026-09-16

Read-only audit of **50,337 stored records**, pinned generation `gen_1789375018034_2536cdd0`. Manifest remained unchanged; no catalog writes. [Run and per-record artifacts](https://github.com/jeep-jim/AvtoCena/actions/runs/35114382366). Compact evidence: `data/catalog/research/all-market-integrity-20260916.json`.

| Market | Stored rows | Findings |
|---|---:|---|
| Korea | 13,004 | 1,256 KCar rows carry unverified hrspow provenance; 833 retain delivered totals. 1,020 ambiguous displacement records. Encar has 11,738 rows; missing power must remain unknown. |
| China | 17,278 | 572 non-exact power records; 229 ambiguous displacement records; explicit fuel/engine conflicts also exist. Seven records have fewer than two distinct HTTPS image URLs. |
| UAE | 516 | 408 ambiguous displacement records. Six stale legacy rows retain calculated totals and unclassified fuel/engine evidence. |
| Europe | 16,794 | 110 electric records carry engine displacement; 143 records have fewer than two distinct HTTPS image URLs. Other ambiguities listed in evidence. |
| Georgia | 898 | 888 displacement ambiguities, already without delivered totals. Do not promote rounded source litres to exact cc. |
| Japan | 1,847 | All have fewer than two distinct HTTPS image URLs; 830 non-exact power and 1,620 ambiguous displacement records. 65 retain totals despite non-exact power. |

Counts overlap and are not counts of distinct broken cars. A missing/ambiguous field does not prove a physically incorrect vehicle specification. Structural URL counts do not prove image availability or photo identity. The audit did not visually inspect every vehicle or validate every current source price.

## Repairs

- Reject KCar hrspow as exact technical evidence at ingestion, recovery and public reading. Never invent replacement hp.
- Normalize away rejected hp and dependent kW/utilization fields; remove the detail tile's default 100 hp.
- Public read safety converts conflicting/unclassified technical records to seller pricing using only the record's own bound CBR conversion. It removes delivered totals, compact price attestations and customs replay inputs. With no valid bound conversion it cannot invent a RUB quote.
- The 914 rejected priced IDs also carry a dated audit quarantine for old compact projections which omit raw semantic evidence. A newer record refresh supersedes this snapshot; current full-record validation remains active.
- Preserve the historical conversion date for selection, then refresh seller currency in the normal display pricing path; seller quotes never become delivered prices.
- Keep exact independent evidence intact. Suppress rejected power in raw source specification groups as well as primary tiles.
- Preserve immutable records for audit. Existing production-write freeze remains in place.

## Remaining verification and source repairs

The 36 live samples confirm two KCar listings now report sold (`EC61409859`, `EC61402490`); earlier exact-ID checks also found `EC61398692` and `EC61401182` sold. One AutoScout detail returns HTTP 410. Encar returns identical short HTML for three IDs, not verified vehicle detail. Mobile.de, AutoPapa and MyAuto return 403; this is not proof of sale. Do not bypass access restrictions or retire records merely for fetch failure.

The four KCar sold responses were independently rechecked at 15:38 UTC, all HTTP 200 with `이미 판매완료된 차량입니다.`. An exact-ID read-side quarantine now excludes those four records and the AutoScout HTTP 410 record, and serves the existing sold/removed explanation. A later record refresh supersedes the incident quarantine. Immutable history is retained.

The [final all-record safety dry run](https://github.com/jeep-jim/AvtoCena/actions/runs/35116078772) preserved bound seller conversions for all 6,649 affected rows. It removed 914 unsafe stored delivered totals (Korea 843, UAE 6, Japan 65). These counts precede the five availability exclusions and are not counts of independently verified cars.

Missing galleries and unavailable source specifications remain unresolved; no replacement photos or borrowed trim specifications are introduced. Strict KCar readiness correctly fails without independently verified power. CI passing is not proof that the catalog is commercially ready. Deployment and live verification must be recorded separately after completion.
