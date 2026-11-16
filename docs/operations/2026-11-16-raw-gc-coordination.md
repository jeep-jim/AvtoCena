# Raw feed coordination before garbage collection

## Status and scope

This is a local protocol implementation and an integration proposal. It does not
enable a collector, bootstrap live state, attest writer coverage, or delete an
object. `catalog-raw-coordination.mjs` exposes pure transitions and a conditional
writer for one coordinator JSON key. It has no raw-object deletion API.

The existing raw provenance and retention planner are prerequisites, not proof
that all old writers have joined the protocol. Existing active jobs remain live
until their actual terminal evidence is available. A release or merge alone does
not establish that coverage.

Allowed roots are the existing Che168 CSV snapshots, replicas and journals, paid
Encar snapshots and report groups, plus the explicit reserved extension
`catalog/nonjp-intake/v1/{china|korea|uae|europe|georgia}/{run}/{attempt}`. Japan and
arbitrary configurable prefixes are rejected.

## One linearization point

All participants update `catalog/raw-feed-coordination/v1/state.json` with the
same `If-Match` CAS protocol. Each successful mutation increments a monotonic
revision. Tickets include the registry identity, operation, actual workflow
owner, caller token, original grant revision and current claim revision. A
reused operation/owner/token cannot release an old claim's replacement.

The state contains:

| Record | Protection and transition |
| --- | --- |
| Producer claims | `writing` protects all input/output roots; `ready` keeps protection after all writes have settled. Neither expires. |
| Catalog references | Current and previous immutable provenance references remain live. A pending publication protects the old sets and its candidate before aliases or manifest writes. |
| Pointer references | Five non-Japan intake cursors and the configured Che168 CSV binding have current and pending references. A changed cursor/configuration cannot introduce a root already claimed for deletion. |
| Root lifecycle | Unknown live root → inventory-proven live root → deleting → deleted. There is no resurrection or age-based ownership takeover. |
| GC progress | Exact immutable plan hash, root incarnations, batch hashes, one bounded in-flight batch, confirmed object indexes and pause reason. |
| Coverage evidence | Complete inventory of writer paths, saved pins, pointers, roots and terminal legacy jobs. Initial state is unknown. |

Producer claim, publication reservation and GC claim all compete on this one
CAS. A winning producer/reservation blocks deletion of its roots. A winning GC
claim makes new claims, pins and reservations for those roots fail. Re-reading a
digest immediately before an unrelated DELETE is not used as synchronization.

CAS conflicts rerun the entire intent validation against fresh state. The code
never just applies a previously calculated mutation to a new ETag. Changed root
revision, ownership, plan or catalog/pointer revision makes the operation fail.

## Producer integration

`openRawFeedPin` must acquire a coordinator claim before writing the pin or any
raw object. Additions extend that claim before writing new roots. A producer
session must own one claim token, wrap every raw PUT with its write permit, track
all local worker promises, stop accepting new work, and await the complete queue
before sealing. A permission read alone is not a lock. The persistent claim stays
held until the last request has settled; a crashed process leaves it protected.

After drain, write the existing ready pin and seal the coordinator claim. Carry
its exact ticket in the handoff descriptor. After successful publication and
cursor/configuration commit, close the legacy pin first with its existing CAS and
readback. Only then release the ready coordinator claim using that terminal pin
proof. If either step fails, keep durable protection and report `cleanup_pending`.
An abandoned producer additionally requires actual terminal writer evidence.
There is no `finally` clause that unconditionally releases a claim.

## Publication and pointer integration

While the existing publication lease is held, stage and verify the immutable raw
provenance, then reserve candidate references before mutable aliases. The current
preparation barrier and exact calculator verification remain unchanged. Before
each manifest CAS verify the pending ticket and the actual baseline. After CAS,
read back the actual current and previous manifests; one coordinator CAS changes
current/previous references and clears the pending reservation.

A crash before or after the manifest CAS retains old current, old previous and
candidate references. Reconciliation needs the same ticket and exact readback.
Cancellation is allowed only after every publication write has settled, with a
terminal writer proof and the actual unchanged base. There is no time-based
cancellation. A cursor/configuration uses the same reserve → PUT → readback →
commit sequence in its pointer record.

## Exact wiring proposal

| Existing location | Proposed change |
| --- | --- |
| `scripts/lib/catalog-raw-provenance.mjs` | Compose the producer session with pin creation, extensions, ready handoff and terminal pin release. Share the explicit root validator when adding generic non-Japan groups. |
| `scripts/lib/catalog-raw-publication.mjs` | Reserve candidate references after provenance verification; return a ticket verifier; reconcile catalog state before releasing pins. |
| `apps/web/lib/catalog/storage.ts` | A mandatory coordination gate around the shared before-aliases/manifest commit path. When coordination is enabled, legacy callers without the callback fail closed before aliases. This covers the many existing `persistCatalogOffers` callers, including web/import maintenance. No edit to this file is included in this change. |
| `scripts/catalog-publish-market.mjs` | Compose the existing prepared-price barrier with the shared raw reservation, then actual-manifest reconciliation. Keep pending/claims on errors. |
| `scripts/catalog-commit-intake-cursor.mjs` | Reserve current/candidate cursor references before the cursor PUT, commit after exact readback. Do not release producer ownership before this step. |
| Che168 snapshot configuration/archive entry point | Register the configured binding pointer before claiming/using its archive; unknown legacy binding stays protected. |
| `scripts/lib/catalog-activate-verified-generation.mjs` | Join the same reservation/readback lifecycle, or fail closed when coordination is enabled. Its direct current/previous manifest writes otherwise bypass `persistCatalogOffers`. |
| `scripts/catalog-stitch-verified-markets.mjs` | Block the legacy direct manifest writer until reviewed coordination wiring exists. |
| `scripts/catalog-restore-preinventory-20260908.mjs` | Block the legacy direct manifest writer until reviewed coordination wiring exists. |
| Generic non-Japan archive and restore helpers | Acquire/hold the same producer claims before writing/reading new raw groups. Root receipts and provenance must prove completeness separately. |

`catalog-generation-canary.mjs` uses an explicitly local store for its direct
manifest writes. The coverage inventory must distinguish this from an object
store writer; it must not silently exempt a production writer by filename.

## Inventory and deletion phase after review

The next runner must first produce bounded, complete read-only inventory with
current/previous provenance, all saved loading/ready pins, current cursor/config
references, every raw object/receipt, exact installed writer revisions and actual
legacy job status. Unknown provenance or missing coverage returns
`protected_unknown`; it never means an empty set of references.

For a candidate root without an active claim, verify a complete whole-group
receipt and inventory. Bind that proof to the exact root incarnation/revision.
The proof is also bound to the exact verified coverage hash. Invalidated or
replaced coverage requires a fresh root proof even if its own revision did not
move; an old inventory cannot become valid just because coverage was re-attested.
Create an immutable plan containing exact keys and the post-proof revisions.
The coordinator GC claim checks reachability, root versions and proof hashes in
the same CAS that changes all selected roots to deleting. A later claim or pointer
change cannot add a selected root.

The future executor must read and hash that exact plan, record a batch start, and
only then issue a bounded request. This module records partial confirmations by
object index. A retry of the same batch does not double-count acknowledgements.
It reports acknowledged inventory bytes, not an invented number of physically
freed bytes. Cancellation, partial errors and ambiguous responses retain deleting
ownership. A crashed active attempt requires terminal/settled request evidence
before same-owner resumption. A different owner, plan or old attempt is rejected.

After every planned batch is acknowledged, perform complete prefix listing for
each claimed root. Unexpected objects or incomplete listing keep the deletion
unfinished; never broaden the allowlist. Only proved-empty roots become permanent
tombstones. Coverage invalidation immediately prevents starting another batch.
Replacing the coverage proof during an operation also pauses it; automatic
re-attestation is not permission to resume an old plan.

Hard safety limits are 10,000 root records, 256 active producer claims, 4 MiB of
coordinator JSON, 4,096 references per set, 10 groups/250,000 objects/100 GiB per
contract plan, and 1,000 objects per request. The reviewed runner should use the
existing lower routine defaults (2 groups/20,000 objects/10 GiB). Capacity is
reported, including permanent tombstone count. Hitting a limit fails closed;
tombstones, claims and pending transactions are never discarded to make room.
An eventual registry partition/archive needs a separately reviewed atomic design.

## Verification boundary

Offline contract tests exercise both real conditional-write conflict orders,
publication/pointer reservation races, stale tickets and ABA, unknown legacy
coverage, partial deletion/replay, multi-batch progress, persistent tombstones,
capacity and missing-registry failure. These tests are not evidence of deployed
writer coverage, executed S3 cleanup or a live site's latency.
