"""AJ-only application activation. The authenticated loader owns the runtime lock.

Reuse the existing checked Docker transport, immutable file helpers, candidate
identity checks and compare-and-swap ingress implementation. No supplier, catalog,
pricing, admin-settings or encyclopedia object is written by this host process.
"""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import queue
import re
import signal
import stat
import subprocess
import sys
import tarfile
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
PROFILE = json.loads((Path(__file__).parent / 'release-profile.json').read_bytes())
SOURCE, BUILD = PROFILE['source'], PROFILE['sourceCalculationVersion']
CALCULATION, INDEX = PROFILE['servingCalculationVersion'], PROFILE['privateIndexDigest']
spec = importlib.util.spec_from_file_location('aj_native', ROOT / '.github/operations/home-ui-adapter-20261123/host-primitives.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
need, sha, regular, write_new = native.need, native.sha, native.regular, native.write_new
json_bytes, inventory = native.json_bytes, native.inventory
BASE = Path('/opt/avtocena/releases') / str(SOURCE)
PRIVATE = BASE / 'aj-private' / 'calculation-v1.json'
RESOURCES = BASE / 'aj-resources'
ROLLBACK = BASE / 'aj-rollback'
RESOURCE_TARGET = '/run/avtocena-node-resources'
RESOURCE_NAMES = {'home-bootstrap.mjs', 'run-node-with-resources.mjs', 'lib/node-resource-memory.mjs', 'lib/node-resource-memory-startup.mjs'}


def private_execute(args, **options):
    process = subprocess.Popen(args, start_new_session=True, **{key: value for key, value in options.items() if key != 'timeout'})
    try:
        output, _ = process.communicate(timeout=options.get('timeout', 1800))
        return subprocess.CompletedProcess(args, process.returncode, output)
    except BaseException:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
        raise


def public_json(target, path):
    need(target in ('candidate', 'retained', 'public') and path.startswith('/'), 'aj_http_scope')
    connection = (native.http.client.HTTPSConnection('avtocena.com', timeout=90, context=native.ssl.create_default_context())
                  if target == 'public' else native.http.client.HTTPConnection('127.0.0.1', 3003 if target == 'candidate' else 3002, timeout=90))
    try:
        connection.request('GET', path, headers={'Host': 'avtocena.com', 'Accept': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        raw = response.read(20 * 1024 * 1024 + 1)
        need(len(raw) <= 20 * 1024 * 1024, 'aj_http_bound')
        return response.status, json.loads(raw)
    finally:
        connection.close()


class Local(native.LocalHost):
    def __init__(self, plan, transport=None):
        super().__init__(plan, transport)
        self.names = {'aj-japan-' + SOURCE[:12] + '-' + plan['nonce'], 'aj-japan-probe-' + SOURCE[:12] + '-' + plan['nonce']}

    def create(self, spec, probe=False):
        name = ('aj-japan-probe-' if probe else 'aj-japan-') + SOURCE[:12] + '-' + self.plan['nonce']
        need(spec['Image'] == self.plan['imageId'], 'aj_create_image')
        identity = self.docker('POST', '/containers/create?name=' + name, spec).get('Id')
        need(re.fullmatch(r'[a-f0-9]{64}', identity or ''), 'aj_create_identity')
        self.owned.add(identity)
        return identity

    def free_port(self):
        # Docker's list response can omit a stopped container's configured
        # binding. Inspect only IDs from this fresh list, keep Env private, and
        # reject a configured claim on 3003 before the final atomic Docker bind.
        rows = self.docker('GET', '/containers/json?all=1')
        need(isinstance(rows, list) and len(rows) <= 256, 'aj_port_inventory')
        for row in rows:
            identity = row.get('Id', '')
            need(re.fullmatch(r'[a-f0-9]{64}', identity), 'aj_port_container_id')
            status, raw = self.transport('GET', '/containers/' + identity + '/json', None)
            need(status == 200, 'aj_port_inspect')
            container = json.loads(raw)
            need(container.get('Id') == identity, 'aj_port_inspect_identity')
            bindings = container.get('HostConfig', {}).get('PortBindings') or {}
            need(isinstance(bindings, dict) and all(isinstance(values, list) for values in bindings.values()), 'aj_port_bindings')
            need(not any(str(binding.get('HostPort', '')) == '3003' for values in bindings.values() for binding in values), 'aj_port_reserved')
        sock = native.socket.socket(native.socket.AF_INET, native.socket.SOCK_STREAM)
        try:
            sock.bind(('127.0.0.1', 3003))
        finally:
            sock.close()

    @staticmethod
    def health(target):
        status, value = public_json(target, '/api/health')
        expected = PROFILE['retainedSource'] if target == 'retained' else SOURCE
        need(status == 200 and value.get('ok') is True and value.get('releaseSha') == expected
             and value.get('calculationVersion') == CALCULATION, 'aj_health_identity')
        return True


def candidate_spec(plan, serving, probe=False):
    env = inventory.environment(serving)
    key = 'AVTOCENA_HOME_INHERITED_NODE_OPTIONS'
    need(key not in env, 'aj_node_options_collision')
    if 'NODE_OPTIONS' in env:
        env[key] = env.pop('NODE_OPTIONS')
    env.update(AVTOCENA_RELEASE_SHA=SOURCE, AVTOCENA_BUILD_CALCULATION_VERSION=BUILD)
    need(env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION and env.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME') == '1', 'aj_environment')
    mounts = sorted([source + ':' + target + ':ro' for source, target in inventory.MOUNTS])
    mounts += [str(RESOURCES) + ':' + RESOURCE_TARGET + ':ro', str(PRIVATE) + ':/app/data/knowledge/encyclopedia/calculation-v1.json:ro']
    return {'Image': plan['imageId'], 'WorkingDir': '/app', 'Entrypoint': ['node'],
            'Cmd': [RESOURCE_TARGET + '/home-bootstrap.mjs', 'private-probe' if probe else 'serve'],
            'Env': [key + '=' + value for key, value in sorted(env.items())],
            'Labels': {'org.opencontainers.image.revision': SOURCE, 'avtocena.role': 'aj-system-japan-only',
                       'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena', 'avtocena.application': 'web', 'avtocena.aj.nonce': plan['nonce']},
            'ExposedPorts': {'3000/tcp': {}},
            'HostConfig': {'Privileged': False, 'NetworkMode': 'none' if probe else 'bridge', 'Binds': mounts,
                           'PortBindings': {} if probe else {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3003'}]},
                           'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}}}


class Host:
    def __init__(self, plan, digest, authority):
        need(sha(json_bytes(plan)) == digest and re.fullmatch(r'[a-f0-9]{64}', digest), 'aj_plan_digest')
        for key in ('source', 'tree', 'sourceCalculationVersion', 'servingCalculationVersion', 'privateIndexDigest', 'inventorySha256'):
            need(plan.get(key) == PROFILE[key], 'aj_plan_identity')
        need(sha(json_bytes(PROFILE['inventory'])) == PROFILE['inventorySha256'], 'aj_inventory_digest')
        need(re.fullmatch(r'[a-f0-9]{32}', plan.get('nonce', '')) and re.fullmatch(r'sha256:[a-f0-9]{64}', plan.get('imageId', '')), 'aj_plan_nonce')
        need(set(plan.get('resourceFiles', {})) == RESOURCE_NAMES, 'aj_resource_scope')
        for key in ('privateFileSha256', 'acceptedReadModelFingerprint'):
            need(re.fullmatch(r'[a-f0-9]{64}', plan.get(key, '')), 'aj_plan_fingerprint')
        need(type(plan.get('privateFileBytes')) is int and plan['privateFileBytes'] > 0, 'aj_plan_private_size')
        image = plan.get('imageBuild', {})
        need(image.get('status') == 'verified_aj_japan_image' and image.get('source') == SOURCE and image.get('tree') == PROFILE['tree']
             and image.get('imageId') == plan['imageId'] and image.get('sourceCalculationVersion') == BUILD
             and image.get('privateIndexInImage') is False and image.get('resourceProbePassed') is True
             and image.get('resourceFiles') == plan['resourceFiles'], 'aj_image_receipt')
        self.plan, self.authority, self.local = plan, authority, Local(plan)
        self.candidate = self.spec = self.process = self.ingress = None
        self.restart_policy = 'no'

    def guard(self, phase):
        self.authority(phase, self.plan['generationId'], self.plan['acceptedReadModelFingerprint'])

    def fresh(self):
        self.guard('retained_identity')
        class Reader(inventory.LocalIO):
            def inspect(inner, name):
                value = self.local.inspect_retained(name)
                value['Mounts'] = sorted(value['Mounts'], key=lambda row: json.dumps(row, sort_keys=True, separators=(',', ':')))
                return value
        value = inventory.snapshot(Reader(), expected_start=PROFILE['inventory']['containers']['serving']['startedAt'])
        need(value == PROFILE['inventory']['containers'], 'aj_retained_inventory_changed')
        inventory.verify_config(inventory.LocalIO.config())
        inventory.verify_health(inventory.LocalIO())
        return self.local.inspect_retained(inventory.ROLES[0][1])

    def directories(self):
        self.guard('material_directories')
        for directory in (BASE, PRIVATE.parent, RESOURCES, RESOURCES / 'lib', ROLLBACK):
            try:
                directory.mkdir(mode=0o700)
                native.fsync_directory(directory.parent)
            except FileExistsError:
                pass
            native.owned_directory(directory)

    def materialize(self, target, stream, size, digest):
        self.guard('private_materialize')
        need(type(size) is int and size > 0 and re.fullmatch(r'[a-f0-9]{64}', digest), 'aj_material_shape')
        if os.path.lexists(target):
            raw = regular(target, mode=0o400, maximum=size)[0]
            need(len(raw) == size and sha(raw) == digest, 'aj_existing_material_changed')
            return False
        temporary = target.with_name('.incoming-' + self.plan['nonce'])
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        count, checksum = 0, hashlib.sha256()
        try:
            with os.fdopen(fd, 'wb') as handle:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    need(count <= size, 'aj_material_size')
                    checksum.update(chunk)
                    handle.write(chunk)
                need(count == size and checksum.hexdigest() == digest, 'aj_material_digest')
                os.fchmod(handle.fileno(), 0o400)
                handle.flush()
                os.fsync(handle.fileno())
            os.link(temporary, target, follow_symlinks=False)
            temporary.unlink()
            native.fsync_directory(target.parent)
            return True
        finally:
            temporary.unlink(missing_ok=True)

    def checked_materials(self):
        self.guard('materials')
        private = regular(PRIVATE, mode=0o400, maximum=self.plan['privateFileBytes'])[0]
        need(len(private) == self.plan['privateFileBytes'] and sha(private) == self.plan['privateFileSha256'], 'aj_private_material')
        for name, digest in self.plan['resourceFiles'].items():
            need(sha(regular(RESOURCES / name, mode=0o400)[0]) == digest, 'aj_resource_changed')
        image = self.local.docker('GET', '/images/' + self.plan['imageId'] + '/json')
        need(image.get('Id') == self.plan['imageId'] and image.get('Config', {}).get('Labels') == {
            'org.opencontainers.image.revision': SOURCE, 'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena', 'avtocena.application': 'web'}
            and image['Config'].get('WorkingDir') == '/app' and image['Config'].get('Cmd') == ['node', 'apps/web/server.js'], 'aj_loaded_image')

    def start(self):
        serving = self.fresh()
        self.checked_materials()
        probe_spec = candidate_spec(self.plan, serving, probe=True)
        probe = self.local.create(probe_spec, probe=True)
        try:
            self.local.docker('POST', '/containers/' + probe + '/start')
            result = self.local.docker('POST', '/containers/' + probe + '/wait?condition=not-running')
            need(result.get('StatusCode') == 0 and not result.get('Error'), 'aj_private_probe_exit')
            native.candidate_identity(self.local.inspect_owned(probe), probe_spec, probe, running=False)
            rows = native.decoded_logs(self.local.docker('GET', '/containers/' + probe + '/logs?stdout=1&stderr=1&tail=100'))
            native.memory_receipt(rows)
            checks = [row for row in rows if row.get('stage') == 'home_private_probe']
            need(len(checks) == 1 and checks[0].get('passed') is True and checks[0].get('indexDigest') == INDEX
                 and checks[0].get('fileSha256') == self.plan['privateFileSha256'], 'aj_private_index_probe')
        finally:
            row = self.local.inspect_owned(probe)
            native.candidate_identity(row, probe_spec, probe, running=row['State']['Running'], healthy=False)
            if row['State']['Running']:
                self.local.docker('POST', '/containers/' + probe + '/stop?t=10')
            self.local.docker('DELETE', '/containers/' + probe + '?v=false&force=false')
        self.fresh()
        self.checked_materials()
        self.local.free_port()
        self.guard('candidate_create')
        self.spec = candidate_spec(self.plan, serving)
        self.candidate = self.local.create(self.spec)
        try:
            self.local.docker('POST', '/containers/' + self.candidate + '/start')
            self.process = native.candidate_identity(self.local.inspect_owned(self.candidate), self.spec, self.candidate)
            deadline = time.monotonic() + 60
            while True:
                try:
                    self.local.health('candidate')
                    break
                except Exception:
                    self.identity(health=False)
                    need(time.monotonic() < deadline, 'aj_start_health_timeout')
                    time.sleep(1)
            rows = native.decoded_logs(self.local.docker('GET', '/containers/' + self.candidate + '/logs?stdout=1&stderr=1&tail=100'))
            startup = native.memory_receipt(rows)
            return {'id': self.candidate, 'source': SOURCE, 'imageId': self.plan['imageId'], 'startupResources': startup}
        except BaseException:
            self.cleanup()
            raise

    def identity(self, health=True):
        self.guard('candidate_identity')
        need(self.candidate is not None, 'aj_candidate_missing')
        process = native.candidate_identity(self.local.inspect_owned(self.candidate), self.spec, self.candidate, policy=self.restart_policy)
        need(process == self.process, 'aj_process_changed')
        if health:
            self.local.health('candidate')

    def switch(self):
        self.identity()
        self.fresh()
        ingress = native.NginxCompareAndSwap(ROLLBACK / self.plan['nonce'], self.guard)
        ingress.prepare()
        self.ingress = ingress
        self.local.docker('POST', '/containers/' + self.candidate + '/update', {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}})
        self.restart_policy = 'unless-stopped'
        self.identity()
        ingress.switch()

    def rollback(self):
        if self.ingress:
            self.ingress.rollback()
        inventory.verify_config(inventory.LocalIO.config())
        inventory.verify_health(inventory.LocalIO())
        if self.candidate:
            self.local.docker('POST', '/containers/' + self.candidate + '/update', {'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}})
            self.restart_policy = 'no'

    def cleanup(self):
        if not self.candidate:
            return
        inventory.verify_config(inventory.LocalIO.config())
        inventory.verify_health(inventory.LocalIO())
        row = self.local.inspect_owned(self.candidate)
        native.candidate_identity(row, self.spec, self.candidate, running=row['State']['Running'], policy=self.restart_policy, healthy=False)
        if row['State']['Running']:
            self.local.docker('POST', '/containers/' + self.candidate + '/stop?t=10')
        self.local.docker('DELETE', '/containers/' + self.candidate + '?v=false&force=false')
        self.candidate = None


def check_aj_contract(target, guard):
    guard('aj_contract')
    status, value = public_json(target, '/api/catalog/korea-report?id=ajes-korea-retired')
    need(status == 410 and value.get('error') == 'source_retired', 'aj_retired_report')
    for market in ('china', 'korea'):
        for source in ('ajes', 'existing'):
            status, value = public_json(target, '/api/catalog/search?market=' + market + '&source=' + source + '&pageSize=24')
            need(status == 200 and value.get('ok') is not False and not value.get('error') and value.get('total', 0) > 0
                 and isinstance(value.get('items'), list) and value['items']
                 and not any(value.get(flag) for flag in ('stale', 'partial', 'interrupted', 'countIncomplete')), 'aj_local_market_unavailable')
            need(all(row.get('market') == market and not str(row.get('id', '')).startswith('ajes-')
                     and not str(row.get('sourceId', '')).startswith('ajes_') for row in value['items']), 'aj_non_japan_source')
    # Private loopback has no genuine client peer and must fail before AJ I/O.
    # Public browser checks keep nginx's real peer and never manufacture an IP.
    if target == 'candidate':
        status, value = public_json(target, '/api/catalog/search?market=japan&source=ajes')
        need(status == 503 and value.get('ok') is False and value.get('error') == 'japan_search_unavailable'
             and value.get('reason') == 'client_ip_missing', 'aj_japan_boundary')
    for route in ('/api/crm/ajes', '/api/crm/ajes/markets/china', '/api/crm/ajes/markets/korea'):
        status, _ = public_json(target, route)
        need(status in (401, 403), 'aj_crm_auth')
    guard('aj_contract_readback')
    return {'release': SOURCE, 'target': target, 'passed': True, 'retiredReport': True, 'nonJapanAjes': False, 'anonymousCrmRejected': True}


def full_server_gate(nonce, phase):
    for relative, digest in native.GATES.items():
        need(sha(regular(ROOT / relative)[0]) == digest, 'aj_gate_source')
    baseline = 'docs/operations/2026-11-11-accepted-speed-baseline.json'
    routes = list(dict.fromkeys(row['path'] for row in json.loads(regular(ROOT / baseline)[0])['samples']))
    need(len(routes) == 17, 'aj_gate_routes')
    env = {'PATH': '/usr/bin:/bin', 'AVTOCENA_RELEASE_MARKETS': '', 'AVTOCENA_SPEED_BASELINE_MODE': 'enforce', 'AVTOCENA_SPEED_BASELINE': str(ROOT / baseline)}
    if 'SSH_CONNECTION' in os.environ:
        env['SSH_CONNECTION'] = os.environ['SSH_CONNECTION']
    base = 'http://127.0.0.1:3003' if phase == 'private' else 'https://avtocena.com'
    result = private_execute(['/usr/bin/python3', '-I', '-B', str(ROOT / 'scripts/regcloud-performance-gate.py'), base, SOURCE],
                             env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1800)
    need(result.returncode == 0, 'aj_server_gate_failed')
    rows = []
    for line in result.stdout.splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    summaries = [row for row in rows if row.get('performanceGate') == 'summary']
    phases = [row for row in rows if row.get('performanceGate') in ('warm', 'after_ttl', 'after_directory_ttl')]
    need(len(summaries) == 1 and len(phases) == 51, 'aj_server_coverage')
    summary = summaries[0]
    need(summary.get('marketScope') == '' and summary.get('functionalPassed') is True and summary.get('acceptedBaselineEnforced') is True
         and summary.get('samples') == 51 and set(summary.get('routes', [])) == set(routes) and set(summary.get('acceptedBaselineRoutes', [])) == set(routes), 'aj_server_summary')
    for route in routes:
        for period in ('warm', 'after_ttl', 'after_directory_ttl'):
            need(sum(row.get('path') == route and row.get('performanceGate') == period and row.get('functionalPassed') is True for row in phases) == 1, 'aj_server_phase')
    return {'release': SOURCE, 'nonce': nonce, 'phase': phase, 'exitCode': 0, 'logSha256': sha(result.stdout),
            'baselineSha256': native.GATES[baseline], 'summary': summary, 'phases': phases}


class Protocol:
    def __init__(self, reader, writer, nonce):
        self.reader, self.writer, self.nonce = reader, writer, nonce
        self.commands, self.replies, self.uploads = queue.Queue(), {}, {}
        self.finished_uploads, self.last_call, self.sequence = set(), 0, 0
        self.closed = self.graceful = False
        self.output_lock = threading.Lock()
        self.verdict_directory = None

    def emit(self, value):
        with self.output_lock:
            self.writer.write(json.dumps(value, separators=(',', ':')) + '\n')
            self.writer.flush()

    def read_loop(self):
        try:
            while True:
                line = self.reader.readline(1024 * 1024 + 1)
                if not line:
                    break
                need(len(line) <= 1024 * 1024 and line.endswith(b'\n'), 'aj_protocol_frame')
                value = json.loads(line)
                kind, identity = value.get('kind'), value.get('id')
                if kind == 'call':
                    need(type(identity) is int and identity == self.last_call + 1 and isinstance(value.get('method'), str), 'aj_protocol_call')
                    self.last_call = identity
                    if value['method'] in ('image', 'private-index'):
                        need(identity not in self.uploads, 'aj_upload_replay')
                        self.uploads[identity] = queue.Queue(maxsize=8)
                    self.commands.put(value)
                elif kind in ('chunk', 'end'):
                    if identity in self.finished_uploads:
                        continue
                    need(identity in self.uploads, 'aj_upload_scope')
                    self.uploads[identity].put(None if kind == 'end' else base64.b64decode(value['data'], validate=True))
                elif kind == 'authority':
                    need(identity in self.replies and self.replies[identity].empty(), 'aj_authority_replay')
                    self.replies[identity].put(value)
                elif kind == 'browser-verdict':
                    verdict = value.get('value')
                    need(self.verdict_directory is not None and set(verdict) == {'schemaVersion', 'release', 'nonce', 'passed', 'functionalPassed', 'speedPassed', 'reportSha256'}
                         and verdict['schemaVersion'] == 1 and verdict['release'] == SOURCE and verdict['nonce'] == self.nonce
                         and all(type(verdict[key]) is bool for key in ('passed', 'functionalPassed', 'speedPassed'))
                         and re.fullmatch(r'[a-f0-9]{64}', verdict['reportSha256']), 'aj_browser_frame')
                    write_new(self.verdict_directory / ('browser-verdict-' + self.nonce + '.json'), json_bytes(verdict))
                else:
                    raise RuntimeError('aj_protocol_kind')
        except BaseException:
            pass
        self.closed = True
        self.commands.put(None)
        if not self.graceful:
            os.kill(os.getpid(), signal.SIGUSR1)

    def authority(self, phase, generation, fingerprint):
        need(not self.closed, 'aj_disconnected')
        self.sequence += 1
        identity = self.sequence
        reply = self.replies[identity] = queue.Queue(maxsize=1)
        try:
            self.emit({'kind': 'authority-request', 'id': identity, 'phase': phase})
            value = reply.get(timeout=60)
            need(value.get('ok') is True and value.get('generationId') == generation and value.get('acceptedReadModelFingerprint') == fingerprint
                 and value.get('operationId') == 'aj-system-japan-only-' + self.nonce
                 and type(value.get('lockedUntilMs')) is int and value['lockedUntilMs'] > time.time() * 1000, 'aj_authority')
        finally:
            del self.replies[identity]

    def stream(self, identity):
        source = self.uploads[identity]
        class Stream:
            pending, ended, announced = b'', False, False
            def read(inner, maximum):
                if not inner.announced:
                    inner.announced = True
                    self.emit({'kind': 'upload-ready', 'id': identity})
                if inner.pending:
                    result, inner.pending = inner.pending[:maximum], inner.pending[maximum:]
                    return result
                if inner.ended:
                    return b''
                value = source.get(timeout=60)
                if value is None:
                    inner.ended = True
                    return b''
                inner.pending = value
                return inner.read(maximum)
        return Stream()


class Driver:
    def __init__(self, protocol):
        self.protocol, self.host = protocol, None
        self.completed, self.accepted, self.switched = set(), False, False

    def require(self, *phases):
        need(all(phase in self.completed for phase in phases), 'aj_driver_phase')

    def command(self, method, params, identity):
        if method == 'init':
            need(self.host is None and params['plan']['nonce'] == self.protocol.nonce, 'aj_init')
            self.host = Host(params['plan'], params['planSha256'], self.protocol.authority)
            self.host.fresh()
            self.host.directories()
            self.completed.add('init')
            return {'source': SOURCE, 'initialized': True}
        self.require('init')
        h = self.host
        if method in ('image', 'private-index', 'resources', 'start', 'switch', 'browser', 'accept'):
            need(method not in self.completed, 'aj_driver_replay')
        if method == 'image':
            h.guard('image_load')
            size = h.plan['imageBuild']['imageArchiveBytes']
            need(params.get('bytes') == size, 'aj_image_size')
            h.local.transfer_capacity(ROOT, size)
            target = ROOT / 'image.tar'
            try:
                h.materialize(target, self.protocol.stream(identity), size, h.plan['imageBuild']['imageArchiveSha256'])
                with tarfile.open(target, mode='r:') as archive:
                    member = archive.getmember('manifest.json')
                    need(member.isfile() and member.size < 65536, 'aj_image_manifest')
                    manifest = json.load(archive.extractfile(member))
                    need(len(manifest) == 1 and set(manifest[0].get('RepoTags') or []) <= {'avtocena-aj-japan:' + SOURCE}, 'aj_image_tags')
                h.guard('image_load_verified')
                result = private_execute(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'image', 'load', '--input', str(target)],
                    env={'PATH': '/usr/bin:/bin'}, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
                need(result.returncode == 0, 'aj_image_load')
            finally:
                target.unlink(missing_ok=True)
            value = {'imageId': h.plan['imageId'], 'archiveSha256': h.plan['imageBuild']['imageArchiveSha256']}
        elif method == 'private-index':
            h.materialize(PRIVATE, self.protocol.stream(identity), h.plan['privateFileBytes'], h.plan['privateFileSha256'])
            value = {'privateIndexDigest': INDEX, 'verified': True}
        elif method == 'resources':
            h.guard('resources')
            need(set(params['files']) == RESOURCE_NAMES, 'aj_resource_files')
            files = {name: base64.b64decode(raw, validate=True) for name, raw in params['files'].items()}
            for name, raw in files.items():
                need(sha(raw) == h.plan['resourceFiles'][name], 'aj_resource_digest')
            for name, raw in files.items():
                target = RESOURCES / name
                if os.path.lexists(target):
                    need(sha(regular(target, mode=0o400)[0]) == h.plan['resourceFiles'][name], 'aj_existing_resource')
                else:
                    write_new(target, raw, 0o400)
            value = {'files': len(files)}
        elif method == 'start':
            self.require('image', 'private-index', 'resources')
            value = h.start()
        elif method == 'identity':
            self.require('start'); h.identity(); return {'verified': True}
        elif method == 'fresh':
            h.fresh(); return {'fresh': True}
        elif method in ('aj-private', 'aj-public'):
            self.require('start' if method == 'aj-private' else 'switch')
            value = check_aj_contract('candidate' if method == 'aj-private' else 'public', h.guard)
        elif method in ('server-private', 'server-public'):
            self.require('aj-private' if method == 'server-private' else 'aj-public')
            h.guard(method)
            value = full_server_gate(self.protocol.nonce, method.split('-')[1])
            h.guard('server_readback')
        elif method == 'switch':
            self.require('server-private')
            self.switched = True
            h.switch()
            value = {'switched': True}
        elif method == 'public-identity':
            self.require('switch'); h.local.health('public'); return {'verified': True}
        elif method == 'browser':
            self.require('server-public')
            directory = ROLLBACK / ('browser-' + self.protocol.nonce)
            directory.mkdir(mode=0o700)
            self.protocol.verdict_directory = directory
            protocol = self.protocol
            class Output(io.StringIO):
                def write(inner, text):
                    before = inner.getvalue()
                    result = super().write(text)
                    after = inner.getvalue()
                    if 'BROWSER_ACCEPTANCE_REQUIRED ' in after and '\n' in after and '\n' not in before:
                        protocol.emit({'kind': 'browser-ready', 'nonce': protocol.nonce, 'release': SOURCE})
                    return result
            helper = ROOT / 'scripts/regcloud-browser-verdict.py'
            need(sha(regular(helper)[0]) == native.GATES['scripts/regcloud-browser-verdict.py'], 'aj_browser_helper')
            with contextlib.redirect_stdout(Output()):
                value = native.load_module('aj_browser', helper).wait_for_verdict(directory, SOURCE, self.protocol.nonce)
        elif method == 'accept':
            self.require('server-private', 'server-public', 'browser', 'aj-private', 'aj-public')
            h.identity(); h.local.health('public'); h.guard('accept')
            value = {'accepted': True, 'source': SOURCE, 'imageId': h.plan['imageId'], 'nonce': self.protocol.nonce}
            write_new(ROOT / 'accepted.json', json_bytes(value))
            self.accepted = True
        elif method == 'rollback':
            need(not self.accepted, 'aj_already_accepted'); h.rollback(); self.switched = False; return {'restored': True}
        elif method == 'cleanup':
            need(not self.accepted and not self.switched, 'aj_cleanup_routed'); h.cleanup(); return {'cleaned': True}
        elif method == 'close':
            need(self.accepted or h.candidate is None, 'aj_close_unverified'); return {'closed': True, 'accepted': self.accepted}
        else:
            raise RuntimeError('aj_driver_method')
        self.completed.add(method)
        return value

    def emergency_rollback(self):
        if self.accepted or self.host is None:
            return
        if self.switched:
            self.host.rollback()
            self.switched = False
        self.host.cleanup()


def main():
    need(type(globals().get('HELD_RUNTIME_LOCK')) is int and re.fullmatch(r'[a-f0-9]{32}', globals().get('SESSION_NONCE', '')), 'aj_loader_required')
    metadata = os.fstat(HELD_RUNTIME_LOCK)
    need(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1, 'aj_loader_lock')
    protocol = Protocol(sys.stdin.buffer, sys.stdout, SESSION_NONCE)
    driver = Driver(protocol)
    def disconnected(signum, frame):
        raise RuntimeError('aj_controller_disconnected')
    for signum in (signal.SIGUSR1, signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, disconnected)
    thread = threading.Thread(target=protocol.read_loop, daemon=True)
    thread.start()
    protocol.emit({'kind': 'ready', 'source': SOURCE, 'nonce': SESSION_NONCE})
    try:
        while True:
            command = protocol.commands.get()
            need(command is not None, 'aj_disconnected')
            identity = command['id']
            try:
                value = driver.command(command['method'], command.get('params', {}), identity)
                if command['method'] == 'close':
                    protocol.graceful = True
                protocol.emit({'kind': 'result', 'id': identity, 'value': value})
                if command['method'] == 'close':
                    thread.join(timeout=12)
                    need(not thread.is_alive(), 'aj_close_eof')
                    return
            except Exception as error:
                code = str(error) if isinstance(error, (native.HostError, inventory.InventoryError)) else 'aj_host_operation_failed'
                protocol.emit({'kind': 'error', 'id': identity, 'code': code})
            finally:
                if command['method'] in ('image', 'private-index'):
                    protocol.finished_uploads.add(identity)
                    source = protocol.uploads.pop(identity, None)
                    if source:
                        while True:
                            try: source.get_nowait()
                            except queue.Empty: break
    finally:
        for signum in (signal.SIGUSR1, signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(signum, signal.SIG_IGN)
        driver.emergency_rollback()


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        sys.stderr.write('aj_release_host_unverified\n')
        sys.exit(1)
