# AvtoCena Vehicle Encyclopedia V2 (staging)

This directory is deliberately disconnected from the live catalog and from the current production `data/catalog/vehicle-knowledge/` dataset.

The purpose is to let Codex/research agents build a large, source-backed automotive encyclopedia safely and incrementally. Nothing in this folder is read by the production application today.

## Layout

- `AGENTS.md` — hard safety and evidence rules for Codex.
- `schema/entity-chunk.schema.json` — strict contract for every chunked entity collection.
- `chunks/<entity>-NNNN.json` — canonical source, identity, media and vehicle entities, at most 250 records per file.
- `chunks/_template.json` — empty chunk template.
- `ingest/_template.json` — batch envelope for validated, dry-run-by-default ingestion.
- `manifest.json` — deterministic collection/checkpoint registry.
- `generated/search-index.json` — reproducible index for canonical names, localized names, source spellings and safe aliases.
- `reports/` — coverage, alias collision, conflict, missing-field and exact 30-minute-power reports.
- `scripts/vehicle-encyclopedia/` — isolated loader, validator, compiler and search CLI.
- `tests/vehicle-encyclopedia/` — V2-only contract and resolver tests.

## Entity graph

```text
brand → model → generation → facelift → variant
                    └───────────────→ media
source ←──────────── field-level evidence
```

The graph is normalized instead of nesting an unlimited number of variants inside one brand file. This keeps every collection safely chunkable without changing the contract when a brand grows.

## Existing production knowledge

AvtoCena already has a working knowledge layer in:

- `data/catalog/vehicle-knowledge/models.json` (+ chunked model files)
- `data/catalog/vehicle-knowledge/variants.json`
- runtime: `apps/web/lib/catalog/vehicle-knowledge.ts`
- brand/model encyclopedia rendering: `apps/web/lib/catalog/model-directory.ts`

That current system already supports make/model aliases, model matching, variants, engine size, fuel, transmission, drive, body type, horsepower/kW and exact documented 30-minute power when available. V2 staging must expand and clean the data without modifying those production files during research.

## Intended pipeline

1. Research into normalized `vehicle-encyclopedia-v2/chunks/*.json` with source evidence.
2. Validate schema, duplicate identity and source coverage.
3. Produce review reports.
4. Only after human review, use the proposed bridge compiler to convert approved V2 records into the existing production `VehicleKnowledgeModel` / `VehicleKnowledgeVariant` formats.
5. Run matching regressions against real catalog source spellings before any production publication.

This separation is intentional: a research agent can work for a long time without risking the live site, market collectors, prices or catalog JSON.

## Local verification

```bash
node scripts/vehicle-encyclopedia/validate.mjs --write-reports
node scripts/vehicle-encyclopedia/ingest.mjs --input=/path/to/batch.json
node scripts/vehicle-encyclopedia/build-search-index.mjs
node scripts/vehicle-encyclopedia/build-brand-queue.mjs
node scripts/vehicle-encyclopedia/build-legacy-preview.mjs
node --test tests/vehicle-encyclopedia/*.test.mjs
```

The legacy command writes only to `generated/legacy-bridge-preview/`; it never edits the production knowledge directory.
Ingestion is also non-writing by default; applying a validated batch requires an explicit `--apply`, and replacement of an existing ID additionally requires `--replace-existing`.
