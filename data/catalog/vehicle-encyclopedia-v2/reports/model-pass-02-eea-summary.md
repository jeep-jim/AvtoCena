# All-brand model census, pass 02 (EEA Europe) — 2026-08-17

This checkpoint adds an official European registration layer for passenger cars in the non-Japan priority window. It does not connect V2 to production and does not treat a trim, type code or registration row as a new canonical model.

## Official source denominator

- European Environment Agency passenger-car CO2 registry, Regulation (EU) 2019/631.
- Final consolidated data for 2020-2022 and final 2023 data.
- Provisional 2024 and 2025 data, explicitly labelled as provisional.
- 543,536 unique official year/make/commercial-name/type/variant/version/fuel/engine/power groups.
- 109,508 unique year/make/commercial-name/fuel/engine/power groups after retaining the technical values needed for modification matching.

## Canonical separation

- Same-brand exact marketed-model intersections are accepted.
- Trim-rich commercial names are assigned only when one unique longest known same-brand model boundary exists.
- A trim-rich name is never promoted to a separate model.
- Raw EEA make spellings are resolved only through safe brand aliases; unresolved strings remain in the brand review queue.
- Registration years prove observed European presence, not a production start/end boundary.

## Result

- 1,091 EEA model identities match a canonical V2/legacy marketed-model boundary.
- 949 model records were added to V2 with EEA evidence and `review` status.
- V2 now contains 204 staged brands and 1,135 canonical models.
- 20,181 source-backed modification candidates retain fuel, engine displacement and exact kW values.
- The EEA layer covers 72,272,274 matched registration observations after strict model-boundary matching.
- 7,178 commercial-name identities remain unresolved instead of being converted into fake models.
- 1,424 raw EEA make spellings remain in review; this is a source-string queue, not a count of 1,424 missing marques.

## Why the 20,181 modification candidates are not yet canonical variants

The V2 variant contract requires an explicit model, generation and body type. EEA proves commercial name, fuel, displacement and kW, but does not by itself prove the generation/body boundary for every record. The candidates therefore remain chunked staging evidence until a generation adapter supplies that missing identity. The existing 299 canonical variants remain unchanged in this pass.

## Safe alias result

EEA source spellings for repeated Volkswagen/VW composites, `MERCEDES`, `MERCEDES-AMG`, `BMW I` and `MITSUBISHI MOTORS THAILAND` were added as reviewed same-marque aliases. Cross-brand composites such as Opel/Vauxhall and MG/Roewe remain unresolved.

## Next gate

1. Resolve real missing marques in the EEA make queue and pass each through the identity plus 90 × 60 light/dark logo gate.
2. Map the 20,181 EEA modification candidates to explicit generations and body types.
3. Add official generation/type-approval layers for the active mass-market brands before premium and exotic long-tail work.
4. Promote review records only after canonical cover, generation boundary and resolver safety checks pass.

No site, live catalog, parser, pricing engine, deployment or production knowledge file was changed.
