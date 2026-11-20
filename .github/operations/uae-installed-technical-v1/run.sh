#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 0 && "$GITHUB_REPOSITORY" == jeep-jim/AvtoCena && "$GITHUB_REPOSITORY_ID" == 1289722938 && "$GITHUB_REF" == refs/heads/main && "$GITHUB_RUN_ATTEMPT" == 1 ]]
readonly known="$GITHUB_WORKSPACE/docs/operations/regcloud-staging-known-hosts"
readonly dir="$GITHUB_WORKSPACE/.github/operations/uae-installed-technical-v1"
printf '%s  %s\n' fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c "$known" | sha256sum --check --status
scratch=$(mktemp -d "${RUNNER_TEMP:?}/uae-index-verify.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
printf '%s\n' "${SSH_PRIVATE_KEY:?}" > "$scratch/key"
unset SSH_PRIVATE_KEY
encoded=$(base64 -w0 "$dir/host.py")
[[ "$encoded" =~ ^[A-Za-z0-9+/]+={0,2}$ && "${#encoded}" -le 16384 ]]
# The remote wrapper is only an in-memory program; stdin is separately sealed JS.
timeout 70s ssh -F /dev/null -T -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o GlobalKnownHostsFile=/dev/null \
  -o UpdateHostKeys=no -o ConnectTimeout=10 -o ClearAllForwardings=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=2 \
  root@151.248.113.177 "/usr/bin/python3 -I -B -c 'import sys,base64; exec(compile(base64.b64decode(sys.argv[1],validate=True),\"pinned_readonly\",\"exec\"))' '$encoded'" < "$dir/observe.mjs"
