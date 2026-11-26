"""Retire only the two authenticated d536 host copies; preserve REG and proofs."""
import copy
import datetime
import hashlib
import json
import os
import re
import sys
import types

CAPTURE = {
    'runId': '45872306609',
    'reportSha256': 'ca7297d4ca9e792b1ef85b14a2d530a4d2eb18657dddbff585bced820e36f32c',
    'definitionSha256': '623a6e89ff1e89368f8572b95306aa00abf62a3ad1224f5a27cadb863af26eed',
    'acceptedSha256': 'f6dcecc748d175d3303b0d787771034495cddba622d7fd16dddeb5a0b84781ed',
    'acceptedETagSha256': '25dded8ee746b4b6a343a7988c6b427d2c7791d77d990dcd67308ae5b37760cb',
    'intentSha256': '9a5d08c86f24bfe26cf5025d0cbc7ed4267de1358f18c33ac5e0d9d556d6d6de',
    'intentETagSha256': '4901d4e2837c39c06a27ed42df9e4d2a91f4d0205d80b0ddf7b41de5a8e959f7',
    'ingressSha256': 'e562925c16ca56d5c5e34d783d86394e76198c9362444b65f802e6c34c85e162',
}
REFERENCE_HASHES = {
    'current': 'a4c6b14cfb4ba6be72a0e75c9f66e354e283b3c9438881c7dd4343a295c1321b',
    'rollback': '2f866bf06ff45189113abfbe36ebe7a390f0d0a02e15d84f733cec55e6d0c417',
    'obsoleteA': '5bf611dbd0ee5253a41e1d9a5d3bbb7c7f43fb4d5079318a2b21493dcc7584ac',
    'obsoleteB': '61a0a43b880a508933fc1ba741c6c5392acc05d2e7cb0b7b8e13240abf54cf38',
}
TARGETS = [
    {'name': 'obsoleteA', 'containerId': '21a7093914645595d2cfcfc26335f8e8dbf155f6906840bbfb72855ed587e1e3',
     'files': 7, 'bytes': 13042078167, 'descriptorsSha256': 'd570f2aba77434662b40e0a529b1ed88ab22bde89900208562137710ecdb0abb'},
    {'name': 'obsoleteB', 'containerId': 'bf233b651cc4c84afae4b59c2f17279ea2db7475bfeef6158ca012315a7f1c23',
     'files': 6, 'bytes': 12607904475, 'descriptorsSha256': '9636f2bc679f96e13fa40310d5598548a4607b09f9a8a02f257b77e4aeecd829'},
]
SAFE_ERRORS = {'authority', 'lease', 'lease_changed', 'lease_expired', 'state_changed', 'definition', 'source',
    'reference', 'history', 'chain', 'descriptors', 'container_set', 'container_changed', 'running_target',
    'docker_scope', 'health_scope', 'image_set', 'ingress', 'metadata_changed', 'sequence', 'step_result',
    'finish', 'input', 'failed'}


def need(value, code):
    if not value:
        raise ValueError('obsolete_retirement_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def definition():
    return {'capture': CAPTURE, 'referenceSha256': REFERENCE_HASHES, 'targets': TARGETS}


def safe_error(error):
    text = str(error)
    return text if text in {'obsolete_retirement_' + code for code in SAFE_ERRORS} else 'obsolete_retirement_failed'


class Retirement:
    def __init__(self, host, capture, authority):
        self.h, self.c = host, capture
        self.lock = None
        self.inflight = False
        self.active = None
        self.sequence = 0
        self.steps = []
        self.original_authority = copy.deepcopy(authority)
        self.references, self.plans, self.proofs = {}, {}, {}
        self.absent = set()
        need(sha(canonical(capture.definition())) == CAPTURE['definitionSha256'], 'definition')
        self.original_docker, self.original_response = host.docker, host.response_json
        host.docker, host.response_json = self.docker, self.local_health
        self.lock = host.reuse_lock()
        try:
            self.prepare(authority)
        except BaseException:
            self.close()
            raise

    def docker(self, method, target, body=None):
        known = {row[0] for row in self.c.CONTAINERS}
        read = method == 'GET' and (target in ('/containers/json?all=1', '/images/json?all=1')
            or target in {'/containers/' + identifier + '/json' for identifier in known})
        delete = self.active is not None and method == 'DELETE' and target == '/containers/' + self.active + '?v=false&force=false'
        need(body is None and (read or delete), 'docker_scope')
        return self.original_docker(method, target)

    def local_health(self, port, route, timeout=5):
        need(port in (3006, 3007) and route == '/api/health' and 0 < timeout <= 5, 'health_scope')
        return self.original_response(port, route, timeout)

    def authority(self, value):
        need(isinstance(value, dict) and set(value) == {'publicationState', 'lease'}, 'authority')
        state, _ = self.h.checked_publication_view(value['publicationState'])
        for name in ('accepted', 'intent'):
            row = value['publicationState'][name]
            need(row['sha256'] == CAPTURE[name + 'Sha256']
                 and sha(row['etag'].encode()) == CAPTURE[name + 'ETagSha256']
                 and row == self.original_authority['publicationState'][name], 'state_changed')
        lease = self.h.checked_observation(value['lease'])
        need(lease.get('kind') == 'china-market-lease-v1' and lease.get('market') == 'china'
             and lease.get('status') == 'held' and lease.get('releasedAt') is None
             and isinstance(lease.get('nonce'), str) and re.fullmatch(r'[a-f0-9]{32}', lease['nonce'])
             and isinstance(lease.get('owner'), dict) and set(lease['owner']) == {'runId', 'attempt', 'revision'}
             and re.fullmatch(r'[1-9][0-9]{0,19}', lease['owner']['runId'])
             and lease['owner']['attempt'] == '1' and re.fullmatch(r'[a-f0-9]{40}', lease['owner']['revision']), 'lease')
        need(value['lease'] == self.original_authority['lease'], 'lease_changed')
        self.lease_live()
        return state

    def lease_live(self):
        value = self.original_authority['lease']['value']
        need(datetime.datetime.fromisoformat(value['expiresAt'].replace('Z', '+00:00'))
             > datetime.datetime.now(datetime.timezone.utc), 'lease_expired')

    def containers(self):
        listing = self.h.docker('GET', '/containers/json?all=1')
        need(isinstance(listing, list), 'container_set')
        ids = {row.get('Id') for row in listing}
        known = {row[0] for row in self.c.CONTAINERS}
        obsolete = {row['containerId'] for row in TARGETS}
        allowed_absent = self.absent | ({self.active} if self.active else set())
        need(len(ids) == len(listing) and ids.issubset(known)
             and known - ids <= (obsolete if not hasattr(self, 'initial_containers') else allowed_absent), 'container_set')
        result = {}
        for identifier, running, fingerprint in self.c.CONTAINERS:
            if identifier not in ids:
                continue
            row = self.h.docker('GET', '/containers/' + identifier + '/json')
            need(row.get('Id') == identifier and self.c.configuration_sha(row) == fingerprint, 'container_changed')
            need(row.get('State', {}).get('Running') is running, 'running_target')
            result[identifier] = row
        return result

    def images(self):
        rows = self.h.docker('GET', '/images/json?all=1')
        need(isinstance(rows, list) and all(isinstance(row, dict) and re.fullmatch(r'sha256:[a-f0-9]{64}', row.get('Id', '')) for row in rows), 'image_set')
        ids = sorted(row['Id'] for row in rows)
        need(len(ids) == len(set(ids)), 'image_set')
        return ids

    def history(self, name, reference):
        h, pin = self.h, self.c.HISTORY[name]
        need(h.canonical_sha(reference) == REFERENCE_HASHES[name]
             and all(reference.get(field) == pin[target] for field, target in
                 [('runtimeSha', 'runtimeSha'), ('imageId', 'imageId'), ('generationId', 'generationId'),
                  ('generationManifestSha256', 'manifestSha256')]), 'reference')
        receipt = h.verified_history(reference)
        need(sha(receipt['nonce'].encode())[:16] == pin['attemptHash'], 'history')
        directory, plan = h.reference_plan(reference, receipt)
        for filename, expected in [('PLAN.json', pin['planSha256']), ('ACCEPTED.json', pin['acceptedSha256'])]:
            _, raw = h.diagnosis_json(directory / filename)
            need(sha(raw) == expected, 'history')
            self.proofs[directory / filename] = raw
        h.generation_reference(reference, receipt['nonce'])
        _, raw = h.diagnosis_json(directory / 'generation' / 'GENERATION.json')
        need(sha(raw) == pin['manifestSha256'], 'history')
        self.proofs[directory / 'generation' / 'GENERATION.json'] = raw
        container = self.initial_containers.get(pin['containerId'])
        if container:
            h.check_mounted_reference(container, reference, receipt['nonce'], require_running=name in ('current', 'rollback'))
        elif name in ('current', 'rollback'):
            need(False, 'container_set')
        self.references[name], self.plans[name] = reference, plan
        return receipt

    def prepare(self, authority):
        h = self.h
        state = self.authority(authority)
        h.regular(h.CONFIG, 1024 * 1024)
        self.ingress = h.CONFIG.read_bytes()
        need(sha(self.ingress) == CAPTURE['ingressSha256'] and h.backend(self.ingress) == 3007, 'ingress')
        self.initial_containers = self.containers()
        self.absent = {row['containerId'] for row in TARGETS} - set(self.initial_containers)
        self.initial_images = self.images()
        self.initial_free = self.free()
        self.history('current', state['current'])
        self.history('rollback', state['rollback'])
        for parent, target in [('current', 'obsoleteB'), ('rollback', 'obsoleteA')]:
            plan = self.plans[parent]
            prior = h.checked_accepted_observation({'found': True, 'value': plan['previousAcceptedState'],
                'etag': plan['previousAcceptedETag'], 'sha256': plan['previousAcceptedStateSha256']})
            need(prior['current'] == self.references['rollback' if parent == 'current' else 'obsoleteB'], 'chain')
            self.history(target, prior['rollback'])
        self.descriptors = {}
        for target in TARGETS:
            rows = [{key: row[key] for key in ('name', 'bytes', 'sha256')}
                    for row in self.plans[target['name']]['files'] if row['name'] in h.HOST_BULK_FILES]
            need(len(rows) == target['files'] and sum(row['bytes'] for row in rows) == target['bytes']
                 and sha(canonical(rows)) == target['descriptorsSha256'], 'descriptors')
            self.descriptors[target['name']] = rows
        self.fence()
        h.health(3006, self.c.ROLLBACK)

    def fence(self):
        self.lease_live()
        h = self.h
        h.regular(h.CONFIG, 1024 * 1024)
        need(h.CONFIG.read_bytes() == self.ingress, 'ingress')
        for filename, raw in self.proofs.items():
            need(h.diagnosis_json(filename)[1] == raw, 'metadata_changed')
        rows = self.containers()
        for name in ('current', 'rollback'):
            reference = self.references[name]
            receipt, _ = h.accepted_reference_receipt(reference)
            h.check_mounted_reference(rows[self.c.HISTORY[name]['containerId']], reference, receipt['nonce'])
        h.health(3007, self.c.CURRENT)
        need(h.CONFIG.read_bytes() == self.ingress, 'ingress')
        return rows

    def free(self):
        value = os.statvfs(self.h.BASE)
        return value.f_bavail * value.f_frsize

    def prepared(self):
        return {'kind': 'obsolete-deployments-retirement-prepared-v1', 'captureReportSha256': CAPTURE['reportSha256'],
                'definitionSha256': sha(canonical(definition())), 'targets': TARGETS,
                'alreadyAbsentContainers': len(self.absent), 'imagesPreserved': len(self.initial_images),
                'diskAvailableBytes': self.initial_free}

    def step(self, message):
        need(isinstance(message, dict) and set(message) == {'action', 'index', 'authority'}
             and message['action'] == 'retire' and type(message['index']) is int
             and message['index'] == self.sequence and self.sequence < len(TARGETS), 'sequence')
        self.authority(message['authority'])
        self.fence()
        target = TARGETS[self.sequence]
        before = self.free()
        self.active = target['containerId']
        self.inflight = True
        result = self.h.retire_reference(self.references[target['name']],
            [self.references['current'], self.references['rollback']],
            {identifier for identifier, _, _ in self.c.CONTAINERS if identifier not in {row['containerId'] for row in TARGETS}}, self.fence)
        need(result.get('retiredContainers') in (0, 1) and result.get('directoriesDeleted') == 0
             and result.get('imagesDeleted') == 0 and type(result.get('filesDeleted')) is int
             and 0 <= result['filesDeleted'] <= target['files'] and type(result.get('freedBytes')) is int
             and 0 <= result['freedBytes'] <= target['bytes'], 'step_result')
        self.absent.add(self.active)
        self.active = None
        rows = self.fence()
        need(target['containerId'] not in rows, 'step_result')
        # The stock helper verifies each existing content hash immediately before unlink.
        receipt, _ = self.h.accepted_reference_receipt(self.references[target['name']])
        directory, _ = self.h.reference_plan(self.references[target['name']], receipt)
        need(all(not ((directory if row['name'] == 'image.tar' else directory / 'generation') / row['name']).exists()
                 and not ((directory if row['name'] == 'image.tar' else directory / 'generation') / row['name']).is_symlink()
                 for row in self.descriptors[target['name']]), 'step_result')
        after = self.free()
        value = {'kind': 'obsolete-deployment-retired-v1', 'index': self.sequence, 'name': target['name'],
            'containerId': target['containerId'], 'retiredContainers': result['retiredContainers'],
            'filesDeleted': result['filesDeleted'], 'verifiedContentBytesDeleted': result['freedBytes'],
            'diskAvailableBytesBefore': before, 'diskAvailableBytesAfter': after, 'measuredFreeBytesChange': after - before,
            'allTargetBulkAbsent': True, 'proofsPreserved': True, 'imagesDeleted': 0, 'directoriesDeleted': 0}
        self.steps.append(value)
        self.sequence += 1
        self.inflight = False
        return value

    def finish(self, message):
        need(isinstance(message, dict) and set(message) == {'action', 'authority'} and message['action'] == 'finish'
             and self.sequence == len(TARGETS), 'finish')
        self.authority(message['authority'])
        rows = self.fence()
        need(self.images() == self.initial_images, 'image_set')
        self.h.health(3006, self.c.ROLLBACK)
        after = self.free()
        return {'kind': 'obsolete-deployments-retirement-result-v1', 'completed': True,
            'captureReportSha256': CAPTURE['reportSha256'], 'definitionSha256': sha(canonical(definition())),
            'currentRuntimeSha': self.c.CURRENT, 'rollbackRuntimeSha': self.c.ROLLBACK,
            'retiredContainers': sum(row['retiredContainers'] for row in self.steps),
            'alreadyAbsentContainers': len(TARGETS) - sum(row['retiredContainers'] for row in self.steps),
            'filesDeleted': sum(row['filesDeleted'] for row in self.steps),
            'verifiedContentBytesDeleted': sum(row['verifiedContentBytesDeleted'] for row in self.steps),
            'diskAvailableBytesBefore': self.initial_free, 'diskAvailableBytesAfter': after,
            'measuredFreeBytesChange': after - self.initial_free, 'remainingContainers': len(rows),
            'imagesPreserved': len(self.initial_images), 'imagesDeleted': 0, 'directoriesDeleted': 0,
            'proofsPreserved': True, 'manifestsPreserved': True, 'ingressUnchanged': True,
            'acceptedStateWrites': 0, 'intentStateWrites': 0, 'generationStorageWrites': 0, 'supplierRequests': 0}

    def close(self):
        if self.lock is not None:
            os.close(self.lock)
            self.lock = None
        if self.h.docker == self.docker:
            self.h.docker = self.original_docker
        if self.h.response_json == self.local_health:
            self.h.response_json = self.original_response


def module_from_source(name, source, digest):
    need(isinstance(source, str) and sha(source.encode()) == digest, 'source')
    module = types.ModuleType(name)
    exec(compile(source, '<reviewed-' + name + '>', 'exec'), module.__dict__)
    return module


def read_message():
    raw = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
    need(0 < len(raw) <= 2 * 1024 * 1024 and raw.endswith(b'\n'), 'input')
    value = json.loads(raw)
    need(isinstance(value, dict), 'input')
    return value


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def main():
    retirement = None
    try:
        message = read_message()
        need(set(message) == {'hostSource', 'hostSourceSha256', 'captureSource', 'captureSourceSha256', 'authority'}, 'input')
        host = module_from_source('release_host', message['hostSource'], message['hostSourceSha256'])
        capture = module_from_source('readonly_definition', message['captureSource'], message['captureSourceSha256'])
        retirement = Retirement(host, capture, message['authority'])
        emit(retirement.prepared())
        for _ in TARGETS:
            emit(retirement.step(read_message()))
        emit(retirement.finish(read_message()))
    except BaseException as error:
        emit({'kind': 'obsolete-deployments-retirement-refused-v1', 'errorCode': safe_error(error),
              'uncertain': bool(retirement and retirement.inflight)})
        return 1
    finally:
        if retirement is not None:
            retirement.close()
    return 0


if __name__ == '__main__':
    if sys.argv[1:] == ['--verify-targets']:
        emit({'definition': definition(), 'definitionSha256': sha(canonical(definition()))})
    elif not sys.argv[1:]:
        sys.exit(main())
    else:
        sys.exit(1)
