#!/usr/bin/env bash
# Read-only, isolated hosted compile. No application image is exported or transferred.
set -euo pipefail
readonly app=f692f5b06b4d1d220712904752cadd94c09e7753
readonly prepared=a762b6e50b2f487aa80c9a10d421d8680485ae0c
readonly prepared_tree=200cfe9d8fac048745dcfecdfef277b6d7bba50b
readonly base=22867cbcfaee27b2e8917b6bf880e44827f67b60
readonly tree=1aa1bc244ab68538d849d7c0507fbc58323eeab6
readonly policy_diff=72e0ebe1c7b2217acb2624545e73f0c215e7f3f69def7e2f740ef4afc120e3dd
readonly namespace_diff=42dea5dba532952240e4d595a97a3a81bce549fc6d524cd72174b38ecadca908
readonly final_diff=c0c23b64af60f1aa741fd24d086b24c667d0371950da74e48c4c3913d876e34d
bytes_diff() {
  git --no-pager diff --no-ext-diff --no-renames --no-textconv --binary --full-index "$1" "$2" -- | sha256sum | cut -d' ' -f1
}
test "$(git rev-parse HEAD)" = "$app"
test "$(git show -s --format=%P HEAD)" = "$prepared"
test "$(git show -s --format=%P "$prepared")" = "$base"
test "$(git rev-parse "$prepared^{tree}")" = "$prepared_tree"
test "$(git rev-parse 'HEAD^{tree}')" = "$tree"
test -z "$(git status --porcelain)"
cmp -s <(git diff-tree --no-commit-id -r --name-status --no-renames -z "$base" "$app") <(printf '%s\0' \
 M apps/web/lib/catalog/ajes-query.ts \
 M apps/web/lib/catalog/inventory-admission.ts \
 M apps/web/lib/catalog/offer-quality.ts \
 M apps/web/lib/catalog/storage.ts \
 A tests/catalog-europe-korea-year-2022.test.ts)
cmp -s <(git diff-tree --no-commit-id -r --name-status --no-renames -z "$prepared" "$app") <(printf '%s\0' \
 M apps/web/lib/catalog/storage.ts \
 M tests/catalog-europe-korea-year-2022.test.ts)
test "$(bytes_diff "$base" "$prepared")" = "$policy_diff"
test "$(bytes_diff "$prepared" "$app")" = "$namespace_diff"
test "$(bytes_diff "$base" "$app")" = "$final_diff"
git diff --check "$base" "$app"
test "$(git rev-parse HEAD:scripts/catalog-calculation-version.mjs)" = 63c9323ac7a0ddf267a725443ca2316c197cc7d8
build_calc="$(node scripts/catalog-calculation-version.mjs)"
[[ "$build_calc" =~ ^[a-f0-9]{64}$ ]]
test "$build_calc" = c2d50664dc21dc491b0fef900ea3f3c2740040c5dcd72ae2bfa03a8875b789a9
npm ci --ignore-scripts --no-audit --no-fund
npm --workspace=@avtocena/web exec tsc -- --noEmit --incremental false
npm --workspace=@avtocena/engine exec tsc -- --noEmit --incremental false

# Immutable assumption: exactly this old fixture expects model year 2020 to be
# accepted. Keep the exact same +/- minute/one-day assertions at a 2022 boundary.
# Use an ephemeral sibling (relative imports unchanged), never alter app bytes.
readonly age=tests/catalog-market-landing.test.ts
readonly adjusted=tests/.hosted-year2022-market-landing.test.ts
test "$(git hash-object "$age")" = 88906e24397364ad1a8900e1e5fd7bfdd4ad87c6
test ! -e "$adjusted"
trap 'rm -f -- "$adjusted"' EXIT
python3 - "$age" "$adjusted" <<'PY'
import sys
from pathlib import Path
s = Path(sys.argv[1]).read_text()
start = "test('future landing uses exact age date and cannot poison the current-day cache'"
end = "test('dated landing replaces expired base without loading full projections'"
assert s.count(start) == s.count(end) == 1
a = s.index(start)
b = s.index(end, a)
block = s[a:b]
assert block.count('year:2020') == 2 and block.count("'2020-") == 2
assert block.count('2026-') == 4
block = block.replace('year:2020','year:2022').replace("'2020-","'2022-").replace('2026-','2028-')
with open(sys.argv[2], 'x') as f:
    f.write(s[:a] + block + s[b:])
PY
test "$(git hash-object "$adjusted")" = f1254a1785f7f1bb2c6a9d42bdbc62544bf66233
JSON_STORAGE_DRIVER=local node --import tsx --import ./tests/helpers/offline-fetch.mjs --test --test-concurrency=1 \
 tests/catalog-europe-korea-year-2022.test.ts "$adjusted" tests/catalog-market-facets.test.ts \
 tests/catalog-navigation-facets.test.ts tests/catalog-china-common-grid.test.ts tests/catalog-china-default-showcase.test.ts
rm -- "$adjusted"
trap - EXIT
test -z "$(git status --porcelain)"
printf 'year_source_verified release=%s tree=%s build_calc=%s\n' "$app" "$tree" "$build_calc"
