# Codex scope: Vehicle Encyclopedia V2

This directory is an ISOLATED staging workspace for automotive knowledge collection.

## Hard write boundary

For encyclopedia research tasks, write ONLY inside:

- `data/catalog/vehicle-encyclopedia-v2/**`

You MAY add or edit validation/import tooling only inside:

- `scripts/vehicle-encyclopedia/**`
- `tests/vehicle-encyclopedia/**`

Do NOT edit, delete, regenerate, reformat, move, or publish any of these without an explicit separate task and review:

- `data/catalog/vehicle-knowledge/**` (current production knowledge)
- `data/catalog/current/**`, `data/catalog/generations/**`, live/read-model catalog data
- `apps/web/**`
- `packages/**`
- `.github/workflows/**`
- market collectors/importers/publishers/pricing/calculation code

Do NOT trigger catalog writers, market imports, deployments, or production publication.

## Goal

Build a source-backed global automotive encyclopedia that can later be compiled, after review, into the existing AvtoCena vehicle-knowledge runtime.

Target coverage for the priority pass:

- Japan: passenger/light-passenger models and variants overlapping model years 2015–2026.
- All other active AvtoCena markets: passenger/light-passenger models and variants overlapping model years 2020–2026.
- Within those windows, work in this order: current calculation/name-resolution failures and identities observed in active listings; mass-market passenger vehicles; premium/exotic long-tail coverage.

Build the denominator from official model inventories plus normalized active-listing identities; never claim completion from a legacy row count alone. Preserve older generations only when needed to identify an in-window vehicle or alias correctly. Broader historic coverage remains a later SEO/long-tail phase and is not deleted from the queue.

## Brand identity and logo publication gate

Brand coverage is a prerequisite, not a by-product of model research.

- Build the brand denominator from all normalized make strings observed by every market parser plus current official manufacturer/group portfolios. The production static brand list is only the starting baseline.
- Unknown observed makes must enter the staging review queue. Never silently drop them and never force them onto a similarly named canonical brand.
- Every publishable brand requires a stable public English/Latin canonical name, all proven localized/source aliases, source-backed identity, and a reviewed country/market identity.
- Every publishable brand requires authentic, source-traceable logo assets for both light and dark themes. Generated wordmarks, text fallbacks, guessed emblems and unrelated parent-company logos do not satisfy the gate.
- Canonical staged logo files are transparent PNG images on an exact `90 × 60 px` canvas. Preserve aspect ratio, center the visible mark, and do not stretch it.
- Preserve source URL/archive identity, checksums, attribution/trademark notes and rights-review state for every logo. An asset can be technically ready while still blocked from publication pending rights review.
- No brand, its models, or listings under that brand may be marked publication-ready until the identity and both logo-theme gates pass.
- During this isolated task, stage and audit logos only inside V2. Do not replace the live `apps/web/**` logo library.

## Truth and provenance rules

1. Never invent or infer a factual specification when the source does not establish it.
2. Every model/generation/variant factual record must contain provenance in `sources` with URL, source type, accessed/verified date, and the fields supported by that source.
3. Preferred source order:
   - official manufacturer technical documents / official model pages / press kits;
   - official government homologation, type-approval, registration, fuel-economy or safety databases;
   - authoritative public registries and licensed/open datasets;
   - established automotive reference catalogs only as secondary corroboration.
4. Do not use SEO content farms, anonymous reposts, AI-generated pages, forum guesses, marketplace seller text, or snippets as the sole source for technical facts.
5. Respect licensing/attribution. Do not copy protected prose; store normalized factual data and short source metadata only.
6. Do not bypass authentication, CAPTCHAs, paywalls, robots protections, anti-bot controls, or technical access restrictions.
7. If sources conflict, do not silently choose. Record the conflict in `researchNotes` and leave disputed fields null until resolved.

## Naming and identity rules

- `canonicalMake` and `canonicalModel` are stable public names.
- Preserve ALL useful source spellings in `aliases`, including localized Chinese/Korean/Japanese/Russian names, punctuation variants, historical market names, rebadges only when identity is proven, and common source-specific spellings.
- Never merge two distinct models merely because compacted strings look similar.
- Separate model, generation, trim and powertrain identity. Trim text must not become a new model unless the manufacturer treats it as one.
- Store original source naming in provenance / `sourceNames` so raw matching remains auditable.

## Power rules

- `powerHp` / `powerKw`: record exact published values and the standard if known (PS, hp, kW).
- EV/PHEV `power30MinKw`: ONLY exact documented regulatory/approval/CoC/registration value. NEVER calculate 30-minute power from peak power, motor count, battery size, or a generic ratio.
- If exact 30-minute power is unavailable, keep it null/missing and record that it was searched.
- For multi-motor vehicles, preserve per-motor exact 30-minute values only when the document explicitly provides them.

## Data layout

- Canonical entities live only in `chunks/<entity>-NNNN.json`.
- Every collection is capped at 250 records per chunk. Start the next numbered chunk before crossing that limit.
- Use `schema/entity-chunk.schema.json` as the storage contract.
- Relationships are explicit IDs: brand → model → generation → facelift → variant. Never encode hierarchy by parsing names.
- Sources and media are first-class chunked entities. Every factual entity uses field-level `evidence` references.
- Generated search artifacts live in `generated/`; QA and unresolved conflicts live in `reports/`.
- Keep `manifest.json` as the deterministic collection/checkpoint registry and update it through the validator/compiler.
- Prefer small, reviewable commits by foundation or brand group. Never produce one unreviewable giant commit.

## Completion standard

A brand is not `complete` merely because model names exist. Completion means:

- canonical brand identity and aliases have passed review;
- authentic light/dark logo assets exist as transparent `90 × 60 px` PNGs and have passed source/rights review;
- canonical model list checked for aliases/duplicates;
- production years and body styles covered;
- generations/variants represented where needed for matching;
- engine/fuel/transmission/drive/power data captured where sourced;
- exact 30-minute power captured only when officially documented;
- every factual field is source-backed;
- JSON validates against the schema;
- duplicate/alias/conflict report is clean or explicitly documents unresolved cases.
