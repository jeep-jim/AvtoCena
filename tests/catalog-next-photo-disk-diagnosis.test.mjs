import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const diagnostic = fileURLToPath(new URL('../scripts/catalog-next/diagnose-photo-disk-20261125.py', import.meta.url));
const gate = fileURLToPath(new URL('../scripts/regcloud-performance-gate.py', import.meta.url));
const baseline = fileURLToPath(new URL('../docs/operations/2026-11-11-accepted-speed-baseline.json', import.meta.url));
const harness = String.raw`
import hashlib,importlib.util,json,os,pathlib,stat,sys,tempfile,types
filename,case,gate,baseline=sys.argv[1:]
sys.argv=[filename]
spec=importlib.util.spec_from_file_location('diagnostic',filename)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def forbidden(*args,**kwargs):raise AssertionError('read-only fixture cannot execute commands or requests')
m.subprocess.run=m.socket.socket=m.http.client.HTTPConnection=forbidden
# The fixture runs as the current CI user; keep every production file check
# except its host-specific root ownership requirement.
real_fstat=os.fstat
def fixture_fstat(fd):
    value=real_fstat(fd)
    return types.SimpleNamespace(**{key:(0 if key=='st_uid' else getattr(value,key)) for key in
        ('st_mode','st_uid','st_nlink','st_size','st_dev','st_ino','st_mtime_ns','st_ctime_ns')})
m.os.fstat=fixture_fstat
def sha(raw):return hashlib.sha256(raw).hexdigest()
with tempfile.TemporaryDirectory() as temporary:
    root=pathlib.Path(temporary)/m.RUNTIMES[3]/'china-next'/('a'*32)
    root.mkdir(parents=True)
    def put(name,value,raw=False):
        path=root/name
        if path.exists():path.chmod(0o600)
        content=value if raw else json.dumps(value,separators=(',',':')).encode()
        path.write_bytes(content);path.chmod(0o400)
        return sha(content)
    files=[]
    for name,source in [('regcloud-performance-gate.py',gate),('accepted-speed-baseline.json',baseline)]:
        raw=pathlib.Path(source).read_bytes()
        files.append({'name':name,'bytes':len(raw),'sha256':put(name,raw,True)})
    plan={**m.PHOTO_SPEED_PLAN,'nonce':root.name,'files':files}
    put('PLAN.json',plan)
    route='/cars?market=china&make=Volkswagen&page=2'
    samples=[{'performanceRequest':'started','path':'/api/health'},
        {'performanceRequest':'complete','path':'/api/health','seconds':0.03,'functionalPassed':True},
        {'performanceRequest':'failed','path':route,'seconds':90.2,'errorType':'TimeoutError'},
        {'speedBaseline':'warm','path':route,'referenceSeconds':0.89,'measurementNoiseSeconds':0.05,
         'ceilingSeconds':0.94,'seconds':1.2,'blocking':False,'passed':False},
        {'performanceGate':'after_ttl','path':route,'seconds':0.1,'ceiling':2.0,
         'passed':True,'functionalPassed':True,'latencyBlocking':False},
        {'performanceGate':'summary','marketScope':'china','routes':['/api/health',route],
         'acceptedBaselineRoutes':[route],'samples':6,'slowSamples':0,'functionalPassed':True,
         'performanceAccepted':True,'latencyBlocking':False,'acceptedBaselineEnforced':True}]
    if case=='private_fields':
        samples[2].update(errorType='PRIVATE_EXCEPTION',responseBody='PRIVATE_BODY')
        samples.extend([{'performanceRequest':'failed','path':'/private?key=SECRET','seconds':1,'errorType':'HTTPError'},
            {'performanceRequest':'failed','path':route,'seconds':float('nan'),'errorType':'TimeoutError'},
            {'performanceGate':'summary','marketScope':'china','routes':[{}]},
            {'performanceRequest':[],'path':route}])
    if case!='absent':put('server-speed-result.json',{'exitCode':1,'samples':samples})
    if case in ('wrong_runtime','wrong_controller','wrong_generation','wrong_manifest','wrong_nonce','wrong_scope'):
        key={'wrong_runtime':'runtimeSha','wrong_controller':'controllerSha','wrong_generation':'generationId',
             'wrong_manifest':'generationManifestSha256','wrong_nonce':'nonce','wrong_scope':'codeScope'}[case]
        plan[key]='0'*len(plan[key]);put('PLAN.json',plan)
    if case in ('changed_gate','changed_baseline','repinned_gate','repinned_baseline'):
        name='regcloud-performance-gate.py' if case.endswith('gate') else 'accepted-speed-baseline.json'
        changed=b'PRIVATE_UNTRUSTED_SOURCE'
        digest=put(name,changed,True)
        if case.startswith('repinned'):
            next(row for row in plan['files'] if row['name']==name).update(bytes=len(changed),sha256=digest)
            put('PLAN.json',plan)
    if case=='symlink':
        (root/'server-speed-result.json').unlink();(root/'server-speed-result.json').symlink_to(root/'PLAN.json')
    if case=='oversized':put('server-speed-result.json',{'exitCode':1,'samples':samples*100})
    if case=='invalid_shape':put('server-speed-result.json',{'exitCode':True,'samples':samples,'private':'SECRET'})
    if case=='writable':(root/'server-speed-result.json').chmod(0o622)
    def snapshot():
        return {path.name:(sha(path.read_bytes()),path.lstat().st_ino,stat.S_IMODE(path.lstat().st_mode)) for path in root.iterdir()}
    before=snapshot()
    result=m.saved_speed_diagnosis(root,m.RUNTIMES[3])
    assert snapshot()==before,'diagnosis changed fixture files'
    assert 'PRIVATE' not in json.dumps(result) and 'SECRET' not in json.dumps(result)
    if case in ('wrong_runtime','wrong_controller','wrong_generation','wrong_manifest','wrong_scope'):
        assert result=={'selected':False},result
    elif case=='wrong_nonce':assert result=={'selected':True,'valid':False,'reason':'plan_binding'},result
    elif case in ('changed_gate','changed_baseline','repinned_gate','repinned_baseline'):
        assert result=={'selected':True,'valid':False,'reason':'source_binding'},result
    elif case in ('symlink','writable'):assert result=={'selected':True,'valid':False,'reason':'report_file'},result
    elif case in ('oversized','invalid_shape'):assert result=={'selected':True,'valid':False,'reason':'report_shape'},result
    elif case=='absent':assert result['selected'] and result['valid'] and not result['present'] and result['samples']==[]
    else:
        assert result['selected'] and result['valid'] and result['present'] and result['exitCode']==1,result
        assert result['sha256']==sha((root/'server-speed-result.json').read_bytes())
        assert result['sourceSha256']==m.PHOTO_SPEED_SOURCES
        if case=='safe':assert result['samples']==samples and result['rejectedSamples']==0
        if case=='private_fields':
            assert result['rejectedSamples']==4,result
            assert result['samples'][2]=={'performanceRequest':'failed','path':route,'seconds':90.2,'errorType':'other'}
    if case=='cleanup':
        for runtime in (m.RUNTIMES[0],m.RUNTIMES[3]):
            plan.update(runtimeSha=runtime)
            plan_digest=put('PLAN.json',plan)
            rollback_digest=put('ROLLED_BACK.json',{'nonce':root.name,'release':runtime})
            receipt={'version':1,'kind':'china-failed-code-bulk-cleanup-v1','runtimeSha':runtime,'nonce':root.name,
                'planSha256':plan_digest,'rollbackSha256':rollback_digest,'filesDeleted':7,'logicalBytesDeleted':12607910031,
                'imagesDeleted':0,'directoriesDeleted':0,'completed':True,'protectedDeploymentsPreserved':True}
            put('FAILED_CODE_CLEANUP.json',receipt)
            before=snapshot()
            cleanup=m.failed_code_cleanup_diagnostic(root,runtime)
            assert cleanup['valid'] and cleanup['bindsAttempt'] and cleanup['bindsPlan'] and cleanup['bindsRollback'],cleanup
            other=m.RUNTIMES[3] if runtime==m.RUNTIMES[0] else m.RUNTIMES[0]
            assert not m.failed_code_cleanup_diagnostic(root,other)['bindsAttempt']
            assert snapshot()==before,'cleanup diagnosis changed fixture files'
        receipt['rollbackSha256']='0'*64;put('FAILED_CODE_CLEANUP.json',receipt)
        assert not m.failed_code_cleanup_diagnostic(root,m.RUNTIMES[3])['bindsRollback']
print('ok')
`;

for (const name of ['safe', 'absent', 'private_fields', 'wrong_runtime', 'wrong_controller', 'wrong_generation',
  'wrong_manifest', 'wrong_nonce', 'wrong_scope', 'changed_gate', 'changed_baseline', 'repinned_gate',
  'repinned_baseline', 'symlink', 'writable', 'oversized', 'invalid_shape', 'cleanup']) {
  test('photo disk saved evidence: ' + name, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, diagnostic, name, gate, baseline],
      {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'ok');
  });
}
