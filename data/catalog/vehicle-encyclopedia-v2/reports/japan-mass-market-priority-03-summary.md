# Japan mass-market priority 03

Checkpoint date: 2026-08-16

This checkpoint adds the current Honda N-WGN range inside the approved Japan 2015–2026 priority window. It remains isolated from the production catalog, pricing engine, collectors and site UI.

## Added in this checkpoint

| Canonical model | Generation/update represented | Grade/drivetrain variants |
| --- | --- | ---: |
| Honda N-WGN | second generation, September 2025 update | 14 |

The range contains seven Honda-published grade groups in both FF and 4WD form: L, L Fashion Style, L Passenger Swivel Seat, Custom L, Custom L Turbo, Custom L Black Style and Custom L Turbo Black Style.

Six reviewed sources were added: Honda's 2013 model launch, 2019 second-generation launch, 2025 range update, current principal-specification PDF and current performance page, plus one Wikimedia Commons media page. The cover is attributed to Tokumeigakarinoaoshima under CC BY-SA 4.0.

## Identity and calculation behavior

- `N WGN`, `N-WGN`, `エヌワゴン` and `エヌ ワゴン` resolve to the canonical English identity `Honda / N-WGN` when the Honda make is proven.
- `ホンダ エヌワゴン CUSTOM L・ターボ 特別仕様車 BLACK STYLE 4WD` resolves to `Honda / N-WGN / Custom L Turbo Black Style CVT 4WD`, S07B, 658 cm³ and 64 PS.
- `Honda N WGN L Fashion Style FF` resolves to `Honda / N-WGN / L Fashion Style CVT FF`, S07B, 658 cm³ and 58 PS.
- The eight grades with explicit rows in Honda's principal-specification table contain exact published dimensions, weight, clearance and fuel-tank capacity.
- Fashion Style and BLACK STYLE retain their exact grade, engine and drivetrain identity, but grade-specific chassis dimensions are deliberately unset instead of copied from an adjacent base grade.
- No technical value or 30-minute power is calculated from naming, ratios or adjacent models.

The package covers the current 2025 update only. Earlier second-generation and first-generation grade matrices overlapping the 2015–2024 part of the priority window remain queued, so N-WGN is not claimed complete.

## Current canonical totals

- sources: 222
- brands: 40
- models: 56
- generations: 58
- facelifts/updates: 10
- variants: 277
- approved media: 56

Japan now contains 239 source-backed variants across 18 canonical models and eight brands. No stored Japan variant lies wholly before the approved 2015 boundary.

The variant collection remains within the deterministic chunk limit: `variants-0001.json` contains 250 records and `variants-0002.json` contains 27.

## QA state

- schema/semantic validator: zero errors and zero warnings;
- safe alias collisions: zero;
- unresolved source conflicts: zero;
- production catalog modified: no;
- exact 30-minute power remains source-only and is not applicable to these ICE-only N-WGN rows.

Honda remains `in progress`; this checkpoint does not claim the brand or model complete.
