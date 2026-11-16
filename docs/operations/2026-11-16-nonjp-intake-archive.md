# Durable non-Japan intake archives

## Implemented scope

This change prepares the existing China, paid Korea, UAE, Europe and Georgia
workflow to preserve collected input in configured private REG Object Storage
before conversion/publication. It does not start a collection, create a live
archive, switch the application, or execute retention. Japan is rejected by the
archive API and excluded from both new workflow steps.

The ordinary source collector saves each parsed page before normalization,
admission or cursor movement. The paid Dubicars wrapper saves each already
requested parsed JSON response before mapping. Neither adds a provider request.
Request URLs, headers and credentials are excluded from the wrapper's record.
The source's original payload remains private; photos remain source links.

The archive preserves `report.json` and all normalized/raw observation shards
byte for byte at `catalog/nonjp-intake/v1/{market}/{run}/{attempt}`. Input files are
limited to 32 MiB each and split into 2 MiB gzip/base64 parts, with SHA256 on each
part and the complete file. The complete manifest is bounded to 2 MiB. Limits are
20,000 files and 128 GiB uncompressed input; exceeding a limit fails rather than
truncating observations. A complete archive means the input files are stored and
verified; it does not imply complete supplier traversal.

Before the first new archive PUT, the helper reads its own bucket inventory and
uses the existing `catalogStorageBudget`: decimal 1 TB capacity, 200 GB reserve
and the conservative copy estimate. It does not lower that policy. A source-owned
loading pin precedes all raw writes. Immutable parts and the complete manifest
use `If-None-Match`, followed by exact readback. A ready handoff is created only
after all files and the manifest are durable.

## Workflow and publication linkage

| Step | Behavior |
| --- | --- |
| Existing collection job | Saves the completed or partial local input after collection; a failed source is not relabeled complete. The normal artifact also contains the small archive receipt. |
| Existing publication job | Verifies/restores the archive into a fresh temporary directory before conversion. `CATALOG_INTAKE_INPUT_DIR` points conversion and cursor commit at that verified copy. |
| Paid Korea preparation | Archives the already restored saved snapshot; old observation times and the actual saved producer run/attempt remain unchanged. |
| Converter | Binds the receipt to the original report digest, then carries `durableIntakeArchive` and its handoff into the publication report. Source observations and prices are unchanged. |
| Publisher barrier | Revalidates the small complete manifest/pin identity before aliases and before manifest CAS, alongside existing provenance and prepared-price checks. |
| Published checkpoint | Preserves the archive receipt/pins along with existing source cursors and snapshot identities. Technical correction mode is explicitly forbidden from advancing a collection cursor. |

`restore-receipt` mode accepts an exact saved receipt and restores only its own
stored bytes. It does not need a surviving Actions data artifact or create a new
archive. It is a prepared entry point for a separately reviewed saved-input
bootstrap; no bootstrap was run in this change.

## Recovery and immutable ownership

If a crash happens after ready/published but before the runner writes its local
receipt, retry reconstructs the receipt from the exact complete manifest and
owned pin. It verifies every part and writes only the local receipt: zero S3
writes. A completed archive never reopens a ready pin. A loading archive may
resume identical immutable parts; changed input, a different owner, missing or
corrupt parts, or an abandoned pin cannot be silently accepted.

A local receipt does not bypass verification. Every restore checks the manifest,
owner, handoff, current saved pin, all part hashes and all file hashes. The target
directory must be empty. Symlinks, arbitrary filenames, traversal paths, changed
reports and mismatched markets fail closed.

## Provenance and the retention boundary

New provenance uses schema v2 and explicitly tracks all five non-Japan markets.
It derives the archive reference from the validated producer receipt, so an
accidentally empty caller reference array cannot remove its protection. Existing
v1 records are still readable. A v1 `complete:true` only described China/Korea;
it cannot authorize deletion when UAE/Europe/Georgia have rows without metadata.

The normal publisher merges fresh observations with retained rows and fields.
Accordingly, the target market keeps prior dependencies and unknown origins;
unchanged markets keep their borrowed-generation dependencies. A new successful
archive does not make historic unknown origins complete. The planner recognizes
the exact generic archive members and keeps incomplete groups unproven.

This conservative union deliberately does **not** solve eventual raw rotation.
Old dependencies can only be retired by proven row lineage or a verified full
replacement/compaction. Unknown history remains protected, and a bounded metadata
limit causes an explicit failure instead of dropping references. No raw deletion
executor or activation is included. The separate CAS coordinator also still
requires actual producer/PUT-drain/publication hooks, complete writer inventory
and a reviewed bounded executor before live deletion is possible.

## Verification

Offline tests cover all five archive roots, multipart hashes, source failure,
the existing 1 TB/200 GB reserve, ready/published and loading crash recovery,
the actual conversion CLI, receipt/checkpoint propagation, parsed-page ordering,
Dubicars request count and credential exclusion, v1/v2 completeness, retained
target/borrowed-market dependencies and whole-group planning.

The focused combined run recorded 136 passing tests across archive, raw
provenance, checkpoints, source intake, paid China/Korea, report preparation,
China bulk and workflow contracts. Both modified workflow files parse as YAML.
These are offline results; no claim of deployed archives, fresh market coverage,
executed S3 cleanup or live latency follows from them.

Two separately checked, unchanged `catalog-preflight-input.test.mjs` assertions
still expect the older 100 GB/5 GB policy. They fail identically without this
archive change. The storage limit/reserve were not changed to satisfy those
fixtures; the parent integration handles their policy-aligned update separately.
