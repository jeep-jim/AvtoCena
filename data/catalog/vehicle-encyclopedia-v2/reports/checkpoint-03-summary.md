# Checkpoint 03 — fifteen source-backed seeds

Date: 2026-08-16. Status: all checkpoint-03 brands have a source-backed seed; production integration remains disabled.

## Added in this checkpoint

| Brand | Seed model | Generation scope | Seed variant | Status |
|---|---|---|---|---|
| Abarth | 500e | 2022 launch series | 500e Hatchback, Europe | `seed` |
| Acura | ZDX | 2024 launch series | ZDX Type S, United States | `seed` |
| AITO | M9 | 2023 launch series | 2025 BEV Max six-seat, China | `seed` |
| Alfa Romeo | Junior | 2024 launch series | Junior Elettrica, Switzerland | `seed` |
| Aston Martin | DB12 | 2023 launch series | DB12 V8 Coupe, Global | `seed` |
| Avatr | 12 | 2023 launch series | AVATR 12 BEV, Global | `seed` |
| BAIC | X55 | 2022 global series | X55 Honor, Global | `seed` |
| Baojun | Yep | 2023 launch series | Yep EV RWD, China | `seed` |
| BAW | Ruisheng M8 | 2026 official-site snapshot | BEV 560 Flagship seven-seat, China | `seed` |
| Belgee | X50 | 2023 launch series | 1.5T 7DCT, Russia | `seed` |
| Bentley | Continental GT | Fourth generation | Continental GT Speed, Global | `seed` |
| Bestune | T90 | 2024 Russia launch series | 2.0T Flagship, Russia | `seed` |
| Buick | Envista | 2024 launch series | Avenir, United States | `seed` |
| Cadillac | LYRIQ | 2022 launch series | Standard Range Luxury, China | `seed` |
| Changan | CS75 Plus | 2024 UAE series | Sport, United Arab Emirates | `seed` |

The bounded 15-brand checkpoint-03 queue now has 15 `in-progress` entries and zero queued entries. These remain seeds rather than completed brands: every brand still needs the full 2015+ passenger/light-passenger inventory before promotion.

The staging workspace now contains 128 sources and 35 records in each primary brand/model/generation/variant/media collection, plus two facelift records. Five pilot brands remain verified; 30 brands are explicitly in progress and 150 production brand names remain without a V2 seed.

## QA and export gates

- JSON Schema and semantic validation: zero errors and zero warnings.
- Search index: 200 entries and zero safe-alias collisions.
- Source conflicts and duplicate alias clusters: zero.
- All added vehicle facts have field-level evidence from official manufacturer material; all 15 checkpoint covers have explicit Commons license and attribution metadata.
- All checkpoint-03 entities remain `seed`. The legacy bridge preview contains only the same five verified models and two exact-horsepower variants; it excludes 30 seed models and 30 seed variants, plus three verified kW-only variants that cannot be converted to the legacy horsepower contract.
- Exact 30-minute power remains 0/22 eligible electrified variants. No value is derived from peak power, motor count, battery size or a generic ratio.
- Production catalog, collectors, pricing, calculators, workflows and `data/catalog/vehicle-knowledge/` remain unchanged.

## Explicit limitations

This checkpoint is not full brand coverage. Each brand still needs its complete passenger-car model, generation, facelift and market-variant inventory intersecting 2015–2026 before promotion to `verified`.

Unclear or non-matching values remain deliberately absent. Examples include AITO's unclassified 100 kWh capacity and per-motor values, BAIC's ambiguous `138 (130)` output entry, Buick's expected output, and conflicting official UAE power/torque values for Changan. Litre and millilitre displacement values are not silently relabelled into `engineCc`; Russian `л.с.` values are not assigned an hp standard without an exact source definition or kW pair.

BAW uses the current Ruisheng M8 from BAW's own range and configuration pages rather than assigning the now-independent 212 T01 identity to BAW. The official pages establish a 2026 catalog snapshot but do not establish the Ruisheng M8 launch date, so model and generation `productionFrom` remain null and the variant year is explicitly snapshot-bounded.

The former Alfa Romeo model name `Milano` remains a sourced historical alias after the manufacturer's official renaming notice. It is not treated as a separate model.
