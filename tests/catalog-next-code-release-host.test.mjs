import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hostFile=fileURLToPath(new URL('../scripts/catalog-next/release-host.py',import.meta.url));
// The real host controller, immutable copy and receipt readers run against
// isolated files. All Docker, health, subprocess and socket I/O is substituted.
const harness=String.raw`
import base64,copy,importlib.util,io,json,os,pathlib,stat,sys,tempfile,types
spec=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def refused(fn,code):
 try:fn()
 except m.ReleaseError as e:assert str(e)=='china_host_'+code,str(e)
 else:raise AssertionError('required rejection: '+code)
def forbidden(*a,**k):raise AssertionError('external I/O forbidden')
old,new,pricing='a'*40,'b'*40,'c'*40
old_image,new_image='sha256:'+'1'*64,'sha256:'+'2'*64
old_nonce,new_nonce='3'*32,'4'*32
old_id,new_id='5'*64,'6'*64
case=sys.argv[2]
baseline='32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'
encyclopedia_sha='66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c'
build='7'*64
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp);root.chmod(0o700);m.BASE=root/'releases';m.BASE.mkdir(mode=0o700)
 m.CONFIG=root/'nginx';original=b'location / {\n proxy_pass http://127.0.0.1:3004;\n}\n';m.CONFIG.write_bytes(original)
 lock=root/'lock';lock.write_bytes(b'');real_open=m.os.open
 m.os.open=lambda p,*a,**k:real_open(lock if str(p)=='/run/lock/avtocena-runtime-change.lock' else p,*a,**k)
 real_fstat=m.os.fstat;lock_inode=(lock.stat().st_dev,lock.stat().st_ino)
 def fstat(fd):
  info=real_fstat(fd)
  if (info.st_dev,info.st_ino)==lock_inode:return types.SimpleNamespace(**{name:(0 if name=='st_uid' else getattr(info,name)) for name in dir(info) if name.startswith('st_')})
  return info
 m.os.fstat=fstat
 enc=root/'encyclopedia';enc.write_bytes(b'private untouched knowledge');enc.chmod(0o400)
 def regular(p,maximum=None):
  s=p.lstat();assert p.resolve().is_relative_to(root) and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not p.is_symlink()
  if maximum is not None:assert s.st_size<=maximum
  return s
 m.regular=regular
 m.private_directory=lambda p: m.need(p.resolve().is_relative_to(root) and p.is_dir() and not p.stat().st_mode&0o022,'test_directory')
 real_sha=m.file_sha;m.file_sha=lambda p:encyclopedia_sha if p==enc else real_sha(p)
 generation={'version':1,'kind':'china-local-generation-v1','market':'china','generationId':'gen_china_123_1','runtimeSha':pricing,
  'prepared':True,'rows':10,'calculationVersion':build,'source':{'supplierLatestVerified':True,'cursor':8,'sourceObservedAt':'2026-11-24T00:00:00Z'}}
 manifest=m.json_bytes(generation);manifest_sha=m.sha(manifest)
 oracle={'version':1,'kind':'local-native-reader-http-expectations-v1','runtimeSha':old,'pricingRuntimeSha':pricing,
  'generationManifestSha256':manifest_sha,'expectedGeneration':generation['generationId'],'syntheticExpectations':True,'httpVerified':False,
  'cases':[{'name':'case-'+str(i),'path':'/api/catalog/search?market=china&page='+str(i+1),'total':10,
    'ids':['public-offer-'+str(i)],'totalRub':[1000000+i]} for i in range(8)]}
 def descriptor(name,raw):return {'name':name,'bytes':len(raw),'sha256':baseline if name=='accepted-speed-baseline.json' else m.sha(raw),'compressedBytes':len(raw)+10,'compressedSha256':'8'*64}
 def location(runtime,nonce):
  p=m.BASE/runtime/'china-next'/nonce;p.mkdir(mode=0o700,parents=True)
  for v in (p.parent.parent,p.parent):v.chmod(0o700)
  (p/'generation').mkdir(mode=0o700);return p
 old_dir=location(old,old_nonce);new_dir=location(new,new_nonce)
 old_bytes={name:(manifest if name=='GENERATION.json' else m.json_bytes(oracle) if name=='acceptance.json' else ('old immutable '+name).encode()) for name in m.FILE_NAMES}
 for name,raw in old_bytes.items():m.new_file((old_dir/'generation' if name in m.GENERATION_FILES else old_dir)/name,raw)
 old_plan={'version':1,'market':'china','retainedRuntime':m.RETAINED,'runtimeSha':old,'pricingRuntimeSha':pricing,'runtimeTree':'d'*40,
  'controllerSha':'e'*40,'runtimeDiffSha256':'f'*64,'servingCalculationVersion':m.CALCULATION,'generationId':generation['generationId'],
  'generationManifestSha256':manifest_sha,'privateGenerationReceiptSha256':'9'*64,'sourceDescriptorSha256':'a'*64,
  'imageId':old_image,'nonce':old_nonce,'files':[descriptor(name,raw) for name,raw in old_bytes.items()]}
 m.new_file(old_dir/'PLAN.json',m.json_bytes(old_plan));m.validate_plan(old_plan)
 def reports(runtime,nonce):
  speed=m.json_bytes({'release':runtime,'passed':True,'browserPassed':True,'speedGuard':{'passed':True}})
  details={'kind':'china-browser-details-v1','release':runtime,'nonce':nonce,'passed':True,'generationManifestSha256':manifest_sha,'precedingSpeedReportSha256':m.sha(speed)}
  if runtime==new and plan.get('codeScope')==m.PHOTO_JAPAN_CODE_SCOPE:
   photo=m.json_bytes({'version':1,'kind':'china-photo-japan-browser-v1','release':runtime,'nonce':nonce,
    'generationManifestSha256':manifest_sha,'oracleSha256':next(d['sha256'] for d in plan['files'] if d['name']=='acceptance.json'),
    'passed':True,'chinaPhotoPassed':True,'japanFreshnessPassed':True,'japanPowerApiPassed':True,'japanUiPassed':True})
   details.update(photoJapanReportBase64=base64.b64encode(photo).decode(),photoJapanReportSha256=m.sha(photo))
  detail=m.json_bytes(details)
  verdict={'release':runtime,'nonce':nonce,'passed':True,'functionalPassed':True,'speedPassed':True,
    'reportSha256':m.sha(speed+detail),'speedReportSha256':m.sha(speed),'detailsReportSha256':m.sha(detail)}
  return speed,detail,verdict
 speed,detail,old_verdict=reports(old,old_nonce)
 m.new_file(old_dir/'BROWSER_SPEED.json',speed);m.new_file(old_dir/'BROWSER_DETAILS.json',detail)
 old_receipt={'version':1,'kind':'china-host-acceptance-v1','release':old,'pricingRuntimeSha':pricing,'imageId':old_image,'generationId':generation['generationId'],
  'generationManifestSha256':manifest_sha,'privateGenerationReceiptSha256':'9'*64,'sourceDescriptorSha256':'a'*64,'sourceCursor':8,
  'sourceObservedAt':generation['source']['sourceObservedAt'],'nonce':old_nonce,'browser':old_verdict,'acceptedAt':'2026-11-25T00:00:00Z','retainedContainerId':'0'*64}
 old_raw=m.json_bytes(old_receipt);m.new_file(old_dir/'ACCEPTED.json',old_raw)
 reference={'market':'china','generationId':generation['generationId'],'owner':{'runId':'123','attempt':1,'revision':'f'*40},
  'receiptSha256':'9'*64,'sourceDescriptorSha256':'a'*64,'generationManifestSha256':manifest_sha,'sourceCursor':8,
  'sourceObservedAt':generation['source']['sourceObservedAt'],'runtimeSha':old,'pricingRuntimeSha':pricing,'imageId':old_image,
  'proof':{'kind':'china-accepted-proof-v1','hostReceiptBase64':base64.b64encode(old_raw).decode(),'hostReceiptSha256':m.sha(old_raw)}}
 prior={'version':1,'kind':'china-accepted-state-v1','market':'china','revision':2,'pending':None,'current':reference,'rollback':None,
  'commit':{'nonce':old_nonce,'acceptedAt':old_receipt['acceptedAt'],'intentSha256':'b'*64}}
 observation={'found':True,'value':prior,'etag':'"old-state"','sha256':m.canonical_sha(prior)}
 image_receipt={'version':1,'kind':'china-runtime-image-v1','market':'china','runtimeSha':new,'pricingRuntimeSha':pricing,'runtimeTree':'d'*40,
  'runtimeDiffSha256':'f'*64,'retainedRuntime':old,'imageId':new_image,'platform':'linux/amd64','archiveRoundTripVerified':True,
  'protectedPathsUnchanged':True,'privateDataIncluded':False,'servingCompatibility':{'protectedPricingPathsUnchanged':True},
  'runtimeFiles':sorted(m.PHOTO_CODE_FILES),'imageUnpackedBytes':1024,'bytes':13,'sha256':m.sha(b'new image tar')}
 if case.startswith('combined_'):
  assert len(m.PHOTO_CODE_FILES)==6 and len(m.PHOTO_JAPAN_CODE_FILES)==27
  image_receipt.update(codeScope=m.PHOTO_JAPAN_CODE_SCOPE,runtimeFiles=sorted(m.PHOTO_JAPAN_CODE_FILES))
 elif case=='photo_explicit':image_receipt['codeScope']=m.PHOTO_CODE_SCOPE
 new_bytes={'image.tar':b'new image tar','image-receipt.json':m.json_bytes(image_receipt),'acceptance.json':m.json_bytes({**oracle,'runtimeSha':new}),
  'regcloud-performance-gate.py':b'fixed gate','accepted-speed-baseline.json':b'fixed baseline'}
 plan={**copy.deepcopy(old_plan),'mode':'code-update','retainedRuntime':old,'runtimeSha':new,'imageId':new_image,'nonce':new_nonce,
  'previousAcceptedState':copy.deepcopy(prior),'previousAcceptedETag':observation['etag'],'previousAcceptedStateSha256':observation['sha256'],
  'codeSourcePlanSha256':m.file_sha(old_dir/'PLAN.json'),'codeSourceOracleSha256':m.sha(old_bytes['acceptance.json']),
  'files':[copy.deepcopy(d) for d in old_plan['files'] if d['name'] in m.GENERATION_FILES]+[descriptor(name,raw) for name,raw in new_bytes.items()]}
 if 'codeScope' in image_receipt:plan['codeScope']=image_receipt['codeScope']
 for name,raw in new_bytes.items():m.new_file(new_dir/name,raw)
 m.new_file(new_dir/'PLAN.json',m.json_bytes(plan));m.validate_plan(plan)
 def make_container(identity,runtime,image,nonce,directory,port):
  mounts=[{'Type':'bind','Source':str(enc),'Destination':'/app/data/knowledge/encyclopedia/calculation-v1.json','RW':False,'Mode':'ro'},
   {'Type':'bind','Source':str(directory/'generation'),'Destination':m.GENERATION_MOUNT,'RW':False,'Mode':'ro'}]
  return {'Id':identity,'Image':image,'Config':{'WorkingDir':'/app','User':'root','Entrypoint':None,'Cmd':['node','server.js'],
   'Env':['PRIVATE=preserved','AVTOCENA_RELEASE_SHA='+runtime,'AVTOCENA_CALCULATION_VERSION='+m.CALCULATION,'AVTOCENA_BUILD_CALCULATION_VERSION='+build,
    'CATALOG_CHINA_LOCAL_RUNTIME_SHA='+pricing,'CATALOG_CHINA_LOCAL_MANIFEST_SHA256='+manifest_sha,'CATALOG_CHINA_LOCAL_GENERATION_DIR='+m.GENERATION_MOUNT],
   'Labels':{'avtocena.application':'web','avtocena.role':'independent-china','org.opencontainers.image.revision':runtime,'avtocena.china.nonce':nonce}},
   'HostConfig':{'Privileged':False,'Binds':[x['Source']+':'+x['Destination']+':ro' for x in mounts],
    'PortBindings':{'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':str(port)}]},'RestartPolicy':{'Name':'unless-stopped'}},
   'Mounts':mounts,'State':{'Running':True,'Pid':port,'StartedAt':'2026-11-25T00:00:00Z'},'RestartCount':0}
 old_container=make_container(old_id,old,old_image,old_nonce,old_dir,3004);retained_before=copy.deepcopy(old_container)
 containers={old_id:old_container};operations=[]
 def docker(method,target,body=None):
  operations.append((method,target))
  if method=='GET' and target=='/containers/json?all=1':return [{'Id':k} for k in containers]
  if method=='GET' and target=='/info':return {'ServerVersion':'29.1.3','DriverStatus':[['driver-type','io.containerd.snapshotter.v1']]}
  if method=='GET' and target.startswith('/images/'):
   assert target=='/images/'+new_image+'/json';return {'Id':new_image,'Descriptor':{'digest':new_image},'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':new}}}
  if method=='GET' and target.endswith('/json'):return copy.deepcopy(containers[target.split('/')[2]])
  if method=='POST' and target.startswith('/containers/create?'):
   row=make_container(new_id,new,new_image,new_nonce,new_dir,int(body['HostConfig']['PortBindings']['3000/tcp'][0]['HostPort']))
   row['Config'].update({k:copy.deepcopy(body[k]) for k in ('Env','Entrypoint','Cmd','Labels')});row['HostConfig']=copy.deepcopy(body['HostConfig']);containers[new_id]=row;return {'Id':new_id}
  identity=target.split('/')[2].split('?')[0]
  if method=='POST' and target.endswith('/start'):return None
  if method=='POST' and target.endswith('/update'):containers[identity]['HostConfig']['RestartPolicy']=body['RestartPolicy'];return None
  if method=='POST' and '/stop?' in target:containers[identity]['State']['Running']=False;return None
  if method=='DELETE':del containers[identity];return None
  raise AssertionError('unexpected Docker operation')
 m.docker=docker
 m.health=lambda port,release: m.need(any(int(x['HostConfig']['PortBindings']['3000/tcp'][0]['HostPort'])==port and m.env_map(x)['AVTOCENA_RELEASE_SHA']==release and x['State']['Running'] for x in containers.values()),'test_health')
 def command(args,timeout=120):
  assert args in (['/usr/bin/docker','load','--input',str(new_dir/'image.tar')],['/usr/sbin/nginx','-t'],['/usr/bin/systemctl','reload','nginx'])
  operations.append(('command',args));return b''
 m.command=command;m.subprocess.run=forbidden
 class Socket:
  def __enter__(self):return self
  def __exit__(self,*args):pass
  def bind(self,address):assert address[0]=='127.0.0.1'
 m.socket.socket=lambda *args:Socket()
 host=m.Host.__new__(m.Host);host.initialize_session(plan);host.uploaded=set(m.CODE_UPLOAD_FILES)
 host.wait_startup=lambda:setattr(host,'startup_report',{'health':'ready'})
 def prepare_only():
  host.lock=real_open(lock,os.O_RDONLY);host.retained=copy.deepcopy(containers[old_id]);host.retained_identity=m.protected_identity(host.retained)
  host.original=original;host.old_port=3004;host.prepare_code_generation()
 def overwrite(name,raw):
  path=new_dir/name;path.chmod(0o600);path.write_bytes(raw);path.chmod(0o400)
  next(d for d in plan['files'] if d['name']==name).update(descriptor(name,raw))
 def finish():
  host.functional_passed=host.speed_passed=True;host.switch()
  speed,details,verdict=reports(new,new_nonce)
  host.browser_evidence({'speedBase64':base64.b64encode(speed).decode(),'detailsBase64':base64.b64encode(details).decode()})
  result=host.accept(verdict);receipt=json.loads(base64.b64decode(result['hostReceiptBase64']))
  current={**copy.deepcopy(reference),'runtimeSha':new,'imageId':new_image,'proof':{'kind':'china-accepted-proof-v1','hostReceiptBase64':result['hostReceiptBase64'],'hostReceiptSha256':result['hostReceiptSha256']}}
  state={'version':1,'kind':'china-accepted-state-v1','market':'china','revision':4,'pending':None,'current':current,'rollback':copy.deepcopy(reference),
   'commit':{'nonce':new_nonce,'acceptedAt':result['acceptedAt'],'intentSha256':'c'*64,'previousETag':observation['etag'],'previousStateSha256':observation['sha256']}}
  return receipt,current,state
 if case=='scope':
  assert len(m.described_files(plan))==12 and len(m.expected_files(plan))==5
  for key,value in [('runtimeSha',old),('imageId',old_image),('generationId','gen_china_124_1'),('pricingRuntimeSha','9'*40),('sourceDescriptorSha256','b'*64)]:
   bad=copy.deepcopy(plan);bad[key]=value;refused(lambda:m.validate_plan(bad),'code_only_identity')
  for value in ('caller-defined-scope',None,{}):
   bad=copy.deepcopy(plan);bad['codeScope']=value;refused(lambda:m.validate_plan(bad),'code_scope')
  refused(lambda:host.upload('details.sqlite',io.BytesIO()),'upload_scope')
 elif case=='preflight':
  before={str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
  result=m.code_preflight({'previousAccepted':observation});assert result['generationId']==generation['generationId'] and result['generationWrites']==0 and result['supplierRequests']==0
  assert base64.b64decode(result['acceptanceBase64'])==old_bytes['acceptance.json'] and len(result['generationFiles'])==7
  assert all(method=='GET' for method,target in operations)
  assert before=={str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
 elif case in ('copy','oracle_tamper','descriptor_tamper','source_tamper','image_scope','disk_space','plan_changed','combined_extra','combined_relabel','combined_unbound','photo_relabel'):
  expected=None
  if case=='oracle_tamper':
   bad={**copy.deepcopy(oracle),'runtimeSha':new};bad['cases'][0]['totalRub'][0]+=1;overwrite('acceptance.json',m.json_bytes(bad));expected='code_oracle_scope'
  if case=='descriptor_tamper':next(d for d in plan['files'] if d['name']=='query.sqlite')['bytes']+=1;expected='code_generation_descriptors'
  if case=='source_tamper':
   target=old_dir/'generation'/'details.sqlite';target.chmod(0o600);target.write_bytes(b'x'*len(old_bytes['details.sqlite']));target.chmod(0o400);expected='reuse_copy_hash'
  if case=='image_scope':image_receipt['runtimeFiles'][0]='apps/web/lib/catalog/storage.ts';overwrite('image-receipt.json',m.json_bytes(image_receipt));expected='code_image_receipt'
  if case=='combined_extra':image_receipt['runtimeFiles'].append('apps/web/lib/catalog/unrelated.ts');overwrite('image-receipt.json',m.json_bytes(image_receipt));expected='code_image_receipt'
  if case=='combined_relabel':image_receipt['codeScope']=m.PHOTO_CODE_SCOPE;overwrite('image-receipt.json',m.json_bytes(image_receipt));expected='code_image_receipt'
  if case=='combined_unbound':plan.pop('codeScope');expected='code_image_receipt'
  if case=='photo_relabel':
   plan['codeScope']=image_receipt['codeScope']=m.PHOTO_JAPAN_CODE_SCOPE;overwrite('image-receipt.json',m.json_bytes(image_receipt));expected='code_image_receipt'
  if case=='disk_space':m.os.statvfs=lambda p:types.SimpleNamespace(f_bavail=0,f_frsize=4096);expected='code_disk_space'
  if case=='plan_changed':plan['codeSourcePlanSha256']='0'*64;expected='code_source_plan_changed'
  if expected:refused(prepare_only,expected);assert host.candidate is None and m.CONFIG.read_bytes()==original
  else:
   prepare_only();assert host.code_generation_copy['files']==7
   for name in m.GENERATION_FILES:
    a,b=old_dir/'generation'/name,new_dir/'generation'/name
    assert a.read_bytes()==b.read_bytes() and a.stat().st_ino!=b.stat().st_ino and a.stat().st_nlink==b.stat().st_nlink==1 and stat.S_IMODE(b.stat().st_mode)==0o400
 elif case=='combined_browser_rejections':
  host.start();host.functional_passed=host.speed_passed=True;host.switch()
  speed,details,_=reports(new,new_nonce);details=json.loads(details)
  photo=json.loads(base64.b64decode(details['photoJapanReportBase64']));bad_cases=[]
  for missing in ('photoJapanReportBase64','photoJapanReportSha256'):
   bad=copy.deepcopy(details);bad.pop(missing);bad_cases.append((bad,'photo_japan_browser_binding'))
  bad_cases.append(({**details,'photoJapanReportSha256':'0'*64},'photo_japan_browser_binding'))
  for field,value in [('version',2),('kind','wrong-kind'),('release',old),('nonce',old_nonce),
   ('generationManifestSha256','0'*64),('oracleSha256','0'*64)]+[(key,False) for key in ('passed','chinaPhotoPassed','japanFreshnessPassed','japanPowerApiPassed','japanUiPassed')]:
   changed=m.json_bytes({**photo,field:value})
   bad_cases.append(({**details,'photoJapanReportBase64':base64.b64encode(changed).decode(),'photoJapanReportSha256':m.sha(changed)},'photo_japan_browser_binding'))
  bad_cases.append(({**details,'photoJapanReportBase64':'!!!'},'browser_evidence_encoding'))
  oversized=m.json_bytes({**photo,'padding':'x'*(256*1024)})
  bad_cases.append(({**details,'photoJapanReportBase64':base64.b64encode(oversized).decode(),'photoJapanReportSha256':m.sha(oversized)},'browser_evidence_size'))
  for bad,expected in bad_cases:
   refused(lambda:host.browser_evidence({'speedBase64':base64.b64encode(speed).decode(),'detailsBase64':base64.b64encode(m.json_bytes(bad)).decode()}),expected)
   assert not (new_dir/'BROWSER_SPEED.json').exists() and not (new_dir/'BROWSER_DETAILS.json').exists() and not host.accepted
  host.cleanup();assert m.CONFIG.read_bytes()==original and new_id not in containers and old_container==retained_before
 elif case in ('start','rollback','accept','proof_required','code_proof_changed_generation','code_proof_missing_rollback','next_daily','retire_copy','combined_accept','photo_explicit'):
  result=host.start();assert result['codeGenerationCopy']['sourceDownloads']==0
  assert old_container==retained_before
  expected_env=[x.replace('AVTOCENA_RELEASE_SHA='+old,'AVTOCENA_RELEASE_SHA='+new) for x in retained_before['Config']['Env']]
  assert host.spec['Env']==expected_env and host.spec['Image']==new_image
  assert host.spec['HostConfig']['Binds']==[x.replace(str(old_dir/'generation'),str(new_dir/'generation')) for x in retained_before['HostConfig']['Binds']]
  if case=='rollback':
   host.functional_passed=host.speed_passed=True;host.switch();host.cleanup()
   assert m.CONFIG.read_bytes()==original and old_container==retained_before and new_id not in containers
   outcome=m.read_outcome({'runtimeSha':new,'nonce':new_nonce});assert outcome['status']=='rolled_back'
   proof=json.loads(base64.b64decode(outcome['hostRollbackBase64']));assert proof['retainedRuntimeSha']==old and proof['retainedImageId']==old_image and proof['generationId']==generation['generationId']
  elif case!='start':
   receipt,current,state=finish();assert receipt['transition']=='code-update' and receipt['retainedRuntimeSha']==old and receipt['retainedImageId']==old_image
   observed={'found':True,'value':state,'etag':'"new-state"','sha256':m.canonical_sha(state)};m.checked_accepted_observation(observed)
   assert m.read_outcome({'runtimeSha':new,'nonce':new_nonce})['status']=='accepted'
   if case=='proof_required':
    bad=copy.deepcopy(state);raw=json.loads(base64.b64decode(bad['current']['proof']['hostReceiptBase64']));raw.pop('transition');encoded=m.json_bytes(raw)
    bad['current']['proof'].update(hostReceiptBase64=base64.b64encode(encoded).decode(),hostReceiptSha256=m.sha(encoded))
    refused(lambda:m.checked_accepted_observation({'found':True,'value':bad,'etag':'"bad"','sha256':m.canonical_sha(bad)}),'retire_protected')
   elif case in ('code_proof_changed_generation','code_proof_missing_rollback'):
    bad=copy.deepcopy(state)
    if case=='code_proof_missing_rollback':bad['rollback']=None
    else:
     bad['current']['generationId']='gen_china_124_1'
     raw=json.loads(base64.b64decode(bad['current']['proof']['hostReceiptBase64']));raw['generationId']=bad['current']['generationId'];encoded=m.json_bytes(raw)
     bad['current']['proof'].update(hostReceiptBase64=base64.b64encode(encoded).decode(),hostReceiptSha256=m.sha(encoded))
    refused(lambda:m.checked_accepted_observation({'found':True,'value':bad,'etag':'"bad"','sha256':m.canonical_sha(bad)}),'retire_protected')
   elif case=='next_daily':
    daily={**copy.deepcopy(plan),'mode':'generation-update','retainedRuntime':new,'runtimeSha':new,'imageId':new_image,'nonce':'f'*32,
     'generationId':'gen_china_124_1','previousAcceptedState':state,'previousAcceptedETag':'"new-state"','previousAcceptedStateSha256':m.canonical_sha(state)}
    daily['files']=[d for d in daily['files'] if d['name'] not in ('image.tar','image-receipt.json')];m.validate_plan(daily)
    m.accepted_predecessor(daily);m.check_mounted_reference(containers[new_id],current,new_nonce)
   elif case=='retire_copy':
    refused(lambda:m.retire_reference(reference,[reference,current],{old_id,new_id},lambda:None),'retire_protected')
    before={name:(new_dir/'generation'/name).read_bytes() for name in m.GENERATION_FILES}
    removed=m.retire_reference(reference,[current],{new_id},lambda:m.verify_live_reference(current,new_nonce))
    assert removed['retiredContainers']==1 and old_id not in containers and new_id in containers
    assert all((new_dir/'generation'/name).read_bytes()==raw for name,raw in before.items())
    assert (old_dir/'ACCEPTED.json').exists() and (old_dir/'PLAN.json').exists() and enc.read_bytes()==b'private untouched knowledge'
 else:raise AssertionError('unknown case')
 print('ok')
`;
for(const name of ['scope','preflight','copy','oracle_tamper','descriptor_tamper','source_tamper','image_scope','disk_space','plan_changed','start','rollback','accept','proof_required','code_proof_changed_generation','code_proof_missing_rollback','next_daily','retire_copy','combined_accept','photo_explicit','combined_extra','combined_relabel','combined_unbound','photo_relabel','combined_browser_rejections']) {
  test('China code-only host: '+name,()=>{
    const result=spawnSync('python3',['-I','-B','-c',harness,hostFile,name],{encoding:'utf8',timeout:20000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.equal(result.stdout.trim(),'ok');
  });
}
