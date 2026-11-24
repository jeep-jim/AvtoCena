import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkedRetainedFenceReport,ChinaSshSession} from '../scripts/catalog-next/release-ssh.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
const hostFile=fileURLToPath(new URL('../scripts/catalog-next/release-host.py',import.meta.url));
const harness=String.raw`
import copy,importlib.util,json,pathlib,sys,tempfile
spec=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
case=sys.argv[2]
before={'Id':'a'*64,'Image':'sha256:'+'b'*64,'Config':{'Env':['SECRET=original'],'Labels':{'private':'never-print'}},
    'HostConfig':{'Memory':0,'Privileged':False},'Mounts':[
        {'Type':'bind','Source':'/PRIVATE/one','Destination':'/app/one','RW':False,'Mode':'ro','Propagation':'rprivate'},
        {'Type':'bind','Source':'/PRIVATE/two','Destination':'/app/two','RW':False,'Mode':'ro','Propagation':'rprivate'}],
    'State':{'Pid':100,'StartedAt':'2026-11-24T01:00:00.123456789Z','Running':True},'RestartCount':0}
untouched=copy.deepcopy(before); expected=m.protected_identity(before); after=copy.deepcopy(before)
after['Mounts'].reverse()
assert m.protected_identity(after)==expected and before==untouched
assert m.retained_snapshot_guard(b'nginx',b'nginx',expected,after,before['Mounts'],'reuse_retained_changed') is True
if case=='reorder':
    assert m.canonical_mounts(before['Mounts'])==m.canonical_mounts(after['Mounts'])
    print('ok')
elif case=='duplicate':
    after['Mounts']=[copy.deepcopy(before['Mounts'][0]),copy.deepcopy(before['Mounts'][0])]
    try:m.protected_identity(after)
    except m.ReleaseError as error:assert str(error)=='china_host_mounts_duplicate'
    else:raise AssertionError('duplicate accepted')
    print('ok')
elif case=='counter':
    with tempfile.TemporaryDirectory() as directory:
        m.CONFIG=pathlib.Path(directory)/'nginx';original=b'proxy_pass http://127.0.0.1:3000;\n';m.CONFIG.write_bytes(original)
        m.regular=lambda filename,maximum=None:filename.stat()
        host=m.Host.__new__(m.Host);host.lock=1;host.retained=before;host.retained_identity=expected
        host.retained_raw_mounts=copy.deepcopy(before['Mounts']);host.retained_mount_order_variations=0
        host.original=original;host.proposed=None;host.switched=False;host.old_port=3000;host.plan={}
        calls=[0]
        def docker(method,target,body=None):
            assert method=='GET' and target=='/containers/'+before['Id']+'/json'
            calls[0]+=1;return copy.deepcopy(after if calls[0]%2 else before)
        m.docker=docker;m.health=lambda port,release:None
        for i in range(6):host.guard()
        assert host.retained_mount_order_variations==3 and before==untouched
        after['Mounts'][0]['RW']=True
        try:host.guard()
        except m.ReleaseError as error:
            assert str(error)=='china_host_retained_changed' and error.retained_fence['changedFields']==['Mounts']
        else:raise AssertionError('actual changed mount accepted')
        assert host.retained_mount_order_variations==3
    print('ok')
else:
    actual_ingress=b'nginx'
    expected_field=None
    if case=='rw':after['Mounts'][0]['RW']=True;expected_field='Mounts'
    if case=='extra_attribute':after['Mounts'][0]['NewPrivateAttribute']='secret';expected_field='Mounts'
    if case=='missing_attribute':after['Mounts'][0].pop('Mode');expected_field='Mounts'
    if case=='different_mount':after['Mounts'][0]['Source']='/PRIVATE/other';expected_field='Mounts'
    if case=='config':after['Config']['Env']=['SECRET=changed'];expected_field='Config'
    if case=='hostconfig':after['HostConfig']['Memory']=1024;expected_field='HostConfig'
    if case=='pid':after['State']['Pid']=200;expected_field='Pid'
    if case=='started':after['State']['StartedAt']='2026-11-24T12:00:00Z';expected_field='StartedAt'
    if case=='running':after['State']['Running']=False;expected_field='Running'
    if case=='restart':after['RestartCount']=1;expected_field='RestartCount'
    if case=='ingress':actual_ingress=b'changed nginx'
    try:m.retained_snapshot_guard(b'nginx',actual_ingress,expected,after,before['Mounts'],'reuse_retained_changed')
    except m.ReleaseError as error:
        assert str(error)=='china_host_reuse_retained_changed'
        value=error.retained_fence
        assert value['changedFields']==([expected_field] if expected_field else [])
        assert value['ingressChanged']==(case=='ingress')
        assert value['mountOrderOnly']==(expected_field!='Mounts')
        assert value['beforePid']==100 and value['afterPid']==(200 if case=='pid' else 100)
        encoded=json.dumps(value);assert 'PRIVATE' not in encoded and 'SECRET' not in encoded and 'secret' not in encoded
        print(encoded)
    else:raise AssertionError('actual protected change accepted')
`;
for(const name of ['reorder','duplicate','counter','rw','extra_attribute','missing_attribute','different_mount',
  'config','hostconfig','pid','started','running','restart','ingress']) test('retained identity: '+name,()=>{
  const result=spawnSync('python3',['-I','-B','-c',harness,hostFile,name],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  if(!['reorder','duplicate','counter'].includes(name))checkedRetainedFenceReport(JSON.parse(result.stdout));
});
const safe={version:1,kind:'china-host-retained-fence-v1',ingressChanged:false,changedFields:['Pid'],mountOrderOnly:true,
  beforePid:100,afterPid:200,beforeStartedAt:'2026-11-24T01:00:00Z',afterStartedAt:'2026-11-24T12:00:00Z'};
test('retained fence transport preserves only the strict safe report',async t=>{
  for(const value of [{...safe,Env:['secret']},{...safe,changedFields:['SECRET_ENV_VALUE']},
    {...safe,beforeStartedAt:'private payload'}, {...safe,beforePid:'private payload'}])
    assert.throws(()=>checkedRetainedFenceReport(value),/china_ssh_retained_fence_report/);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(raw,_encoding,callback){const request=JSON.parse(raw);callback();
    queueMicrotask(()=>child.stdout.write(JSON.stringify({kind:'error',id:request.id,code:'china_host_reuse_retained_changed',retainedFence:safe})+'\n'));}});
  child.kill=()=>{queueMicrotask(()=>child.emit('close',255,null));return true;};
  const session=new ChinaSshSession(child);t.after(()=>session.abort());
  await assert.rejects(session.call('resume_init',{}),error=>error.message==='china_host_reuse_retained_changed'
    && JSON.stringify(error.retainedFence)===JSON.stringify(safe));
});
