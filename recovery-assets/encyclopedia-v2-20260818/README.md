# Vehicle Encyclopedia V2 recovery assets

Temporary recovery-only storage for the frozen workspace artifacts from 2026-08-18.

Expected files:

- avtocena-encyclopedia-frozen-workspace-20260818.bundle
- avtocena-encyclopedia-current-worktree-20260818.tar.gz
- avtocena-encyclopedia-uncommitted-20260818.patch
- raw.txt

Important: the `.bundle` is ~37.36 MiB, so GitHub's browser upload limit of 25 MiB per file will reject it. If browser upload is used, split only the bundle into parts under 25 MiB and keep the other three files unchanged. Codex must reassemble the bundle byte-for-byte before `git bundle verify` / `git fetch`.

Do not merge this asset folder into `main`. These files exist only to recover the original Git history and workspace state.
