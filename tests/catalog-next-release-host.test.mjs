import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const hostFile = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
// Exercise the real host methods against a private local directory and an
// in-memory Docker/nginx substitute. No SSH, socket or OS command is allowed.
const harness = String.raw`
import copy, gzip, importlib.util, io, json, os, pathlib, stat, sys, tempfile, types
spec = importlib.util.spec_from_file_location('china_host', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def refused(call, code):
    try:
        call()
    except m.ReleaseError as error:
        assert str(error) == 'china_host_' + code, str(error)
    else:
        raise AssertionError('required rejection: ' + code)

def forbidden(*args, **kwargs):
    raise AssertionError('real network or command is forbidden')

m.socket.socket = forbidden
m.subprocess.run = forbidden

with tempfile.TemporaryDirectory(prefix='china-host-test-') as directory:
    root = pathlib.Path(directory)
    root.chmod(0o700)
    m.CONFIG = root / 'nginx.conf'
    original = b'server {\n location / {\n  proxy_pass http://127.0.0.1:3000;\n }\n}\n'
    m.CONFIG.write_bytes(original)
    m.CONFIG.chmod(0o600)
    operations = []
    live = {'port': 3000, 'fail_reload': False}
    def regular(filename, maximum=None):
        metadata = filename.lstat()
        assert filename.resolve().is_relative_to(root)
        assert stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and not filename.is_symlink()
        if maximum is not None:
            assert metadata.st_size <= maximum
        return metadata
    m.regular = regular
    def private_directory(directory):
        assert directory.resolve().is_relative_to(root) and directory.is_dir()
        assert not directory.stat().st_mode & 0o022
    m.private_directory = private_directory
    m.BASE = root
    def command(args, timeout=120):
        assert args in (['/usr/sbin/nginx', '-t'], ['/usr/bin/systemctl', 'reload', 'nginx'])
        operations.append(('command', args))
        if args[0] == '/usr/bin/systemctl':
            live['port'] = m.backend(m.CONFIG.read_bytes())
            if live['fail_reload']:
                live['fail_reload'] = False
                raise m.ReleaseError('china_host_command_failed')
        return b''
    m.command = command
    m.health = lambda port, release: operations.append(('health', port, release))
    host = m.Host.__new__(m.Host)
    host.plan = {'runtimeSha': 'c' * 40, 'pricingRuntimeSha': 'a' * 40, 'runtimeTree': 'd' * 40, 'controllerSha': 'e' * 40,
        'nonce': 'f' * 32, 'imageId': 'sha256:' + 'a' * 64, 'generationId': 'gen_china_123_1',
        'generationManifestSha256': 'b' * 64, 'privateGenerationReceiptSha256': '8' * 64, 'sourceDescriptorSha256': '9' * 64}
    host.directory = root / host.plan['runtimeSha'] / 'china-next' / host.plan['nonce']
    host.directory.mkdir(mode=0o700, parents=True)
    host.generation = host.directory / 'generation'
    host.generation.mkdir(mode=0o700)
    host.uploaded = set()
    host.candidate = '2' * 64
    host.switched = host.accepted = host.functional_passed = host.speed_passed = False
    host.verdict_deadline = None
    host.lock = 999
    host.old_port, host.port = 3000, 3004
    host.original, host.proposed, host.restart = original, None, 'no'
    retained = {'Id': '1' * 64, 'Image': 'sha256:' + '1' * 64,
        'Config': {'Env': ['PRIVATE=do-not-print'], 'Labels': {}, 'Cmd': ['node', 'server.js'], 'Entrypoint': None},
        'HostConfig': {'Privileged': False}, 'Mounts': [{'Source': '/private/encyclopedia', 'RW': False}],
        'State': {'Running': True, 'Pid': 100, 'StartedAt': '2026-11-24T00:00:00Z'}, 'RestartCount': 0}
    host.retained = copy.deepcopy(retained)
    host.retained_identity = m.protected_identity(host.retained)
    host.spec = {'Env': ['PRIVATE=do-not-print', 'LOCAL_CHINA=1'], 'Cmd': ['node', 'server.js'], 'Entrypoint': None,
        'HostConfig': {'Binds': ['/private/generation:/run/avtocena-china-generation:ro'],
            'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3004'}]}}}
    candidate = {'Id': host.candidate, 'Image': host.plan['imageId'], 'State': {'Running': True}, 'RestartCount': 0,
        'Config': {key: copy.deepcopy(host.spec[key]) for key in ('Env', 'Cmd', 'Entrypoint')},
        'HostConfig': {**copy.deepcopy(host.spec['HostConfig']), 'Privileged': False, 'RestartPolicy': {'Name': 'no'}}}
    candidate['Config']['Labels'] = {'avtocena.china.nonce': host.plan['nonce']}
    containers = {retained['Id']: retained, candidate['Id']: candidate}
    retained_before = copy.deepcopy(retained)
    def docker(method, target, body=None):
        operations.append(('docker', method, target))
        if method == 'GET' and target.endswith('/json'):
            return copy.deepcopy(containers[target.split('/')[2]])
        identity = target.split('/')[2].split('?')[0]
        assert identity == host.candidate, 'cannot mutate a retained or unrelated container'
        if method == 'POST' and target.endswith('/update'):
            containers[identity]['HostConfig']['RestartPolicy'] = body['RestartPolicy']
        elif method == 'POST' and '/stop?' in target:
            containers[identity]['State']['Running'] = False
        elif method == 'DELETE':
            del containers[identity]
        else:
            raise AssertionError('unexpected Docker method')
        return None
    m.docker = docker
    def browser_reports():
        speed = m.json_bytes({'release': host.plan['runtimeSha'], 'passed': True,
            'browserPassed': True, 'speedGuard': {'passed': True}})
        details = m.json_bytes({'kind': 'china-browser-details-v1', 'release': host.plan['runtimeSha'],
            'nonce': host.plan['nonce'], 'passed': True, 'generationManifestSha256': host.plan['generationManifestSha256'],
            'precedingSpeedReportSha256': m.sha(speed)})
        return speed, details
    def verdict():
        speed, details = browser_reports()
        return {'release': host.plan['runtimeSha'], 'nonce': host.plan['nonce'], 'passed': True,
            'functionalPassed': True, 'speedPassed': True, 'reportSha256': m.sha(speed + details),
            'speedReportSha256': m.sha(speed), 'detailsReportSha256': m.sha(details)}
    def save_recovery_plan():
        plan = {**copy.deepcopy(host.plan), 'version': 1, 'market': 'china', 'retainedRuntime': m.RETAINED,
            'servingCalculationVersion': m.CALCULATION, 'runtimeDiffSha256': 'a' * 64,
            'files': [{'name': name, 'bytes': 1, 'sha256': host.plan['generationManifestSha256'],
                'compressedBytes': 1, 'compressedSha256': 'c' * 64} for name in sorted(m.FILE_NAMES)]}
        next(value for value in plan['files'] if value['name'] == 'accepted-speed-baseline.json')['sha256'] = \
            '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'
        (host.directory / 'PLAN.json').write_bytes(m.json_bytes(plan))
        return {'runtimeSha': host.plan['runtimeSha'], 'nonce': host.plan['nonce']}
    def checked():
        host.functional_passed = host.speed_passed = True
    def oracle(count=8):
        cases = [{'path': '/api/catalog/search?market=china&page=' + str(i + 1), 'name': str(i),
            'total': 500, 'ids': ['id-' + str(i)], 'totalRub': [1000000 + i]} for i in range(count)]
        (host.directory / 'acceptance.json').write_text(json.dumps({'version': 1,
            'runtimeSha': host.plan['runtimeSha'], 'generationManifestSha256': host.plan['generationManifestSha256'], 'cases': cases}))
        by_path = {row['path']: {'ok': True, 'total': row['total'],
            'items': [{'id': row['ids'][0], 'totalRub': row['totalRub'][0]}]} for row in cases}
        m.response_json = lambda port, route: copy.deepcopy(by_path[route])
        return by_path
    case = sys.argv[2]
    if case == 'gates':
        refused(host.switch, 'switch_before_checks')
        refused(lambda: host.accept(verdict()), 'accept_before_switch')
        host.functional_passed = True
        refused(host.switch, 'switch_before_checks')
        assert not operations and m.CONFIG.read_bytes() == original
    elif case == 'functional':
        oracle(7)
        refused(host.functional, 'oracle_coverage')
        assert not host.functional_passed
        values = oracle()
        next(iter(values.values()))['partial'] = True
        refused(host.functional, 'incomplete_search')
        assert not host.functional_passed
        values = oracle()
        next(iter(values.values()))['items'][0]['totalRub'] += 1
        refused(host.functional, 'price_oracle')
        assert not host.functional_passed
        oracle()
        assert host.functional()['functionalPassed'] is True and host.functional_passed
        assert m.CONFIG.read_bytes() == original
    elif case == 'speed':
        invoked = []
        def speed_command(args, **kwargs):
            invoked.append((args, kwargs))
            return types.SimpleNamespace(returncode=0, stdout=b'{"performanceGate":"summary","acceptedBaselineEnforced":true}\n')
        m.subprocess.run = speed_command
        assert host.speed()['speedPassed'] and host.speed_passed
        assert invoked[0][1]['env']['AVTOCENA_SPEED_BASELINE_MODE'] == 'enforce'
        assert invoked[0][1]['env']['AVTOCENA_RELEASE_MARKETS'] == 'china'
        assert invoked[0][1]['env']['AVTOCENA_SPEED_BASELINE'].endswith('/accepted-speed-baseline.json')
        host.speed_passed = False
        (host.directory / 'server-speed-result.json').unlink()
        m.subprocess.run = lambda *args, **kwargs: types.SimpleNamespace(returncode=1, stdout=b'')
        refused(host.speed, 'server_speed_failed')
        assert not host.speed_passed
    elif case == 'rollback':
        checked()
        assert host.switch()['switched']
        assert live['port'] == 3004 and m.CONFIG.read_bytes() == host.proposed
        assert retained == retained_before
        host.cleanup()
        assert m.CONFIG.read_bytes() == original and live['port'] == 3000
        assert host.candidate is None and retained == retained_before
        assert list(containers) == [retained['Id']]
        recovered = m.read_outcome(save_recovery_plan())
        assert recovered['status'] == 'rolled_back'
        proof_raw = m.base64.b64decode(recovered['hostRollbackBase64'])
        proof = json.loads(proof_raw)
        assert m.sha(proof_raw) == recovered['hostRollbackSha256']
        assert proof['retainedContainerId'] == retained['Id'] and proof['retainedImageId'] == retained['Image']
        assert proof['ingressRestored'] and proof['retainedRunning'] and proof['candidateRemoved']
        assert proof['previousAcceptedETag'] is None and proof['previousAcceptedStateSha256'] is None
    elif case == 'failed_reload':
        checked(); live['fail_reload'] = True
        refused(host.switch, 'command_failed')
        assert host.switched and m.CONFIG.read_bytes() == host.proposed
        host.cleanup()
        assert m.CONFIG.read_bytes() == original and live['port'] == 3000
        assert retained == retained_before and host.candidate is None
    elif case == 'foreign_ingress':
        checked(); host.switch()
        foreign = b'foreign ingress owner\n'
        m.CONFIG.write_bytes(foreign)
        previous_operations = len(operations)
        refused(host.cleanup, 'rollback_ingress_changed')
        assert m.CONFIG.read_bytes() == foreign and len(operations) == previous_operations
        assert containers[host.candidate]['State']['Running'] and retained == retained_before
    elif case == 'foreign_container':
        containers[host.candidate]['Config']['Labels']['avtocena.china.nonce'] = '9' * 32
        refused(host.cleanup, 'cleanup_foreign_container')
        assert containers[host.candidate]['State']['Running']
        assert all(row[1] == 'GET' for row in operations if row[0] == 'docker')
        containers[retained['Id']]['Config']['Env'].append('ALTERED=1')
        refused(host.verify_candidate, 'retained_changed')
        assert m.CONFIG.read_bytes() == original
    elif case in ('acceptance', 'acceptance_interrupted'):
        checked(); host.switch()
        bad = verdict(); bad['nonce'] = '9' * 32
        refused(lambda: host.accept(bad), 'browser_verdict')
        assert not host.accepted and host.restart == 'no'
        host.verdict_deadline = m.time.monotonic() - 1
        refused(lambda: host.accept(verdict()), 'browser_deadline')
        assert not host.accepted and host.restart == 'no'
        host.verdict_deadline = m.time.monotonic() + 60
        generation = m.json_bytes({'runtimeSha': host.plan['pricingRuntimeSha'], 'source': {'cursor': 21, 'sourceObservedAt': '2026-11-24T00:00:00Z'}})
        (host.generation / 'GENERATION.json').write_bytes(generation)
        host.plan['generationManifestSha256'] = m.sha(generation)
        speed, details = browser_reports()
        bad_details = json.loads(details); bad_details['nonce'] = '9' * 32
        refused(lambda: host.browser_evidence({'speedBase64': m.base64.b64encode(speed).decode(),
            'detailsBase64': m.base64.b64encode(m.json_bytes(bad_details)).decode()}), 'browser_evidence_binding')
        assert not (host.directory / 'BROWSER_SPEED.json').exists()
        assert host.browser_evidence({'speedBase64': m.base64.b64encode(speed).decode(),
            'detailsBase64': m.base64.b64encode(details).decode()})['saved']
        if case == 'acceptance_interrupted':
            real_replace = m.os.replace
            def interrupted_replace(source, target):
                real_replace(source, target)
                if target.name == 'ACCEPTED.json':
                    raise m.ReleaseError('china_host_terminated')
            m.os.replace = interrupted_replace
            refused(lambda: host.accept(verdict()), 'terminated')
            m.os.replace = real_replace
            assert not host.accepted and (host.directory / 'ACCEPTED.json').exists()
            before = list(operations)
            host.cleanup()
            assert host.accepted and operations == before and live['port'] == 3004
            assert not (host.directory / 'ROLLED_BACK.json').exists()
            recovered = m.read_outcome(save_recovery_plan())
            accepted = {**recovered, 'accepted': True}
        else:
            accepted = host.accept(verdict())
        assert accepted['accepted']
        assert m.sha(m.base64.b64decode(accepted['hostReceiptBase64'])) == accepted['hostReceiptSha256']
        receipt = json.loads((host.directory / 'ACCEPTED.json').read_bytes())
        assert receipt['generationManifestSha256'] == host.plan['generationManifestSha256']
        assert receipt['nonce'] == host.plan['nonce'] and receipt['retainedContainerId'] == retained['Id']
        assert host.restart == 'unless-stopped'
        recovered = m.read_outcome(save_recovery_plan())
        assert recovered['status'] == 'accepted' and recovered['hostReceiptBase64'] == accepted['hostReceiptBase64']
        assert m.base64.b64decode(recovered['browserSpeedBase64']) == speed
        assert m.base64.b64decode(recovered['browserDetailsBase64']) == details
        (host.directory / 'BROWSER_DETAILS.json').chmod(0o600)
        (host.directory / 'BROWSER_DETAILS.json').write_bytes(b'{}')
        refused(lambda: m.read_outcome({'runtimeSha': host.plan['runtimeSha'], 'nonce': host.plan['nonce']}), 'recovery_browser')
        operations_before = len(operations)
        host.cleanup()
        assert len(operations) == operations_before and live['port'] == 3004 and retained == retained_before
        refused(lambda: host.accept(verdict()), 'accept_before_switch')
    elif case == 'private_upload':
        host.candidate = None
        raw = b'{"private":"test source bytes"}'
        packed = gzip.compress(raw)
        name = 'GENERATION.json'
        descriptor = {'name': name, 'bytes': len(raw), 'sha256': m.sha(raw),
            'compressedBytes': len(packed), 'compressedSha256': m.sha(packed)}
        host.plan['files'] = [descriptor]
        tail = b'{"id":2,"method":"next"}\n'
        stream = io.BytesIO(packed + tail)
        assert host.upload(name, stream)['verified']
        assert stream.read() == tail
        saved = host.file_path(name)
        assert saved.read_bytes() == raw and stat.S_IMODE(saved.stat().st_mode) == 0o400
        assert stat.S_IMODE(host.generation.stat().st_mode) == 0o700
        assert not (host.directory / (name + '.incoming.gz')).exists()
        refused(lambda: host.upload(name, io.BytesIO(packed)), 'upload_scope')
        refused(lambda: host.upload('../escape', io.BytesIO(packed)), 'upload_scope')
        refused(host.start, 'upload_not_complete')
        assert not operations
    elif case == 'damaged_upload':
        host.candidate = None
        raw = b'actual-data'
        packed = gzip.compress(raw)
        name = 'details.sqlite'
        host.plan['files'] = [{'name': name, 'bytes': 1, 'sha256': m.sha(raw),
            'compressedBytes': len(packed), 'compressedSha256': m.sha(packed)}]
        refused(lambda: host.upload(name, io.BytesIO(packed)), 'decoded_size')
        assert name not in host.uploaded
        refused(host.start, 'upload_not_complete')
        assert not operations and m.CONFIG.read_bytes() == original
    elif case == 'partial_verdict':
        checked(); host.switch()
        handlers, timers, messages = {}, [], []
        m.signal.signal = lambda key, callback: handlers.__setitem__(key, callback)
        m.signal.setitimer = lambda key, seconds: timers.append(seconds)
        m.emit = messages.append
        m.Host = lambda plan: host
        real_close = m.os.close
        m.os.close = lambda descriptor: None if descriptor == 999 else real_close(descriptor)
        class PartialInput:
            calls = 0
            def readline(self, limit):
                self.calls += 1
                if self.calls == 1:
                    return b'{"id":1,"method":"init","params":{"plan":{}}}\n'
                assert timers and timers[-1] > 0, 'the full readline must be timed'
                handlers[m.signal.SIGALRM]()
        previous = sys.stdin
        sys.stdin = types.SimpleNamespace(buffer=PartialInput())
        try:
            refused(m.main, 'browser_deadline')
        finally:
            sys.stdin = previous
        assert timers[-1] == 0 and any(value > 0 for value in timers)
        assert messages[-1]['code'] == 'china_host_browser_deadline'
        assert m.CONFIG.read_bytes() == original and live['port'] == 3000 and host.candidate is None
        assert retained == retained_before
    elif case == 'unproved_recovery':
        params = save_recovery_plan()
        before = list(operations)
        assert m.read_outcome(params) == {'status': 'pending'}
        assert operations == before and m.CONFIG.read_bytes() == original
        refused(lambda: m.read_outcome({'runtimeSha': '../escape', 'nonce': host.plan['nonce']}), 'recovery_identity')
    elif case == 'plan_identity':
        plan = {**copy.deepcopy(host.plan), 'version': 1, 'market': 'china', 'retainedRuntime': m.RETAINED,
            'servingCalculationVersion': m.CALCULATION, 'runtimeDiffSha256': 'a' * 64,
            'privateGenerationReceiptSha256': 'b' * 64,
            'files': [{'name': name, 'bytes': 1, 'sha256': host.plan['generationManifestSha256'],
                'compressedBytes': 1, 'compressedSha256': 'c' * 64} for name in sorted(m.FILE_NAMES)]}
        baseline = next(value for value in plan['files'] if value['name'] == 'accepted-speed-baseline.json')
        baseline['sha256'] = '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'
        m.validate_plan(plan)
        bad = copy.deepcopy(plan); bad['retainedRuntime'] = '0' * 40
        refused(lambda: m.validate_plan(bad), 'plan_scope')
        bad = copy.deepcopy(plan); bad['imageId'] = 'unbound-image-tag'
        refused(lambda: m.validate_plan(bad), 'plan_identity')
        bad = copy.deepcopy(plan)
        next(value for value in bad['files'] if value['name'] == 'accepted-speed-baseline.json')['sha256'] = '0' * 64
        refused(lambda: m.validate_plan(bad), 'speed_baseline')
        bad = copy.deepcopy(plan); bad['generationManifestSha256'] = '0' * 64
        refused(lambda: m.validate_plan(bad), 'plan_generation')
        bad = copy.deepcopy(plan); bad['files'][0]['name'] = '../foreign'
        refused(lambda: m.validate_plan(bad), 'plan_files')
        assert not operations
    else:
        raise AssertionError('unknown fixture')
    print(json.dumps({'case': case, 'passed': True}))
`;

for (const [name, description] of [
  ['gates', 'requires actual functional and speed gates before switch, and a switch before acceptance'],
  ['functional', 'requires complete oracle coverage, exact card identities and exact prices'],
  ['speed', 'enforces the accepted baseline within China scope and refuses a failed speed process'],
  ['rollback', 'rolls ingress back before removing only its own candidate'],
  ['failed_reload', 'restores the original backend after a switch reload failure'],
  ['foreign_ingress', 'never overwrites changed foreign ingress or stops its possible live backend'],
  ['foreign_container', 'preserves a foreign container and detects changed retained configuration'],
  ['acceptance', 'binds browser acceptance to the nonce, deadline and exact generation'],
  ['acceptance_interrupted', 'keeps durable acceptance after interruption at the atomic commit point'],
  ['private_upload', 'verifies exact private uploaded bytes without consuming the next command'],
  ['damaged_upload', 'cannot start from truncated or oversized decoded private files'],
  ['partial_verdict', 'times the complete browser-verdict read and rolls back a partial stalled message'],
  ['unproved_recovery', 'keeps missing durable outcomes pending and never mutates during recovery'],
  ['plan_identity', 'requires exact source, retained runtime, generation bytes and frozen baseline'],
]) {
  test('China release host ' + description, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, hostFile, name], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.deepEqual(JSON.parse(result.stdout), {case: name, passed: true});
  });
}
