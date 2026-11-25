import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const host = fileURLToPath(new URL('../scripts/catalog-next/release-host.py', import.meta.url));
const harness = String.raw`
import copy, datetime, fcntl, importlib.util, io, json, os, pathlib, stat, sys, tempfile, types
spec = importlib.util.spec_from_file_location('release_host', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
assert m.FAILED_UPLOAD_RUNTIME == '822f925bb30c4e07010f6e14b6574f1b4bd6306e'
assert m.FAILED_UPLOAD_GENERATION == 'gen_china_45369451603_1'
assert m.FAILED_UPLOAD_WITNESS == {
    'runtimeSha': '5e62f9ff3a0079b07cd13b8ab912c5720dd22250',
    'pricingRuntimeSha': '64c6338e0db23c8999096bceefbf113c0136fe15', 'generationId': m.FAILED_UPLOAD_GENERATION,
    'generationManifestSha256': 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
    'privateGenerationReceiptSha256': '25f5277665bcc1a72879d9a7e55cb39fc7d4bd57a061be2593d3a6a9d9f1cc22',
    'nonce': '2d015d0beef2af9f076bd1d47987dd88',
    'planSha256': '773cb37c8ecae1de789c895888fd2e56264b73503def96a32c86ee845283338c',
    'rollbackSha256': '3a431be4e34714930ce483f28575c797df5f49687a2157ab2be21d31016a8a06',
    'imageId': 'sha256:7af5df7fa93163687fcb5c0e1ad834176234319de13a4dd92ddc1d954fcc9381'}
assert m.FAILED_UPLOAD_TARGETS == (
    {'nonce': '2ab6a761ac784094d102edd7be8708af', 'planSha256': '998a10e522b1aacf493a309e9280075660816cb0d6926246884148f594d6d036',
     'rollbackSha256': '40d76cec42314ab0085d4ee216ecfa85f3a0910e8f7e4b32f5eb22daddcc0030'},
    {'nonce': 'ae835461a771911c083739ddbf03bead', 'planSha256': '09ef828f1b541f85a9eecb1b1c58305f8a6a3c379222ecc6b2ad57b41168a22f',
     'rollbackSha256': 'b26506fabb43efa22e8b38c8163e8f0098a775d0ca33c8e3259124b0b5ce7f28'})
assert m.FAILED_UPLOAD_BULK_FILES == ('details.sqlite', 'query.sqlite', 'DISPOSITIONS.ndjson', 'image.tar')
assert m.RESOLVED_CLEANUP_WITNESS['runtimeSha'] == '38895e53f7f770ee68edb0b8ad53056468b928a5'
assert m.RESOLVED_CLEANUP_WITNESS['nonce'] == 'bb85ea435dc8bbf6f28809be2ec0b447'
assert m.RESOLVED_CLEANUP_WITNESS['planSha256'] == '9309d5e0b06e2d4e34aefe9e9c09add5f3a54900dfd4130d02ab1f1966efa994'
assert m.RESOLVED_CLEANUP_WITNESS['rollbackSha256'] == '6e2e1f838df5d9dd7e8a4d61e3277096432c068c8e55b8519bdd5df502c7812e'
assert m.RESOLVED_CLEANUP_WITNESS['imageId'] == 'sha256:7c093eedb12cd825ba204d8f3758438a834d5bcece80c7a25f0040e4147159d9'
assert m.RESOLVED_CLEANUP_TARGETS[0] == m.FAILED_WITNESS_TARGETS[2] and m.RESOLVED_CLEANUP_TARGETS[1]['planSha256'] == '027f6e750ff886098174c4da80e44a3a06c1b6cc94a46dc0f619452aa24139fa' and len(m.RESOLVED_CLEANUP_TARGETS) == 2
assert m.RESOLVED_CLEANUP_BULK_BYTES == (13041561344, 13041562880)
def forbidden(*args, **kwargs): raise AssertionError('unexpected external operation')
m.subprocess.run = m.command = forbidden
def refused(fn, code):
    try: fn()
    except m.ReleaseError as error: assert str(error) == 'china_host_' + code, str(error)
    else: raise AssertionError('expected refusal: ' + code)
def absent(): return {'found': False, 'etag': None, 'sha256': None, 'value': None}
baseline = (pathlib.Path(sys.argv[1]).resolve().parents[2] / 'docs/operations/2026-11-11-accepted-speed-baseline.json').read_bytes()
assert m.sha(baseline) == '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59'

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
    witness = dict(m.RESOLVED_CLEANUP_WITNESS)
    pricing, image, retained_image, retained_id = witness['pricingRuntimeSha'], witness['imageId'], 'sha256:' + '6' * 64, '8' * 64
    generation = {'version': 1, 'kind': 'china-local-generation-v1', 'market': 'china',
        'generationId': m.FAILED_UPLOAD_GENERATION, 'runtimeSha': pricing, 'prepared': True,
        'source': {'cursor': 100, 'sourceObservedAt': '2026-11-23T12:00:00Z', 'supplierLatestVerified': True}}
    generation_bytes = m.json_bytes(generation)
    def write(filename, raw):
        if filename.exists(): filename.chmod(0o600)
        filename.write_bytes(raw); filename.chmod(0o400)
    def create_cut(runtime, nonce, image_id, previous=None):
        directory = m.BASE / runtime / 'china-next' / nonce
        directory.mkdir(mode=0o700, parents=True)
        for folder in (directory.parent.parent, directory.parent): folder.chmod(0o700)
        (directory / 'generation').mkdir(mode=0o700)
        plan = {'version': 1, 'market': 'china', 'retainedRuntime': m.RETAINED, 'runtimeSha': runtime,
            'pricingRuntimeSha': pricing, 'runtimeTree': 'b' * 40, 'controllerSha': 'c' * 40,
            'runtimeDiffSha256': 'd' * 64, 'servingCalculationVersion': m.CALCULATION,
            'nonce': nonce, 'imageId': image_id, 'generationId': generation['generationId'],
            'generationManifestSha256': m.sha(generation_bytes), 'privateGenerationReceiptSha256': witness['privateGenerationReceiptSha256'],
            'sourceDescriptorSha256': '9' * 64, 'previousAcceptedETag': previous['etag'] if previous else None,
            'previousAcceptedStateSha256': previous['sha256'] if previous else None, 'files': []}
        for name in sorted(m.expected_files(plan)):
            raw = generation_bytes if name == 'GENERATION.json' else baseline if name == 'accepted-speed-baseline.json' else ('immutable ' + nonce + ' ' + name).encode()
            dest = directory / name if name in ('image.tar', 'acceptance.json', 'regcloud-performance-gate.py', 'accepted-speed-baseline.json') else directory / 'generation' / name
            write(dest, raw)
            plan['files'].append({'name': name, 'bytes': len(raw), 'sha256': m.sha(raw), 'compressedBytes': 1, 'compressedSha256': 'b' * 64})
        m.validate_plan(plan); write(directory / 'PLAN.json', m.json_bytes(plan))
        rollback = {'version': 1, 'kind': 'china-host-rollback-v1', 'nonce': plan['nonce'], 'release': plan['runtimeSha'],
            'pricingRuntimeSha': pricing, 'generationId': plan['generationId'], 'generationManifestSha256': plan['generationManifestSha256'],
            'imageId': plan['imageId'], 'privateGenerationReceiptSha256': plan['privateGenerationReceiptSha256'],
            'sourceDescriptorSha256': plan['sourceDescriptorSha256'], 'retainedRuntimeSha': m.RETAINED, 'retainedRunning': True,
            'candidateRemoved': True, 'ingressRestored': True, 'retainedContainerId': retained_id, 'retainedImageId': retained_image,
            'previousAcceptedETag': plan['previousAcceptedETag'], 'previousAcceptedStateSha256': plan['previousAcceptedStateSha256'],
            'rolledBackAt': '2026-11-24T19:30:00Z'}
        write(directory / 'ROLLED_BACK.json', m.json_bytes(rollback))
        return directory, plan
    def observe(value, etag='"fixture-state"'):
        return {'found': True, 'etag': etag, 'sha256': m.canonical_sha(value), 'value': copy.deepcopy(value)}
    targets, target_plans, targets_binding, bulk = [], [], [], []
    for target in m.RESOLVED_CLEANUP_TARGETS:
        directory, plan = create_cut(target['runtimeSha'], target['nonce'], target['imageId'])
        targets_binding.append({**target, 'planSha256': m.file_sha(directory / 'PLAN.json'),
            'rollbackSha256': m.file_sha(directory / 'ROLLED_BACK.json'), 'generationManifestSha256': m.sha(generation_bytes)})
        targets.append(directory); target_plans.append(plan)
        bulk.extend((directory if name == 'image.tar' else directory / 'generation') / name for name in m.FAILED_UPLOAD_BULK_FILES)
    m.RESOLVED_CLEANUP_TARGETS = tuple(targets_binding)
    m.RESOLVED_CLEANUP_BULK_BYTES = tuple(sum(p.stat().st_size for p in bulk[i:i+4]) for i in (0, 4))
    empty_state = {'version': 1, 'kind': 'china-accepted-state-v1', 'market': 'china', 'revision': 2,
        'current': None, 'rollback': None, 'pending': None, 'commit': None}
    accepted = observe(empty_state, '"accepted-after-860"')
    candidate = {'market': 'china', 'generationId': witness['generationId'],
        'owner': {'runId': '45369451603', 'attempt': '1', 'revision': 'c' * 40},
        'receiptSha256': witness['privateGenerationReceiptSha256'], 'sourceDescriptorSha256': '9' * 64,
        'generationManifestSha256': m.sha(generation_bytes), 'sourceCursor': 100, 'sourceObservedAt': '2026-11-23T12:00:00Z',
        'runtimeSha': targets_binding[1]['runtimeSha'], 'pricingRuntimeSha': pricing, 'imageId': targets_binding[1]['imageId']}
    rollback_raw = (targets[1] / 'ROLLED_BACK.json').read_bytes()
    intent = observe({'version': 1, 'kind': 'china-publication-intent-v1', 'market': 'china', 'revision': 1,
        'nonce': targets_binding[1]['nonce'], 'owner': {'runId': '45439516316', 'attempt': '1', 'revision': 'c' * 40},
        'createdAt': '2026-11-24T19:00:00Z', 'candidate': candidate, 'previous': absent(), 'status': 'aborted',
        'resolution': {'kind': 'rolled_back', 'at': '2026-11-24T19:31:00Z', 'acceptedETag': accepted['etag'],
            'acceptedSha256': accepted['sha256'], 'hostReceiptSha256': None,
            'rollbackProof': {'kind': 'china-rollback-proof-v1', 'hostRollbackBase64': m.base64.b64encode(rollback_raw).decode(),
                'hostRollbackSha256': m.sha(rollback_raw)}}}, '"resolved-860-intent"')
    witness_dir, witness_plan = create_cut(witness['runtimeSha'], witness['nonce'], image, accepted)
    witness_files = [filename for filename in witness_dir.rglob('*') if filename.is_file() and filename.name not in ('PLAN.json', 'ROLLED_BACK.json')]
    assert len(witness_files) == 11
    # Fixture bytes are intentionally tiny. Only fixture digests and byte totals
    # are substituted in process; runtime/nonce/image and exact paths stay pinned.
    m.RESOLVED_CLEANUP_WITNESS = {**witness, 'planSha256': m.file_sha(witness_dir / 'PLAN.json'),
        'rollbackSha256': m.file_sha(witness_dir / 'ROLLED_BACK.json'), 'generationManifestSha256': m.sha(generation_bytes)}
    lease = observe({'version': 1, 'kind': 'china-market-lease-v1', 'market': 'china', 'epoch': 2,
        'owner': {'runId': '45490000000', 'attempt': '1', 'revision': 'c' * 40}, 'nonce': 'f' * 32,
        'status': 'held', 'acquiredAt': '2026-11-24T20:00:00Z', 'expiresAt': '2026-11-24T21:00:00Z', 'releasedAt': None}, '"fresh-lease"')
    authority = {'publicationState': {'accepted': accepted, 'intent': intent}, 'lease': lease}
    params = {'action': 'prepare', 'authority': authority}
    def container(identity, runtime, image_id, port):
        return {'Id': identity, 'Image': image_id, 'Config': {'Env': ['AVTOCENA_RELEASE_SHA=' + runtime,
            'AVTOCENA_CALCULATION_VERSION=' + m.CALCULATION], 'Labels': {}},
            'HostConfig': {'PortBindings': {'3000/tcp': [{'HostPort': str(port)}]}}, 'Mounts': [],
            'State': {'Running': True, 'Pid': port, 'StartedAt': '2026-11-24T19:00:00Z'}, 'RestartCount': 0}
    containers = {retained_id: container(retained_id, m.RETAINED, retained_image, 3006)}
    image_row = {'Id': image, 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': {'org.opencontainers.image.revision': witness['runtimeSha']}}}
    docker_calls = []
    def docker(method, url, *args, **kwargs):
        assert method == 'GET', 'must not mutate Docker'
        docker_calls.append(url)
        if url == '/containers/json?all=1': return [{'Id': value} for value in containers]
        if url == '/images/' + image + '/json': return copy.deepcopy(image_row)
        assert url.startswith('/containers/') and url.endswith('/json')
        return copy.deepcopy(containers[url.split('/')[2]])
    m.docker = docker
    def health(port, runtime):
        m.need(port == 3006 and runtime == m.RETAINED and containers[retained_id]['State']['Running'], 'health_identity')
    m.health = health
    def execute():
        cleanup = m.ResolvedFailedUploadCleanup(authority)
        try:
            prepared = cleanup.prepared()
            steps = [cleanup.step({'action': 'unlink', 'index': index, 'authority': authority}) for index in range(8)]
            return cleanup.finish({'action': 'finish', 'authority': authority}), prepared, steps
        finally: cleanup.close()
    initial_files = {filename: filename.read_bytes() for filename in root.rglob('*') if filename.is_file()}
    initial_containers = copy.deepcopy(containers)
    def remaining(): return [filename for filename in bulk if filename.exists()]
    def unchanged():
        assert len(remaining()) == 8
        assert all(filename.read_bytes() == raw for filename, raw in initial_files.items())
        assert containers == initial_containers
    def protects_survivors():
        assert all(filename.read_bytes() == raw for filename, raw in initial_files.items() if filename not in bulk)
        assert containers == initial_containers
    def stopped_mount(source):
        row = container('a' * 64, 'b' * 40, 'sha256:' + 'c' * 64, 3010)
        row['State']['Running'] = False
        row['Mounts'] = [{'Type': 'bind', 'Source': str(source), 'Destination': '/private', 'RW': False}]
        containers[row['Id']] = row
        return row['Id']
`;

function check(body) {
  const script = harness + '\n' + body.trim().split('\n').map(line => '    ' + line).join('\n') + '\n';
  const result = spawnSync('python3', ['-I', '-B', '-c', script, host], {encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
}

test('all files are hashed before eight fenced unlinks; 151, proofs, directories, Docker and physical disk observations survive', () => check(String.raw`
total = sum(filename.stat().st_size for filename in bulk)
real_sha, real_unlink = m.file_sha, m.os.unlink
hashes, unlink_hash_counts, frees = [], [], iter([10000000000, 9999999999])
def count_hash(filename): hashes.append(filename); return real_sha(filename)
def unlink(name, **kw):
    if 'dir_fd' in kw: unlink_hash_counts.append(len(hashes))
    return real_unlink(name, **kw)
m.file_sha, m.os.unlink = count_hash, unlink
m.ResolvedFailedUploadCleanup.disk_free_bytes = staticmethod(lambda: next(frees))
try: result, prepared, steps = execute()
finally: m.os.unlink = real_unlink
assert result['completed'] and result['filesDeleted'] == 8 and result['logicalBytesUnlinked'] == total
assert result['alreadyAbsentFiles'] == 0 and result['alreadyAbsentBytes'] == 0
assert result['diskFreeBytesBefore'] == 10000000000 and result['diskFreeBytesAfter'] == 9999999999
assert result['protectedFailedAttempt'] == m.RESOLVED_CLEANUP_WITNESS and result['protectedFilesVerified'] == 11
assert result['targetFailedAttempts'] == list(m.RESOLVED_CLEANUP_TARGETS)
assert len(hashes) == len(set(hashes)) == 33 and unlink_hash_counts == [33] * 8
assert prepared['targetFileBytes'] == [len(initial_files[filename]) for filename in bulk]
assert [step['index'] for step in steps] == list(range(8)) and all(step['deleted'] for step in steps)
assert all(result[key] == 0 for key in ('retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes', 'acceptedStateWrites', 'intentStateWrites'))
assert not remaining(); protects_survivors()
assert all(directory.is_dir() and (directory / 'generation').is_dir() for directory in targets)
hashes.clear(); m.ResolvedFailedUploadCleanup.disk_free_bytes = staticmethod(lambda: 123)
second, _, steps = execute()
assert second['completed'] and second['filesDeleted'] == second['logicalBytesUnlinked'] == 0
assert second['alreadyAbsentFiles'] == 8 and second['alreadyAbsentBytes'] == total
assert len(hashes) == 25 and all(step['alreadyAbsent'] for step in steps)
protects_survivors()
`));

test('idle, missing, pending, current, rollback and altered resolution cannot authorize this operation', () => check(String.raw`
for key in ('current', 'pending', 'rollback', 'commit'):
    changed = copy.deepcopy(authority); value = copy.deepcopy(accepted['value']); value[key] = {}
    changed['publicationState']['accepted'] = observe(value, accepted['etag'])
    refused(lambda: m.ResolvedFailedUploadCleanup(changed), 'resolved_empty_state')
for key in ('accepted', 'intent'):
    changed = copy.deepcopy(authority); changed['publicationState'][key] = absent()
    refused(lambda: m.ResolvedFailedUploadCleanup(changed), 'retire_observation')
for key, value, code in [('status', 'pending', 'resolved_intent'), ('nonce', 'a' * 32, 'resolved_intent'),
    ('resolution', {**intent['value']['resolution'], 'kind': 'never_reserved'}, 'resolved_resolution'),
    ('candidate', {**candidate, 'runtimeSha': '9' * 40}, 'resolved_candidate')]:
    changed = copy.deepcopy(authority); row = copy.deepcopy(intent['value']); row[key] = value
    changed['publicationState']['intent'] = observe(row, intent['etag'])
    refused(lambda: m.ResolvedFailedUploadCleanup(changed), code)
changed = copy.deepcopy(authority); changed['publicationState']['accepted']['etag'] = '"new-etag"'
refused(lambda: m.ResolvedFailedUploadCleanup(changed), 'resolved_resolution')
unchanged()
`));

test('the exact sealed rollback proof and witness predecessor binding are mandatory', () => check(String.raw`
changed = copy.deepcopy(authority)
row = changed['publicationState']['intent']['value']; row['resolution']['rollbackProof']['hostRollbackSha256'] = '0' * 64
changed['publicationState']['intent'] = observe(row, intent['etag'])
refused(lambda: m.ResolvedFailedUploadCleanup(changed), 'resolved_rollback_proof')
for folder in [witness_dir, *targets]:
    for name in ('PLAN.json', 'ROLLED_BACK.json'):
        filename = folder / name; raw = filename.read_bytes(); write(filename, raw + b' ')
        refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_proof_hash'); write(filename, raw)
changed = copy.deepcopy(authority); changed['publicationState']['accepted']['etag'] = '"replacement-etag"'
row = copy.deepcopy(intent['value']); row['resolution']['acceptedETag'] = '"replacement-etag"'
changed['publicationState']['intent'] = observe(row, intent['etag'])
refused(lambda: m.ResolvedFailedUploadCleanup(changed), 'resolved_witness_predecessor')
unchanged()
`));

test('every witness and remaining target hash is required before the first unlink', () => check(String.raw`
for filename in [witness_dir / 'generation' / 'details.sqlite', witness_dir / 'generation' / 'RECONCILIATION.json',
                 targets[0] / 'generation' / 'details.sqlite', targets[1] / 'image.tar', targets[1] / 'generation' / 'FX_RECEIPT.json']:
    raw = filename.read_bytes(); write(filename, bytes([raw[0] ^ 1]) + raw[1:])
    refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_file_hash'); write(filename, raw)
    assert len(remaining()) == 8
for folder in [witness_dir, *targets]:
    for name in ('ACCEPTED.json', 'ACCEPTED.pending'):
        filename = folder / name; filename.symlink_to(root / 'missing')
        refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_accepted_file'); filename.unlink()
unchanged()
`));

test('target symlinks, hardlinks and writable files fail closed', () => check(String.raw`
filename = bulk[0]; raw = filename.read_bytes(); filename.unlink(); filename.symlink_to(root / 'missing')
refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'regular_file'); filename.unlink(); write(filename, raw)
alias = root / 'hardlink'; os.link(filename, alias)
refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'regular_file'); alias.unlink()
filename.chmod(0o600); refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'reuse_file_permissions'); filename.chmod(0o400)
unchanged()
`));

test('running and stopped containers block mounted paths, parent paths, file aliases and candidate nonces', () => check(String.raw`
for source in [witness_dir, targets[0], targets[1] / 'generation', bulk[0], m.BASE]:
    identity = stopped_mount(source)
    refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_files_mounted'); del containers[identity]
for binding in (m.RESOLVED_CLEANUP_WITNESS, *m.RESOLVED_CLEANUP_TARGETS):
    identity = stopped_mount(root / 'unrelated'); (root / 'unrelated').mkdir(exist_ok=True)
    containers[identity]['Config']['Labels']['avtocena.china.nonce'] = binding['nonce']
    refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_candidate_exists'); del containers[identity]
alias = root / 'bind-alias'; alias.write_bytes(b'outside')
identity = stopped_mount(alias); original_stat = m.Path.stat; target_stat = bulk[0].stat()
def bind_stat(path, *args, **kwargs):
    return target_stat if path == alias else original_stat(path, *args, **kwargs)
m.Path.stat = bind_stat
try: refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_mount_inode_alias')
finally: m.Path.stat = original_stat; del containers[identity]
unchanged()
`));

test('bind aliases of every protected ancestor block cleanup without rejecting an unrelated sibling mount', () => check(String.raw`
alias = root / 'ancestor-bind-alias'; alias.mkdir()
identity = stopped_mount(alias); original_stat = m.Path.stat
for ancestor in m.BASE.parents:
    ancestor_stat = ancestor.stat()
    def bind_stat(path, *args, **kwargs):
        return ancestor_stat if path == alias else original_stat(path, *args, **kwargs)
    m.Path.stat = bind_stat
    try: refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_mount_inode_alias')
    finally: m.Path.stat = original_stat
    assert len(remaining()) == 8
del containers[identity]
# Sharing a normal parent is insufficient: the mount root itself must alias an
# ancestor, or its own parent chain must enter a protected scope.
sibling = root / 'unrelated-sibling'; sibling.mkdir(); identity = stopped_mount(sibling)
cleanup = m.ResolvedFailedUploadCleanup(authority); cleanup.close(); del containers[identity]
unchanged()
`));

test('the flock, live retained image, health and unchanged ingress fence preparation', () => check(String.raw`
held = reuse_lock()
try: refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'reuse_lock_busy')
finally: os.close(held)
image_row['Id'] = 'sha256:' + '0' * 64
refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_witness_image'); image_row['Id'] = image
containers[retained_id]['State']['Running'] = False
refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'resolved_retained'); containers[retained_id]['State']['Running'] = True
original_health = m.health
m.health = lambda *args: m.need(False, 'health_identity')
try: refused(lambda: m.ResolvedFailedUploadCleanup(authority), 'health_identity')
finally: m.health = original_health
unchanged()
`));

test('a changed REG observation or lease between calls stops the next unlink', () => check(String.raw`
cleanup = m.ResolvedFailedUploadCleanup(authority)
try:
    first = cleanup.step({'action': 'unlink', 'index': 0, 'authority': authority}); assert first['deleted']
    for field in ('lease', 'accepted', 'intent'):
        changed = copy.deepcopy(authority)
        observation = changed['lease'] if field == 'lease' else changed['publicationState'][field]
        observation['etag'] = '"replaced"'
        refused(lambda: cleanup.step({'action': 'unlink', 'index': 1, 'authority': changed}), 'resolved_authority_changed')
        assert len(remaining()) == 7
    refused(lambda: cleanup.step({'action': 'unlink', 'index': 2, 'authority': authority}), 'resolved_step')
    refused(lambda: cleanup.step({'action': 'unlink', 'index': 1, 'authority': authority, 'path': str(bulk[1])}), 'resolved_step')
    refused(lambda: cleanup.finish({'action': 'finish', 'authority': authority}), 'resolved_finish')
finally: cleanup.close()
protects_survivors()
`));

test('expiry, ingress, retained identity, mounts and proof drift are rechecked per unlink', () => check(String.raw`
cleanup = m.ResolvedFailedUploadCleanup(authority)
try:
    for field in ('expiry', 'ingress', 'retained', 'mount', 'proof'):
        if field == 'expiry': clock[0] += 3601
        elif field == 'ingress': m.CONFIG.write_bytes(ingress + b'# drift\n')
        elif field == 'retained': containers[retained_id]['State']['Pid'] += 1
        elif field == 'mount': identity = stopped_mount(bulk[1])
        else:
            filename = targets[1] / 'ROLLED_BACK.json'; saved = filename.read_bytes(); write(filename, saved + b' ')
        code = {'expiry': 'resolved_lease_expired', 'ingress': 'ingress_changed', 'retained': 'resolved_retained_changed',
            'mount': 'resolved_files_mounted', 'proof': 'resolved_proof_changed'}[field]
        refused(lambda: cleanup.step({'action': 'unlink', 'index': 0, 'authority': authority}), code)
        assert len(remaining()) == 8
        if field == 'expiry': clock[0] -= 3601
        elif field == 'ingress': m.CONFIG.write_bytes(ingress)
        elif field == 'retained': containers[retained_id]['State']['Pid'] -= 1
        elif field == 'mount': del containers[identity]
        else: write(filename, saved)
finally: cleanup.close()
unchanged()
`));

test('partial interruption resumes by counting only new unlinks and retaining all proof files', () => check(String.raw`
cleanup = m.ResolvedFailedUploadCleanup(authority)
first_bytes = len(initial_files[bulk[0]])
try:
    cleanup.step({'action': 'unlink', 'index': 0, 'authority': authority})
    clock[0] += 3601
    refused(lambda: cleanup.step({'action': 'unlink', 'index': 1, 'authority': authority}), 'resolved_lease_expired')
finally: cleanup.close(); clock[0] -= 3601
assert len(remaining()) == 7
result, prepared, steps = execute()
assert result['filesDeleted'] == 7 and result['alreadyAbsentFiles'] == 1 and result['alreadyAbsentBytes'] == first_bytes
assert result['logicalBytesUnlinked'] == sum(len(initial_files[p]) for p in bulk[1:])
assert steps[0]['alreadyAbsent'] and steps[0]['logicalBytesUnlinked'] == 0
protects_survivors()
`));

test('a disappeared or replaced file cannot be silently counted as already absent in an active session', () => check(String.raw`
cleanup = m.ResolvedFailedUploadCleanup(authority)
try:
    filename = bulk[0]; raw = filename.read_bytes(); filename.unlink(); write(filename, raw)
    refused(lambda: cleanup.step({'action': 'unlink', 'index': 0, 'authority': authority}), 'resolved_file_changed')
    assert len(remaining()) == 8
finally: cleanup.close()
unchanged()
`));

test('the dedicated protocol cannot initialize a release, bypass preparation or close unfinished', () => check(String.raw`
def protocol(calls):
    original_stdin, original_emit = sys.stdin, m.emit
    replies = []
    sys.stdin = types.SimpleNamespace(buffer=io.BytesIO(b'\n'.join(m.json_bytes(row) for row in calls) + b'\n'))
    m.emit = replies.append
    try: m.main()
    finally: sys.stdin = original_stdin; m.emit = original_emit
for next_call, code in [({'id': 2, 'method': 'init', 'params': {}}, 'resolved_protocol_scope'),
                        ({'id': 2, 'method': 'close'}, 'resolved_close_incomplete')]:
    refused(lambda: protocol([{'id': 1, 'method': 'prune_resolved_failed_uploads', 'params': params}, next_call]), code)
refused(lambda: protocol([{'id': 1, 'method': 'prune_resolved_failed_uploads', 'params': {'action': 'unlink', 'index': 0, 'authority': authority}}]), 'resolved_prepare')
unchanged()
`));
