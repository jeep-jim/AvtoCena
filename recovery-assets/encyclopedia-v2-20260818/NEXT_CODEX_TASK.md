# NEXT CODEX TASK — restore Encyclopedia V2 from snapshot, then continue

Date: 2026-08-18

## Why this task exists

The previous Codex run failed twice while trying to reconstruct/import the Git bundle. Do NOT retry that workflow in this task.

The original Git bundle is preserved in this recovery branch for historical recovery only. The fastest safe path to resume Encyclopedia V2 work is to restore the already-evacuated clean worktree snapshot:

`recovery-assets/encyclopedia-v2-20260818/avtocena-encyclopedia-current-worktree-20260818.tar.gz`

The evacuation report (`raw.txt`) states that the frozen workspace was clean and its HEAD was:

`0329674550c31e5c54bf3faa48ccb8838629f371`

Expected recovered content counts from that frozen workspace:

- sources: 928
- brands: 255
- models: 1,619
- generations: 1,293
- facelifts: 105
- variants/modifications: 19,240
- media: 449
- search-index records: 105,620
- controlled collisions: 35

The historical clean checkpoint `cd847801339e6afc34d2c84c1e0b0593a5283f2f` had 1,617 models / 19,196 variants; the snapshot is a later superset and is the state to resume from.

## Hard safety rules

- Do NOT modify `main`.
- Do NOT modify production/live catalog, pricing, app UI, workflows or deployment.
- Do NOT publish Encyclopedia V2 to production.
- Keep `productionConnected: false`.
- Write only inside:
  - `data/catalog/vehicle-encyclopedia-v2/**`
  - `scripts/vehicle-encyclopedia/**`
  - `tests/vehicle-encyclopedia/**`
- Do NOT restore or commit `recovery-assets/**` into the continuation branch.
- Do NOT use the split Git bundle in this task unless the snapshot itself is proven corrupt.
- Do NOT regenerate the database from expected counts.

## Step 1 — start from the encyclopedia base branch

Use `feat/encyclopedia-knowledge-base` as the base, not `main` and not the recovery-assets branch.

Create a new continuation branch:

`recovery/encyclopedia-v2-snapshot-20260818`

Before switching branches, obtain the snapshot from the remote recovery branch into `/tmp`, for example with `git show` from:

`origin/recovery/encyclopedia-v2-staging-20260818:recovery-assets/encyclopedia-v2-20260818/avtocena-encyclopedia-current-worktree-20260818.tar.gz`

If the exact remote ref name differs, fetch the recovery branch normally and use its exact ref. Do not use force operations.

## Step 2 — inspect before copying

List the archive contents first. Confirm it contains only the intended Encyclopedia V2 worktree payload (Encyclopedia V2 data plus its scripts/tests).

Extract into a temporary directory, NOT directly over the repository.

Then copy/overlay only the allowed paths into the continuation branch:

- `data/catalog/vehicle-encyclopedia-v2/**`
- `scripts/vehicle-encyclopedia/**`
- `tests/vehicle-encyclopedia/**`

Never copy `.git`, recovery assets, app files, production data, workflows, packages, or deployment files from the archive.

## Step 3 — validate restored snapshot before committing

Run the full Encyclopedia V2 validation set from the restored files, including at minimum:

- `node scripts/vehicle-encyclopedia/validate.mjs --write-reports`
- `node scripts/vehicle-encyclopedia/build-search-index.mjs`
- `node scripts/vehicle-encyclopedia/build-brand-queue.mjs`
- `node scripts/vehicle-encyclopedia/build-legacy-preview.mjs`
- `node --test tests/vehicle-encyclopedia/*.test.mjs`

Confirm `manifest.json` still has `productionConnected: false`.

Report exact counts after validation. The expected snapshot is:

928 / 255 / 1619 / 1293 / 105 / 19240 / 449 / 105620 with 35 controlled collisions.

If counts differ, STOP and explain the exact difference. Do not silently rebuild or normalize to the expected numbers.

## Step 4 — create a durable snapshot checkpoint

Only after validation is green:

- commit the restored Encyclopedia V2 state on `recovery/encyclopedia-v2-snapshot-20260818`;
- push that branch normally, without force;
- report the new commit SHA and exact counts.

This new commit SHA does not need to equal the old frozen-workspace SHA. Content recovery is the priority in this task; the original Git history remains preserved separately in the split bundle.

## Step 5 — continue Encyclopedia V2 breadth-first

After the recovered snapshot is durable and validated, continue the approved Encyclopedia V2 plan from the restored state.

Follow `AGENTS.md`, `CODEX_MASTER_TASK.md`, `APPROVED_PLAN.md`, `STATUS.md` and the existing brand queue in the restored snapshot.

Continue in small validated packets with checkpoint commits. Do not restart completed brands and do not create duplicate entities. Prioritize breadth-first identity/alias coverage before deep specification expansion, while preserving the existing source/evidence contract.

No production connection is allowed in this task.

## Final report

At the end report:

1. continuation branch name;
2. restored checkpoint commit SHA;
3. exact post-restore counts;
4. validation/test results;
5. first additional brand/model packets completed after restore;
6. updated overall counts;
7. blockers/unresolved collisions;
8. confirmation that `main` and production were untouched.
