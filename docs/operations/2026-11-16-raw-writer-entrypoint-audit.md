# Raw writer entrypoints: source audit, not verified live coverage

## Scope and recorded evidence

This audit reads main commit `325b81915b86e11d48b9942bc9c314008d4e3b7d`
(GitHub GET at 2026-11-16 13:59:55 UTC) and committed combined source
`f731513e7bc37e31aa77fb23ad0344d4b54dac60`. The combined worktree's unfinished
China converter/publisher changes are excluded. No provider, bucket, registry,
policy, workflow dispatch, cancellation or deletion was performed for the audit.

The inventory follows the 15 exported `RAW_COORDINATED_WRITERS` slots in
`scripts/lib/catalog-raw-coordination.mjs`. Relevant workflow files were parsed
from the exact Git trees, including reusable-workflow callers, checkout refs,
job conditions, direct storage writes, and npm script indirection. The GitHub
workflow inventory read at 14:03:35 UTC reports the named current workflows
below as `active`; that API label alone does not make a branch-only, disabled
job, deleted file or unreferenced reusable workflow reachable from main.

Sources for the snapshot are the [main tree](https://github.com/jeep-jim/AvtoCena/tree/325b81915b86e11d48b9942bc9c314008d4e3b7d),
[workflow inventory API](https://api.github.com/repos/jeep-jim/AvtoCena/actions/workflows?per_page=100),
and [run inventory API](https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs?status=in_progress&per_page=100).
These are point-in-time observations. They do not certify that old processes
have stopped or that a required policy has been installed.

## The 15 slots and their actual callers

`event SHA` below means the explicit Actions event revision or the default
`actions/checkout` revision, not a continuously refreshed copy of main.

| Slot | Actual entrypoint and source protection | Reachable workflow / source selection |
| --- | --- | --- |
| `che168_archive` | `catalog-che168-snapshot-archive.mjs` opens a raw pin, uses scoped archive I/O and `commitChe168RawConfig`. | `catalog-refresh-china.yml` → `catalog-market-refresh.yml`, collect job, feed switch required. Checkout is `inputs.prepared_encar_run && github.sha || github.event.workflow_run.head_sha || github.sha`. |
| `che168_bulk` | `catalog-auto-api-che168-bulk-intake.mjs`: snapshot, prior replica and journal dependencies are held by the raw pin; journal/replica I/O uses its storage. | Same China collect chain and checkout. |
| `che168_recovery` | `catalog-auto-api-che168-recover.mjs` holds journal and archived input dependencies. | Same reusable worker's publish job, only `recover_paid_snapshot == 'true' && matrix.market == 'china'`. |
| `encar_intake` | `catalog-paid-encar-intake.mjs` is the coordinated worker. The separate legacy inline workflow is the confirmed bypass described below. | `catalog-refresh-korea.yml` → `catalog-paid-encar-refresh.yml`: initial and continuation jobs, default event SHA, main-only plan and existing cadence/source checks. |
| `encar_reports` | `catalog-prepare-paid-encar-reports.mjs` holds snapshot and report roots through preparation. | Called by `catalog-restore-encar-snapshot.mjs`; also `prepare-saved-paid-encar-reports.yml`, push on its own path **and** exact commit message `Prepare saved paid Encar insurance reports`, default event SHA. |
| `encar_restore` | `catalog-restore-encar-snapshot.mjs`; apply in `catalog-repair-paid-encar-technical.mjs`. Current source uses scoped reads. | Paid Korea worker; `prepare-paid-encar-intake.yml` (manual or successful main `Verify paid Encar inventory`); repair controller separately pins old `7052907...`, which is **not** coordinated. |
| `nonjp_intake` | `catalog-archive-intake.mjs archive` → `nonjp-intake-archive.mjs` → `archiveIntakeDirectory` and producer session. | All five non-Japan collect branches of `catalog-market-refresh.yml`; also paid snapshot preparation. Source is the worker event SHA. |
| `nonjp_restore` | `catalog-archive-intake.mjs restore-for-publication`, `verifyIntakeArchive`, recovery fork and publication identity readers hold a read claim. | Non-Japan publish branches of `catalog-market-refresh.yml`, and the archive/verification calls above. |
| `catalog_persist` | `apps/web/lib/catalog/storage.ts`: `persistCatalogOffers` and `persistInternalCatalog` require real reservation callbacks in required mode. `catalog-publish-market.mjs` supplies the coordinated publication/internal path. Legacy callers without callbacks fail before publication writes. | Normal market worker, five-market rebuild, republish/recovery/manual workflows. These use event-SHA publisher code. The separate `.catalog-serving-runtime` checkout is the live calculator for derived price preparation, not a replacement publisher checkout. |
| `catalog_activate_verified` | `catalog-activate-staged-publication.mjs` → `activateVerifiedGeneration`; `assertLegacyRawWriterDisabled` before its lease and again before pointer writes. | `china-staged-activate.yml`: manual or main marker push; default event SHA; separate exact historical verification and manifest/lease guards remain. |
| `catalog_stitch_verified` | `catalog-stitch-verified-markets.mjs`: `assertLegacyRawWriterDisabled` before storage work. | `catalog-stitch-preserved-markets.yml`: manual or main push on its script/workflow; default event SHA. |
| `catalog_restore_preinventory` | `catalog-restore-preinventory-20260908.mjs`: legacy gate before its lease; exact historical generation checks remain. | `catalog-preinventory-recovery-20260908.yml` only pushes to `fix/catalog-preinventory-recovery-20260908`, not a current main schedule/manual trigger. |
| `catalog_commit_intake_cursor` | `catalog-commit-intake-cursor.mjs` → `commitCoordinatedIntakeCursor`: reservation, conditional pointer PUT, readback, settled receipt and reconciliation. | After successful publish in `catalog-market-refresh.yml` and `catalog-five-market-full-rebuild.yml`; same worker source SHA. |
| `catalog_reset_public` | `catalog-reset-public.mjs`: existing legacy gate precedes `deletePrefix('catalog')` and both public/internal manifest writes. | `catalog-v4-all-markets-30k.yml`: manual, only `inputs.reset_catalog` (default false), default event SHA. Storage target is supplied by its existing secrets; this audit did not inspect their values. |
| `catalog_import_sample_reset` | `catalog-import-sample.mjs`: existing legacy gate precedes reset/delete/import. | No invocation of this exact file was found in current tracked workflows or package aliases. `npm run catalog:import:sample` instead points to `catalog-import-production.mjs`. Direct manual CLI execution remains a guarded source surface. |

The ordinary cron declarations remain China `0 14 * * *`, Korea/UAE/Europe/
Georgia `0 17 * * *` (UTC), alongside their existing manual/marker triggers.
The five refresh wrappers are unchanged by this patch. Existing cadence and
owner source switches still decide whether a worker may collect.

## Confirmed bypass and the narrow correction

At audited main, `encar-paid-intake-check.yml` / `Verify paid Encar inventory`
had both a manual trigger and an automatic push trigger on its own file. Its
main-only job uses `regcloud-staging`, the fixed REG bucket/prefix, and the
event SHA. It directly calls the provider and writes
`catalog/intake-staging/encar/<run>/<attempt>/pages/*.json` and `complete.json`
through ordinary `getJsonStorage()`. It never called a pin/session/policy gate.
The successful workflow can subsequently trigger
`prepare-paid-encar-intake.yml` → `publish-prepared-encar.yml` → the normal
market publisher, so it was not an unreachable historical example.

This source patch changes only that one legacy workflow:

1. Remove its self-file push trigger. Keep `workflow_dispatch`, main-only job,
   protected environment, read-only GitHub permissions and exact storage target.
   Publishing this guard must not start another paid collection.
2. Move the existing dependency install before the first provider step and use
   the same storage configuration in both provider steps.
3. Call the existing `assertLegacyRawWriterDisabled` before either provider
   entrypoint, before each page call/PUT, and before the complete receipt. Any
   existing policy or registry, malformed control, or control read failure
   stops the operation and directs the operator to `Catalog refresh korea`.
   Both controls absent preserve the original collector behavior.

This is a legacy entrypoint fence, not a coordinator session. It does not make
an in-flight legacy process safe to race with policy/bootstrap changes. Such a
process must still reach a proven terminal, drained state before activation.
The provider client's existing internal retry behavior is unchanged.

Offline tests execute both saved workflow JS bodies with the real coordinator
reader and page parser, replacing only provider/storage I/O. They check absent
controls, required/partial/malformed/unreadable controls, changes between steps,
changes before a page PUT or subsequent request, and refusal to write a complete
receipt after the registry appears. No real provider or bucket request occurs.

## Frozen and already-started revisions remain separate blockers

The GitHub read at **2026-11-16 14:03:44 UTC** returned these four refresh runs
as `in_progress`:

| Run | Attempt | Frozen event source | Observed event |
| --- | --- | --- | --- |
| [China 43753103164](https://github.com/jeep-jim/AvtoCena/actions/runs/43753103164) | 12 | `f1a926e4de5df6502f764150115b8bf9e2a43dd3` | schedule |
| [UAE 43876472124](https://github.com/jeep-jim/AvtoCena/actions/runs/43876472124) | 1 | `f6d207361f6f5a484aaac89facfdf44274c0d8d4` | push |
| [Europe 43879552529](https://github.com/jeep-jim/AvtoCena/actions/runs/43879552529) | 1 | `b2fe8f29448dd9ae7cc2ac0525ff55dcf765d38d` | push |
| [Georgia 43879552700](https://github.com/jeep-jim/AvtoCena/actions/runs/43879552700) | 1 | `b2fe8f29448dd9ae7cc2ac0525ff55dcf765d38d` | push |

An updated main does not update these checkouts. A worker that started with the
policy disabled also received ordinary uncoordinated storage from the current
session helper; merely containing hook code does not establish a durable claim.
No terminal writer proof for these processes is established by this audit.

`repair-paid-encar-technical.yml` explicitly checks out
`7052907fb11d58ff919be11a43747d43df01b41e`, not its current controller main SHA.
That exact source has the earlier raw pin helper without `openRawProducerSession`
and no runtime raw-coordination gate. Its main-only/protected-environment and
same-run review approval do not supply missing coordinator coverage. It must
be rebound and checked separately before a future required-policy apply; it is
not an allowed exemption. This patch does not change the frozen repair helper,
controller or its runs.

The same GitHub read reports two older `queued` dispatches of
`catalog-live-recovery-japan-from-prestige.yml`,
[38994894574](https://github.com/jeep-jim/AvtoCena/actions/runs/38994894574) and
[38994824794](https://github.com/jeep-jim/AvtoCena/actions/runs/38994824794), both
at source `8c4a9609a52743545a7a149c7a03b11481b13233` from 17 October. That exact
workflow has a manual trigger, no job-level false/main condition, an event-SHA
checkout and a shared catalog publication call. **The exact old call is
statically blocked:** `catalog-live-recovery-publish.mjs` does not supply
`productionRefreshMarket`, while that revision's `storage.ts` has
`CATALOG_PRODUCTION_WRITES_PAUSED = true` and requires a truthy approved market
in `isCatalogProductionRefreshAllowed` before any persist writes. The storage
target comes from existing secret references; their values and equivalence to
the current REG namespace were not inspected. A queued status is not evidence
of a current PUT or of safe termination. These jobs are recorded with their
actual source guard, not counted as confirmed active manifest writers. No Japan
workflow is run, changed or cancelled here.

The older queued DubiCars smoke [31164670128](https://github.com/jeep-jim/AvtoCena/actions/runs/31164670128)
at `600cdfbe95352a16a407b9ce5bc7101144dcfe4c` is also excluded from the 15 writer
slots: its exact `catalog-strict-source-smoke.mjs` prepares a local report in
`strict_exact_source_only_no_publish_no_generic_normalization` mode, without a
catalog persist call. Its workflow file is absent from current main. Merely
being an old queued run does not make it a raw/pointer writer.

## Do not count file presence as an active writer

- `catalog-v2-market-reusable.yml`, `catalog-v2-market-recovery-reusable.yml`
  and `catalog-v4-market-30k-reusable.yml` have only `workflow_call` and no caller
  in the current tracked workflow graph. In contrast, the V3 reusable worker
  has actual V2-named manual/marker wrappers and the sequential/V4 callers.
- Preinventory, six-market quality rebuild, and the saved 17 September branch
  publication/qualification workflows have explicit historical branch-only
  push triggers. This audit does not label them current main cron jobs, or
  certify every old branch/rerun as permanently inaccessible.
- `catalog-publication-diagnosis.yml` sets publication off; generation-canary
  persist tests use isolated local storage and round-trip only diagnostic
  objects in their own canary namespace. CI path filters and syntax checks
  mentioning a writer are not live calls to that writer.
- The schema/report/inspection read-only workflows and release selector/private
  evidence preparation do not become raw writers merely because their source
  mentions `catalog/manifest.json`. They are outside these six raw root families
  unless an actual managed write is shown.

## Minimal remaining coverage before bootstrap

1. Review and merge the legacy inline fence without its self-trigger; use the
   normal reviewed Korea worker for the next separately coordinated fresh run.
2. Replace the frozen pre-coordinator repair source before any future apply
   under required policy. Keep old receipts/source identities invalidated by
   the existing exact-source, live-generation and review gates.
3. Obtain bounded terminal/drained evidence for policy-off processes and
   resolve old queued jobs/old checkout reachability. A timeout, stale timestamp,
   new main commit or disabled default policy is not terminal proof. This
   source audit is not a complete inventory of every external/manual process.
4. Bind actual writer/source coverage to current and previous public manifests,
   all five intake cursors, Che168 config, the internal manifest and all borrowed
   raw dependencies. Existing unknown lineage and the unfenced VM report reader
   remain protected; code tests cannot fill their live proof fields.

No verified coverage artifact, bootstrap, required-policy activation, GC
arming, live raw deletion or application release is produced by this change.
