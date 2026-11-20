#!/usr/bin/env bash
# Receives private, already uploaded attempt-scoped bytes; does not start an app.
set -euo pipefail
umask 077
[[ $# == 4 && "$1" =~ ^[0-9]{1,20}$ && "$2" =~ ^[a-f0-9]{40}$ && "$3" =~ ^sha256:[a-f0-9]{64}$ && "$4" =~ ^[a-f0-9]{64}$ ]]
readonly dir="/opt/avtocena/staging/incoming/china-ui-$1-1" tag="avtocena-regcloud:$2" image="$3" archive_sha="$4"
[[ -d "$dir" && ! -L "$dir" && -f "$dir/ui.tgz" && ! -L "$dir/ui.tgz" && "$(stat -c %a "$dir")" == 700 ]]
exec 9</run/lock/avtocena-runtime-change.lock
flock -n 9
[[ "$(sha256sum /etc/nginx/conf.d/avtocena-prepare.conf | cut -d' ' -f1)" == 135ccf27648e4410f1ab0d23df9cf87c7866d4ae6ee157466c5546097203478a ]]
[[ "$(df --output=avail -k /var/lib/docker | tail -1)" -gt 16777216 ]]
[[ "$(stat -c %s "$dir/ui.tgz")" -le 4294967296 ]]
printf '%s  %s\n' "$archive_sha" "$dir/ui.tgz" | sha256sum --check --status
if docker image inspect "$tag" >/dev/null 2>&1; then
  [[ "$(docker image inspect --format '{{.Id}}' "$tag")" == "$image" ]]
else
  gzip -dc "$dir/ui.tgz" | docker load >/dev/null
fi
[[ "$(docker image inspect --format '{{.Id}}' "$tag")" == "$image" ]]
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$tag")" == "$2" ]]
[[ "$(sha256sum /etc/nginx/conf.d/avtocena-prepare.conf | cut -d' ' -f1)" == 135ccf27648e4410f1ab0d23df9cf87c7866d4ae6ee157466c5546097203478a ]]
printf '{"status":"exact_image_loaded_only","release":"%s","image":"%s"}\n' "$2" "$image"
