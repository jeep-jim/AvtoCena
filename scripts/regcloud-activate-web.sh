#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/avtocena-migration-copy.lock
flock -n 9
release=dd63dc40f51ee97d33c12a86654ad60d3714053f
config=/opt/avtocena/production-prepared/38146368704-1/production.env
test -s "$config"
python3 - <<'PY'
import json
r=json.load(open('/opt/avtocena/staging/runtime-smoke.json'))
assert r['release']=='dd63dc40f51ee97d33c12a86654ad60d3714053f'
assert len(r['checks'])==8 and all(x['ok'] for x in r['checks'])
PY
# Challenge directories/files are public by design; private keys retain Certbot's own permissions.
chmod 755 /var/www /var/www/avtocena-acme /var/www/avtocena-acme/.well-known /var/www/avtocena-acme/.well-known/acme-challenge
probe=/var/www/avtocena-acme/.well-known/acme-challenge/avtocena-routing-check
printf 'avtocena-regcloud-ready' > "$probe"
chmod 644 "$probe"
echo 'ACME path permissions'
namei -l "$probe"
if runuser -u www-data -- test -r "$probe"; then echo 'nginx worker can read challenge'; else echo 'nginx worker cannot read challenge'; exit 1; fi
cat /etc/nginx/conf.d/avtocena-prepare.conf
nginx -t
systemctl reload nginx
for domain in avtocena.com www.avtocena.com; do
  test "$(curl -fsS --max-time 15 -H "Host: $domain" http://127.0.0.1/.well-known/acme-challenge/avtocena-routing-check)" = avtocena-regcloud-ready
  test "$(curl -fsS --max-time 20 --resolve "$domain:80:151.248.113.177" "http://$domain/.well-known/acme-challenge/avtocena-routing-check")" = avtocena-regcloud-ready
  echo "HTTP certificate challenge route verified: $domain"
done
rm -f "$probe"
# Public HTTP still only serves certificate challenges until certificate success.
(umask 022; certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot -w /var/www/avtocena-acme --cert-name avtocena.com \
  -d avtocena.com -d www.avtocena.com --keep-until-expiring)
# Keep the tested staging container for immediate runtime rollback.
if ! docker container inspect avtocena-production >/dev/null 2>&1; then
  test "$(docker inspect --format '{{ index .Config.Labels "avtocena.role" }}' avtocena-staging)" = isolated-staging
  docker stop --time 30 avtocena-staging >/dev/null
  touch /opt/avtocena/PRODUCTION_ACTIVE
  if ! docker run -d --name avtocena-production --label avtocena.role=production \
    --restart unless-stopped --memory 10g --cpus 6 --pids-limit 512 \
    --log-opt max-size=10m --log-opt max-file=3 --env-file "$config" \
    -p 127.0.0.1:3000:3000 "avtocena-regcloud:$release" >/dev/null; then
    docker start avtocena-staging >/dev/null
    echo 'Production start failed; staging restored, public proxy unchanged' >&2
    exit 1
  fi
else
  test "$(docker inspect --format '{{ index .Config.Labels "avtocena.role" }}' avtocena-production)" = production
fi
python3 /opt/avtocena/staging/runtime/38146023947-1/regcloud-runtime-smoke.py "$release"
# Publish only after real authentication settings and catalog checks pass.
cp -a /etc/nginx/conf.d/avtocena-prepare.conf /opt/avtocena/web-prepared/before-public.conf
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
  location / { return 301 https://avtocena.com$request_uri; }
}
server {
  listen 443 ssl default_server;
  ssl_reject_handshake on;
}
server {
  listen 443 ssl;
  server_name avtocena.com www.avtocena.com;
  ssl_certificate /etc/letsencrypt/live/avtocena.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/avtocena.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  server_tokens off;
  access_log off;
  client_max_body_size 50m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
  }
}
NGINX
if ! nginx -t; then
  cp -a /opt/avtocena/web-prepared/before-public.conf /etc/nginx/conf.d/avtocena-prepare.conf
  exit 1
fi
systemctl reload nginx
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/avtocena-nginx
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/avtocena-nginx
systemctl enable --now certbot.timer
curl --fail --silent --show-error --max-time 20 --resolve avtocena.com:443:127.0.0.1 https://avtocena.com/api/health
printf '\nPublic HTTPS enabled with production authentication; collectors remain paused.\n'
