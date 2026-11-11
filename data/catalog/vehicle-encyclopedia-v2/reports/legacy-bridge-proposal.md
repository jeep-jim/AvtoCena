# Legacy `vehicle-knowledge` bridge proposal

Status: review-only. The bridge preview must never write to `data/catalog/vehicle-knowledge/`, and this staging workspace remains disconnected from production.

## Safe mapping

| V2 source | Legacy target | Rule |
|---|---|---|
| brand + model IDs | `VehicleKnowledgeModel.id`, `make`, `model` | Preserve deterministic V2 IDs; an existing ID requires a reviewed merge. |
| safe brand/model aliases | `makeAliases`, `aliases` | Export only explicit, source-backed aliases marked `safe`; legal company spellings are not make aliases. |
| model body types and dates | `bodyTypes`, `yearFrom`, `yearTo` | Lower-case body labels; copy year components without inference. |
| generation/platform codes | `generation`, `generationAliases` | Keep generation identity separate from trim tokens. |
| variant facts | matching legacy fields | Copy exact stored values only. Never calculate absent specifications. |
| `BEV`/`FCEV` | `electric` | Direct powertrain mapping. |
| `ICE`/`MHEV` | `combustion` | MHEV remains combustion-led under the current legacy enum. |
| `HEV`/`PHEV` | `other_hybrid` | Do not call a PHEV a series hybrid without architecture evidence. |
| `EREV` | `series_hybrid` | Direct architecture mapping. |
| evidence source IDs/URL | `sourceIds`, `sourceUrl`, `sourceType`, `verifiedAt` | Keep provenance; official registry and manufacturer types map without losing the source IDs. |

## Publication blockers

The current legacy variant contract requires exact `powerHp`. A V2 variant with only `powerKw` is excluded from the preview; the bridge does not convert units. Likewise, `power30MinKw` is copied only when it already passed V2 exact-source validation and is never derived from peak power.

Before a separate production publication PR, every existing-ID merge needs human review, real catalog spelling regressions must stay unambiguous, and the legacy collections must be rebuilt in deterministic chunks capped at 250 records. No production writer is part of this branch.
