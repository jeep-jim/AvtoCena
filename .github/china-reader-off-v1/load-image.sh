#!/usr/bin/env bash
# Optional load only. No production process launch, config edit, or restart.
set -euo pipefail
umask 077
[[ "$APP_SHA" =~ ^[a-f0-9]{40}$ && "$OLD_SHA" =~ ^[a-f0-9]{40}$ && "$OLD_CALCULATOR" =~ ^[a-f0-9]{64}$ && "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ && "$GITHUB_RUN_ID" =~ ^[0-9]{1,20}$ && "$GITHUB_RUN_ATTEMPT" = 1 ]]
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$staging/key"
unset SSH_PRIVATE_KEY
test -s "$staging/key"
opts=(-i "$staging/key" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$GITHUB_WORKSPACE/docs/operations/regcloud-staging-known-hosts")
image="avtocena-regcloud:$APP_SHA"
incoming="/opt/avtocena/staging/incoming/china-off-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
docker save "$image" | gzip -1 > "$staging/reader.tgz"
(cd "$staging" && sha256sum reader.tgz > reader.tgz.sha256)
ssh "${opts[@]}" root@151.248.113.177 "test \$(df --output=avail -k / | tail -1) -gt 8388608; mkdir -m 700 '$incoming'"
if ! scp "${opts[@]}" "$staging/reader.tgz" "$staging/reader.tgz.sha256" "root@151.248.113.177:$incoming/"; then
  # Only this attempt's newly created private transfer directory.
  ssh "${opts[@]}" root@151.248.113.177 "rm -f -- '$incoming/reader.tgz' '$incoming/reader.tgz.sha256'; rmdir '$incoming'" || true
  exit 1
fi
ssh "${opts[@]}" root@151.248.113.177 "bash -s -- '$incoming' '$APP_SHA' '$OLD_SHA' '$OLD_CALCULATOR' '$IMAGE_ID'" <<'REMOTE'
set -euo pipefail
incoming=$1 app=$2 old=$3 calculator=$4 image_id=$5
cd "$incoming"
trap 'rm -f -- "$incoming/reader.tgz" "$incoming/reader.tgz.sha256"; rmdir "$incoming" || true' EXIT
exec 9>/run/lock/avtocena-runtime-change.lock
flock -n 9
test -e /opt/avtocena/PRODUCTION_ACTIVE
old_id=$(docker inspect --format '{{.Id}}' avtocena-production)
test "$(docker inspect --format '{{.State.Running}}' "$old_id")" = true
test "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$old_id")" = "$old"
test "$(docker inspect --format '{{json .Config.Env}}' "$old_id" | python3 -c 'import json,sys; d=dict(s.split("=",1) for s in json.load(sys.stdin)); print("armed" if d.get("AVTOCENA_CHINA_REGCLOUD_RUNTIME")=="1" else "off")')" = off
health() {
  curl --fail --silent --show-error --max-time 15 --max-filesize 8192 --resolve avtocena.com:443:127.0.0.1 https://avtocena.com/api/health | \
    python3 -c 'import json,sys;v=json.load(sys.stdin);assert v["ok"] is True and v["releaseSha"]==sys.argv[1] and v["calculationVersion"]==sys.argv[2]' "$old" "$calculator"
}
health
sha256sum -c reader.tgz.sha256
image="avtocena-regcloud:$app"
if docker image inspect "$image" >/dev/null 2>&1; then
  test "$(docker image inspect --format '{{.Id}}' "$image")" = "$image_id"
else
  gzip -dc reader.tgz | docker load
fi
test "$(docker image inspect --format '{{.Id}}' "$image")" = "$image_id"
test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" = "$app"
test "$(docker inspect --format '{{.Id}}' avtocena-production)" = "$old_id"
health
echo "Loaded exact image $image_id while incumbent $old remains active; no application activation"
REMOTE
