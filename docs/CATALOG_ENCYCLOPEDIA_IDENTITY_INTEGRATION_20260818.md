# Catalog ↔ Encyclopedia V2 identity integration

Date: 2026-08-18

## Current production diagnosis

The live catalog currently has two independent identity systems:

1. `apps/web/lib/catalog/brands.ts` maintains a Drom-derived brand list plus manual Korean/global aliases.
2. `apps/web/lib/catalog/vehicle-knowledge.ts` reads legacy `data/catalog/vehicle-knowledge/**` and can rewrite `offer.make` / `offer.model` during catalog publication.

`apps/web/lib/catalog/storage.ts` calls `enrichOfferWithVehicleKnowledge()` before publishing offers. Catalog facets then derive `makes` and `(make, model)` pairs directly from the stored projections. Therefore any unresolved or incorrectly normalized source spelling becomes a separate public filter entry and propagates into model suggestions/counts.

Observed examples motivating this work include separate public entries such as `AITO`, `AITO Wenjie`, `AITO 问界` and `BAW` / `BAW (Beijing Automobile Works)`.

## Target authority split

- Market collectors own **offers** and preserve raw source naming in source/raw data.
- Encyclopedia V2 owns **vehicle identity**: canonical brand/model IDs, canonical public names and proven safe aliases.
- Pricing owns calculated commercial values and must not infer identity.

Collectors must never stop ingesting because an identity is unknown. Unknown names remain stored and enter an unresolved identity queue; they do not become new canonical brands merely because a seller/source introduced a new spelling.

## Resolver safety contract

`apps/web/lib/catalog/encyclopedia-identity.ts` is deliberately fail-closed:

- only canonical names and aliases explicitly marked safe are eligible for automatic identity resolution;
- Unicode aliases are preserved (Chinese/Korean/Japanese/Russian are first-class keys);
- model resolution is always scoped by the already-resolved brand ID;
- any alias key that points to multiple distinct entities is treated as ambiguous and is not auto-merged;
- unsafe aliases are never auto-merged;
- no fuzzy string similarity is used to prove identity;
- an unresolved model may still retain a safely resolved canonical brand without inventing a model mapping.

The V2 generated search index is supported as an additional exact safe-key source, including `canonical_make_model` entries.

## V2 loader contract

`apps/web/lib/catalog/encyclopedia-identity-data.ts` reads only the bundled repository snapshot under `data/catalog/vehicle-encyclopedia-v2`.

Before returning a resolver it verifies:

- manifest schema/workspace identity;
- brand/model chunk schema and entity type;
- generated search index schema;
- exact brand/model record counts against the manifest.

Missing V2 data returns no resolver; malformed or count-mismatched V2 data fails loudly rather than silently publishing partial identity state.

## Integration phases

### Phase 1 — identity read model (this branch)

Build and test the fail-closed resolver and loader. Do **not** connect it to production publication yet.

### Phase 2 — shadow resolution

After the recovered Encyclopedia V2 checkpoint is durable and validated, run the resolver against current catalog projections without changing public output. Produce:

- resolved offers by market/source;
- unresolved make/model names with counts;
- ambiguous aliases/collisions;
- before/after canonical brand counts;
- top duplicate clusters by inventory impact.

No offer should be deleted because identity is unresolved.

### Phase 3 — canonical publication

Gate V2 identity with an explicit feature switch. At publication time preserve raw source naming and write canonical identity to the public projection. Existing stored inventory must be reprojected from its raw/source data so historical duplicate names collapse without re-downloading the vehicles.

### Phase 4 — facets and navigation

Make brand/model filters, counts, related navigation, SEO paths and card titles consume canonical IDs/names. Remove the hand-maintained alias authority from `brands.ts`; keep only presentation metadata (for example logo mapping) that is not identity truth.

### Phase 5 — deep encyclopedia fields

Only after identity is stable, connect generation/variant/specification enrichment. `power30MinKw` remains source-only under Encyclopedia V2 rules and must never be inferred from peak power.

## Production gate

Do not enable canonical V2 publication until all of the following are true:

- recovered Encyclopedia V2 checkpoint is durable on GitHub;
- V2 validation/test suite is green;
- shadow-resolution collision report is reviewed;
- no unsafe alias can mutate public identity;
- current catalog writer continues to ingest unknown/unresolved vehicles;
- rollback consists of disabling the feature switch, without deleting source offers.
