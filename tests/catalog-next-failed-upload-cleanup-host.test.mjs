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
    witness = dict(m.FAILED_UPLOAD_WITNESS)
    pricing, image, retained_image, retained_id = witness['pricingRuntimeSha'], witness['imageId'], 'sha256:' + '6' * 64, '8' * 64
    generation = {'version': 1, 'kind': 'china-local-generation-v1', 'market': 'china',
        'generationId': m.FAILED_UPLOAD_GENERATION, 'runtimeSha': pricing, 'prepared': True,
        'source': {'cursor': 100, 'sourceObservedAt': '2026-11-23T12:00:00Z', 'supplierLatestVerified': True}}
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
            'generationManifestSha256': m.sha(generation_bytes), 'privateGenerationReceiptSha256': witness['privateGenerationReceiptSha256'],
            'sourceDescriptorSha256': '9' * 64, 'previousAcceptedETag': None, 'previousAcceptedStateSha256': None, 'files': []}
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
            'candidateRemoved': True, 'ingressRestored': True, 'retainedContainerId': retained_id, 'retainedImageId': retained_image}
        write(directory / 'ROLLED_BACK.json', m.json_bytes(rollback))
        return directory, plan
    witness_dir, witness_plan = create_cut(witness['runtimeSha'], witness['nonce'], image)
    witness_files = [filename for filename in witness_dir.rglob('*') if filename.is_file() and filename.name not in ('PLAN.json', 'ROLLED_BACK.json')]
    assert len(witness_files) == 11
    # Only fixture digests differ; source/runtime/image and deletion scopes remain exact.
    m.FAILED_UPLOAD_WITNESS = {**witness, 'planSha256': m.file_sha(witness_dir / 'PLAN.json'),
        'rollbackSha256': m.file_sha(witness_dir / 'ROLLED_BACK.json'), 'generationManifestSha256': m.sha(generation_bytes)}
    params = {'publicationState': {'accepted': absent(), 'intent': absent()}, 'leaseExpiresAt': '2026-11-24T21:00:00Z'}
    targets, targets_binding, bulk = [], [], []
    for target in m.FAILED_UPLOAD_TARGETS:
        directory, plan = create_cut(m.FAILED_UPLOAD_RUNTIME, target['nonce'], 'sha256:' + '4' * 64)
        targets_binding.append({'nonce': plan['nonce'], 'planSha256': m.file_sha(directory / 'PLAN.json'),
            'rollbackSha256': m.file_sha(directory / 'ROLLED_BACK.json')})
        targets.append(directory)
        bulk.extend((directory if name == 'image.tar' else directory / 'generation') / name for name in m.FAILED_UPLOAD_BULK_FILES)
    m.FAILED_UPLOAD_TARGETS = tuple(targets_binding)
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

test('only eight old bulk files are deleted; live56, the full 5e witness, proofs, images and directories survive', () => check(`
total = sum(filename.stat().st_size for filename in bulk)
real_sha = m.file_sha; hashes = []
def count_hash(filename): hashes.append(filename); return real_sha(filename)
m.file_sha = count_hash
result = m.prune_failed_uploads(params)
assert result['completed'] and result['filesDeleted'] == 8 and result['freedBytes'] == total and result['alreadyAbsentFiles'] == 0
assert result['phase'] == 'before-first-acceptance' and result['liveRuntimeSha'] == m.RETAINED
assert result['protectedFailedAttempt'] == m.FAILED_UPLOAD_WITNESS and result['protectedFilesVerified'] == 11
assert result['targetRuntimeSha'] == m.FAILED_UPLOAD_RUNTIME
assert set(hashes) == set(witness_files + bulk) and len(hashes) == 19, 'one bulk hash pass, not per unlink'
assert all(result[key] == 0 for key in ('retiredContainers', 'imagesDeleted', 'directoriesDeleted', 'privateGenerationDeletes', 'acceptedStateWrites', 'intentStateWrites'))
assert len(remaining()) == 0; protects_survivors()
assert all(directory.is_dir() and (directory / 'generation').is_dir() for directory in targets)
hashes.clear(); second = m.prune_failed_uploads(params)
assert second['completed'] and second['filesDeleted'] == 0 and second['freedBytes'] == 0 and second['alreadyAbsentFiles'] == 8
assert set(hashes) == set(witness_files) and len(hashes) == 11
protects_survivors()
`));

test('only exact absent accepted and intent observations authorize cleanup', () => check(`
for name in ('accepted', 'intent'):
    for changed in ({'found': True}, {'found': 0}, {'value': {}}, {'etag': '"present"'}, {'extra': None}):
        bad = copy.deepcopy(params); bad['publicationState'][name].update(changed)
        refused(lambda: m.prune_failed_uploads(bad), 'prune_unaccepted_state')
bad = copy.deepcopy(params); bad['leaseExpiresAt'] = '2026-11-24T19:59:00Z'; refused(lambda: m.prune_failed_uploads(bad), 'prune_lease')
refused(lambda: m.prune_failed_uploads(dict(params, path='/unreviewed')), 'prune_parameters')
unchanged()
`));

test('exact old and protected witness PLAN/rollback bytes cannot be replaced', () => check(`
for directory, code in [(targets[0], 'prune_proof_hash'), (witness_dir, 'prune_witness_proof')]:
    for name in ('PLAN.json', 'ROLLED_BACK.json'):
        filename = directory / name; raw = filename.read_bytes(); write(filename, raw + b' ')
        refused(lambda: m.prune_failed_uploads(params), code); write(filename, raw)
unchanged()
`));

test('accepted or pending entries, including dangling symlinks, protect all three attempts', () => check(`
for directory, code in [(targets[0], 'prune_accepted_target'), (witness_dir, 'prune_witness_accepted')]:
    for name in ('ACCEPTED.json', 'ACCEPTED.pending'):
        filename = directory / name
        write(filename, b'{}'); refused(lambda: m.prune_failed_uploads(params), code); filename.unlink()
        filename.symlink_to(root / 'missing'); refused(lambda: m.prune_failed_uploads(params), code); filename.unlink()
unchanged()
`));

test('stopped mounts on old targets or protected witness ancestors, descendants and aliases forbid cleanup', () => check(`
for directory in (targets[0], witness_dir):
    alias = root / 'alias'; alias.symlink_to(directory, target_is_directory=True)
    for source in (directory.parent, directory, directory / 'generation', directory / 'generation/details.sqlite', alias):
        identity = stopped_mount(source); refused(lambda: m.prune_failed_uploads(params), 'prune_files_mounted'); del containers[identity]
    alias.unlink()
unchanged()
`));

test('any old or protected candidate nonce prevents pruning without a mount', () => check(`
for nonce in (m.FAILED_UPLOAD_TARGETS[1]['nonce'], witness['nonce']):
    identity = stopped_mount(root / 'unrelated'); containers[identity]['Config']['Labels']['avtocena.china.nonce'] = nonce
    refused(lambda: m.prune_failed_uploads(params), 'prune_candidate_exists'); del containers[identity]
unchanged()
`));

test('symlink, hardlink, writable or corrupt old and witness files refuse all deletion', () => check(`
for filename, code in [(bulk[-1], 'prune_file_hash'), (witness_dir / 'generation/details.sqlite', 'prune_witness_hash')]:
    raw = filename.read_bytes(); filename.unlink(); filename.symlink_to(bulk[0])
    refused(lambda: m.prune_failed_uploads(params), 'regular_file'); filename.unlink(); write(filename, raw)
    link = root / 'hard-link'; os.link(filename, link)
    refused(lambda: m.prune_failed_uploads(params), 'regular_file'); link.unlink()
    filename.chmod(0o600); refused(lambda: m.prune_failed_uploads(params), 'reuse_file_permissions'); filename.chmod(0o400)
    write(filename, bytes([raw[0] ^ 1]) + raw[1:]); refused(lambda: m.prune_failed_uploads(params), code); write(filename, raw)
unchanged()
`));

test('every one of the eleven protected files is hashed before old files can be deleted', () => check(`
for filename in witness_files:
    raw = filename.read_bytes(); write(filename, bytes([raw[0] ^ 1]) + raw[1:])
    refused(lambda: m.prune_failed_uploads(params), 'prune_witness_hash'); write(filename, raw)
unchanged()
`));

test('the protected image must still be present with the exact runtime identity', () => check(`
image_row['Config']['Labels']['org.opencontainers.image.revision'] = m.FAILED_UPLOAD_RUNTIME
refused(lambda: m.prune_failed_uploads(params), 'prune_witness_image')
image_row['Config']['Labels']['org.opencontainers.image.revision'] = witness['runtimeSha']; unchanged()
`));

test('changed live runtime, ingress, witness acceptance, inode or expiry after hashing blocks the first unlink', () => check(`
real_sha = m.file_sha
for mutation, code in (('container', 'prune_protected_changed'), ('ingress', 'ingress_changed'),
        ('acceptance', 'prune_witness_accepted'), ('proof', 'prune_witness_proof'),
        ('witness_inode', 'prune_witness_changed'), ('old_inode', 'prune_file_changed'), ('lease', 'prune_lease_expired')):
    proof = witness_dir / 'ROLLED_BACK.json'; proof_raw = proof.read_bytes()
    def during_hash(filename):
        digest = real_sha(filename)
        if filename == bulk[-1]:
            if mutation == 'container': containers[retained_id]['State']['Pid'] += 1
            if mutation == 'ingress': m.CONFIG.write_bytes(ingress + b' ')
            if mutation == 'acceptance': write(witness_dir / 'ACCEPTED.json', b'{}')
            if mutation == 'proof': write(proof, proof_raw + b' ')
            if mutation in ('witness_inode', 'old_inode'):
                target = witness_dir / 'generation/details.sqlite' if mutation == 'witness_inode' else bulk[0]
                replacement = target.with_suffix('.replacement'); write(replacement, target.read_bytes()); replacement.replace(target)
            if mutation == 'lease': clock[0] += 7200
        return digest
    m.file_sha = during_hash
    refused(lambda: m.prune_failed_uploads(params), code)
    containers.clear(); containers.update(copy.deepcopy(initial_containers)); m.CONFIG.write_bytes(ingress)
    (witness_dir / 'ACCEPTED.json').unlink(missing_ok=True); write(proof, proof_raw)
    clock[0] = epoch; m.file_sha = real_sha; unchanged()
`));

test('a protected file changed after the first unlink stops the remaining seven', () => check(`
real_unlink = pathlib.Path.unlink; changed = [False]; filename = witness_dir / 'generation/query.sqlite'; raw = filename.read_bytes()
def mutate_after_first(target, *args, **kwargs):
    result = real_unlink(target, *args, **kwargs)
    if target in bulk and not changed[0]: changed[0] = True; write(filename, bytes([raw[0] ^ 1]) + raw[1:])
    return result
pathlib.Path.unlink = mutate_after_first
try: refused(lambda: m.prune_failed_uploads(params), 'prune_witness_changed')
finally: pathlib.Path.unlink = real_unlink
assert len(remaining()) == 7; write(filename, raw); protects_survivors()
result = m.prune_failed_uploads(params); assert result['filesDeleted'] == 7 and result['alreadyAbsentFiles'] == 1
protects_survivors()
`));

test('partial unlink interruption resumes without counting absent bytes or changing publication state', () => check(`
real_unlink = pathlib.Path.unlink; deleted = [0]
def interrupted(filename, *args, **kwargs):
    if filename in bulk:
        if deleted[0] == 1: raise OSError('simulated connection lost after first unlink')
        deleted[0] += 1
    return real_unlink(filename, *args, **kwargs)
pathlib.Path.unlink = interrupted
try:
    try: m.prune_failed_uploads(params)
    except OSError: pass
    else: raise AssertionError('interruption not observed')
finally: pathlib.Path.unlink = real_unlink
assert len(remaining()) == 7; protects_survivors()
rest = sum(filename.stat().st_size for filename in remaining()); result = m.prune_failed_uploads(params)
assert result['filesDeleted'] == 7 and result['freedBytes'] == rest and result['alreadyAbsentFiles'] == 1
protects_survivors()
`));

test('the existing runtime flock excludes overlapping host operations', () => check(`
held = reuse_lock()
try: refused(lambda: m.prune_failed_uploads(params), 'reuse_lock_busy')
finally: os.close(held)
unchanged()
`));

test('pruning cannot transition into init or another release method on its stream', () => check(String.raw`
packets = []; m.emit = packets.append
m.sys.stdin = types.SimpleNamespace(buffer=io.BytesIO(b'\n'.join(m.json_bytes(row) for row in [
    {'id': 1, 'method': 'prune_failed_uploads', 'params': params}, {'id': 2, 'method': 'init', 'params': {}}]) + b'\n'))
refused(m.main, 'prune_protocol_scope')
assert any(row.get('kind') == 'result' and row.get('value', {}).get('completed') for row in packets)
assert any(row.get('kind') == 'error' and row.get('code') == 'china_host_prune_protocol_scope' for row in packets), packets
protects_survivors()
`));
