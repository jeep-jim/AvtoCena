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
- `checkpoint-02-summary.md` — audited scope and limitations of the current 15-brand checkpoint;
- `checkpoint-03-summary.md` — audited first five seeds and remaining queue for the active checkpoint;
- `legacy-bridge-proposal.md` — reviewed mapping proposal only; it must not write to production knowledge.

Reports are staging diagnostics and must not alter production catalog data.
