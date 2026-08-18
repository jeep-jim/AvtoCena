# Vehicle Encyclopedia V2 recovery import — 2026-08-18

This branch is an isolated recovery staging branch. It must not be merged into `main` and does not connect Encyclopedia V2 to production.

## Durable remote baseline

- Source branch at staging creation: `feat/encyclopedia-knowledge-base`
- Source branch HEAD observed through GitHub connector: `9467bb1b03a37696c56469de5030170093a603f7`
- `productionConnected` must remain `false`.

## Recovered frozen-workspace Git state

The frozen workspace was successfully evacuated before further research.

- Clean checkpoint: `cd847801339e6afc34d2c84c1e0b0593a5283f2f`
- Current recovered HEAD: `0329674550c31e5c54bf3faa48ccb8838629f371`
- Earlier confirmed checkpoints:
  - `7942acf1771c6fabcdf8a8e71f0ef8e49b8e0bd6`
  - `e1509c04f208f8ce9c2df9473d246e81d63912ff`
  - `de8777235958f053a34dd9bf2e9510ba31c5526a`
- Frozen workspace reported a clean worktree at evacuation time.
- The recovered HEAD was 63 commits ahead of the workspace's stored `origin/feat/encyclopedia-knowledge-base` ref.

## Exact recovered counts

### Clean checkpoint `cd847801`

- sources: 905
- brands: 255
- models: 1,617
- generations: 1,282
- facelifts: 105
- variants/modifications: 19,196
- media: 449
- search-index records: 105,392
- controlled collisions: 35

### Current recovered HEAD `03296745`

- sources: 928
- brands: 255
- models: 1,619
- generations: 1,293
- facelifts: 105
- variants/modifications: 19,240
- media: 449
- search-index records: 105,620
- controlled collisions: 35

The current recovered HEAD additionally contains the Wuling/Baojun continuation after the clean checkpoint.

## Evacuated artifacts and SHA-256

- original user ZIP: `65d948254f738c584133d11d1eb5e24b02469feb148dc2711a46ef8eaa5a0aeb`
- `avtocena-encyclopedia-frozen-workspace-20260818.bundle`: `5fa0fabfb2d58ec9fcb8886d3c7852fe03c08806bfbbd69d4e50600939b76916`
- `avtocena-encyclopedia-current-worktree-20260818.tar.gz`: `3f1c9b55b587bf042bdabb85d9ff5dc25e97ef6ec9a28158e955740201bfebe6`
- evacuated Git state text: `0c6cfbad071ea2af38d4d12932366b5e8ee4b23f7bc49b644e99aae51e7bd78a`

The binary patch is zero bytes because the frozen worktree was clean.

## Recovery rule

Do not regenerate the 19k+ variant dataset from counts or screenshots. Import the evacuated Git bundle/worktree, validate it, preserve the superset of the remote branch and recovered checkpoint, and only then continue source-backed research.
