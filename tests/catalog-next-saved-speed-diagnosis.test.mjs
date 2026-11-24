import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const host=fileURLToPath(new URL('../scripts/catalog-next/release-host.py',import.meta.url));
const gate=fileURLToPath(new URL('../scripts/regcloud-performance-gate.py',import.meta.url));
const baseline=fileURLToPath(new URL('../docs/operations/2026-11-11-accepted-speed-baseline.json',import.meta.url));
const harness=String.raw`
import copy,importlib.util,json,os,pathlib,stat,sys,tempfile
spec=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
case=sys.argv[2]
def forbidden(*args,**kwargs):raise AssertionError('diagnosis cannot execute requests, commands or bulk hashes')
m.docker=m.Docker=m.file_sha=m.command=m.subprocess.run=m.socket.socket=forbidden
with tempfile.TemporaryDirectory() as temporary:
    root=pathlib.Path(temporary);root.chmod(0o700)
    def regular(filename,maximum=None):
        metadata=filename.lstat();m.need(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink==1 and not filename.is_symlink(),'regular_file')
        m.need(filename.resolve()==filename and metadata.st_uid==os.getuid(),'file_owner')
        if maximum is not None:m.need(metadata.st_size<=maximum,'file_size')
        return metadata
    m.regular=regular
    files=[]
    for filename,source in [('regcloud-performance-gate.py',sys.argv[3]),('accepted-speed-baseline.json',sys.argv[4])]:
        raw=pathlib.Path(source).read_bytes();(root/filename).write_bytes(raw);(root/filename).chmod(0o400)
        files.append({'name':filename,'bytes':len(raw),'sha256':m.sha(raw)})
    plan={'files':files}
    route='/cars?market=china&make=Volkswagen&page=2'
    samples=[{'performanceRequest':'started','path':'/api/health'},
        {'performanceRequest':'complete','path':'/api/health','seconds':0.03,'functionalPassed':True},
        {'performanceRequest':'started','path':route},
        {'performanceRequest':'failed','path':route,'seconds':80.2,'errorType':'AssertionError'},
        {'speedBaseline':'warm','path':route,'referenceSeconds':0.89,'measurementNoiseSeconds':0.05,'ceilingSeconds':0.94,
         'seconds':1.2,'blocking':True,'passed':False,'recheckSeconds':[1.1,1.0,1.2],'recheckMedianSeconds':1.1},
        {'performanceGate':'after_ttl','path':route,'seconds':0.1,'ceiling':2.0,'passed':True,'functionalPassed':True,'latencyBlocking':False},
        {'performanceGate':'summary','marketScope':'china','routes':['/api/health',route],
         'acceptedBaselineRoutes':[route],'samples':6,'slowSamples':0,'functionalPassed':True,'performanceAccepted':True,
         'latencyBlocking':False,'acceptedBaselineEnforced':True}]
    startup={'version':1,'kind':'china-host-startup-v1','ready':True,'elapsedSeconds':462.078,'attempts':100,
        'health':'ok','candidate':{'running':True,'status':'running','exitCode':0,'oomKilled':False,'restartCount':0},'reason':'ready'}
    def put(name,value):
        filename=root/name
        if filename.exists():filename.chmod(0o600)
        filename.write_bytes(m.json_bytes(value));filename.chmod(0o400)
    if case=='absent':
        assert m.saved_startup_diagnosis(root) is None
        assert m.saved_speed_diagnosis(root,plan)=={'present':False,'sha256':None,'exitCode':None,'samples':[],'rejectedSamples':0}
    else:
        if case=='private_fields':
            samples[3]['responseBody']='PRIVATE_BODY';samples[3]['secretUrl']='https://private-feed.example/token'
            samples[3]['errorType']='PRIVATE_EXCEPTION';samples.append({'path':'/private?token=SECRET','performanceRequest':'failed','seconds':1,'errorType':'HTTPError'})
            samples.append({'rawEnv':'SECRET_ENV'})
        if case=='invalid_number':samples[3]['seconds']=float('nan')
        if case=='unknown_summary_route':samples[-1]['routes'].append('/private?key=SECRET')
        if case=='startup_extra':startup['PRIVATE_RAW']='secret'
        put('STARTUP.json',startup);put('server-speed-result.json',{'exitCode':1,'samples':samples})
        if case=='changed_gate':
            changed=root/'regcloud-performance-gate.py';changed.chmod(0o600);changed.write_bytes(b'UNTRUSTED_GATE');changed.chmod(0o400)
        if case=='oversized':put('server-speed-result.json',{'exitCode':1,'samples':samples*100})
        if case=='symlink':
            (root/'server-speed-result.json').unlink();(root/'server-speed-result.json').symlink_to(root/'STARTUP.json')
        expected={'changed_gate':'diagnosis_speed_source','oversized':'diagnosis_speed_report','symlink':'regular_file','startup_extra':'diagnosis_startup'}
        if case in expected:
            try:
                if case=='startup_extra':m.saved_startup_diagnosis(root)
                else:m.saved_speed_diagnosis(root,plan)
            except m.ReleaseError as error:assert str(error)=='china_host_'+expected[case],str(error)
            else:raise AssertionError('required rejection')
        else:
            before={p.name:(m.sha(p.read_bytes()),p.stat().st_ino,stat.S_IMODE(p.stat().st_mode)) for p in root.iterdir()}
            result=m.saved_speed_diagnosis(root,plan)
            assert m.saved_startup_diagnosis(root)==startup
            assert result['present'] and result['exitCode']==1 and result['sha256']==m.sha((root/'server-speed-result.json').read_bytes())
            assert result['rejectedSamples']==(2 if case=='private_fields' else 1 if case in ('invalid_number','unknown_summary_route') else 0)
            assert 'PRIVATE' not in json.dumps(result) and 'SECRET' not in json.dumps(result) and 'private-feed' not in json.dumps(result)
            if case=='safe':assert result['samples']==samples
            if case=='private_fields':assert result['samples'][3]=={'performanceRequest':'failed','path':route,'seconds':80.2,'errorType':'other'}
            assert {p.name:(m.sha(p.read_bytes()),p.stat().st_ino,stat.S_IMODE(p.stat().st_mode)) for p in root.iterdir()}==before
print('ok')
`;
for(const name of ['safe','absent','private_fields','invalid_number','unknown_summary_route','startup_extra','changed_gate','oversized','symlink']){
  test('saved speed diagnosis: '+name,()=>{
    const result=spawnSync('python3',['-I','-B','-c',harness,host,name,gate,baseline],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr||result.stdout);assert.equal(result.stdout.trim(),'ok');
  });
}
