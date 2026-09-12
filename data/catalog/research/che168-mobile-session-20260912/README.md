# Domestic Che168 mobile collection checkpoint

Observed through the ordinary mobile site in the existing browser session on 2026-09-12. This is captured evidence, not a production publication or national coverage claim.

- 29 unique detail infoids; 28 latest captures include a full-cash seller price box.
- 10 latest captures include both the displacement and horsepower table labels. Field presence is not verified calculation readiness.
- The strict parser from PR #924 accepts 16 evidence records and rejects 13. All remain uncalculated; published=0, ready=0.
- Rejects include incomplete tables, gallery contamination with a site badge, a title mismatch and one missing full-cash price. Do not weaken validation to accept these.
- Two further records were captured by an automatic four-iteration batch before its next-list-page UI action timed out. This is a browser control timeout, not proof of a site access challenge. No reliable sustained throughput established.
- The existing GitHub runner transport canary #34674598610 separately received Tencent Security Verification. No challenge interaction or imported credentials/cookies used.

## Archive restoration

`session-base.json.gz` contains a JSON object with a `files` mapping, including initial per-id captures, append-only capture journal, listing observations and cursor state. Its SHA-256 is `4ab2e0cb5b534c24fc922d9782188cdfcf2ee76e06e9965b44a3dd1b887bc584`.

`session-delta.json.gz` contains a replacement `filename -> UTF-8 content` mapping for the two later records and updated journal/checkpoint files. Restore base.files, then overlay the delta. This preserves all recorded capture revisions, including incomplete ones. Captures contain observed visible text/table rows and image URLs, not downloaded vehicle image blobs. These are not claims of complete page DOM or complete technical tables for every record.

`audit.json` records the unmodified PR #924 parser outcome against the 29 latest captures. Production date remains unconfirmed. Registration date must not be silently treated as manufacturing date.

This commit changes evidence files only. No production source registry, collection marker, workflow, gate or catalog is changed. Do not merge or publish on the strength of these sample counts. Required next gate is a working repeatable automatic transport with measured listing/detail throughput and source-bound calculation inputs.
