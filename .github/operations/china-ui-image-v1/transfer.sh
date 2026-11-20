#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$GITHUB_REPOSITORY" == jeep-jim/AvtoCena && "$GITHUB_REPOSITORY_ID" == 1289722938 && "$GITHUB_RUN_ID" =~ ^[0-9]{1,20}$ && "$GITHUB_RUN_ATTEMPT" == 1 ]]
[[ "$APP_SHA" =~ ^[a-f0-9]{40}$ && "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ && "$LOAD_SHA256" =~ ^[a-f0-9]{64}$ ]]
readonly known="$GITHUB_WORKSPACE/docs/operations/regcloud-staging-known-hosts"
readonly remote="$GITHUB_WORKSPACE/.github/operations/china-ui-image-v1/load-remote.sh"
printf '%s  %s\n' fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c "$known" "$LOAD_SHA256" "$remote" | sha256sum --check --status
scratch=$(mktemp -d "${RUNNER_TEMP:?}/china-ui-image.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
printf '%s\n' "${SSH_PRIVATE_KEY:?}" > "$scratch/key"
unset SSH_PRIVATE_KEY
readonly host=root@151.248.113.177 dir="/opt/avtocena/staging/incoming/china-ui-$GITHUB_RUN_ID-1"
opts=(-F /dev/null -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no -o ClearAllForwardings=yes)
docker save "avtocena-regcloud:$APP_SHA" | gzip -1 > "$scratch/ui.tgz"
test "$(stat -c %s "$scratch/ui.tgz")" -le 4294967296
archive=$(sha256sum "$scratch/ui.tgz" | cut -d' ' -f1)
ssh "${opts[@]}" "$host" "test \$(df --output=avail -k /var/lib/docker | tail -1) -gt 20971520 && mkdir -m 700 '$dir'"
trap 'ssh "${opts[@]}" "$host" "rm -f -- '\''$dir/ui.tgz'\'' && rmdir -- '\''$dir'\''" >/dev/null 2>&1 || true; rm -rf -- "$scratch"' EXIT
scp "${opts[@]}" "$scratch/ui.tgz" "$host:$dir/ui.tgz"
ssh -T "${opts[@]}" "$host" "bash -s -- '$GITHUB_RUN_ID' '$APP_SHA' '$IMAGE_ID' '$archive'" < "$remote"
