#!/usr/bin/env python3
"""Isolated A/B of worker-pool pressure; never route production to either clone."""
import json,subprocess,sys,re,os,tempfile,pathlib,time,urllib.request,hashlib,signal,fcntl,uuid
release=sys.argv[1]
if not re.fullmatch('[a-f0-9]{40}',release):raise ValueError('release_scope')
original='avtocena-release-'+release[:12]
info=json.loads(subprocess.check_output(['docker','inspect',original]))[0]
if info['State']['Running'] or info['Config']['Labels'].get('org.opencontainers.image.revision')!=release:raise ValueError('stopped_exact_candidate_required')
if info.get('Mounts'):raise ValueError('unexpected_external_mounts')
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
def request(base):
 start=time.monotonic()
 with urllib.request.urlopen(base+'/',timeout=30) as response:body=response.read(20*1024*1024);status=response.status
 return {'seconds':round(time.monotonic()-start,4),'status':status,'bytes':len(body),'complete':b'</html>' in body,'streamError':b'$RX(' in body}
try:
 for variant in ['default','reserved-io']:
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
  subprocess.run(['docker','run','-d','--name',name,'--label','avtocena.diagnostic.owner='+owner,'--env-file',path,'--memory',str(info['HostConfig']['Memory']),'--cpus',str(info['HostConfig']['NanoCpus']/1e9),'--pids-limit','512','--log-opt','max-size=5m','-p','127.0.0.1::3000',info['Image'],'node','--inspect=127.0.0.1:9229','apps/web/server.js'],check=True,capture_output=True)
  port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}',name],text=True).strip();base='http://127.0.0.1:'+port
  for _ in range(30):
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=2) as r:value=json.load(r)
    if value['releaseSha']!=release:raise ValueError('wrong_clone_source')
    break
   except OSError:time.sleep(1)
  else:raise TimeoutError('clone_not_ready')
  warm=request(base);print(json.dumps({'variant':variant,'initial':warm}),flush=True)
  time.sleep(35)
  trials=[]
  for number in range(3):
   if number:time.sleep(6)
   proc=subprocess.Popen(['docker','exec','-i',name,'node','--input-type=module','-','3000000'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   proc.stdin.write(pathlib.Path(__file__).with_name('pool-stress.mjs').read_text());proc.stdin.close();proc.stdin=None
   ready=proc.stdout.readline().strip()
   if not ready.startswith('POOL_READY '):raise ValueError('pool_stress_not_ready')
   measured=request(base);remaining,error=proc.communicate(timeout=30)
   if proc.returncode:raise ValueError('pool_stress_failed')
   counters=[json.loads(line[len('POOL_DONE '):]) for line in remaining.splitlines() if line.startswith('POOL_DONE ')]
   trials.append(measured);print(json.dumps({'variant':variant,'trial':number+1,**measured,'nativeWork':counters}),flush=True)
  logs=subprocess.run(['docker','logs','--tail','1000',name],capture_output=True,text=True,check=True)
  phases=[]
  for line in (logs.stdout+'\n'+logs.stderr).splitlines():
   if line.startswith('home_phase '):
    try:v=json.loads(line[len('home_phase '):])
    except ValueError:continue
    phases.append({k:v[k] for k in ['trace','phase','ms','ok','generation'] if k in v})
  reports.append({'variant':variant,'trials':trials,'homePhases':phases[-100:]})
  remove_owned(name);names.remove(name);os.unlink(path);files.remove(path)
 print(json.dumps({'isolatedPoolComparison':reports}),flush=True)
finally:
 for name in names:remove_owned(name)
 for path in files:
  try:os.unlink(path)
  except FileNotFoundError:pass
 if pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_bytes()!=config:raise ValueError('nginx_changed')
 after=health();print(json.dumps({'productionBefore':before,'productionAfter':after,'unchanged':before==after}),flush=True)
 if before!=after:raise ValueError('production_changed')
