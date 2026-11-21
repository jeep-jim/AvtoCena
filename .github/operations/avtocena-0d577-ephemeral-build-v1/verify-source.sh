#!/usr/bin/env bash
# Run from an exact, clean detached checkout, with this package outside that checkout. No network.
set -euo pipefail
readonly op="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly head=0d577596d14bbd5c4f6eafa48fb9b153ae7ef2ec tree=a2d52f40104ea8cc3162a21b182478d0225ef997
readonly v1=7617caba7f06e4a6b0ab017d31e5c64b73f4a90e v1tree=a640e246e9edd99f4da265f22eeace04fd0ce5ad
readonly prior=01fab2584c11839b0fefbaecb1edf75d31f92b68 priortree=c7650e6b01610087ebc3aaefe063ee259a341c17
readonly incumbent=22867cbcfaee27b2e8917b6bf880e44827f67b60 logo=08797524f21b946246a535d5a614400a0f946be6
readonly feed='apps/web/app/(public)/feeds/openai-products.csv.gz/route.ts' private='data/knowledge/encyclopedia/calculation-v1.json'
[[ $# == 0 ]]
[[ "$(git rev-parse --show-prefix)" == "" ]]
[[ "$(git rev-parse HEAD)" == "$head" && "$(git rev-parse 'HEAD^{tree}')" == "$tree" ]]
[[ "$(git show -s --format=%P HEAD)" == "$v1" && "$(git rev-parse "$v1^{tree}")" == "$v1tree" ]]
[[ "$(git show -s --format=%P "$v1")" == "$prior" && "$(git rev-parse "$prior^{tree}")" == "$priortree" ]]
[[ "$(git show -s --format=%P "$prior")" == "$logo" && "$(git show -s --format=%P "$logo")" == "$incumbent" ]]
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]]
prove_delta() {
  local from="$1" to="$2" manifest="$3" status sha path
  diff -u <(git -c core.quotepath=false diff --name-status --no-renames "$from" "$to" | LC_ALL=C sort) <(cut -f1,3 "$manifest" | LC_ALL=C sort)
  while IFS=$'\t' read -r status sha path; do
    [[ "$status" == A || "$status" == M ]]
    [[ "$sha" =~ ^[a-f0-9]{40}$ && "$(git ls-tree "$to" -- "$path" | cut -f1)" == "100644 blob $sha" ]]
    if [[ "$to" == "$head" ]]; then [[ "$(git hash-object -- "$path")" == "$sha" ]]; fi
  done < "$manifest"
}
prove_delta "$incumbent" "$prior" "$op/BASELINE_APP_FILES.tsv"
prove_delta "$prior" "$head" "$op/APP_DELTA.tsv"
git diff --check "$incumbent" "$head"
git diff --exit-code "$incumbent" "$head" -- Dockerfile .dockerignore data apps/web/public "$feed" .github/workflows docker-compose.yml
[[ "$(git hash-object Dockerfile)" == 55ec9a48c960a13d14e1f9006cb9baabbd0025e4 ]]
[[ "$(git hash-object .dockerignore)" == 2dac30e94b2db9eb54656ffc5b99211888c32fc3 ]]
[[ "$(git hash-object -- "$feed")" == a2f36c66a857640cf474151640ae6beb9bedbd04 ]]
if git cat-file -e "$head:$private" 2>/dev/null || [[ -e "$private" || -L "$private" ]]; then
  echo 'private_index_must_not_enter_build_context' >&2
  exit 1
fi
printf 'Exact clean source verified: %s (%s)\n' "$head" "$tree"
