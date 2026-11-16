# Raw feed session wiring — staged, disabled by default

This follow-up is based on operations integration `2900ae4`. It does not create a
registry, enable a policy, mark writer coverage verified, collect a supplier,
dispatch a workflow, activate an application, or delete an object. Japan is not
part of the raw-feed protocol. The serving application still needs a separately
reviewed release containing the small persist gate before coverage can be
accepted. A merged source file is not evidence of an installed gate.

## Actual producer and read ownership

`openRawFeedPin` joins the common CAS registry only when the persisted policy at
`catalog/raw-feed-coordination/v1/policy.json` requires protocol 1. No policy and
no registry preserve the existing disabled behavior. A partial installation,
missing required policy, changed registry identity, or malformed policy stops
the operation. `CATALOG_RAW_COORDINATION_REQUIRED=1` is a fail-closed assertion;
it cannot bootstrap or activate a registry.

In required mode, callers use `pin.storage`. Raw PUTs and object GETs through
that storage are registered synchronously in a process-local queue. Permission checks and claim
extensions are serialized, while the actual bounded I/O can overlap. A claim
exists before the first raw write. The handoff stops accepting new I/O, awaits
all registered promises, seals the coordinator grant, and then saves the pin's
ready state with the exact token and grant revision. Failed or ambiguous PUTs
leave a writing claim. No timestamp expires it.

A different process cannot reopen a writing session just because its workflow
owner or operation name matches. Recovery of a sealed coordinator grant is
read-only and requires the original token, incarnation, owner, and references.
An old pin without a coordinator binding is not silently adopted. The non-Japan
archive has explicit recovery for a crash between coordinator seal and saving
pin-ready, and for a crash before writing the local receipt; no raw bytes are
rewritten in either sealed recovery path.

A standalone saved-archive verification or restore takes a temporary read-only
claim, including when the original archive pin was published long ago. It
cannot PUT raw data, return detached download access, or delete anything. Its
claim closes only after all reads settle. Failed validation never converts an
incomplete source into a complete supplier observation.

| Writer slot | Actual guarded path |
| --- | --- |
| `che168_archive` | `catalog-che168-snapshot-archive.mjs`: claim, durable config pointer, scoped archive writes; existing archive is read under a temporary claim. |
| `che168_bulk` | `catalog-auto-api-che168-bulk-intake.mjs`: snapshot/base-replica/journal claims and all journal/replica I/O through scoped storage. |
| `che168_recovery` | `catalog-auto-api-che168-recover.mjs`: journal and prior archived-input dependencies are claimed before use. |
| `encar_intake` | `catalog-paid-encar-intake.mjs`: page/start/receipt writes use scoped storage; completed source replay is read-only. |
| `encar_reports` | `catalog-prepare-paid-encar-reports.mjs`: snapshot and report roots stay claimed through all bucket writes and readiness. |
| `encar_restore` | `catalog-restore-encar-snapshot.mjs`, and apply in `catalog-repair-paid-encar-technical.mjs`: actual page reads use scoped storage; report roots are claimed before reading complete receipts. The technical-repair plan remains strictly read-only. |
| `nonjp_intake` | `nonjp-intake-archive.mjs`: all five non-Japan market archives use the producer queue. |
| `nonjp_restore` | `verifyIntakeArchive` and small publication identity checks use drained read-only claims. |
| `catalog_persist` | Shared runtime `persistCatalogOffers` checks a real pending reservation before aliases and every manifest CAS. |
| `catalog_activate_verified` | Legacy direct activation is blocked when coordination is required. |
| `catalog_stitch_verified` | Legacy direct stitch is blocked when coordination is required. |
| `catalog_restore_preinventory` | Legacy direct preinventory restoration is blocked when coordination is required. |
| `catalog_commit_intake_cursor` | All five non-Japan cursors use a pending reference reservation, conditional PUT, exact readback, settled receipt, and CAS reconciliation. |

This is a source-code inventory, not a claim that every old live process is
using this revision. It does not establish `legacyJobsComplete`.

The separate minimal application transplant for candidate `a2610af5` is commit
`a3a43f72a611b698fcf9252f09c31714d522d3fb`: the same 4,506-byte gate module,
27 inserted / 2 replaced lines in its own `storage.ts`, and one test file. It
does not copy main's storage implementation or pricing/page-window changes.
That candidate also lacked the preparation callback, so the small transplant
adds an optional callback exactly between directory indexes and public aliases.

## Publication, pointer, and pin ordering

The normal publisher stages immutable generation provenance and reserves the
old current, old previous, and candidate references before changing aliases.
The shared runtime checks the exact ticket, manifest hash, provenance hash,
base generation, and live candidate roots. A function supplied as a preparation
callback by itself cannot satisfy the gate. Price preparation and the existing
source/import-lease checks stay in the same callback chain.

After the runtime's manifest PUT has returned, the publisher saves an immutable
write-settled receipt. Only that receipt permits reconciliation against the
actual current and previous manifest bytes. In required mode, for an ordinary refresh the
producer pins remain ready until its actual cursor PUT and coordinator pointer
commit have succeeded. A saved technical repair has no cursor commit; its
immutable publication receipt records that exception, and it still needs the
manifest write-settled receipt and exact readback.

Each pointer reservation likewise saves its write-settled receipt after the
awaited conditional PUT and readback. If the process crashes after a server
accepted a PUT but before this receipt exists, matching object bytes alone do
not authorize automatic takeover: the pending claim stays protected. A future
terminal-writer recovery must prove the original process cannot still retry an
in-flight write. A crash after the receipt but before the coordinator commit is
recoverable from the exact original ticket and bytes, without another PUT.

Pin release is ordered after publication/cursor confirmation. The pin's own
conditional terminal write and readback precede coordinator claim release. A
failure leaves the ready registry claim or pending publication in place and
returns `cleanup_pending`; it neither rolls back visible catalogue data nor
reports successful cleanup. Cleanup status is persisted when storage permits;
if even that write fails, the immutable session receipt and pending/ready
registry entries still identify the unfinished work.

Recovery metadata lives outside generation cleanup:

- `catalog/raw-feed-coordination/v1/publications/<generation>/{session,settled,cleanup}.json`
- `catalog/raw-feed-coordination/v1/pointer-receipts/<token>.json`
- `catalog/raw-feed-config/v1/che168-snapshot.json`

These are control records, not raw groups. The CSV config pointer records the
exact repository config binding after the producer has claimed that snapshot
root. It does not fetch a new provider config or change the configured feed.

## Saved-input recovery compatibility

An archived input is never corrected in place. Legacy recovery first claims
the prior archive dependency, verifies the local copy, restores a separate
working directory from the immutable archive, and removes only the new local
copy's receipt before modifying data. The original input, original receipt,
and stored archive remain byte-identical. The report is not altered before the
legacy journal computes its input fingerprint.

The corrected report records the original archive as a semantic dependency;
its newly archived dataset gets a new actual run/attempt identity. Both roots
survive provenance and published cursor conversion. The workflow's own-storage
restore step follows `CATALOG_INTAKE_INPUT_DIR`, so it reads the corrected fork.
Source/controller approval pins in the workflow are unchanged.

## What remains before automatic raw rotation is safe

1. **Fence actual old writers.** Obtain bounded, saved terminal evidence for
   every legacy workflow/process, including the long-running China publisher.
   Install or explicitly block every writer slot above at its actual runtime
   revision. A timeout, timestamp, merged PR, or a new source file is not proof
   that an old writer has stopped. Sessions that began while policy was off
   remain legacy writers until their terminal state is proven.
2. **Bootstrap from actual storage.** Read current and previous manifests,
   borrowed market chunks, all paid Korea observation/report roots, all five
   intake cursors, the selected CSV config, the internal catalog manifest and
   every retained source chunk, and loading/ready producer pins.
   Create a bounded persisted ledger through a separately reviewed operation.
   Missing historic provenance stays unknown and blocks eligibility; no empty
   descriptor may replace uninspected data.
3. **Bind complete inventory and coverage.** Save complete bounded object,
   producer-pin, and writer inventories. Coverage must reference the actual
   registry revision and all hashes. A root proof must carry the coverage hash
   captured while its inventory was made. Reverification of coverage does not
   relabel old root proofs.
4. **Review and connect the bounded executor.** The separate inventory/plan/
   executor must use the common deleting claim, exact immutable object plan,
   write-ahead batch ticket, durable partial acknowledgements, and final empty
   root evidence. It must reject every unknown/current/previous/loading/pending
   root, never issue a general prune, and never delete these control records.
   This session wiring does not issue DELETE requests.
5. **Make dependencies retireable.** Current publication conservatively retains
   prior target-market and borrowed-row dependencies, including unknown legacy
   origin. New archives alone cannot prove old rows no longer depend on an old
   archive. Proven row lineage or a verified full replacement/compaction is
   needed before those historical roots can become unreachable.
6. **Provide explicit reconciliation and capacity handling.** A missing
   write-settled receipt needs actual terminal-writer evidence before recovery.
   Loading/ready claims and deletion tombstones never expire by age. Registry
   limits remain 10,000 roots and 4 MiB; exhaustion is an explicit closed state,
   not permission to discard tombstones or ownership records.

No coverage proof, ledger bootstrap, source launch, application activation, or
raw deletion was performed while preparing this change.

## Internal catalog boundary

`catalog/internal/manifest.json` is an input to later market refreshes, not
just a disposable staging pointer. It is the seventh coordinated pointer,
`internal_catalog`. Its descriptor includes the immutable provenance digest
at `catalog/raw-feed-coordination/v1/internal/<generationId>/provenance.json`.
The old six-pointer registry is not accepted as full coverage.

The exported `persistInternalCatalog` checks the required policy before any
chunk writes. Its `beforePreparedInternalManifest` callback runs after all
immutable chunks have settled but before the actual internal CAS. The runtime
independently verifies the exact persisted pending ticket, old and candidate
manifest digests, immutable proof, and live referenced roots. A callable fake
callback does not authorize a write. This gate is separate from the later
public-generation callback.

After an awaited successful PUT, the source helper reads back the actual
internal manifest, saves an immutable write-settled receipt, and commits the
same pointer grant. The runtime checks the receipt and exact last-commit
identity before proceeding. A PUT whose response is lost leaves the pending
roots protected; observing matching bytes does not create terminal-writer
evidence. Only the existing settled receipt permits exact-ticket recovery.

The first internal proof preserves known roots but deliberately leaves every
nonempty source unknown until its independent contribution/row lineage is
proved. An empty or absent manifest is a distinct proven case. Neither a
complete public generation nor a caller-supplied complete flag establishes
internal coverage. Legacy reset/import-reset paths are blocked once the
protocol is required and have explicit writer inventory slots.

The disabled producer session returns the original storage object; a hundred
page PUTs perform only the initial two control reads, not per-page policy or
registry reads. Enabled sessions keep their dynamic per-I/O ownership checks.
