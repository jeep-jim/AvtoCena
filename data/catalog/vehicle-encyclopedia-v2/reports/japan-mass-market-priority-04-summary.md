# Japan mass-market priority 04

Checkpoint date: 2026-08-16

This checkpoint adds the current Honda N-ONE combustion range and the current N-ONE e: battery-electric range inside the approved Japan 2015–2026 priority window. It remains isolated from the production catalog, pricing engine, collectors and site UI.

## Added in this checkpoint

| Canonical model | Generation/update represented | Grade/drivetrain variants |
| --- | --- | ---: |
| Honda N-ONE | 2020 full model change, November 2025 update | 9 |
| Honda N-ONE e: | September 2025 launch series | 2 |
| **Total** | **2 model identities** | **11** |

Eight reviewed sources were added: six official Honda launch/update/specification resources and two Wikimedia Commons media pages. The N-ONE cover is CC BY-SA 4.0; the N-ONE e: cover is CC0 1.0. Both are attributed to Tokumeigakarinoaoshima.

## Identity and calculation behavior

- `N ONE`, `N-ONE` and `エヌワン` resolve to the canonical English identity `Honda / N-ONE`.
- `ホンダ エヌワン Premium Tourer 4WD` resolves to `Honda / N-ONE / Premium Tourer CVT 4WD`, S07B, 658 cm³ and 64 PS.
- `Honda N ONE Original Craft Style FF` resolves to `Honda / N-ONE / Original Craft Style CVT FF`, S07B, 658 cm³ and 58 PS.
- `ホンダ N-ONE e：G FF` resolves separately to `Honda / N-ONE e: / e:G FF`, with 47 kW peak motor output and 295 km WLTC range.
- N-ONE e: does not receive a `power30MinKw` value: Honda's cited type comparison publishes peak motor output but does not label an exact 30-minute value.
- No power, chassis or range value is calculated from an adjacent grade.

## Current canonical totals

- sources: 230
- brands: 40
- models: 58
- generations: 60
- facelifts/updates: 11
- variants: 288
- approved media: 58

Japan now contains 250 source-backed variants across 20 canonical models and eight brands. No stored Japan variant lies wholly before the approved 2015 boundary.

## QA state

- schema/semantic validator: zero errors and zero warnings;
- safe alias collisions: zero;
- unresolved source conflicts: zero;
- production catalog modified: no;
- exact 30-minute power remains source-only.

Honda remains `in progress`; the earlier N-ONE grade histories overlapping 2015–2024 remain queued.
