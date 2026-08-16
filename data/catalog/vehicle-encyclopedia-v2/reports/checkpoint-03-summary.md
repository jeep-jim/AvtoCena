# Checkpoint 03 — first five source-backed seeds

Date: 2026-08-16. Status: checkpoint in progress; production integration remains disabled.

## Added in this slice

| Brand | Seed model | Generation scope | Seed variant | Status |
|---|---|---|---|---|
| Abarth | 500e | 2022 launch series | 500e Hatchback, Europe | `seed` |
| Acura | ZDX | 2024 launch series | ZDX Type S, United States | `seed` |
| Alfa Romeo | Junior | 2024 launch series | Junior Elettrica, Switzerland | `seed` |
| Aston Martin | DB12 | 2023 launch series | DB12 V8 Coupe, Global | `seed` |
| Bentley | Continental GT | Fourth generation | Continental GT Speed, Global | `seed` |

These five brands start the bounded 15-brand checkpoint-03 queue. Ten checkpoint brands remain queued: AITO, Avatr, BAIC, Baojun, BAW, Belgee, Bestune, Buick, Cadillac and Changan.

The full staging workspace now contains 91 sources and 25 records in each primary brand/model/generation/variant/media collection, plus two facelift records. Five pilot brands remain verified; 20 brands are explicitly in progress and 160 production brand names remain without a V2 seed.

## QA and export gates

- JSON Schema and semantic validation: zero errors and zero warnings.
- Search index: 142 entries and zero safe-alias collisions.
- Source conflicts and duplicate alias clusters: zero.
- All added vehicle facts have field-level evidence from official manufacturer material; all five covers have explicit Commons license and attribution metadata.
- All five new entities remain `seed`. The legacy bridge preview excludes 20 seed models and 20 seed variants from production export.
- Exact 30-minute power remains 0/17 eligible electrified variants. No value is derived from peak, estimated or overboost output.
- Production catalog, collectors, pricing, calculators, workflows and `data/catalog/vehicle-knowledge/` remain unchanged.

## Explicit limitations

This slice is not full brand coverage. Each brand still needs its complete passenger-car model, generation, facelift and market-variant inventory intersecting 2015–2026 before promotion to `verified`.

Acura's official ZDX debut publishes preliminary horsepower, range and charging values; those estimates are retained only in source notes and are not promoted to exact scalar fields. Abarth's 42 kWh and Acura's 102 kWh battery figures are not forced into gross, usable or rated fields because the reviewed releases do not classify them. Alfa Romeo's exact 51 kWh usable figure is stored because the Swiss source labels it explicitly. Bentley's 25.9 kWh figure and 85-percent usable statement are not combined into a derived usable capacity. Aston Martin's 4.0-litre value is not converted to cubic centimetres.

The former Alfa Romeo model name `Milano` is retained as a sourced historical alias after the manufacturer's official renaming notice. It is not treated as a separate model.
