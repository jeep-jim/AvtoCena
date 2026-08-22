# AvtoCena Knowledge CORE — master task

## Objective

Build and continuously maintain one source-backed vehicle knowledge system for AvtoCena. It must serve four production consumers from the same canonical facts:

1. parser identity normalization;
2. calculation-engine enrichment;
3. public catalog cards and offer pages;
4. permanent SEO encyclopedia pages.

The previous pilot-first research plan is retired. Validation checkpoints remain mandatory, but **successful validation must not stop the global denominator build**.

## Mandatory coverage windows

- **Japan:** every source-backed passenger/light-passenger make, model and applicable variant from **2010-present**.
- **China, Korea, UAE, Europe, Georgia, Kyrgyzstan:** every source-backed passenger/light-passenger make, model and applicable variant from **2020-present**.
- Include ICE, MHEV, HEV, PHEV, EREV, BEV and FCEV vehicles inside those windows.

These are minimum CORE windows, not priority hints.

## CORE identity and calculation fields

For every source-backed vehicle identity preserve:

- canonical make and model;
- proven aliases/source spellings/localized names;
- market applicability;
- production years/dates;
- generation/platform/chassis identifiers where known;
- body type;
- powertrain kind and fuel;
- engine code and displacement where applicable;
- published power in hp/PS and kW;
- transmission and gears where applicable;
- drive layout;
- ICE/electric motor powers separately when documented;
- battery capacity/range standard when documented;
- exact EV/PHEV 30-minute power only when explicitly documented by approved regulatory/official evidence.

Never derive `power30MinKw` from peak power, motor count, battery size or ratios. Missing exact 30-minute power remains an explicit gap.

## Source policy

Prefer, in order:

1. official manufacturer technical pages, brochures, press kits and PDFs;
2. government/type-approval/homologation/registration/efficiency datasets;
3. licensed/open datasets and authoritative registries;
4. established automotive catalogs as corroboration or gap fill.

Do not bypass CAPTCHA, login, paywalls, robots/anti-bot controls or access restrictions. Store normalized facts and provenance, not copied descriptive prose.

## Global denominator strategy

Do not research one listing at a time.

1. Build the make/model denominator from the union of:
   - every active parser's observed raw and normalized identities;
   - current production brand/model knowledge;
   - Vehicle Encyclopedia V2;
   - licensed/open datasets;
   - official current manufacturer/model portfolios.
2. Bulk-ingest source-backed records wherever a source exposes thousands of rows.
3. Normalize them into stable brand/model/generation/variant entities.
4. Keep ambiguous/conflicting identities unresolved until supported; never guess.
5. Continue alphabetically/brand-by-brand after every green validation checkpoint until the entire approved denominator is exhausted.

## Knowledge-gap feedback loop

Every production market run must emit a machine-readable knowledge-gap report containing at least:

- market and source;
- raw make/model/year;
- canonical make/model status;
- missing CORE fields;
- occurrence count;
- example offer IDs.

Sort gaps primarily by live occurrence count. High-frequency unresolved identities/specs are the next enrichment queue. No parser identity should silently disappear because the encyclopedia does not know it.

## Runtime integration

Production callers use **one API: Knowledge CORE**.

Knowledge CORE consumes trusted Vehicle Encyclopedia V2 facts first. The old `vehicle-knowledge` dataset is only a temporary compatibility fallback behind the CORE API while parity is measured. New callers must not select between competing physical knowledge stores.

Migration sequence:

1. route Identity Master and catalog enrichment through CORE;
2. measure live canonical/model/exact-variant coverage on every market run;
3. port unique good legacy facts into CORE;
4. prove parity and no calculator regressions;
5. then remove duplicated legacy data/scripts/readers.

Do not delete legacy data merely to simplify the tree before parity is proven.

## Quality gates

Target production metrics:

- >=99% live offers resolve to canonical brand;
- >=98% resolve to canonical model;
- >=95% resolve to a sufficiently exact variant carrying required calculation/display facts;
- 100% unresolved identities/spec gaps appear in the gap queue;
- exact 30-minute power is never inferred;
- no source-authoritative exact value is silently overwritten by weaker evidence.

Coverage claims must come from machine-readable reports, not raw JSON row counts.

## RichSpec / SEO phase

After CORE coverage is healthy, enrich the same generation/variant/trim entities with richer source-backed facts such as dimensions, wheelbase, mass, clearance, tank, boot, acceleration, top speed, consumption, suspension, brakes, wheels, safety, comfort and multimedia equipment.

Do not create a second encyclopedia for RichSpec. It extends the same canonical entities used by the calculator and catalog.

## Completion discipline

- Chunk deterministic entity collections at <=250 records where required by current V2 schema.
- Preserve provenance for factual fields.
- Validate after every bulk import/checkpoint.
- Never fabricate completion when internet/source access is unavailable.
- Never stop at a five-brand pilot after validation succeeds.
- Update coverage/gap/conflict reports continuously.
