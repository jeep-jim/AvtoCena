import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkedStartupReport,ChinaSshSession} from '../scripts/catalog-next/release-ssh.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
const hostFile=fileURLToPath(new URL('../scripts/catalog-next/release-host.py',import.meta.url));
const harness=String.raw`
import copy,importlib.util,json,pathlib,sys,tempfile
spec=importlib.util.spec_from_file_location('host',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
case=sys.argv[2]; clock=[0.0]; m.time.monotonic=lambda:clock[0]; m.time.sleep=lambda n:clock.__setitem__(0,clock[0]+n)
with tempfile.TemporaryDirectory() as temporary:
    host=m.Host.__new__(m.Host); host.directory=pathlib.Path(temporary); host.plan={'runtimeSha':'a'*40,'imageId':'sha256:'+'b'*64,'nonce':'c'*32}
    host.candidate='d'*64; host.port=3004
    row={'Id':host.candidate,'Image':host.plan['imageId'],'Config':{'Labels':{'avtocena.china.nonce':host.plan['nonce']}},
        'State':{'Running':True,'Status':'running','ExitCode':0,'OOMKilled':False},'RestartCount':0}
    def docker(method,target,body=None):
        assert method=='GET' and target=='/containers/'+host.candidate+'/json'
        if case=='inspect': raise OSError('PRIVATE_DOCKER_ENV')
        if case in ('exited','oom'):
            row['State'].update(Running=False,Status='exited',ExitCode=137 if case=='oom' else 1,OOMKilled=case=='oom')
        return copy.deepcopy(row)
    m.docker=docker
    def health(port,release):
        assert port==3004 and release==host.plan['runtimeSha']
        if case=='slow_ready' and clock[0]>=130: return
        if case=='wrong_identity': raise m.ReleaseError('china_host_health_identity')
        raise ConnectionRefusedError('PRIVATE_TOKEN')
    m.health=health
    if case=='slow_ready': host.wait_startup()
    else:
        try: host.wait_startup()
        except m.ReleaseError as error:
            expected={'timeout':'candidate_startup','wrong_identity':'candidate_startup','exited':'candidate_exited','oom':'candidate_oom','inspect':'candidate_inspection'}[case]
            assert str(error)=='china_host_'+expected
        else: raise AssertionError('required failure')
    value=json.loads((host.directory/'STARTUP.json').read_bytes()); assert value==host.startup_report
    assert 'PRIVATE' not in json.dumps(value)
    if case=='slow_ready': assert value['ready'] and value['elapsedSeconds']==130 and value['health']=='ok'
    if case in ('timeout','wrong_identity'): assert not value['ready'] and value['elapsedSeconds']==900 and value['reason']=='timeout'
    if case=='wrong_identity': assert value['health']=='identity_mismatch'
    if case in ('exited','oom','inspect'): assert value['elapsedSeconds']==0 and value['attempts']==0
    if case=='oom': assert value['candidate']['oomKilled']
    print(json.dumps(value))
`;
for(const name of ['slow_ready','timeout','wrong_identity','exited','oom','inspect']) test('startup observation: '+name,()=>{
  const result=spawnSync('python3',['-I','-B','-c',harness,hostFile,name],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr||result.stdout); checkedStartupReport(JSON.parse(result.stdout));
});
const safe={version:1,kind:'china-host-startup-v1',ready:false,elapsedSeconds:900,attempts:901,
  health:'connection_refused',candidate:{running:true,status:'running',exitCode:0,oomKilled:false,restartCount:0},reason:'timeout'};
test('SSH only passes a bounded startup report and rejects extra secret fields',()=>{
  assert.deepEqual(checkedStartupReport(safe),safe);
  for(const value of [{...safe,logs:'private'}, {...safe,candidate:{...safe.candidate,Env:['private']}},
    {...safe,health:'PRIVATE_RAW_ERROR'}, {...safe,ready:true}, {...safe,elapsedSeconds:Infinity}])
    assert.throws(()=>checkedStartupReport(value),/china_ssh_startup_report/);
});
test('SSH attaches safe startup evidence to the error before cleanup closes transport',async t=>{
  const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
  child.stdin=new Writable({write(raw,_encoding,callback){const request=JSON.parse(raw); callback();
    queueMicrotask(()=>child.stdout.write(JSON.stringify({kind:'error',id:request.id,code:'china_host_candidate_startup',startup:safe})+'\n'));}});
  child.kill=()=>{queueMicrotask(()=>child.emit('close',255,null));return true;};
  const session=new ChinaSshSession(child); t.after(()=>session.abort());
  await assert.rejects(session.call('start'),error=>error.message==='china_host_candidate_startup'&&JSON.stringify(error.startup)===JSON.stringify(safe));
});
test('malformed startup evidence rejects the pending request instead of leaving it unresolved',async t=>{
  const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
  child.stdin=new Writable({write(raw,_encoding,callback){const request=JSON.parse(raw);callback();
    queueMicrotask(()=>child.stdout.write(JSON.stringify({kind:'error',id:request.id,code:'china_host_candidate_startup',startup:{...safe,logs:'private'}})+'\n'));}});
  child.kill=()=>{queueMicrotask(()=>child.emit('close',255,null));return true;};
  const session=new ChinaSshSession(child);t.after(()=>session.abort());
  await assert.rejects(session.call('start'),/china_ssh_protocol/); assert.equal(session.pending.size,0);
});
