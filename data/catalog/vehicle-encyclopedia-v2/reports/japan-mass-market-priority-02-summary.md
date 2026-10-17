# Japan mass-market priority 02

Checkpoint date: 2026-08-16

This checkpoint expands the approved Japan 2015–2026 priority window with Honda N-BOX, a mass-market kei passenger model. It remains isolated from the production catalog, pricing engine, collectors and site UI.

## Added in this checkpoint

| Canonical model | Generation/update represented | Grade/drivetrain variants |
| --- | --- | ---: |
| Honda N-BOX | second generation, December 2020 facelift | 38 |
| Honda N-BOX | third generation, July 2026 facelift | 24 |
| **Total** | **2 generations and 2 facelifts** | **62** |

The package adds nine reviewed sources: seven official Honda release/specification resources, one official Honda owner specification and one Wikimedia Commons media page. The current cover is attributed to Tokumeigakarinoaoshima under CC BY-SA 4.0.

## Identity and calculation behavior

- `N BOX`, `N-BOX` and `エヌボックス` resolve to the canonical English identity `Honda / N-BOX` when the Honda make is proven.
- A current title such as `ホンダ エヌボックス CUSTOM ターボ 4WD` resolves to `Honda / N-BOX / Custom Turbo CVT 4WD`, engine `S07B`, 658 cm³ and 64 PS.
- A second-generation title such as `ホンダ N BOX Custom L・ターボ 4WD` resolves to the correct 2020-facelift grade instead of creating a separate model.
- Current 2026 grades contain exact published displacement, power, drivetrain, transmission and chassis dimensions. Fuel and tank capacity are taken from Honda's 2026 owner specification.
- Slope variants keep seats unset because Honda specifies conditional three- or four-person occupancy depending on wheelchair use; this cannot be represented truthfully as one fixed value.
- No technical value or 30-minute power is calculated from naming, ratios or adjacent models.

The 2023–2025 third-generation grade matrix is still queued and is not implied by the 2026 rows. The package therefore improves exact matching without claiming full N-BOX completion.

## Current canonical totals

- sources: 216
- brands: 40
- models: 55
- generations: 57
- facelifts/updates: 9
- variants: 263
- approved media: 55

Japan now contains 225 source-backed variants across 17 canonical models and eight brands. No stored Japan variant lies wholly before the approved 2015 boundary.

The variant collection now spans two deterministic files: `variants-0001.json` contains 250 records and `variants-0002.json` contains 13. Neither exceeds the 250-record hard limit.

## QA state

- schema/semantic validator: zero errors and zero warnings;
- safe alias collisions: zero;
- unresolved source conflicts: zero;
- production catalog modified: no;
- exact 30-minute power remains source-only and is not applicable to these ICE-only N-BOX rows.

Honda remains `in progress`; this checkpoint does not claim the brand or model complete.
