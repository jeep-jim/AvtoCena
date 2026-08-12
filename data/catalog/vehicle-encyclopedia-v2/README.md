# AvtoCena Vehicle Encyclopedia V2 (staging)

This directory is deliberately disconnected from the live catalog and from the current production `data/catalog/vehicle-knowledge/` dataset.

The purpose is to let Codex/research agents build a large, source-backed automotive encyclopedia safely and incrementally. Nothing in this folder is read by the production application today.

## Layout

- `AGENTS.md` — hard safety and evidence rules for Codex.
- `schema/brand.schema.json` — canonical per-brand JSON contract.
- `brands/<brand-slug>.json` — one brand per file.
- `brands/_template.json` — starter example.
- `manifest.json` — progress/checkpoint registry.
- `reports/` — duplicate, conflict, missing-source and coverage reports.

## Existing production knowledge

AvtoCena already has a working knowledge layer in:

- `data/catalog/vehicle-knowledge/models.json` (+ chunked model files)
- `data/catalog/vehicle-knowledge/variants.json`
- runtime: `apps/web/lib/catalog/vehicle-knowledge.ts`
- brand/model encyclopedia rendering: `apps/web/lib/catalog/model-directory.ts`

That current system already supports make/model aliases, model matching, variants, engine size, fuel, transmission, drive, body type, horsepower/kW and exact documented 30-minute power when available. V2 staging must expand and clean the data without modifying those production files during research.

## Intended pipeline

1. Research into `vehicle-encyclopedia-v2/brands/*.json` with source evidence.
2. Validate schema, duplicate identity and source coverage.
3. Produce review reports.
4. Only after human review, build a separate compiler/migration that converts approved V2 records into the existing production `VehicleKnowledgeModel` / `VehicleKnowledgeVariant` formats.
5. Run matching regressions against real catalog source spellings before any production publication.

This separation is intentional: a research agent can work for a long time without risking the live site, market collectors, prices or catalog JSON.
