# Toyota Japan priority batch 01 — Yaris, Yaris Cross, Aqua and Sienta

Date: 2026-08-16. Status: verified mass-market expansion for the approved Japan 2015–2026 coverage window; production integration remains disabled.

## Added coverage

- Four canonical models: Toyota Yaris, Yaris Cross, Aqua and Sienta.
- Four current Japan-market generations: the 2020 Yaris and Yaris Cross launch generations, second-generation Aqua and third-generation Sienta. All four use the officially documented GA-B platform.
- Fifty-eight exact initial-catalog configurations: 18 Yaris, 14 Yaris Cross, 8 Aqua and 18 Sienta variants.
- Twenty sources: four official Toyota launch releases, four official Toyota model catalogs, eight official grade-level specification pages and four licensed Wikimedia Commons image pages.
- Four approved exact-generation covers with explicit license and attribution records.
- Japanese aliases for Toyota, all four models and every stored configuration. Canonical output names remain English.

The variants cover the official grade, engine, transmission, drive and seating combinations present in the reviewed catalog periods: Yaris February 2020–May 2021, Yaris Cross August 2020–August 2022, Aqua July 2021–November 2022 and Sienta August 2022–May 2024. These bounded years identify exact catalog snapshots; they do not claim that an unchanged grade disappeared permanently after the snapshot.

## Technical-field policy

The exact Toyota grade pages support 996 cc 1KR-FE, 1490 cc M15A-FKS and 1490 cc M15A-FXE engine identities. The naturally aspirated petrol variants retain Toyota's published 69 PS / 51 kW or 120 PS / 88 kW ratings.

For the hybrid records, Toyota's published 67 kW figure is explicitly the combustion-engine output. It is stored only as `icePowerKw`. It is not copied into total `powerKw`, and no total horsepower or 30-minute power is inferred. This prevents the pricing and display layers from presenting an engine-only rating as hybrid-system output.

## QA and boundaries

- Workspace totals: 169 sources, 36 brands, 43 models, 44 generations, 4 facelifts, 101 variants and 43 media records.
- JSON Schema and semantic validation: zero errors and zero warnings.
- Search index: 706 entries. Sixteen reported keys require model/generation context, including expected repeated Toyota grade and GA-B labels; no unsafe automatic merge is performed.
- Resolver regression coverage confirms English canonical output for Toyota Yaris Hybrid Z E-Four and Toyota Sienta Hybrid Z E-Four 7-seat, exact engine fields, and Japanese Toyota/Aqua/Yaris Cross aliases.
- Legacy bridge preview remains review-only: 9 models and 28 variants are eligible; the production knowledge directory is unchanged.
- Website pages, SEO output, market collectors, pricing engine, calculator, workflows, Yandex services and `data/catalog/vehicle-knowledge/` remain unchanged.

Next Toyota Japan priority work should deepen the highest-demand catalog identities still absent from V2, beginning with Corolla-family, Prius, Roomy and Noah/Voxy configurations before long-tail or exotic nameplates.
