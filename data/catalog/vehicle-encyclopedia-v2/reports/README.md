# Research reports

Codex should keep incremental machine-readable or Markdown reports here, for example:

- `coverage.json` — brand/model/variant coverage and source counts;
- `alias-collisions.json` — unsafe-to-publish collisions among aliases marked safe;
- `duplicate-alias-clusters.json` — likely duplicate model names and aliases requiring canonicalization;
- `source-conflicts.json` — technical facts where authoritative sources disagree;
- `missing-fields.json` — important fields still not source-backed;
- `power30min-coverage.json` — exact documented 30-minute-power coverage only;
- `blocked-sources.json` — inaccessible sources; never bypass access controls.
- `brand-queue.json` — all production brand names with legacy candidate counts and bounded research checkpoints;
- `brand-registry-research.json` — source discovery and legacy-candidate diagnostics for the original 185-brand production baseline;
- `brand-registry-checkpoint.md` — audited identity-registry milestone, exact scope and remaining work;
- `brand-logo-assets.json` — exact dimensions, checksums, source trace and theme-pair status for staged logos;
- `brand-publication-readiness.json` — per-brand identity/logo gate and explicit blockers;
- `brand-denominator-candidates.json` — raw parser make observations and logo-only identities still requiring source-backed reconciliation;
- `model-queue.json` — all 204 staged brands with V2 status counts, priority-window legacy candidates, raw listing demand and regional-source progress;
- `model-mlit-japan-2015-2026.json` — exact MLIT passenger-car workbook observations; source identities are not automatically treated as canonical models;
- `model-mlit-canonical-intersection.json` — strict MLIT-to-VehiclesDB identity intersections and cross-brand exclusions;
- `model-wikidata-exact-identity.json` — exact English `Brand + Model` matches typed as a Wikidata car model or automobile model series, including explicit window eligibility;
- `model-pass-01-summary.md` — audited first all-brand model-census checkpoint and its unresolved denominator;
- `checkpoint-02-summary.md` — audited scope and limitations of the current 15-brand checkpoint;
- `checkpoint-03-summary.md` — audited fifteen source-backed seeds from the previous brand checkpoint;
- `checkpoint-04-summary.md` — audited market-title identity repair for Honda WR-V, Mercedes-Benz V-Class and Vito;
- `checkpoint-05-summary.md` — Citroën queue normalization and the first source-backed seed in the active brand checkpoint;
- `toyota-japan-priority-01-summary.md` — verified mass-market Toyota Japan expansion covering Yaris, Yaris Cross, Aqua and Sienta;
- `toyota-japan-priority-02-summary.md` — current Toyota Japan Corolla-family and Prius configurations with body/powertrain-safe aliases;
- `japan-mass-market-priority-01-summary.md` — first seven-model Japan mass-market package, localized-title composition and exact coverage limits;
- `japan-mass-market-priority-02-summary.md` — Honda N-BOX second/third-generation facelift grades, sourced specifications and chunk-boundary verification;
- `japan-mass-market-priority-03-summary.md` — current Honda N-WGN FF/4WD grade matrix, English/Japanese identity aliases and explicit specification gaps;
- `japan-mass-market-priority-04-summary.md` — current Honda N-ONE and N-ONE e: grades with combustion/BEV identity separation and exact-power safeguards;
- `japan-mass-market-priority-05-summary.md` — current Honda Vezel gasoline/e:HEV grade matrix, English/Japanese aliases and separate engine/motor outputs;
- `legacy-bridge-proposal.md` — reviewed mapping proposal only; it must not write to production knowledge.

Reports are staging diagnostics and must not alter production catalog data.
