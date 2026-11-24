import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hostFile = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
const baselineFile = fileURLToPath(new URL('../docs/operations/2026-11-11-accepted-speed-baseline.json', import.meta.url));
const harness = String.raw`
import base64, copy, hashlib, importlib.util, json, os, pathlib, stat, sys, tempfile, types
spec=importlib.util.spec_from_file_location('host',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
case=sys.argv[2]
def refused(call,reason):
    try: call()
    except m.ReleaseError as error: assert str(error)=='china_host_'+reason,str(error)
    else: raise AssertionError('required refusal: '+reason)
foreign_owners=set()
class RootOwnedStat:
    def __init__(self,value,owner): self.value=value; self.owner=owner
    def __getattr__(self,key): return self.owner if key=='st_uid' else getattr(self.value,key)
class RootOwnedPath(type(pathlib.Path())):
    # Production guards still run unchanged against explicit fixture ownership.
    # Do not rely on pathlib.lstat delegating to an overridden stat on every Python.
    def stat(self,*args,**kwargs): return RootOwnedStat(super().stat(*args,**kwargs),1001 if str(self) in foreign_owners else 0)
    def lstat(self,*args,**kwargs): return RootOwnedStat(super().lstat(*args,**kwargs),1001 if str(self) in foreign_owners else 0)
def forbidden(*args,**kwargs): raise AssertionError('unapproved network or process mutation')
m.command=m.subprocess.run=forbidden
with tempfile.TemporaryDirectory(prefix='china-reuse-test-') as temporary:
    root=RootOwnedPath(temporary); root.chmod(0o700); m.BASE=root/'releases'; m.BASE.mkdir(mode=0o700)
    m.CONFIG=root/'nginx.conf'; m.CONFIG.write_bytes(b'proxy_pass http://127.0.0.1:3000;\n'); m.CONFIG.chmod(0o400)
    enc=root/'encyclopedia.json'; enc.write_bytes(b'protected encyclopedia'); enc.chmod(0o400)
    actual_file_sha=m.file_sha; hashes=[]
    def file_sha(filename):
        hashes.append(str(filename))
        return '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c' if filename==enc else actual_file_sha(filename)
    m.file_sha=file_sha
    runtime='a'*40; pricing='b'*40; image='sha256:'+'c'*64; old_nonce='d'*32; new_nonce='e'*32
    old=m.BASE/runtime/'china-next'/old_nonce; old.mkdir(parents=True,mode=0o700)
    old.parent.chmod(0o700); old.parent.parent.chmod(0o700); (old/'generation').mkdir(mode=0o700)
    gen={'generationId':'gen_china_45369451603_1','runtimeSha':pricing,'prepared':True,'calculationVersion':'1'*64,
         'source':{'supplierLatestVerified':True,'sourceObservedAt':'2026-11-24T06:00:00Z','cursor':100}}
    genraw=m.json_bytes(gen)
    oracle={'version':1,'runtimeSha':runtime,'pricingRuntimeSha':pricing,'generationManifestSha256':m.sha(genraw),
        'cases':[{'name':str(i),'path':'/api/catalog/search?market=china&page='+str(i),'total':1,'ids':['private-id'],'totalRub':[123456]} for i in range(8)]}
    plan={'version':1,'market':'china','retainedRuntime':m.RETAINED,'runtimeSha':runtime,'pricingRuntimeSha':pricing,
        'runtimeTree':'f'*40,'runtimeDiffSha256':'f'*64,'controllerSha':'1'*40,'servingCalculationVersion':m.CALCULATION,
        'nonce':old_nonce,'imageId':image,'generationId':gen['generationId'],'generationManifestSha256':m.sha(genraw),
        'privateGenerationReceiptSha256':'2'*64,'sourceDescriptorSha256':'3'*64,'previousAcceptedETag':None,'previousAcceptedStateSha256':None}
    gen_names={'GENERATION.json','details.sqlite','query.sqlite','FILTER_SEMANTICS.json','FX_RECEIPT.json','RECONCILIATION.json','DISPOSITIONS.ndjson'}
    def put(filename,raw):
        if filename.exists(): filename.chmod(0o600)
        filename.write_bytes(raw); filename.chmod(0o400)
    files=[]
    for name in sorted(m.FILE_NAMES):
        raw=genraw if name=='GENERATION.json' else m.json_bytes(oracle) if name=='acceptance.json' else \
            pathlib.Path(sys.argv[3]).read_bytes() if name=='accepted-speed-baseline.json' else ('PRIVATE-'+name).encode()
        put((old/'generation' if name in gen_names else old)/name,raw)
        files.append({'name':name,'bytes':len(raw),'sha256':m.sha(raw),'compressedBytes':1,'compressedSha256':'4'*64})
    plan['files']=files; put(old/'PLAN.json',m.json_bytes(plan))
    retained_id='5'*64; candidate_id='6'*64
    rollback={'version':1,'kind':'china-host-rollback-v1','nonce':old_nonce,'release':runtime,'pricingRuntimeSha':pricing,
        'imageId':image,'generationId':gen['generationId'],'generationManifestSha256':plan['generationManifestSha256'],
        'privateGenerationReceiptSha256':plan['privateGenerationReceiptSha256'],'sourceDescriptorSha256':plan['sourceDescriptorSha256'],
        'candidateRemoved':True,'ingressRestored':True,'retainedRunning':True,'retainedRuntimeSha':m.RETAINED,
        'retainedContainerId':retained_id,'retainedImageId':'sha256:'+'7'*64}
    put(old/'ROLLED_BACK.json',m.json_bytes(rollback))
    params={'source':{'runtimeSha':runtime,'nonce':old_nonce,'planSha256':m.sha((old/'PLAN.json').read_bytes()),
        'rollbackSha256':m.sha((old/'ROLLED_BACK.json').read_bytes())},'nonce':new_nonce,'controllerSha':'8'*40,
        'previousAcceptedETag':None,'previousAcceptedStateSha256':None}
    bind=str(enc)+':/app/data/knowledge/encyclopedia/calculation-v1.json:ro'
    retained={'Id':retained_id,'Image':rollback['retainedImageId'],'Config':{'Env':['SECRET=never-log',
        'AVTOCENA_RELEASE_SHA='+m.RETAINED,'AVTOCENA_CALCULATION_VERSION='+m.CALCULATION],
        'WorkingDir':'/app','User':'root','Labels':{},'Cmd':['node','server.js'],'Entrypoint':['docker-entrypoint.sh']},
        'HostConfig':{'Privileged':False,'Binds':[bind],'PortBindings':{'3000/tcp':[{'HostPort':'3000'}]}},
        'Mounts':[{'Type':'bind','RW':False,'Source':str(enc),'Destination':'/app/data/knowledge/encyclopedia/calculation-v1.json'}],
        'State':{'Running':True,'Pid':123,'StartedAt':'2026-11-24T00:00:00Z'},'RestartCount':0}
    containers={retained_id:retained}; operations=[]
    def docker(method,target,body=None):
        operations.append((method,target))
        if method=='GET':
            if target=='/containers/json?all=1': return [{'Id':key} for key in containers]
            if target=='/images/'+image+'/json':
                return {'Id':image if case!='image_mismatch' else 'sha256:'+'9'*64,'Os':'linux','Architecture':'amd64',
                    'Config':{'Labels':{'org.opencontainers.image.revision':runtime}}}
            if target.startswith('/containers/') and target.endswith('/json'): return copy.deepcopy(containers[target.split('/')[2]])
        assert case=='start' and method=='POST', 'copy must not mutate Docker'
        if target.startswith('/containers/create?'):
            containers[candidate_id]={'Id':candidate_id,'Image':body['Image'],'Config':copy.deepcopy(body),
                'HostConfig':copy.deepcopy(body['HostConfig']),'Mounts':[],
                'State':{'Running':False,'Status':'created','ExitCode':0,'OOMKilled':False,'Pid':0,'StartedAt':''},'RestartCount':0}
            return {'Id':candidate_id}
        if target=='/containers/'+candidate_id+'/start':
            containers[candidate_id]['State'].update(Running=True,Status='running',Pid=999,StartedAt='2026-11-24T12:00:00Z')
            return None
        raise AssertionError('unapproved mutation')
    m.docker=docker
    lockfile=root/'runtime.lock'; lockfile.write_bytes(b''); lockfile.chmod(0o600)
    m.reuse_lock=lambda: os.open(lockfile,os.O_RDONLY)
    def fingerprint(directory):
        return {str(p.relative_to(directory)):(m.sha(p.read_bytes()),p.stat().st_ino,stat.S_IMODE(p.stat().st_mode))
                for p in directory.rglob('*') if p.is_file()}
    target=old.parent/new_nonce
    if case=='low_disk': m.os.statvfs=lambda _: types.SimpleNamespace(f_bavail=1,f_frsize=1)
    if case=='bad_source': put(old/'generation'/'query.sqlite',b'corrupt-source-rows')
    if case=='bad_source_hash':
        source=old/'generation'/'query.sqlite'; put(source,b'x'*source.stat().st_size)
    if case=='accepted': put(old/'ACCEPTED.json',b'{}')
    if case=='state_changed': params['previousAcceptedETag']='"changed"'; params['previousAcceptedStateSha256']='a'*64
    if case=='plan_changed': params['source']['planSha256']='0'*64
    if case=='rollback_changed': params['source']['rollbackSha256']='0'*64
    if case=='foreign_file_owner': foreign_owners.add(str(old/'generation'/'query.sqlite'))
    if case=='foreign_directory_owner': foreign_owners.add(str(old/'generation'))
    if case=='mounted':
        containers['9'*64]={**copy.deepcopy(retained),'Id':'9'*64,'Mounts':[{'Source':str(old/'generation'),'RW':False}]}
    before=fingerprint(old); all_before=fingerprint(root); retained_before=copy.deepcopy(retained)
    failures={'low_disk':'reuse_disk_capacity','bad_source':'reuse_source_size','bad_source_hash':'reuse_source_hash',
        'accepted':'reuse_accepted','state_changed':'reuse_state_changed','plan_changed':'reuse_plan',
        'rollback_changed':'reuse_rollback','mounted':'reuse_mounted','image_mismatch':'reuse_image',
        'foreign_file_owner':'file_owner','foreign_directory_owner':'recovery_directory'}
    if case in failures:
        refused(lambda:m.resume_failed_upload(params),failures[case])
        assert not target.exists() and fingerprint(root)==all_before
    elif case=='exclusive_copy':
        source=old/'generation'/'query.sqlite'; destination=root/'existing'; put(destination,b'KEEP')
        descriptor=next(row for row in files if row['name']=='query.sqlite')
        try: m.reuse_copy_file(source,destination,descriptor,m.reuse_file_identity(source))
        except FileExistsError: pass
        else: raise AssertionError('existing destination was not refused')
        assert destination.read_bytes()==b'KEEP'
    else:
        host,result=m.resume_failed_upload(params)
        assert result['initialized'] and result['reused'] and result['copiedFiles']==11
        assert result['copiedBytes']==sum(row['bytes'] for row in files)
        assert base64.b64decode(result['generationBase64'])==genraw
        assert json.loads(base64.b64decode(result['oracleBase64']))==oracle
        expected={**plan,'nonce':new_nonce,'controllerSha':params['controllerSha'],'reuseSource':params['source']}
        assert result['plan']==expected and host.plan==expected
        assert host.uploaded==m.FILE_NAMES and host.candidate is None and not host.functional_passed and not host.speed_passed
        for row in files:
            src=(old/'generation' if row['name'] in gen_names else old)/row['name']
            dst=host.file_path(row['name'])
            assert src.read_bytes()==dst.read_bytes() and src.stat().st_ino!=dst.stat().st_ino
            assert src.stat().st_nlink==dst.stat().st_nlink==1 and stat.S_IMODE(dst.stat().st_mode)==0o400
            assert str(src) in hashes and str(dst) in hashes, 'source and copy require full SHA verification'
        if case=='replay':
            os.close(host.lock); host.lock=None
            copied_before=fingerprint(target); operations.clear()
            host,result=m.resume_failed_upload(params)
            assert fingerprint(target)==copied_before and all(method=='GET' for method,path in operations)
        if case=='start':
            class Probe:
                def __init__(self,*args): pass
                def __enter__(self): return self
                def __exit__(self,*args): pass
                def bind(self,address): assert address==('127.0.0.1',3004)
            m.socket.socket=Probe; m.health=lambda port,revision: None
            started=host.start()
            assert started['startup']['ready'] and host.candidate==candidate_id and not host.switched
            assert not any('/images/load' in path or path=='/info' for method,path in operations)
            assert containers[candidate_id]['Config']['Image']==image
            candidate_env=m.env_map(containers[candidate_id])
            assert candidate_env['CATALOG_HOME_PHASE_TIMING']=='1'
            assert candidate_env['CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS']=='1800'
        else: assert all(method=='GET' for method,path in operations)
        os.close(host.lock)
    assert fingerprint(old)==before and containers[retained_id]==retained_before
print('ok')
`;
for (const name of ['copy','replay','low_disk','bad_source','bad_source_hash','accepted','state_changed',
  'plan_changed','rollback_changed','mounted','image_mismatch','exclusive_copy','start','foreign_file_owner','foreign_directory_owner']) {
  test('failed-upload reuse: '+name, () => {
    const result=spawnSync('python3',['-I','-B','-c',harness,hostFile,name,baselineFile],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr||result.stdout); assert.equal(result.stdout.trim(),'ok');
  });
}
