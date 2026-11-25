#!/usr/bin/env python3
"""Read-only check of Japanese AJ container and current China ingress; never ask the supplier."""
import http.client,json,re,subprocess,sys
from pathlib import Path
CURRENT='d536c1547c4d82a339ed68ced7d8503f09b6810b'
def query(argv,timeout=12):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout,check=False)
 if p.returncode!=0 or len(p.stdout)>150000:raise RuntimeError('japan_host_command')
 return p.stdout
def inspect(name):
 rows=json.loads(query(['/usr/bin/docker','inspect',name]))
 if len(rows)!=1:raise RuntimeError('japan_container_identity')
 return rows[0]
def health(port):
 connection=http.client.HTTPConnection('127.0.0.1',port,timeout=8)
 try:
  connection.request('GET','/api/health',headers={'Host':'avtocena.com','Accept':'application/json','Connection':'close'})
  response=connection.getresponse()
  raw=response.read(100000)
  if response.status!=200 or len(raw)>=100000:return {'status':response.status,'confirmed':False}
  body=json.loads(raw)
  return {'status':response.status,'ok':body.get('ok') is True,
          'releaseSha':body.get('releaseSha') if re.fullmatch('[a-f0-9]{40}',str(body.get('releaseSha',''))) else None}
 except (OSError,ValueError):return {'status':None,'confirmed':False}
 finally:connection.close()
def main():
 if len(sys.argv)!=1:raise RuntimeError('arguments')
 nginx=Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_text()
 upstreams=re.findall(r'(?m)^\s*proxy_pass\s+http://127\.0\.0\.1:(\d+);',nginx)
 if upstreams!=['3004']:raise RuntimeError('japan_ingress_changed')
 out=[]
 for name in ['avtocena-china-next-d536c1547c4d-1b256d5c','aj-japan-56d6b94fea70-01db86f3ba423b4df51b52580a2c1f8d']:
  c=inspect(name)
  env=(c.get('Config') or {}).get('Env') or []
  keys={line.split('=',1)[0] for line in env if '=' in line}
  if name.startswith('avtocena-china-next'):
   if c['Config'].get('Labels',{}).get('org.opencontainers.image.revision')!=CURRENT or not c['State'].get('Running'):
    raise RuntimeError('china_runtime_changed')
  ports=sorted({row.get('HostPort') for sub in (c.get('HostConfig') or {}).get('PortBindings',{}).values()
    for row in (sub or []) if row.get('HostPort')})
  out.append({'role': 'activeChina' if name.startswith('avtocena-china-next') else 'retainedJapan',
    'running':c['State'].get('Running'),'revision':(c.get('Config') or {}).get('Labels',{}).get('org.opencontainers.image.revision'),
    'hostPorts':ports,'hasAJPasswordEnv':'AJES_API_PASSWORD' in keys,
    'hasAuthSecret':bool({'AUTH_SECRET','NEXTAUTH_SECRET'} & keys),
    'storageDriverObject':any(x=='JSON_STORAGE_DRIVER=object' for x in env),
    'hasObjectStoreKeys':all(k in keys for k in ['YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_BUCKET','YC_OBJECT_STORAGE_PREFIX']),
    'health':health(3004 if name.startswith('avtocena-china-next') else 3003)})
 print(json.dumps({'kind':'japan-aj-host-readiness-v1','nginxUpstreamPort':3004,
    'providerRequests':0,'containers':out},separators=(',',':')))
if __name__=='__main__':
 try:main()
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and re.fullmatch('[a-z_]+',str(e)) else 'unverified'
  print(json.dumps({'kind':'japan-aj-host-readiness-v1','error':code}))
  sys.exit(1)
