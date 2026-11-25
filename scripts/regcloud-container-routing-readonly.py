#!/usr/bin/env python3
"""Read-only service ownership map for RAM remediation. No environment/config contents in output."""
import json,os,pathlib,re,subprocess,sys
P=pathlib.Path
def run(argv,seconds=15):
 p=subprocess.run(argv,text=True,capture_output=True,timeout=seconds,check=False)
 if p.returncode!=0 or len(p.stdout)>2_000_000:raise RuntimeError('inspection_unavailable')
 return p.stdout
def emit(o):print(json.dumps(o,ensure_ascii=False,separators=(',',':')),flush=True)
def nginx():
 configs=[]
 for root in ('/etc/nginx/conf.d','/etc/nginx/sites-enabled'):
  if not P(root).is_dir():continue
  for p in P(root).glob('*.conf' if 'conf.d' in root else '*'):
   if len(configs)>=100:break
   try:
    if not p.is_file() or p.stat().st_size>1024*512:continue
    txt=p.read_text()
    names=re.findall(r'(?m)^\s*proxy_pass\s+http://127\.0\.0\.1:(\d+)',txt)
    if names:configs.append({'file':p.name,'ports':sorted(set(map(int,names)))})
   except (PermissionError,OSError,UnicodeDecodeError):continue
 return configs
def active_connections():
 out=run(['ss','-ntH','state','established'],10)
 count={}
 for line in out.splitlines():
  cols=line.split()
  if len(cols)<5:continue
  for endpoint in cols[3:5]:
   match=re.search(r':(3\d{3})$',endpoint)
   if match:count[match.group(1)]=count.get(match.group(1),0)+1
 return count
def main():
 if len(sys.argv)!=1:raise RuntimeError('arguments')
 ids=run(['docker','ps','-aq','--no-trunc'],15).splitlines()
 if len(ids)>80 or any(not re.fullmatch('[a-f0-9]{64}',i) for i in ids):raise RuntimeError('container_ids')
 records=json.loads(run(['docker','inspect',*ids],25)) if ids else []
 configs=nginx(); ports={p for c in configs for p in c['ports']}
 conn=active_connections(); output=[]
 for v in records:
  state=v.get('State') or {};labels=(v.get('Config') or {}).get('Labels') or {}
  bindings=(v.get('HostConfig') or {}).get('PortBindings') or {}
  hostports=sorted(set(int(x.get('HostPort')) for groups in bindings.values() for x in groups or []
   if str(x.get('HostPort','')).isdigit()))
  name=str(v.get('Name','')).removeprefix('/')
  if not re.fullmatch(r'[\w.\-]{1,90}',name):name='other'
  output.append({'id':v['Id'][:12],'name':name,'status':state.get('Status'),
    'pid':state.get('Pid'),'oomKilled':state.get('OOMKilled'),'startedAt':state.get('StartedAt'),
    'restartPolicy':(v.get('HostConfig') or {}).get('RestartPolicy',{}).get('Name'),
    'memoryLimitBytes':(v.get('HostConfig') or {}).get('Memory'),
    'hostPorts':hostports,'nginxReferenced':any(x in ports for x in hostports),
    'establishedConnections':sum(conn.get(str(x),0) for x in hostports),
    'revision':labels.get('org.opencontainers.image.revision'),
    'role':labels.get('avtocena.role'),'application':labels.get('avtocena.application'),
    'mountCount':len(v.get('Mounts') or [])})
 emit({'kind':'regcloud-container-routing-readonly-v1','nginxRoutes':configs,
       'containers':sorted(output,key=lambda x:x['name']),
       'establishedPortConnectionCounts':{k:v for k,v in conn.items() if k.isdecimal() and int(k) in ports}})
if __name__=='__main__':
 try:main()
 except Exception:emit({'kind':'regcloud-container-routing-readonly-v1','error':'inspection_unavailable'});sys.exit(1)
