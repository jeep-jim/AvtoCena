#!/usr/bin/env bash
set -euo pipefail
readonly APP=0d577596d14bbd5c4f6eafa48fb9b153ae7ef2ec TREE=a2d52f40104ea8cc3162a21b182478d0225ef997
readonly V1=7617caba7f06e4a6b0ab017d31e5c64b73f4a90e V1TREE=a640e246e9edd99f4da265f22eeace04fd0ce5ad
readonly BASE=01fab2584c11839b0fefbaecb1edf75d31f92b68 BASETREE=c7650e6b01610087ebc3aaefe063ee259a341c17
readonly op="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test "$(git rev-parse HEAD)" = "$APP";
test "$(git rev-parse "$APP^{tree}")" = "$TREE"
test "$(git rev-parse "$V1^{tree}")" = "$V1TREE"
test "$(git rev-parse "$BASE^{tree}")" = "$BASETREE"
test "$(git show -s --format=%P HEAD)" = "$V1"
test "$(git show -s --format=%P "$V1")" = "$BASE"
test -z "$(git status --porcelain)"
cmp -s <(git diff-tree --no-commit-id --name-status --no-renames -r -z "$V1" "$APP") <(printf 'M\0apps/web/components/catalog/CatalogContent.tsx\0')
while IFS=$'\t' read -r state sha path; do
 [[ "$sha" =~ ^[a-f0-9]{40}$ && ( "$state" == M || "$state" == A ) ]]
 test "$(git ls-tree "$APP" -- "$path" | cut -f1)" = "100644 blob $sha"
 test "$(git hash-object -- "$path")" = "$sha"
done < "$op/APP_APPEND.tsv"
cmp -s <(git diff-tree --no-commit-id --name-status --no-renames -r -z "$BASE" "$APP" | sort -z | tr '\0' '\n') <(
 while IFS=$'\t' read -r state sha path; do printf '%s\n%s\n' "$state" "$path"; done < "$op/APP_APPEND.tsv" | sort)
git diff --check "$BASE" "$APP"
npm ci --ignore-scripts --no-audit --no-fund
npm --workspace=@avtocena/web exec tsc -- --noEmit --incremental false
export JSON_STORAGE_DRIVER=local TSX_TSCONFIG_PATH=apps/web/tsconfig.json
node --import tsx --test --test-concurrency=1 tests/catalog-mixed-prepared-china-rail.test.ts tests/catalog-route-source-scope.test.ts
readonly probe="$(mktemp --suffix=.cjs tests/.mixed-haval-render.XXXXXXXX)"
trap 'rm -f -- "$probe"' EXIT
cat tests/catalog-mixed-haval-native-fixture.test.cjs "$op/ssr-route.extra.cjs" > "$probe"
node --import tsx --test --test-concurrency=1 "$probe"
printf '{"status":"exact_haval_native_and_server_component_fixture","app":"%s","productionData":false,"browser":false,"publish":false}\n' "$APP"
