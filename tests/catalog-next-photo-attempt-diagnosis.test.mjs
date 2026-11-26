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
  'privateFixture':'PRIVATE_ROLLBACK'}
 speed={'exitCode':1,'samples':[{'performanceRequest':'failed','path':'/','seconds':31.1338,'errorType':'IncompleteRead'}]}
 # Private PLAN/rollback bytes are unavailable offline. Substitute fixture pins
 # once, then exercise the same equality checks, including tampering failures.
 m.PHOTO_ATTEMPT_PROOFS={name:put(name,value) for name,value in
  [('PLAN.json',plan),('ROLLED_BACK.json',rollback),('server-speed-result.json',speed)]}
 at=int(datetime.datetime(2026,11,25,19,49,30,tzinfo=datetime.timezone.utc).timestamp())
 os.utime(directory/'server-speed-result.json',(at,at))
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
 calls=[]
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
   assert method=='GET' and urlsplit(target).path=='/events';calls.append('events')
   query=parse_qs(urlsplit(target).query);since=int(query['since'][0]);until=int(query['until'][0])
   assert since==at-60 and until==at+42 and 0<until-since<=300
   filters=json.loads(query['filters'][0]);assert filters['type']==['container']
   assert filters['label']==['avtocena.china.nonce='+token,'org.opencontainers.image.revision='+plan['runtimeSha']]
  def getresponse(self):
   if case=='proof_changed':put('PLAN.json',{**plan,'changed':True})
   rows=[]
   for action,when,exitcode in [('start',at-50,None),('oom',at-2,None),('die',at-1,'137'),('destroy',at+20,None)]:
    attributes={'avtocena.china.nonce':token,'org.opencontainers.image.revision':plan['runtimeSha'],'private':'PRIVATE_EVENT'}
    if exitcode is not None:attributes['exitCode']=exitcode
    rows.append({'Type':'container','Action':action,'time':when,'Actor':{'Attributes':attributes},'private':'PRIVATE_EVENT'})
   if case=='cleanup_only':rows=[{**rows[2],'time':at+10},rows[3]]
   if case=='events_empty':rows=[]
   if case=='events_foreign':rows[0]['Actor']['Attributes']['avtocena.china.nonce']='b'*32
   if case=='events_action':rows[0]['Action']='PRIVATE_EVENT_ACTION'
   if case=='events_window':rows[0]['time']=at-61
   if case=='events_exit':rows[2]['Actor']['Attributes']['exitCode']='PRIVATE_EXIT'
   if case=='events_oversized':return Response(b'x'*(1024*1024+1))
   return Response(b'\n'.join(encoded(row) for row in rows))
  def close(self):pass
 m.http.client.HTTPConnection=Health;m.PhotoDocker=Events
 def snapshot():
  return {str(path.relative_to(base)):(sha(path.read_bytes()),path.lstat().st_ino,path.lstat().st_mtime_ns,
    path.lstat().st_ctime_ns,stat.S_IMODE(path.lstat().st_mode)) for path in base.rglob('*') if path.is_file()}
 before=snapshot();output=io.StringIO();caught=None
 try:
  with contextlib.redirect_stdout(output):m.photo_attempt_only()
 except Exception as error:caught=error
 failures={'wrong_selector','plan_pin','rollback_pin','speed_pin','source_pin','speed_symlink','health_before','health_after','proof_changed'}
 if case in failures:
  assert caught is not None,case
  assert output.getvalue()=='',output.getvalue()
  if case not in {'health_after','proof_changed'}:assert 'events' not in calls,calls
 else:
  assert caught is None,repr(caught)
  raw=output.getvalue();assert token not in raw and 'PRIVATE' not in raw,raw
  result=json.loads(raw)
  assert result['kind']=='photo-release-attempt-readonly-v1'
  if case=='lock_busy':
   assert result['status']=='skipped_runtime_busy' and result['runtimeLockBusy'] and calls==[]
  else:
   assert result['status']=='observed' and result['retainedHealthBoundBeforeAfter']
   assert calls==['health','events','health'],calls
   assert result['proofSha256']==m.PHOTO_ATTEMPT_PROOFS and result['sourceSha256']==m.PHOTO_SPEED_SOURCES
   assert result['savedSpeedResultWrittenAt']=='2026-11-25T19:49:30Z' and result['rolledBackAt']=='2026-11-25T19:50:10Z'
   assert result['events']['since']==at-60 and result['events']['until']==at+42
   for key in ('historyIsFinite','emptyDoesNotExcludeFailure','exit137DoesNotProveOom','postFailureTerminalEventsMayBeCleanup'):
    assert result['events'][key] is True
   if case=='events_empty':assert result['events']['available'] and result['events']['reason']=='empty' and result['events']['rows']==[]
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
print('ok')
`;

for (const name of ['safe', 'startup_missing', 'startup_private', 'timing_missing', 'timing_private', 'timing_nonce',
  'timing_runtime', 'timing_phase', 'timing_number', 'timing_date', 'wrong_selector', 'plan_pin', 'rollback_pin',
  'speed_pin', 'source_pin', 'speed_symlink', 'health_before', 'health_after', 'proof_changed', 'lock_busy',
  'events_empty', 'events_foreign', 'events_action', 'events_window', 'events_exit', 'events_oversized', 'cleanup_only']) {
  test('one failed photo attempt, read-only: ' + name, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, script, name, gate, baseline],
      {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'ok');
  });
}
