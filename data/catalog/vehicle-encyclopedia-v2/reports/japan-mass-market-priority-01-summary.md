# Japan mass-market priority 01

Checkpoint date: 2026-08-16

This checkpoint applies the approved Japan window of 2015–2026 and prioritizes ordinary high-volume passenger and kei vehicles. It remains isolated from the production catalog, pricing engine, collectors and site UI.

## Added in this checkpoint

| Brand | Canonical model | Generation/update represented | Source-backed variants |
| --- | --- | --- | ---: |
| Honda | Fit | fourth generation; 2022 facelift; current 2025 grade matrix | 22 |
| Nissan | Note | E13 Japan generation; current standard X/X FOUR grades | 2 |
| Suzuki | Swift | 2023 Japan generation | 7 |
| Mazda | Mazda2 | DJ Japan generation; December 2023 product update | 13 |
| Subaru | Impreza | sixth generation / GU | 6 |
| Mitsubishi | Delica Mini | B30A generation, May 2023–October 2025 | 8 |
| Daihatsu | Tanto | fourth generation / LA650S; October 2022 update | 14 |
| **Total** | **7 models** | **7 generations and 3 updates/facelifts** | **72** |

The package also adds 22 reviewed sources, four previously absent brand records and seven approved open-license generation covers. Honda, Nissan and Mazda already had V2 brand records; their Japanese make aliases were added to support complete localized title matching.

## Identity and calculation behavior

- Localized make/model/variant terms are source-backed aliases; public identity remains canonical English, for example `スズキ スイフト HYBRID MX CVT 4WD` resolves to `Suzuki / Swift / HYBRID MX CVT 4WD`.
- A composed alias index now safely combines a proven localized make, model and grade string. Unknown make prefixes still follow the existing conflict/candidate path and are not silently rebound.
- Trim rows are not promoted to models. Each stored row is a source-backed grade, drivetrain and powertrain combination.
- Exact engine, power, dimensions and weights are stored only where the reviewed manufacturer source publishes them. No system power, displacement or 30-minute power is calculated from marketing labels, motor count or ratios.
- Nissan Note coverage is intentionally partial in this checkpoint: the current standard `X` and `X FOUR` grades are present; AUTECH and other derivatives remain queued.

## Current canonical totals

- sources: 207
- brands: 40
- models: 54
- generations: 55
- facelifts/updates: 7
- variants: 201
- approved media: 54

Japan currently contains 163 source-backed variants across 16 canonical models and eight brands. No stored Japan variant lies wholly before the approved 2015 boundary.

The legacy Japan-window inventory remains only a research proxy: 3,939 dated rows and 3,700 distinct candidate configurations across 33 brands, 139 model labels and 340 generation labels. It is not treated as a completion denominator until official model inventories and normalized live-listing identities are reconciled.

## QA state

- schema/semantic validator: zero errors and zero warnings;
- safe alias collisions: zero;
- unresolved source conflicts: zero;
- production catalog modified: no;
- exact 30-minute power: still absent unless an eligible official technical/regulatory source explicitly publishes it.

Every brand in this package remains `in progress`; none is claimed complete from this checkpoint alone.
