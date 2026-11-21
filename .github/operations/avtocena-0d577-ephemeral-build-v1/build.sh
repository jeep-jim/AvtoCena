#!/usr/bin/env bash
# Intended for a fresh hosted runner only. No artifact/export, SSH, secrets, run or push.
set -euo pipefail
umask 077
readonly app=0d577596d14bbd5c4f6eafa48fb9b153ae7ef2ec tree=a2d52f40104ea8cc3162a21b182478d0225ef997
readonly op="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ $# == 0 && "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
[[ "$GITHUB_REPOSITORY" == jeep-jim/AvtoCena && "$GITHUB_REPOSITORY_ID" == 1289722938 && "$GITHUB_RUN_ATTEMPT" == 1 ]]
bash "$op/verify-source.sh"
readonly calc="$(node scripts/catalog-calculation-version.mjs)"
[[ "$calc" =~ ^[a-f0-9]{64}$ ]]
readonly tmp="$(mktemp -d "${RUNNER_TEMP:?}/avtocena-0d577-build.XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
mkdir "$tmp/context"
git archive --format=tar "$app" | tar -xf - -C "$tmp/context"
readonly private=data/knowledge/encyclopedia/calculation-v1.json
[[ ! -e "$tmp/context/$private" && ! -L "$tmp/context/$private" && ! -e "$tmp/context/.git" ]]
[[ "$(git hash-object -- "$tmp/context/Dockerfile")" == 55ec9a48c960a13d14e1f9006cb9baabbd0025e4 ]]
printf '%s\n' 'Full source gate passed; resolving official amd64 build base.'
if ! docker pull --platform linux/amd64 docker.io/library/node:24.22.1-alpine >"$tmp/base.log" 2>&1; then
  echo 'ephemeral_official_base_pull_failed'; exit 1
fi
readonly base="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' docker.io/library/node:24.22.1-alpine | grep -E '^(docker\.io/library/)?node@sha256:[a-f0-9]{64}$')"
[[ "$base" =~ ^(docker\.io/library/)?node@sha256:[a-f0-9]{64}$ ]]
readonly base_digest="${base##*@}"
python3 "$op/image-proof.py" dockerfile "$tmp/context/Dockerfile" "$base_digest" > "$tmp/Dockerfile"
readonly derivation="$(sha256sum "$tmp/Dockerfile" | cut -d' ' -f1)"
readonly tag="avtocena-regcloud:$app"
printf '%s\n' 'Starting full ephemeral container build (application compilation network-disabled).'
if ! DOCKER_BUILDKIT=1 docker build --platform linux/amd64 --pull=false --progress plain --file "$tmp/Dockerfile" \
  --label "org.opencontainers.image.revision=$app" --label "com.avtocena.app-tree=$tree" \
  --label "com.avtocena.build-calculation=$calc" --label 'com.avtocena.artifact=ephemeral-build-only-v1' \
  --tag "$tag" "$tmp/context" >"$tmp/build.log" 2>&1; then
  # The public Actions record must not include raw logs, environment or data bodies.
  case_name=unclassified
  if grep -Eiq 'heap out of memory|outofmemory|SIGKILL|exit code: 137' "$tmp/build.log"; then case_name=resource_limit
  elif grep -Eiq 'Type error:|Failed to compile' "$tmp/build.log"; then case_name=application_compile
  elif grep -Eiq 'npm error code E|temporary failure in name resolution|TLS handshake timeout' "$tmp/build.log"; then case_name=dependency_or_network
  fi
  printf 'ephemeral_full_build_failed:%s\n' "$case_name"
  exit 1
fi
docker image inspect "$tag" > "$tmp/inspect.json"
python3 "$op/image-proof.py" proof "$tmp/inspect.json" "$calc" >"$tmp/proof.json"
APP="$app" TREE="$tree" CALC="$calc" BASE_DIGEST="$base_digest" DOCKERFILE_DIGEST="$derivation" python3 - "$tmp/proof.json" <<'PY'
import json,os,sys
e=os.environ
x=json.load(open(sys.argv[1]))
x.update(status="exact_full_container_build_ephemeral", app=e["APP"], tree=e["TREE"],
         buildCalculation=e["CALC"], nodeBaseDigest=e["BASE_DIGEST"], effectiveDockerfileSha256=e["DOCKERFILE_DIGEST"],
         buildImageExported=False, appStarted=False, hostTouched=False, privateIndexIncluded=False,
         runtimeParityVerified=False, deployAuthorized=False, operatorCommit=e["GITHUB_SHA"], runId=int(e["GITHUB_RUN_ID"]))
print(json.dumps(x,sort_keys=True,separators=(",",":")))
PY
