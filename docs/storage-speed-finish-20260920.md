# Storage and performance — 20 September 2026

Owner scope: Korea calculations are accepted only where reliable parameters can be established; unknowns stay unknown. Japanese auction-sheet continuation is accepted as an ongoing automated operation. Finish storage housekeeping and runtime speed before the owner's prepared interface changes. Do not restart source collection for this task.

## Evidence before changes

- Registry retention run 35491780180 succeeded. 143 retained web images, 20,854,587,291 unique blob bytes; no eligible old images remained. Daily 16:30 UTC and after deployment. Active images, rollback revisions and operator pins stay protected.
- Storage cleanup 35463473452 removed 198 objects: 26,289,108,363 to 23,611,853,942 bytes. A later maintenance record at 2026-09-19T20:02:50.683Z reports 23,611,853,930 bytes, no additional deletions, ok=true. These are historical measurements, not a new current inventory.
- Catalog cleanup runs daily at 17:00 UTC, preserves current/previous generations, a six-hour grace and three days of staging; shares the publication lock. Publication preflight includes estimated growth and 5 GB reserve within the 50 GB bucket ceiling. This is not a global cloud storage/spending limit; VM disks and Registry are separate.
- Post-deploy check 35491780170 verified quote parity for its sample but timed out on the repeated homepage request. First home response 18,704 ms TTFB; sampled detail responses up to 12,657 ms.
- Read-only diagnostic 35500576682 found manifest gen_1789884357490_243e9a24 but homepage overview gen_1789826060796_c9970e57 (282,912 bytes). Generation mismatch forces full-catalog fallback. Its standalone pricing timing failed because React.cache is a Next server runtime feature; no pricing result is claimed from that attempt.

## Fix

Every current-read-model publication now builds and stores an overview inside the immutable generation before the public manifest switches. Generation-specific reads preserve the old complete overview during a new publication. The legacy alias remains compatible. A single bounded generation-keyed cache coalesces requests for 60 seconds; failures and mismatched snapshots are not cached. Business pricing still runs per request with its existing currency/configuration rules. Home API exposes separate read/pricing Server-Timing measurements.

The existing overview rebuild repairs the currently published generation on merge. A maintenance marker requests the existing preview-first, lock-protected cleanup and a fresh storage measurement. No collector, source inventory or interface layout changes are part of this patch.

Validation and deployment results will be appended after completion.
