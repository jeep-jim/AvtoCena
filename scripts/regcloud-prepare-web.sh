#!/usr/bin/env bash
# Prepare HTTP ACME only; application remains loopback-only until TLS cutover.
set -euo pipefail
umask 077
exec 9>/run/lock/avtocena-web-prepare.lock
flock -n 9
test ! -e /opt/avtocena/PRODUCTION_ACTIVE
python3 - <<'PY'
import json
r=json.load(open('/opt/avtocena/staging/runtime-smoke.json'))
assert r['release']=='dd63dc40f51ee97d33c12a86654ad60d3714053f'
assert len(r['checks'])==8 and all(x['ok'] for x in r['checks'])
PY
install -d -m 700 /opt/avtocena/web-prepared
install -d -m 755 /var/www/avtocena-acme/.well-known/acme-challenge
if ! command -v nginx >/dev/null; then
  # Do not let package installation expose the default page or an untested app.
  test ! -e /usr/sbin/policy-rc.d
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
  chmod 755 /usr/sbin/policy-rc.d
  trap 'rm -f /usr/sbin/policy-rc.d' EXIT
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=120 update -qq
  apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends nginx certbot
  rm -f /usr/sbin/policy-rc.d
  trap - EXIT
fi
# Preserve original default config for rollback; no customer files are removed.
if test -e /etc/nginx/sites-enabled/default; then
  mv /etc/nginx/sites-enabled/default /opt/avtocena/web-prepared/original-default-link
fi
cat > /etc/nginx/conf.d/avtocena-prepare.conf <<'NGINX'
server {
  listen 80 default_server;
  server_name avtocena.com www.avtocena.com;
  server_tokens off;
  access_log off;
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/avtocena-acme;
    default_type text/plain;
    try_files $uri =404;
  }
  location / { add_header Retry-After 120 always; return 503; }
}
server {
  listen 127.0.0.1:8080;
  server_name avtocena.com;
  server_tokens off;
  access_log off;
  client_max_body_size 50m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host avtocena.com;
    proxy_set_header X-Forwarded-Host avtocena.com;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
  }
}
NGINX
nginx -t
systemctl enable nginx
systemctl restart nginx
python3 - <<'PY'
import json, urllib.request, urllib.error
with urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=15) as r:
    data=json.load(r)
    assert r.status==200 and data['releaseSha']=='dd63dc40f51ee97d33c12a86654ad60d3714053f'
try:
    urllib.request.urlopen('http://127.0.0.1/',timeout=10)
    raise RuntimeError('Public HTTP must not expose application before TLS')
except urllib.error.HTTPError as e:
    assert e.code==503
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
opener=urllib.request.build_opener(NoRedirect)
for path in ['/api/crm/leads','/crm']:
    try:
        opener.open('http://127.0.0.1:8080'+path,timeout=15)
        raise RuntimeError('Unauthenticated CRM response must be denied')
    except urllib.error.HTTPError as e:
        assert e.code in [401,403,303,307]
print(json.dumps({'loopbackProxyHealth':True,'anonymousCrmDenied':True,'publicHttpAppExposed':False,'dnsChanged':False,'tlsIssued':False}))
PY
