# All-brand model census, pass 01 — 2026-08-17

This checkpoint starts the model pass across every one of the 204 currently staged brands. It does not claim that 204 is the final global brand denominator, that any brand is complete, or that review records are safe for pricing or publication.

## Scope and windows

- Japan: inventory observations from 2015 through 2026.
- Other active markets: model candidates overlapping 2020 through 2026.
- Priority order: active raw listing failures, mass-market identities, other in-window identities, then long-tail traffic candidates.
- Site, production knowledge, parsers and pricing/calculation code remain unchanged.

## Exact census inputs

- V2 before this pass: 204 brands and 59 models.
- Read-only legacy queue: 4,899 model candidates in 21 chunks; 4,053 map to the staged brands and overlap a configured priority window under the legacy metadata.
- Read-only listing diagnostics: 143 raw-model observations, 103 unique raw make/model strings, 20 brands with mapped observations and 17 unresolved raw makes.
- MLIT: 432 official workbooks examined, 243 passenger-car workbooks accepted, 1,167 passenger sheets and 36,535 observation rows.
- Wikidata: 4,027 exact English `Brand + Model` candidates queried against the `car model` and `automobile model series` classes.

## MLIT result

MLIT yielded 1,341 unique brand/common-name source identities across 28 staged brands. This is not a canonical-model count: premium-brand common names frequently contain trim, body or powertrain detail.

A strict normalized intersection with a same-brand VehiclesDB marketed-model candidate yielded 62 identities. Seven already existed in V2 and 55 were added as `review` models across 15 brands. Forty-five cross-brand identities, dominated by MINI names filed under manufacturer-level workbook rows, were explicitly blocked rather than assigned to the wrong marque.

## Wikidata result

Wikidata returned 1,787 exact English identities across 101 brands. Only 83 also had an explicit legacy year range overlapping the configured priority window. Eleven of those already existed after the MLIT pass and 72 were added as `review` models. The remaining 1,704 exact identities stay in the research queue because their priority-window eligibility is not proven.

## V2 after this pass

- sources: 352;
- staged brands: 204;
- models: 186;
  - verified: 25;
  - seed: 34;
  - review: 127;
- generations: 61;
- facelifts: 12;
- variants: 299;
- media: 429.

Every new model is intentionally `review`: it may be displayed in research tooling, but its canonical and source-name entries are unsafe for automatic resolution. Production years, body type, powertrain, cover, generation boundary and variants remain publication blockers.

## Regional adapter status

- MLIT Japan adapter completed this pass with zero workbook download/parse errors.
- Wikidata exact-identity adapter completed 41 bounded queries with a resumable checkpoint.
- The NHTSA vPIC adapter is implemented with resumable per-query checkpoints, but NHTSA returned HTTP 403 after the initial partial run. No partial vPIC result was imported or counted.

## Next queue

1. Resolve the 103 active raw make/model strings first, including wrong-language titles and trim-rich strings.
2. Split MLIT source identities into canonical model, generation and variant layers; obtain official English names for Japanese-only strings.
3. Resume NHTSA and add other official regional passes for Europe, China and remaining active markets.
4. For each accepted model, add official years, body types, powertrain kinds and one rights-cleared canonical cover before promotion from `review`.
5. Continue brand-denominator discovery in parallel; a newly observed official brand must enter the brand/logo gate before its models can publish.
