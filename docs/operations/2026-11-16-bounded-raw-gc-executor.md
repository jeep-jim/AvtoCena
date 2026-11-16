# Bounded raw GC executor — local implementation, not activated

## Status

This package adds a transport-independent executor around the existing single-key
CAS contract. It contains no S3 client, credentials, live bootstrap, workflow,
schedule, command-line entry point, root-proof producer or writer-coverage
attestation. `runRawGc()` defaults to the read-only plan operation. The local
tests use an in-memory transport; their success is not evidence of live writer
coverage or deletion.

**Activation is blocked.** The internal maintenance catalogue at
`catalog/internal/manifest.json` can supply rows to the next refresh. Public
current/previous provenance and the five intake cursors plus Che168 configuration
are therefore insufficient. The explicit prerequisite commit `ddc3c98` adds
the seventh `internal_catalog` pointer and the pure internal provenance API.
This executor reads the actual manifest and its immutable document at
`catalog/raw-feed-coordination/v1/internal/<generation>/provenance.json`, validates
both with `rawInternalPointerDescriptor`, and compares the full descriptor with
the registry. Every nonempty internal catalogue remains `complete:false` until
separate row lineage is proven. A legacy six-pointer registry, missing proof,
changed proof or unsupported completeness returns `internal_catalog_unproven`.

Actual writers still need reservation before the internal manifest changes and
readback before releasing ownership. That session/runtime wiring is a separate
change. A separate hash check or caller boolean does not provide synchronization.

The other live prerequisites remain separate: all actual writer entry points
must be coordinated or blocked; older active writers need terminal evidence;
policy and registry bootstrap need review; all current/previous/internal,
cursor/configuration, loading/ready and borrowed Korea report dependencies need
complete coverage. Unknown historic lineage remains protected. This module does
not assert any of those prerequisites.

## Existing contracts reused

`catalog-raw-retention-plan.mjs` remains the retention policy. The new public
aliases expose its exact member and complete-receipt validators without changing
their logic. Planning preserves the two newest complete groups per kind, live
references and loading/ready pins; it selects whole groups after the existing
minimum grace interval. An old timestamp never closes a writer or releases a
pin.

`catalog-raw-coordination.mjs` remains the only ownership/progress ledger. Its
existing `claim_gc`, `begin_gc_batch`, `record_gc_batch` and `complete_gc`
transitions are called without relaxing their checks. The collector never calls
`register`, `prove_root`, `verify_coverage`, producer release or crash-pause.

The plan must already match the stored root proof: exact root incarnation and
revision, inventory, complete receipt, terminal writer evidence and current
coverage hash. The executor does not refresh an old proof to a new context.

## Bounded transport port

No production adapter is included. The existing storage `listObjects` collects
an entire prefix and the aggregate `deleteObjects` interface does not expose the
required per-key terminal result. Neither is silently treated as a bounded port.

Every request carries the exact target:

| Field | Required value |
| --- | --- |
| endpoint | `https://s3.regru.cloud` |
| bucket | `avtocena-staging-8120751` |
| prefix | `migration-staging/full-20261011/` |

The adapter must honor request deadlines, byte caps before JSON parsing, exact
relative keys and the supplied object count. It must neither fall back to another
bucket/prefix nor perform hidden retries of destructive requests.

| Method | Input and result contract |
| --- | --- |
| `readJson` | `{target,key,maxBytes,deadline}` → `{found,value,etag}`. Missing value is exactly `null`. A found object requires an ETag. |
| `listPage` | `{target,prefix,cursor,maxKeys,deadline}` → `{prefix,objects,truncated,nextCursor?}`. Each object has `key,size,lastModified,etag`. Maximum 1,000 keys per page. A terminal page has no continuation token. |
| `headObject` | `{target,key,deadline}` → `{found,etag,size,lastModified}`. Missing is explicit. |
| `writeJson` | `{target,key,value,condition,deadline}` with exact `ifMatch` or create-only `ifNoneMatch:'*'`. Conditional conflicts must use `StorageConflictError`. |
| `deleteBatch` | `{target,objects,requestSha256,operation,deadline}` → `{settled:true,requestSha256,results:[{key,status}]}` only after the actual request reaches a known terminal response. Results cover every exact requested key once; status is `deleted` or `error`. |

A rejected/aborted/timed-out DELETE promise does not prove remote completion.
The adapter must never manufacture `settled:true` for that case. An uncertain
response leaves the durable batch active and blocks automatic resume. Separate
terminal/drain evidence through the original contract is necessary before a
future same-owner resume. This module exposes no shortcut for supplying that
evidence.

## Plan and explicit execution

`inventoryRawGcRoots` scans only explicitly supplied permitted roots using
bounded pages. Unknown members, missing/inconsistent receipts, duplicate keys,
looping pagination or budget exhaustion preserve the whole group. A partial
root scan cannot be labelled a complete global retention inventory.

`prepareRawGcPlan` requires the existing planner's complete inventory inputs. It
reads actual policy, registry, manifests, provenance and all governed pointers;
compares them with the ledger; scans the selected roots again; and binds the
exact plan to object ETags and existing writer proofs. It writes nothing.

The immutable evidence includes the contract plan and SHA, target, authority,
retention digests, root receipts, per-object metadata and writer-proof hashes.
Only bounded metadata is recorded; raw payloads and provider credentials are not
included. The execution token hashes this evidence SHA together with the exact
owner and operation ID, binding ETag evidence to the original CAS ownership.

Execution requires an explicit arm object with these exact fields:

```js
{
  version: 1,
  action: 'delete_verified_unreferenced_raw',
  operationId,
  owner: {runId, attempt, sourceSha},
  registryId,
  coverageProofSha256,
  evidenceSha256,
  planSha256,
  target: RAW_GC_TARGET
}
```

Owner fields must match the current GitHub run/attempt/source, repository
`jeep-jim/AvtoCena` and main ref. There is no environment flag that
enables deletion by itself. A future controller must review and pin the exact
evidence before constructing this arm; no such controller is provided here.

Before initial ownership, the whole selected inventory is re-read and compared.
The exact immutable plan and evidence are saved create-only under
`catalog/raw-feed-gc-plans/v1/`; existing different document content fails. These control
objects, the coordinator and the internal catalogue are outside the raw deletion
allowlist.

The original CAS changes every selected root to `deleting` before any DELETE.
Each batch then receives an attempt ticket. Four bounded HEAD workers compare
remaining keys against captured ETag, size and modification time. Fresh authority
and ownership are checked again after HEADs and immediately before DELETE. A
known terminal response is followed by HEADs; only confirmed absence advances
object-index acknowledgements. Error, unknown result or metadata change retains
deleting ownership and never expands the approved keys.

The default execution budget is one batch. Same-owner resume requires the exact
current ticket, immutable plan and evidence. It skips acknowledged indexes and
does not double-count them. Another run/attempt/source, changed evidence, a stale
ticket or an active unresolved request cannot take over. Once all batches are
acknowledged, complete empty-prefix reads are required for every selected root.
Unexpected objects remain untouched and prevent final `deleted` tombstones.

## Limits and reporting

Defaults are two roots, 20,000 inventory objects, 10 GiB of inventory bytes,
40 pages, 64 MiB of decoded JSON, one batch and a 120-second work deadline.
Configured limits cannot exceed the existing 10-group/250,000-object/100-GiB
contract; pages are capped at 1,000, JSON at 256 MiB and work at 600 seconds.
DELETE requests contain at most 1,000 exact objects. HEAD concurrency is four.
Deadline enforcement is part of the future transport contract; JavaScript does
not race an in-flight mutation against a local timer and call it drained.

Results report `acknowledgedObjects` and `acknowledgedInventoryBytes`. Those are
the sizes from the approved inventory, not measured physical reclaimed bytes.
`storageWrites` counts acknowledged conditional writes; `deleteRequests` counts
calls attempted through the supplied transport. An unknown transport result does
not establish that a request took effect. Bucket versioning and billing effects
are not inferred from successful deletes. No age-based deletion, general bucket
sweep or automatic ownership expiry exists.

## Local verification

The combined command is:

```sh
node --import tsx --import ./tests/helpers/offline-fetch.mjs --test \
  tests/catalog-raw-gc.test.ts tests/catalog-raw-coordination.test.ts \
  tests/catalog-raw-internal-provenance.test.ts tests/catalog-raw-provenance.test.ts
```

On the prerequisite contract plus this module, 77 tests passed: 26 new executor
scenarios, 27 coordinator scenarios, three internal provenance scenarios and 21
existing provenance/retention scenarios. The tests cover both CAS conflict
orders, immutable-plan conflicts, explicit arming, metadata changes, partial
acknowledgements, an unresolved DELETE, exact same-owner resume, 1,002 objects
across two bounded calls, changed authority, unexpected post-delete objects, and
internal-only lineage. These are local memory-transport tests, not conditional
S3 DELETE or production readiness evidence.
