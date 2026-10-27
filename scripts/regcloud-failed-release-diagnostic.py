#!/usr/bin/env python3
"""One-shot inspection of a selected failed candidate; optional isolated HTTP probe.
Never print raw application logs, environment, customer data or credentials.
"""
import collections,json,re,subprocess,sys,time,urllib.request,fcntl,pathlib,signal
release=sys.argv[1]
if not re.fullmatch('[a-f0-9]{40}',release):raise ValueError('invalid_release')
name='avtocena-release-'+release[:12]
info=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
if info['Config']['Image']!='avtocena-regcloud:'+release:raise ValueError('wrong_image')
state=info['State']
if state['Running']:raise ValueError('candidate_must_be_stopped')
if len(sys.argv)>2 and sys.argv[2] in ['--probe','--probe-ttl','--probe-catalog','--probe-gate','--probe-long','--probe-china-expiry']:
 gate_probe=sys.argv[2]=='--probe-gate'
 china_probe=sys.argv[2]=='--probe-china-expiry'
 long_probe=sys.argv[2] in ['--probe-long','--probe-china-expiry']
 deadline=time.monotonic()+600
 ttl_probe=sys.argv[2] in ['--probe-ttl','--probe-catalog']
 lock=open('/run/lock/avtocena-runtime-change.lock','w')
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 ports=info['HostConfig']['PortBindings']['3000/tcp']
 if len(ports)!=1 or ports[0]['HostIp']!='127.0.0.1':raise ValueError('loopback_required')
 if '127.0.0.1:'+ports[0]['HostPort'] in pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_text():raise ValueError('candidate_must_not_receive_production_traffic')
 base='http://127.0.0.1:'+ports[0]['HostPort']
 def interrupted(signum,frame):raise InterruptedError('diagnostic_interrupted')
 for sig in [signal.SIGHUP,signal.SIGTERM]:signal.signal(sig,interrupted)
 try:
  subprocess.run(['docker','start',name],check=True,capture_output=True)
  ready=False
  for attempt in range(20):
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=2) as response:value=json.load(response)
    if value.get('releaseSha')!=release:raise ValueError('wrong_release')
    ready=True;break
   except OSError:time.sleep(1)
  if not ready:raise ValueError('candidate_not_ready')
  paths=['/cars?sort=totalRub','/cars?sort=totalRub','/cars?market=china&sort=totalRub','/cars?sort=totalRub'] if ttl_probe else ['/cars?market=china&sort=totalRub','/cars?market=china&sort=totalRub','/cars?sort=totalRub']
  if sys.argv[2]=='--probe-catalog':paths=['/cars']*4
  if gate_probe or long_probe:
   routes=['/api/health','/','/login','/autocalc','/cars','/cars?market=china&make=Volkswagen&page=2','/cars?market=europe&make=BMW&page=2','/cars?sort=totalRub','/api/catalog/search?market=europe&make=BMW&page=2']
   paths=['/','/cars','/','/cars?sort=totalRub','/cars?market=china','/cars?market=china']+routes+routes[:5]+['/cars']
   if long_probe:paths=['/','/cars','/','/cars?sort=totalRub']+routes+routes+routes
  profile_number=len(paths)-2
  phase_delays={13:35,22:305}
  if china_probe:
   import importlib.util
   spec=importlib.util.spec_from_file_location('candidate_gate',pathlib.Path(__file__).with_name('regcloud-performance-gate.py'))
   gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
   routes=[route[0] for route in gate.ROUTES]
   target='/cars?market=china&make=Volkswagen&page=2'
   assert len(routes)==10 and target in routes
   warmup=['/api/health','/','/cars','/','/cars?market=korea','/cars?market=japan','/cars?market=china','/cars?sort=totalRub','/cars?sort=totalRub','/cars?sort=totalRubDesc']
   warmup += ['/api/catalog/search?market='+market+'&source='+source+'&budgetTo=3000000' for market,source in [('japan','ajes'),('korea','ajes'),('korea','existing'),('china','ajes'),('china','ajes')]]
   warmup += ['/api/crm/server-resources']
   # Candidate's unchanged gate performs a preparation pass before its warm pass.
   paths=warmup+routes+routes+routes+routes
   phase_delays={len(warmup)+len(routes)*2:35,len(warmup)+len(routes)*3:305}
   profile_number=len(warmup)+len(routes)*3+routes.index(target)
   print(json.dumps({'profilePlan':{'target':target,'profileNumber':profile_number,'phaseDelays':phase_delays,'routes':routes,'release':release}}),flush=True)
  profile=None
  for number,path in enumerate(paths):
   if long_probe and number in phase_delays:time.sleep(phase_delays[number])
   if long_probe and time.monotonic()>=deadline:raise TimeoutError('diagnostic_deadline')
   if ttl_probe and number==2:time.sleep(35)
   if (ttl_probe and number>=2) or (gate_probe and number==len(paths)-6) or (long_probe and number==profile_number):
    subprocess.run(['docker','kill','--signal=USR1',name],check=True,capture_output=True)
    time.sleep(1)
    profile=subprocess.Popen(['docker','exec','-i',name,'node','--input-type=module'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    profile.stdin.write(pathlib.Path(__file__).with_name('cpu-sample.mjs').read_text());profile.stdin.close();profile.stdin=None
    time.sleep(1)
   start=time.monotonic()
   try:
    with urllib.request.urlopen(urllib.request.Request(base+path,headers={'Connection':'close'}),timeout=min(90,max(1,deadline-time.monotonic())) if long_probe else 90) as response:body=response.read(20*1024*1024+1);status=response.status
    print(json.dumps({'candidateProbe':path,'seconds':round(time.monotonic()-start,3),'status':status,'bytes':len(body),'complete':b'</html>' in body,'streamError':b'$RX(' in body}),flush=True)
   except Exception as error:print(json.dumps({'candidateProbe':path,'seconds':round(time.monotonic()-start,3),'errorType':type(error).__name__}),flush=True)
   if profile and ((not gate_probe and not long_probe) or (china_probe and number==profile_number) or number==len(paths)-1):
    try:
     output,_=profile.communicate(timeout=20)
     for line in output.splitlines():
      if line.startswith('CPU_SAMPLE '):print('CANDIDATE_CPU '+json.dumps({'path':path,'profile':json.loads(line[len('CPU_SAMPLE '):])}),flush=True)
    except subprocess.TimeoutExpired:
     profile.kill();profile.communicate();print(json.dumps({'candidateProfileError':'timeout'}),flush=True)
    profile=None
   if ttl_probe or ((gate_probe or long_probe) and number==len(paths)-1):
    stats=subprocess.check_output(['docker','stats','--no-stream','--format','{{.MemUsage}} / CPU {{.CPUPerc}}',name],text=True).strip()
    print(json.dumps({'candidateResources':stats,'after':path}),flush=True)
 finally:subprocess.run(['docker','stop','--time','20',name],check=True,capture_output=True)
 state=json.loads(subprocess.check_output(['docker','inspect',name]))[0]['State']
print(json.dumps({'release':release,'state':{k:state.get(k) for k in ['Status','OOMKilled','ExitCode','StartedAt','FinishedAt']},'memoryLimit':info['HostConfig']['Memory'],'nanoCpus':info['HostConfig']['NanoCpus']}))
logs=subprocess.run(['docker','logs','--tail','2000',name],capture_output=True,text=True,check=True)
text=logs.stdout+'\n'+logs.stderr
codes=collections.Counter(re.findall(r'\b(?:object_storage_[A-Za-z0-9_]+|detail_cache_[A-Za-z0-9_]+|catalog_[A-Za-z0-9_]+|shared_[A-Za-z0-9_]+|budget_[A-Za-z0-9_]+|UND_ERR_[A-Z_]+|ECONNRESET|ETIMEDOUT|ABORT_ERR|AbortError)\b',text))
paths=collections.Counter(re.findall(r'\bpath=(catalog/[A-Za-z0-9_./-]{1,220})',text))
print(json.dumps({'errorCodes':dict(codes),'catalogErrorPaths':dict(paths)},ensure_ascii=False))
rows=[]
for line in text.splitlines():
 if '{' not in line:continue
 try:value=json.loads(line[line.index('{'):])
 except ValueError:continue
 if not isinstance(value,dict):continue
 route=value.get('path') or value.get('key')
 if not isinstance(route,str) or not re.fullmatch(r'catalog/[A-Za-z0-9_./-]{1,220}',route):continue
 row={'path':route}
 for field in ['ms','elapsedMs','durationMs','bytes','sizeBytes']:
  if isinstance(value.get(field),(float,int)):row[field]=value[field]
 rows.append(row)
print(json.dumps({'catalogTimings':rows[-40:]},ensure_ascii=False))
