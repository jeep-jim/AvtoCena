import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../scripts/catalog-next/diagnose-photo-disk-20261125.py', import.meta.url));
const gate = fileURLToPath(new URL('../scripts/regcloud-performance-gate.py', import.meta.url));
const baseline = fileURLToPath(new URL('../docs/operations/2026-11-11-accepted-speed-baseline.json', import.meta.url));
const harness = String.raw`
import contextlib,datetime,hashlib,importlib.util,io,json,os,pathlib,stat,sys,tempfile,types
from urllib.parse import parse_qs,urlsplit
filename,case,gate,baseline=sys.argv[1:]
sys.argv=[filename,'--photo-attempt-only']
spec=importlib.util.spec_from_file_location('diagnostic',filename)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.PHOTO_ATTEMPT_ONLY
assert m.PHOTO_ATTEMPT_PROOFS=={
 'PLAN.json':'1b8455abcd8512467f31bc0e2735922536cee40d933084ae3934ef38515c99dc',
 'ROLLED_BACK.json':'783809d2dc846fbac6c01699f5419345bb61eca77c6542d304eb283fed0d74e6',
 'server-speed-result.json':'4d4b236968365be4722537fc3e4e0c06a57f5364fe8470e6f280847fcc0d0187'}
def forbidden(*args,**kwargs):raise AssertionError('narrow diagnosis cannot run inventory, commands, app gates or provider reads')
m.subprocess.run=m.socket.socket=m.aj_failure_diagnostic=m.image_binding_diagnostic=m.docker_json=m.main=forbidden
# Run production ownership/type/race checks with synthetic host root ownership;
# all remaining fields come from the real temporary fixture files.
real_fstat=os.fstat
def fixture_fstat(fd):
 value=real_fstat(fd)
 return types.SimpleNamespace(**{key:(0 if key=='st_uid' else getattr(value,key)) for key in
  ('st_mode','st_uid','st_nlink','st_size','st_dev','st_ino','st_mtime_ns','st_ctime_ns')})
m.os.fstat=fixture_fstat
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,separators=(',',':')).encode()
with tempfile.TemporaryDirectory() as temporary:
 base=pathlib.Path(temporary);m.BASE=base/'releases';m.CONFIG=base/'nginx.conf';m.PHOTO_LOCK=base/'runtime.lock'
 token='a'*32;directory=m.BASE/m.RUNTIMES[3]/'china-next'/token;directory.mkdir(parents=True)
 m.CONFIG.write_bytes(b'proxy_pass http://127.0.0.1:3004;\n');m.CONFIG.chmod(0o600)
 m.PHOTO_LOCK.write_bytes(b'');m.PHOTO_LOCK.chmod(0o600)
 def put(name,value,raw=False):
  content=value if raw else encoded(value);path=directory/name
  path.write_bytes(content);path.chmod(0o600);return sha(content)
 files=[]
 for name,source in [('regcloud-performance-gate.py',gate),('accepted-speed-baseline.json',baseline)]:
  raw=pathlib.Path(source).read_bytes();files.append({'name':name,'bytes':len(raw),'sha256':put(name,raw,True)})
 plan={**m.PHOTO_SPEED_PLAN,'nonce':token,'files':files,'privateFixture':'PRIVATE_PLAN'}
 rollback={'version':1,'kind':'china-host-rollback-v1','nonce':token,'release':plan['runtimeSha'],
  'generationManifestSha256':plan['generationManifestSha256'],'retainedRuntimeSha':m.RUNTIMES[1],
  'retainedRunning':True,'candidateRemoved':True,'ingressRestored':True,'rolledBackAt':'2026-11-25T19:50:10Z',
  'retainedContainerId':'d'*64,'retainedImageId':'sha256:'+'e'*64,
  'privateFixture':'PRIVATE_ROLLBACK'}
 speed={'exitCode':1,'samples':[{'performanceRequest':'failed','path':'/','seconds':31.1338,'errorType':'IncompleteRead'}]}
 # Private PLAN/rollback bytes are unavailable offline. Substitute fixture pins
 # once, then exercise the same equality checks, including tampering failures.
 m.PHOTO_ATTEMPT_PROOFS={name:put(name,value) for name,value in
  [('PLAN.json',plan),('ROLLED_BACK.json',rollback),('server-speed-result.json',speed)]}
 at=int(datetime.datetime(2026,11,25,19,49,30,tzinfo=datetime.timezone.utc).timestamp())
 written_ns=at*1_000_000_000+(423540123 if case=='nano_order' else 0)
 os.utime(directory/'server-speed-result.json',ns=(written_ns,written_ns))
 startup={'version':1,'kind':'china-host-startup-v1','ready':True,'elapsedSeconds':1.2,'attempts':2,'health':'ok',
  'candidate':{'running':True,'status':'running','exitCode':0,'oomKilled':False,'restartCount':0},'reason':'ready'}
 timing={'version':1,'kind':'china-home-phase-timing-v1','runtimeSha':plan['runtimeSha'],'nonce':token,
  'logBytes':256,'logLines':1,'rejectedRows':0,'limited':False,
  'rows':[{'trace':'12345678-1234-1234-1234-123456789012','phase':'snapshotBody','ms':31000,'ok':False,
   'policyDate':'2026-11-26','completedPolicyDate':'2026-11-26'}]}
 if case=='startup_private':startup['raw']='PRIVATE_LOG'
 if case=='timing_private':timing['rows'][0]['raw']='PRIVATE_LOG'
 if case=='timing_nonce':timing['nonce']='b'*32
 if case=='timing_runtime':timing['runtimeSha']=m.RUNTIMES[1]
 if case=='timing_phase':timing['rows'][0]['phase']='PRIVATE_PHASE'
 if case=='timing_number':timing['rows'][0]['ms']=float('nan')
 if case=='timing_date':timing['rows'][0]['policyDate']='2026-02-30'
 if case!='startup_missing':put('STARTUP.json',startup)
 if case!='timing_missing':put('HOME_PHASE_TIMING.json',timing)
 if case=='wrong_selector':
  plan['controllerSha']='0'*40;m.PHOTO_ATTEMPT_PROOFS['PLAN.json']=put('PLAN.json',plan)
 if case in ('plan_pin','rollback_pin','speed_pin'):
  name={'plan_pin':'PLAN.json','rollback_pin':'ROLLED_BACK.json','speed_pin':'server-speed-result.json'}[case]
  (directory/name).write_bytes((directory/name).read_bytes()+b'\n')
 if case=='source_pin':put('regcloud-performance-gate.py',b'PRIVATE_SOURCE',True)
 if case=='speed_symlink':
  (directory/'server-speed-result.json').unlink();(directory/'server-speed-result.json').symlink_to(directory/'PLAN.json')
 if case=='lock_busy':
  def busy(*args):raise BlockingIOError()
  m.fcntl.flock=busy
 calls=[];capacity_calls=[]
 def capacity(path):
  capacity_calls.append(path);return types.SimpleNamespace(f_bavail=11,f_frsize=4096,f_blocks=23)
 m.os.statvfs=capacity
 class Response:
  status=200
  def __init__(self,raw):self.raw=raw
  def read(self,limit):return self.raw[:limit]
 class Health:
  def __init__(self,host,port,timeout):assert (host,port,timeout)==('127.0.0.1',3004,15)
  def request(self,method,target,headers):
   assert (method,target)==('GET','/api/health');calls.append('health')
  def getresponse(self):
   release=m.RUNTIMES[1]
   if case=='health_before' or case=='health_after' and calls.count('health')==2:release='0'*40
   return Response(encoded({'ok':True,'releaseSha':release,'calculationVersion':m.PHOTO_CALCULATION,'private':'PRIVATE_HEALTH'}))
  def close(self):pass
 class Events:
  def __init__(self,host,timeout):assert (host,timeout)==('localhost',15)
  def request(self,method,target):
   assert method=='GET';self.target=target
   if target=='/containers/'+rollback['retainedContainerId']+'/json':calls.append('inspect');return
   assert urlsplit(target).path=='/events';calls.append('events')
   query=parse_qs(urlsplit(target).query);since=int(query['since'][0]);until=int(query['until'][0])
   assert since==at-60 and until==at+42 and 0<until-since<=300
   filters=json.loads(query['filters'][0]);assert filters['type']==['container']
   assert filters['label']==['avtocena.china.nonce='+token,'org.opencontainers.image.revision='+plan['runtimeSha']]
  def getresponse(self):
   if self.target.startswith('/containers/'):
    entries=['AVTOCENA_RELEASE_SHA='+m.RUNTIMES[1],'PRIVATE_ENV=PRIVATE_VALUE']
    if case=='preload_flags':entries+=['NEXT_MANUAL_SIG_HANDLE=0','NEXT_CPU_PROF=false','__NEXT_PRIVATE_CPU_PROFILE=PRIVATE','NODE_OPTIONS=--require /PRIVATE --import=PRIVATE']
    if case=='preload_invalid':entries+=['NODE_OPTIONS=--require "PRIVATE']
    return Response(encoded({'Id':'0'*64 if case=='retained_mismatch' else rollback['retainedContainerId'],
     'Image':rollback['retainedImageId'],'Config':{'Env':entries,'Entrypoint':['docker-entrypoint.sh'],
      'Cmd':['sh','-c','PRIVATE_COMMAND'] if case=='argv_private' else ['node','apps/web/server.js']},
     'State':{'Running':True,'Pid':101 if case=='retained_changed' and calls.count('inspect')==2 else 100,
      'StartedAt':'2026-11-25T19:00:00Z'},'HostConfig':{'PortBindings':{'3000/tcp':[{'HostPort':'3004'}]}}}))
   if case=='proof_changed':put('PLAN.json',{**plan,'changed':True})
   rows=[]
   for action,when,exitcode in [('start',at-50,None),('oom',at-2,None),('die',at-1,'137'),('destroy',at+20,None)]:
    attributes={'avtocena.china.nonce':token,'org.opencontainers.image.revision':plan['runtimeSha'],'private':'PRIVATE_EVENT'}
    if exitcode is not None:attributes['exitCode']=exitcode
    rows.append({'Type':'container','Action':action,'time':when,'Actor':{'ID':'c'*64,'Attributes':attributes},'private':'PRIVATE_EVENT'})
   if case=='cleanup_only':rows=[{**rows[2],'time':at+10},rows[3]]
   if case=='events_empty':rows=[]
   if case=='events_foreign':rows[0]['Actor']['Attributes']['avtocena.china.nonce']='b'*32
   if case=='events_action':rows[0]['Action']='PRIVATE_EVENT_ACTION'
   if case=='events_window':rows[0]['time']=at-61
   if case=='events_exit':rows[2]['Actor']['Attributes']['exitCode']='PRIVATE_EXIT'
   if case=='events_identity':rows[0]['Actor']['ID']='PRIVATE_ID'
   if case=='events_ambiguous':rows[0]['Actor']['ID']='b'*64
   if case=='events_oversized':return Response(b'x'*(1024*1024+1))
   if case.startswith('events_nano'):
    for row in rows:row['timeNano']=row['time']*1_000_000_000+123456789
    changes={'events_nano_second':rows[0]['timeNano']+1_000_000_000,
     'events_nano_float':float(rows[0]['timeNano']),'events_nano_string':str(rows[0]['timeNano']),
     'events_nano_bool':True,'events_nano_null':None,'events_nano_negative':-1}
    if case in changes:rows[0]['timeNano']=changes[case]
   if case=='nano_order':
    rows=[{**rows[2],'time':at,'timeNano':written_ns-1}, {**rows[3],'time':at,'timeNano':written_ns+1}]
   return Response(b'\n'.join(encoded(row) for row in rows))
  def close(self):pass
 m.http.client.HTTPConnection=Health;m.PhotoDocker=Events
 journal_deadlines=[]
 original_capture=m.photo_journal_capture
 def journal_capture(arguments,maximum,deadline):
  assert '--no-pager' in arguments and '--output=json' in arguments and '--lines=2048' in arguments
  assert '--since=2026-11-25 19:48:30 UTC' in arguments and '--until=2026-11-25 19:50:12 UTC' in arguments
  assert 0<maximum<=512*1024 and 0<deadline-m.time.monotonic()<=15
  journal_deadlines.append(deadline);assert len(set(journal_deadlines))==1
  services='--unit=docker.service' in arguments
  assert ('--grep='+'c'*64 in arguments and '--unit=containerd.service' in arguments) if services else 'CONTAINER_ID_FULL='+'c'*64 in arguments
  calls.append('journal:services' if services else 'journal:container')
  rows=[]
  if case.startswith('journal_'):
   row={'__REALTIME_TIMESTAMP':str(at*1_000_000),'MESSAGE':'PRIVATE_UNCLASSIFIED','_PID':'99999',
    '_SYSTEMD_UNIT':'containerd.service','CONTAINER_ID_FULL':'c'*64}
   if not services and case=='journal_private':row['MESSAGE']='home_initial_catalog_failed Error: PRIVATE_URL_SQL';rows=[row]
   if not services and case=='journal_identity':row['CONTAINER_ID_FULL']='b'*64;rows=[row]
   if not services and case=='journal_boundary':row['__REALTIME_TIMESTAMP']=str((at-60)*1_000_000-1);rows=[row]
   if not services and case=='journal_pid':rows=[row]
   if not services and case=='journal_line_limit':rows=[row]*2049
   if services and case in ('journal_service_marker','journal_logfmt_private','journal_logfmt_bad_quote','journal_partial_id'):
    row['MESSAGE']='level=info msg="shim disconnected" id='+'c'*64+' error="PRIVATE"'
    if case=='journal_logfmt_private':row['MESSAGE']='level=info msg="shim disconnected" error="PRIVATE id='+'c'*64+'"'
    if case=='journal_logfmt_bad_quote':row['MESSAGE']='level=info msg="shim disconnected" error="PRIVATE id='+'c'*64
    if case=='journal_partial_id':row['MESSAGE']='level=info msg="shim disconnected" id='+'c'*12
    rows=[row]
   if services and case in ('journal_task','journal_exec','journal_unit','journal_task_bool','journal_task_zero'):
    payload={'topic':'/tasks/exit','event':{'container_id':'c'*64,'id':'c'*64,'pid':77,'exit_status':0,'private':'PRIVATE'}}
    if case=='journal_exec':payload['event']['id']='PRIVATE_EXEC'
    if case=='journal_task_bool':payload['event']['pid']=True
    if case=='journal_task_zero':payload['event']['pid']=0
    if case=='journal_unit':row['_SYSTEMD_UNIT']='PRIVATE_SERVICE'
    row['MESSAGE']=json.dumps(payload);rows=[row]
  return b'\n'.join(encoded(row) for row in rows),{'available':True,'reason':None}
 m.photo_journal_capture=journal_capture
 def snapshot():
  return {str(path.relative_to(base)):(sha(path.read_bytes()),path.lstat().st_ino,path.lstat().st_mtime_ns,
    path.lstat().st_ctime_ns,stat.S_IMODE(path.lstat().st_mode)) for path in base.rglob('*') if path.is_file()}
 before=snapshot();output=io.StringIO();caught=None;measured_before=datetime.datetime.now(datetime.timezone.utc)
 try:
  with contextlib.redirect_stdout(output):m.photo_attempt_only()
 except Exception as error:caught=error
 failures={'wrong_selector','plan_pin','rollback_pin','speed_pin','source_pin','speed_symlink','health_before','health_after','proof_changed','retained_mismatch','retained_changed'}
 if case in failures:
  assert caught is not None,case
  assert output.getvalue()=='',output.getvalue()
  assert capacity_calls==[]
  if case not in {'health_after','proof_changed','retained_changed'}:assert 'events' not in calls,calls
 else:
  assert caught is None,repr(caught)
  raw=output.getvalue();assert token not in raw and 'PRIVATE' not in raw.replace('__NEXT_PRIVATE_CPU_PROFILE','PROFILE_FLAG'),raw
  result=json.loads(raw)
  assert result['kind']=='photo-release-attempt-readonly-v1'
  if case=='lock_busy':
   assert result['status']=='skipped_runtime_busy' and result['runtimeLockBusy'] and calls==[]
   assert capacity_calls==[] and 'measuredAt' not in result
  else:
   assert result['status']=='observed' and result['retainedHealthBoundBeforeAfter']
   assert capacity_calls==['/'] and result['diskFreeBytes']==11*4096 and result['diskTotalBytes']==23*4096
   assert result['measuredAt'].endswith('Z')
   measured_at=datetime.datetime.fromisoformat(result['measuredAt'].replace('Z','+00:00'))
   assert measured_before<=measured_at<=datetime.datetime.now(datetime.timezone.utc)
   assert calls[:3]==['health','inspect','events'] and calls[-2:]==['health','inspect'],calls
   has_identity=not case.startswith('events_') or case=='events_nano'
   expected_journal_calls=['journal:container'] if case=='journal_line_limit' else ['journal:container','journal:services']
   assert calls[3:-2]==(expected_journal_calls if has_identity else []),calls
   assert result['retainedLaunch']['evidenceKind']=='current_retained_reconstruction'
   assert result['retainedLaunch']['historicalCandidateSnapshot'] is False
   launch=result['retainedLaunch']
   if case=='argv_private':assert launch['argvClass']=='shell_wrapper' and not launch['matchesExpectedStandalone'] and 'knownSafeArgv' not in launch
   else:assert launch['argvClass']=='node_standalone' and launch['matchesExpectedStandalone']
   if case=='preload_flags':assert all(row=={'present':True,'truthy':True} for row in launch['environmentFlags'].values()) and launch['nodeOptions']['preloadPresent'] is True
   if case=='preload_invalid':assert launch['nodeOptions']=={'present':True,'parseSucceeded':False,'preloadPresent':None}
   if not has_identity:assert result['historicalJournal']['status']=='candidate_identity_unavailable'
   else:
    journal=result['historicalJournal'];assert journal['causeDetermined'] is False
    if case=='journal_private':assert journal['sources']['container']['categories']=={'home_initial_catalog_failed':1}
    elif case=='journal_task':
     task=journal['sources']['services']['taskExits'][0]
     assert task['pid']==77 and task['status']==0 and task['pidSource']=='task_exit_payload'
    else:assert all(not value.get('taskExits') for value in journal['sources'].values())
    if case in ('journal_identity','journal_boundary'):assert journal['sources']['container']['rejectedLines']==1
    if case=='journal_unit':assert journal['sources']['services']['rejectedLines']==1
    if case=='journal_task_zero':assert journal['sources']['services']['categories']=={} and journal['sources']['services']['unclassifiedLines']==1
    if case=='journal_partial_id':assert journal['sources']['services']['rejectedLines']==1
    if case=='journal_service_marker':assert journal['sources']['services']['categories']=={'containerd_shim_disconnected':1}
    if case in ('journal_logfmt_private','journal_logfmt_bad_quote'):assert journal['sources']['services']['categories']=={}
    if case=='journal_line_limit':assert journal['sources']['container']['linesRead']==2048 and journal['sources']['container']['limited'] and journal['sources']['services']['reason']=='capture_limit'
    if not case.startswith('journal_'):assert journal['status']=='no_retained_failure_evidence'
   assert result['proofSha256']==m.PHOTO_ATTEMPT_PROOFS and result['sourceSha256']==m.PHOTO_SPEED_SOURCES
   assert result['savedSpeedResultWrittenAt']==('2026-11-25T19:49:30.423540Z' if case=='nano_order' else '2026-11-25T19:49:30Z')
   assert result['savedSpeedResultWrittenTimeNano']==str(written_ns) and result['rolledBackAt']=='2026-11-25T19:50:10Z'
   assert result['events']['since']==at-60 and result['events']['until']==at+42
   for key in ('historyIsFinite','emptyDoesNotExcludeFailure','exit137DoesNotProveOom','postFailureTerminalEventsMayBeCleanup'):
    assert result['events'][key] is True
   if case=='events_empty':assert result['events']['available'] and result['events']['reason']=='empty' and result['events']['rows']==[]
   elif case=='events_nano':
    assert result['events']['available']
    assert result['events']['rows'][1]=={'action':'oom','time':at-2,'exitCode':None,'oom':True,'timeNano':str((at-2)*1_000_000_000+123456789)}
   elif case=='nano_order':
    before_nano,after_nano=[row['timeNano'] for row in result['events']['rows']]
    assert type(before_nano) is str and type(after_nano) is str
    assert int(before_nano)+1==int(result['savedSpeedResultWrittenTimeNano'])==int(after_nano)-1
    assert float(before_nano)==float(after_nano),'fixture must expose lost Number precision'
   elif case.startswith('events_'):assert not result['events']['available'] and result['events']['rows']==[]
   elif case=='cleanup_only':assert result['events']['rows'][0]=={'action':'die','time':at+10,'exitCode':137,'oom':False}
   else:assert result['events']['rows'][1]=={'action':'oom','time':at-2,'exitCode':None,'oom':True}
   if case=='startup_missing':assert result['startup']=={'present':False}
   elif case=='startup_private':assert result['startup']['present'] and not result['startup']['valid']
   else:assert result['startup']['value']==startup
   if case=='timing_missing':assert result['homePhaseTiming']=={'present':False}
   elif case.startswith('timing_'):assert result['homePhaseTiming']['present'] and not result['homePhaseTiming']['valid']
   else:
    assert result['homePhaseTiming']['valid'] and result['homePhaseTiming']['value']=={k:v for k,v in timing.items() if k!='nonce'}
 if case!='proof_changed':assert snapshot()==before,'diagnosis changed files'
 if case in ('capture_byte_limit','capture_timeout'):
  class Stream:
   def fileno(self):return 987654
   def close(self):pass
  class Child:
   stdout=Stream();returncode=None
   def kill(self):self.returncode=-9
   def poll(self):return self.returncode
   def wait(self,timeout):self.returncode=0 if self.returncode is None else self.returncode;return self.returncode
  child=Child();pending=bytearray(b'x'*32)
  def popen(args,**kwargs):
   assert args==['/usr/bin/journalctl','--no-pager'];assert kwargs['stdin']==m.subprocess.DEVNULL and kwargs['stderr']==m.subprocess.DEVNULL
   return child
  def ready(reads,*args):return ([],[],[]) if case=='capture_timeout' else (reads,[],[])
  real_read=os.read
  def read(fd,size):
   if fd!=987654:return real_read(fd,size)
   result=bytes(pending[:size]);del pending[:size];return result
  m.subprocess.Popen=popen;m.select.select=ready;m.os.read=read
  raw,metadata=original_capture(['--no-pager'],16,m.time.monotonic()+15)
  m.os.read=real_read
  assert len(raw)<=16 and not metadata['available'] and child.returncode==-9
  assert metadata['reason']==('byte_limit' if case=='capture_byte_limit' else 'timeout')
print('ok')
`;

for (const name of ['safe', 'startup_missing', 'startup_private', 'timing_missing', 'timing_private', 'timing_nonce',
  'timing_runtime', 'timing_phase', 'timing_number', 'timing_date', 'wrong_selector', 'plan_pin', 'rollback_pin',
  'speed_pin', 'source_pin', 'speed_symlink', 'health_before', 'health_after', 'proof_changed', 'lock_busy',
  'events_empty', 'events_foreign', 'events_action', 'events_window', 'events_exit', 'events_oversized', 'cleanup_only',
  'events_nano', 'events_nano_second', 'events_nano_float', 'events_nano_string', 'events_nano_bool',
  'events_nano_null', 'events_nano_negative', 'nano_order', 'events_identity', 'events_ambiguous',
  'retained_mismatch', 'retained_changed', 'argv_private', 'preload_flags', 'preload_invalid',
  'journal_private', 'journal_identity', 'journal_boundary', 'journal_pid', 'journal_task', 'journal_exec',
  'journal_unit', 'journal_task_bool', 'journal_task_zero', 'journal_service_marker', 'journal_logfmt_private',
  'journal_logfmt_bad_quote', 'journal_partial_id', 'journal_line_limit', 'capture_byte_limit', 'capture_timeout']) {
  test('one failed photo attempt, read-only: ' + name, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, script, name, gate, baseline],
      {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'ok');
  });
}
