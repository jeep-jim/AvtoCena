# Current release profile

The activation profile now targets the combined catalog and homepage candidate. See the [exact release, changed-blob evidence and acceptance checks](../home-ui-activation-20261123/README.md). The earlier c162 homepage image was built but not activated. Its source proof does not apply to the combined candidate.

## Archived c162 profile

# Exact home UI controller: preparation and read-only inventory

Application source is `c1622514c73e78ee798ae321c242174aef71706c`; incumbent source is
`22867cbcfaee27b2e8917b6bf880e44827f67b60`. No deployment entrypoint is included.

## Read-only VM inventory

The workflow `.github/workflows/home-ui-runtime-inventory.yml` accepts manual
`controller_sha`, which must equal the reviewed main commit checked out by the run.
Its only push entrypoint is `.github/market-runs/home-ui-runtime-inventory.json`
on main: `{version:1,operation:"read-home-ui-runtime-20261123",approvedSourceSha}`.
That marker must be the sole A/M change, with exactly one parent equal to
`approvedSourceSha` and the GitHub pre-push main tip. Forced pushes and repeated
attempts fail. The marker is deliberately not included in this package.
It uses the existing `regcloud-staging` environment and `REGCLOUD_SSH_KEY` secret.
The pinned SSH wrapper sends only the pinned Python program on stdin; no file is
installed on the VM. Docker reads use three exact container GET endpoints through
`/var/run/docker.sock`; health reads use loopback addresses. The existing runtime
lock is taken shared/nonblocking. No catalog, supplier, ingress or runtime writes occur.

The artifact contains public identities, process timestamps, aggregate environment
digest/count, configuration digests, and observed rollback container IDs. It contains
no raw environment values or individual private-value hashes. A failed check fails
the workflow. Even a successful receipt has `activationAuthorized:false` and
`requiresReviewedRollbackPins:true`. An unused listening port does not prove Docker
reservation availability; the receipt explicitly leaves that check unverified.

## Exact application and acceptance gates

Run `node .github/operations/home-ui-only-20261123/contract.mjs /path/to/c162-checkout`
to verify the clean source tree, six changed code paths, their full diff hash, and
all 6,359 unchanged calculation-source records. The source calculation version is
`672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761`.
The exact serving bridge preserves
`4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90`.

`private-binding.mjs` prepares a GET-only plan. Its separate reviewed application
function can only conditionally create the exact c162 binding to the unchanged
private index; no workflow invokes that function. `acceptance.mjs` is the tested
transition core, without a production host adapter. Both full server receipts must
cover all 17 frozen-baseline routes and all three cache phases; market scope is empty.
The original server/browser programs and baselines are pinned by content hashes.
Browser evidence must match the exact source and fresh nonce. Failed acceptance
requires a verified ingress rollback before candidate cleanup; foreign ingress
must never be overwritten or have its possibly-routed container stopped.

Before any activation, review fresh inventory and rollback IDs, implement and review
the exact host adapter, establish Docker port availability, verify the exact image
and required CI, then run private parity, server and browser gates. The adapter must
hold the runtime lock and its own publication lease through acceptance/rollback.
Do not change the serving runtime while Korea publication is in progress.
