#!/usr/bin/env bash
set -euo pipefail
umask 077
script=${1:?tested configuration helper required}
test -s "$script"
exec 9>/run/lock/avtocena-runtime-change.lock
flock -w 120 9
config=/etc/nginx/conf.d/avtocena-prepare.conf
test -f "$config"
nginx -V 2>&1 | grep -q -- --with-http_v2_module
nginx -t
backup=$(mktemp /etc/nginx/conf.d/.avtocena-http2-backup.XXXXXX)
cp -a "$config" "$backup"
verified=0
cleanup(){
  status=$?
  if [ "$verified" != 1 ]; then
    echo HTTP2_ROLLBACK
    cp -a "$backup" "$config"
    nginx -t && systemctl reload nginx
  fi
  rm -f "$backup"
  exit "$status"
}
trap cleanup EXIT
before=$(curl --fail --silent --show-error --max-time 15 --resolve avtocena.com:443:127.0.0.1 https://avtocena.com/api/health)
python3 -c 'import json,re,sys; d=json.loads(sys.argv[1]); assert d.get("ok") is True; assert re.fullmatch("[a-f0-9]{40}",d.get("releaseSha","")); assert d.get("calculationVersion"); print("HEALTH_BEFORE",json.dumps(d))' "$before"
python3 "$script" "$config"
nginx -t
systemctl reload nginx
python3 - <<'PY'
import socket, ssl, time
ctx=ssl.create_default_context(); ctx.set_alpn_protocols(['h2','http/1.1'])
protocol=None
for attempt in range(3):
    with socket.create_connection(('127.0.0.1',443),timeout=10) as sock:
        with ctx.wrap_socket(sock,server_hostname='avtocena.com') as tls:
            protocol=tls.selected_alpn_protocol()
    if protocol=='h2':break
    time.sleep(0.5)
assert protocol=='h2', f'http2_not_negotiated:{protocol}'
print('TLS_ALPN_AFTER',protocol)
PY
after=$(curl --fail --silent --show-error --max-time 15 --resolve avtocena.com:443:127.0.0.1 https://avtocena.com/api/health)
python3 -c 'import json,sys; before,after=map(json.loads,sys.argv[1:]); assert after.get("ok") is True; assert before["releaseSha"]==after["releaseSha"]; assert before["calculationVersion"]==after["calculationVersion"]; print("HEALTH_AFTER",json.dumps(after));print("APPLICATION_IDENTITY_UNCHANGED")' "$before" "$after"
verified=1
echo HTTP2_APPLIED_AND_VERIFIED
