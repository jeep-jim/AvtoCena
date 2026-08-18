# Codex master task — AvtoCena global vehicle encyclopedia V2

Work in repository `jeep-jim/AvtoCena` on branch `feat/encyclopedia-knowledge-base`, created from the latest `origin/main`.

Read `data/catalog/vehicle-encyclopedia-v2/AGENTS.md` first and obey it as a hard boundary.

## Objective

Build a large, accurate, source-backed automotive encyclopedia for AvtoCena. Japan priority coverage is 2015-present; every other active market is 2020-present. Start with all canonical brands in `apps/web/lib/catalog/brands.ts`, then expand the denominator from every parser's observed make strings and current official manufacturer/group portfolios. Stage missing brands here and report them; do not edit production brand code.

The encyclopedia has two later consumers:

1. public SEO brand/model encyclopedia pages;
2. canonical identification/enrichment of parsed marketplace listings, so source spellings such as localized names, punctuation differences, generation/trim suffixes and aliases resolve to one correct public make/model and can inherit exact source-backed specifications.

## Safety

- Research/stage data ONLY under `data/catalog/vehicle-encyclopedia-v2/**`.
- Validation/research tooling may be added ONLY under `scripts/vehicle-encyclopedia/**` and tests under `tests/vehicle-encyclopedia/**`.
- Do NOT modify `data/catalog/vehicle-knowledge/**`, live catalog generations/read models, `apps/web/**`, `packages/**`, `.github/workflows/**`, collectors, pricing, calculations, deployment, or production publication.
- Do NOT trigger any catalog writer/import/deploy workflow.
- Do NOT merge to `main`.

## Existing system to understand, not modify

Read these files for compatibility:

- `apps/web/lib/catalog/vehicle-knowledge.ts`
- `apps/web/lib/catalog/model-directory.ts`
- `apps/web/lib/catalog/brands.ts`
- `data/catalog/vehicle-knowledge/ATTRIBUTION.md`
- current `data/catalog/vehicle-knowledge/models.json` and `variants.json`

The current production knowledge already supports aliases and variants. V2 must be a cleaner, much larger staging source that can later be compiled into that runtime after review.

## Internet/source policy

If this Codex environment has internet access disabled, DO NOT fabricate or proceed as though research succeeded. Complete the local audit/tooling portion and report that network access must be enabled.

When internet is enabled, use the narrowest practical allowlist of trusted domains and safe GET/HEAD access. Prefer:

1. official manufacturer technical pages, archived specs, press kits and PDFs;
2. official government/type-approval/homologation/registration/fuel-economy/safety databases;
3. authoritative public registries and licensed/open datasets;
4. established automotive reference catalogs only as secondary corroboration.

Do not bypass CAPTCHA, login, paywalls, robots/anti-bot controls or access restrictions. Do not use seller copy, forums, AI-generated pages or SEO farms as the sole source for specs.

## Required identity model

For every brand/model preserve BOTH:

- stable canonical public identity (`canonicalMake`, `canonicalModel`);
- all proven aliases/source spellings (`makeAliases`, model `aliases`, localized `sourceNames`).

Aliases should include useful Chinese/Korean/Japanese/Russian spellings, punctuation/spacing variants, historic market names and source-specific forms when proven to refer to the same model.

Do not merge distinct models just because normalized strings look similar. Separate model, generation, trim and variant. A trim is not a model unless the manufacturer treats it as one.

Actively detect duplicate/alias clusters such as different casing, spacing, transliteration or local scripts and write them to `reports/duplicate-alias-clusters.json` before canonicalizing ambiguous cases.

## Required technical data where source-backed

At minimum collect when available:

- production years/dates;
- generation/platform/chassis codes and aliases;
- body type;
- steering position/market applicability;
- engine code and displacement;
- fuel and powertrain kind (ICE/HEV/PHEV/BEV etc.);
- transmission and gears;
- drive layout;
- seats/doors;
- exact published power in hp/PS and kW with provenance;
- ICE and electric-motor powers separately when documented;
- battery capacity and official range standard where applicable;
- dimensions, wheelbase, weights, clearance, tank capacity;
- 0-100 and top speed when official/source-backed;
- EV/PHEV exact 30-minute power ONLY when explicitly documented by homologation/type approval/CoC/official registration evidence.

CRITICAL: never calculate or estimate `power30MinKw` from peak power, motor count, battery size or ratios. If exact documented 30-minute power is unavailable, leave it null/missing and record the gap in `reports/power30min-coverage.json`.

## Provenance

Every factual field must be traceable to one or more entries in the brand file `sources` array. Use `evidence` objects listing `sourceId` plus the exact normalized fields supported by that source.

If authoritative sources conflict, preserve the conflict in `researchNotes` / `reports/source-conflicts.json` and leave disputed fields unresolved instead of guessing.

Respect source licenses. Store normalized facts and attribution metadata, not copied descriptive prose.

## Work plan

### Phase 0A — mandatory global brand and logo denominator

This phase is a hard publication prerequisite and precedes broad model expansion.

1. Reconcile the production brand list, every market parser's normalized/raw make identities, the existing logo archive and official current manufacturer/group portfolios.
2. Add every source-backed missing passenger/light-passenger brand to V2 staging with an English/Latin canonical name and proven aliases. Unknown parser makes remain explicit unresolved queue entries; they are never discarded or guessed.
3. Stage an authentic light-theme and dark-theme logo for each brand. Every final file must be a transparent PNG on an exact `90 × 60 px` canvas, centered without aspect-ratio distortion.
4. Record source trace, checksum, attribution/trademark note and rights-review state. Text fallbacks and generated logos are forbidden as completion evidence.
5. Generate machine-readable asset and publication-readiness reports. A brand cannot be publication-ready while either identity or logo gate is incomplete.
6. Keep all assets isolated from `apps/web/**` until a separate reviewed integration task.

### Phase 0 — audit and tooling

1. Inspect current production knowledge coverage and current matching rules.
2. Quantify likely duplicate make/model alias clusters visible in current knowledge/live source spellings, but do not modify production data.
3. Implement a validator under `scripts/vehicle-encyclopedia/` for `schema/entity-chunk.schema.json` plus semantic checks:
   - unique brand/model/generation/variant IDs;
   - no duplicate canonical identity inside a brand;
   - alias collisions reported;
   - year ranges valid;
   - source IDs referenced by evidence exist;
   - important technical values plausible;
   - `power30MinKw` requires evidence from approved exact regulatory/official source types;
   - no record may claim `complete` with missing provenance.
4. Add tests under `tests/vehicle-encyclopedia/`.
5. Produce initial `reports/coverage.json` and duplicate report.

### Phase 1 — pilot brands

Research the approved representative pilot set first: Audi, BMW, Toyota, BYD and Geely.

Write each entity to the matching chunked collection under `data/catalog/vehicle-encyclopedia-v2/chunks/`. Validate after every brand group. Commit in small reviewable batches.

After the pilot, STOP and report:

- model/generation/variant counts per brand;
- source-domain/source-type counts;
- unresolved conflicts;
- alias collisions;
- exact 30-minute-power coverage;
- validator/test results;
- estimated work needed for remaining brands.

Do not silently proceed to hundreds of brands until the pilot data quality is demonstrated.

### Phase 2 — scalable completion

Only after the pilot passes the same quality bar, continue brand-by-brand in checkpoints. Prefer parallel research agents/worktrees by non-overlapping brand groups if available, with a single validation/reconciliation step before commits.

Update `manifest.json` after each checkpoint. Never overwrite good source-backed data with lower-confidence data.

## Completion output

Do NOT integrate V2 into production in this task.

Deliver:

- staged per-brand JSON files;
- the complete staged brand denominator and `90 × 60 px` light/dark logo library with readiness reports;
- validator + tests;
- coverage, duplicate, conflict and 30-minute-power reports;
- a final report with exact counts and source coverage;
- a proposed, NOT EXECUTED migration plan mapping approved V2 data to current `VehicleKnowledgeModel` / `VehicleKnowledgeVariant` structures and SEO pages.

All claims in the final report must be backed by files, test output and source metadata.
