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

Target coverage for the first pass: passenger/light passenger vehicle models and variants with production overlapping calendar year 2015 or later, across all brands relevant to AvtoCena and then the broader global passenger-car universe. Preserve older generations only when needed to identify a 2015+ vehicle or alias correctly.

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

- One canonical brand file per brand: `brands/<brand-slug>.json`.
- Use `schema/brand.schema.json` as the contract.
- Keep progress and unresolved conflicts in `reports/`.
- Keep a small `manifest.json` with coverage/checkpoint state; update it incrementally.
- Prefer small, reviewable commits by brand or brand group. Never produce one unreviewable giant commit.

## Completion standard

A brand is not `complete` merely because model names exist. Completion means:

- canonical model list checked for aliases/duplicates;
- production years and body styles covered;
- generations/variants represented where needed for matching;
- engine/fuel/transmission/drive/power data captured where sourced;
- exact 30-minute power captured only when officially documented;
- every factual field is source-backed;
- JSON validates against the schema;
- duplicate/alias/conflict report is clean or explicitly documents unresolved cases.
