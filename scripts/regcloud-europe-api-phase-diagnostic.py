#!/usr/bin/env python3
"""Isolated exact-source API phase profile; never route production to clone."""
import json,subprocess,sys,re,os,tempfile,pathlib,time,urllib.request,hashlib,signal,fcntl,uuid
release=sys.argv[1]
if not re.fullmatch('[a-f0-9]{40}',release):raise ValueError('release_scope')
original='avtocena-release-'+release[:12]
info=json.loads(subprocess.check_output(['docker','inspect',original]))[0]
if info['State']['Running'] or info['Config']['Labels'].get('org.opencontainers.image.revision')!=release:raise ValueError('stopped_exact_candidate_required')
mount_args=[]
for mount in info.get('Mounts',[]):
 if mount.get('Type')!='bind' or mount.get('Source')!='/opt/avtocena/metrics' or mount.get('Destination')!='/run/avtocena-metrics' or mount.get('RW') is not False:raise ValueError('unexpected_external_mounts')
 mount_args+=['--mount','type=bind,src=/opt/avtocena/metrics,dst=/run/avtocena-metrics,readonly']
lock=open('/run/lock/avtocena-runtime-change.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
config=pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_bytes()
def health():
 port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}','avtocena-production'],text=True).strip()
 with urllib.request.urlopen('http://127.0.0.1:'+port+'/api/health',timeout=15) as r:return json.load(r)['releaseSha']
owner=uuid.uuid4().hex
before=health();names=[];files=[];reports=[]
def stop(signum,frame):raise InterruptedError('diagnostic_interrupted')
for sig in [signal.SIGHUP,signal.SIGTERM,signal.SIGINT]:signal.signal(sig,stop)
def remove_owned(name):
 result=subprocess.run(['docker','inspect',name],capture_output=True,text=True)
 if result.returncode:return
 value=json.loads(result.stdout)[0]
 if value['Config']['Labels'].get('avtocena.diagnostic.owner')!=owner:raise ValueError('diagnostic_ownership_mismatch')
 subprocess.run(['docker','rm','-f',name],check=True,capture_output=True)
def request(base,path):
 start=time.monotonic()
 with urllib.request.urlopen(base+path,timeout=120) as response:
  body=response.read(20*1024*1024);status=response.status;timing=response.headers.get('Server-Timing','')
 value=json.loads(body) if path.startswith('/api/') else None
 valid=(value.get('ok') is True and value.get('total',0)>0 and len(value.get('items',[]))>0) if value is not None else (b'</html>' in body and b'$RX(' not in body)
 if not valid:raise ValueError('incomplete_response')
 return {'path':path,'seconds':round(time.monotonic()-start,5),'status':status,'bytes':len(body),'complete':True,'serverTiming':timing}

try:
 for variant in ['reserved-io']:
  name='avtocena-diag-pool-'+variant+'-'+owner[:10]
  if subprocess.run(['docker','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise ValueError('diagnostic_name_busy')
  names.append(name)
  env=dict(value.split('=',1) for value in info['Config']['Env']);env['CATALOG_HOME_PHASE_TIMING']='1'
  if variant=='reserved-io':env.update(UV_THREADPOOL_SIZE='16',VIPS_CONCURRENCY='1')
  fd,path=tempfile.mkstemp(prefix='pool-env-',dir=str(pathlib.Path(__file__).parent));files.append(path)
  with os.fdopen(fd,'w') as f:
   for key,value in env.items():
    if '\n' in value or '\r' in value:raise ValueError('multiline_env_not_supported')
    f.write(key+'='+value+'\n')
  subprocess.run(['docker','run','-d','--name',name,'--label','avtocena.diagnostic.owner='+owner,'--env-file',path,'--memory',str(info['HostConfig']['Memory']),'--cpus',str(info['HostConfig']['NanoCpus']/1e9),'--pids-limit','512','--log-opt','max-size=5m','-p','127.0.0.1::3000',*mount_args,info['Image'],'node','--inspect=127.0.0.1:9229','apps/web/server.js'],check=True,capture_output=True)
  port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}',name],text=True).strip();base='http://127.0.0.1:'+port
  for _ in range(30):
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=2) as r:value=json.load(r)
    if value['releaseSha']!=release:raise ValueError('wrong_clone_source')
    break
   except OSError:time.sleep(1)
  else:raise TimeoutError('clone_not_ready')
  html='/cars?market=europe&make=BMW&page=2'
  api='/api/catalog/search?market=europe&make=BMW&page=2'
  for request_path in [html,api,api]:
   print(json.dumps({'initial':request(base,request_path)}),flush=True)
  for number in range(3):
   time.sleep(35)
   # Preserve the real gate order: HTML is measured before the same API.
   results=[request(base,request_path) for request_path in ['/cars?market=korea','/','/cars','/cars?market=china&make=Volkswagen&page=2',html,'/cars?sort=totalRub',api]]
   print(json.dumps({'trial':number+1,'afterSeconds':35,'responses':results}),flush=True)
  remove_owned(name);names.remove(name);os.unlink(path);files.remove(path)
 print(json.dumps({'isolatedApiPhaseProfileComplete':True}),flush=True)
finally:
 for name in names:remove_owned(name)
 for path in files:
  try:os.unlink(path)
  except FileNotFoundError:pass
 if pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_bytes()!=config:raise ValueError('nginx_changed')
 after=health();print(json.dumps({'productionBefore':before,'productionAfter':after,'unchanged':before==after}),flush=True)
 if before!=after:raise ValueError('production_changed')
