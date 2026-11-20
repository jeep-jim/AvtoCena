#!/usr/bin/env bash
set -euo pipefail
umask 077
dest=$1
[[ -d "$dest" && -n "${GH_TOKEN:-}" ]]
api='repos/jeep-jim/AvtoCena/actions/artifacts/14584484747'
# stdout only to private files; no SAS URLs, API responses, stderr, or rows in CI logs.
timeout --kill-after=5s 35s gh api "$api" 2>"$dest/artifact-meta.stderr" | head -c 65537 > "$dest/artifact-meta.json"
python3 - "$dest/artifact-meta.json" <<'PY'
import json,pathlib,sys
f=pathlib.Path(sys.argv[1]); assert 0<f.stat().st_size<=65536
m=json.loads(f.read_bytes()); w=m['workflow_run']
assert m['name']=='catalog-intake-europe' and m['id']==14584484747 and m['expired'] is False and m['size_in_bytes']==26541591
assert m['digest']=='sha256:d822258671996030c53e934adfd3b48136243241f4f442b62172728b50319316'
assert m['archive_download_url']=='https://api.github.com/repos/jeep-jim/AvtoCena/actions/artifacts/14584484747/zip'
assert w['id']==44637245131 and w['repository_id']==1289722938 and w['head_repository_id']==1289722938
assert w['head_sha']=='15f51970fb68555ad56b7c40f622517a15643377' and w['head_branch']=='main'
PY
timeout --kill-after=5s 90s gh api "$api/zip" 2>"$dest/artifact-download.stderr" | head -c 26541592 > "$dest/original.zip"
[[ "$(stat -c %s "$dest/original.zip")" == 26541591 ]]
[[ "$(sha256sum "$dest/original.zip" | awk '{print $1}')" == d822258671996030c53e934adfd3b48136243241f4f442b62172728b50319316 ]]
