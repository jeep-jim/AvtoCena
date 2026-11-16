# Raw contribution reader: source protocol, not live GC activation

This change adds a common reader for immutable source contribution evidence.
It does not enable a coordination policy, bootstrap a ledger, attest writer
coverage, fetch a supplier, or delete an object. The existing VM release can
remain a blocked manifest/raw-producer slot when its exact source, object
driver, process inventory, and frozen import entry point are independently
confirmed. Other application writes are outside that limited statement.

## What establishes a source contribution

The source-specific producer must observe a complete independent input and
every mapping/merge/materialization step. A checksum of output chunks alone
does not establish independence. The paid Encar producer separately observes
saved raw pages, deduplicated input payloads, actual merge arguments and final
normalized/public bytes. Borrowed rows, technical repair and incomplete
materialization leave the ordinary safe dependency union in place.

The common reader checks the resulting persisted evidence chain:

- The exact own-storage archive manifest and its bounded report parts, including
  wire/base64/gzip/file/report digests and the input witness checksum.
- The actual saved producer receipt named by the witness, its digest, owner
  identity, normalized input count, sorted ID digest and sorted ID/payload digest.
- Ordered materialization parts containing only IDs and input/internal/public
  row hashes. Excluded input IDs are represented with null output hashes.
- Every actual internal source chunk, its count, byte digest, unique IDs and
  exact row hashes. Public-phase verification additionally reads public chunks
  and binds the earlier immutable internal phase.
- Full mandatory source/archive dependencies and every paid Korea report root
  derived from the actual included rows. Missing or changed source/report
  evidence is not a complete contribution.

The normal contract is `independent_source_snapshot_v1`, with a versioned
`producerKind` matching the immutable report witness. Current non-Japan source
IDs are explicitly mapped to their approved markets. An unknown or Japan source
is rejected before its proof or internal chunks are downloaded. New source
producers still need their own reviewed independence emitter and real writer
coverage; a generic reader does not supply those facts.

## Immutable phases and carry-forward

Proofs and hash parts use the protected control namespace:

`catalog/raw-feed-coordination/v1/contributions/<generation>/<source>/`

`internal.json` exists before the internal manifest CAS. `manifest.json` is
created after public chunks and binds the exact internal receipt. Shared
`rows/0000.json` parts contain hashes, not another copy of vehicle payloads.
Ordinary generation deletion cannot remove a proof still referenced by a
borrowed source in a later generation.

`output.internal.sourceSha256` binds the entire source manifest entry. A later
global generation may carry the same proof only while that source entry, chunk
list, counts and actual payload bytes remain identical. Changing another market
does not invalidate an unchanged source; changing this source does.

Internal provenance v2 records these per-source contribution references.
Until every nonempty source is covered, unknown source IDs and the old root
union are preserved. Once every source has actual verified evidence, the
reference set is derived from that full set of sources and old unrelated roots
can become unreachable. The synchronous descriptor is only a canonical shape;
GC/bootstrap must call `verifiedRawInternalPointerDescriptor`, which checks the
actual storage chain before accepting a complete nonempty descriptor.

## Publication and read ownership

The source publisher first reads only immutable proof headers, reserves the
internal pointer with both old and candidate dependencies, and then the shared
runtime independently verifies the input/output chain before the actual CAS.
The final policy and pending ticket are reread after verification. The existing
settled receipt and exact last-commit checks remain mandatory after the PUT.
When coordination is disabled, the source helper performs full verification
before recording a complete proof; no per-page coordinator wrapper is installed.

Raw producer/read sessions expose a bounded JSON read inside their existing
permission/drain queue. They continue to reject detached raw download URLs.
Internal runtime verification is protected by the persisted pending pointer for
the whole read. Failed verification does not release ownership or enable GC.

## Bounded transport without changing the frozen storage module

`data.ts` stays byte-identical. The reader uses its existing local signer and a
separate GET constrained to the exact REG origin, bucket, prefix and key. It
does not return or log signed URLs. Redirects and HTTP content compression are
rejected; identity encoding makes transfer and decoded byte caps the same.
Oversized or timed-out bodies are aborted. Only an actual 404 means absence;
403, malformed JSON and truncated bodies remain errors.

Each witness part has at most 500 rows and 4 MiB; the protocol permits at most
500,000 input rows and 2,000 parts. Actual chunks are read one at a time, with
at most 5,000 rows and 32 MiB each. Archive report parts inflate to at most
2 MiB and the complete report to at most 4 MiB. A verification has a 2 GiB total
read limit and a five-minute deadline. These are evidence-eligibility limits;
they never truncate a feed or reduce the published inventory.

The separate VM paid-report reader still has no durable raw read claim. Before
that reader is fenced or a bounded after-unreference grace is proved, all
`encar-reports` groups must remain protected even if their producer/row evidence
is complete. No file-age inference closes that reader gap.

## Offline evidence

Tests exercise both immutable phases, a second approved market, null excluded
rows, changed input and output bytes, missing report roots, source carry-forward,
unknown-source preservation, metadata-versus-actual verification, ownership/drain,
strict signed targets, byte limits, decompression, forbidden versus missing
objects, malformed/truncated data, and deadlines including uncooperative cancel.
The independent paid producer fixture also passed the shared reader for internal,
public and carried source evidence. None of these tests constitutes live coverage.
