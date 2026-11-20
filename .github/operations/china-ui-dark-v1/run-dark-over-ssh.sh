#!/usr/bin/env bash
# Root may wire this only into separately authorized dark-boot workflow; no cutover.
set -euo pipefail
umask 077
[[ $# == 0 && "$GITHUB_REPOSITORY" == jeep-jim/AvtoCena && "$GITHUB_REPOSITORY_ID" == 1289722938 && "$GITHUB_RUN_ATTEMPT" == 1 ]]
[[ "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ && "$STANDALONE_SHA256" =~ ^[a-f0-9]{64}$ ]]
readonly known="$GITHUB_WORKSPACE/docs/operations/regcloud-staging-known-hosts"
readonly script="$GITHUB_WORKSPACE/.github/operations/china-ui-dark-v1/dark-standalone.py"
readonly build=672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761
printf '%s  %s\n' fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c "$known" "$STANDALONE_SHA256" "$script" | sha256sum --check --status
scratch=$(mktemp -d "${RUNNER_TEMP:?}/china-ui-dark.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
printf '%s\n' "${SSH_PRIVATE_KEY:?}" > "$scratch/key"
unset SSH_PRIVATE_KEY
timeout 210s ssh -F /dev/null -T -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o GlobalKnownHostsFile=/dev/null \
  -o UpdateHostKeys=no -o ConnectTimeout=10 -o ClearAllForwardings=yes \
  root@151.248.113.177 "/usr/bin/python3 -I -B - '$IMAGE_ID' '$build'" < "$script"
