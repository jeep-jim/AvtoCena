#!/usr/bin/env bash
set -euo pipefail
readonly app=a10e3a26f9a681cbc5b56b0c8f45f1499935a405
readonly base=22867cbcfaee27b2e8917b6bf880e44827f67b60
readonly tree=af92475a9a8e6d377e0eddc87f3fdf54c92c19a0
readonly diff=b6df0c445b1f147458267f53ce7e5899f45e98b5a8b343ba21385c027fa023bf
readonly codecalc=a0781b738f62ee7a9d7d64c19d0df0aab8e31b38bee17d1789043c7f5556ac7b
test "$(git rev-parse HEAD)" = "$app"
test "$(git show -s --format=%P HEAD)" = "$base"
test "$(git rev-parse HEAD^{tree})" = "$tree"
test -z "$(git status --porcelain)"
cmp -s <(git diff-tree --no-commit-id -r --name-status --no-renames -z "$base" "$app") <(printf '%s\0' \
 M apps/web/app/layout.tsx \
 M apps/web/components/crm/CrmThemeToggle.tsx \
 M apps/web/components/layout/PublicHeader.tsx \
 A apps/web/lib/theme/browser-theme.ts \
 A apps/web/lib/theme/use-site-theme.ts \
 A tests/browser-theme.test.ts)
test "$(git --no-pager diff --no-ext-diff --no-renames --no-textconv --binary --full-index "$base" "$app" -- | sha256sum | cut -d' ' -f1)" = "$diff"
test "$(node scripts/catalog-calculation-version.mjs)" = "$codecalc"
git diff --check "$base" "$app"
npm ci --ignore-scripts --no-audit --no-fund
npm --workspace=@avtocena/web exec tsc -- --noEmit --incremental false
npm --workspace=@avtocena/engine exec tsc -- --noEmit --incremental false
node --import tsx --test tests/browser-theme.test.ts tests/catalog-china-common-grid.test.ts tests/catalog-china-default-showcase.test.ts
test -z "$(git status --porcelain)"
printf 'theme_source_verified release=%s tree=%s build_calc=%s\n' "$app" "$tree" "$codecalc"
