# Operator-only draft. The existing protected regcloud-staging actor must
# inject the previously configured SSH key through SSH_PRIVATE_KEY.
set -euo pipefail
umask 077
[[ $# == 0 && ${GITHUB_REPOSITORY:-} == jeep-jim/AvtoCena && ${GITHUB_REPOSITORY_ID:-} == 1289722938 ]]
readonly repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly source="${repo}/.github/operations/avtocena-haval-capacity-readonly-v2/preflight.py"
readonly known="${repo}/docs/operations/regcloud-staging-known-hosts"
# Trust only the already approved host key, no ssh-keyscan or first-use trust.
printf '%s  %s\n' 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c' "$known" | sha256sum --check --status
scratch="$(mktemp -d -- "${RUNNER_TEMP:?}/avtocena-filter-capacity-readback.XXXXXXXX")"
readonly scratch
trap 'rm -rf -- "$scratch"' EXIT
printf '%s\n' "${SSH_PRIVATE_KEY:?}" > "$scratch/key"
unset SSH_PRIVATE_KEY
# Send code on stdin, not SCP. No remote file creation, no write verb,
# no workflow artifact, no host env injection and no secret/config output.
timeout 30s ssh -F /dev/null -T -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known" -o GlobalKnownHostsFile=/dev/null \
  -o UpdateHostKeys=no -o ConnectTimeout=10 -o ClearAllForwardings=yes \
  root@151.248.113.177 '/usr/bin/python3 -I -B -' < "$source"
