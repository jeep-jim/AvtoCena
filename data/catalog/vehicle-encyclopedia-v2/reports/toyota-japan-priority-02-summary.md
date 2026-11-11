# Toyota Japan priority batch 02 — Corolla family and Prius

Date: 2026-08-16. Status: verified current-model expansion for the approved Japan 2015–2026 coverage window; production integration remains disabled.

## Added coverage

- Four canonical models: Toyota Corolla, Corolla Touring, Corolla Sport and Prius.
- Four Japan-market generations: 2019 Corolla sedan, 2019 Corolla Touring, 2018 Corolla Sport and 2023 Prius.
- Twenty-eight current 2026 configurations: 8 Corolla sedan, 8 Corolla Touring, 4 Corolla Sport and 8 Prius variants.
- Sixteen sources: official Toyota launch/current catalog/grade specification pages plus four licensed Wikimedia Commons image pages.
- Four approved exact-generation covers with explicit attribution and CC BY-SA 4.0 licensing.
- Japanese aliases for all four models and every stored configuration; canonical output remains English.

The Corolla records separate sedan, station wagon and hatchback identities so a repeated trim such as `HYBRID W×B` cannot silently change body type. Current Corolla and Corolla Touring rows cover W×B, G, X and Active Sport with FWD and E-Four. Corolla Sport covers G Z, G, G X and G Z Active Elegance with FWD.

The Prius rows separate PHEV G/Z 2.0 FWD, HEV G/Z 2.0 FWD/E-Four and HEV U 1.8 FWD/E-Four. The current Toyota catalog is explicitly marked on sale from May or July 2026, depending on model.

## Technical-field policy

- Corolla-family hybrids use the official 2ZR-FXE identity, 1797 cc displacement and 72 kW combustion-engine output.
- Current Prius PHEV uses M20A-FXS, 1986 cc and 113 kW combustion-engine output.
- Current Prius 2.0 HEV uses M20A-FXS, 1986 cc and 114 kW combustion-engine output.
- Current Prius U 1.8 HEV uses 2ZR-FXE, 1797 cc and 72 kW combustion-engine output.

These values are stored as `icePowerKw`, not total `powerKw`. The current grade pages reviewed for this batch do not state an exact total system output or 30-minute power, so those fields remain unset rather than being inferred from older releases or component ratings.

## QA and boundaries

- Workspace totals: 185 sources, 36 brands, 47 models, 48 generations, 4 facelifts, 129 variants and 47 media records.
- JSON Schema and semantic validation: zero errors and zero warnings.
- Search index: 846 entries and 26 contextual collisions. Repeated Corolla grades remain model-scoped; no unsafe automatic merge is performed.
- Resolver regression coverage distinguishes Corolla sedan, Touring and Sport; it also verifies Prius PHEV identity and keeps its 113 kW value engine-specific.
- Legacy bridge preview remains review-only: 13 models and 28 variants are eligible; production files are unchanged.
- Website pages, SEO output, collectors, pricing engine, calculator, workflows, Yandex services and `data/catalog/vehicle-knowledge/` remain unchanged.

Next Toyota Japan priority work should cover Roomy and the Noah/Voxy minivan family, then return to historical 2015–2025 Corolla/Prius configurations and missing in-window Aqua/Sienta generations.
