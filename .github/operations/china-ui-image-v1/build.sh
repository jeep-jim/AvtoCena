#!/usr/bin/env bash
set -euo pipefail
readonly base=85296f6b8797aaa93227b69da7e9e9e928e8f9b5
[[ "${APP_SHA:?}" =~ ^[a-f0-9]{40}$ && "${DIFF_SHA256:?}" =~ ^[a-f0-9]{64}$ && "$APP_SHA" != "$base" ]]
[[ "$(git rev-parse HEAD)" == "$APP_SHA" && "$(git show -s --format=%P HEAD)" == "$base" ]]
[[ -z "$(git status --porcelain=v1 --untracked-files=normal)" ]]
digest="$(git --no-pager diff --no-ext-diff --no-renames --no-textconv --binary --full-index "$base" "$APP_SHA" -- | sha256sum | cut -d' ' -f1)"
[[ "$digest" == "$DIFF_SHA256" ]]
# UI reader libraries change the conservative source graph, not the serving calculation namespace. Exact tree allowlist and diff bind this build.
readonly expected_source_calculation=672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761
# No app price engine, dependency, policy, provider or storage-writer changes.
git diff --exit-code "$base" "$APP_SHA" -- packages data scripts Dockerfile package.json package-lock.json ':(glob)apps/web/lib/catalog/*pric*'
npm ci --ignore-scripts --no-audit --no-fund
[[ "$(node scripts/catalog-calculation-version.mjs)" == "$expected_source_calculation" ]]
npm run typecheck
node --import tsx --test tests/catalog-china-common-grid.test.ts
