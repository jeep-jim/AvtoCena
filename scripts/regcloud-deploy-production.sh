#!/usr/bin/env bash
set -euo pipefail
umask 077
release=$1
calculator=$2
[[ "$calculator" =~ ^[a-f0-9]{64}$ ]]
[[ "$release" =~ ^[a-f0-9]{40}$ ]]
exec 9>/run/lock/avtocena-runtime-change.lock
flock -n 9
test -e /opt/avtocena/PRODUCTION_ACTIVE
runtime="/opt/avtocena/releases/$release"
install -d -m 700 "$runtime"
old=avtocena-production
candidate="avtocena-release-${release:0:12}"
backup="avtocena-before-${release:0:12}"
config=/etc/nginx/conf.d/avtocena-prepare.conf
docker inspect "$old" > "$runtime/before.json"
cp -a "$config" "$runtime/nginx-before.conf"
python3 - "$runtime" "$release" "$calculator" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);d=json.loads((p/'before.json').read_text())[0]
assert d['State']['Running'] and not d['HostConfig']['Privileged'] and d['Config']['Labels']['avtocena.role']=='production'
assert all(m['Destination']=='/run/avtocena-metrics' and not m['RW'] for m in d['Mounts'])
bind=d['HostConfig']['PortBindings']['3000/tcp'];assert len(bind)==1 and bind[0]['HostIp']=='127.0.0.1'
port=int(bind[0]['HostPort']);assert port in [3000,3001]
(p/'old-port').write_text(str(port));(p/'new-port').write_text(str(6001-port))
overrides={'AVTOCENA_CALCULATION_VERSION':sys.argv[3],'AVTOCENA_RELEASE_SHA':sys.argv[2],'NODE_OPTIONS':'--max-old-space-size=6144','CATALOG_STORAGE_TIMING':'1','CATALOG_RATE_TIMEOUT_MS':'2500'}
env=[e for e in d['Config']['Env'] if e.split('=',1)[0] not in overrides]
env += [k+'='+v for k,v in overrides.items()]
assert all('\n' not in e and '\r' not in e for e in env)
(p/'runtime.env').write_text('\n'.join(env)+'\n')
PY
port=$(cat "$runtime/new-port")
old_port=$(cat "$runtime/old-port")
# Sampler exposes numeric measurements only through a read-only directory.
install -m 755 "$runtime/regcloud-resource-sampler.py" /opt/avtocena/regcloud-resource-sampler.py
cat > /etc/systemd/system/avtocena-resources.service <<'SERVICE'
[Unit]
Description=AvtoCena resource measurements
After=local-fs.target
[Service]
ExecStart=/usr/bin/python3 /opt/avtocena/regcloud-resource-sampler.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/avtocena/metrics
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
SERVICE
install -d -m 755 /opt/avtocena/metrics
systemctl daemon-reload
systemctl enable --now avtocena-resources.service
! docker inspect "$candidate" >/dev/null 2>&1
! docker inspect "$backup" >/dev/null 2>&1
docker run -d --name "$candidate" --label avtocena.role=production --restart unless-stopped \
 --memory 10g --cpus 6 --pids-limit 512 --log-opt max-size=10m --log-opt max-file=3 \
 --env-file "$runtime/runtime.env" -v /opt/avtocena/metrics:/run/avtocena-metrics:ro \
 -p "127.0.0.1:$port:3000" "avtocena-regcloud:$release" >/dev/null
switched=0
committed=0
rollback(){
 if [ "$committed" = 0 ]; then
  if [ "$switched" = 1 ]; then cp -a "$runtime/nginx-before.conf" "$config"; nginx -t && systemctl reload nginx; fi
  docker start "$old" >/dev/null 2>&1 || docker start "$backup" >/dev/null 2>&1 || true
  docker stop --time 20 "$candidate" >/dev/null || true
  echo 'Release gate failed: old production retained'
 fi
}
trap rollback EXIT
for attempt in $(seq 1 30); do
 if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null; then break; fi
 sleep 1
done
python3 - "$port" "$release" <<'PY'
import urllib.request,urllib.error,time,json,sys
base='http://127.0.0.1:'+sys.argv[1]
for path in ['/api/health','/','/cars','/']:
 t=time.monotonic()
 with urllib.request.urlopen(base+path,timeout=90) as r:b=r.read();assert r.status==200
 elapsed=time.monotonic()-t
 if path=='/api/health':assert json.loads(b)['releaseSha']==sys.argv[2]
 else:assert b'</html>' in b and b'$RX(' not in b and len(b)>50000
 print(json.dumps({'path':path,'seconds':round(elapsed,3),'bytes':len(b)}),flush=True)
# Admin resource data must never leak anonymously.
try:urllib.request.urlopen(base+'/api/crm/server-resources',timeout=15);raise AssertionError('metrics exposed')
except urllib.error.HTTPError as e:assert e.code==403
PY
python3 - "$config" "$old_port" "$port" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);s=p.read_text();old='127.0.0.1:'+sys.argv[2];assert s.count(old)==1
p.write_text(s.replace(old,'127.0.0.1:'+sys.argv[3]))
PY
switched=1
nginx -t
systemctl reload nginx
ready=0
for attempt in 1 2 3; do
 if curl -fsS --max-time 15 -H 'Connection: close' --resolve avtocena.com:443:127.0.0.1 https://avtocena.com/api/health | python3 -c 'import json,sys;assert json.load(sys.stdin)["releaseSha"]==sys.argv[1]' "$release"; then ready=1; break; fi
 sleep 1
done
test "$ready" = 1
docker stop --time 30 "$old" >/dev/null
docker rename "$old" "$backup"
docker rename "$candidate" "$old"
committed=1
trap - EXIT
docker stats --no-stream --format 'memory={{.MemUsage}} cpu={{.CPUPerc}}' "$old"
echo 'Release active; previous image, environment and Nginx configuration retained'
