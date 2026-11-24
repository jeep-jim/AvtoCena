import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const hostFile = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
const harness = String.raw`
import copy, datetime, hashlib, importlib.util, io, json, os, pathlib, stat, sys, tempfile
from urllib.parse import parse_qs, urlparse
spec = importlib.util.spec_from_file_location('china_host', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
case = sys.argv[2]
def refused(call, reason):
    try: call()
    except m.ReleaseError as error: assert str(error) == 'china_host_' + reason, str(error)
    else: raise AssertionError('expected refusal: ' + reason)
def forbidden(*args, **kwargs): raise AssertionError('mutation, bulk hashing or network is forbidden')
m.command = m.file_sha = m.new_file = m.socket.socket = m.subprocess.run = forbidden
m.time.time = lambda: 1795521600 # 2026-11-24 12:00 UTC
operations = []
with tempfile.TemporaryDirectory(prefix='china-diagnose-test-') as temporary:
    root = pathlib.Path(temporary); root.chmod(0o700); m.BASE = root
    # Test files are owned by this unprivileged test process. Keep all the
    # production path/type/link/size checks and substitute only the fixture UID.
    def regular(filename, maximum=None):
        info = filename.lstat()
        m.need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not filename.is_symlink(), 'regular_file')
        m.need(filename.resolve() == filename and info.st_uid == os.getuid(), 'file_owner')
        if maximum is not None: m.need(info.st_size <= maximum, 'file_size')
        return info
    def private(directory):
        m.need(directory.resolve() == directory and directory.is_dir() and directory.stat().st_uid == os.getuid()
               and not directory.stat().st_mode & 0o022, 'recovery_directory')
    m.regular, m.private_directory = regular, private
    selector = {'runtimeSha': 'a' * 40, 'pricingRuntimeSha': 'b' * 40, 'controllerSha': 'c' * 40,
        'generationId': 'gen_china_45369451603_1', 'generationManifestSha256': '', 'imageId': 'sha256:' + 'd' * 64,
        'since': '2026-11-24T11:36:00Z', 'until': '2026-11-24T11:39:30Z'}
    generation = {'generationId': selector['generationId'], 'runtimeSha': selector['pricingRuntimeSha'], 'prepared': True}
    generation_raw = m.json_bytes(generation); selector['generationManifestSha256'] = m.sha(generation_raw)
    nonce = 'e' * 32
    directory = root / selector['runtimeSha'] / 'china-next' / nonce
    directory.mkdir(parents=True, mode=0o700); (directory / 'generation').mkdir(mode=0o700)
    generation_names = {'GENERATION.json','details.sqlite','query.sqlite','FILTER_SEMANTICS.json','FX_RECEIPT.json',
                        'RECONCILIATION.json','DISPOSITIONS.ndjson'}
    files = []
    def put(filename, raw):
        if filename.exists(): filename.chmod(0o600)
        filename.write_bytes(raw); filename.chmod(0o400)
    for name in sorted(m.FILE_NAMES):
        raw = generation_raw if name == 'GENERATION.json' else b'PRIVATE_PAID_DATA_NOT_FOR_DIAGNOSTICS'
        filename = (directory / 'generation' if name in generation_names else directory) / name
        put(filename, raw)
        files.append({'name': name, 'bytes': len(raw), 'sha256': m.sha(raw), 'compressedBytes': 1, 'compressedSha256': '1' * 64})
    next(f for f in files if f['name'] == 'accepted-speed-baseline.json')['sha256'] = \
        '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'
    plan = {key: value for key, value in selector.items() if key not in ('since','until')}
    plan.update(version=1,market='china',retainedRuntime=m.RETAINED,servingCalculationVersion=m.CALCULATION,
        nonce=nonce,runtimeTree='2'*40,runtimeDiffSha256='3'*64,privateGenerationReceiptSha256='4'*64,
        sourceDescriptorSha256='5'*64,previousAcceptedETag=None,previousAcceptedStateSha256=None,files=files)
    put(directory/'PLAN.json', m.json_bytes(plan))
    rollback = {'version':1,'kind':'china-host-rollback-v1','nonce':nonce,'release':plan['runtimeSha'],
        'pricingRuntimeSha':plan['pricingRuntimeSha'],'generationId':plan['generationId'],
        'generationManifestSha256':plan['generationManifestSha256'],'imageId':plan['imageId'],
        'privateGenerationReceiptSha256':plan['privateGenerationReceiptSha256'],'sourceDescriptorSha256':plan['sourceDescriptorSha256'],
        'retainedRuntimeSha':m.RETAINED,'retainedRunning':True,'candidateRemoved':True,'ingressRestored':True,
        'retainedContainerId':'6'*64,'retainedImageId':'sha256:'+'7'*64,'rolledBackAt':'2026-11-24T11:38:44Z'}
    put(directory/'ROLLED_BACK.json',m.json_bytes(rollback))
    m.CONFIG = root/'nginx.conf'
    put(m.CONFIG,b'server {\n proxy_pass http://127.0.0.1:3000;\n}\n')
    retained = {'Id':rollback['retainedContainerId'],'Image':rollback['retainedImageId'],
        'Config':{'Env':['PRIVATE_ENV=never-print','AVTOCENA_RELEASE_SHA='+m.RETAINED,'AVTOCENA_CALCULATION_VERSION='+m.CALCULATION]},
        'HostConfig':{'PortBindings':{'3000/tcp':[{'HostPort':'3000'}]}},'Mounts':[],
        'State':{'Running':True,'Pid':123,'StartedAt':'2026-11-23T00:00:00Z'},'RestartCount':0}
    image = {'Id':plan['imageId'],'Os':'linux','Architecture':'amd64',
        'Config':{'Labels':{'org.opencontainers.image.revision':plan['runtimeSha']},'Env':['SECRET=never-print']}}
    candidate = {'Id':'8'*64,'Image':plan['imageId'],'Config':{'Labels':{'avtocena.china.nonce':nonce,
        'org.opencontainers.image.revision':plan['runtimeSha'],'avtocena.role':'independent-china'}},
        'State':{'Running':False,'Status':'exited','ExitCode':1,'OOMKilled':False,'Error':'PRIVATE_ERROR'}}
    event_at = int(datetime.datetime.fromisoformat('2026-11-24T11:36:42+00:00').timestamp())
    events = [{'Type':'container','Action':'start','time':event_at,'Actor':{'ID':'8'*64,'Attributes':{
        'avtocena.china.nonce':nonce,'org.opencontainers.image.revision':plan['runtimeSha'],'private-label':'never-print'}}},
        {'Type':'container','Action':'die','time':event_at+1,'Actor':{'ID':'8'*64,'Attributes':{
        'avtocena.china.nonce':nonce,'org.opencontainers.image.revision':plan['runtimeSha'],'exitCode':'1'}}}]
    def docker(method,target,body=None):
        assert method == 'GET' and body is None, 'diagnosis may not mutate Docker'
        operations.append((method,target))
        if target == '/containers/'+retained['Id']+'/json': return copy.deepcopy(retained)
        if target == '/images/'+plan['imageId']+'/json':
            if case == 'image_missing': raise m.ReleaseError('china_host_docker_http_404')
            return copy.deepcopy(image)
        if target.startswith('/containers/json?all=1&'):
            filters=json.loads(parse_qs(urlparse(target).query)['filters'][0])
            assert filters == {'label':['avtocena.china.nonce='+nonce]}
            return [{'Id':candidate['Id']}] if case == 'candidate_exists' else []
        if target == '/containers/'+candidate['Id']+'/json': return copy.deepcopy(candidate)
        raise AssertionError('unapproved Docker read')
    m.docker = docker
    class Connection:
        def __init__(self): self.timeout=0
        def request(self,method,target):
            assert method == 'GET' and target.startswith('/events?')
            query=parse_qs(urlparse(target).query); filters=json.loads(query['filters'][0])
            assert int(query['until'][0])-int(query['since'][0]) == 210
            assert filters['label'] == ['avtocena.china.nonce='+nonce,'org.opencontainers.image.revision='+plan['runtimeSha']]
            operations.append((method,'events'))
            if case == 'events_unavailable': raise OSError('private daemon diagnostic')
        def getresponse(self): return self
        status=200
        def read(self,maximum):
            assert maximum==1024*1024+1
            return b'\n'.join(m.json_bytes(e) for e in events)
        def close(self): pass
    m.Docker=Connection
    if case == 'ambiguous':
        another=directory.parent/('f'*32); another.mkdir(mode=0o700)
        put(another/'PLAN.json',m.json_bytes({**plan,'nonce':'f'*32}))
        refused(lambda:m.diagnose_startup(selector),'diagnosis_unique_plan')
    elif case == 'selector_mismatch':
        refused(lambda:m.diagnose_startup({**selector,'imageId':'sha256:'+'f'*64}),'diagnosis_unique_plan')
    elif case == 'accepted':
        put(directory/'ACCEPTED.json',b'{}')
        refused(lambda:m.diagnose_startup(selector),'diagnosis_accepted')
    elif case == 'forged_rollback':
        put(directory/'ROLLED_BACK.json',m.json_bytes({**rollback,'nonce':'f'*32}))
        refused(lambda:m.diagnose_startup(selector),'diagnosis_rollback')
    elif case == 'symlink':
        filename=directory/'generation'/'details.sqlite'; filename.unlink(); filename.symlink_to(directory/'generation'/'query.sqlite')
        refused(lambda:m.diagnose_startup(selector),'regular_file')
    elif case == 'bad_window':
        refused(lambda:m.diagnose_startup({**selector,'since':'2026-11-24T00:00:00Z'}),'diagnosis_window')
    else:
        if case == 'missing_bulk': (directory/'generation'/'details.sqlite').unlink()
        if case == 'bad_size': put(directory/'generation'/'query.sqlite',b'short')
        if case == 'events_empty': events.clear()
        if case == 'foreign_events': events[0]['Actor']['Attributes']['avtocena.china.nonce']='f'*32
        if case == 'oom': events[1]['Action']='oom'; events[1]['Actor']['Attributes'].pop('exitCode')
        if case == 'disk_capacity': m.os.statvfs=lambda filename: type('Disk',(),{'f_bavail':12345,'f_frsize':4096})()
        def fingerprint():
            return {str(f.relative_to(root)):(hashlib.sha256(f.read_bytes()).hexdigest(),stat.S_IMODE(f.stat().st_mode),f.stat().st_ino)
                    for f in root.rglob('*') if f.is_file()}
        before=fingerprint()
        result=m.diagnose_startup(selector)
        assert fingerprint()==before, 'read-only method changed files'
        assert result['readOnly'] and result['selector']==selector and result['nonce']==nonce
        assert result['planSha256']==m.sha((directory/'PLAN.json').read_bytes())
        assert result['rollbackSha256']==m.sha((directory/'ROLLED_BACK.json').read_bytes())
        assert result['retained']=={'identityConfirmed':True,'running':True}
        assert result['generationVerified'] and len(result['files'])==11
        assert type(result['diskFreeBytes']) is int and 0 <= result['diskFreeBytes'] <= 9007199254740991
        if case=='disk_capacity': assert result['diskFreeBytes']==12345*4096
        encoded=json.dumps(result)
        assert not any(word in encoded for word in ('PRIVATE','never-print','Env','Attributes','Error'))
        if case=='missing_bulk': assert next(f for f in result['files'] if f['name']=='details.sqlite')['present'] is False
        if case=='bad_size': assert next(f for f in result['files'] if f['name']=='query.sqlite')['sizeMatches'] is False
        if case=='image_missing': assert result['image']=={'present':False,'identityMatches':False}
        if case=='candidate_exists': assert result['candidate']=={'present':True,'running':False,'status':'exited','exitCode':1,'oomKilled':False}
        else: assert result['candidate']['present'] is False
        if case in ('events_unavailable','foreign_events'): assert result['events']=={'available':False,'reason':'unavailable','rows':[]}
        elif case=='events_empty': assert result['events']=={'available':True,'reason':'empty','rows':[]}
        else:
            assert result['events']['available'] and result['events']['reason'] is None
            assert result['events']['rows'][1]['oom']==(case=='oom')
            assert result['events']['rows'][1]['exitCode']==(None if case=='oom' else 1)
        if case in ('protocol','protocol_mutation'):
            calls=[{'id':1,'method':'diagnose','params':selector},{'id':2,'method':'init' if case=='protocol_mutation' else 'close','params':{}}]
            stdin=type('Input',(),{'buffer':io.BytesIO(b''.join(m.json_bytes(c)+b'\n' for c in calls))})()
            old_in,old_out=sys.stdin,sys.stdout; output=io.StringIO(); sys.stdin,sys.stdout=stdin,output
            m.Host=forbidden
            try:
                if case=='protocol_mutation': refused(m.main,'diagnosis_read_only')
                else: m.main()
            finally: sys.stdin,sys.stdout=old_in,old_out
            messages=[json.loads(line) for line in output.getvalue().splitlines()]
            if case=='protocol': assert messages[-1]['value']=={'closed':True,'readOnly':True}
            else: assert messages[-1]['code']=='china_host_diagnosis_read_only'
    assert all(method=='GET' for method,target in operations)
print('ok')
`;

for (const name of ['safe', 'ambiguous', 'selector_mismatch', 'accepted', 'forged_rollback', 'symlink', 'bad_window',
  'missing_bulk', 'bad_size', 'events_empty', 'events_unavailable', 'foreign_events', 'oom', 'image_missing',
  'candidate_exists', 'protocol', 'protocol_mutation', 'disk_capacity']) {
  test('startup diagnosis: ' + name, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, hostFile, name], {encoding:'utf8',timeout:10000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'ok');
  });
}
