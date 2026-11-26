import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hostFile = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
// Real proof readers and image phase; Docker, public health and subprocess I/O
// are substituted. Files, immutable receipts and both flock locks are real.
const harness = String.raw`import base64,copy,importlib.util,json,os,pathlib,stat,sys,tempfile,types
spec=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
case=sys.argv[2]
rollback=case.startswith('rollback_')
if rollback:case=case[len('rollback_'):]
def forbidden(*a,**k):raise AssertionError('external I/O forbidden')
def refused(fn,part=None):
 try:fn()
 except m.ReleaseError as error:
  if part is not None:assert part in str(error),str(error)
 else:raise AssertionError('required refusal')
def obs(value,name):
 return {'found':True,'etag':'"'+name+'"','sha256':m.canonical_sha(value),'value':copy.deepcopy(value)}
policy=pathlib.Path(sys.argv[1]).parent.parent/'regcloud-release-retention.py'
policy_raw=policy.read_bytes()
assert m.sha(policy_raw)==m.APP_IMAGE_RETENTION_POLICY_SHA256
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp);root.chmod(0o700);m.BASE=root/'releases';m.BASE.mkdir(mode=0o700)
 m.CONFIG=root/'nginx';m.CONFIG.write_bytes(b'location / {\n proxy_pass http://127.0.0.1:3004;\n}\n')
 original_ingress=m.CONFIG.read_bytes()
 locks={}
 for name in ('avtocena-staging-prepare','avtocena-runtime-change'):
  locks['/run/lock/'+name+'.lock']=root/(name+'.lock');locks['/run/lock/'+name+'.lock'].write_bytes(b'')
 real_open=m.os.open
 m.os.open=lambda name,*a,**kw:real_open(locks.get(str(name),name),*a,**kw)
 real_fstat=m.os.fstat;lock_inodes={(p.stat().st_dev,p.stat().st_ino) for p in locks.values()}
 def fstat(fd):
  value=real_fstat(fd)
  if (value.st_dev,value.st_ino) in lock_inodes:
   return types.SimpleNamespace(**{key:0 if key=='st_uid' else getattr(value,key) for key in dir(value) if key.startswith('st_')})
  return value
 m.os.fstat=fstat
 def regular(p,maximum=None):
  value=p.lstat()
  m.need(p.resolve().is_relative_to(root) and stat.S_ISREG(value.st_mode) and value.st_nlink==1 and not p.is_symlink(),'fixture_regular')
  if maximum is not None:m.need(value.st_size<=maximum,'fixture_size')
  return value
 m.regular=regular
 m.private_directory=lambda p:m.need(p.resolve().is_relative_to(root) and p.is_dir() and not p.stat().st_mode&0o022,'fixture_directory')
 m.subprocess.run=forbidden
 m.health=lambda port,runtime:m.need(port==3004 and runtime=='b'*40,'fixture_health')
 pricing='c'*40
 baseline='32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'
 def write(p,raw):
  p.write_bytes(raw);p.chmod(0o400)
 def descriptor(name,raw):
  return {'name':name,'bytes':len(raw),'sha256':baseline if name=='accepted-speed-baseline.json' else m.sha(raw),
   'compressedBytes':len(raw)+10,'compressedSha256':'d'*64}
 def deployment(runtime,image,run,nonce,previous=None,failed=False,source=None):
  directory=m.BASE/runtime/'china-next'/nonce;directory.mkdir(mode=0o700,parents=True)
  for p in (directory.parent.parent,directory.parent):p.chmod(0o700)
  (directory/'generation').mkdir(mode=0o700)
  generation={'version':1,'kind':'china-local-generation-v1','market':'china','generationId':'gen_china_'+str(run)+'_1',
   'runtimeSha':pricing,'prepared':True,'rows':10,'source':{'cursor':run,'sourceObservedAt':'2026-11-26T00:00:00Z'}}
  if source is not None:generation=copy.deepcopy(source['generation'])
  raw=m.json_bytes(generation);manifest_sha=m.sha(raw)
  mode='code-update' if failed else 'generation-update' if previous else None
  plan={'version':1,'market':'china','retainedRuntime':previous['value']['current']['runtimeSha'] if previous else m.RETAINED,
   'runtimeSha':runtime,'pricingRuntimeSha':pricing,'runtimeTree':'d'*40,'controllerSha':'e'*40,'runtimeDiffSha256':'f'*64,
   'servingCalculationVersion':m.CALCULATION,'generationId':generation['generationId'],'generationManifestSha256':manifest_sha,
   'privateGenerationReceiptSha256':source['reference']['receiptSha256'] if source else m.sha(('receipt'+str(run)).encode()),
   'sourceDescriptorSha256':source['reference']['sourceDescriptorSha256'] if source else m.sha(('source'+str(run)).encode()),
   'imageId':image,'nonce':nonce}
  if mode:
   plan.update(mode=mode,previousAcceptedState=copy.deepcopy(previous['value']),previousAcceptedETag=previous['etag'],
    previousAcceptedStateSha256=previous['sha256'])
  if failed:plan.update(codeScope=m.PHOTO_CODE_SCOPE,codeSourcePlanSha256=m.sha((source['directory']/'PLAN.json').read_bytes()),
    codeSourceOracleSha256=m.sha((source['directory']/'acceptance.json').read_bytes()))
  files={}
  for name in m.described_files(plan):
   files[name]=raw if name=='GENERATION.json' else ('immutable '+str(run)+' '+name).encode()
   write((directory/'generation' if name in m.GENERATION_FILES else directory)/name,files[name])
  plan['files']=[descriptor(name,content) for name,content in files.items()]
  plan_raw=m.json_bytes(plan);write(directory/'PLAN.json',plan_raw);m.validate_plan(plan)
  reference={'market':'china','generationId':generation['generationId'],
   'owner':copy.deepcopy(source['reference']['owner']) if source else {'runId':str(run),'attempt':'1','revision':runtime},
   'receiptSha256':plan['privateGenerationReceiptSha256'],'sourceDescriptorSha256':plan['sourceDescriptorSha256'],
   'generationManifestSha256':manifest_sha,'sourceCursor':generation['source']['cursor'],
   'sourceObservedAt':generation['source']['sourceObservedAt'],'runtimeSha':runtime,'pricingRuntimeSha':pricing,'imageId':image}
  if not failed:
   speed=m.json_bytes({'release':runtime,'passed':True,'browserPassed':True,'speedGuard':{'passed':True}})
   detail=m.json_bytes({'kind':'china-browser-details-v1','release':runtime,'nonce':nonce,'passed':True,
    'generationManifestSha256':manifest_sha,'precedingSpeedReportSha256':m.sha(speed)})
   write(directory/'BROWSER_SPEED.json',speed);write(directory/'BROWSER_DETAILS.json',detail)
   receipt={'version':1,'kind':'china-host-acceptance-v1','release':runtime,'pricingRuntimeSha':pricing,'imageId':image,
    'generationId':reference['generationId'],'generationManifestSha256':manifest_sha,
    'privateGenerationReceiptSha256':reference['receiptSha256'],'sourceDescriptorSha256':reference['sourceDescriptorSha256'],
    'sourceCursor':reference['sourceCursor'],'sourceObservedAt':reference['sourceObservedAt'],'nonce':nonce,
    'acceptedAt':'2026-11-26T01:00:00Z','retainedContainerId':'0'*64,
    'browser':{'release':runtime,'nonce':nonce,'passed':True,'functionalPassed':True,'speedPassed':True,
     'reportSha256':m.sha(speed+detail),'speedReportSha256':m.sha(speed),'detailsReportSha256':m.sha(detail)}}
   if previous:receipt.update(retainedImageId=previous['value']['current']['imageId'])
   receipt_raw=m.json_bytes(receipt);write(directory/'ACCEPTED.json',receipt_raw)
   reference['proof']={'kind':'china-accepted-proof-v1','hostReceiptBase64':base64.b64encode(receipt_raw).decode(),
    'hostReceiptSha256':m.sha(receipt_raw)}
  return {'reference':reference,'directory':directory,'nonce':nonce,'plan':plan,'generation':generation}
 image_a='sha256:'+'1'*64;image_b='sha256:'+'2'*64;image_f='sha256:'+'3'*64
 if case=='shared_image':image_a=image_b
 a=deployment('a'*40,image_a,101,'1'*32)
 b=deployment('b'*40,image_b,102,'2'*32)
 # An already accepted historical B and its rollback A; the new C is the exact
 # successor whose plan/private intent bind this complete observation.
 previous={'version':1,'kind':'china-accepted-state-v1','market':'china','revision':3,'current':b['reference'],
  'rollback':a['reference'],'pending':None,'commit':{'nonce':b['nonce'],'acceptedAt':'2026-11-26T01:00:00Z','intentSha256':'4'*64}}
 previous=obs(previous,'before')
 target=deployment('f'*40,image_f,102,'4'*32,previous,True,b) if rollback else a
 current=b if rollback else deployment('b'*40,image_b,103,'3'*32,previous)
 candidate=copy.deepcopy(target['reference'] if rollback else current['reference']);candidate.pop('proof',None)
 pending={'version':1,'kind':'china-publication-intent-v1','market':'china','revision':4,
  'owner':{'runId':'104','attempt':'1','revision':'e'*40},'createdAt':'2026-11-26T01:00:00Z',
  'nonce':target['nonce'] if rollback else current['nonce'],'candidate':candidate,'previous':previous,'status':'pending','resolution':None}
 if rollback:
  pending['transition']='code-update'
  receipt={'version':1,'kind':'china-host-rollback-v1','release':candidate['runtimeSha'],'nonce':target['nonce'],
   'pricingRuntimeSha':pricing,'generationId':candidate['generationId'],'generationManifestSha256':candidate['generationManifestSha256'],
   'privateGenerationReceiptSha256':candidate['receiptSha256'],'sourceDescriptorSha256':candidate['sourceDescriptorSha256'],
   'imageId':candidate['imageId'],'previousAcceptedETag':previous['etag'],'previousAcceptedStateSha256':previous['sha256'],
   'retainedRuntimeSha':b['reference']['runtimeSha'],'retainedImageId':b['reference']['imageId'],
   'retainedContainerId':'5'*64,'rolledBackAt':'2026-11-26T01:00:00Z',
   'retainedRunning':True,'candidateRemoved':True,'ingressRestored':True}
  rollback_raw=m.json_bytes(receipt);write(target['directory']/'ROLLED_BACK.json',rollback_raw)
  cleanup={'version':1,'kind':'china-failed-code-bulk-cleanup-v1','runtimeSha':candidate['runtimeSha'],'nonce':target['nonce'],
   'planSha256':m.file_sha(target['directory']/'PLAN.json'),'rollbackSha256':m.sha(rollback_raw),
   'completed':True,'protectedDeploymentsPreserved':True,'imagesDeleted':0,'directoriesDeleted':0}
  write(target['directory']/'FAILED_CODE_CLEANUP.json',m.json_bytes(cleanup))
  state={**previous['value'],'revision':5,'pending':None}
  accepted=obs(state,'accepted')
  intent={**pending,'status':'aborted','resolution':{'kind':'rolled_back','at':'2026-11-26T01:00:00Z',
   'acceptedETag':accepted['etag'],'acceptedSha256':accepted['sha256'],'hostReceiptSha256':None,
   'rollbackProof':{'kind':'china-rollback-proof-v1','hostRollbackBase64':base64.b64encode(rollback_raw).decode(),
    'hostRollbackSha256':m.sha(rollback_raw)}}}
  protected=[b,a]
 else:
  state={'version':1,'kind':'china-accepted-state-v1','market':'china','revision':5,'current':current['reference'],
   'rollback':b['reference'],'pending':None,'commit':{'nonce':current['nonce'],'acceptedAt':'2026-11-26T01:00:00Z',
    'intentSha256':m.canonical_sha(pending),'previousETag':previous['etag'],'previousStateSha256':previous['sha256']}}
  accepted=obs(state,'accepted')
  intent={**pending,'status':'committed','resolution':{'kind':'accepted','at':'2026-11-26T01:00:00Z',
   'acceptedETag':accepted['etag'],'acceptedSha256':accepted['sha256'],
   'hostReceiptSha256':current['reference']['proof']['hostReceiptSha256']}}
  protected=[current,b]
 publication={'accepted':accepted,'intent':obs(intent,'intent')}
 original_publication=copy.deepcopy(publication)
 for file in target['plan']['files']:
  if file['name'] in m.HOST_BULK_FILES:
   (target['directory'] if file['name']=='image.tar' else target['directory']/'generation').joinpath(file['name']).unlink()
 def container(ref,nonce,identity,port,running=True):
  return {'Id':identity,'Image':ref['imageId'],'Config':{'Labels':{'avtocena.china.nonce':nonce},
   'Env':['AVTOCENA_RELEASE_SHA='+ref['runtimeSha'],'AVTOCENA_CALCULATION_VERSION='+m.CALCULATION,
    'CATALOG_CHINA_LOCAL_RUNTIME_SHA='+ref['pricingRuntimeSha'],'CATALOG_CHINA_LOCAL_MANIFEST_SHA256='+ref['generationManifestSha256'],
    'CATALOG_CHINA_LOCAL_GENERATION_DIR='+m.GENERATION_MOUNT]},
   'HostConfig':{'PortBindings':{'3000/tcp':[{'HostPort':str(port)}]}},
   'Mounts':[{'Source':str(m.BASE/ref['runtimeSha']/'china-next'/nonce/'generation'),'Destination':m.GENERATION_MOUNT,'Type':'bind','RW':False}],
   'State':{'Running':running,'Pid':100 if running else 0,'StartedAt':'2026-11-26T01:00:00Z'},'RestartCount':0}
 containers={}
 for index,item in enumerate(protected):
  identity=str(index+5)*64
  containers[identity]=container(item['reference'],item['nonce'],identity,3004+index)
 def image(ref):
  return {'Id':ref['imageId'],'Os':'linux','Architecture':'amd64','Size':900000000,
   'Config':{'Labels':{'org.opencontainers.image.revision':ref['runtimeSha'],
    'org.opencontainers.image.source':'https://github.com/jeep-jim/AvtoCena','avtocena.application':'web'}},
   'RepoTags':['avtocena-china-runtime:'+ref['runtimeSha']+'-'+'e'*12],
   'RepoDigests':['avtocena-china-runtime@'+ref['imageId']]}
 images={item['reference']['imageId']:image(item['reference']) for item in [a,b,target]}
 deletes=[];free=[1000]
 def docker(method,url,*args,**kwargs):
  if method=='GET' and url=='/containers/json?all=1':return [{'Id':key} for key in containers]
  if method=='GET' and url.startswith('/containers/'):return copy.deepcopy(containers[url.split('/')[2]])
  if method=='GET' and url=='/images/json?all=1':return [{'Id':key} for key in images]
  if method=='GET' and url.startswith('/images/'):
   key=url.split('/')[2]
   if key not in images:raise m.ReleaseError('china_host_docker_http_404')
   value=copy.deepcopy(images[key])
   if case=='wrong_id' and key==target['reference']['imageId']:value['Id']='sha256:'+'9'*64
   return value
  if method=='DELETE':
   expected='/images/'+target['reference']['imageId']+'?force=false&noprune=true'
   assert url==expected,(method,url);deletes.append(url);assert len(deletes)==1
   if case!='delete_unconfirmed':
    del images[target['reference']['imageId']];free[0]+=37
   if case=='delete_lost':raise m.ReleaseError('china_host_docker_http_500')
   return [{'Deleted':target['reference']['imageId']}]
  raise AssertionError('unapproved Docker request: '+method+' '+url)
 m.docker=docker
 m.os.statvfs=lambda _:types.SimpleNamespace(f_bavail=free[0],f_frsize=1)
 target_id=target['reference']['imageId']
 if case=='already_absent':images.pop(target_id)
 if case=='stopped_container':
  ref=target['reference'];identity='7'*64
  containers[identity]=container(ref,'9'*32,identity,3009,False)
 if case=='legacy_tag':images[target_id]['RepoTags']=['avtocena-regcloud:legacy']
 if case=='missing_labels':images[target_id]['Config']['Labels']={}
 if case=='extra_digest':images[target_id]['RepoDigests'].append('unrelated@sha256:'+'8'*64)
 if case=='pinned_image':images[target_id]['Config']['Labels']['org.opencontainers.image.revision']='a182cd21b21ecf612b63613d263e5bdd817ea4c0'
 if case=='bulk_remains':write(target['directory']/'generation'/'details.sqlite',b'not retired')
 if case=='missing_proof':(target['directory']/('ROLLED_BACK.json' if rollback else 'ACCEPTED.json')).unlink()
 if case=='never_reserved':
  intent['status']='aborted';intent['resolution']={'kind':'never_reserved','acceptedETag':accepted['etag'],
   'acceptedSha256':accepted['sha256'],'hostReceiptSha256':None};publication['intent']=obs(intent,'intent')
 if case=='unresolved':
  intent['status']='pending';intent['resolution']=None;publication['intent']=obs(intent,'intent')
 params={'action':'prepare','publication':publication,'currentState':copy.deepcopy(publication),
  'policySource':policy_raw.decode(),'policySourceSha256':m.sha(policy_raw)}
 if case in ('wrong_id','bulk_remains','missing_proof','unresolved'):
  refused(lambda:m.TerminalAppImageCleanup(params))
  assert not deletes
 else:
  cleanup=m.TerminalAppImageCleanup(params)
  try:
   prepared=cleanup.prepared()
   skips={'already_absent':('already_absent','already_absent'),'stopped_container':('protected','container_reference'),
    'shared_image':('protected','current_or_rollback'),'pinned_image':('protected','pinned_image'),
    'legacy_tag':('protected','ineligible_image'),'missing_labels':('protected','ineligible_image'),
    'extra_digest':('protected','ineligible_image'),'never_reserved':('not_applicable','no_terminal_image')}
   if case in skips:
    assert (prepared['status'],prepared['reason'])==skips[case],prepared
    assert prepared['completed'] and prepared['imagesRemoved']==0 and not deletes
   else:
    assert prepared['kind']=='china-terminal-app-image-prepared-v1',prepared
    assert prepared['imageId']==target_id and prepared['runtimeSha']==target['reference']['runtimeSha']
    assert prepared['witnessSha256']==m.canonical_sha(publication)
    remove={'action':'remove','publication':publication,'currentState':copy.deepcopy(publication)}
    if case=='authority_changed':
     remove['currentState']['accepted']['etag']='"new"'
     refused(lambda:cleanup.remove(remove),'authority_changed');assert not deletes
    elif case=='tag_drift':
     images[target_id]['RepoTags'].append('foreign:now')
     refused(lambda:cleanup.remove(remove),'app_image_changed');assert not deletes
    elif case=='new_container':
     identity='8'*64;containers[identity]=container(target['reference'],'9'*32,identity,3011,False)
     refused(lambda:cleanup.remove(remove),'container_changed');assert not deletes
    elif case=='proof_drift':
     file=target['directory']/'PLAN.json';file.chmod(0o600);file.write_bytes(file.read_bytes()+b' ')
     refused(lambda:cleanup.remove(remove),'proof_changed');assert not deletes
    elif case in ('delete_lost','delete_unconfirmed'):
     refused(lambda:cleanup.remove(remove))
     pending_report=cleanup.pending();assert pending_report['completed'] is False and pending_report['uncertain'] is True
     assert pending_report['errorCode']=='delete_not_confirmed' and len(deletes)==1
     if case=='delete_lost':
      cleanup.close()
      retried=m.TerminalAppImageCleanup(params)
      try:
       result=retried.prepared()
       assert result['status']=='already_absent' and result['imagesRemoved']==0 and result['measuredFreeBytesChange']==0
       assert len(deletes)==1
      finally:retried.close()
    else:
     result=cleanup.remove(remove)
     assert result['completed'] and result['imagesRemoved']==1 and result['status']=='removed'
     assert result['diskFreeBytesBefore']==1000 and result['diskFreeBytesAfter']==1037
     assert result['measuredFreeBytesChange']==37 and len(deletes)==1
     assert target_id not in images
     refused(lambda:cleanup.remove(remove),'sequence')
  finally:cleanup.close()
 assert m.CONFIG.read_bytes()==original_ingress
 assert publication==original_publication or case in ('never_reserved','unresolved')
 for item in protected:
  assert (item['directory']/'PLAN.json').exists() and (item['directory']/'ACCEPTED.json').exists()
  assert (item['directory']/'generation'/'details.sqlite').exists()
 assert (target['directory']/'PLAN.json').exists() and (target['directory']/'generation'/'GENERATION.json').exists()
 print(json.dumps({'case':sys.argv[2],'passed':True,'deletes':len(deletes)}))
`;

for (const scenario of ["success","rollback_success","already_absent","rollback_already_absent","stopped_container","shared_image","legacy_tag","missing_labels","extra_digest","pinned_image","wrong_id","bulk_remains","missing_proof","rollback_missing_proof","unresolved","never_reserved","authority_changed","tag_drift","new_container","proof_drift","delete_lost","rollback_delete_lost","delete_unconfirmed"]) {
  test('terminal app image: ' + scenario, {timeout: 30000}, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, hostFile, scenario], {encoding: 'utf8', timeout: 25000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.passed, true); assert.ok(report.deletes >= 0 && report.deletes <= 1);
  });
}
