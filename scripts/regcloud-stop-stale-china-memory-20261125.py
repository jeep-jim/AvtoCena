#!/usr/bin/env python3
"""Stop only two proven unserved obsolete China containers; keep all images, data and mounts."""
import fcntl,http.client,json,os,re,subprocess,sys,time
from pathlib import Path
MAIN='d536c1547c4d82a339ed68ced7d8503f09b6810b'
ACTIVE='avtocena-china-next-d536c1547c4d-1b256d5c'
NGINX=Path('/etc/nginx/conf.d/avtocena-prepare.conf')
LOCK=Path('/run/lock/avtocena-runtime-change.lock')
TARGETS=[
 ('avtocena-china-grid-dark-22867cbcfaee','52e44ba28107','china-ui-grid-dark',3002),
 ('avtocena-china-candidate-85296f6b8797','e30facd9dc08','china-release-standby',3000)]
def need(x,code):
 if not x:raise RuntimeError('china_stale_memory_'+code)
def invoke(*cmd,timeout=50):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 need(p.returncode==0,'docker_command');return p.stdout
def inspect(name):
 x=json.loads(invoke('/usr/bin/docker','inspect',name))
 need(len(x)==1,'identity');return x[0]
def mem():
 result={}
 for line in Path('/proc/meminfo').read_text().splitlines():
  m=re.fullmatch(r'([A-Za-z]+):\s+(\d+) kB',line)
  if m and m.group(1) in ('MemAvailable','MemTotal'):result[m.group(1)]=int(m.group(2))*1024
 return result
def upstream():
 v=NGINX.read_bytes()
 ports=re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$',v)
 need(ports==[b'3004'],'ingress_changed')
 return v
def live():
 x=inspect(ACTIVE);need(x['State']['Running'] is True and
   x['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==MAIN and
   x['Config'].get('Labels',{}).get('avtocena.role')=='independent-china','active_identity')
 conn=http.client.HTTPConnection('127.0.0.1',3004,timeout=10)
 try:
  conn.request('GET','/api/health',headers={'Host':'avtocena.com','Accept':'application/json','Connection':'close'})
  res=conn.getresponse();raw=res.read(100000)
  need(res.status==200 and len(raw)<100000,'health')
  val=json.loads(raw)
  need(val.get('ok') is True and val.get('releaseSha')==MAIN,'live_release')
 finally:conn.close()
 return x
def all_routes():
 for root in ('/etc/nginx/conf.d','/etc/nginx/sites-enabled'):
  d=Path(root)
  if not d.exists():continue
  for p in d.iterdir():
   if not p.is_file() or p.stat().st_size>512000:continue
   txt=p.read_text(errors='replace')
   for port in ('3000','3002'):
    need(not re.search(r'proxy_pass\s+http://127\.0\.0\.1:'+port+r'\b',txt),'orphan_now_routed')
def connections():
 out=invoke('/usr/bin/ss','-ntH','state','established',timeout=10)
 for line in out.splitlines():
  tokens=line.split()
  if len(tokens)<5:continue
  for value in tokens[3:5]:
   need(not re.search(r':(?:3000|3002)$',value),'orphan_connected')
def main():
 need(len(sys.argv)==1,'arguments')
 fd=os.open(str(LOCK),os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  expected=upstream();current=live();all_routes();connections()
  before=mem()
  targets=[]
  for name,prefix,role,port in TARGETS:
   row=inspect(name)
   labels=row.get('Config',{}).get('Labels') or {}
   actual={int(z['HostPort']) for group in (row.get('HostConfig',{}).get('PortBindings') or {}).values() for z in group or [] if str(z.get('HostPort','')).isdigit()}
   need(row['Id'].startswith(prefix) and row['State']['Running'] is True and
     labels.get('org.opencontainers.image.revision')!=MAIN and
     labels.get('avtocena.role')==role and actual=={port} and
     row.get('HostConfig',{}).get('RestartPolicy',{}).get('Name')=='unless-stopped','stale_identity')
   need(row['Id']!=current['Id'],'active_target')
   targets.append(row)
  # Protect direct container dependencies and shared network namespaces.
  for row in json.loads(invoke('/usr/bin/docker','ps','-aq','--no-trunc') and invoke('/usr/bin/docker','inspect',*invoke('/usr/bin/docker','ps','-aq','--no-trunc').split())):
   if row['State'].get('Running') is not True:continue
   for old in targets:
    if row['Id']==old['Id']:continue
    mode=str(row.get('HostConfig',{}).get('NetworkMode',''))
    need(old['Id'] not in mode and old['Name'].removeprefix('/') not in mode,'network_dependency')
  need(upstream()==expected,'ingress_changed')
  live();connections()
  for row in targets:
   invoke('/usr/bin/docker','stop','--time','25',row['Id'],timeout=40)
   stopped=inspect(row['Id'])
   need(not stopped['State']['Running'],'stop_not_confirmed')
   need(upstream()==expected,'ingress_changed')
   live()
  time.sleep(3)
  after=mem()
  print(json.dumps({'kind':'china-stale-container-memory-retirement-v1',
    'stopped':[{'id':v['Id'][:12],'role':v['Config']['Labels']['avtocena.role']} for v in targets],
    'activeChinaUnchanged':True,'memAvailableBeforeBytes':before.get('MemAvailable'),
    'memAvailableAfterBytes':after.get('MemAvailable'),
    'deltaAvailableBytes':after.get('MemAvailable',0)-before.get('MemAvailable',0),
    'imagesRemoved':0,'generationFilesRemoved':0},separators=(',',':')))
 finally:os.close(fd)
if __name__=='__main__':
 try:main()
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and re.fullmatch('china_stale_memory_[a-z_]+',str(e)) else 'china_stale_memory_unverified'
  print(json.dumps({'kind':'china-stale-container-memory-retirement-v1','error':code}),flush=True)
  sys.exit(1)
