"""Stop two exact, unserved legacy processes. Preserve every container, image, mount and file."""
import datetime
import fcntl
import hashlib
import json
import os
import re
import signal
import stat
import sys
import types

CURRENT = 'd536c1547c4d82a339ed68ced7d8503f09b6810b'
GENERATION = 'gen_china_45655051136_1'
MANIFEST = '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d'
ROLLBACK = 'gen_china_45369451603_1'
TARGETS = [
 {'id': '2c180485762c286c7e73f983cd0c93a718d9dec5c2f8e442e7ee44c1a51f6729',
  'runtimeSha': '56d6b94fea70457e0ce2b0820596da9972846b90', 'role': 'aj-system-japan-only',
  'imageId': 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba', 'port': 3003,
  'configurationSha256': 'dbe0d4e79898a99112eef83749ed3d07644bfc66e3cb2b2f82598840a46b2af7'},
 {'id': '21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78',
  'runtimeSha': '83ff17075e9188dcf227c8752dc064248d5f42e0', 'role': 'production',
  'imageId': 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 'port': 3001,
  'configurationSha256': '9c7abfb0d9f66dee1866f70c601a98d08b8ec930d6c2960aa3790031235d7a42'},
]


def need(value, code):
    if not value:
        raise RuntimeError('legacy_stop_' + code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def config_only(row):
    value = {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts')}
    value['Mounts'] = sorted(row.get('Mounts') or [], key=lambda item: json.dumps(item, sort_keys=True, separators=(',', ':')))
    return digest(value)


def validate_targets():
    need(len(TARGETS) == 2 and len({row['id'] for row in TARGETS}) == 2, 'targets')
    for row in TARGETS:
        need(set(row) == {'id', 'runtimeSha', 'role', 'imageId', 'port', 'configurationSha256'}
             and re.fullmatch(r'[a-f0-9]{64}', row['id']) and re.fullmatch(r'[a-f0-9]{40}', row['runtimeSha'])
             and row['runtimeSha'] != CURRENT and re.fullmatch(r'sha256:[a-f0-9]{64}', row['imageId'])
             and re.fullmatch(r'[a-f0-9]{64}', row['configurationSha256']) and row['port'] in (3001, 3003), 'target_shape')


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def read():
    raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
    need(raw.endswith(b'\n') and len(raw) <= 1024 * 1024, 'message')
    value = json.loads(raw)
    need(isinstance(value, dict), 'message')
    return value


def module(name, source, checksum):
    need(isinstance(source, str) and hashlib.sha256(source.encode()).hexdigest() == checksum, 'module')
    value = types.ModuleType(name)
    exec(compile(source, name + '.py', 'exec'), value.__dict__)
    return value


class Stop:
    def __init__(self, host, reader, authority):
        validate_targets()
        self.h, self.r, self.authority = host, reader, authority
        self.locks, self.stopped = [], []
        self.inflight = False
        self.restored = []
        self.check_authority(authority)
        for name in ('avtocena-staging-prepare', 'avtocena-runtime-change'):
            descriptor = os.open('/run/lock/' + name + '.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            self.locks.append(descriptor)
            value = os.fstat(descriptor)
            need(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_nlink == 1, 'lock')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.prepare()

    def check_authority(self, authority):
        need(isinstance(authority, dict) and set(authority) == {'publicationState', 'lease'} and authority == self.authority,
             'authority_changed')
        state, intent = self.h.checked_publication_view(authority['publicationState'])
        need(state.get('pending') is None and state['current']['runtimeSha'] == CURRENT and
             state['current']['generationId'] == GENERATION and state['current']['generationManifestSha256'] == MANIFEST and
             state.get('rollback', {}).get('runtimeSha') == CURRENT and state['rollback']['generationId'] == ROLLBACK and
             (intent is None or intent.get('status') in ('committed', 'aborted')), 'state')
        lease = self.h.checked_observation(authority['lease'])
        need(lease.get('kind') == 'china-market-lease-v1' and lease.get('market') == 'china' and lease.get('status') == 'held'
             and datetime.datetime.fromisoformat(lease['expiresAt'].replace('Z', '+00:00')) > datetime.datetime.now(datetime.timezone.utc), 'lease')
        return state

    def containers(self):
        listed = self.h.docker('GET', '/containers/json?all=1')
        need(isinstance(listed, list) and len(listed) == 12, 'container_count')
        rows = {item['Id']: self.h.docker('GET', '/containers/' + item['Id'] + '/json') for item in listed}
        need(len(rows) == 12 and all(re.fullmatch(r'[a-f0-9]{64}', key) and row['Id'] == key for key, row in rows.items()), 'container_identity')
        return rows

    def image_ids(self):
        rows = self.h.docker('GET', '/images/json?all=1')
        need(isinstance(rows, list) and len(rows) <= 128, 'images')
        return {row['Id'] for row in rows}

    def prepare(self):
        state = self.check_authority(self.authority)
        self.original = self.containers()
        self.expected = {key: self.r.signature(row) for key, row in self.original.items()}
        self.images = self.image_ids()
        self.proofs, self.protected = [], []
        for reference in (state['current'], state['rollback']):
            receipt = self.h.verified_history(reference)
            directory, _ = self.h.reference_plan(reference, receipt)
            matches = [row for row in self.original.values() if (row.get('Config', {}).get('Labels') or {}).get('avtocena.china.nonce') == receipt['nonce']]
            need(len(matches) == 1, 'protected_container')
            self.h.check_mounted_reference(matches[0], reference, receipt['nonce'])
            self.protected.append((matches[0]['Id'], reference, receipt['nonce']))
            for name in ('PLAN.json', 'ACCEPTED.json', 'generation/GENERATION.json'):
                path = directory / name
                self.h.regular(path, 256 * 1024)
                self.proofs.append((path, self.h.file_sha(path)))
        self.current, self.current_nonce = state['current'], self.protected[0][2]
        self.h.verify_live_reference(self.current, self.current_nonce)
        self.ingress = self.r.bounded(self.h.CONFIG)
        self.routes = self.r.routes()
        for target in TARGETS:
            need(target['id'] in self.original and target['id'] not in {row[0] for row in self.protected}, 'protected_target')
            row = self.original[target['id']]
            labels = row.get('Config', {}).get('Labels') or {}
            need(row.get('State', {}).get('Running') is True and row['Image'] == target['imageId']
                 and labels.get('org.opencontainers.image.revision') == target['runtimeSha'] and labels.get('avtocena.role') == target['role']
                 and self.r.ports(row) == [target['port']] and self.r.signature(row) == target['configurationSha256'], 'target_binding')
        self.before_memory = self.r.memory()
        self.before_disk = self.r.disk()
        self.before_cgroups = {target['id']: self.r.cgroup_memory(self.original[target['id']]) for target in TARGETS}
        self.fence()

    def unserved(self, rows):
        route = self.r.routes()
        need(route == self.routes and self.r.bounded(self.h.CONFIG) == self.ingress, 'routing_changed')
        connections = self.r.connection_counts()
        references = self.r.service_refs(list(rows.values()))
        for target in TARGETS:
            summary = self.r.container_summary(rows[target['id']], list(rows.values()), route['localPorts'], connections)
            need(not summary['nginxReferencedPorts'] and not summary['dependentContainerIds']
                 and not references[target['id']] and not any(summary['establishedConnectionsToPort'].values()), 'target_referenced')

    def fence(self):
        self.check_authority(self.authority)
        rows = self.containers()
        need({key: self.r.signature(row) for key, row in rows.items()} == self.expected, 'container_changed')
        need(self.image_ids() == self.images, 'images_changed')
        for path, checksum in self.proofs:
            self.h.regular(path, 256 * 1024)
            need(self.h.file_sha(path) == checksum, 'proof_changed')
        self.unserved(rows)
        for identity, reference, nonce in self.protected:
            self.h.check_mounted_reference(rows[identity], reference, nonce)
            target_ports = self.r.ports(rows[identity])
            need(len(target_ports) == 1, 'protected_port')
            self.h.health(target_ports[0], reference['runtimeSha'])
        self.h.verify_live_reference(self.current, self.current_nonce)
        return rows

    def prepared(self):
        return {'kind': 'legacy-stop-prepared-v1', 'planSha256': digest(TARGETS), 'targets': TARGETS, 'containersPlanned': 2,
                'containersPreserved': len(self.original), 'memoryBefore': self.before_memory, 'targetMemoryBefore': self.before_cgroups,
                'currentGeneration': GENERATION, 'rollbackGeneration': ROLLBACK}

    def step(self, message):
        need(set(message) == {'action', 'index', 'authority'} and message['action'] == 'stop'
             and type(message['index']) is int and message['index'] == len(self.stopped) and len(self.stopped) < len(TARGETS), 'sequence')
        self.check_authority(message['authority'])
        self.fence()
        target = TARGETS[len(self.stopped)]
        self.inflight = True
        # No force, update, removal, file operation or memory limit is used.
        try:
            self.h.docker('POST', '/containers/' + target['id'] + '/stop?t=25')
            row = self.h.docker('GET', '/containers/' + target['id'] + '/json')
            need(row.get('State', {}).get('Running') is False and row['State'].get('Pid') == 0 and
                 config_only(row) == config_only(self.original[target['id']]), 'stop_result')
            self.stopped.append(target['id'])
            self.expected[target['id']] = self.r.signature(row)
            self.fence()
        except BaseException:
            # Restore every process this action stopped if retained health or any fence fails.
            self.restore(target['id'])
            raise
        self.inflight = False
        return {'kind': 'legacy-container-stopped-v1', 'index': message['index'], 'containerId': target['id'],
                'memoryAfter': self.r.memory(), 'diskAfter': self.r.disk(), 'currentAndRollbackHealthy': True}

    def restore(self, maybe_stopped=None):
        for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, signal.SIG_IGN)
        pending = list(dict.fromkeys([*self.stopped, *([maybe_stopped] if maybe_stopped else [])]))
        for identity in reversed(pending):
            try:
                row = self.h.docker('GET', '/containers/' + identity + '/json')
                need(config_only(row) == config_only(self.original[identity]), 'restore_identity')
                if not row.get('State', {}).get('Running'):
                    self.h.docker('POST', '/containers/' + identity + '/start')
                row = self.h.docker('GET', '/containers/' + identity + '/json')
                need(row.get('State', {}).get('Running') is True, 'restore_running')
                self.restored.append(identity)
            except BaseException:
                self.inflight = True
                return
        self.inflight = False

    def finish(self, message):
        need(set(message) == {'action', 'authority'} and message['action'] == 'finish' and len(self.stopped) == len(TARGETS), 'finish')
        self.check_authority(message['authority'])
        self.fence()
        after = self.r.memory()
        return {'kind': 'legacy-stop-result-v1', 'completed': True, 'stoppedContainerIds': self.stopped,
                'planSha256': digest(TARGETS), 'memoryBefore': self.before_memory, 'memoryAfter': after,
                'availableMemoryChangeBytes': after['MemAvailable'] - self.before_memory['MemAvailable'],
                'diskBefore': self.before_disk, 'diskAfter': self.r.disk(), 'liveRuntimeSha': CURRENT,
                'generationId': GENERATION, 'rollbackGenerationId': ROLLBACK, 'currentAndRollbackHealthy': True,
                'containersPreserved': len(self.original), 'containersDeleted': 0, 'imagesDeleted': 0, 'filesDeleted': 0,
                'memoryLimitsChanged': 0, 'acceptedStateWrites': 0, 'intentStateWrites': 0}

    def close(self):
        for descriptor in reversed(self.locks):
            os.close(descriptor)
        self.locks = []


def main():
    validate_targets()
    if sys.argv[1:] == ['--verify-targets']:
        emit({'containersPlanned': len(TARGETS), 'planSha256': digest(TARGETS)})
        return
    need(not sys.argv[1:], 'arguments')
    def interrupted(*_):
        raise RuntimeError('legacy_stop_interrupted')
    for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, interrupted)
    action = None
    try:
        value = read()
        need(set(value) == {'hostSource', 'hostSourceSha256', 'readerSource', 'readerSourceSha256', 'authority'}, 'bootstrap')
        host = module('legacy_stop_host', value['hostSource'], value['hostSourceSha256'])
        reader = module('legacy_stop_reader', value['readerSource'], value['readerSourceSha256'])
        action = Stop(host, reader, value['authority'])
        emit(action.prepared())
        for _ in TARGETS:
            emit(action.step(read()))
        emit(action.finish(read()))
    except BaseException as error:
        if action and action.stopped and not action.restored:
            action.restore()
        code = str(error)
        emit({'errorCode': code if re.fullmatch(r'(?:legacy_stop|resource_inventory|china_host)_[a-z0-9_]{1,140}', code)
              else 'legacy_stop_host_failed', 'uncertain': bool(action and action.inflight),
              'restoredContainerIds': action.restored if action else []})
        raise SystemExit(1)
    finally:
        if action:
            action.close()


if __name__ == '__main__':
    main()
