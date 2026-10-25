#!/usr/bin/env bash
set -euo pipefail
umask 077
release=$1
calculator=$2
prewarm=${3:-0}
[[ "$prewarm" = 0 || "$prewarm" = 1 ]]
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
if docker inspect "$candidate" >/dev/null 2>&1; then
 test "$(docker inspect --format '{{.State.Running}}' "$candidate")" = false
 docker rename "$candidate" "$candidate-failed-$(date +%s)"
fi
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
python3 - "$port" "$release" "$prewarm" <<'PY'
import urllib.request,urllib.error,time,json,sys,re
base='http://127.0.0.1:'+sys.argv[1]
for path in ['/api/health','/','/cars','/']:
 t=time.monotonic()
 with urllib.request.urlopen(base+path,timeout=90) as r:b=r.read();assert r.status==200
 elapsed=time.monotonic()-t
 if path=='/api/health':assert json.loads(b)['releaseSha']==sys.argv[2]
 else:
  assert b'</html>' in b and b'$RX(' not in b and len(b)>50000
  if path=='/cars':assert b'data-green-corner="true"' in b
 print(json.dumps({'path':path,'seconds':round(elapsed,3),'bytes':len(b)}),flush=True)
# Prepare expensive first requests on the candidate, before visitors can reach it.
# No background polling: this runs once per authorized release.
for path in ['/cars?market=korea','/cars?market=japan','/cars?market=china','/cars?sort=totalRub','/cars?sort=totalRubDesc']:
 if sys.argv[3]=='1' and path=='/cars?sort=totalRub':
  # One bounded cold preparation on the isolated candidate. The unchanged
  # 120-second complete-response gate below must still pass afterwards.
  print(json.dumps({'coldPreparation':path,'started':True}),flush=True)
  cold=time.monotonic()
  with urllib.request.urlopen(base+path,timeout=600) as response:
   body=response.read();assert response.status==200
  assert time.monotonic()-cold<=600 and b'</html>' in body and b'$RX(' not in body and len(body)>50000
  print(json.dumps({'coldPreparation':path,'seconds':round(time.monotonic()-cold,3),'complete':True}),flush=True)
 t=time.monotonic()
 with urllib.request.urlopen(base+path,timeout=120) as r:b=r.read();assert r.status==200
 if path.startswith('/api/'):
  value=json.loads(b)
  assert value.get('total',0)>0 and len(value.get('items',[]))>0
 else:assert b'</html>' in b and b'$RX(' not in b and len(b)>50000
 print(json.dumps({'prepared':path,'seconds':round(time.monotonic()-t,3),'bytes':len(b)}),flush=True)
# Delivered-price filters are now supported. A loopback probe has no real visitor
# IP and must fail at the source boundary, without any supplier request or fake zero.
# Require the exact typed reason: generic 503, configuration and supplier failures
# are NOT accepted by this release check. Keep all HTML/local price/auth gates above.
for market, source in [('japan','ajes'),('korea','ajes'),('korea','existing'),('china','ajes')]:
 # The local China budget has a separate exact-price snapshot from sorting.
 # Warm it once, then repeat the unchanged 30-second source-boundary gate.
 for cold in ([True,False] if sys.argv[3]=='1' and market=='china' else [False]):
  try:
   with urllib.request.urlopen(base+'/api/catalog/search?market='+market+'&source='+source+'&budgetTo=3000000',timeout=600 if cold else 30) as response:
    value=json.load(response)
   # China may use the owner-selected local Che168 catalog. AJES IDs must
   # never pass this branch; its visitor-IP boundary remains mandatory.
   assert market=='china', 'live source accepted a request without a real visitor IP'
   assert value.get('ok') is True and value.get('total',0)>0 and value.get('items')
   assert all(row.get('market')=='china' and re.fullmatch(r'[a-f0-9]{24}',str(row.get('id',''))) for row in value['items'])
   print(json.dumps({'market':market,'coldPreparation':cold,'localChe168Catalog':'nonempty_verified'}),flush=True)
   continue
  except urllib.error.HTTPError as e:
   value=json.load(e)
   assert e.code==503, (market,e.code)
   assert value.get('ok') is False and value.get('error')=='japan_search_unavailable'
   assert value.get('reason')=='client_ip_missing', (market,value.get('reason'))
   assert 'total' not in value and 'items' not in value
  print(json.dumps({'market':market,'missingVisitorIp':'rejected_without_supplier_request_or_false_zero'}),flush=True)
# Admin resource data must never leak anonymously.
try:urllib.request.urlopen(base+'/api/crm/server-resources',timeout=15);raise AssertionError('metrics exposed')
except urllib.error.HTTPError as e:assert e.code in [401,403]
PY
python3 - "$config" "$old_port" "$port" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);s=p.read_text();old='127.0.0.1:'+sys.argv[2];assert s.count(old)==1
s=s.replace(old,'127.0.0.1:'+sys.argv[3])
if '# AvtoCena bounded crawler rendering' not in s:
    # Empty keys bypass both limits: ordinary browser traffic and photos/API
    # keep their existing behavior. This is load shaping, not authentication.
    maps = '# AvtoCena bounded crawler rendering\nmap $http_user_agent $ac_catalog_robot {\n  default 0;\n  ~*(bot|crawler|spider) 1;\n}\nmap "$ac_catalog_robot:$request_method:$uri" $ac_catalog_robot_budget {\n  default "";\n  ~^1:(GET|HEAD):/cars(?:/|$) catalog;\n}\nlimit_req_zone $ac_catalog_robot_budget zone=avtocena_catalog_robots:1m rate=30r/m;\nlimit_conn_zone $ac_catalog_robot_budget zone=avtocena_catalog_robot_connections:1m;\n'
    anchor='  location / {\n    proxy_pass'
    assert s.count(anchor)==1
    s=s.replace(anchor,'  location / {\n    limit_req zone=avtocena_catalog_robots burst=4 nodelay;\n    limit_conn avtocena_catalog_robot_connections 2;\n    limit_req_status 429;\n    limit_conn_status 429;\n    error_page 429 = @avtocena_crawler_wait;\n    proxy_pass')
    ending='    proxy_send_timeout 120s;\n  }\n}'
    assert s.count(ending)==1
    s=s.replace(ending,'    proxy_send_timeout 120s;\n  }\n  location @avtocena_crawler_wait {\n    add_header Retry-After 5 always;\n    add_header Cache-Control no-store always;\n    return 429;\n  }\n}')
    s=maps+s
# Social previews must not compete with search crawlers for one global budget.
# Keep an independent per-address limit: a User-Agent is not authentication.
if '# AvtoCena bounded social previews' not in s:
    social = r'~*(TelegramBot|TwitterBot|WhatsApp|facebookexternalhit|Facebot|vkShare|vkbot|Viber|TamTam|OdklBot|Pinterest|Snapchat|MaxBot)'
    anchor='map $http_user_agent $ac_catalog_robot {\n  default 0;'
    assert s.count(anchor)==1
    s=s.replace(anchor,anchor+'\n  '+social+' 0;')
    maps = '# AvtoCena bounded social previews\nmap $http_user_agent $ac_social_preview_budget {\n  default "";\n  '+social+' $binary_remote_addr;\n}\nlimit_req_zone $ac_social_preview_budget zone=avtocena_social_previews:1m rate=60r/m;\nlimit_conn_zone $ac_social_preview_budget zone=avtocena_social_connections:1m;\n'
    anchor='    limit_req zone=avtocena_catalog_robots burst=4 nodelay;'
    assert s.count(anchor)==1
    s=s.replace(anchor,anchor+'\n    limit_req zone=avtocena_social_previews burst=12 nodelay;\n    limit_conn avtocena_social_connections 4;')
    s=maps+s
p.write_text(s)
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
