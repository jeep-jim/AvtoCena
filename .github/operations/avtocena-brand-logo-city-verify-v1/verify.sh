#!/usr/bin/env bash
set -euo pipefail
readonly APP=08797524f21b946246a535d5a614400a0f946be6 TREE=1ac7bd77c9fd66288b502e3762d38baa8214bf1a BASE=22867cbcfaee27b2e8917b6bf880e44827f67b60
readonly op="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test "$(git rev-parse HEAD)" = "$APP"; test "$(git rev-parse 'HEAD^{tree}')" = "$TREE"; test "$(git show -s --format=%P HEAD)" = "$BASE"
test -z "$(git status --porcelain)"
cmp -s <(git diff-tree --no-commit-id --no-renames --name-status -r -z "$BASE" "$APP") <(
 while IFS=$'\t' read -r status sha path; do printf '%s\0%s\0' "$status" "$path"; done < "$op/APP_FILES.tsv")
while IFS=$'\t' read -r status sha path; do
 [[ "$status" == M && "$sha" =~ ^[0-9a-f]{40}$ ]]
 test "$(git ls-tree "$APP" -- "$path" | cut -f1)" = "100644 blob $sha"
 test "$(git hash-object -- "$path")" = "$sha"
done < "$op/APP_FILES.tsv"
git diff --check "$BASE" "$APP"
npm ci --ignore-scripts --no-audit --no-fund
npm --workspace=@avtocena/web exec tsc -- --noEmit --incremental false
export TSX_TSCONFIG_PATH=apps/web/tsconfig.json
JSON_STORAGE_DRIVER=local node --import tsx --import ./tests/helpers/offline-fetch.mjs --test --test-concurrency=1 \
 tests/catalog-brand-navigation.test.ts "$op/logo-nav-wiring.test.mjs" tests/catalog-china-common-grid.test.ts
readonly temp="$(mktemp -d "${RUNNER_TEMP:?}/brand-fixture.XXXXXXXX")" id="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ "$id" =~ ^[0-9]+-1$ ]]
readonly net="brand-fixture-internal-$id" container="brand-fixture-app-$id"
created_net=0 created_app=0 copied_source=0
readonly temp_source=tests/.brand-hosted-native.mts
cleanup(){
 if [[ "$created_app" == 1 ]]; then docker rm -f "$container" >/dev/null || true; fi
 if [[ "$created_net" == 1 ]]; then docker network rm "$net" >/dev/null || true; fi
 if [[ "$copied_source" == 1 ]]; then rm -f -- "$temp_source"; fi
 rm -rf -- "$temp"
}
trap cleanup EXIT
node "$op/make-brand-fixture.mjs" "$temp"
readonly fixture_sha="$(cat "$temp/objects.sha256")"
[[ "$fixture_sha" =~ ^[0-9a-f]{64}$ ]]
readonly -a fixture_env=(
 JSON_STORAGE_DRIVER=object YC_OBJECT_STORAGE_ENDPOINT=https://s3.regru.cloud
 YC_OBJECT_STORAGE_BUCKET=fixture-uae YC_OBJECT_STORAGE_PREFIX=fixture-uae
 YC_OBJECT_STORAGE_ACCESS_KEY_ID=fixture YC_OBJECT_STORAGE_SECRET_ACCESS_KEY=fixture
 UAE_FIXTURE_STORAGE_SHA256="$fixture_sha" AVTOCENA_CHINA_REGCLOUD_RUNTIME=0 AVTOCENA_UAE_REGCLOUD_RUNTIME=0
)
test ! -e "$temp_source"; cp "$op/native-fixture-proof.mts" "$temp_source"; copied_source=1
env "${fixture_env[@]}" UAE_FIXTURE_STORAGE_PACKAGE="$temp/objects.json" node --import tsx --import "$op/fixture-fetch.mjs" "$temp_source"
rm -- "$temp_source"; copied_source=0
test -z "$(git status --porcelain)"
readonly tag="avtocena-brand-filter-fixture:$APP"
docker build --label "org.opencontainers.image.revision=$APP" --label avtocena.verification=brand-city-no-secret -t "$tag" .
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$tag")" = "$APP"
readonly image="$(docker image inspect --format '{{.Id}}' "$tag")"
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
readonly chrome="$(command -v google-chrome || command -v chromium)"; test -x "$chrome"
npm install --prefix "$temp/browser-deps" --no-package-lock --ignore-scripts --no-audit --no-fund playwright@1.55.0
install -m 0600 "$op/fixture-fetch.mjs" "$temp/fixture-fetch.mjs"
docker network create --internal --driver bridge "$net" >/dev/null; created_net=1
test "$(docker network inspect -f '{{.Internal}}' "$net")" = true
declare -a docker_env=(-e HOSTNAME=0.0.0.0 -e 'AUTH_SECRET=fixture-brand-no-secrets-local-v1' -e NODE_OPTIONS=--import=/run/brand-fixture/fixture-fetch.mjs
 -e UAE_FIXTURE_STORAGE_PACKAGE=/run/brand-fixture/objects.json)
for pair in "${fixture_env[@]}"; do docker_env+=(-e "$pair"); done
docker run --detach --name "$container" --restart=no --network "$net" --dns 127.0.0.1 --pids-limit=512 --memory=4g --memory-swap=4g \
 --mount "type=bind,src=$temp/objects.json,dst=/run/brand-fixture/objects.json,readonly" \
 --mount "type=bind,src=$temp/fixture-fetch.mjs,dst=/run/brand-fixture/fixture-fetch.mjs,readonly" "${docker_env[@]}" "$image" >/dev/null
created_app=1
test "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$container")" = 0
test "$(docker inspect -f '{{len .NetworkSettings.Networks}}' "$container")" = 1
readonly ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")"
[[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
readonly url="http://$ip:3000"
ready=0
for _ in {1..24}; do
 if curl --noproxy '*' --fail --silent --max-time 2 --output /dev/null "$url/api/health"; then ready=1; break; fi
 sleep 1
done
test "$ready" = 1
BRAND_INTERNAL_ORIGIN="$url" CHROME_BIN="$chrome" PLAYWRIGHT_MODULE="$temp/browser-deps/node_modules/playwright/index.mjs" node "$op/browser-brand.mjs" "$url" "$temp/expected.json"
printf '{"status":"hosted_brand_filter_source_compile_browser_fixture","app":"%s","imageExported":false,"productionData":false,"serving":false}\n' "$APP"
