#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/avtocena-runtime-change.lock
flock -n 9
old=avtocena-production
candidate=avtocena-runtime-20261012
backup=avtocena-before-memory-20261012
runtime=/opt/avtocena/runtime-memory-20261012
config=/etc/nginx/conf.d/avtocena-prepare.conf
test -e /opt/avtocena/PRODUCTION_ACTIVE
if docker inspect "$candidate" >/dev/null 2>&1; then
 test "$(docker inspect --format '{{.State.Running}}' "$candidate")" = false
 docker rename "$candidate" "$candidate-failed-$(date +%s)"
fi
! docker inspect "$backup" >/dev/null 2>&1
install -d -m 700 "$runtime"
docker inspect "$old" > "$runtime/before.json"
python3 - "$runtime" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);d=json.loads((p/'before.json').read_text())[0]
assert d['State']['Running'] and d['Config']['Labels']['avtocena.role']=='production'
assert not d['Mounts'] and not d['HostConfig']['Privileged']
assert d['HostConfig']['PortBindings']=={'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'3000'}]}
env=d['Config']['Env']; assert not any(e.startswith('NODE_OPTIONS=') for e in env)
assert all('\n' not in e and '\r' not in e for e in env)
(p/'runtime.env').write_text('\n'.join(env+['NODE_OPTIONS=--max-old-space-size=6144'])+'\n')
(p/'image').write_text(d['Image'])
print('Existing image, authentication, storage and integrations preserved; JS heap set to 6144 MiB')
PY
image=$(cat "$runtime/image")
docker run -d --name "$candidate" --label avtocena.role=production \
 --restart unless-stopped --memory 10g --cpus 6 --pids-limit 512 \
 --log-opt max-size=10m --log-opt max-file=3 --env-file "$runtime/runtime.env" \
 -p 127.0.0.1:3001:3000 "$image" >/dev/null
switched=0
committed=0
rollback() {
 if [ "$committed" = 0 ]; then
  if [ "$switched" = 1 ]; then cp -a "$runtime/nginx-before.conf" "$config"; nginx -t && systemctl reload nginx; fi
  docker stop --time 20 "$candidate" >/dev/null || true
  echo 'Candidate stopped; previous production route retained'
 fi
}
trap rollback EXIT
for attempt in $(seq 1 20); do
 if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null; then break; fi
 sleep 1
done
docker exec "$candidate" node -e 'console.log("heapLimitMiB="+require("v8").getHeapStatistics().heap_size_limit/1024/1024)'
python3 - <<'PY'
import urllib.request,time,json
for path in ['/','/cars','/','/api/health']:
 start=time.monotonic()
 with urllib.request.urlopen('http://127.0.0.1:3001'+path,timeout=60) as r:
  body=r.read(); assert r.status==200
 elapsed=time.monotonic()-start
 if path=='/api/health': assert json.loads(body)['ok'] and elapsed<2
 else: assert len(body)>200000 and b'</html>' in body and b'$RX(' not in body
 print(json.dumps({'candidatePath':path,'seconds':round(elapsed,3),'bytes':len(body)}),flush=True)
 if path=='/' and elapsed>30: raise RuntimeError('candidate_home_still_too_slow')
PY
cp -a "$config" "$runtime/nginx-before.conf"
python3 - "$config" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);s=p.read_text();assert s.count('127.0.0.1:3000')==1
p.write_text(s.replace('127.0.0.1:3000','127.0.0.1:3001'))
PY
switched=1
nginx -t
systemctl reload nginx
# Nginx reload is asynchronous. Confirm the new upstream through fresh connections.
ready=0
for attempt in 1 2 3; do
 if curl -fsS --max-time 15 -H 'Connection: close' --resolve avtocena.com:443:127.0.0.1 https://avtocena.com/api/health | python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"]'; then ready=1; break; fi
 curl -sS --max-time 15 -o /dev/null -w 'Candidate direct health after reload: %{http_code} %{time_total}\n' http://127.0.0.1:3001/api/health || true
 sleep 1
done
test "$ready" = 1
docker stop --time 30 "$old" >/dev/null
docker rename "$old" "$backup"
docker rename "$candidate" "$old"
committed=1
trap - EXIT
docker stats --no-stream --format 'memory={{.MemUsage}} cpu={{.CPUPerc}}' "$old"
echo 'Runtime switched after full-page checks; previous container retained for rollback'
