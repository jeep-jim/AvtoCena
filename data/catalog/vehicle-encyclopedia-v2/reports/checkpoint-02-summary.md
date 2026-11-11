# Checkpoint 02 — fifteen in-progress brands

Date: 2026-08-15. Status: source-backed staging seed; production integration remains disabled.

## Added in this slice

| Brand | Seed model | Generation scope | Seed variant | Status |
|---|---|---|---|---|
| Mercedes-Benz | GLC | 2022 launch series | GLC 300 4MATIC, Germany | `seed` |
| Volkswagen | Golf | Eighth generation + 2024 update | Golf GTI, Germany | `seed` |
| Honda | Civic | 11th generation | Civic Type R, United States | `seed` |
| Nissan | LEAF | Second generation | LEAF e+, Europe | `seed` |
| Hyundai | TUCSON | Fourth generation | 1.6 T-GDI Hybrid 6AT 2WD, Europe | `seed` |
| Kia | EV6 | 2021 launch series | EV6 GT, Europe | `seed` |
| Mazda | CX-60 | 2022 launch series | e-Skyactiv PHEV, United Kingdom | `seed` |
| Lexus | RZ | 2022 launch series | RZ 450e, Europe | `seed` |
| Volvo | EX30 | 2023 launch series | Twin Motor Performance, Global | `seed` |
| Porsche | Taycan | 2019 launch series | 4S with Performance Battery Plus, Europe | `seed` |
| Ford | Mustang Mach-E | 2026 model-year series | GT, United States | `seed` |
| Chevrolet | Blazer EV | 2024 launch series | SS, United States | `seed` |
| Tesla | Model 3 | 2024+ series | Performance, Australia | `seed` |
| Chery | Tiggo 7 Pro Max | Saudi-market 2024 series | 1.6TGDI 4WD, Saudi Arabia | `seed` |
| Haval | H6 | 2021 hybrid launch series | Hybrid SUV 2WD, Thailand | `seed` |

The checkpoint now contains 15 in-progress brands, 15 models, 15 generations, 1 facelift/update, 15 variants and 15 licensed covers beyond the five-brand verified pilot. The full staging workspace contains 74 sources and 20 records in each primary brand/model/generation/variant/media collection.

## QA and export gates

- JSON Schema and semantic validation: zero errors and zero warnings.
- Search index: 118 entries and zero safe-alias collisions.
- Source conflicts and duplicate alias clusters: zero.
- All new entity facts have field-level evidence from official manufacturer material; covers have explicit Commons license and attribution metadata.
- All new entities remain `seed`. They are searchable for research, but the legacy bridge excludes them until the corresponding entities are promoted to `verified` after full brand coverage review.
- Exact 30-minute power remains 0/13 eligible electrified variants. No value is derived from peak or overboost power.
- Production catalog, market collectors, pricing, calculator code and `data/catalog/vehicle-knowledge/` remain unchanged.

## Explicit open work

The fifteen brands are not complete: additional 2015+ models, market aliases, generations, facelifts and variants still require primary-source review. Platform codes visible only in media filenames are intentionally not promoted into canonical facts. Generic, total or otherwise unclassified battery-capacity wording for the Nissan LEAF e+, Kia EV6 GT, Mazda CX-60 PHEV, Lexus RZ 450e, Porsche Taycan 4S and Ford Mustang Mach-E GT is retained in source notes but is not forced into gross, usable or rated capacity fields. Version-dependent Chevrolet range and charging ceilings are likewise not assigned to the SS specimen.

All fifteen checkpoint-02 brands now have a bounded source-backed seed. They remain `in-progress`, not complete. The global production queue still contains 165 brands with no V2 seed; those brands and the full 2015+ expansion of every seeded brand remain open work.
