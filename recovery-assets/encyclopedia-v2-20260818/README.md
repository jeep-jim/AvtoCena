# Vehicle Encyclopedia V2 recovery assets

Temporary recovery-only storage for the frozen workspace artifacts from 2026-08-18.

Upload these five files into this folder:

- avtocena-encyclopedia-current-worktree-20260818.tar.gz
- avtocena-encyclopedia-uncommitted-20260818.patch
- raw.txt
- avtocena-encyclopedia-frozen-workspace-20260818.bundle.part01
- avtocena-encyclopedia-frozen-workspace-20260818.bundle.part02

The original Git bundle is split only to stay below GitHub's browser upload limit. Reassemble it byte-for-byte before using it:

```bash
cat avtocena-encyclopedia-frozen-workspace-20260818.bundle.part01 \
    avtocena-encyclopedia-frozen-workspace-20260818.bundle.part02 \
  > avtocena-encyclopedia-frozen-workspace-20260818.bundle
```

Expected SHA-256 values:

- part01: `01e9c75f273b850e6e5a96f12fd8658564915060514e85815ecab373f2f3987b`
- part02: `831862c63df0945c795854ad253eb64c3ffe6679343c465c5cd2f081a72fe50a`
- reassembled bundle: `5fa0fabfb2d58ec9fcb8886d3c7852fe03c08806bfbbd69d4e50600939b76916`

After reconstruction Codex must run `git bundle verify` before importing anything.

Do not merge this asset folder into `main`. These files exist only to recover the original Git history and workspace state.
