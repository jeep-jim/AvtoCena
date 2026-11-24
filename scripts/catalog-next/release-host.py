"""One exact China runtime/data installation, preserving the serving process.

The caller sends a pinned plan and checked files over authenticated SSH. The
only shared server mutation is the application ingress compare-and-swap. No
catalog, encyclopedia, settings or another market's storage key is writable.
"""
import base64
import copy
import datetime
import fcntl
import gzip
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import time

CONFIG = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
BASE = Path('/opt/avtocena/releases')
CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
RETAINED = '56d6b94fea70457e0ce2b0820596da9972846b90'
FILE_NAMES = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json',
              'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'regcloud-performance-gate.py',
              'accepted-speed-baseline.json', 'acceptance.json'}


class ReleaseError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise ReleaseError('china_host_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def file_sha(filename):
    digest = hashlib.sha256()
    with filename.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def regular(filename, maximum=None):
    metadata = filename.lstat()
    need(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and not filename.is_symlink(), 'regular_file')
    need(filename.resolve() == filename and metadata.st_uid == 0, 'file_owner')
    if maximum is not None:
        need(metadata.st_size <= maximum, 'file_size')
    return metadata


def new_file(filename, content, mode=0o400):
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=90)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def docker(method, target, body=None):
    connection = Docker()
    try:
        connection.request(method, target, body=json_bytes(body) if body is not None else None,
                           headers={'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = response.read(16 * 1024 * 1024 + 1)
        need(len(raw) <= 16 * 1024 * 1024 and response.status in (200, 201, 204), 'docker_http_' + str(response.status))
        return json.loads(raw) if raw else None
    finally:
        connection.close()


def command(args, timeout=120):
    process = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             timeout=timeout, env={'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'})
    need(process.returncode == 0, 'command_failed')
    return process.stdout


def env_map(container):
    values = container['Config']['Env']
    need(isinstance(values, list) and all(isinstance(v, str) and '=' in v and '\n' not in v and '\r' not in v for v in values), 'environment')
    result = dict(v.split('=', 1) for v in values)
    need(len(result) == len(values), 'environment_duplicates')
    return result


def backend(raw):
    found = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', raw)
    need(len(found) == 1 and 3000 <= int(found[0]) < 4000, 'ingress_backend')
    return int(found[0])


def response_json(port, route, timeout=30):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        connection.request('GET', route, headers={'Host': 'avtocena.com', 'Accept': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        raw = response.read(20 * 1024 * 1024 + 1)
        need(response.status == 200 and len(raw) <= 20 * 1024 * 1024, 'http_response')
        return json.loads(raw)
    finally:
        connection.close()


def health(port, release):
    value = response_json(port, '/api/health', 5)
    need(value.get('ok') is True and value.get('releaseSha') == release and value.get('calculationVersion') == CALCULATION, 'health_identity')


def protected_identity(container):
    return {key: container[key] for key in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')} | {
        'Pid': container['State']['Pid'], 'StartedAt': container['State']['StartedAt'],
        'RestartCount': container['RestartCount'], 'Running': container['State']['Running']}


def validate_plan(plan):
    need(plan.get('version') == 1 and plan.get('market') == 'china' and plan.get('retainedRuntime') == RETAINED and
         plan.get('servingCalculationVersion') == CALCULATION, 'plan_scope')
    for key in ('runtimeSha', 'pricingRuntimeSha', 'runtimeTree', 'controllerSha'):
        need(re.fullmatch(r'[a-f0-9]{40}', plan.get(key, '')), 'plan_revision')
    for key in ('runtimeDiffSha256', 'generationManifestSha256', 'privateGenerationReceiptSha256', 'sourceDescriptorSha256'):
        need(re.fullmatch(r'[a-f0-9]{64}', plan.get(key, '')), 'plan_digest')
    need(re.fullmatch(r'gen_china_[1-9]\d*_[1-9]\d*', plan.get('generationId', '')) and
         re.fullmatch(r'[a-f0-9]{32}', plan.get('nonce', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', plan.get('imageId', '')), 'plan_identity')
    files = plan.get('files', [])
    need(isinstance(files, list) and {f['name'] for f in files} == FILE_NAMES and len(files) == len(FILE_NAMES), 'plan_files')
    for file in files:
        need(type(file.get('bytes')) is int and file['bytes'] > 0 and re.fullmatch(r'[a-f0-9]{64}', file.get('sha256', '')) and
             type(file.get('compressedBytes')) is int and file['compressedBytes'] > 0 and
             re.fullmatch(r'[a-f0-9]{64}', file.get('compressedSha256', '')), 'plan_file')
    need(next(f for f in files if f['name'] == 'GENERATION.json')['sha256'] == plan['generationManifestSha256'], 'plan_generation')
    need(next(f for f in files if f['name'] == 'accepted-speed-baseline.json')['sha256'] ==
         '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59', 'speed_baseline')
    previous_etag, previous_sha = plan.get('previousAcceptedETag'), plan.get('previousAcceptedStateSha256')
    need((previous_etag is None and previous_sha is None) or
         (isinstance(previous_etag, str) and re.fullmatch(r'"[^"\x00-\x20\x7f]{1,250}"', previous_etag) and
          isinstance(previous_sha, str) and re.fullmatch(r'[a-f0-9]{64}', previous_sha)), 'previous_state')


def decode_report(value):
    need(isinstance(value, str) and len(value) <= 350000, 'browser_evidence_size')
    try:
        raw = base64.b64decode(value, validate=True)
        decoded = json.loads(raw)
    except (ValueError, TypeError):
        raise ReleaseError('china_host_browser_evidence_encoding') from None
    need(0 < len(raw) <= 256 * 1024 and isinstance(decoded, dict) and base64.b64encode(raw).decode() == value,
         'browser_evidence_encoding')
    return raw, decoded


def private_directory(directory):
    need(directory.resolve() == directory and directory.is_dir() and directory.stat().st_uid == 0 and
         not directory.stat().st_mode & 0o022, 'recovery_directory')


def read_outcome(params):
    """Read only the durable result of one authenticated nonce. No inference
    from elapsed time, a missing receipt, or the current ingress is acceptance."""
    release, nonce = params.get('runtimeSha', ''), params.get('nonce', '')
    need(re.fullmatch(r'[a-f0-9]{40}', release) and re.fullmatch(r'[a-f0-9]{32}', nonce), 'recovery_identity')
    directory = BASE / release / 'china-next' / nonce
    for parent in (BASE, directory.parent.parent, directory.parent, directory):
        private_directory(parent)
    regular(directory / 'PLAN.json', 256 * 1024)
    plan = json.loads((directory / 'PLAN.json').read_bytes())
    validate_plan(plan)
    need(plan['runtimeSha'] == release and plan['nonce'] == nonce, 'recovery_plan')
    accepted, rollback = directory / 'ACCEPTED.json', directory / 'ROLLED_BACK.json'
    need(not (accepted.exists() and rollback.exists()), 'recovery_conflict')
    if accepted.exists():
        regular(accepted, 256 * 1024)
        raw = accepted.read_bytes()
        receipt = json.loads(raw)
        need(receipt.get('release') == release and receipt.get('nonce') == nonce and
             receipt.get('generationManifestSha256') == plan['generationManifestSha256'], 'recovery_receipt')
        reports = []
        for name, field in [('BROWSER_SPEED.json', 'speedReportSha256'), ('BROWSER_DETAILS.json', 'detailsReportSha256')]:
            regular(directory / name, 256 * 1024)
            report = (directory / name).read_bytes()
            need(sha(report) == receipt['browser'].get(field), 'recovery_browser')
            reports.append(report)
        need(sha(b''.join(reports)) == receipt['browser'].get('reportSha256'), 'recovery_browser')
        return {'status': 'accepted', 'hostReceiptBase64': base64.b64encode(raw).decode(), 'hostReceiptSha256': sha(raw),
                'browserSpeedBase64': base64.b64encode(reports[0]).decode(),
                'browserDetailsBase64': base64.b64encode(reports[1]).decode()}
    if rollback.exists():
        regular(rollback, 256 * 1024)
        raw = rollback.read_bytes()
        receipt = json.loads(raw)
        need(receipt.get('release') == release and receipt.get('nonce') == nonce and
             receipt.get('generationManifestSha256') == plan['generationManifestSha256'], 'recovery_receipt')
        return {'status': 'rolled_back', 'hostRollbackBase64': base64.b64encode(raw).decode(), 'hostRollbackSha256': sha(raw)}
    return {'status': 'pending'}


class Host:
    def __init__(self, plan):
        validate_plan(plan)
        self.plan = plan
        self.directory = BASE / plan['runtimeSha'] / 'china-next' / plan['nonce']
        need(BASE.resolve() == BASE and BASE.is_dir() and BASE.stat().st_uid == 0 and not BASE.stat().st_mode & 0o022, 'release_root')
        for parent in (self.directory.parent.parent, self.directory.parent):
            parent.mkdir(mode=0o700, exist_ok=True)
            need(parent.resolve() == parent and parent.is_dir() and parent.stat().st_uid == 0 and stat.S_IMODE(parent.stat().st_mode) == 0o700, 'release_parent')
        self.directory.mkdir(mode=0o700)
        new_file(self.directory / 'PLAN.json', json_bytes(plan))
        self.generation = self.directory / 'generation'
        self.generation.mkdir(mode=0o700)
        self.uploaded = set()
        self.candidate = None
        self.switched = False
        self.accepted = False
        self.functional_passed = False
        self.speed_passed = False
        self.verdict_deadline = None
        self.lock = None
        self.original = self.proposed = None
        self.retained = None
        self.restart = 'no'

    def file_path(self, name):
        return (self.generation if name in {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                                            'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'} else self.directory) / name

    def upload(self, name, stream):
        need(name in FILE_NAMES and name not in self.uploaded and not self.candidate, 'upload_scope')
        descriptor = next(f for f in self.plan['files'] if f['name'] == name)
        packed = self.directory / (name + '.incoming.gz')
        digest = hashlib.sha256()
        fd = os.open(packed, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as target:
            remaining = descriptor['compressedBytes']
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                need(chunk, 'upload_incomplete')
                target.write(chunk)
                digest.update(chunk)
                remaining -= len(chunk)
            target.flush()
            os.fsync(target.fileno())
        need(digest.hexdigest() == descriptor['compressedSha256'], 'upload_checksum')
        filename = self.file_path(name)
        digest = hashlib.sha256()
        total = 0
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(fd, 'wb') as target, gzip.open(packed, 'rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                total += len(chunk)
                need(total <= descriptor['bytes'], 'decoded_size')
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        need(total == descriptor['bytes'] and digest.hexdigest() == descriptor['sha256'], 'decoded_checksum')
        need(file_sha(filename) == descriptor['sha256'], 'local_readback')
        packed.unlink()
        self.uploaded.add(name)
        return {'file': name, 'bytes': total, 'verified': True}

    def guard(self):
        need(self.lock is not None and self.retained is not None, 'not_locked')
        current = docker('GET', '/containers/' + self.retained['Id'] + '/json')
        need(protected_identity(current) == self.retained_identity, 'retained_changed')
        regular(CONFIG, 1024 * 1024)
        need(CONFIG.read_bytes() == (self.proposed if self.switched else self.original), 'ingress_changed')
        health(self.old_port, RETAINED)

    def start(self):
        need(self.uploaded == FILE_NAMES and self.candidate is None, 'upload_not_complete')
        self.lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        info = os.fstat(self.lock)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'runtime_lock')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        regular(CONFIG, 1024 * 1024)
        self.original = CONFIG.read_bytes()
        self.old_port = backend(self.original)
        rows = docker('GET', '/containers/json?all=1')
        inspected = [docker('GET', '/containers/' + row['Id'] + '/json') for row in rows]
        serving = [row for row in inspected if any(str(binding.get('HostPort', '')) == str(self.old_port)
                   for bindings in (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings)]
        need(len(serving) == 1, 'serving_container')
        self.retained = serving[0]
        env = env_map(self.retained)
        need(env.get('AVTOCENA_RELEASE_SHA') == RETAINED and env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
             self.retained['State']['Running'] and not self.retained['HostConfig']['Privileged'], 'serving_identity')
        need(self.retained['Config'].get('WorkingDir') == '/app' and self.retained['Config'].get('User', '') in ('', 'root', '0'), 'serving_config')
        mounts = self.retained.get('Mounts', [])
        need(mounts and all(row.get('Type') == 'bind' and row.get('RW') is False and
             row.get('Destination') != '/var/run/docker.sock' for row in mounts), 'serving_mounts')
        private = [row for row in mounts if row['Destination'] == '/app/data/knowledge/encyclopedia/calculation-v1.json']
        need(len(private) == 1 and file_sha(Path(private[0]['Source'])) ==
             '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c', 'encyclopedia_unchanged')
        self.retained_identity = protected_identity(self.retained)
        self.guard()
        claimed = {int(binding['HostPort']) for row in inspected for bindings in
                   (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings
                   if str(binding.get('HostPort', '')).isdigit()}
        ports = [port for port in range(3004, 3011) if port not in claimed]
        need(ports, 'candidate_port_unavailable')
        self.port = ports[0]
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(('127.0.0.1', self.port))
        info = docker('GET', '/info')
        need(info.get('ServerVersion') == '29.1.3' and
             ['driver-type', 'io.containerd.snapshotter.v1'] in info.get('DriverStatus', []), 'image_store')
        command(['/usr/bin/docker', 'load', '--input', str(self.directory / 'image.tar')], timeout=900)
        image = docker('GET', '/images/' + self.plan['imageId'] + '/json')
        need(image.get('Id') == self.plan['imageId'] and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64' and
             image['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == self.plan['runtimeSha'], 'image_identity')
        generation = json.loads((self.generation / 'GENERATION.json').read_bytes())
        need(generation.get('generationId') == self.plan['generationId'] and generation.get('runtimeSha') == self.plan['pricingRuntimeSha'] and
             generation.get('prepared') is True and generation.get('source', {}).get('supplierLatestVerified') is True, 'generation_identity')
        env.update(AVTOCENA_RELEASE_SHA=self.plan['runtimeSha'], AVTOCENA_BUILD_CALCULATION_VERSION=generation['calculationVersion'],
                   CATALOG_CHINA_LOCAL_GENERATION_DIR='/run/avtocena-china-generation',
                   CATALOG_CHINA_LOCAL_MANIFEST_SHA256=self.plan['generationManifestSha256'],
                   CATALOG_CHINA_LOCAL_RUNTIME_SHA=self.plan['pricingRuntimeSha'])
        binds = [row['Source'] + ':' + row['Destination'] + ':ro' for row in mounts]
        need(not any(row['Destination'] == '/run/avtocena-china-generation' for row in mounts), 'generation_mount_collision')
        binds.append(str(self.generation) + ':/run/avtocena-china-generation:ro')
        self.spec = {'Image': self.plan['imageId'], 'WorkingDir': '/app',
                     'Entrypoint': copy.deepcopy(self.retained['Config']['Entrypoint']),
                     'Cmd': copy.deepcopy(self.retained['Config']['Cmd']),
                     'Env': [key + '=' + value for key, value in sorted(env.items())],
                     'Labels': {'avtocena.application': 'web', 'avtocena.role': 'independent-china',
                                'org.opencontainers.image.revision': self.plan['runtimeSha'], 'avtocena.china.nonce': self.plan['nonce']},
                     'ExposedPorts': {'3000/tcp': {}},
                     'HostConfig': {'Privileged': False, 'NetworkMode': 'bridge', 'Binds': binds,
                                    'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(self.port)}]},
                                    'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}}}
        self.guard()
        name = 'avtocena-china-next-' + self.plan['runtimeSha'][:12] + '-' + self.plan['nonce'][:8]
        created = docker('POST', '/containers/create?name=' + name, self.spec)
        self.candidate = created.get('Id')
        need(re.fullmatch(r'[a-f0-9]{64}', self.candidate or ''), 'candidate_identity')
        docker('POST', '/containers/' + self.candidate + '/start')
        deadline = time.monotonic() + 120
        while True:
            try:
                health(self.port, self.plan['runtimeSha'])
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise ReleaseError('china_host_candidate_startup') from None
                time.sleep(1)
        self.verify_candidate()
        return {'started': True, 'release': self.plan['runtimeSha'], 'generationId': self.plan['generationId']}

    def verify_candidate(self):
        self.guard()
        row = docker('GET', '/containers/' + self.candidate + '/json')
        need(row['Id'] == self.candidate and row['Image'] == self.plan['imageId'] and row['State']['Running'] and
             row['RestartCount'] == 0 and row['Config']['Env'] == self.spec['Env'] and row['Config']['Cmd'] == self.spec['Cmd'] and
             row['Config']['Entrypoint'] == self.spec['Entrypoint'] and row['HostConfig']['Binds'] == self.spec['HostConfig']['Binds'] and
             row['HostConfig']['PortBindings'] == self.spec['HostConfig']['PortBindings'] and not row['HostConfig']['Privileged'] and
             row['HostConfig']['RestartPolicy']['Name'] == self.restart, 'candidate_changed')
        health(self.port, self.plan['runtimeSha'])

    def functional(self):
        self.verify_candidate()
        oracle = json.loads((self.directory / 'acceptance.json').read_bytes())
        need(oracle.get('version') == 1 and oracle.get('runtimeSha') == self.plan['runtimeSha'] and
             oracle.get('generationManifestSha256') == self.plan['generationManifestSha256'], 'oracle_identity')
        checked = []
        for case in oracle['cases']:
            need(case['path'].startswith('/api/catalog/search?') and 'market=china' in case['path'], 'oracle_route')
            started = time.monotonic()
            value = response_json(self.port, case['path'])
            need(value.get('ok') is not False and not any(value.get(key) for key in ('partial', 'stale', 'interrupted', 'countIncomplete')),
                 'incomplete_search')
            need(value.get('total') == case['total'] and [row['id'] for row in value.get('items', [])] == case['ids'], 'search_oracle')
            need([row.get('totalRub') for row in value['items']] == case['totalRub'], 'price_oracle')
            checked.append({'name': case['name'], 'total': case['total'], 'items': len(case['ids']),
                            'seconds': round(time.monotonic() - started, 4)})
        need(len(checked) >= 8, 'oracle_coverage')
        self.functional_passed = True
        return {'functionalPassed': True, 'cases': checked}

    def speed(self):
        self.verify_candidate()
        # Reuse the unchanged accepted baseline and its complete warm/expired
        # response checks, scoped to China and shared integrity routes.
        env = {'PATH': '/usr/bin:/bin', 'AVTOCENA_RELEASE_MARKETS': 'china', 'AVTOCENA_SPEED_BASELINE_MODE': 'enforce',
               'AVTOCENA_SPEED_BASELINE': str(self.directory / 'accepted-speed-baseline.json')}
        process = subprocess.run(['/usr/bin/python3', '-I', '-B', str(self.directory / 'regcloud-performance-gate.py'),
                                  'http://127.0.0.1:' + str(self.port), self.plan['runtimeSha']],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=1500)
        rows = []
        for line in process.stdout.splitlines():
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    rows.append(value)
            except ValueError:
                pass
        new_file(self.directory / 'server-speed-result.json', json_bytes({'exitCode': process.returncode, 'samples': rows}))
        need(process.returncode == 0, 'server_speed_failed')
        self.verify_candidate()
        self.speed_passed = True
        return {'speedPassed': True, 'samples': rows}

    def replace_config(self, expected, wanted):
        regular(CONFIG, 1024 * 1024)
        need(CONFIG.read_bytes() == expected, 'ingress_compare_failed')
        old_stat = CONFIG.stat()
        temporary = CONFIG.with_name(CONFIG.name + '.china-' + self.plan['nonce'])
        new_file(temporary, wanted, stat.S_IMODE(old_stat.st_mode))
        need(CONFIG.read_bytes() == expected, 'ingress_compare_failed')
        os.replace(temporary, CONFIG)
        command(['/usr/sbin/nginx', '-t'])
        command(['/usr/bin/systemctl', 'reload', 'nginx'])

    def switch(self):
        need(self.functional_passed and self.speed_passed and not self.switched and not self.accepted, 'switch_before_checks')
        self.verify_candidate()
        needle = b'proxy_pass http://127.0.0.1:' + str(self.old_port).encode() + b';'
        need(self.original.count(needle) == 1, 'ingress_replace_scope')
        self.proposed = self.original.replace(needle, b'proxy_pass http://127.0.0.1:' + str(self.port).encode() + b';')
        # Mark before the mutation so a failed validation/reload still restores.
        self.switched = True
        self.verdict_deadline = time.monotonic() + 900
        self.replace_config(self.original, self.proposed)
        self.verify_candidate()
        return {'switched': True, 'nonce': self.plan['nonce'], 'release': self.plan['runtimeSha']}

    def accept(self, verdict):
        need(self.switched and self.functional_passed and self.speed_passed and not self.accepted, 'accept_before_switch')
        need(self.verdict_deadline is not None and time.monotonic() <= self.verdict_deadline, 'browser_deadline')
        self.verify_candidate()
        need(verdict.get('release') == self.plan['runtimeSha'] and verdict.get('nonce') == self.plan['nonce'] and
             verdict.get('passed') is True and verdict.get('functionalPassed') is True and verdict.get('speedPassed') is True and
             all(re.fullmatch(r'[a-f0-9]{64}', verdict.get(key, '')) for key in
                 ('reportSha256', 'speedReportSha256', 'detailsReportSha256')), 'browser_verdict')
        reports = []
        for name, field in [('BROWSER_SPEED.json', 'speedReportSha256'), ('BROWSER_DETAILS.json', 'detailsReportSha256')]:
            regular(self.directory / name, 256 * 1024)
            raw = (self.directory / name).read_bytes()
            need(sha(raw) == verdict[field], 'browser_evidence_hash')
            reports.append(raw)
        need(sha(b''.join(reports)) == verdict['reportSha256'], 'browser_evidence_hash')
        docker('POST', '/containers/' + self.candidate + '/update', {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}})
        self.restart = 'unless-stopped'
        self.verify_candidate()
        generation_bytes = (self.generation / 'GENERATION.json').read_bytes()
        need(sha(generation_bytes) == self.plan['generationManifestSha256'], 'accepted_generation_changed')
        generation = json.loads(generation_bytes)
        accepted_at = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
        proof = {'version': 1, 'kind': 'china-host-acceptance-v1', 'release': self.plan['runtimeSha'],
                 'generationId': self.plan['generationId'], 'generationManifestSha256': self.plan['generationManifestSha256'],
                 'privateGenerationReceiptSha256': self.plan['privateGenerationReceiptSha256'],
                 'sourceDescriptorSha256': self.plan['sourceDescriptorSha256'], 'imageId': self.plan['imageId'],
                 'pricingRuntimeSha': generation['runtimeSha'], 'sourceCursor': generation['source']['cursor'], 'sourceObservedAt': generation['source']['sourceObservedAt'],
                 'nonce': self.plan['nonce'], 'browser': verdict, 'acceptedAt': accepted_at, 'retainedContainerId': self.retained['Id']}
        encoded = json_bytes(proof)
        # The durable receipt is the commit point, including when SSH closes
        # immediately after the atomic rename. No partial terminal receipt is
        # visible, and deferred cancellation runs only after accepted is set.
        self.acceptance_receipt_sha = sha(encoded)
        pending = self.directory / 'ACCEPTED.pending'
        terminal = self.directory / 'ACCEPTED.json'
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGHUP, signal.SIGALRM})
        try:
            need(not terminal.exists() and not (self.directory / 'ROLLED_BACK.json').exists(), 'acceptance_terminal_exists')
            new_file(pending, encoded)
            os.replace(pending, terminal)
            self.accepted = True
            directory_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
        return {'accepted': True, 'release': self.plan['runtimeSha'], 'pricingRuntimeSha': self.plan['pricingRuntimeSha'], 'generationId': self.plan['generationId'],
                'generationManifestSha256': self.plan['generationManifestSha256'], 'sourceDescriptorSha256': self.plan['sourceDescriptorSha256'],
                'privateGenerationReceiptSha256': self.plan['privateGenerationReceiptSha256'], 'imageId': self.plan['imageId'],
                'hostReceiptSha256': sha(encoded), 'hostReceiptBase64': base64.b64encode(encoded).decode(),
                'acceptedAt': accepted_at, 'nonce': self.plan['nonce'],
                'browserReportSha256': verdict['reportSha256'],
                'encyclopediaWrites': 0, 'otherMarketWrites': 0, 'retainedRuntime': RETAINED}

    def browser_evidence(self, params):
        need(self.switched and not self.accepted and self.verdict_deadline is not None and
             time.monotonic() <= self.verdict_deadline, 'browser_evidence_phase')
        self.verify_candidate()
        speed_raw, speed = decode_report(params.get('speedBase64'))
        details_raw, details = decode_report(params.get('detailsBase64'))
        need(speed.get('release') == self.plan['runtimeSha'] and speed.get('passed') is True and
             speed.get('browserPassed') is True and speed.get('speedGuard', {}).get('passed') is True and
             details.get('kind') == 'china-browser-details-v1' and details.get('passed') is True and
             details.get('release') == self.plan['runtimeSha'] and details.get('nonce') == self.plan['nonce'] and
             details.get('generationManifestSha256') == self.plan['generationManifestSha256'] and
             details.get('precedingSpeedReportSha256') == sha(speed_raw), 'browser_evidence_binding')
        for name, raw in [('BROWSER_SPEED.json', speed_raw), ('BROWSER_DETAILS.json', details_raw)]:
            new_file(self.directory / name, raw)
            need(file_sha(self.directory / name) == sha(raw), 'browser_evidence_readback')
        return {'saved': True, 'speedReportSha256': sha(speed_raw), 'detailsReportSha256': sha(details_raw)}

    def cleanup(self):
        terminal = self.directory / 'ACCEPTED.json'
        if not self.accepted and terminal.exists():
            # Also covers a non-signal exception after rename and before the
            # in-memory flag. A valid terminal acceptance is never rolled back.
            regular(terminal, 256 * 1024)
            need(getattr(self, 'acceptance_receipt_sha', None) == file_sha(terminal), 'acceptance_terminal_changed')
            self.accepted = True
        if self.accepted:
            return
        if self.switched:
            # Restore only our exact ingress edit; never overwrite a stranger's.
            current = CONFIG.read_bytes()
            if current == self.proposed:
                self.replace_config(self.proposed, self.original)
            else:
                need(current == self.original, 'rollback_ingress_changed')
            health(self.old_port, RETAINED)
            self.switched = False
        if self.candidate:
            row = docker('GET', '/containers/' + self.candidate + '/json')
            need(row['Config']['Labels'].get('avtocena.china.nonce') == self.plan['nonce'], 'cleanup_foreign_container')
            if row['State']['Running']:
                docker('POST', '/containers/' + self.candidate + '/stop?t=10')
            docker('DELETE', '/containers/' + self.candidate + '?v=false&force=false')
            self.candidate = None
        if self.retained is not None and self.original is not None and self.lock is not None and hasattr(self, 'retained_identity'):
            self.guard()
            proof = {'version': 1, 'kind': 'china-host-rollback-v1', 'nonce': self.plan['nonce'],
                     'release': self.plan['runtimeSha'], 'pricingRuntimeSha': self.plan['pricingRuntimeSha'],
                     'generationId': self.plan['generationId'], 'generationManifestSha256': self.plan['generationManifestSha256'],
                     'privateGenerationReceiptSha256': self.plan['privateGenerationReceiptSha256'],
                     'sourceDescriptorSha256': self.plan['sourceDescriptorSha256'], 'imageId': self.plan['imageId'],
                     'previousAcceptedETag': self.plan.get('previousAcceptedETag'),
                     'previousAcceptedStateSha256': self.plan.get('previousAcceptedStateSha256'),
                     'rolledBackAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
                     'retainedContainerId': self.retained['Id'], 'retainedRuntimeSha': RETAINED,
                     'retainedImageId': self.retained['Image'], 'retainedRunning': True,
                     'ingressRestored': True, 'candidateRemoved': True}
            if not (self.directory / 'ROLLED_BACK.json').exists():
                new_file(self.directory / 'ROLLED_BACK.json', json_bytes(proof))


def main():
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_terminated')))
    signal.signal(signal.SIGHUP, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_disconnected')))
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_browser_deadline')))
    host = None
    recovered = False
    emit({'kind': 'ready', 'protocol': 1})
    try:
        while True:
            if host and host.switched and not host.accepted:
                remaining = host.verdict_deadline - time.monotonic()
                need(remaining > 0, 'browser_deadline')
                signal.setitimer(signal.ITIMER_REAL, remaining)
            try:
                raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
            need(raw and len(raw) <= 1024 * 1024, 'protocol_input')
            call = json.loads(raw)
            identity, method = call['id'], call['method']
            need(type(identity) is int and identity > 0, 'protocol_id')
            params = call.get('params', {})
            if method == 'recover':
                need(host is None, 'recovery_after_init')
                value = read_outcome(params)
                recovered = True
            elif method == 'close' and host is None:
                need(recovered, 'close_uninitialized')
                emit({'kind': 'result', 'id': identity, 'value': {'closed': True, 'readOnly': True}})
                return
            elif method == 'init':
                need(host is None, 'already_initialized')
                host = Host(params['plan'])
                value = {'initialized': True}
            else:
                need(host is not None, 'not_initialized')
                if method == 'upload':
                    emit({'kind': 'upload-ready', 'id': identity})
                    value = host.upload(params['name'], sys.stdin.buffer)
                elif method == 'start':
                    value = host.start()
                elif method == 'functional':
                    value = host.functional()
                elif method == 'speed':
                    value = host.speed()
                elif method == 'switch':
                    value = host.switch()
                elif method == 'accept':
                    value = host.accept(params['verdict'])
                elif method == 'browser_evidence':
                    value = host.browser_evidence(params)
                elif method == 'close':
                    need(host.accepted, 'close_unaccepted')
                    emit({'kind': 'result', 'id': identity, 'value': {'closed': True, 'accepted': True}})
                    return
                else:
                    raise ReleaseError('china_host_unknown_method')
            emit({'kind': 'result', 'id': identity, 'value': value})
    except BaseException as error:
        # A transport failure may send TERM/HUP immediately after this error.
        # Rollback must finish even when the controller has already gone away.
        signal.setitimer(signal.ITIMER_REAL, 0)
        for cancellation in (signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
            signal.signal(cancellation, signal.SIG_IGN)
        code = str(error) if isinstance(error, ReleaseError) else 'china_host_operation_failed'
        try:
            emit({'kind': 'error', 'id': locals().get('identity'), 'code': code})
        except (BrokenPipeError, OSError):
            pass
        raise
    finally:
        if host:
            try:
                host.cleanup()
            finally:
                if host.lock is not None:
                    os.close(host.lock)


if __name__ == '__main__':
    main()
