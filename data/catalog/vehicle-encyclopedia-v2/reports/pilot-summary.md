# Pilot checkpoint — 2026-08-15

The approved Audi, BMW, Toyota, BYD and Geely pilot is complete as an isolated, source-backed staging checkpoint. Production integration remains disabled.

## Exact coverage

| Brand | Models | Generations | Facelifts/updates | Variants | Licensed covers |
|---|---:|---:|---:|---:|---:|
| Audi | 1 | 1 | 0 | 1 | 1 |
| BMW | 1 | 1 | 1 | 1 | 1 |
| BYD | 1 | 1 | 0 | 1 | 1 |
| Geely | 1 | 1 | 0 | 1 | 1 |
| Toyota | 1 | 1 | 0 | 1 | 1 |
| **Total** | **5** | **5** | **1** | **5** | **5** |

There are 21 provenance sources: 8 manufacturer pages/releases, 5 manufacturer technical documents, 3 Wikidata identity records and 5 Wikimedia Commons media records. All five entities have an approved, license-attributed canonical cover.

## QA result

- JSON Schema and semantic validation: zero errors.
- Search index: 36 entries and zero safe-alias collisions.
- Duplicate alias clusters: zero.
- Unresolved source conflicts: zero.
- Exact 30-minute power: 0/4 electrified variants. This is an explicit coverage gap, not a calculated substitute.
- Legacy preview: 5 model candidates and 2 variant candidates; 3 variants are excluded because the legacy contract requires exact `powerHp` and V2 has only exact published kW for them.
- Production catalog and production `vehicle-knowledge`: unchanged.

## Remaining scope after approval

The current production brand list contains 185 names, so 180 non-pilot names still need eligibility and 2015+ coverage triage before research. The legacy knowledge layer supplies a candidate queue of 4,899 models and 15,735 variants, but none of those records becomes V2 truth without source review. A practical next phase is checkpointed groups of roughly 15–25 brands, with the same schema, source and ambiguity gates after every group. Globally relevant brands absent from the production list must first be reported, not silently added.
