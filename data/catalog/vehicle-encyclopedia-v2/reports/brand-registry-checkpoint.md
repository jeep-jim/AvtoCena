# Complete brand identity registry

Checkpoint date: 2026-08-17

This checkpoint establishes one source-backed identity record for every brand in the current AvtoCena catalog before model-by-model expansion. It remains isolated from the production catalog, pricing engine, collectors and site UI.

## Exact result

- Catalog denominator: **185 brands**.
- V2 brand records before this checkpoint: **40**.
- New identity seeds: **145**.
- V2 brand records after this checkpoint: **185**.
- Queue state: **185 in progress, 0 without a brand record, 0 complete**.
- Brand records with verified status: **9**; seed status: **176**.
- Sources after this checkpoint: **243**.

The Drom catalog index displayed an exact name match for 181 of the 185 catalog brands. Four names required separate identity sources: Eagle, Li Auto, Neta and Proton. Those four use Wikidata, the official Li Auto page, a manufacturer-origin NETA Auto release and the official PROTON page respectively. The Drom index is used only to prove the displayed brand identity; it is not treated as proof of country, model range or specifications.

Country remains deliberately unset for 143 identity-only seeds. Eagle and Proton have source-backed country values in this checkpoint; the existing 40 records already had country evidence. The schema allows an empty country list only for non-verified seed work, the validator reports the gap, and a brand cannot become `verified` while the country list is empty.

## Why 4,899 / 15,735 is not the completion denominator

The old VehiclesDB-backed research base contains 4,899 model rows and 15,735 variant rows. It is retained under its CC BY 4.0 attribution and remains useful for candidate discovery, but:

- 4,754 of the 4,899 model rows have neither `yearFrom` nor `yearTo`; only 145 have any production-year boundary.
- 11,027 of the 15,735 variant rows have neither `yearFrom` nor `yearTo`; 4,708 have at least one production-year boundary.
- names are not yet a deduplicated make → model → generation → facelift → grade/variant hierarchy;
- rows do not prove complete market coverage for Japan 2015–2026 or the other active markets 2020–2026.

Therefore the final canonical model count is not forced to be greater than 4,899: correct alias merging and duplicate removal can reduce model-name rows, while sourced generations, grades and powertrain configurations can expand the lower levels. Completion will be measured against official model inventories plus normalized active-listing identities, not against the legacy row count alone.

## Next collection stage

All brand identities now exist, so subsequent work can be divided deterministically by brand without returning to brand discovery. Each brand remains in progress until its in-window models, generations, facelifts, grades, aliases and calculation fields are source-backed. Mass-market and current listing/calculation failures remain ahead of premium and exotic long-tail work.

## QA state

- schema and semantic validation: zero errors and zero warnings;
- brand chunk: 185 records, below the 250-record limit;
- source chunk: 243 records, below the 250-record limit;
- safe alias collisions: zero;
- production catalog modified: no;
- no technical specifications or 30-minute power values were inferred in this checkpoint.
