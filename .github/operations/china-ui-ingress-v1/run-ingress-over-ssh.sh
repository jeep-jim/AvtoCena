#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 0 && "$GITHUB_REPOSITORY" == jeep-jim/AvtoCena && "$GITHUB_REPOSITORY_ID" == 1289722938 && "$GITHUB_RUN_ATTEMPT" == 1 && "$GITHUB_RUN_ID" =~ ^[0-9]{1,20}$ ]]
[[ "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ && "$CANDIDATE_ID" =~ ^[a-f0-9]{64}$ && "$STANDALONE_SHA256" =~ ^[a-f0-9]{64}$ && "$AFTER_SHA256" =~ ^[a-f0-9]{64}$ ]]
readonly known="$GITHUB_WORKSPACE/docs/operations/regcloud-staging-known-hosts"
readonly script="$GITHUB_WORKSPACE/.github/operations/china-ui-ingress-v1/ingress-standalone.py"
printf '%s  %s\n' fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c "$known" "$STANDALONE_SHA256" "$script" | sha256sum --check --status
scratch=$(mktemp -d "${RUNNER_TEMP:?}/china-ui-ingress.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
printf '%s\n' "${SSH_PRIVATE_KEY:?}" > "$scratch/key"
unset SSH_PRIVATE_KEY
# Host operation itself bounds HTTP, nginx validation/reload and lock acquisition.
ssh -F /dev/null -T -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o GlobalKnownHostsFile=/dev/null \
  -o UpdateHostKeys=no -o ConnectTimeout=10 -o ClearAllForwardings=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  root@151.248.113.177 "/usr/bin/python3 -I -B - '$GITHUB_RUN_ID' '$IMAGE_ID' '$CANDIDATE_ID' '$AFTER_SHA256'" < "$script"
