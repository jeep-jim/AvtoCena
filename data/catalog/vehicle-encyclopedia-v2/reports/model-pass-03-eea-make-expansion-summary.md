# All-brand model census, pass 03 (EEA missing makes) — 2026-08-17

This checkpoint expands the European 2020-2025 denominator without changing the live site, parsers, pricing engine or production knowledge. Counts below are canonical entities or explicitly labelled source observations; type/variant/version rows are never reported as models.

## Brand expansion

- Added 32 official EEA registered makes that were absent from the 204-brand checkpoint. The second reviewed set adds Brabus, Bugatti, Cirelli, Dallara, Donkervoort, e.GO, Elaris, Exlantix, KTM, Mobilize, Moke, RUF, SECMA, Suda, Togg, Yudo and Zhidou to the first 15-marque expansion.
- The V2 brand denominator is now 236.
- Added 17 reviewed same-marque EEA manufacturer/source spellings across Ford, Great Wall, KGM, Lamborghini, Lucid, Mitsubishi, Nissan and smart.
- Cross-brand source strings such as Opel/Vauxhall, Citroen/DS and MG/Roewe remain unresolved rather than being forced onto one brand.
- Aiways has an exact technical 90 x 60 dark/light pair in staging, but it remains blocked because original source trace and rights review are incomplete.
- 51 of 236 staged brands still lack a source-traced technical logo pair. No logo pair has passed rights approval, so publication-ready brands remain 0.

## Model expansion

- Added 33 conservative EEA/legacy model intersections for the expanded make set.
- Added 81 manually reviewed commercial-model boundaries. The newest demand-led pass adds 33 mass-market models such as Sportage, Qashqai, X-Trail, T-Cross, Caddy, Berlingo, Kangoo, Trafic, A-Class, 1 Series and 3 Series.
- Added 38 exact EEA source-name mappings to 14 existing canonical models without promoting engine, drivetrain, body or trim labels to model level.
- V2 now contains 1,256 canonical models: 25 verified, 34 seed and 1,197 review.
- The official EEA layer now matches 1,211 canonical model identities: 1,209 exact and 2 unique same-brand prefix matches.
- 1,057 models are represented in the regenerated EEA staging snapshot.
- 22,734 exact modification candidates retain source-backed registration year, fuel, displacement and kW observations.
- 81,449,705 matched registration observations pass strict brand and model boundary checks.
- 5,604 commercial-name identities and 1,367 raw make strings remain unresolved. These are source-string queues, not counts of missing marques or models.
- Bugatti Chiron Pur Sport and Chiron Super Sport were explicitly rejected as new canonical models and retained for future variant/grade work.

## Model-boundary decisions

- DR 6.0 T-GDI and DR 6.0 PHEV remain powertrain/variant work under model 6.0; they are not inflated into separate models.
- MAN TGE body and gross-weight derivatives remain under one TGE model boundary.
- EVO and Sportequipe commercial identities registered under a DR manufacturer make are retained under their public marques only when the commercial name is explicit.
- Registration years establish observed European presence and are not copied into production start/end fields.

## Current exact canonical totals

- sources: 361;
- brands: 236;
- models: 1,256;
- generations: 61;
- facelifts: 12;
- canonical variants: 299;
- staged exact EEA modification candidates: 22,734;
- media: 429;
- search entries: 6,220;
- publication-ready brands/models/modifications: 0.

## Next fixed gate

1. Continue resolving genuine missing marques from the remaining EEA make queue and obtain authentic source-traced 90 x 60 light/dark logo pairs.
2. Map the 22,734 EEA modification candidates to explicit generation and body boundaries before canonical variant promotion.
3. Add official generation/type-approval data for high-volume models first, then premium and exotic long-tail coverage.
4. Keep site/design/pricing integration blocked until publication and resolver safety gates pass.
