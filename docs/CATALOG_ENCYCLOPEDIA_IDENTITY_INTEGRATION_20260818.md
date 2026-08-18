# Catalog ↔ Encyclopedia V2 identity integration

Date: 2026-08-18

## Current production diagnosis

The live catalog currently has two independent identity systems:

1. `apps/web/lib/catalog/brands.ts` maintains a Drom-derived brand list plus manual Korean/global aliases.
2. `apps/web/lib/catalog/vehicle-knowledge.ts` reads legacy `data/catalog/vehicle-knowledge/**` and can rewrite `offer.make` / `offer.model` during catalog publication.

`apps/web/lib/catalog/storage.ts` calls `enrichOfferWithVehicleKnowledge()` before publishing offers. Catalog facets then derive `makes` and `(make, model)` pairs directly from the stored projections. Therefore any unresolved or incorrectly normalized source spelling becomes a separate public filter entry and propagates into model suggestions/counts.

The fast `brand-counts` path reads `catalog/public/brand-summary.json`, and that summary is keyed from the stored string `offer.make`. The filter UI itself is not a separate hardcoded source: `CatalogFilters.tsx` builds the visible make list from `facets.makes` plus the current selection. This means a canonical re-projection fixes the principal make list and counts in one place instead of requiring UI-specific deduplication.

`VehicleModelSearch.tsx` queries `/api/catalog/models`; that API currently combines catalog availability with legacy vehicle-knowledge model search. It must consume the same V2 identity/query layer during the later navigation phase so autocomplete and stored projections cannot disagree.

Observed examples motivating this work include separate public entries such as `AITO`, `AITO Wenjie`, `AITO 问界` and `BAW` / `BAW (Beijing Automobile Works)`.

## Target authority split

- Market collectors own **offers** and preserve raw source naming in source/raw data.
- Encyclopedia V2 owns **vehicle identity**: canonical brand/model IDs, canonical public names and proven safe aliases.
- Pricing owns calculated commercial values and must not infer identity.

Collectors must never stop ingesting because an identity is unknown. Unknown names remain stored and enter an unresolved identity queue; they do not become new canonical brands merely because a seller/source introduced a new spelling.

## Resolver safety contract

`apps/web/lib/catalog/encyclopedia-identity.ts` is deliberately fail-closed:

- canonical names are authoritative exact keys;
- automatic alias merges require a structured V2 alias with explicit `safe: true`;
- `sourceNames` are audit/discovery material and are never direct merge authority;
- Unicode aliases are preserved (Chinese/Korean/Japanese/Russian are first-class keys);
- model resolution is always scoped by the already-resolved brand ID;
- any alias key that points to multiple distinct entities is treated as ambiguous and is not auto-merged;
- unsafe aliases are never auto-merged;
- no fuzzy string similarity is used to prove identity;
- an unresolved model may still retain a safely resolved canonical brand without inventing a model mapping.

The V2 generated search index is supported as an additional exact safe-key source, including `canonical_make_model` entries, but only entries with `safe: true` participate.

## V2 loader contract

`apps/web/lib/catalog/encyclopedia-identity-data.ts` reads only the bundled repository snapshot under `data/catalog/vehicle-encyclopedia-v2`.

Before returning a resolver it verifies:

- manifest schema/workspace identity;
- brand/model chunk schema and entity type;
- generated search index schema;
- exact brand/model record counts against the manifest.

Missing V2 data returns no resolver; malformed or count-mismatched V2 data fails loudly rather than silently publishing partial identity state.

## Runtime gate

`apps/web/lib/catalog/encyclopedia-identity-runtime.ts` defines three explicit modes through `CATALOG_ENCYCLOPEDIA_IDENTITY_MODE`:

- `off` — default; no public or operational mutation;
- `shadow` — public make/model remain unchanged, while V2 resolution metadata is recorded for audit/unresolved queues;
- `apply` — only proven V2 canonical make/model values replace public strings, with the source spelling retained in operational metadata.

Unknown values fall back to `off`.

The intended writer hook is immediately after legacy specification enrichment/normalization in `persistCatalogOffers()`. This sequencing keeps the existing specification/pricing behavior independent from the new identity authority. V2 identity should also be applied after grow-only restoration so restored rows and newly collected rows use the same identity path.

## Query compatibility

Canonical publication must not break bookmarked or indexed alias URLs. `apps/web/lib/catalog/encyclopedia-identity-query.ts` rewrites exact safe alias query values to canonical make/model names while leaving unresolved free text untouched. Multiple selected makes are canonicalized and deduplicated; model rewriting occurs only under one unambiguous resolved brand scope.

This query normalization must be inserted before brand-projection lookup and catalog match evaluation when `apply` mode is enabled.

## Integration phases

### Phase 1 — identity read model (this branch)

Build and test the fail-closed resolver, loader, application/query helpers and default-off runtime gate. Do **not** enable canonical production publication yet.

### Phase 2 — shadow resolution

After the recovered Encyclopedia V2 checkpoint is durable and validated, run `npm run catalog:audit-encyclopedia-identity` against current catalog offers without changing public output. Produce:

- resolved offers by market/source;
- unresolved make/model names with counts;
- ambiguous aliases/collisions;
- before/after canonical brand counts;
- top duplicate clusters by inventory impact.

No offer should be deleted because identity is unresolved.

### Phase 3 — canonical publication

Wire the prepared runtime hook into the writer with `off` as the deployment default. After the shadow report is accepted, switch to `apply` and reproject existing stored inventory from raw/source-preserved naming so historical duplicate names collapse without re-downloading the vehicles.

### Phase 4 — facets, queries and navigation

Run make/model request parameters through the V2 query resolver; make brand/model filters, counts, related navigation, model autocomplete, SEO paths and card titles consume canonical identity. Remove the hand-maintained alias authority from `brands.ts`; keep only presentation metadata (for example logo mapping) that is not identity truth.

### Phase 5 — deep encyclopedia fields

Only after identity is stable, connect generation/variant/specification enrichment. `power30MinKw` remains source-only under Encyclopedia V2 rules and must never be inferred from peak power.

## Production gate

Do not enable canonical V2 publication until all of the following are true:

- recovered Encyclopedia V2 checkpoint is durable on GitHub;
- V2 validation/test suite is green;
- shadow-resolution collision report is reviewed;
- no unsafe alias or raw `sourceName` can mutate public identity;
- current catalog writer continues to ingest unknown/unresolved vehicles;
- old safe alias URLs resolve to the canonical catalog after migration;
- rollback consists of setting the identity mode back to `off`, without deleting source offers.
