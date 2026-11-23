#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 0 ]]
readonly repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Repeat the actual Git/event proof immediately before handling the SSH key.
# No caller-supplied "verified" flag can bypass this entrypoint.
node "$repo/.github/operations/home-ui-only-20261123/assert-invocation.mjs" > /dev/null
readonly source="$repo/.github/operations/home-ui-only-20261123/inventory.py"
readonly known="$repo/docs/operations/regcloud-staging-known-hosts"
printf '%s  %s\n' \
  'f9ba6713f076c211f5ac75086a83021383f06a1c231c158edffa7a51db1092f0' "$source" \
  'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c' "$known" \
  | sha256sum --check --status
scratch="$(mktemp -d -- "${RUNNER_TEMP:?}/home-ui-readonly-inventory.XXXXXXXX")"
readonly scratch
trap 'rm -rf -- "$scratch"' EXIT
printf '%s\n' "${SSH_PRIVATE_KEY:?}" > "$scratch/key"
unset SSH_PRIVATE_KEY
# Only reviewed source enters stdin. There is no SCP, remote file creation,
# container mutation, source collection, environment dump or ingress command.
timeout 240s /usr/bin/ssh -F /dev/null -T -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o GlobalKnownHostsFile=/dev/null \
  -o UpdateHostKeys=no -o ConnectTimeout=10 -o ClearAllForwardings=yes \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  root@151.248.113.177 '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -' < "$source"
