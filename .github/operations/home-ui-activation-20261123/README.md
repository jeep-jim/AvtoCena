# Exact home UI c162 activation

This controller deploys only `c1622514c73e78ee798ae321c242174aef71706c`.
The accepted six-path application diff, 6,359 unchanged calculation records,
source `672958…` → serving `465438…` bridge and private `bf2c72…` index remain
enforced by `home-ui-only-20261123/contract.mjs` and `private-binding.mjs`.
The main application tree is never deployed.

## Concrete entry and review

1. Merge the controller after CI. Start `home-ui-activation.yml` on exact main,
   either by its existing manual SHA input or one marker-only commit at
   `.github/market-runs/home-ui-activation.json` with exactly
   `{version:1, operation:"prepare-home-ui-c162", approvedSourceSha:<main parent>}`.
   Do not combine another changed file or preceding commit with this push.
2. The runner checks matching successful CI, builds clean c162 and probes actual
   Alpine Node 24.22.1, the immutable public model asset and applied resource heap.
   It refuses an active Korea recovery or another writer workflow. It conditionally
   acquires the existing publication lease; it never steals or forces an owner.
3. Artifact `home-ui-activation-safe-plan/plan-receipt.json` contains the **new**
   image ID and tar SHA/size, source/tree/calculation identity, actual accepted
   generation and fingerprint, private-file SHA/size, verified inventory hash,
   one-use nonce and full plan SHA. The image and private JSON stay on this runner.
   This stage makes no SSH contact and writes no private release binding.
4. Root reads this receipt before approving its image. Commit only
   `.github/market-runs/home-ui-plan-approval.json`, again with the exact three
   fields `version`, `operation`, `approvedSourceSha`. Copy `operation` from the
   `home_plan_ready.markerOperation` output; it includes run ID, nonce and plan SHA.
   `approvedSourceSha` must equal the current main parent of this approval commit.
   The approval workflow has no VM/storage credentials and verifies the real push.
5. The same runner waits at most 20 minutes. It verifies the approval run, immutable
   ZIP digest, exact tuple and approval workflow/helper Git blobs. It rechecks
   writers, lease, source, index and image bytes, then transfers this same image
   through host-key-pinned SSH. It does not rebuild after review or publish an image.

## Native transaction and failure behavior

- A persistent Python session holds the existing exclusive runtime flock.
  Every effect requires the driver's current owner/manifest proof. The private
  binding is created only for c162 with `ifNoneMatch` and readback; no catalogue
  manifest, listing, price or source generation is changed.
- Image tar and private JSON stream in bounded chunks. The host checks digests
  before Docker load/use. Private data and the external resource launcher are
  mounted read-only. The new container receives no copied 4 GiB/CPU/PID limits.
- Actual free space is checked on both the staging and Docker data filesystems,
  combining measured tar bytes and image.Size only when they share a device.
  This proves a minimum free-space requirement, not Docker's peak load usage.
  Actual RAM/swap/cgroup availability is measured for each Node child at startup.
- Exact identity, private card/price/auth parity, all 17 frozen routes in three
  phases, compare-and-swap ingress, public identity/parity, the same 17×3 server
  checks and the original nonce-bound browser gate are all mandatory. No market
  scope or speed threshold is relaxed. Only home provenance bibliography differs.
- Failed checks or a broken SSH session restore only this transaction's ingress
  postimage; retained health must pass before stopping its owned candidate.
  Foreign ingress refuses cleanup. Unknown remote teardown retains the bounded
  lease TTL; an `always()` job cannot clear a possibly active owner.
- Safe outcome receipts preserve accepted/unknown/retained state, including
  failures after acceptance. No raw Docker Env, browser log, image archive or
  private index is uploaded. The verified inventory is retained in
  `docs/audits/2026-11-23-home-runtime-verified.json` (run 45114122338).

The local tests exercise the complete accepted transition controller with the
concrete IO bridge, stream protocol and refusal/rollback cases. They do not prove
a production activation. The new workflow must still run its actual private,
public and browser gates after Korea is terminal and root reviews that run's plan.

### Historical GitHub runs, 23 November

The run list contains 28 historical entries with zero jobs. After the owner approved cancellation, both [cancel](https://github.com/jeep-jim/AvtoCena/actions/runs/45130128516) and [force-cancel](https://github.com/jeep-jim/AvtoCena/actions/runs/45130287940) returned HTTP 409. Force-cancel reported that the executions had never entered the queue. No cancelled execution was confirmed. The controller re-reads each recorded ID and its job list. Its repository, workflow, creation time and first attempt must match. Any job assignment, changed run, or other writer blocks the release. The queue is checked again before switching ingress and final acceptance.
