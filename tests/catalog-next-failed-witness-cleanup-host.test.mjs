import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const host = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
// Actual proof, state, hash, inode, mount and unlink checks run against private
// temporary files. Host-service I/O is substituted; explicit race and disk
// metric cases inject only the condition named by each test.
// The synthetic PLAN/rollback hashes are changed in-process, never via RPC.
const harness = String.raw`
import base64, copy, datetime, fcntl, importlib.util, io, json, os, pathlib, stat, sys, tempfile, types
spec = importlib.util.spec_from_file_location('failed_upload_host', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
assert m.FAILED_UPLOAD_RUNTIME == '822f925bb30c4e07010f6e14b6574f1b4bd6306e'
assert m.FAILED_WITNESS_ACCEPTED_RUNTIME == '99c45a3b5d8439bbc1ee34702ba41340ada08125'
assert m.FAILED_WITNESS_BULK_BYTES == (13041560320, 13041559296, 13041561344)
assert sum(m.FAILED_WITNESS_BULK_BYTES) == 39124680960
assert len(m.FAILED_WITNESS_TARGETS) == 3
assert m.FAILED_WITNESS_TARGETS[0] == m.FAILED_UPLOAD_WITNESS
assert m.FAILED_WITNESS_TARGETS[1] == dict(m.FAILED_UPLOAD_WITNESS,
    runtimeSha='860e1ff601c6852eb3b1474982e52e3a5300c4af', nonce='df9db7228781df26f92a990a011eb1bd',
    planSha256='27888989f2a0e90e235f7a497fcce912ece493e9f5add5c40005e02ad991d9b2',
    rollbackSha256='d550834e33b9cd9bf9b1be10c4c8f5358563d6aa56b2ba87794c9d5df9fdb5dd',
    imageId='sha256:3c0389d7fcd0986a850d2f87c3259a75bddff3b0090ed0aef56eb1e190ef2238')
assert m.FAILED_WITNESS_TARGETS[2] == dict(m.FAILED_UPLOAD_WITNESS,
    runtimeSha='1518035b9e6b717cd364ae8d13e63d0127899112', nonce='92ec4a21446a23bed345fd789b2b3cc5',
    planSha256='2b038c3566322b7be1f4e622716b8aed85e6e318fd323d31098db05dbb469964',
    rollbackSha256='6f86011baf31bf183c5b156586b4c9b8a6aa22a0648c2d5f3de4c6f6e57538e9',
    imageId='sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea')
assert m.RESOLVED_CLEANUP_WITNESS['runtimeSha'] == '38895e53f7f770ee68edb0b8ad53056468b928a5'
assert m.RESOLVED_CLEANUP_WITNESS['nonce'] == '4567cf493328df1e43c586c84ba0f801'
assert m.RESOLVED_CLEANUP_WITNESS['planSha256'] == 'f181c53b79dc0d0d4345745de5d460dd6741cae3462d60a9d1f7d1acbd90b7b4'
assert m.RESOLVED_CLEANUP_WITNESS['rollbackSha256'] == 'f837bbab9d46863c5c02e7fa87d7e0adb0bcf070f5219879b2d526d9568f98b0'
assert m.RESOLVED_CLEANUP_WITNESS['imageId'] == 'sha256:c8fca211f0b5a7beede7e62ed6384b81ecc2c40f78f948053365392073f0c47e'
assert [row['planSha256'] for row in m.RESOLVED_CLEANUP_TARGETS] == ['9309d5e0b06e2d4e34aefe9e9c09add5f3a54900dfd4130d02ab1f1966efa994', '69752a498c9497b363b5ca1357d9ab136aeffeb99c4dcc16433f6bd2ad81f9d7']
assert m.RESOLVED_CLEANUP_BULK_BYTES == (13041560320, 13041560320)
target_index = int(sys.argv[2])
assert m.FAILED_UPLOAD_WITNESS['runtimeSha'] == '5e62f9ff3a0079b07cd13b8ab912c5720dd22250'
assert m.FAILED_UPLOAD_WITNESS['nonce'] == '2d015d0beef2af9f076bd1d47987dd88'
assert m.FAILED_UPLOAD_WITNESS['planSha256'] == '773cb37c8ecae1de789c895888fd2e56264b73503def96a32c86ee845283338c'
assert m.FAILED_UPLOAD_WITNESS['rollbackSha256'] == '3a431be4e34714930ce483f28575c797df5f49687a2157ab2be21d31016a8a06'
assert m.FAILED_UPLOAD_GENERATION == 'gen_china_45369451603_1'
assert m.FAILED_UPLOAD_TARGETS == (
    {'nonce': '2ab6a761ac784094d102edd7be8708af', 'planSha256': '998a10e522b1aacf493a309e9280075660816cb0d6926246884148f594d6d036',
     'rollbackSha256': '40d76cec42314ab0085d4ee216ecfa85f3a0910e8f7e4b32f5eb22daddcc0030'},
    {'nonce': 'ae835461a771911c083739ddbf03bead', 'planSha256': '09ef828f1b541f85a9eecb1b1c58305f8a6a3c379222ecc6b2ad57b41168a22f',
     'rollbackSha256': 'b26506fabb43efa22e8b38c8163e8f0098a775d0ca33c8e3259124b0b5ce7f28'})
assert m.FAILED_UPLOAD_BULK_FILES == ('details.sqlite', 'query.sqlite', 'DISPOSITIONS.ndjson', 'image.tar')
def forbidden(*args, **kwargs): raise AssertionError('unexpected external operation')
m.subprocess.run = m.command = forbidden
def refused(fn, code):
    try: fn()
    except m.ReleaseError as error: assert str(error) == 'china_host_' + code, str(error)
    else: raise AssertionError('expected refusal: ' + code)
def observed(value, etag):
    return {'found': True, 'etag': etag, 'sha256': m.canonical_sha(value), 'value': copy.deepcopy(value)}
def absent(): return {'found': False, 'etag': None, 'sha256': None, 'value': None}

with tempfile.TemporaryDirectory(prefix='china-failed-upload-host-') as temporary:
    root = pathlib.Path(temporary); root.chmod(0o700)
    m.BASE = root / 'releases'; m.BASE.mkdir(mode=0o700)
    m.CONFIG = root / 'nginx.conf'; ingress = b'server {\n  proxy_pass http://127.0.0.1:3006;\n}\n'
    m.CONFIG.write_bytes(ingress); m.CONFIG.chmod(0o600)
    def regular(filename, maximum=None):
        info = filename.lstat()
        m.need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not filename.is_symlink()
            and filename.resolve() == filename and filename.is_relative_to(root), 'regular_file')
        if maximum is not None: m.need(info.st_size <= maximum, 'file_size')
        return info
    def private_directory(directory):
        m.need(directory.resolve() == directory and directory.is_relative_to(root) and directory.is_dir()
            and not directory.stat().st_mode & 0o022, 'recovery_directory')
    m.regular, m.private_directory = regular, private_directory
    lock = root / 'runtime.lock'; lock.write_bytes(b''); lock.chmod(0o600)
    def reuse_lock():
        fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException: os.close(fd); raise m.ReleaseError('china_host_reuse_lock_busy')
        return fd
    m.reuse_lock = reuse_lock
    epoch = datetime.datetime(2026, 11, 24, 20, tzinfo=datetime.timezone.utc).timestamp()
    clock = [epoch]; m.time.time = lambda: clock[0]
    pricing, image, retained_image, current_id, retained_id, current_nonce = m.FAILED_UPLOAD_WITNESS['pricingRuntimeSha'], 'sha256:' + '5' * 64, 'sha256:' + '6' * 64, '7' * 64, '8' * 64, 'f' * 32
    source_at = '2026-11-23T12:00:00Z'
    generation = {'version': 1, 'kind': 'china-local-generation-v1', 'market': 'china',
        'generationId': m.FAILED_UPLOAD_GENERATION, 'runtimeSha': pricing, 'prepared': True,
        'source': {'cursor': 100, 'sourceObservedAt': source_at}}
    generation_bytes = m.json_bytes(generation)
    def write(filename, raw):
        if filename.exists(): filename.chmod(0o600)
        filename.write_bytes(raw); filename.chmod(0o400)
    def create_cut(runtime, nonce, image_id):
        directory = m.BASE / runtime / 'china-next' / nonce
        directory.mkdir(mode=0o700, parents=True)
        for folder in (directory.parent.parent, directory.parent): folder.chmod(0o700)
        (directory / 'generation').mkdir(mode=0o700)
        plan = {'version': 1, 'market': 'china', 'retainedRuntime': m.RETAINED, 'runtimeSha': runtime,
            'pricingRuntimeSha': pricing, 'runtimeTree': 'b' * 40, 'controllerSha': 'c' * 40,
            'runtimeDiffSha256': 'd' * 64, 'servingCalculationVersion': m.CALCULATION,
            'nonce': nonce, 'imageId': image_id, 'generationId': generation['generationId'],
            'generationManifestSha256': m.sha(generation_bytes), 'privateGenerationReceiptSha256': 'e' * 64,
            'sourceDescriptorSha256': '9' * 64, 'files': []}
        for name in sorted(m.expected_files(plan)):
            raw = generation_bytes if name == 'GENERATION.json' else ('immutable ' + nonce + ' ' + name).encode()
            dest = directory / name if name in ('image.tar', 'acceptance.json', 'regcloud-performance-gate.py', 'accepted-speed-baseline.json') else directory / 'generation' / name
            write(dest, raw)
            plan['files'].append({'name': name, 'bytes': len(raw), 'sha256': '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'
                if name == 'accepted-speed-baseline.json' else m.sha(raw), 'compressedBytes': 1, 'compressedSha256': 'b' * 64})
        m.validate_plan(plan); write(directory / 'PLAN.json', m.json_bytes(plan))
        return directory, plan
    current_dir, current_plan = create_cut(m.FAILED_WITNESS_ACCEPTED_RUNTIME, current_nonce, image)
    speed = m.json_bytes({'release': m.FAILED_WITNESS_ACCEPTED_RUNTIME, 'passed': True, 'browserPassed': True, 'speedGuard': {'passed': True}})
    details = m.json_bytes({'version': 1, 'kind': 'china-browser-details-v1', 'release': m.FAILED_WITNESS_ACCEPTED_RUNTIME,
        'nonce': current_nonce, 'passed': True, 'generationManifestSha256': m.sha(generation_bytes), 'precedingSpeedReportSha256': m.sha(speed)})
    receipt = {'version': 1, 'kind': 'china-host-acceptance-v1', 'release': m.FAILED_WITNESS_ACCEPTED_RUNTIME,
        'pricingRuntimeSha': pricing, 'imageId': image, 'generationId': generation['generationId'],
        'generationManifestSha256': m.sha(generation_bytes), 'privateGenerationReceiptSha256': 'e' * 64,
        'sourceDescriptorSha256': '9' * 64, 'sourceCursor': 100, 'sourceObservedAt': source_at,
        'nonce': current_nonce, 'acceptedAt': '2026-11-24T19:00:00Z', 'retainedContainerId': retained_id,
        'browser': {'release': m.FAILED_WITNESS_ACCEPTED_RUNTIME, 'nonce': current_nonce, 'passed': True,
            'functionalPassed': True, 'speedPassed': True, 'reportSha256': m.sha(speed + details),
            'speedReportSha256': m.sha(speed), 'detailsReportSha256': m.sha(details)}}
    receipt_bytes = m.json_bytes(receipt)
    for name, raw in [('ACCEPTED.json', receipt_bytes), ('BROWSER_SPEED.json', speed), ('BROWSER_DETAILS.json', details)]: write(current_dir / name, raw)
    reference = {'market': 'china', 'generationId': generation['generationId'], 'owner': {'runId': '45369451603', 'attempt': '1', 'revision': 'c' * 40},
        'runtimeSha': m.FAILED_WITNESS_ACCEPTED_RUNTIME, 'pricingRuntimeSha': pricing, 'imageId': image,
        'generationManifestSha256': m.sha(generation_bytes), 'receiptSha256': 'e' * 64, 'sourceDescriptorSha256': '9' * 64,
        'sourceCursor': 100, 'sourceObservedAt': source_at}
    intent = {'version': 1, 'kind': 'china-publication-intent-v1', 'market': 'china', 'revision': 1, 'nonce': current_nonce,
        'owner': {'runId': '45369451603', 'attempt': '1', 'revision': 'c' * 40}, 'createdAt': '2026-11-24T18:00:00Z',
        'candidate': copy.deepcopy(reference), 'previous': absent(), 'status': 'pending', 'resolution': None}
    reference['proof'] = {'kind': 'china-accepted-proof-v1', 'hostReceiptBase64': base64.b64encode(receipt_bytes).decode(), 'hostReceiptSha256': m.sha(receipt_bytes)}
    state = {'version': 1, 'kind': 'china-accepted-state-v1', 'market': 'china', 'revision': 2,
        'current': reference, 'rollback': None, 'pending': None, 'commit': {'nonce': current_nonce, 'intentSha256': m.canonical_sha(intent),
            'previousETag': None, 'previousStateSha256': None, 'acceptedAt': receipt['acceptedAt']}}
    accepted = observed(state, '"accepted-2"')
    intent.update(status='committed', resolution={'kind': 'accepted', 'at': receipt['acceptedAt'], 'acceptedETag': accepted['etag'],
        'acceptedSha256': accepted['sha256'], 'hostReceiptSha256': m.sha(receipt_bytes)})
    params = {'currentState': {'accepted': accepted, 'intent': observed(intent, '"intent-2"')},
        'leaseExpiresAt': '2026-11-24T21:00:00Z', 'targetIndex': target_index}
    targets, targets_binding, bulk = [], [], []
    for target in m.FAILED_UPLOAD_TARGETS:
        directory, plan = create_cut(m.FAILED_UPLOAD_RUNTIME, target['nonce'], 'sha256:' + '4' * 64)
        rollback = {'version': 1, 'kind': 'china-host-rollback-v1', 'nonce': plan['nonce'], 'release': plan['runtimeSha'],
            'pricingRuntimeSha': pricing, 'generationId': plan['generationId'], 'generationManifestSha256': plan['generationManifestSha256'],
            'imageId': plan['imageId'], 'privateGenerationReceiptSha256': plan['privateGenerationReceiptSha256'],
            'sourceDescriptorSha256': plan['sourceDescriptorSha256'], 'retainedRuntimeSha': m.RETAINED, 'retainedRunning': True,
            'candidateRemoved': True, 'ingressRestored': True, 'retainedContainerId': retained_id, 'retainedImageId': retained_image}
        raw = m.json_bytes(rollback); write(directory / 'ROLLED_BACK.json', raw)
        targets_binding.append({'nonce': plan['nonce'], 'planSha256': m.file_sha(directory / 'PLAN.json'), 'rollbackSha256': m.sha(raw)})
        targets.append(directory)
        bulk.extend((directory if name == 'image.tar' else directory / 'generation') / name for name in m.FAILED_UPLOAD_BULK_FILES)
    m.FAILED_UPLOAD_TARGETS = tuple(targets_binding)
    # The earlier pre-accept cleanup already removed exactly these eight.
    earlier_targets, earlier_bulk = list(targets), list(bulk)
    for filename in earlier_bulk: filename.unlink()
    failed_directories, failed_bulk, failed_targets = [], [], []
    for target in m.FAILED_WITNESS_TARGETS:
        target_directory, target_plan = create_cut(target['runtimeSha'], target['nonce'], target['imageId'])
        target_rollback = dict(rollback, nonce=target['nonce'], release=target['runtimeSha'], imageId=target['imageId'])
        target_rollback_raw = m.json_bytes(target_rollback)
        write(target_directory / 'ROLLED_BACK.json', target_rollback_raw)
        failed_targets.append(dict(target, generationManifestSha256=m.sha(generation_bytes),
            privateGenerationReceiptSha256='e' * 64, planSha256=m.file_sha(target_directory / 'PLAN.json'),
            rollbackSha256=m.sha(target_rollback_raw)))
        failed_directories.append(target_directory)
        failed_bulk.append([(target_directory if name == 'image.tar' else target_directory / 'generation') / name for name in m.FAILED_UPLOAD_BULK_FILES])
    m.FAILED_WITNESS_TARGETS = tuple(failed_targets)
    target_directory = failed_directories[target_index]
    targets = [target_directory]
    bulk = failed_bulk[target_index]
    all_bulk = [filename for group in failed_bulk for filename in group]
    # Fixture-only small payloads; no RPC can override any production pin.
    m.FAILED_WITNESS_BULK_BYTES = tuple(sum(filename.stat().st_size for filename in group) for group in failed_bulk)
    def container(identity, runtime, image_id, port, mounted=None):
        env = ['AVTOCENA_RELEASE_SHA=' + runtime, 'AVTOCENA_CALCULATION_VERSION=' + m.CALCULATION]
        labels, mounts = {}, []
        if mounted:
            env += ['CATALOG_CHINA_LOCAL_RUNTIME_SHA=' + pricing, 'CATALOG_CHINA_LOCAL_MANIFEST_SHA256=' + m.sha(generation_bytes),
                'CATALOG_CHINA_LOCAL_GENERATION_DIR=' + m.GENERATION_MOUNT]
            labels['avtocena.china.nonce'] = current_nonce
            mounts.append({'Type': 'bind', 'Source': str(mounted / 'generation'), 'Destination': m.GENERATION_MOUNT, 'RW': False})
        return {'Id': identity, 'Image': image_id, 'Config': {'Env': env, 'Labels': labels}, 'HostConfig': {'PortBindings': {'3000/tcp': [{'HostPort': str(port)}]}},
            'Mounts': mounts, 'State': {'Running': True, 'Pid': port, 'StartedAt': '2026-11-24T19:00:00Z'}, 'RestartCount': 0}
    containers = {current_id: container(current_id, m.FAILED_WITNESS_ACCEPTED_RUNTIME, image, 3006, current_dir),
        retained_id: container(retained_id, m.RETAINED, retained_image, 3005)}
    docker_calls = []
    def docker(method, url, *args, **kwargs):
        assert method == 'GET', 'must not mutate Docker'
        docker_calls.append(url)
        if url == '/containers/json?all=1': return [{'Id': value} for value in containers]
        assert url.startswith('/containers/') and url.endswith('/json')
        return copy.deepcopy(containers[url.split('/')[2]])
    m.docker = docker
    def health(port, runtime):
        m.need(port == 3006 and runtime == m.FAILED_WITNESS_ACCEPTED_RUNTIME and containers[current_id]['State']['Running'], 'health_identity')
    m.health = health
    initial_files = {filename: filename.read_bytes() for filename in root.rglob('*') if filename.is_file()}
    initial_containers = copy.deepcopy(containers)
    def remaining(): return [filename for filename in bulk if filename.exists()]
    def unchanged():
        assert len(remaining()) == 4
        assert all(filename.read_bytes() == raw for filename, raw in initial_files.items())
        assert containers == initial_containers
    def protects_survivors():
        assert all(filename.read_bytes() == raw for filename, raw in initial_files.items() if filename not in bulk)
        assert containers == initial_containers
    def protects_all_survivors():
        assert all(filename.read_bytes() == raw for filename, raw in initial_files.items() if filename not in all_bulk)
        assert containers == initial_containers
    def reject_mutation(code, alter, restore=lambda: None):
        alter(); refused(lambda: m.prune_failed_uploads(params), code); restore(); unchanged()
    def stopped_mount(source):
        row = container('a' * 64, 'b' * 40, 'sha256:' + 'c' * 64, 3010)
        row['State']['Running'] = False
        row['Mounts'] = [{'Type': 'bind', 'Source': str(source), 'Destination': '/private', 'RW': False}]
        containers[row['Id']] = row
        return row['Id']
`;

function check(body, targetIndexes = [0, 1, 2]) {
  const script = harness + '\n' + body.trim().split('\n').map(line => '    ' + line).join('\n') + '\n';
  for (const targetIndex of targetIndexes) {
    const result = spawnSync('python3', ['-I', '-B', '-c', script, host, String(targetIndex)], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, 'target ' + targetIndex + ': ' + (result.stderr || result.stdout || String(result.error)));
  }
}

test('each fixed target removes only its four files; accepted current, live56, the other copies and all proofs survive', () => check(`
total = sum(filename.stat().st_size for filename in bulk)
result = m.prune_failed_witness(params)
assert result['completed'] and result['filesDeleted'] == 4 and result['freedBytes'] == total and result['alreadyAbsentFiles'] == 0
assert result['runtimeSha'] == m.FAILED_WITNESS_ACCEPTED_RUNTIME and result['phase'] == 'after-first-acceptance'
assert result['earlierBulkFilesAbsent'] == 8 and result['targetIndex'] == target_index and result['targetFailedAttempt'] == m.FAILED_WITNESS_TARGETS[target_index]
assert all(type(result[key]) is int and 0 <= result[key] <= 9007199254740991 for key in ('diskFreeBytesBefore', 'diskFreeBytesAfter'))
assert all(result[key] == 0 for key in ('retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes', 'acceptedStateWrites', 'intentStateWrites'))
assert len(remaining()) == 0 and all(not filename.exists() for filename in earlier_bulk)
protects_survivors()
second = m.prune_failed_witness(params)
assert second['filesDeleted'] == 0 and second['freedBytes'] == 0 and second['alreadyAbsentFiles'] == 4
protects_survivors()
`));

test('available filesystem bytes are actual before/after observations, independent of logical removed bytes', () => check(`
real_statvfs = m.os.statvfs
observations = iter((2000000000, 1000000000))
def observed_statvfs(path):
    assert path == m.BASE
    return types.SimpleNamespace(f_bavail=next(observations), f_frsize=1)
m.os.statvfs = observed_statvfs
try: result = m.prune_failed_witness(params)
finally: m.os.statvfs = real_statvfs
assert result['diskFreeBytesBefore'] == 2000000000 and result['diskFreeBytesAfter'] == 1000000000
assert result['filesDeleted'] == 4 and result['freedBytes'] > 0
assert result['diskFreeBytesAfter'] - result['diskFreeBytesBefore'] != result['freedBytes']
protects_survivors()
`));

test('invalid available filesystem metrics refuse pruning before the first unlink', () => check(`
real_statvfs = m.os.statvfs
try:
    for invalid in (-1, 9007199254740992, 1.5):
        m.os.statvfs = lambda path: types.SimpleNamespace(f_bavail=invalid, f_frsize=1)
        refused(lambda: m.prune_failed_witness(params), 'witness_disk_capacity')
        unchanged()
finally: m.os.statvfs = real_statvfs
`));

test('only the three fixed integer targets are accepted; no caller can supply another path or profile', () => check(`
for invalid in (None, False, True, -1, 3, 0.0, 2.0, '0', {}, []):
    refused(lambda: m.prune_failed_witness(dict(params, targetIndex=invalid)), 'witness_target')
    unchanged()
missing = dict(params); del missing['targetIndex']
refused(lambda: m.prune_failed_witness(missing), 'witness_parameters')
for key in ('directory', 'target', 'runtimeSha', 'nonce', 'planSha256'):
    refused(lambda: m.prune_failed_witness(dict(params, **{key: str(target_directory)})), 'witness_parameters')
unchanged()
`));

test('a target directory or nonce alias of the accepted current is refused before deletion', () => check(`
original = m.FAILED_WITNESS_TARGETS
try:
    for changes in ({'nonce': current_nonce}, {'runtimeSha': m.FAILED_WITNESS_ACCEPTED_RUNTIME, 'nonce': current_nonce}):
        altered = list(original); altered[target_index] = dict(altered[target_index], **changes)
        m.FAILED_WITNESS_TARGETS = tuple(altered)
        refused(lambda: m.prune_failed_witness(params), 'witness_current_alias')
        unchanged()
finally: m.FAILED_WITNESS_TARGETS = original
`));

test('sequential fixed targets remove exactly all twelve files and resume without double-counting', () => check(`
total = sum(filename.stat().st_size for filename in all_bulk)
results = [m.prune_failed_witness(dict(params, targetIndex=index)) for index in (0, 1, 2)]
assert [row['targetIndex'] for row in results] == [0, 1, 2]
assert sum(row['filesDeleted'] for row in results) == 12 and sum(row['freedBytes'] for row in results) == total
assert all(not os.path.lexists(filename) for filename in all_bulk)
protects_all_survivors()
again = [m.prune_failed_witness(dict(params, targetIndex=index)) for index in (0, 1, 2)]
assert sum(row['filesDeleted'] for row in again) == 0 and sum(row['freedBytes'] for row in again) == 0
assert sum(row['alreadyAbsentFiles'] for row in again) == 12
protects_all_survivors()
`, [0]));

test('a lost second-target unlink resumes remaining files while preserving the completed first target', () => check(`
first = m.prune_failed_witness(dict(params, targetIndex=0)); assert first['filesDeleted'] == 4
original_unlink = pathlib.Path.unlink; removed = []
def interrupt_unlink(filename, *args, **kwargs):
    original_unlink(filename, *args, **kwargs)
    if filename in failed_bulk[1]:
        removed.append(filename)
        raise RuntimeError('simulated lost reply after unlink')
pathlib.Path.unlink = interrupt_unlink
try:
    try: m.prune_failed_witness(dict(params, targetIndex=1))
    except RuntimeError as error: assert str(error) == 'simulated lost reply after unlink'
    else: raise AssertionError('expected interrupted second target')
finally: pathlib.Path.unlink = original_unlink
assert len(removed) == 1
protects_all_survivors()
remaining_bytes = sum(filename.stat().st_size for filename in failed_bulk[1] if filename.exists())
assert all(filename.exists() for filename in failed_bulk[2]), 'the third target is untouched until requested'
again = [m.prune_failed_witness(dict(params, targetIndex=index)) for index in (0, 1)]
assert sum(row['filesDeleted'] for row in again) == 3 and sum(row['freedBytes'] for row in again) == remaining_bytes
assert sum(row['alreadyAbsentFiles'] for row in again) == 5
protects_all_survivors()
`, [0]));

test('after precleanup only four runtime151 files are newly removed and all three attempts remain resumable', () => check(`
for group in failed_bulk[:2]:
    for filename in group: filename.unlink()
total = sum(filename.stat().st_size for filename in failed_bulk[2])
results = [m.prune_failed_witness(dict(params, targetIndex=index)) for index in (0, 1, 2)]
assert [row['filesDeleted'] for row in results] == [0, 0, 4]
assert [row['alreadyAbsentFiles'] for row in results] == [4, 4, 0]
assert [row['freedBytes'] for row in results] == [0, 0, total]
assert all(row['earlierBulkFilesAbsent'] == 8 for row in results)
protects_all_survivors()
again = [m.prune_failed_witness(dict(params, targetIndex=index)) for index in (0, 1, 2)]
assert sum(row['filesDeleted'] for row in again) == 0 and sum(row['freedBytes'] for row in again) == 0
assert sum(row['alreadyAbsentFiles'] for row in again) == 12
protects_all_survivors()
`, [2]));

test('a lost runtime151 unlink resumes three remaining files with both earlier target proofs preserved', () => check(`
first = [m.prune_failed_witness(dict(params, targetIndex=index)) for index in (0, 1)]
assert sum(row['filesDeleted'] for row in first) == 8
original_unlink = pathlib.Path.unlink; removed = []
def interrupt_unlink(filename, *args, **kwargs):
    original_unlink(filename, *args, **kwargs)
    if filename in failed_bulk[2]:
        removed.append(filename)
        raise RuntimeError('simulated lost reply after runtime151 unlink')
pathlib.Path.unlink = interrupt_unlink
try:
    try: m.prune_failed_witness(dict(params, targetIndex=2))
    except RuntimeError as error: assert str(error) == 'simulated lost reply after runtime151 unlink'
    else: raise AssertionError('expected interrupted third target')
finally: pathlib.Path.unlink = original_unlink
assert len(removed) == 1
protects_all_survivors()
remaining_bytes = sum(filename.stat().st_size for filename in failed_bulk[2] if filename.exists())
again = [m.prune_failed_witness(dict(params, targetIndex=index)) for index in (0, 1, 2)]
assert sum(row['filesDeleted'] for row in again) == 3 and sum(row['freedBytes'] for row in again) == remaining_bytes
assert sum(row['alreadyAbsentFiles'] for row in again) == 9
protects_all_survivors()
`, [2]));

test('already absent target bulk still requires its exact PLAN and rollback before any success report', () => check(`
for filename in bulk: filename.unlink()
for name in ('PLAN.json', 'ROLLED_BACK.json'):
    filename = target_directory / name; raw = filename.read_bytes(); write(filename, raw + b' ')
    refused(lambda: m.prune_failed_witness(params), 'witness_proof'); write(filename, raw)
protects_survivors()
`));

test('absent, pending, different runtime or uncommitted state cannot authorize post-accept cleanup', () => check(`
bad = copy.deepcopy(params); bad['currentState']['accepted'] = absent()
refused(lambda: m.prune_failed_witness(bad), 'retire_observation')
bad = copy.deepcopy(params); value = bad['currentState']['accepted']['value']; value['pending'] = {}
bad['currentState']['accepted']['sha256'] = m.canonical_sha(value)
refused(lambda: m.prune_failed_witness(bad), 'retire_state')
bad = copy.deepcopy(params); bad['currentState']['intent']['value']['status'] = 'pending'
bad['currentState']['intent']['sha256'] = m.canonical_sha(bad['currentState']['intent']['value'])
refused(lambda: m.prune_failed_witness(bad), 'retire_intent')
bad = copy.deepcopy(params); bad['currentState']['intent']['value']['candidate']['imageId'] = 'sha256:' + '0' * 64
bad['currentState']['intent']['sha256'] = m.canonical_sha(bad['currentState']['intent']['value'])
refused(lambda: m.prune_failed_witness(bad), 'retire_intent_binding')
runtime = m.FAILED_WITNESS_ACCEPTED_RUNTIME; m.FAILED_WITNESS_ACCEPTED_RUNTIME = '0' * 40
refused(lambda: m.prune_failed_witness(params), 'witness_current'); m.FAILED_WITNESS_ACCEPTED_RUNTIME = runtime
refused(lambda: m.prune_failed_witness(dict(params, runtimeSha=runtime)), 'witness_parameters')
unchanged()
`));

test('all earlier eight files must remain absent including dangling symlinks', () => check(`
for filename in earlier_bulk:
    write(filename, b'earlier copy still present')
    refused(lambda: m.prune_failed_witness(params), 'witness_earlier_bulk_present'); filename.unlink()
    filename.symlink_to(root / 'missing')
    refused(lambda: m.prune_failed_witness(params), 'witness_earlier_bulk_present'); filename.unlink()
unchanged()
`));

test('fixed target and earlier PLAN/rollback proofs cannot be replaced', () => check(`
for directory, code in [(target_directory, 'witness_proof'), (earlier_targets[0], 'witness_earlier_proof')]:
    for name in ('PLAN.json', 'ROLLED_BACK.json'):
        filename = directory / name; raw = filename.read_bytes(); write(filename, raw + b' ')
        refused(lambda: m.prune_failed_witness(params), code); write(filename, raw)
unchanged()
`));

test('accepted or pending entries protect any failed attempt even when dangling', () => check(`
for directory, code in [(target_directory, 'witness_target_accepted'), (earlier_targets[0], 'witness_earlier_accepted')]:
    for name in ('ACCEPTED.json', 'ACCEPTED.pending'):
        filename = directory / name; filename.symlink_to(root / 'missing')
        refused(lambda: m.prune_failed_witness(params), code); filename.unlink()
unchanged()
`));

test('stopped or running mounts and leftover failed nonces block post-accept pruning', () => check(`
alias = root / 'alias'; alias.symlink_to(target_directory, target_is_directory=True)
for source in (target_directory.parent, target_directory, target_directory / 'generation', bulk[0], alias, earlier_targets[0]):
    identity = stopped_mount(source)
    refused(lambda: m.prune_failed_witness(params), 'witness_files_mounted'); del containers[identity]
alias.unlink()
identity = stopped_mount(root / 'unrelated'); containers[identity]['Config']['Labels']['avtocena.china.nonce'] = m.FAILED_WITNESS_TARGETS[target_index]['nonce']
refused(lambda: m.prune_failed_witness(params), 'witness_candidate_exists'); del containers[identity]
unchanged()
`));

test('mount inode aliases including ancestors above BASE block every unlink while unrelated siblings remain usable', () => check(`
alias = root / 'bind-alias'; alias.mkdir(mode=0o700)
unrelated = root / 'unrelated'; unrelated.mkdir(mode=0o700)
real_stat = pathlib.Path.stat
for equivalent in (m.BASE.parent, *m.BASE.parents, m.BASE, target_directory.parent.parent,
        target_directory.parent, target_directory, target_directory / 'generation', bulk[0], earlier_targets[0]):
    identity = stopped_mount(alias)
    def aliased_stat(filename, *args, **kwargs):
        return real_stat(equivalent if filename == alias else filename, *args, **kwargs)
    pathlib.Path.stat = aliased_stat
    try:
        for running in (False, True):
            containers[identity]['State']['Running'] = running
            refused(lambda: m.prune_failed_witness(params), 'witness_mount_inode_alias')
    finally: pathlib.Path.stat = real_stat; del containers[identity]
    unchanged()
identity = stopped_mount(unrelated)
result = m.prune_failed_witness(params)
assert result['completed'] and result['filesDeleted'] == 4
del containers[identity]
protects_survivors()
`));

test('all four target hashes and exclusive immutable files are required before first unlink', () => check(`
filename = bulk[-1]; raw = filename.read_bytes(); filename.unlink(); filename.symlink_to(bulk[0])
refused(lambda: m.prune_failed_witness(params), 'regular_file'); filename.unlink(); write(filename, raw)
link = root / 'hard-link'; os.link(filename, link)
refused(lambda: m.prune_failed_witness(params), 'regular_file'); link.unlink()
filename.chmod(0o600); refused(lambda: m.prune_failed_witness(params), 'reuse_file_permissions'); filename.chmod(0o400)
write(filename, bytes([raw[0] ^ 1]) + raw[1:]); refused(lambda: m.prune_failed_witness(params), 'witness_file_hash'); write(filename, raw)
limit = m.FAILED_WITNESS_BULK_BYTES
m.FAILED_WITNESS_BULK_BYTES = tuple(value + (index == target_index) for index, value in enumerate(limit))
refused(lambda: m.prune_failed_witness(params), 'witness_files'); m.FAILED_WITNESS_BULK_BYTES = limit
unchanged()
`));

test('actual current acceptance/browser bytes and mounted generation identity remain authoritative', () => check(`
for name, code in [('ACCEPTED.json', 'retire_history'), ('BROWSER_SPEED.json', 'recovery_browser')]:
    filename = current_dir / name; raw = filename.read_bytes(); write(filename, raw + b' ')
    refused(lambda: m.prune_failed_witness(params), code); write(filename, raw)
containers[current_id]['Mounts'][0]['RW'] = True
refused(lambda: m.prune_failed_witness(params), 'mounted_generation'); containers[current_id]['Mounts'][0]['RW'] = False
containers[retained_id]['State']['Running'] = False
refused(lambda: m.prune_failed_witness(params), 'witness_retained'); containers[retained_id]['State']['Running'] = True
unchanged()
`));

test('late target, current file, container, ingress, old-file or lease changes stop the first unlink', () => check(`
real_sha = m.file_sha; last = target_directory / 'generation/query.sqlite'
for mutation, code in [('target', 'witness_file_changed'), ('current', 'witness_current_changed'),
        ('container', 'witness_protected_changed'), ('retained', 'witness_protected_changed'),
        ('ingress', 'ingress_changed'), ('earlier', 'witness_earlier_bulk_present'), ('lease', 'witness_lease_expired')]:
    def during_hash(filename):
        digest = real_sha(filename)
        if filename == last:
            if mutation == 'target': write(bulk[0], bulk[0].read_bytes())
            if mutation == 'current': write(current_dir / 'generation/details.sqlite', (current_dir / 'generation/details.sqlite').read_bytes())
            if mutation == 'container': containers[current_id]['State']['Pid'] += 1
            if mutation == 'retained': containers[retained_id]['State']['Pid'] += 1
            if mutation == 'ingress': m.CONFIG.write_bytes(ingress + b' ')
            if mutation == 'earlier': write(earlier_bulk[0], b'late copy')
            if mutation == 'lease': clock[0] += 7200
        return digest
    m.file_sha = during_hash
    refused(lambda: m.prune_failed_witness(params), code)
    containers.clear(); containers.update(copy.deepcopy(initial_containers)); m.CONFIG.write_bytes(ingress)
    earlier_bulk[0].unlink(missing_ok=True); clock[0] = epoch; m.file_sha = real_sha
    unchanged()
`));

test('partial unlink interruption resumes exactly remaining files without changing publication state', () => check(`
real_unlink = pathlib.Path.unlink; deleted = [0]
def interrupted(filename, *args, **kwargs):
    if filename in bulk:
        if deleted[0] == 1: raise OSError('simulated lost response after first unlink')
        deleted[0] += 1
    return real_unlink(filename, *args, **kwargs)
pathlib.Path.unlink = interrupted
try:
    try: m.prune_failed_witness(params)
    except OSError: pass
    else: raise AssertionError('interruption not observed')
finally: pathlib.Path.unlink = real_unlink
assert len(remaining()) == 3; protects_survivors()
rest = sum(filename.stat().st_size for filename in remaining()); result = m.prune_failed_witness(params)
assert result['filesDeleted'] == 3 and result['freedBytes'] == rest and result['alreadyAbsentFiles'] == 1
protects_survivors()
`));

test('existing runtime flock and lease expiry exclude overlapping or stale cleanup', () => check(`
held = reuse_lock()
try: refused(lambda: m.prune_failed_witness(params), 'reuse_lock_busy')
finally: os.close(held)
bad = copy.deepcopy(params); bad['leaseExpiresAt'] = '2026-11-24T19:59:00Z'
refused(lambda: m.prune_failed_witness(bad), 'witness_lease')
unchanged()
`));

test('post-accept cleanup stream cannot initialize a release or cross into pre-accept cleanup', () => check(String.raw`
for method in ('init', 'prune_failed_uploads'):
    packets = []; m.emit = packets.append
    m.sys.stdin = types.SimpleNamespace(buffer=io.BytesIO(b'\n'.join(m.json_bytes(row) for row in [
        {'id': 1, 'method': 'prune_failed_witness', 'params': params}, {'id': 2, 'method': method, 'params': {}}]) + b'\n'))
    refused(m.main, 'witness_protocol_scope')
    assert packets[1]['kind'] == 'result' and packets[1]['value']['completed']
    assert packets[2]['kind'] == 'error' and packets[2]['code'] == 'china_host_witness_protocol_scope'
    protects_survivors()
`));

