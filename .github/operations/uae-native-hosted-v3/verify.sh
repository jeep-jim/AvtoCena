#!/usr/bin/env bash
set -euo pipefail
readonly base=22867cbcfaee27b2e8917b6bf880e44827f67b60
readonly first=23754a2d678388435f7c93090172ed3b1fe16649 first_tree=9ff2f1f4aa61bffb211376469372f1dd0febdb25
readonly guard=f2e1fa4044aeb33ad115fd9cfab0edf7f17c498f guard_tree=4f6eaf1de4d19d02594bb08d39bd9c044da2da43
readonly page='apps/web/app/(public)/cars/offer/[id]/page.tsx' content='apps/web/components/catalog/CatalogContent.tsx'
readonly prior_content=88a79822f1d462a9417f4a1110d6f1a08117c6b1
readonly previous_page=ad48bd085129f6a1836358143114306e1ad1b3a7
readonly caller="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly app="${UAE_APP_SHA:?}" tree="${UAE_APP_TREE:?}"
for hash in "$app" "$tree"; do [[ "$hash" =~ ^[0-9a-f]{40}$ ]]; done
test "$(git rev-parse HEAD)" = "$app"
test "$(git rev-parse 'HEAD^{tree}')" = "$tree"
test "$(git show -s --format=%P HEAD)" = "$guard"
test "$(git show -s --format=%P "$guard")" = "$first"
test "$(git rev-parse "$guard^{tree}")" = "$guard_tree"
test "$(git rev-parse "$guard:$content")" = "$prior_content"
cmp -s <(git diff-tree --no-commit-id --no-renames --name-status -r -z "$guard" "$app") <(printf 'M\0%s\0' "$content")
test "$(git show -s --format=%P "$first")" = "$base"
test "$(git rev-parse "$first^{tree}")" = "$first_tree"
test "$(git rev-parse "$first:$page")" = "$previous_page"
cmp -s <(git diff-tree --no-commit-id --no-renames --name-status -r -z "$first" "$guard") <(printf 'M\0%s\0' "$page")
test -z "$(git status --porcelain)"
cmp -s <(git diff-tree --no-commit-id --no-renames --name-status -r -z "$base" "$app") <(
 while IFS=$'\t' read -r status sha path; do printf '%s\0%s\0' "$status" "$path"; done < "$caller/APP_FILES.tsv"
)
while IFS=$'\t' read -r status sha path; do
 [[ "$sha" =~ ^[0-9a-f]{40}$ && ("$status" = A || "$status" = M) ]]
 test "$(git ls-tree "$app" -- "$path" | cut -f1)" = "100644 blob $sha"
 test "$(git hash-object -- "$path")" = "$sha"
done < "$caller/APP_FILES.tsv"
git diff --check "$base" "$app"
test "$(git rev-parse HEAD:scripts/catalog-calculation-version.mjs)" = 63c9323ac7a0ddf267a725443ca2316c197cc7d8
build_calc="$(node scripts/catalog-calculation-version.mjs)"
[[ "$build_calc" =~ ^[0-9a-f]{64}$ ]]
printf 'uae_exact_source_verified release=%s tree=%s build_calc=%s (source build identity only)\n' "$app" "$tree" "$build_calc"

npm ci --ignore-scripts --no-audit --no-fund
npm --workspace=@avtocena/web exec tsc -- --noEmit --incremental false
npm --workspace=@avtocena/engine exec tsc -- --noEmit --incremental false
export TSX_TSCONFIG_PATH=apps/web/tsconfig.json
JSON_STORAGE_DRIVER=local node --import tsx --import ./tests/helpers/offline-fetch.mjs --test --test-concurrency=1 \
 tests/uae-regcloud-object-reader.test.ts tests/catalog-china-common-grid.test.ts tests/catalog-china-default-showcase.test.ts \
 "$caller/catalog-cut-wire.test.mjs"
node --test "$caller/prepare-uae-excluded-ai-feed.test.mjs"

readonly isolated="$(mktemp -d "${RUNNER_TEMP:?}/uae-fixture.XXXXXXXX")" id="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ "$id" =~ ^[0-9]+-1$ ]]
readonly net="uae-native-fixture-$id" container="uae-candidate-fixture-$id"
readonly tmp_test=tests/.uae-hosted-carrier-proof.mts tmp_ai=tests/.uae-native-ai-compatibility.test.ts tmp_asm=tests/prepare-uae-excluded-ai-feed.mjs
net_created=0 app_created=0 inputs_copied=0
cleanup(){
 if [[ "$app_created" = 1 ]]; then docker rm -f "$container" >/dev/null || true; fi
 if [[ "$net_created" = 1 ]]; then docker network rm "$net" >/dev/null || true; fi
 if [[ "$inputs_copied" = 1 ]]; then rm -f -- "$tmp_test" "$tmp_ai" "$tmp_asm"; fi
 rm -rf -- "$isolated"
}
trap cleanup EXIT
node "$caller/make-fixture.mjs" "$isolated"
readonly package_hash="$(cat "$isolated/objects.sha256")"
[[ "$package_hash" =~ ^[0-9a-f]{64}$ ]]
test ! -e "$tmp_test" && test ! -e "$tmp_ai" && test ! -e "$tmp_asm"
inputs_copied=1
cp "$caller/native-fixture-proof.mts" "$tmp_test"
cp "$caller/native-ai-feed-compatibility.test.ts" "$tmp_ai"
cp "$caller/prepare-uae-excluded-ai-feed.mjs" "$tmp_asm"
JSON_STORAGE_DRIVER=local node --import tsx --import ./tests/helpers/offline-fetch.mjs --test "$tmp_ai"
readonly -a fixture_env=(
 JSON_STORAGE_DRIVER=object YC_OBJECT_STORAGE_ENDPOINT=https://s3.regru.cloud
 YC_OBJECT_STORAGE_BUCKET=fixture-uae YC_OBJECT_STORAGE_PREFIX=fixture-uae
 YC_OBJECT_STORAGE_ACCESS_KEY_ID=fixture YC_OBJECT_STORAGE_SECRET_ACCESS_KEY=fixture
 UAE_FIXTURE_STORAGE_SHA256="$package_hash" AVTOCENA_UAE_REGCLOUD_RUNTIME=1
)
env "${fixture_env[@]}" UAE_FIXTURE_STORAGE_PACKAGE="$isolated/objects.json" \
 EXPECTED_FIXTURE="$isolated/expected.json" node --import tsx --import "$caller/isolate-regcloud-fixture-fetch.mjs" "$tmp_test"
rm -- "$tmp_test" "$tmp_ai" "$tmp_asm"
inputs_copied=0
test -z "$(git status --porcelain)"

readonly tag="avtocena-uae-hosted:$app"
docker build --label "org.opencontainers.image.revision=$app" --label avtocena.verification=uae-native-no-secret -t "$tag" .
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$tag")" = "$app"
readonly image="$(docker image inspect --format '{{.Id}}' "$tag")"
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
printf 'uae_compile_only release=%s image_id=%s\n' "$app" "$image"

readonly chrome="$(command -v google-chrome || command -v chromium)"
test -x "$chrome"
npm install --prefix "$isolated/browser-deps" --no-package-lock --ignore-scripts --no-audit --no-fund playwright@1.55.0
install -m 0600 "$caller/isolate-regcloud-fixture-fetch.mjs" "$isolated/isolated-fetch.mjs"
docker network create --internal --driver bridge "$net" >/dev/null
net_created=1
test "$(docker network inspect -f '{{.Internal}}' "$net")" = true
declare -a docker_env=( -e HOSTNAME=0.0.0.0 -e 'AUTH_SECRET=fixture-uae-local-not-a-production-secret-v1'
 -e NODE_OPTIONS=--import=/run/uae-fixture/isolated-fetch.mjs
 -e UAE_FIXTURE_STORAGE_PACKAGE=/run/uae-fixture/objects.json )
for pair in "${fixture_env[@]}"; do docker_env+=( -e "$pair" ); done
docker run --detach --name "$container" --restart=no --network "$net" --dns 127.0.0.1 --pids-limit=512 --memory=4g --memory-swap=4g \
 --mount "type=bind,src=$isolated/objects.json,dst=/run/uae-fixture/objects.json,readonly" \
 --mount "type=bind,src=$isolated/isolated-fetch.mjs,dst=/run/uae-fixture/isolated-fetch.mjs,readonly" \
 "${docker_env[@]}" "$image" >/dev/null
app_created=1
test "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$container")" = 0
test "$(docker inspect -f '{{len .NetworkSettings.Networks}}' "$container")" = 1
readonly ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")"
[[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
readonly url="http://$ip:3000"
up=0
for _ in {1..24}; do
 if curl --noproxy '*' --fail --silent --max-time 2 --output /dev/null "$url/api/health"; then up=1; break; fi
 sleep 1
done
test "$up" = 1
UAE_TEST_INTERNAL_ORIGIN="$url" CHROME_BIN="$chrome" PLAYWRIGHT_MODULE="$isolated/browser-deps/node_modules/playwright/index.mjs" \
 node "$caller/browser-uae-ready.mjs" "$url" "$isolated/expected.json"
printf '{"status":"hosted_source_compile_browser_fixture","release":"%s","testStorageOnly":true,"hostWrites":0,"storageWrites":0,"imageExported":false,"customerActivation":false,"realPhotoBytesFetched":false}\n' "$app"
