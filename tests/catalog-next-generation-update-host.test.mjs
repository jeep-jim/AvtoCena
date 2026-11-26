import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const hostFile = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
// Run real host transitions and durable proof readers. Docker, socket probes,
// health and nginx are replaced at their I/O boundary; no SSH or network runs.
const harness = String.raw`
import base64, copy, gzip, importlib.util, io, json, os, pathlib, random, stat, sys, tempfile, types
spec = importlib.util.spec_from_file_location('china_daily_host', sys.argv[1])
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

def digest(value):
    return m.sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode())

runtime, pricing, image, build = 'c' * 40, 'a' * 40, 'sha256:' + '7' * 64, '6' * 64
encyclopedia_sha = '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c'
baseline_sha = '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'
oldest_id, retained_id, candidate_id, legacy_id, sibling_id = [digit * 64 for digit in '123ed']
operations, containers = [], {}
m.subprocess.run = forbidden

with tempfile.TemporaryDirectory(prefix='china-data-host-') as directory:
    root = pathlib.Path(directory)
    root.chmod(0o700)
    m.BASE = root / 'releases'; m.BASE.mkdir(mode=0o700)
    m.CONFIG = root / 'nginx.conf'
    original = b'server {\n location / {\n  proxy_pass http://127.0.0.1:3005;\n }\n}\n'
    m.CONFIG.write_bytes(original); m.CONFIG.chmod(0o600)
    enc = root / 'encyclopedia.json'; enc.write_bytes(b'private fixture encyclopedia'); enc.chmod(0o400)
    other = root / 'shared.json'; other.write_bytes(b'private unchanged settings'); other.chmod(0o400)
    def regular(filename, maximum=None):
        metadata = filename.lstat()
        assert filename.resolve().is_relative_to(root)
        m.need(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and not filename.is_symlink(), 'regular_file')
        if maximum is not None: assert metadata.st_size <= maximum
        return metadata
    def private_directory(value):
        assert value.resolve().is_relative_to(root) and value.is_dir()
        assert not value.stat().st_mode & 0o022
    m.regular, m.private_directory = regular, private_directory
    actual_file_sha = m.file_sha
    m.file_sha = lambda filename: encyclopedia_sha if filename == enc else actual_file_sha(filename)

    def reference(plan, generation, proof=None):
        value = {'market': 'china', 'generationId': plan['generationId'],
            'owner': {'runId': plan['generationId'].split('_')[2], 'attempt': '1', 'revision': plan['controllerSha']},
            'runtimeSha': runtime, 'pricingRuntimeSha': pricing, 'imageId': image,
            'generationManifestSha256': plan['generationManifestSha256'],
            'receiptSha256': plan['privateGenerationReceiptSha256'],
            'sourceDescriptorSha256': plan['sourceDescriptorSha256'],
            'sourceCursor': generation['source']['cursor'], 'sourceObservedAt': generation['source']['sourceObservedAt']}
        if proof is not None: value['proof'] = proof
        return value

    def generation(number, cursor):
        return {'version': 1, 'kind': 'china-local-generation-v1', 'market': 'china',
            'generationId': 'gen_china_' + str(number) + '_1', 'runtimeSha': pricing,
            'prepared': True, 'calculationVersion': build,
            'source': {'supplierLatestVerified': True, 'cursor': cursor,
                'sourceObservedAt': '2026-11-' + str(cursor + 2) + 'T00:00:00Z'}}

    def make_plan(number, nonce, gen, previous=None):
        daily = previous is not None
        value = {'version': 1, 'market': 'china', 'retainedRuntime': runtime if daily else m.RETAINED,
            'runtimeSha': runtime, 'pricingRuntimeSha': pricing, 'runtimeTree': 'd' * 40, 'controllerSha': 'e' * 40,
            'runtimeDiffSha256': 'a' * 64, 'servingCalculationVersion': m.CALCULATION,
            'nonce': nonce, 'imageId': image, 'generationId': gen['generationId'],
            'generationManifestSha256': m.sha(m.json_bytes(gen)),
            'privateGenerationReceiptSha256': str(number % 10) * 64, 'sourceDescriptorSha256': '9' * 64}
        if daily:
            value.update(mode='generation-update', previousAcceptedState=copy.deepcopy(previous),
                previousAcceptedETag='"accepted-' + str(previous['revision']) + '"', previousAcceptedStateSha256=digest(previous))
        names = m.expected_files(value)
        value['files'] = [{'name': name, 'bytes': 1,
            'sha256': baseline_sha if name == 'accepted-speed-baseline.json' else value['generationManifestSha256'],
            'compressedBytes': 1, 'compressedSha256': 'b' * 64} for name in sorted(names)]
        m.validate_plan(value)
        return value

    def private_cut(plan, gen):
        directory = m.BASE / runtime / 'china-next' / plan['nonce']
        directory.mkdir(mode=0o700, parents=True)
        for parent in (directory.parent.parent, directory.parent): parent.chmod(0o700)
        (directory / 'generation').mkdir(mode=0o700)
        (directory / 'PLAN.json').write_bytes(m.json_bytes(plan))
        (directory / 'generation' / 'GENERATION.json').write_bytes(m.json_bytes(gen))
        return directory

    def reports(plan):
        speed = m.json_bytes({'release': runtime, 'passed': True, 'browserPassed': True, 'speedGuard': {'passed': True}})
        details = m.json_bytes({'kind': 'china-browser-details-v1', 'release': runtime, 'nonce': plan['nonce'],
            'passed': True, 'generationManifestSha256': plan['generationManifestSha256'],
            'precedingSpeedReportSha256': m.sha(speed)})
        verdict = {'release': runtime, 'nonce': plan['nonce'], 'passed': True,
            'functionalPassed': True, 'speedPassed': True, 'reportSha256': m.sha(speed + details),
            'speedReportSha256': m.sha(speed), 'detailsReportSha256': m.sha(details)}
        return speed, details, verdict

    def accepted_cut(plan, gen, container_id):
        directory = private_cut(plan, gen)
        speed, details, verdict = reports(plan)
        receipt = {'version': 1, 'kind': 'china-host-acceptance-v1', 'release': runtime,
            'pricingRuntimeSha': pricing, 'imageId': image, 'generationId': gen['generationId'],
            'generationManifestSha256': plan['generationManifestSha256'],
            'privateGenerationReceiptSha256': plan['privateGenerationReceiptSha256'],
            'sourceDescriptorSha256': plan['sourceDescriptorSha256'],
            'sourceCursor': gen['source']['cursor'], 'sourceObservedAt': gen['source']['sourceObservedAt'],
            'nonce': plan['nonce'], 'acceptedAt': '2026-11-24T00:00:00Z', 'retainedContainerId': container_id,
            'browser': verdict}
        raw = m.json_bytes(receipt)
        for name, body in [('ACCEPTED.json', raw), ('BROWSER_SPEED.json', speed), ('BROWSER_DETAILS.json', details)]:
            (directory / name).write_bytes(body)
        proof = {'kind': 'china-accepted-proof-v1', 'hostReceiptBase64': base64.b64encode(raw).decode(), 'hostReceiptSha256': m.sha(raw)}
        return reference(plan, gen, proof), receipt, directory

    def state(current, receipt, previous=None):
        return {'version': 1, 'kind': 'china-accepted-state-v1', 'market': 'china',
            'revision': previous['revision'] + 2 if previous else 2,
            'current': current, 'rollback': previous['current'] if previous else None, 'pending': None,
            'commit': {'nonce': receipt['nonce'], 'intentSha256': '5' * 64,
                'previousETag': '"accepted-' + str(previous['revision']) + '"' if previous else None,
                'previousStateSha256': digest(previous) if previous else None, 'acceptedAt': receipt['acceptedAt']}}

    oldest_gen = generation(120, 20)
    oldest_plan = make_plan(120, '1' * 32, oldest_gen)
    oldest_ref, oldest_receipt, oldest_dir = accepted_cut(oldest_plan, oldest_gen, legacy_id)
    oldest_state = state(oldest_ref, oldest_receipt)
    retained_gen = generation(121, 21)
    retained_plan = make_plan(121, '2' * 32, retained_gen, oldest_state)
    retained_ref, retained_receipt, retained_dir = accepted_cut(retained_plan, retained_gen, oldest_id)
    previous = state(retained_ref, retained_receipt, oldest_state)
    new_gen = generation(122, 22)
    plan = make_plan(122, 'f' * 32, new_gen, previous)

    def container(identity, port, directory=None, plan=None):
        native = plan is not None
        values = ['PRIVATE=do-not-print', 'AVTOCENA_RELEASE_SHA=' + (runtime if native else m.RETAINED),
            'AVTOCENA_CALCULATION_VERSION=' + m.CALCULATION, 'UNRELATED=preserved']
        binds = [str(other) + ':/app/data/shared.json:ro',
            str(enc) + ':/app/data/knowledge/encyclopedia/calculation-v1.json:ro']
        labels = {'avtocena.application': 'web', 'avtocena.role': 'independent-china' if native else 'retained-foreign'}
        if native:
            values += ['CATALOG_CHINA_LOCAL_RUNTIME_SHA=' + pricing, 'AVTOCENA_BUILD_CALCULATION_VERSION=' + build,
                'CATALOG_CHINA_LOCAL_GENERATION_DIR=' + m.GENERATION_MOUNT,
                'CATALOG_CHINA_LOCAL_MANIFEST_SHA256=' + plan['generationManifestSha256']]
            binds.append(str(directory / 'generation') + ':' + m.GENERATION_MOUNT + ':ro')
            labels['avtocena.china.nonce'] = plan['nonce']
        mounts = [{'Type': 'bind', 'Source': binding.split(':')[0], 'Destination': binding.split(':')[1], 'RW': False} for binding in binds]
        return {'Id': identity, 'Image': image if native else 'sha256:' + 'e' * 64,
            'Config': {'Env': values, 'WorkingDir': '/app', 'User': '', 'Labels': labels,
                'Cmd': ['node', 'server.js'], 'Entrypoint': ['docker-entrypoint.sh']},
            'HostConfig': {'Privileged': False, 'Binds': binds, 'NetworkMode': 'bridge',
                'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(port)}]},
                'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}},
            'Mounts': mounts, 'State': {'Running': True, 'Pid': port, 'StartedAt': '2026-11-24T00:00:00Z'}, 'RestartCount': 0}

    containers[oldest_id] = container(oldest_id, 3004, oldest_dir, oldest_plan)
    containers[retained_id] = container(retained_id, 3005, retained_dir, retained_plan)
    containers[legacy_id] = container(legacy_id, 3000)
    containers[sibling_id] = container(sibling_id, 3010)
    protected_before = {identity: copy.deepcopy(containers[identity]) for identity in (retained_id, legacy_id, sibling_id)}
    all_before = copy.deepcopy(containers)
    file_before = {str(p): m.sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}

    def docker(method, target, body=None):
        operations.append(('docker', method, target))
        if method == 'GET' and target == '/containers/json?all=1': return [{'Id': identity} for identity in containers]
        if method == 'GET' and target == '/images/' + image + '/json':
            return {'Id': image, 'Os': 'linux', 'Architecture': 'amd64',
                'Config': {'Labels': {'org.opencontainers.image.revision': runtime}}}
        if method == 'GET' and target.startswith('/containers/') and target.endswith('/json'):
            return copy.deepcopy(containers[target.split('/')[2]])
        if method == 'POST' and target.startswith('/containers/create?'):
            assert candidate_id not in containers
            row = {'Id': candidate_id, 'Image': body['Image'],
                'Config': {key: copy.deepcopy(body[key]) for key in ('Env', 'WorkingDir', 'Entrypoint', 'Cmd', 'Labels')},
                'HostConfig': copy.deepcopy(body['HostConfig']), 'State': {'Running': False, 'Status': 'created', 'ExitCode': 0, 'OOMKilled': False, 'Pid': 0, 'StartedAt': ''}, 'RestartCount': 0,
                'Mounts': [{'Type': 'bind', 'Source': binding.split(':')[0], 'Destination': binding.split(':')[1], 'RW': False}
                    for binding in body['HostConfig']['Binds']]}
            containers[candidate_id] = row
            return {'Id': candidate_id}
        identity = target.split('/')[2].split('?')[0]
        assert identity in (candidate_id, oldest_id), 'must never mutate a protected process'
        if method == 'POST' and target.endswith('/start'):
            assert identity == candidate_id
            containers[identity]['State'].update(Running=True, Status='running', Pid=3006, StartedAt='2026-11-24T01:00:00Z')
        elif method == 'POST' and target.endswith('/update'):
            assert identity == candidate_id
            containers[identity]['HostConfig']['RestartPolicy'] = copy.deepcopy(body['RestartPolicy'])
        elif method == 'POST' and '/stop?' in target:
            containers[identity]['State'].update(Running=False, Pid=0)
        elif method == 'DELETE':
            assert target.endswith('?v=false&force=false')
            assert not containers[identity]['State']['Running']
            del containers[identity]
        else: raise AssertionError('unexpected Docker operation: ' + target)
        return None
    m.docker = docker
    def health(port, release):
        matching = [row for row in containers.values() if any(binding['HostPort'] == str(port)
            for values in row['HostConfig']['PortBindings'].values() for binding in values)]
        assert len(matching) == 1
        row = matching[0]
        m.need(row['State']['Running'] and m.env_map(row)['AVTOCENA_RELEASE_SHA'] == release and
            m.env_map(row)['AVTOCENA_CALCULATION_VERSION'] == m.CALCULATION, 'health_identity')
        operations.append(('health', port, release))
    m.health = health
    def command(args, timeout=120):
        assert args in (['/usr/sbin/nginx', '-t'], ['/usr/bin/systemctl', 'reload', 'nginx'])
        operations.append(('command', args))
        return b''
    m.command = command
    class Probe:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def bind(self, address):
            assert address == ('127.0.0.1', 3006)
            operations.append(('probe', address))
    m.socket.socket = lambda *args: Probe()
    # Production opens a pre-existing, root-owned flock file. Keep actual flock
    # semantics but substitute only that descriptor's path/owner for nonroot CI.
    lock_path = root / 'runtime.lock'; lock_path.write_bytes(b'')
    real_open, real_fstat = m.os.open, m.os.fstat
    lock_fds = set()
    def safe_open(filename, flags, mode=0o777, **kwargs):
        if str(filename) == '/run/lock/avtocena-runtime-change.lock':
            fd = real_open(lock_path, flags, mode, **kwargs); lock_fds.add(fd); return fd
        return real_open(filename, flags, mode, **kwargs)
    def safe_fstat(fd):
        info = real_fstat(fd)
        return types.SimpleNamespace(st_mode=info.st_mode, st_uid=0, st_nlink=info.st_nlink) if fd in lock_fds else info
    m.os.open, m.os.fstat = safe_open, safe_fstat

    # Skip only OS ownership checks in __init__: actual plan validation,
    # upload verification, start and every publication transition run unchanged.
    host = m.Host.__new__(m.Host)
    host.plan = plan; host.directory = private_cut(plan, new_gen); host.generation = host.directory / 'generation'
    host.uploaded = m.expected_files(plan)
    host.candidate = host.retained = host.lock = host.original = host.proposed = host.verdict_deadline = None
    host.switched = host.accepted = host.functional_passed = host.speed_passed = False
    host.restart = 'no'
    def oracle():
        cases = [{'path': '/api/catalog/search?market=china&marketPage=true&page=' + str(i + 1),
            'name': 'case-' + str(i), 'total': 276221, 'ids': ['test-' + str(i)], 'totalRub': [1500000 + i]} for i in range(8)]
        (host.directory / 'acceptance.json').write_bytes(m.json_bytes({'version': 1, 'runtimeSha': runtime,
            'generationManifestSha256': plan['generationManifestSha256'], 'cases': cases}))
        by_path = {row['path']: {'ok': True, 'total': row['total'],
            'items': [{'id': row['ids'][0], 'totalRub': row['totalRub'][0]}]} for row in cases}
        m.response_json = lambda port, route: copy.deepcopy(by_path[route])
    def checked():
        oracle(); assert host.functional()['functionalPassed']
        def speed_process(args, **kwargs):
            assert args == ['/usr/bin/python3', '-I', '-B', str(host.directory / 'regcloud-performance-gate.py'),
                'http://127.0.0.1:3006', runtime]
            assert kwargs['timeout'] == 1500 and kwargs['env'] == {'PATH': '/usr/bin:/bin',
                'AVTOCENA_RELEASE_MARKETS': 'china', 'AVTOCENA_SPEED_BASELINE_MODE': 'enforce',
                'AVTOCENA_SPEED_BASELINE': str(host.directory / 'accepted-speed-baseline.json')}
            operations.append(('speed', 'frozen-baseline'))
            return types.SimpleNamespace(returncode=0, stdout=b'{"passed":true}\n')
        m.subprocess.run = speed_process
        assert host.speed()['speedPassed']
    def accepted():
        checked(); host.switch()
        speed, details, verdict = reports(plan)
        host.browser_evidence({'speedBase64': base64.b64encode(speed).decode(), 'detailsBase64': base64.b64encode(details).decode()})
        result = host.accept(verdict)
        receipt = json.loads(base64.b64decode(result['hostReceiptBase64']))
        proof = {key: result[key] for key in ('hostReceiptBase64', 'hostReceiptSha256')}
        proof['kind'] = 'china-accepted-proof-v1'
        committed = state(reference(plan, new_gen, proof), receipt, previous)
        publication = finalized_view(committed, observation(previous))
        committed = publication['accepted']['value']
        return {'acceptedState': committed, 'acceptedETag': '"accepted-' + str(committed['revision']) + '"',
            'acceptedStateSha256': digest(committed), 'acceptedPublication': publication}
    def observation(value):
        return {'found': True, 'etag': '"accepted-' + str(value['revision']) + '"', 'sha256': digest(value), 'value': copy.deepcopy(value)}
    def finalized_view(value, prior):
        value = copy.deepcopy(value)
        candidate = {key: item for key, item in value['current'].items() if key != 'proof'}
        intent = {'version': 1, 'kind': 'china-publication-intent-v1', 'market': 'china', 'revision': 1,
            'nonce': value['commit']['nonce'], 'owner': candidate['owner'], 'createdAt': '2026-11-24T00:00:00Z',
            'candidate': candidate, 'previous': copy.deepcopy(prior), 'status': 'pending', 'resolution': None}
        value['commit']['intentSha256'] = digest(intent)
        accepted_observation = observation(value)
        intent['status'] = 'committed'
        intent['resolution'] = {'kind': 'accepted', 'at': value['commit']['acceptedAt'],
            'acceptedETag': accepted_observation['etag'], 'acceptedSha256': accepted_observation['sha256'],
            'hostReceiptSha256': candidate_proof_sha(value)}
        return {'accepted': accepted_observation,
            'intent': {'found': True, 'etag': '"intent-' + str(value['revision']) + '"', 'sha256': digest(intent), 'value': intent}}
    def candidate_proof_sha(value): return value['current']['proof']['hostReceiptSha256']
    def recovery_params(committed):
        os.close(host.lock); host.lock = None
        return {'previousAccepted': observation(previous), 'acceptedPublication': committed['acceptedPublication'],
            'currentState': copy.deepcopy(committed['acceptedPublication'])}
    def create_bulk():
        payloads = {}
        for descriptor in oldest_plan['files']:
            if descriptor['name'] not in m.HOST_BULK_FILES: continue
            filename = (oldest_dir if descriptor['name'] == 'image.tar' else oldest_dir / 'generation') / descriptor['name']
            raw = ('private bulk fixture for ' + descriptor['name'] + '\n').encode() * 13
            filename.write_bytes(raw); filename.chmod(0o400)
            descriptor['bytes'], descriptor['sha256'] = len(raw), m.sha(raw)
            payloads[filename] = raw
        (oldest_dir / 'PLAN.json').write_bytes(m.json_bytes(oldest_plan))
        return payloads
    def assert_protected():
        assert all(containers[identity] == before for identity, before in protected_before.items())
    case = sys.argv[2]
    try:
        if case == 'plan':
            assert 'image.tar' not in m.expected_files(plan)
            bad = copy.deepcopy(plan); bad['files'].append(copy.deepcopy(oldest_plan['files'][0])); bad['files'][-1]['name'] = 'image.tar'
            refused(lambda: m.validate_plan(bad), 'plan_files')
            for field, value in [('imageId', 'sha256:' + '8' * 64), ('runtimeSha', 'd' * 40), ('pricingRuntimeSha', 'e' * 40)]:
                bad = copy.deepcopy(plan); bad[field] = value
                refused(lambda: m.validate_plan(bad), 'data_only_identity')
            bad = copy.deepcopy(plan); bad['previousAcceptedState']['pending'] = {'nonce': '9' * 32}
            refused(lambda: m.validate_plan(bad), 'predecessor_state')
            bad = copy.deepcopy(plan); bad['previousAcceptedState']['revision'] += 1
            refused(lambda: m.validate_plan(bad), 'predecessor_state_hash')
            bad = copy.deepcopy(plan); bad['previousAcceptedState']['current']['proof']['hostReceiptBase64'] = base64.b64encode(b'{}').decode()
            bad['previousAcceptedStateSha256'] = digest(bad['previousAcceptedState'])
            refused(lambda: m.validate_plan(bad), 'predecessor_proof_hash')
            refused(lambda: host.upload('image.tar', io.BytesIO(b'')), 'upload_scope')
            assert not operations
        elif case.startswith('disk_'):
            reserve = 2 * 1024 ** 3
            assert m.RELEASE_DISK_OPERATING_RESERVE == reserve
            if case in ('disk_init_refusal', 'disk_init_compressed_peak', 'disk_init_success'):
                proposed = copy.deepcopy(plan); proposed['nonce'] = '8' * 32
                proposed_directory = m.BASE / runtime / 'china-next' / proposed['nonce']
                if case == 'disk_init_refusal':
                    # Remaining capacity after copying a current-sized code
                    # generation is insufficient for the next same-sized cut.
                    proposed['files'][0]['bytes'] = 12_783_566_731
                    proposed['files'][0]['compressedBytes'] = 1_000_000_000
                    available = 25_885_343_744 - 12_783_566_731
                else:
                    proposed['files'][0].update(bytes=2000000, compressedBytes=1500000)
                    available = sum(row['bytes'] for row in proposed['files']) + reserve
                    if case == 'disk_init_success':
                        available += max(row['compressedBytes'] for row in proposed['files'])
                m.os.statvfs = lambda p: types.SimpleNamespace(f_bavail=available, f_frsize=1)
                before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                if case != 'disk_init_success':
                    refused(lambda: m.Host(proposed), 'generation_disk_space')
                    assert not proposed_directory.exists()
                    assert before == {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                else:
                    # As elsewhere in this fixture, substitute ownership only;
                    # actual constructor, directories and writes are exercised.
                    original_stat = pathlib.Path.stat
                    def root_owned(filename, *args, **kwargs):
                        value = original_stat(filename, *args, **kwargs)
                        return types.SimpleNamespace(**{key: (0 if key == 'st_uid' else getattr(value, key))
                            for key in dir(value) if key.startswith('st_')})
                    pathlib.Path.stat = root_owned
                    try: initialized = m.Host(proposed)
                    finally: pathlib.Path.stat = original_stat
                    assert initialized.generation_disk_admission['requiredBytes'] == available
                    assert initialized.generation_disk_admission['availableDiskBytes'] == available
                    assert json.loads((proposed_directory / 'PLAN.json').read_bytes()) == proposed
                    assert (proposed_directory / 'generation').is_dir()
                    assert all(pathlib.Path(filename).read_bytes() == raw for filename, raw in before.items())
            elif case == 'disk_before_start':
                m.os.statvfs = lambda p: types.SimpleNamespace(f_bavail=reserve - 1, f_frsize=1)
                refused(host.start, 'generation_disk_space')
                assert host.lock is None and candidate_id not in containers and not operations
            else:
                name = 'details.sqlite'; host.uploaded = set(); host.candidate = None
                raw = random.Random(123).randbytes(3 * 1024 * 1024 + 17)
                packed = gzip.compress(raw, compresslevel=1)
                descriptor = next(row for row in plan['files'] if row['name'] == name)
                descriptor.update(bytes=len(raw), sha256=m.sha(raw), compressedBytes=len(packed), compressedSha256=m.sha(packed))
                destination = host.generation / name
                incoming = host.directory / (name + '.incoming.gz')
                free_bytes = [reserve + len(packed) + len(raw) + 1024 * 1024]
                calls = [0]
                class Source(io.BytesIO):
                    def read(self, amount=-1):
                        value = super().read(amount); calls[0] += 1
                        if case == 'disk_compressed_pressure' and calls[0] == 2:
                            free_bytes[0] = reserve + len(value) - 1
                        if case == 'disk_before_decode' and self.tell() == len(packed):
                            free_bytes[0] = reserve + len(raw) - 1
                        return value
                def capacity(p):
                    available = free_bytes[0]
                    if case == 'disk_decode_pressure' and destination.exists() and destination.stat().st_size >= 1024 * 1024:
                        available = reserve + 1024 * 1024 - 1
                    return types.SimpleNamespace(f_bavail=available, f_frsize=1)
                m.os.statvfs = capacity
                if case == 'disk_upload_refusal':
                    free_bytes[0] = reserve + len(raw) + len(packed) - 1
                if case == 'disk_upload_success':
                    result = host.upload(name, Source(packed))
                    assert result == {'file': name, 'bytes': len(raw), 'verified': True}
                    assert destination.read_bytes() == raw and not incoming.exists() and host.uploaded == {name}
                else:
                    refused(lambda: host.upload(name, Source(packed)), 'generation_disk_space')
                    assert name not in host.uploaded and host.candidate is None
                    if case == 'disk_upload_refusal':
                        assert not incoming.exists() and not destination.exists() and calls[0] == 0
                    elif case == 'disk_compressed_pressure':
                        assert incoming.stat().st_size == 1024 * 1024 and not destination.exists()
                    elif case == 'disk_before_decode':
                        assert incoming.read_bytes() == packed and not destination.exists()
                    elif case == 'disk_decode_pressure':
                        assert incoming.read_bytes() == packed and destination.stat().st_size == 1024 * 1024
                    else: raise AssertionError('unknown disk case')
                assert not operations and m.CONFIG.read_bytes() == original
            assert_protected()
            assert all(pathlib.Path(filename).read_bytes() and m.sha(pathlib.Path(filename).read_bytes()) == value
                       for filename, value in file_before.items())
        elif case == 'start':
            result = host.start()
            assert result['started'] and result['generationId'] == new_gen['generationId'] and host.port == 3006
            old_env = containers[retained_id]['Config']['Env']
            assert host.spec['Env'] == [item if not item.startswith('CATALOG_CHINA_LOCAL_MANIFEST_SHA256=') else
                'CATALOG_CHINA_LOCAL_MANIFEST_SHA256=' + plan['generationManifestSha256'] for item in old_env]
            old_binds = containers[retained_id]['HostConfig']['Binds']
            assert host.spec['HostConfig']['Binds'] == old_binds[:2] + [str(host.generation) + ':' + m.GENERATION_MOUNT + ':ro']
            assert host.spec['Image'] == image
            assert not any(item[0] == 'command' or (item[0] == 'docker' and item[2] == '/info') for item in operations)
            assert_protected(); assert containers[oldest_id] == all_before[oldest_id]
            host.cleanup(); assert m.CONFIG.read_bytes() == original and candidate_id not in containers
        elif case == 'first_daily':
            # The first data-only update follows the first-release receipt,
            # whose retained runtime was legacy56 and whose rollback is null.
            previous['revision'] = 2; previous['rollback'] = None
            previous['commit']['previousETag'] = previous['commit']['previousStateSha256'] = None
            plan.update(previousAcceptedState=copy.deepcopy(previous), previousAcceptedETag='"accepted-2"',
                previousAcceptedStateSha256=digest(previous))
            (host.directory / 'PLAN.json').write_bytes(m.json_bytes(plan))
            initial_plan = make_plan(121, retained_plan['nonce'], retained_gen)
            (retained_dir / 'PLAN.json').write_bytes(m.json_bytes(initial_plan))
            host.start(); committed = accepted()
            assert host.retire(committed) == {'retiredContainers': 0, 'directoriesDeleted': 0, 'imagesDeleted': 0,
                'filesDeleted': 0, 'freedBytes': 0, 'reason': 'no_previous_rollback'}
            assert_protected(); assert containers[oldest_id] == all_before[oldest_id]
            assert m.read_outcome({'runtimeSha': runtime, 'nonce': plan['nonce']})['status'] == 'accepted'
        elif case.startswith('bad_predecessor_'):
            fault = case.removeprefix('bad_predecessor_')
            if fault == 'mount': containers[retained_id]['Mounts'][-1]['RW'] = True
            elif fault == 'manifest': (retained_dir / 'generation' / 'GENERATION.json').write_bytes(b'{}')
            elif fault == 'receipt': (retained_dir / 'ACCEPTED.json').write_bytes(b'{}')
            elif fault == 'environment': containers[retained_id]['Config']['Env'][-1] = 'CATALOG_CHINA_LOCAL_MANIFEST_SHA256=' + '0' * 64
            code = {'mount': 'serving_mounts', 'manifest': 'mounted_generation_hash', 'receipt': 'recovery_receipt',
                'environment': 'mounted_reference'}[fault]
            refused(host.start, code)
            assert candidate_id not in containers and m.CONFIG.read_bytes() == original
            assert not any(item[:2] in [('docker', 'POST'), ('docker', 'DELETE')] for item in operations)
        elif case == 'gates_and_rollback':
            host.start(); refused(host.switch, 'switch_before_checks')
            checked(); host.switch()
            assert m.backend(m.CONFIG.read_bytes()) == 3006
            host.cleanup()
            assert_protected(); assert m.CONFIG.read_bytes() == original and candidate_id not in containers
            recovered = m.read_outcome({'runtimeSha': runtime, 'nonce': plan['nonce']})
            assert recovered['status'] == 'rolled_back'
            receipt = json.loads(base64.b64decode(recovered['hostRollbackBase64']))
            assert receipt['retainedRuntimeSha'] == runtime and receipt['retainedRuntimeSha'] != m.RETAINED
            assert receipt['previousAcceptedETag'] == plan['previousAcceptedETag']
            assert receipt['previousAcceptedStateSha256'] == plan['previousAcceptedStateSha256']
            m.CONFIG.write_bytes(original.replace(b':3005;', b':3004;'))
            refused(lambda: m.read_outcome({'runtimeSha': runtime, 'nonce': plan['nonce']}), 'mounted_reference')
        elif case == 'accepted_recovery':
            host.start(); accepted()
            recovered = m.read_outcome({'runtimeSha': runtime, 'nonce': plan['nonce']})
            assert recovered['status'] == 'accepted'; assert_protected()
            saved = m.CONFIG.read_bytes(); m.CONFIG.write_bytes(original)
            refused(lambda: m.read_outcome({'runtimeSha': runtime, 'nonce': plan['nonce']}), 'mounted_reference')
            m.CONFIG.write_bytes(saved)
            containers[candidate_id]['Mounts'][-1]['Source'] = str(retained_dir / 'generation')
            refused(lambda: m.read_outcome({'runtimeSha': runtime, 'nonce': plan['nonce']}), 'mounted_generation')
        elif case == 'retire':
            host.start(); committed = accepted()
            result = host.retire(committed)
            assert result == {'retiredContainers': 1, 'directoriesDeleted': 0, 'imagesDeleted': 0,
                'filesDeleted': 0, 'freedBytes': 0, 'generationId': oldest_ref['generationId']}
            assert oldest_id not in containers and containers[candidate_id]['State']['Running']
            assert m.backend(m.CONFIG.read_bytes()) == 3006; assert_protected()
            assert host.retire(committed) == {'retiredContainers': 0, 'directoriesDeleted': 0, 'imagesDeleted': 0,
                'filesDeleted': 0, 'freedBytes': 0, 'reason': 'already_absent'}
            for filename, expected in file_before.items():
                if pathlib.Path(filename) != m.CONFIG: assert m.sha(pathlib.Path(filename).read_bytes()) == expected
            assert not any(item[0] == 'docker' and item[1] != 'GET' and '/images/' in item[2] for item in operations)
        elif case in ('retire_mount_order', 'retire_recovery_mount_order', 'retire_mount_changed_after_stop'):
            host.start(); committed = accepted(); payloads = create_bulk()
            params = recovery_params(committed) if case == 'retire_recovery_mount_order' else None
            actual_docker = m.docker
            def changed_inspection(method, target, body=None):
                result = actual_docker(method, target, body)
                if method == 'GET' and target == '/containers/' + oldest_id + '/json' and not result['State']['Running']:
                    if case == 'retire_mount_changed_after_stop':
                        result['Mounts'][0]['Propagation'] = 'unexpected-new-value'
                    else:
                        result['Mounts'].reverse()
                return result
            m.docker = changed_inspection
            perform = lambda: m.retire_recovery(params) if params else host.retire(committed)
            if case == 'retire_mount_changed_after_stop':
                refused(perform, 'retire_target_changed')
                assert oldest_id in containers and not containers[oldest_id]['State']['Running']
                assert all(filename.read_bytes() == raw for filename, raw in payloads.items())
                assert not any(item[0] == 'docker' and item[1] == 'DELETE' for item in operations)
            else:
                result = perform()
                assert result['retiredContainers'] == 1 and result['filesDeleted'] == len(payloads)
                assert result['freedBytes'] == sum(len(raw) for raw in payloads.values())
                assert oldest_id not in containers and all(not filename.exists() for filename in payloads)
                assert result['directoriesDeleted'] == result['imagesDeleted'] == 0
            assert_protected(); assert m.backend(m.CONFIG.read_bytes()) == 3006
        elif case == 'retire_rejects_uncommitted':
            host.start(); refused(lambda: host.retire({}), 'retire_before_acceptance')
            committed = accepted()
            for field, value, code in [('pending', {'nonce': '9' * 32}, 'retire_state'),
                ('rollback', oldest_ref, 'retire_commit'), ('revision', previous['revision'] + 1, 'retire_state')]:
                bad = copy.deepcopy(committed); bad['acceptedState'][field] = value
                bad['acceptedStateSha256'] = digest(bad['acceptedState'])
                refused(lambda: host.retire(bad), code)
            bad = copy.deepcopy(committed); bad['acceptedStateSha256'] = '0' * 64
            refused(lambda: host.retire(bad), 'retire_state_hash')
            assert containers[oldest_id] == all_before[oldest_id]; assert_protected()
        elif case == 'retire_rejects_foreign':
            host.start(); committed = accepted()
            containers[oldest_id]['Mounts'][-1]['Source'] = str(retained_dir / 'generation')
            refused(lambda: host.retire(committed), 'mounted_generation')
            assert containers[oldest_id]['State']['Running']; assert_protected()
            containers[oldest_id]['Mounts'] = copy.deepcopy(all_before[oldest_id]['Mounts'])
            containers[oldest_id]['Config']['Labels']['avtocena.role'] = 'other-market'
            refused(lambda: host.retire(committed), 'retire_foreign')
            assert containers[oldest_id]['State']['Running']; assert_protected()
            containers[oldest_id]['Config']['Labels'] = copy.deepcopy(all_before[oldest_id]['Config']['Labels'])
            m.CONFIG.write_bytes(original)
            refused(lambda: host.retire(committed), 'ingress_changed')
            assert containers[oldest_id] == all_before[oldest_id]
        elif case == 'retire_recovery':
            host.start(); committed = accepted(); params = recovery_params(committed)
            directories = sorted(str(value) for value in root.rglob('*') if value.is_dir())
            created_before = sum(item[0] == 'docker' and item[2].startswith('/containers/create?') for item in operations)
            result = m.retire_recovery(params)
            assert result['retiredContainers'] == 1 and result['directoriesDeleted'] == result['imagesDeleted'] == 0
            assert oldest_id not in containers; assert_protected()
            assert m.retire_recovery(params)['reason'] == 'already_absent'
            assert sorted(str(value) for value in root.rglob('*') if value.is_dir()) == directories
            assert created_before == sum(item[0] == 'docker' and item[2].startswith('/containers/create?') for item in operations)
            assert m.backend(m.CONFIG.read_bytes()) == 3006
        elif case == 'retire_recovery_interrupted':
            host.start(); committed = accepted(); params = recovery_params(committed)
            actual_docker = m.docker
            def interrupted_delete(method, target, body=None):
                if method == 'DELETE' and target.startswith('/containers/' + oldest_id):
                    raise m.ReleaseError('china_host_delete_connection_lost')
                return actual_docker(method, target, body)
            m.docker = interrupted_delete
            refused(lambda: m.retire_recovery(params), 'delete_connection_lost')
            assert oldest_id in containers and containers[oldest_id]['State']['Running'] is False
            assert_protected(); assert m.backend(m.CONFIG.read_bytes()) == 3006
            m.docker = actual_docker
            result = m.retire_recovery(params)
            assert result['retiredContainers'] == 1 and oldest_id not in containers; assert_protected()
        elif case == 'retire_recovery_future':
            host.start(); committed = accepted(); params = recovery_params(committed)
            # Another daily generation is now current. The durable task still
            # targets only its original previous.rollback, never newer rows.
            later_gen = generation(123, 22)
            original_state = committed['acceptedPublication']['accepted']['value']
            later_plan = make_plan(123, '4' * 32, later_gen, original_state)
            later_ref, later_receipt, later_dir = accepted_cut(later_plan, later_gen, candidate_id)
            later_state = state(later_ref, later_receipt, original_state)
            params['currentState'] = finalized_view(later_state, committed['acceptedPublication']['accepted'])
            containers['4' * 64] = container('4' * 64, 3007, later_dir, later_plan)
            before_latest, before_rollback = copy.deepcopy(containers['4' * 64]), copy.deepcopy(containers[candidate_id])
            m.CONFIG.write_bytes(original.replace(b':3005;', b':3007;'))
            result = m.retire_recovery(params)
            assert result['retiredContainers'] == 1 and oldest_id not in containers
            assert containers['4' * 64] == before_latest and containers[candidate_id] == before_rollback
            assert_protected(); assert m.backend(m.CONFIG.read_bytes()) == 3007
        elif case == 'retire_recovery_rejects':
            host.start(); committed = accepted(); params = recovery_params(committed)
            bad = copy.deepcopy(params); bad['previousAccepted']['sha256'] = '0' * 64
            refused(lambda: m.retire_recovery(bad), 'retire_observation')
            bad = copy.deepcopy(params); bad['acceptedPublication']['intent']['value']['status'] = 'pending'
            bad['acceptedPublication']['intent']['sha256'] = digest(bad['acceptedPublication']['intent']['value'])
            refused(lambda: m.retire_recovery(bad), 'retire_intent')
            bad = copy.deepcopy(params); bad['currentState']['accepted']['value']['pending'] = {'nonce': '9' * 32}
            bad['currentState']['accepted']['sha256'] = digest(bad['currentState']['accepted']['value'])
            refused(lambda: m.retire_recovery(bad), 'retire_state')
            bad = copy.deepcopy(params); bad['currentState']['intent']['value']['resolution']['acceptedETag'] = '"stranger"'
            bad['currentState']['intent']['sha256'] = digest(bad['currentState']['intent']['value'])
            refused(lambda: m.retire_recovery(bad), 'retire_intent_resolution')
            bad = copy.deepcopy(params); bad['previousAccepted']['value']['rollback'] = None
            bad['previousAccepted']['sha256'] = digest(bad['previousAccepted']['value'])
            forged = copy.deepcopy(bad['acceptedPublication']['accepted']['value'])
            forged['commit']['previousStateSha256'] = bad['previousAccepted']['sha256']
            bad['acceptedPublication'] = finalized_view(forged, bad['previousAccepted'])
            refused(lambda: m.retire_recovery(bad), 'retire_original_plan')
            bad = copy.deepcopy(params); changed = copy.deepcopy(previous)
            changed['revision'] = 99; changed['rollback'] = oldest_ref
            bad['currentState'] = {'accepted': observation(changed), 'intent': {'found': False, 'etag': None, 'sha256': None, 'value': None}}
            refused(lambda: m.retire_recovery(bad), 'retire_protected')
            containers[retained_id]['Mounts'][-1]['RW'] = True
            refused(lambda: m.retire_recovery(params), 'mounted_generation')
            containers[retained_id]['Mounts'] = copy.deepcopy(all_before[retained_id]['Mounts'])
            assert containers[oldest_id] == all_before[oldest_id]; assert_protected()
        elif case == 'bulk_cleanup':
            host.start(); committed = accepted(); payloads = create_bulk()
            preserved = {str(value): value.read_bytes() for value in oldest_dir.rglob('*') if value.is_file() and value not in payloads}
            extra = oldest_dir / 'unlisted-private.txt'; extra.write_bytes(b'not authorized by the plan')
            result = host.retire(committed)
            assert result['retiredContainers'] == 1 and result['filesDeleted'] == len(payloads)
            assert result['freedBytes'] == sum(len(raw) for raw in payloads.values())
            assert result['directoriesDeleted'] == result['imagesDeleted'] == 0
            assert all(not filename.exists() for filename in payloads)
            assert all(pathlib.Path(filename).read_bytes() == raw for filename, raw in preserved.items())
            assert extra.read_bytes() == b'not authorized by the plan'; assert_protected()
            # Historical proof reads remain valid after all bulk data is gone.
            assert m.read_outcome({'runtimeSha': runtime, 'nonce': oldest_plan['nonce']}, verify_current=False)['status'] == 'accepted'
            repeated = host.retire(committed)
            assert repeated['retiredContainers'] == repeated['filesDeleted'] == repeated['freedBytes'] == 0
        elif case == 'bulk_interrupted':
            host.start(); committed = accepted(); payloads = create_bulk()
            # Lose the response immediately after one real unlink. Retry uses
            # the durable task, not a second activation or another directory.
            lost = next(iter(payloads)); actual_unlink = pathlib.Path.unlink
            def interrupted_unlink(filename, *args, **kwargs):
                actual_unlink(filename, *args, **kwargs)
                if filename == lost: raise m.ReleaseError('china_host_after_unlink_disconnect')
            pathlib.Path.unlink = interrupted_unlink
            try: refused(lambda: host.retire(committed), 'after_unlink_disconnect')
            finally: pathlib.Path.unlink = actual_unlink
            assert not lost.exists() and oldest_id not in containers
            params = recovery_params(committed)
            result = m.retire_recovery(params)
            assert result['retiredContainers'] == 0 and result['filesDeleted'] == len(payloads) - 1
            assert result['freedBytes'] == sum(len(raw) for filename, raw in payloads.items() if filename != lost)
            assert all(not filename.exists() for filename in payloads); assert_protected()
            assert m.backend(m.CONFIG.read_bytes()) == 3006
        elif case == 'bulk_mounted':
            host.start(); committed = accepted(); payloads = create_bulk()
            alias = root / 'old-generation-alias'; alias.symlink_to(oldest_dir / 'generation', target_is_directory=True)
            containers[sibling_id]['Mounts'].append({'Type': 'bind', 'Source': str(alias), 'Destination': '/unrelated', 'RW': False})
            containers[sibling_id]['State']['Running'] = False
            before_sibling = copy.deepcopy(containers[sibling_id])
            refused(lambda: host.retire(committed), 'retire_files_mounted')
            assert containers[sibling_id] == before_sibling
            assert all(filename.read_bytes() == raw for filename, raw in payloads.items())
            containers[sibling_id] = copy.deepcopy(protected_before[sibling_id])
            result = m.retire_recovery(recovery_params(committed))
            assert result['retiredContainers'] == 0 and result['filesDeleted'] == len(payloads); assert_protected()
        elif case in ('bulk_changed', 'bulk_symlink'):
            host.start(); committed = accepted(); payloads = create_bulk()
            target = next(iter(payloads))
            if case == 'bulk_changed':
                target.chmod(0o600); target.write_bytes(b'wrong bytes')
                code = 'retire_file_hash'
            else:
                target.unlink(); target.symlink_to(enc)
                code = 'regular_file'
            refused(lambda: host.retire(committed), code)
            assert enc.read_bytes() == b'private fixture encyclopedia'; assert_protected()
            assert oldest_id not in containers and (oldest_dir / 'generation' / 'GENERATION.json').exists()
            for filename, raw in payloads.items():
                if filename != target: assert filename.read_bytes() == raw
        else: raise AssertionError('unknown fixture')
        print(json.dumps({'case': case, 'passed': True}))
    finally:
        if host.lock is not None: os.close(host.lock)
        m.os.open, m.os.fstat = real_open, real_fstat
`;

for (const [name, description] of [
  ['plan', 'requires the accepted predecessor and forbids a new runtime, image or image upload'],
  ['disk_init_refusal', 'rejects an inadmissible generation before creating an attempt or writing files'],
  ['disk_init_compressed_peak', 'reserves temporary compressed data as well as every decoded file'],
  ['disk_init_success', 'admits a fully budgeted generation and reports the measured capacity'],
  ['disk_upload_refusal', 'rechecks capacity before reading or writing an upload'],
  ['disk_compressed_pressure', 'stops compressed transfer before a concurrent consumer can exhaust the reserve'],
  ['disk_before_decode', 'rechecks the complete decoded requirement after receiving the compressed file'],
  ['disk_decode_pressure', 'stops decoding at a chunk boundary while preserving the serving reserve'],
  ['disk_upload_success', 'still verifies and accepts a complete gzip upload with sufficient capacity'],
  ['disk_before_start', 'refuses to start if operating headroom disappeared after upload'],
  ['start', 'starts from the installed image and changes only generation mount and manifest environment'],
  ['first_daily', 'accepts the first-release predecessor and never invents an obsolete rollback to delete'],
  ['bad_predecessor_mount', 'refuses a writable predecessor mount before creating any process'],
  ['bad_predecessor_manifest', 'refuses a changed predecessor manifest before creating any process'],
  ['bad_predecessor_receipt', 'requires the exact durable predecessor receipt'],
  ['bad_predecessor_environment', 'requires the live predecessor environment to match its receipt'],
  ['gates_and_rollback', 'keeps functional/speed gates and rolls back to the actual accepted native predecessor'],
  ['accepted_recovery', 'does not report an old accepted receipt as current after ingress or generation changes'],
  ['retire', 'retires exactly the obsolete native process after commit and keeps current, rollback, legacy, files and images'],
  ['retire_mount_order', 'continues exact post-commit retirement when Docker only reorders mounts after stop'],
  ['retire_recovery_mount_order', 'continues durable retirement recovery when Docker only reorders mounts after stop'],
  ['retire_mount_changed_after_stop', 'still refuses retirement when any mount attribute changes after stop'],
  ['retire_rejects_uncommitted', 'refuses retirement before acceptance or without a committed protected rollback'],
  ['retire_rejects_foreign', 'refuses retirement of a changed mount, foreign process or stale ingress'],
  ['retire_recovery', 'resumes only the durable task target without initialization, new directories or a candidate'],
  ['retire_recovery_interrupted', 'retries an interrupted stop/delete idempotently while preserving the accepted and rollback processes'],
  ['retire_recovery_future', 'uses fresh current and rollback protection when the accepted state has advanced since the queued task'],
  ['retire_recovery_rejects', 'rejects uncommitted witnesses, unresolved fresh state, protected targets and altered actual rollback mounts'],
  ['bulk_cleanup', 'removes only exact plan-bound bulk files and image archives while retaining proofs, directories and Docker images'],
  ['bulk_interrupted', 'resumes after an actual unlink without repeating activation or deleting retained data'],
  ['bulk_mounted', 'keeps all bulk bytes while any stopped or running container still mounts the directory through an alias'],
  ['bulk_changed', 'rejects altered bulk bytes before deletion'],
  ['bulk_symlink', 'refuses a substituted symlink and preserves the unrelated encyclopedia bytes'],
]) {
  test('China generation update host ' + description, () => {
    const result = spawnSync('python3', ['-I', '-B', '-c', harness, hostFile, name], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.deepEqual(JSON.parse(result.stdout), {case: name, passed: true});
  });
}
