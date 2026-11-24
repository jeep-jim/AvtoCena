import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {checkedHomePhaseTimingReport, ChinaSshSession} from '../scripts/catalog-next/release-ssh.mjs';

const hostFile = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
const span = () => ({trace: '12345678-1234-1234-1234-123456789012', phase: 'snapshot', ms: 25.4,
  ok: true, policyDate: '2026-11-25', completedPolicyDate: '2026-11-25', generation: 'gen_123_abc'});
function evidence() {
  return {version: 1, kind: 'china-home-phase-timing-v1', runtimeSha: 'a'.repeat(40), nonce: 'b'.repeat(32),
    logBytes: 512, logLines: 2, rejectedRows: 1, limited: false, rows: [span()]};
}

test('timing evidence validates every existing phase and is copied without changing verdict fields', () => {
  const value = evidence(), copied = checkedHomePhaseTimingReport(value, value);
  assert.deepEqual(copied, value); assert.notEqual(copied.rows[0], value.rows[0]);
  for (const phase of ['dealer', 'snapshot', 'counts', 'green', 'greenPricing', 'catalogPricing', 'dealerRail', 'japanRail',
    'snapshotContext', 'snapshotBody', 'snapshotPrepared', 'snapshotManifest', 'snapshotOverview', 'snapshotProjection',
    'snapshotEditorialPrepared', ...['china', 'japan', 'korea', 'uae', 'europe', 'georgia'].map(m => 'snapshotEditorial:' + m)]) {
    const value = evidence(); value.rows[0].phase = phase; assert.doesNotThrow(() => checkedHomePhaseTimingReport(value));
  }
  assert.doesNotThrow(() => checkedHomePhaseTimingReport({...evidence(), rows: [], logBytes: 0, logLines: 0, rejectedRows: 0}));
  assert.throws(() => checkedHomePhaseTimingReport(value, {...value, nonce: 'c'.repeat(32)}), /china_ssh_home_phase_timing_report/);
  assert.throws(() => checkedHomePhaseTimingReport(value, {...value, runtimeSha: 'c'.repeat(40)}), /china_ssh_home_phase_timing_report/);
});

test('timing boundary rejects private fields, unknown phases/identifiers, invalid dates and malformed bounded numbers', () => {
  const changes = [v => { v.raw = 'PRIVATE'; }, v => { v.rows[0].exception = 'PRIVATE'; },
    v => { v.rows[0].phase = 'snapshotEditorial:private'; }, v => { v.rows[0].trace = 'PRIVATE'; },
    v => { v.rows[0].generation = 'https://PRIVATE'; }, v => { v.rows[0].generation = 'gen_' + '1'.repeat(21) + '_a'; },
    v => { v.rows[0].policyDate = '2026-02-30'; }, v => { v.rows[0].completedPolicyDate = '0000-01-01'; },
    v => { v.rows[0].ok = 1; }, v => { v.rows[0].ms = NaN; }, v => { v.rows[0].ms = Infinity; },
    v => { v.rows[0].ms = -1; }, v => { v.rows[0].ms = 86400001; }, v => { v.rows[0].ms = true; },
    v => { v.rows[0].ms = '1'; }, v => { v.rows[0].ms = null; }, v => { v.runtimeSha = 'PRIVATE'; },
    v => { v.nonce = ['b'.repeat(32)]; }, v => { v.logBytes = 512 * 1024 + 1; }, v => { v.logBytes = -1; },
    v => { v.logLines = 2049; }, v => { v.logLines = false; }, v => { v.rejectedRows = 2; },
    v => { v.rejectedRows = 0.5; }, v => { v.limited = 1; }, v => { v.rows = Array(513).fill(span()); v.logLines = 514; }];
  for (const change of changes) {
    const value = evidence(); change(value);
    assert.throws(() => checkedHomePhaseTimingReport(value), /china_ssh_home_phase_timing_report/);
  }
});

function session(t, kind, homePhaseTiming) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({write(raw, _encoding, callback) {
    const request = JSON.parse(raw); callback();
    queueMicrotask(() => child.stdout.write(JSON.stringify(kind === 'error'
      ? {kind, id: request.id, code: 'china_host_server_speed_failed', homePhaseTiming}
      : {kind, id: request.id, value: {speedPassed: true, samples: [], homePhaseTiming}}) + '\n'));
  }});
  child.kill = () => { queueMicrotask(() => child.emit('close', 255, null)); return true; };
  const client = new ChinaSshSession(child); t.after(() => client.abort()); return client;
}

test('SSH preserves validated timing observations on both gate success and its original failure', async t => {
  const value = evidence();
  assert.deepEqual((await session(t, 'result', value).call('speed')).homePhaseTiming, value);
  await assert.rejects(session(t, 'error', value).call('speed'), error => {
    assert.equal(error.message, 'china_host_server_speed_failed'); assert.deepEqual(error.homePhaseTiming, value); return true;
  });
});

test('absent/malformed optional timing cannot fail a successful gate or replace a failed gate', async t => {
  for (const value of [undefined, null, {...evidence(), logs: 'PRIVATE'}, {...evidence(), rows: [{...span(), ms: null}]}]) {
    const success = session(t, 'result', value), failure = session(t, 'error', value);
    assert.deepEqual(await success.call('speed'), {speedPassed: true, samples: []});
    await assert.rejects(failure.call('speed'), error => {
      assert.equal(error.message, 'china_host_server_speed_failed'); assert.equal(error.homePhaseTiming, undefined); return true;
    });
    assert.equal(success.pending.size, 0); assert.equal(failure.pending.size, 0);
  }
});

const harness = String.raw`
import copy, importlib.util, io, json, pathlib, signal, subprocess, sys, tempfile, time, types
from urllib.parse import urlsplit, parse_qs
spec = importlib.util.spec_from_file_location('china_host', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
case = sys.argv[2]
span = {'trace':'12345678-1234-1234-1234-123456789012','phase':'snapshot','ms':25.4,'ok':True,
        'policyDate':'2026-11-25','completedPolicyDate':'2026-11-25','generation':'gen_123_abc'}
def line(value): return b'home_phase ' + m.json_bytes(value) + b'\n'
def frame(data, stream=1): return bytes([stream,0,0,0]) + len(data).to_bytes(4,'big') + data
def forbidden(*args, **kwargs): raise AssertionError('network/page/provider request is forbidden')
m.socket.socket = forbidden
m.docker = forbidden
m.health = forbidden
plan = {'runtimeSha':'a'*40,'nonce':'b'*32}

if case == 'parser':
    private = {**span,'sourceUrl':'https://PRIVATE','offerIds':['PRIVATE'],'config':{'SECRET':'PRIVATE'},'error':'PRIVATE'}
    raw = frame(line(private)[:80]) + frame(b'PRIVATE arbitrary error\n',2) + frame(line(private)[80:])
    result = m.home_timing_rows(raw)
    assert result['rows'] == [span] and result['logLines'] == 2 and result['rejectedRows'] == 0 and not result['limited']
    assert 'PRIVATE' not in json.dumps(result)
    changes = [('phase','PRIVATE'),('phase',{}),('trace','PRIVATE'),('ms',float('nan')),('ms',float('inf')),
        ('ms',-1),('ms',86400001),('ms',True),('ms','1'),('ok',1),('policyDate','2026-02-30'),('completedPolicyDate',None)]
    for key,value in changes: assert m.home_timing_row(line({**span,key:value}).strip()) is None
    assert m.home_timing_row(b'home_phase {not valid json}') is None
    assert m.home_timing_row(b'home_phase '+b'['*2000+b']'*2000) is None
    assert m.home_timing_row(b'home_phase '+b'x'*17000) is None
    assert m.home_timing_row(line({**span,'generation':'PRIVATE'}).strip()) == {k:v for k,v in span.items() if k!='generation'}
    for phase in m.HOME_TIMING_PHASES: assert m.home_timing_row(line({**span,'phase':phase}).strip())['phase']==phase
    result = m.home_timing_rows(frame(line({**span,'phase':'PRIVATE'})+b'not a span\n'+line(span)))
    assert result['logLines']==3 and result['rejectedRows']==1 and result['rows']==[span]
    try: m.home_timing_rows(b'PRIVATE raw non-multiplexed logs')
    except ValueError: pass
    else: raise AssertionError('raw non-TTY framing must not be guessed')
elif case == 'parser_bounds':
    result = m.home_timing_rows(frame(line(span)*513))
    assert len(result['rows'])==512 and result['logLines']==512 and result['limited']
    result = m.home_timing_rows(frame(b'ignored\n'*2049))
    assert result['logLines']==2048 and result['rows']==[] and result['limited']
    result = m.home_timing_rows(frame(line(span))+frame(b'PRIVATE'*100000))
    assert result['logBytes']==512*1024 and result['rows']==[span] and result['limited']
    assert m.home_timing_rows(frame(line(span)[:-1]))['limited']
    assert m.home_timing_rows(b'')['rows']==[]
elif case in ('capture', 'capture_timeout', 'capture_alarm', 'capture_http'):
    calls = []
    raw = frame(line({**span,'private':'PRIVATE'}))
    previous = signal.getsignal(signal.SIGALRM)
    class Response:
        status = 503 if case=='capture_http' else 200
        def read(self, bound):
            calls.append(('read',bound))
            assert bound==512*1024+1
            if case=='capture_timeout': time.sleep(1)
            return raw
    class Docker:
        def request(self, method, target):
            calls.append(('request',method,target)); assert method=='GET'
            url=urlsplit(target); assert url.path=='/containers/'+'c'*64+'/logs'
            query=parse_qs(url.query)
            assert query=={'stdout':['1'],'stderr':['1'],'follow':['0'],'timestamps':['0'],'tail':['2048'],
                          'since':['123'],'until':[str(int(time.time())+1)]}
            assert self.timeout==m.HOME_TIMING_CAPTURE_SECONDS
        def getresponse(self): return Response()
        def close(self): calls.append(('close',))
    m.Docker = Docker
    if case=='capture_timeout': m.HOME_TIMING_CAPTURE_SECONDS=0.03
    if case=='capture_alarm':
        signal.setitimer(signal.ITIMER_REAL,10)
        assert m.capture_home_timing('c'*64,123,plan) is None and calls==[]
        assert signal.getitimer(signal.ITIMER_REAL)[0]>9
        signal.setitimer(signal.ITIMER_REAL,0)
    else:
        started=time.monotonic()
        try: value=m.capture_home_timing('c'*64,123,plan)
        except m.HomeTimingTimeout: assert case=='capture_timeout' and time.monotonic()-started<0.5
        except ValueError: assert case=='capture_http'
        else:
            assert case=='capture' and value['rows']==[span] and value['runtimeSha']==plan['runtimeSha'] and value['nonce']==plan['nonce']
            assert 'PRIVATE' not in json.dumps(value)
        assert calls[-1]==('close',) and signal.getsignal(signal.SIGALRM)==previous
        assert signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
else:
    with tempfile.TemporaryDirectory() as directory:
        host=m.Host.__new__(m.Host); host.plan=plan; host.directory=pathlib.Path(directory)
        host.spec={'Env':['CATALOG_HOME_PHASE_TIMING=1','CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS=1800']}
        if case=='speed_disabled': host.spec={'Env':[]}
        host.candidate='c'*64; host.port=3004; host.speed_passed=False; host.lock=None; host.switched=host.accepted=False
        events=[]; host.verify_candidate=lambda:events.append('verify')
        host.cleanup=lambda:events.append('cleanup')
        gate_error=subprocess.TimeoutExpired('existing-gate',1500)
        def gate(args,**kwargs):
            events.append('gate')
            assert args==['/usr/bin/python3','-I','-B',str(host.directory/'regcloud-performance-gate.py'),'http://127.0.0.1:3004',plan['runtimeSha']]
            assert kwargs=={'stdout':subprocess.PIPE,'stderr':subprocess.PIPE,'env':{'PATH':'/usr/bin:/bin',
                'AVTOCENA_RELEASE_MARKETS':'china','AVTOCENA_SPEED_BASELINE_MODE':'enforce',
                'AVTOCENA_SPEED_BASELINE':str(host.directory/'accepted-speed-baseline.json')},'timeout':1500}
            if case=='speed_timeout': raise gate_error
            return types.SimpleNamespace(returncode=0 if case in ('speed_success','speed_disabled') else 1,stdout=b'{}\n')
        m.subprocess.run=gate
        def capture(candidate,since,received_plan):
            events.append('capture'); assert candidate==host.candidate and type(since) is int and received_plan==plan
            if case=='speed_disabled': raise AssertionError('timing disabled')
            if case=='speed_capture_failure': raise ValueError('PRIVATE diagnostic error')
            return {'version':1,'kind':'china-home-phase-timing-v1',**plan,'logBytes':100,'logLines':1,
                    'rejectedRows':0,'limited':False,'rows':[span]}
        m.capture_home_timing=capture
        if case=='speed_save_failure':
            real_write=m.new_file
            def fail_save(path,raw,*args,**kwargs):
                if path.name=='HOME_PHASE_TIMING.json': raise OSError('PRIVATE file error')
                return real_write(path,raw,*args,**kwargs)
            m.new_file=fail_save
        if case in ('speed_success','speed_disabled'):
            result=host.speed(); assert result['speedPassed'] and host.speed_passed
            if case=='speed_success':
                assert result['homePhaseTiming']['rows']==[span]
                assert json.loads((host.directory/'HOME_PHASE_TIMING.json').read_bytes())==result['homePhaseTiming']
                assert (host.directory/'HOME_PHASE_TIMING.json').stat().st_mode&0o777==0o400
                assert events==['verify','gate','capture','verify']
            else: assert result=={'speedPassed':True,'samples':[{}]} and events==['verify','gate','verify']
        else:
            messages=[]; m.emit=messages.append; m.Host=lambda plan:host
            sys.stdin=types.SimpleNamespace(buffer=io.BytesIO(b'{"id":1,"method":"init","params":{"plan":{}}}\n{"id":2,"method":"speed"}\n'))
            try: m.main()
            except subprocess.TimeoutExpired as error: assert case=='speed_timeout' and error is gate_error
            except m.ReleaseError as error: assert str(error)=='china_host_server_speed_failed'
            else: raise AssertionError('gate failure must remain a failure')
            failure=messages[-1]
            assert failure['kind']=='error' and failure['code']==('china_host_operation_failed' if case=='speed_timeout' else 'china_host_server_speed_failed')
            assert not host.speed_passed and events==['verify','gate','capture','cleanup']
            assert 'PRIVATE' not in json.dumps(failure)
            if case in ('speed_capture_failure','speed_save_failure'):
                assert 'homePhaseTiming' not in failure and not (host.directory/'HOME_PHASE_TIMING.json').exists()
            else:
                assert failure['homePhaseTiming']['rows']==[span]
                assert (host.directory/'HOME_PHASE_TIMING.json').exists()
print('ok')
`;

for (const name of ['parser', 'parser_bounds', 'capture', 'capture_timeout', 'capture_alarm', 'capture_http',
  'speed_success', 'speed_disabled', 'speed_failure', 'speed_capture_failure', 'speed_save_failure', 'speed_timeout']) {
  test('actual host timing path: ' + name, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, hostFile, name], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'ok');
  });
}
