"""Exercise the real deployment config migration, including repeated releases."""
import pathlib,tempfile,sys,re
script=pathlib.Path('scripts/regcloud-deploy-production.sh').read_text()
start=script.index("python3 - \"$config\" \"$old_port\" \"$port\" <<'PY'\n")
code=script[start:].split('\n',1)[1].split('\nPY\n',1)[0]
base='''server {
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_send_timeout 120s;
  }
}
'''
with tempfile.TemporaryDirectory() as folder:
 p=pathlib.Path(folder)/'site.conf';p.write_text(base)
 for old,new in [('3000','3001'),('3001','3000')]:
  sys.argv=['migration',str(p),old,new];exec(compile(code,'deployment-nginx-migration','exec'),{})
  s=p.read_text()
  assert s.count('# AvtoCena bounded social previews')==1
  assert s.count('limit_req zone=avtocena_social_previews burst=12 nodelay;')==1
  assert 'limit_conn avtocena_social_connections 4;' in s
  assert s.index('TelegramBot')<s.index('~*(bot|crawler|spider) 1;')
  assert '$binary_remote_addr;' in s
  assert 'rate=60r/m;' in s and 'rate=30r/m;' in s
  assert 'limit_req_status 429;' in s
  assert '127.0.0.1:'+new in s and '127.0.0.1:'+old not in s
 print('social preview migration and idempotence: PASS')
