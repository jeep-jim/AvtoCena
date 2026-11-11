#!/usr/bin/env bash
# Runner-side browser acceptance while the VM still retains its rollback trap.
set -euo pipefail
node scripts/verify-frozen-speed-baselines.mjs
key_file=$1
release=$2
calculator=$3
scope=${4:-}
[[ "$release" =~ ^[a-f0-9]{40}$ && "$calculator" =~ ^[a-f0-9]{64}$ ]]
test -s "$key_file"
nonce=$(python3 -c 'import uuid;print(uuid.uuid4().hex)')
runtime="/opt/avtocena/releases/$release"
ssh_opts=(-i "$key_file" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$GITHUB_WORKSPACE/docs/operations/regcloud-staging-known-hosts")
job_dir=$(mktemp -d)
remote_done=0
deploy_pid=
send_verdict(){
 scp "${ssh_opts[@]}" "$job_dir/verdict.json" "root@151.248.113.177:$runtime/browser-verdict-$nonce.tmp"
 ssh "${ssh_opts[@]}" root@151.248.113.177 "mv '$runtime/browser-verdict-$nonce.tmp' '$runtime/browser-verdict-$nonce.json'"
}
cleanup(){
 status=$?
 trap - EXIT INT TERM HUP
 if [ "$remote_done" = 0 ]; then
  python3 - "$release" "$nonce" "$job_dir/verdict.json" <<'CANCEL'
import json,sys
json.dump({'schemaVersion':1,'release':sys.argv[1],'nonce':sys.argv[2],'passed':False,'functionalPassed':False,'speedPassed':False},open(sys.argv[3],'w'))
CANCEL
  send_verdict || true
  if [ -n "$deploy_pid" ]; then kill "$deploy_pid" 2>/dev/null || true; fi
 fi
 rm -rf -- "$job_dir"
 exit "$status"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP
ssh "${ssh_opts[@]}" root@151.248.113.177 "AVTOCENA_BROWSER_NONCE='$nonce' bash '$runtime/regcloud-deploy-production.sh' '$release' '$calculator' 1 '$scope'" &
deploy_pid=$!
ready=0
deadline=$((SECONDS+2400))
while kill -0 "$deploy_pid" 2>/dev/null; do
 if ssh "${ssh_opts[@]}" root@151.248.113.177 "test -s '$runtime/browser-ready-$nonce.json' && cat '$runtime/browser-ready-$nonce.json'" > "$job_dir/ready.json"; then
  python3 - "$job_dir/ready.json" "$release" "$nonce" <<'READY'
import json,sys
v=json.load(open(sys.argv[1]))
assert v['release']==sys.argv[2] and v['nonce']==sys.argv[3] and v['phase']=='post-switch-server-passed'
READY
  ready=1
  break
 fi
 if [ "$SECONDS" -ge "$deadline" ]; then echo 'Browser acceptance preparation deadline'; exit 1; fi
 sleep 10
done
if [ "$ready" != 1 ]; then
 set +e
 wait "$deploy_pid"
 status=$?
 set -e
 remote_done=1
 test "$status" != 0 || status=1
 exit "$status"
fi
python3 - "$release" "$job_dir/marker.json" <<'MARKER'
import json,sys
json.dump({'release':sys.argv[1],'phase':'release-required-browser-gate','verifyPartnerBudgets':False,'enforceSpeed':True},open(sys.argv[2],'w'))
MARKER
set +e
OWNER_FILTER_BROWSER_MARKER="$job_dir/marker.json" CHROME_BIN="$(command -v google-chrome)" node tests/browser/owner-filter-speed-live.mjs
browser_status=$?
set -e
python3 - "$release" "$nonce" "$browser_status" "$job_dir/verdict.json" <<'VERDICT'
import hashlib,json,pathlib,sys
p=pathlib.Path('owner-filter-browser-report.json')
raw=p.read_bytes() if p.exists() else b'{}'
try:r=json.loads(raw)
except ValueError:r={}
functional=r.get('browserPassed') is True
speed=r.get('speedGuard',{}).get('passed') is True
passed=sys.argv[3]=='0' and r.get('release')==sys.argv[1] and r.get('passed') is True and functional and speed
json.dump({'schemaVersion':1,'release':sys.argv[1],'nonce':sys.argv[2],'passed':passed,'functionalPassed':functional,'speedPassed':speed,'reportSha256':hashlib.sha256(raw).hexdigest()},open(sys.argv[4],'w'))
VERDICT
send_verdict
set +e
wait "$deploy_pid"
deploy_status=$?
set -e
remote_done=1
test "$browser_status" = 0
test "$deploy_status" = 0
