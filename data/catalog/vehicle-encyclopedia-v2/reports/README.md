# Research reports

Codex should keep incremental machine-readable or Markdown reports here, for example:

- `coverage.json` — brand/model/variant coverage and source counts;
- `duplicate-alias-clusters.json` — likely duplicate model names and aliases requiring canonicalization;
- `source-conflicts.json` — technical facts where authoritative sources disagree;
- `missing-fields.json` — important fields still not source-backed;
- `power30min-coverage.json` — exact documented 30-minute-power coverage only;
- `blocked-sources.json` — inaccessible sources; never bypass access controls.

Reports are staging diagnostics and must not alter production catalog data.
