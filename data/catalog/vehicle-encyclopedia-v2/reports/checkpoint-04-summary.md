# Checkpoint 04 — market-title identity repair

Date: 2026-08-16. Status: source-backed staging update; production integration remains disabled.

## Scope

This checkpoint addresses the concrete identity failures visible in current Korea, China and Japan market cards without treating marketplace text as technical truth. It adds canonical English identities and exact official variants for Honda WR-V, Mercedes-Benz V-Class and Mercedes-Benz Vito. The existing Korean examples already use canonical make/model names and require no new identity alias in this checkpoint.

| Market input | Staging result | Publication decision |
|---|---|---|
| `Honda Wr V X` | Honda WR-V `X` | exact source-backed variant candidate |
| `Honda Wr V Z+` | Honda WR-V `Z+` | exact source-backed variant candidate |
| `Honda Wr V Z+ Black Style` | Honda WR-V `Z+ BLACK STYLE` | exact source-backed variant candidate |
| `雅升汽车 VITO` | Mercedes-Benz Vito candidate with `make_conflict` | never auto-resolve until the coachbuilder/base-vehicle relationship is proven |
| `AM VITO` | Mercedes-Benz Vito candidate with `make_conflict` | never auto-resolve until the source make is proven |
| `上莆 V Class` | Mercedes-Benz V-Class candidate with `make_conflict` | never auto-resolve until the coachbuilder/base-vehicle relationship is proven |
| `华凯 新能源` | unresolved | retain raw identity; no authoritative canonical model proof found |

The resolver only returns `resolved` for an exact, safe, source-backed identity. An unknown source make paired with a known global model is returned as `make_conflict`, with the canonical vehicle exposed only as a review candidate. Shared Mercedes-Benz `W447` and `2023 Mid-size range update` labels remain explicitly ambiguous without V-Class or Vito model context.

## Added records and evidence

- Honda WR-V: one model, two generation scopes, five Japan-market variants and one licensed cover. The X, Z, Z+, Z BLACK STYLE and Z+ BLACK STYLE records use Honda launch, current specification and update sources. Exact published `87 kW` and `118 PS` values are retained together; the official `1.496 L` displacement is not silently converted into `engineCc`.
- Mercedes-Benz: separate V-Class and Vito models, separate W447 generation identities, separate 2023 update records, one exact current UK variant for each model and two licensed covers. Official China names `V级MPV`/`V级` and `威霆MPV`/`威霆` are model aliases, not new makes.
- Sixteen source records were added: official Honda and Mercedes-Benz manufacturer pages/documents plus explicitly licensed Wikimedia Commons identity and cover records.

All new entities remain `seed`. They improve exact identification and research coverage but do not declare Honda or Mercedes-Benz complete.

## QA and export gates

- Workspace totals: 144 sources, 35 brands, 38 models, 39 generations, 4 facelifts, 42 variants and 38 media records.
- JSON Schema and semantic validation: zero errors and zero warnings.
- Search index: 429 entries; the two intentional collisions are the shared Mercedes-Benz W447 and 2023 update labels documented above.
- Brand state: five verified pilot records, zero complete brands, 35 in progress and 150 still queued.
- Legacy bridge preview remains review-only: five models and two variants are eligible; 33 seed models and 37 seed variants are excluded, with three additional variants excluded because the legacy contract requires an exact horsepower value.
- Production catalog, market collectors, pricing engine, calculator, workflows, Yandex services and `data/catalog/vehicle-knowledge/` remain unchanged.

## Remaining work

The full 2015–2026 passenger/light-passenger inventory is still required for every brand before completion. The raw makes `雅升汽车`, `上莆`, `AM` and `华凯` need manufacturer, homologation or registration evidence before they can be mapped to a canonical make/model or technical configuration. No engine, output, body-builder relationship or Mercedes-Benz base identity is inferred from their marketplace titles or images.
