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
from urllib.parse import urlencode

CONFIG = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
BASE = Path('/opt/avtocena/releases')
CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
RETAINED = '56d6b94fea70457e0ce2b0820596da9972846b90'
FILE_NAMES = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json',
              'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'regcloud-performance-gate.py',
              'accepted-speed-baseline.json', 'acceptance.json'}
GENERATION_MOUNT = '/run/avtocena-china-generation'
HOST_BULK_FILES = {'details.sqlite', 'query.sqlite', 'DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json',
                   'FX_RECEIPT.json', 'RECONCILIATION.json', 'image.tar'}


class ReleaseError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise ReleaseError('china_host_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def canonical_sha(value):
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode())


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


def generation_update(plan):
    return plan.get('mode') == 'generation-update'


def expected_files(plan):
    return FILE_NAMES - {'image.tar'} if generation_update(plan) else FILE_NAMES


def retained_runtime(plan):
    return plan.get('retainedRuntime', RETAINED)


def accepted_reference_receipt(reference):
    need(isinstance(reference, dict), 'predecessor_reference')
    proof = reference.get('proof')
    need(reference.get('market') == 'china' and isinstance(proof, dict) and
         proof.get('kind') == 'china-accepted-proof-v1', 'predecessor_proof')
    raw, receipt = decode_report(proof.get('hostReceiptBase64'))
    need(len(raw) <= 48 * 1024 and sha(raw) == proof.get('hostReceiptSha256') and
         receipt.get('version') == 1 and receipt.get('kind') == 'china-host-acceptance-v1' and
         re.fullmatch(r'[a-f0-9]{32}', receipt.get('nonce', '')), 'predecessor_proof_hash')
    bindings = {'runtimeSha': 'release', 'pricingRuntimeSha': 'pricingRuntimeSha', 'imageId': 'imageId',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'receiptSha256': 'privateGenerationReceiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256',
                'sourceCursor': 'sourceCursor', 'sourceObservedAt': 'sourceObservedAt'}
    need(all(reference.get(left) == receipt.get(right) and left in reference and right in receipt
             for left, right in bindings.items()), 'predecessor_reference')
    return receipt, raw


def accepted_predecessor(plan):
    """Authenticate the exact supplied state observation against its retained
    host receipt. Local receipt and mounted-generation checks happen at start."""
    state = plan.get('previousAcceptedState')
    need(isinstance(state, dict) and state.get('version') == 1 and
         state.get('kind') == 'china-accepted-state-v1' and state.get('market') == 'china' and
         type(state.get('revision')) is int and state['revision'] > 0 and state.get('pending') is None and
         isinstance(state.get('current'), dict), 'predecessor_state')
    need(canonical_sha(state) == plan.get('previousAcceptedStateSha256') and
         isinstance(plan.get('previousAcceptedETag'), str), 'predecessor_state_hash')
    reference = state['current']
    receipt, raw = accepted_reference_receipt(reference)
    commit = state.get('commit')
    need(isinstance(commit, dict) and commit.get('nonce') == receipt['nonce'] and
         commit.get('acceptedAt') == receipt.get('acceptedAt'), 'predecessor_commit')
    need(plan.get('retainedRuntime') == reference.get('runtimeSha') and
         all(plan.get(key) == reference.get(key) for key in ('runtimeSha', 'pricingRuntimeSha', 'imageId')) and
         plan.get('generationId') != reference.get('generationId') and plan.get('nonce') != receipt['nonce'],
         'data_only_identity')
    return reference, receipt, raw


def validate_plan(plan):
    need(plan.get('mode') in (None, 'generation-update'), 'plan_mode')
    need(plan.get('version') == 1 and plan.get('market') == 'china' and
         (generation_update(plan) or plan.get('retainedRuntime') == RETAINED) and
         plan.get('servingCalculationVersion') == CALCULATION, 'plan_scope')
    for key in ('runtimeSha', 'pricingRuntimeSha', 'runtimeTree', 'controllerSha'):
        need(re.fullmatch(r'[a-f0-9]{40}', plan.get(key, '')), 'plan_revision')
    for key in ('runtimeDiffSha256', 'generationManifestSha256', 'privateGenerationReceiptSha256', 'sourceDescriptorSha256'):
        need(re.fullmatch(r'[a-f0-9]{64}', plan.get(key, '')), 'plan_digest')
    need(re.fullmatch(r'gen_china_[1-9]\d*_[1-9]\d*', plan.get('generationId', '')) and
         re.fullmatch(r'[a-f0-9]{32}', plan.get('nonce', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', plan.get('imageId', '')), 'plan_identity')
    files = plan.get('files', [])
    required = expected_files(plan)
    need(isinstance(files, list) and {f['name'] for f in files} == required and len(files) == len(required), 'plan_files')
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
    if generation_update(plan):
        accepted_predecessor(plan)
    else:
        need('previousAcceptedState' not in plan, 'unexpected_predecessor')


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


def diagnosis_json(filename):
    """Only bounded metadata is read here; never checksum the uploaded databases."""
    before = regular(filename, 256 * 1024)
    raw = filename.read_bytes()
    after = regular(filename, 256 * 1024)
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'diagnosis_file_changed')
    value = json.loads(raw)
    need(isinstance(value, dict), 'diagnosis_json')
    return value, raw


def diagnosis_events(plan, since, until):
    """Docker's bounded historical event buffer may outlive a removed container.
    Return only fixed event names, times, numeric exit codes and OOM flags."""
    actions = {'create', 'start', 'die', 'oom', 'stop', 'kill', 'destroy', 'restart'}
    filters = {'type': ['container'], 'label': ['avtocena.china.nonce=' + plan['nonce'],
               'org.opencontainers.image.revision=' + plan['runtimeSha']], 'event': sorted(actions)}
    target = '/events?' + urlencode({'since': str(since), 'until': str(until), 'filters': json.dumps(filters)})
    connection = Docker()
    connection.timeout = 15
    try:
        connection.request('GET', target)
        response = connection.getresponse()
        raw = response.read(1024 * 1024 + 1)
        need(response.status == 200 and len(raw) <= 1024 * 1024, 'diagnosis_events_response')
        rows = []
        for line in raw.splitlines():
            value = json.loads(line)
            attributes = value.get('Actor', {}).get('Attributes', {})
            action, when = value.get('Action'), value.get('time')
            need(value.get('Type') == 'container' and action in actions and type(when) is int and since <= when <= until and
                 attributes.get('avtocena.china.nonce') == plan['nonce'] and
                 attributes.get('org.opencontainers.image.revision') == plan['runtimeSha'], 'diagnosis_event_scope')
            exit_code = attributes.get('exitCode')
            need(exit_code is None or (isinstance(exit_code, str) and re.fullmatch(r'-?\d{1,8}', exit_code)),
                 'diagnosis_event_exit')
            rows.append({'action': action, 'time': when, 'exitCode': int(exit_code) if exit_code is not None else None,
                         'oom': action == 'oom'})
            need(len(rows) <= 512, 'diagnosis_events_bound')
        return {'available': True, 'reason': None if rows else 'empty', 'rows': rows}
    except Exception:
        # No Docker response, daemon error, arbitrary label or raw log escapes.
        return {'available': False, 'reason': 'unavailable', 'rows': []}
    finally:
        connection.close()


def diagnose_startup(params):
    """Inspect exactly one failed first-release upload. No init, start, stop,
    file write, application request, state mutation or image load is reachable."""
    keys = {'runtimeSha', 'pricingRuntimeSha', 'generationId', 'generationManifestSha256',
            'controllerSha', 'imageId', 'since', 'until'}
    need(isinstance(params, dict) and set(params) == keys, 'diagnosis_selector')
    for name in ('runtimeSha', 'pricingRuntimeSha', 'controllerSha'):
        need(isinstance(params[name], str) and re.fullmatch(r'[a-f0-9]{40}', params[name]), 'diagnosis_selector')
    need(re.fullmatch(r'gen_china_[1-9]\d*_[1-9]\d*', params.get('generationId', '')) and
         re.fullmatch(r'[a-f0-9]{64}', params.get('generationManifestSha256', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', params.get('imageId', '')), 'diagnosis_selector')
    times = []
    for name in ('since', 'until'):
        need(isinstance(params[name], str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', params[name]),
             'diagnosis_window')
        times.append(int(datetime.datetime.fromisoformat(params[name].replace('Z', '+00:00')).timestamp()))
    since, until = times
    need(0 < until - since <= 300 and until <= int(time.time()), 'diagnosis_window')
    parent = BASE / params['runtimeSha'] / 'china-next'
    for directory in (BASE, parent.parent, parent):
        private_directory(directory)
    children = list(parent.iterdir())
    need(len(children) <= 200, 'diagnosis_directory_bound')
    matches = []
    for directory in children:
        if not re.fullmatch(r'[a-f0-9]{32}', directory.name):
            continue
        private_directory(directory)
        plan_file = directory / 'PLAN.json'
        if not plan_file.exists():
            continue
        plan, raw = diagnosis_json(plan_file)
        if all(plan.get(key) == params[key] for key in keys - {'since', 'until'}):
            validate_plan(plan)
            need(not generation_update(plan) and plan['nonce'] == directory.name, 'diagnosis_plan')
            matches.append((directory, plan, raw))
    need(len(matches) == 1, 'diagnosis_unique_plan')
    directory, plan, plan_raw = matches[0]
    need(not (directory / 'ACCEPTED.json').exists() and not (directory / 'ACCEPTED.pending').exists(), 'diagnosis_accepted')
    rollback, rollback_raw = diagnosis_json(directory / 'ROLLED_BACK.json')
    bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'imageId': 'imageId', 'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256',
                'sourceDescriptorSha256': 'sourceDescriptorSha256'}
    need(rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1' and
         all(rollback.get(left) == plan[right] for left, right in bindings.items()) and
         rollback.get('retainedRuntimeSha') == RETAINED and rollback.get('retainedRunning') is True and
         rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True and
         re.fullmatch(r'[a-f0-9]{64}', rollback.get('retainedContainerId', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', rollback.get('retainedImageId', '')), 'diagnosis_rollback')
    generation_directory = directory / 'generation'
    private_directory(generation_directory)
    generation, generation_raw = diagnosis_json(generation_directory / 'GENERATION.json')
    need(sha(generation_raw) == plan['generationManifestSha256'] and generation.get('generationId') == plan['generationId'] and
         generation.get('runtimeSha') == plan['pricingRuntimeSha'] and generation.get('prepared') is True, 'diagnosis_generation')
    generation_names = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                        'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'}
    files = []
    for descriptor in plan['files']:
        filename = (generation_directory if descriptor['name'] in generation_names else directory) / descriptor['name']
        try:
            info = regular(filename)
        except FileNotFoundError:
            files.append({'name': descriptor['name'], 'present': False, 'bytes': None, 'expectedBytes': descriptor['bytes'],
                          'sizeMatches': False, 'private': False})
            continue
        files.append({'name': descriptor['name'], 'present': True, 'bytes': info.st_size, 'expectedBytes': descriptor['bytes'],
                      'sizeMatches': info.st_size == descriptor['bytes'], 'private': stat.S_IMODE(info.st_mode) == 0o400})
    regular(CONFIG, 1024 * 1024)
    ingress = CONFIG.read_bytes()
    retained = docker('GET', '/containers/' + rollback['retainedContainerId'] + '/json')
    identity = protected_identity(retained)
    env = env_map(retained)
    need(retained.get('Image') == rollback['retainedImageId'] and retained['State']['Running'] is True and
         env.get('AVTOCENA_RELEASE_SHA') == RETAINED and env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
         any(str(binding.get('HostPort', '')) == str(backend(ingress)) for bindings in
             (retained.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings),
         'diagnosis_retained')
    try:
        image = docker('GET', '/images/' + plan['imageId'] + '/json')
        image_result = {'present': True, 'identityMatches': image.get('Id') == plan['imageId'] and image.get('Os') == 'linux' and
                        image.get('Architecture') == 'amd64' and
                        image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == plan['runtimeSha']}
    except ReleaseError as error:
        if str(error) != 'china_host_docker_http_404':
            raise
        image_result = {'present': False, 'identityMatches': False}
    filter_query = urlencode({'filters': json.dumps({'label': ['avtocena.china.nonce=' + plan['nonce']]})})
    containers = docker('GET', '/containers/json?all=1&' + filter_query)
    need(isinstance(containers, list) and len(containers) <= 1, 'diagnosis_candidates')
    candidate = {'present': False, 'running': None, 'status': None, 'exitCode': None, 'oomKilled': None}
    if containers:
        row = docker('GET', '/containers/' + containers[0]['Id'] + '/json')
        labels = row.get('Config', {}).get('Labels', {})
        state = row.get('State', {})
        need(row.get('Image') == plan['imageId'] and labels.get('avtocena.china.nonce') == plan['nonce'] and
             labels.get('org.opencontainers.image.revision') == plan['runtimeSha'] and
             labels.get('avtocena.role') == 'independent-china' and type(state.get('Running')) is bool and
             type(state.get('ExitCode')) is int and type(state.get('OOMKilled')) is bool and
             state.get('Status') in {'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'}, 'diagnosis_candidate')
        candidate = {'present': True, 'running': state['Running'], 'status': state['Status'],
                     'exitCode': state['ExitCode'], 'oomKilled': state['OOMKilled']}
    events = diagnosis_events(plan, since, until)
    need(CONFIG.read_bytes() == ingress and
         protected_identity(docker('GET', '/containers/' + retained['Id'] + '/json')) == identity,
         'diagnosis_retained_changed')
    need(diagnosis_json(directory / 'PLAN.json')[1] == plan_raw and
         diagnosis_json(directory / 'ROLLED_BACK.json')[1] == rollback_raw and not (directory / 'ACCEPTED.json').exists(),
         'diagnosis_changed')
    disk = os.statvfs(BASE)
    free_bytes = disk.f_bavail * disk.f_frsize
    need(type(free_bytes) is int and 0 <= free_bytes <= 9007199254740991, 'diagnosis_disk_capacity')
    return {'version': 1, 'kind': 'china-host-startup-diagnosis-v1', 'readOnly': True, 'selector': dict(params),
            'nonce': plan['nonce'], 'planSha256': sha(plan_raw), 'rollbackSha256': sha(rollback_raw), 'outcome': 'rolled_back',
            'files': files, 'generationVerified': True, 'image': image_result, 'diskFreeBytes': free_bytes,
            'retained': {'identityConfirmed': True, 'running': True}, 'candidate': candidate, 'events': events}


def check_mounted_reference(container, reference, nonce, *, require_running=True):
    env = env_map(container)
    running = container.get('State', {}).get('Running')
    need(container.get('Image') == reference['imageId'] and type(running) is bool and (running or not require_running) and
         env.get('AVTOCENA_RELEASE_SHA') == reference['runtimeSha'] and
         env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
         env.get('CATALOG_CHINA_LOCAL_RUNTIME_SHA') == reference['pricingRuntimeSha'] and
         env.get('CATALOG_CHINA_LOCAL_MANIFEST_SHA256') == reference['generationManifestSha256'] and
         env.get('CATALOG_CHINA_LOCAL_GENERATION_DIR') == GENERATION_MOUNT and
         container['Config'].get('Labels', {}).get('avtocena.china.nonce') == nonce, 'mounted_reference')
    mounts = [row for row in container.get('Mounts', []) if row.get('Destination') == GENERATION_MOUNT]
    directory = BASE / reference['runtimeSha'] / 'china-next' / nonce / 'generation'
    need(len(mounts) == 1 and mounts[0].get('Type') == 'bind' and mounts[0].get('RW') is False and
         mounts[0].get('Source') == str(directory), 'mounted_generation')
    return generation_reference(reference, nonce)


def generation_reference(reference, nonce):
    directory = BASE / reference['runtimeSha'] / 'china-next' / nonce / 'generation'
    for parent in (BASE, directory.parent.parent.parent, directory.parent.parent, directory.parent):
        private_directory(parent)
    private_directory(directory)
    filename = directory / 'GENERATION.json'
    regular(filename, 256 * 1024)
    raw = filename.read_bytes()
    need(sha(raw) == reference['generationManifestSha256'], 'mounted_generation_hash')
    generation = json.loads(raw)
    need(generation.get('generationId') == reference['generationId'] and
         generation.get('runtimeSha') == reference['pricingRuntimeSha'] and generation.get('prepared') is True and
         generation.get('source', {}).get('cursor') == reference['sourceCursor'] and
         generation.get('source', {}).get('sourceObservedAt') == reference['sourceObservedAt'], 'mounted_generation_identity')
    return generation


def verify_live_reference(reference, nonce):
    """A historical receipt is not evidence that its cut is still serving."""
    regular(CONFIG, 1024 * 1024)
    ingress = CONFIG.read_bytes()
    port = backend(ingress)
    rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
    serving = [row for row in rows if any(str(binding.get('HostPort', '')) == str(port)
               for bindings in (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings)]
    need(len(serving) == 1, 'serving_container')
    current = serving[0]
    identity = protected_identity(current)
    check_mounted_reference(current, reference, nonce)
    health(port, reference['runtimeSha'])
    need(CONFIG.read_bytes() == ingress and
         protected_identity(docker('GET', '/containers/' + current['Id'] + '/json')) == identity, 'recovery_serving_changed')
    return current


def read_outcome(params, *, verify_current=True):
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
        if generation_update(plan) and verify_current:
            need(receipt.get('generationId') == plan['generationId'] and receipt.get('pricingRuntimeSha') == plan['pricingRuntimeSha'] and
                 receipt.get('imageId') == plan['imageId'], 'recovery_receipt')
            verify_live_reference({'runtimeSha': release, 'pricingRuntimeSha': plan['pricingRuntimeSha'],
                'imageId': plan['imageId'], 'generationId': plan['generationId'],
                'generationManifestSha256': plan['generationManifestSha256'],
                'sourceCursor': receipt['sourceCursor'], 'sourceObservedAt': receipt['sourceObservedAt']}, nonce)
        return {'status': 'accepted', 'hostReceiptBase64': base64.b64encode(raw).decode(), 'hostReceiptSha256': sha(raw),
                'browserSpeedBase64': base64.b64encode(reports[0]).decode(),
                'browserDetailsBase64': base64.b64encode(reports[1]).decode()}
    if rollback.exists():
        regular(rollback, 256 * 1024)
        raw = rollback.read_bytes()
        receipt = json.loads(raw)
        need(receipt.get('release') == release and receipt.get('nonce') == nonce and
             receipt.get('generationManifestSha256') == plan['generationManifestSha256'], 'recovery_receipt')
        if generation_update(plan) and verify_current:
            previous, previous_receipt, _ = accepted_predecessor(plan)
            need(receipt.get('retainedRuntimeSha') == previous['runtimeSha'] and
                 receipt.get('retainedImageId') == previous['imageId'] and
                 receipt.get('previousAcceptedETag') == plan['previousAcceptedETag'] and
                 receipt.get('previousAcceptedStateSha256') == plan['previousAcceptedStateSha256'], 'recovery_rollback')
            verify_live_reference(previous, previous_receipt['nonce'])
        return {'status': 'rolled_back', 'hostRollbackBase64': base64.b64encode(raw).decode(), 'hostRollbackSha256': sha(raw)}
    return {'status': 'pending'}


def checked_observation(observation, *, allow_absent=False):
    need(isinstance(observation, dict) and type(observation.get('found')) is bool, 'retire_observation')
    if not observation['found']:
        need(allow_absent and all(observation.get(key) is None for key in ('value', 'etag', 'sha256')), 'retire_observation')
        return None
    need(isinstance(observation.get('etag'), str) and re.fullmatch(r'"[^"\x00-\x20\x7f]{1,250}"', observation['etag']) and
         isinstance(observation.get('sha256'), str) and re.fullmatch(r'[a-f0-9]{64}', observation['sha256']) and
         isinstance(observation.get('value'), dict) and canonical_sha(observation['value']) == observation['sha256'], 'retire_observation')
    return observation['value']


def checked_accepted_observation(observation):
    state = checked_observation(observation)
    need(state.get('version') == 1 and state.get('kind') == 'china-accepted-state-v1' and state.get('market') == 'china' and
         type(state.get('revision')) is int and state['revision'] > 0 and state.get('pending') is None, 'retire_state')
    receipt, _ = accepted_reference_receipt(state.get('current'))
    commit = state.get('commit')
    need(isinstance(commit, dict) and commit.get('nonce') == receipt['nonce'] and
         commit.get('acceptedAt') == receipt.get('acceptedAt') and
         isinstance(commit.get('intentSha256'), str) and re.fullmatch(r'[a-f0-9]{64}', commit['intentSha256']), 'retire_commit')
    if state.get('rollback') is not None:
        accepted_reference_receipt(state['rollback'])
        need(state['rollback']['generationId'] != state['current']['generationId'], 'retire_protected')
    return state


def checked_publication_view(view, *, committed=False):
    need(isinstance(view, dict), 'retire_view')
    state = checked_accepted_observation(view.get('accepted'))
    intent = checked_observation(view.get('intent'), allow_absent=not committed)
    if intent is None:
        return state, None
    need(intent.get('version') == 1 and intent.get('kind') == 'china-publication-intent-v1' and intent.get('market') == 'china' and
         type(intent.get('revision')) is int and intent['revision'] > 0 and
         re.fullmatch(r'[a-f0-9]{32}', intent.get('nonce', '')) and
         intent.get('status') in (('committed',) if committed else ('committed', 'aborted')), 'retire_intent')
    resolution = intent.get('resolution')
    need(isinstance(resolution, dict) and resolution.get('acceptedETag') == view['accepted']['etag'] and
         resolution.get('acceptedSha256') == view['accepted']['sha256'], 'retire_intent_resolution')
    if intent['status'] == 'committed':
        commit = state['commit']
        original = {**intent, 'status': 'pending', 'resolution': None}
        candidate = {key: value for key, value in state['current'].items() if key != 'proof'}
        prior = intent.get('previous')
        prior_value = checked_observation(prior, allow_absent=True)
        need(resolution.get('kind') == 'accepted' and
             resolution.get('hostReceiptSha256') == state['current']['proof']['hostReceiptSha256'] and
             commit['nonce'] == intent['nonce'] and commit['intentSha256'] == canonical_sha(original) and
             commit.get('previousETag') == prior['etag'] and commit.get('previousStateSha256') == prior['sha256'] and
             candidate == intent.get('candidate') and state.get('rollback') == (prior_value.get('current') if prior_value else None),
             'retire_intent_binding')
    else:
        need(resolution.get('kind') in ('never_reserved', 'rolled_back') and
             resolution.get('hostReceiptSha256') is None, 'retire_intent_resolution')
    return state, intent


def reference_plan(reference, receipt):
    directory = BASE / reference['runtimeSha'] / 'china-next' / receipt['nonce']
    for parent in (BASE, directory.parent.parent, directory.parent, directory):
        private_directory(parent)
    regular(directory / 'PLAN.json', 256 * 1024)
    plan = json.loads((directory / 'PLAN.json').read_bytes())
    validate_plan(plan)
    bindings = {'runtimeSha': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha', 'imageId': 'imageId',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'receiptSha256': 'privateGenerationReceiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256'}
    need(plan.get('nonce') == receipt['nonce'] and all(reference[left] == plan.get(right) for left, right in bindings.items()),
         'retire_plan_binding')
    return directory, plan


def verified_history(reference, previous=None):
    receipt, raw = accepted_reference_receipt(reference)
    outcome = read_outcome({'runtimeSha': reference['runtimeSha'], 'nonce': receipt['nonce']}, verify_current=False)
    need(outcome.get('status') == 'accepted' and outcome.get('hostReceiptBase64') == base64.b64encode(raw).decode() and
         outcome.get('hostReceiptSha256') == sha(raw), 'retire_history')
    _, plan = reference_plan(reference, receipt)
    if previous is not None:
        need(generation_update(plan) and plan.get('previousAcceptedState') == previous['value'] and
             plan.get('previousAcceptedETag') == previous['etag'] and
             plan.get('previousAcceptedStateSha256') == previous['sha256'], 'retire_original_plan')
    return receipt


def collect_local_generation_files(reference, receipt, assert_current):
    directory, plan = reference_plan(reference, receipt)
    generation_reference(reference, receipt['nonce'])
    descriptors = [row for row in plan['files'] if row['name'] in HOST_BULK_FILES]
    plan_sha = file_sha(directory / 'PLAN.json')
    def fence():
        assert_current()
        for parent in (BASE, directory.parent.parent, directory.parent, directory, directory / 'generation'):
            private_directory(parent)
        regular(directory / 'PLAN.json', 256 * 1024)
        need(file_sha(directory / 'PLAN.json') == plan_sha, 'retire_plan_changed')
        rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
        for row in rows:
            for mount in row.get('Mounts', []):
                source = mount.get('Source')
                if not source:
                    continue
                need(isinstance(source, str) and Path(source).is_absolute(), 'retire_mount_path')
                mounted = Path(source).resolve()
                need(mounted != directory and mounted not in directory.parents and directory not in mounted.parents,
                     'retire_files_mounted')
    deleted = freed = 0
    for descriptor in descriptors:
        fence()
        filename = (directory if descriptor['name'] == 'image.tar' else directory / 'generation') / descriptor['name']
        try:
            filename.lstat()
        except FileNotFoundError:
            continue
        before = regular(filename)
        need(before.st_size == descriptor['bytes'] and file_sha(filename) == descriptor['sha256'], 'retire_file_hash')
        fence()
        after = regular(filename)
        need(all(getattr(before, name) == getattr(after, name) for name in
                 ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')), 'retire_file_changed')
        filename.unlink()
        parent_fd = os.open(filename.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        need(not filename.exists(), 'retire_file_still_present')
        deleted += 1
        freed += descriptor['bytes']
    fence()
    # Also make a previous interrupted unlink durable when this attempt found
    # the file already absent (including image.tar in the nonce directory).
    for parent in (directory, directory / 'generation'):
        parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    return {'filesDeleted': deleted, 'freedBytes': freed}


def retire_reference(obsolete, protected_references, protected_ids, assert_current):
    """One immutable task target. Its pinned bulk files are removed only after
    its process and every mount reference are gone; proofs and images remain."""
    assert_current()
    result = {'retiredContainers': 0, 'directoriesDeleted': 0, 'imagesDeleted': 0, 'filesDeleted': 0, 'freedBytes': 0}
    if obsolete is None:
        return {**result, 'reason': 'no_previous_rollback'}
    protected = {reference['generationId'] for reference in protected_references if reference}
    need(obsolete.get('market') == 'china' and obsolete.get('runtimeSha') != RETAINED and
         obsolete.get('generationId') not in protected, 'retire_protected')
    old_receipt = verified_history(obsolete)
    rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
    targets = [row for row in rows if row['Config'].get('Labels', {}).get('avtocena.china.nonce') == old_receipt['nonce']]
    if not targets:
        return {**result, **collect_local_generation_files(obsolete, old_receipt, assert_current), 'reason': 'already_absent'}
    need(len(targets) == 1, 'retire_ambiguous')
    target = targets[0]
    need(target['Id'] not in protected_ids and target['Config'].get('Labels', {}).get('avtocena.application') == 'web' and
         target['Config'].get('Labels', {}).get('avtocena.role') == 'independent-china', 'retire_foreign')
    check_mounted_reference(target, obsolete, old_receipt['nonce'], require_running=False)
    identity = protected_identity(target)
    assert_current()
    need(protected_identity(docker('GET', '/containers/' + target['Id'] + '/json')) == identity, 'retire_target_changed')
    if target['State']['Running']:
        docker('POST', '/containers/' + target['Id'] + '/stop?t=10')
    stopped = docker('GET', '/containers/' + target['Id'] + '/json')
    check_mounted_reference(stopped, obsolete, old_receipt['nonce'], require_running=False)
    need(not stopped['State']['Running'] and all(stopped[key] == target[key] for key in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')),
         'retire_target_changed')
    assert_current()
    docker('DELETE', '/containers/' + target['Id'] + '?v=false&force=false')
    assert_current()
    return {**result, **collect_local_generation_files(obsolete, old_receipt, assert_current),
            'retiredContainers': 1, 'generationId': obsolete['generationId']}


def retire_recovery(params):
    """Authenticated retry of one queued post-commit cleanup. The caller holds
    the China lease and sends fresh pinned accepted/intent observations. This
    function takes the host lock but never initializes a candidate or a nonce
    directory. All eligibility comes from the original committed witness."""
    previous_observation = params.get('previousAccepted')
    previous = checked_accepted_observation(previous_observation)
    original_view = params.get('acceptedPublication')
    original, original_intent = checked_publication_view(original_view, committed=True)
    need(original_intent['previous'] == previous_observation and
         original['revision'] == previous['revision'] + 2 and original.get('rollback') == previous['current'], 'retire_successor')
    fresh, _ = checked_publication_view(params.get('currentState'))
    need(fresh['revision'] >= original['revision'], 'retire_state_older')
    obsolete = previous.get('rollback')
    protected = [fresh['current'], fresh.get('rollback')]
    need(obsolete is None or all(reference is None or reference['generationId'] != obsolete['generationId'] for reference in protected),
         'retire_protected')
    lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        metadata = os.fstat(lock)
        need(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1, 'runtime_lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verified_history(previous['current'])
        verified_history(original['current'], previous_observation)
        current_receipt = verified_history(fresh['current'])
        current = verify_live_reference(fresh['current'], current_receipt['nonce'])
        ingress = CONFIG.read_bytes()
        guarded = [(current, fresh['current'], current_receipt['nonce'])]
        if fresh.get('rollback') is not None:
            rollback_receipt = verified_history(fresh['rollback'])
            rows = [docker('GET', '/containers/' + item['Id'] + '/json') for item in docker('GET', '/containers/json?all=1')]
            rollback = [row for row in rows if row['Config'].get('Labels', {}).get('avtocena.china.nonce') == rollback_receipt['nonce']]
            need(len(rollback) == 1 and rollback[0]['Id'] != current['Id'], 'retire_rollback')
            check_mounted_reference(rollback[0], fresh['rollback'], rollback_receipt['nonce'])
            guarded.append((rollback[0], fresh['rollback'], rollback_receipt['nonce']))
        identities = {row['Id']: protected_identity(row) for row, _, _ in guarded}
        def assert_current():
            regular(CONFIG, 1024 * 1024)
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')
            for row, reference, nonce in guarded:
                actual = docker('GET', '/containers/' + row['Id'] + '/json')
                need(protected_identity(actual) == identities[row['Id']], 'retire_protected_changed')
                check_mounted_reference(actual, reference, nonce)
            health(backend(ingress), fresh['current']['runtimeSha'])
            need(CONFIG.read_bytes() == ingress, 'ingress_changed')
        return retire_reference(obsolete, protected, set(identities), assert_current)
    finally:
        os.close(lock)


def reuse_lock():
    lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(lock)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'runtime_lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return lock
    except BaseException:
        os.close(lock)
        raise


def reuse_file_identity(filename):
    info = regular(filename)
    need(stat.S_IMODE(info.st_mode) == 0o400, 'reuse_file_permissions')
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def reuse_copy_file(source, target, descriptor, identity):
    """A new private inode, never a hard link, with verified source and readback.
    Only this invocation's incomplete new file is removed on a copy failure."""
    need(reuse_file_identity(source) == identity, 'reuse_source_changed')
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    target_fd = None
    created = False
    try:
        source_stat = os.fstat(source_fd)
        need((source_stat.st_dev, source_stat.st_ino, source_stat.st_size,
              source_stat.st_mtime_ns, source_stat.st_ctime_ns) == identity, 'reuse_source_changed')
        target_fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        created = True
        digest = hashlib.sha256()
        total = 0
        with os.fdopen(target_fd, 'wb') as output:
            target_fd = None
            while True:
                block = os.read(source_fd, 1024 * 1024)
                if not block:
                    break
                total += len(block)
                need(total <= descriptor['bytes'], 'reuse_copy_size')
                digest.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        need(total == descriptor['bytes'] and digest.hexdigest() == descriptor['sha256'], 'reuse_copy_hash')
        need(reuse_file_identity(source) == identity, 'reuse_source_changed')
        copied = reuse_file_identity(target)
        need(copied[:2] != identity[:2] and copied[2] == descriptor['bytes'] and
             file_sha(target) == descriptor['sha256'] and reuse_file_identity(target) == copied, 'reuse_copy_readback')
    except BaseException:
        if target_fd is not None:
            os.close(target_fd)
        # The caller supplies an absent path below its newly created private
        # nonce. Existing files are never unlinked by this helper.
        if created and target.exists():
            regular(target)
            target.unlink()
        raise
    finally:
        os.close(source_fd)


def resume_failed_upload(params):
    """Copy one pinned, fully rolled-back first release into a fresh nonce.
    The installed image is reused; all publication gates remain in Host.start
    and its existing methods. No original byte, receipt or container is changed."""
    need(isinstance(params, dict) and set(params) == {'source', 'nonce', 'controllerSha',
         'previousAcceptedETag', 'previousAcceptedStateSha256'}, 'reuse_parameters')
    source = params.get('source')
    need(isinstance(source, dict) and set(source) == {'runtimeSha', 'nonce', 'planSha256', 'rollbackSha256'} and
         re.fullmatch(r'[a-f0-9]{40}', source.get('runtimeSha', '')) and
         re.fullmatch(r'[a-f0-9]{32}', source.get('nonce', '')) and
         all(re.fullmatch(r'[a-f0-9]{64}', source.get(key, '')) for key in ('planSha256', 'rollbackSha256')) and
         re.fullmatch(r'[a-f0-9]{32}', params.get('nonce', '')) and params['nonce'] != source['nonce'] and
         re.fullmatch(r'[a-f0-9]{40}', params.get('controllerSha', '')), 'reuse_identity')
    old_directory = BASE / source['runtimeSha'] / 'china-next' / source['nonce']
    for directory in (BASE, old_directory.parent.parent, old_directory.parent, old_directory, old_directory / 'generation'):
        private_directory(directory)
    old_plan, old_plan_raw = diagnosis_json(old_directory / 'PLAN.json')
    validate_plan(old_plan)
    need(not generation_update(old_plan) and old_plan['runtimeSha'] == source['runtimeSha'] and
         old_plan['nonce'] == source['nonce'] and sha(old_plan_raw) == source['planSha256'], 'reuse_plan')
    need(not (old_directory / 'ACCEPTED.json').exists() and not (old_directory / 'ACCEPTED.pending').exists(), 'reuse_accepted')
    rollback, rollback_raw = diagnosis_json(old_directory / 'ROLLED_BACK.json')
    bindings = {'nonce': 'nonce', 'release': 'runtimeSha', 'pricingRuntimeSha': 'pricingRuntimeSha', 'imageId': 'imageId',
                'generationId': 'generationId', 'generationManifestSha256': 'generationManifestSha256',
                'privateGenerationReceiptSha256': 'privateGenerationReceiptSha256', 'sourceDescriptorSha256': 'sourceDescriptorSha256'}
    need(sha(rollback_raw) == source['rollbackSha256'] and rollback.get('version') == 1 and
         rollback.get('kind') == 'china-host-rollback-v1' and all(rollback.get(left) == old_plan[right] for left, right in bindings.items()) and
         rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True and
         rollback.get('retainedRunning') is True and rollback.get('retainedRuntimeSha') == RETAINED and
         re.fullmatch(r'[a-f0-9]{64}', rollback.get('retainedContainerId', '')) and
         re.fullmatch(r'sha256:[a-f0-9]{64}', rollback.get('retainedImageId', '')), 'reuse_rollback')
    need(all(params[key] == old_plan.get(key) for key in ('previousAcceptedETag', 'previousAcceptedStateSha256')),
         'reuse_state_changed')
    plan = {**copy.deepcopy(old_plan), 'nonce': params['nonce'], 'controllerSha': params['controllerSha'], 'reuseSource': dict(source)}
    validate_plan(plan)
    directory = old_directory.parent / plan['nonce']
    generation_names = {'GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
                        'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson'}
    source_path = lambda name: (old_directory / 'generation' if name in generation_names else old_directory) / name
    target_path = lambda name: (directory / 'generation' if name in generation_names else directory) / name
    identities = {row['name']: reuse_file_identity(source_path(row['name'])) for row in plan['files']}
    need(all(identities[row['name']][2] == row['bytes'] for row in plan['files']), 'reuse_source_size')
    total_bytes = sum(row['bytes'] for row in plan['files'])
    copy_proof = {'version': 1, 'kind': 'china-host-local-reuse-v1', 'source': source,
                  'planSha256': sha(json_bytes(plan)), 'copiedFiles': len(plan['files']), 'copiedBytes': total_bytes}
    lock = reuse_lock()
    host = None
    try:
        regular(CONFIG, 1024 * 1024)
        ingress = CONFIG.read_bytes()
        retained = docker('GET', '/containers/' + rollback['retainedContainerId'] + '/json')
        retained_identity = protected_identity(retained)
        retained_env = env_map(retained)
        need(retained['Image'] == rollback['retainedImageId'] and retained['State']['Running'] is True and
             retained_env.get('AVTOCENA_RELEASE_SHA') == RETAINED and retained_env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
             any(str(binding.get('HostPort', '')) == str(backend(ingress)) for bindings in
                 (retained.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings), 'reuse_retained')
        image = docker('GET', '/images/' + plan['imageId'] + '/json')
        need(image.get('Id') == plan['imageId'] and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64' and
             image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == plan['runtimeSha'], 'reuse_image')
        def fence():
            need(CONFIG.read_bytes() == ingress and
                 protected_identity(docker('GET', '/containers/' + retained['Id'] + '/json')) == retained_identity,
                 'reuse_retained_changed')
            need(diagnosis_json(old_directory / 'PLAN.json')[1] == old_plan_raw and
                 diagnosis_json(old_directory / 'ROLLED_BACK.json')[1] == rollback_raw and
                 not (old_directory / 'ACCEPTED.json').exists() and not (old_directory / 'ACCEPTED.pending').exists(), 'reuse_source_changed')
            rows = docker('GET', '/containers/json?all=1')
            need(isinstance(rows, list) and len(rows) <= 1024, 'reuse_containers')
            for item in rows:
                row = docker('GET', '/containers/' + item['Id'] + '/json')
                need(row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') not in {source['nonce'], plan['nonce']},
                     'reuse_candidate_exists')
                for mount in row.get('Mounts', []):
                    mounted = mount.get('Source')
                    if not mounted:
                        continue
                    need(isinstance(mounted, str) and Path(mounted).is_absolute(), 'reuse_mount_path')
                    mounted = Path(mounted).resolve()
                    need(all(mounted != scope and mounted not in scope.parents and scope not in mounted.parents
                             for scope in (old_directory, directory)), 'reuse_mounted')
        fence()
        already_copied = directory.exists()
        if already_copied:
            private_directory(directory); private_directory(directory / 'generation')
            need(diagnosis_json(directory / 'PLAN.json')[1] == json_bytes(plan) and
                 not (directory / 'ACCEPTED.json').exists() and not (directory / 'ROLLED_BACK.json').exists() and
                 not (directory / 'ACCEPTED.pending').exists() and
                 diagnosis_json(directory / 'REUSED.json')[0] == copy_proof, 'reuse_existing_copy')
        else:
            disk = os.statvfs(BASE)
            # Worst case for ordinary copies, plus bounded metadata/headroom.
            # This test precedes mkdir, PLAN, temporary files or any write.
            need(disk.f_bavail * disk.f_frsize >= total_bytes + 64 * 1024 * 1024, 'reuse_disk_capacity')
        for descriptor in plan['files']:
            filename = source_path(descriptor['name'])
            need(file_sha(filename) == descriptor['sha256'] and
                 reuse_file_identity(filename) == identities[descriptor['name']], 'reuse_source_hash')
        generation, generation_raw = diagnosis_json(source_path('GENERATION.json'))
        oracle, oracle_raw = diagnosis_json(source_path('acceptance.json'))
        need(generation.get('generationId') == plan['generationId'] and generation.get('runtimeSha') == plan['pricingRuntimeSha'] and
             generation.get('prepared') is True and generation.get('source', {}).get('supplierLatestVerified') is True, 'reuse_generation')
        need(oracle.get('version') == 1 and oracle.get('runtimeSha') == plan['runtimeSha'] and
             oracle.get('pricingRuntimeSha') == plan['pricingRuntimeSha'] and
             oracle.get('generationManifestSha256') == plan['generationManifestSha256'] and
             isinstance(oracle.get('cases'), list) and len(oracle['cases']) >= 8, 'reuse_oracle')
        fence()
        if not already_copied:
            host = Host(plan)
            for descriptor in plan['files']:
                fence()
                reuse_copy_file(source_path(descriptor['name']), target_path(descriptor['name']), descriptor,
                                identities[descriptor['name']])
            new_file(directory / 'REUSED.json', json_bytes(copy_proof))
            for folder in (directory / 'generation', directory, directory.parent):
                fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
                try: os.fsync(fd)
                finally: os.close(fd)
        else:
            for descriptor in plan['files']:
                filename = target_path(descriptor['name'])
                identity = reuse_file_identity(filename)
                need(identity[2] == descriptor['bytes'] and identity[:2] != identities[descriptor['name']][:2] and
                     file_sha(filename) == descriptor['sha256'] and reuse_file_identity(filename) == identity, 'reuse_copy_readback')
            host = Host.__new__(Host)
            host.initialize_session(plan)
        fence()
        host.uploaded = set(FILE_NAMES)
        host.reuse_verified = True
        host.reuse_retained_identity = retained_identity
        host.lock = lock
        lock = None
        return host, {'initialized': True, 'reused': True, 'plan': plan,
                      'generationBase64': base64.b64encode(generation_raw).decode(), 'oracleBase64': base64.b64encode(oracle_raw).decode(),
                      'copiedFiles': len(plan['files']), 'copiedBytes': total_bytes}
    finally:
        if lock is not None:
            os.close(lock)


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
        self.initialize_session(plan)

    def initialize_session(self, plan):
        self.plan = plan
        self.directory = BASE / plan['runtimeSha'] / 'china-next' / plan['nonce']
        self.generation = self.directory / 'generation'
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
        need(name in expected_files(self.plan) and name not in self.uploaded and not self.candidate, 'upload_scope')
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
        health(self.old_port, retained_runtime(self.plan))

    def start(self):
        need(self.uploaded == expected_files(self.plan) and self.candidate is None, 'upload_not_complete')
        if not getattr(self, 'reuse_verified', False):
            self.lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            info = os.fstat(self.lock)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'runtime_lock')
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            need(self.lock is not None, 'reuse_lock_lost')
        regular(CONFIG, 1024 * 1024)
        self.original = CONFIG.read_bytes()
        self.old_port = backend(self.original)
        rows = docker('GET', '/containers/json?all=1')
        inspected = [docker('GET', '/containers/' + row['Id'] + '/json') for row in rows]
        serving = [row for row in inspected if any(str(binding.get('HostPort', '')) == str(self.old_port)
                   for bindings in (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in bindings)]
        need(len(serving) == 1, 'serving_container')
        self.retained = serving[0]
        if getattr(self, 'reuse_verified', False):
            need(protected_identity(self.retained) == self.reuse_retained_identity, 'reuse_retained_changed')
        env = env_map(self.retained)
        need(env.get('AVTOCENA_RELEASE_SHA') == retained_runtime(self.plan) and env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and
             self.retained['State']['Running'] and not self.retained['HostConfig']['Privileged'], 'serving_identity')
        need(self.retained['Config'].get('WorkingDir') == '/app' and self.retained['Config'].get('User', '') in ('', 'root', '0'), 'serving_config')
        mounts = self.retained.get('Mounts', [])
        need(mounts and all(row.get('Type') == 'bind' and row.get('RW') is False and
             row.get('Destination') != '/var/run/docker.sock' for row in mounts), 'serving_mounts')
        private = [row for row in mounts if row['Destination'] == '/app/data/knowledge/encyclopedia/calculation-v1.json']
        need(len(private) == 1 and file_sha(Path(private[0]['Source'])) ==
             '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c', 'encyclopedia_unchanged')
        previous_generation = None
        if generation_update(self.plan):
            previous, previous_receipt, previous_raw = accepted_predecessor(self.plan)
            outcome = read_outcome({'runtimeSha': previous['runtimeSha'], 'nonce': previous_receipt['nonce']})
            need(outcome.get('status') == 'accepted' and
                 outcome.get('hostReceiptBase64') == base64.b64encode(previous_raw).decode() and
                 outcome.get('hostReceiptSha256') == sha(previous_raw), 'predecessor_not_accepted')
            previous_generation = check_mounted_reference(self.retained, previous, previous_receipt['nonce'])
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
        if not generation_update(self.plan) and not getattr(self, 'reuse_verified', False):
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
        if generation_update(self.plan):
            need(generation['calculationVersion'] == previous_generation.get('calculationVersion') ==
                 env.get('AVTOCENA_BUILD_CALCULATION_VERSION'), 'data_only_calculation_version')
            env['CATALOG_CHINA_LOCAL_MANIFEST_SHA256'] = self.plan['generationManifestSha256']
            candidate_env = [item.split('=', 1)[0] + '=' + env[item.split('=', 1)[0]] for item in self.retained['Config']['Env']]
            old_mount = next(row for row in mounts if row['Destination'] == GENERATION_MOUNT)
            old_bind = old_mount['Source'] + ':' + GENERATION_MOUNT + ':ro'
            retained_binds = self.retained['HostConfig'].get('Binds')
            need(isinstance(retained_binds, list) and retained_binds.count(old_bind) == 1 and len(retained_binds) == len(mounts),
                 'data_only_bindings')
            binds = [str(self.generation) + ':' + GENERATION_MOUNT + ':ro' if item == old_bind else item for item in retained_binds]
        else:
            env.update(AVTOCENA_RELEASE_SHA=self.plan['runtimeSha'], AVTOCENA_BUILD_CALCULATION_VERSION=generation['calculationVersion'],
                       CATALOG_CHINA_LOCAL_GENERATION_DIR=GENERATION_MOUNT,
                       CATALOG_CHINA_LOCAL_MANIFEST_SHA256=self.plan['generationManifestSha256'],
                       CATALOG_CHINA_LOCAL_RUNTIME_SHA=self.plan['pricingRuntimeSha'])
            candidate_env = [key + '=' + value for key, value in sorted(env.items())]
            binds = [row['Source'] + ':' + row['Destination'] + ':ro' for row in mounts]
            need(not any(row['Destination'] == GENERATION_MOUNT for row in mounts), 'generation_mount_collision')
            binds.append(str(self.generation) + ':' + GENERATION_MOUNT + ':ro')
        self.spec = {'Image': self.plan['imageId'], 'WorkingDir': '/app',
                     'Entrypoint': copy.deepcopy(self.retained['Config']['Entrypoint']),
                     'Cmd': copy.deepcopy(self.retained['Config']['Cmd']),
                     'Env': candidate_env,
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
        self.wait_startup()
        self.verify_candidate()
        return {'started': True, 'release': self.plan['runtimeSha'], 'generationId': self.plan['generationId'],
                'startup': self.startup_report}

    def wait_startup(self):
        started = time.monotonic()
        deadline = started + 900
        attempts = 0
        category = 'not_checked'
        candidate = None
        def finish(reason):
            self.startup_report = {'version': 1, 'kind': 'china-host-startup-v1', 'ready': reason == 'ready',
                                   'elapsedSeconds': round(time.monotonic() - started, 4), 'attempts': attempts,
                                   'health': category, 'candidate': candidate, 'reason': reason}
            # Persist and transmit safe metadata before cleanup can remove the
            # process. No environment, log text, card or supplier data is kept.
            new_file(self.directory / 'STARTUP.json', json_bytes(self.startup_report))
            fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(fd)
            finally: os.close(fd)
        while True:
            try:
                row = docker('GET', '/containers/' + self.candidate + '/json')
                state = row.get('State', {})
                need(row.get('Id') == self.candidate and row.get('Image') == self.plan['imageId'] and
                     row.get('Config', {}).get('Labels', {}).get('avtocena.china.nonce') == self.plan['nonce'] and
                     type(state.get('Running')) is bool and type(state.get('OOMKilled')) is bool and
                     type(state.get('ExitCode')) is int and type(row.get('RestartCount')) is int and
                     state.get('Status') in {'created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'},
                     'candidate_changed')
                candidate = {'running': state['Running'], 'status': state['Status'], 'exitCode': state['ExitCode'],
                             'oomKilled': state['OOMKilled'], 'restartCount': row['RestartCount']}
            except Exception:
                finish('inspect_unavailable')
                raise ReleaseError('china_host_candidate_inspection') from None
            if candidate['oomKilled']:
                finish('oom')
                raise ReleaseError('china_host_candidate_oom')
            if not candidate['running']:
                finish('exited')
                raise ReleaseError('china_host_candidate_exited')
            if candidate['restartCount'] != 0:
                finish('restarted')
                raise ReleaseError('china_host_candidate_restarted')
            attempts += 1
            ready = False
            try:
                health(self.port, self.plan['runtimeSha'])
                ready = True
            except ConnectionRefusedError:
                category = 'connection_refused'
            except (TimeoutError, socket.timeout):
                category = 'timeout'
            except json.JSONDecodeError:
                category = 'invalid_json'
            except ReleaseError as error:
                category = {'china_host_health_identity': 'identity_mismatch', 'china_host_http_response': 'http_response'}.get(str(error), 'unavailable')
            except OSError:
                category = 'connection_error'
            except Exception:
                category = 'unavailable'
            if ready:
                category = 'ok'
                finish('ready')
                return
            if time.monotonic() >= deadline:
                finish('timeout')
                raise ReleaseError('china_host_candidate_startup') from None
            time.sleep(max(0, min(1, deadline - time.monotonic())))

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
                'encyclopediaWrites': 0, 'otherMarketWrites': 0, 'retainedRuntime': retained_runtime(self.plan)}

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

    def retire(self, params):
        """After the private accepted-state CAS, retire only the former rollback
        process and its verified bulk files. Preserve historical proofs/images."""
        need(generation_update(self.plan) and self.accepted, 'retire_before_acceptance')
        self.verify_candidate()
        state = params.get('acceptedState')
        need(isinstance(state, dict) and state.get('version') == 1 and state.get('market') == 'china' and
             state.get('kind') == 'china-accepted-state-v1' and state.get('pending') is None and
             type(state.get('revision')) is int and state['revision'] == self.plan['previousAcceptedState']['revision'] + 2,
             'retire_state')
        need(canonical_sha(state) == params.get('acceptedStateSha256') and
             isinstance(params.get('acceptedETag'), str) and
             re.fullmatch(r'"[^"\x00-\x20\x7f]{1,250}"', params['acceptedETag']) and
             params['acceptedETag'] != self.plan['previousAcceptedETag'], 'retire_state_hash')
        current = state.get('current')
        receipt, raw = accepted_reference_receipt(current)
        terminal = self.directory / 'ACCEPTED.json'
        regular(terminal, 256 * 1024)
        commit = state.get('commit')
        need(raw == terminal.read_bytes() and receipt['nonce'] == self.plan['nonce'] and
             current['generationId'] == self.plan['generationId'] and isinstance(commit, dict) and
             commit.get('nonce') == self.plan['nonce'] and commit.get('acceptedAt') == receipt.get('acceptedAt') and
             commit.get('previousETag') == self.plan['previousAcceptedETag'] and
             commit.get('previousStateSha256') == self.plan['previousAcceptedStateSha256'] and
             state.get('rollback') == self.plan['previousAcceptedState']['current'], 'retire_commit')
        verify_live_reference(current, self.plan['nonce'])
        return retire_reference(self.plan['previousAcceptedState'].get('rollback'), [state['current'], state['rollback']],
                                {self.candidate, self.retained['Id']}, self.verify_candidate)

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
            health(self.old_port, retained_runtime(self.plan))
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
                     'retainedContainerId': self.retained['Id'], 'retainedRuntimeSha': retained_runtime(self.plan),
                     'retainedImageId': self.retained['Image'], 'retainedRunning': True,
                     'ingressRestored': True, 'candidateRemoved': True}
            if not (self.directory / 'ROLLED_BACK.json').exists():
                new_file(self.directory / 'ROLLED_BACK.json', json_bytes(proof))


def main():
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_terminated')))
    signal.signal(signal.SIGHUP, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_disconnected')))
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(ReleaseError('china_host_browser_deadline')))
    host = None
    recovered = maintenance = diagnosed = False
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
            need(not diagnosed or method in {'diagnose', 'close'}, 'diagnosis_read_only')
            params = call.get('params', {})
            if method == 'diagnose':
                need(host is None, 'diagnosis_after_init')
                value = diagnose_startup(params)
                recovered = diagnosed = True
            elif method == 'recover':
                need(host is None, 'recovery_after_init')
                value = read_outcome(params)
                recovered = True
            elif method == 'retire_recovery':
                need(host is None, 'recovery_after_init')
                value = retire_recovery(params)
                recovered = maintenance = True
            elif method == 'close' and host is None:
                need(recovered, 'close_uninitialized')
                emit({'kind': 'result', 'id': identity, 'value': {'closed': True, 'readOnly': not maintenance}})
                return
            elif method == 'resume_init':
                need(host is None, 'already_initialized')
                host, value = resume_failed_upload(params)
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
                elif method == 'retire':
                    value = host.retire(params)
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
            reply = {'kind': 'error', 'id': locals().get('identity'), 'code': code}
            if host is not None and hasattr(host, 'startup_report'):
                reply['startup'] = host.startup_report
            emit(reply)
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
