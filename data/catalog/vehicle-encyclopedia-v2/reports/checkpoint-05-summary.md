# Checkpoint 05 — Citroën identity and queue normalization

Date: 2026-08-16. Status: first source-backed seed in the active 15-brand checkpoint; production integration remains disabled.

## Queue correction

The production brand list uses `Citroen`, while the legacy knowledge files use `Citroën`. The former queue builder compared lowercased strings without removing diacritics, which incorrectly reported zero legacy candidates for Citroën.

Brand matching now uses the same Unicode-normalized key as encyclopedia search and includes canonical brand aliases. The corrected Citroën row reports 97 legacy model candidates and 219 legacy variant candidates. These counts are calculated from the complete chunk indexes; they remain unverified research inputs and are not promoted into canonical entities.

Checkpoint 05 contains Chrysler, Citroën, Cupra, Dacia, Daihatsu, Datsun, Deepal, Denza, Dodge, Dongfeng, EXEED, FAW, Ferrari, Fiat and Genesis. Citroën is in progress; the remaining fourteen brands stay queued until each has at least one source-backed seed.

## Added canonical records

- Brand: `Citroën`, with `Citroen` retained as a safe official source spelling and production-catalog alias.
- Model: `C3`; official ë-C3/e-C3 spellings resolve to the C3 model family rather than creating a duplicate model.
- Generation: `Fourth generation (Europe)`, production from 2024 on the officially named Smart Car platform. Asia and South America C3 identities remain outside this generation until separately researched.
- Variant: `ë-C3 320 km WLTP`, Europe, from 2024. Exact stored facts are BEV, automatic transmission, 83 kW motor output, 320 km WLTP range, 100 kW DC charging, 163 mm ground clearance and 135 km/h top speed.
- Media: one exact-generation Citroën ë-C3 cover under CC BY-SA 4.0 with attribution to Calreyn88.

The official reveal states a 44 kWh LFP battery but does not classify the figure as gross, usable or rated capacity. No battery-capacity field is populated. The approximately 11-second acceleration figure is also omitted from the exact numeric field. `power30MinKw` remains absent because no exact 30-minute value is present in the reviewed official source.

## QA and boundaries

- Workspace totals: 149 sources, 36 brands, 39 models, 40 generations, 4 facelifts, 43 variants and 39 media records.
- JSON Schema and semantic validation: zero errors and zero warnings.
- Search index: 445 entries; the same two intentional Mercedes-Benz W447/update collisions remain documented.
- Brand queue: zero complete brands, five verified pilot records, 36 brands in progress and 149 queued.
- Legacy bridge preview remains review-only: five models and two variants are eligible; 34 seed models and 38 seed variants are excluded by status, with three additional variants excluded because the legacy contract requires exact horsepower.
- Production catalog, website pages, SEO output, market collectors, pricing engine, calculator, workflows, Yandex services and `data/catalog/vehicle-knowledge/` remain unchanged.
