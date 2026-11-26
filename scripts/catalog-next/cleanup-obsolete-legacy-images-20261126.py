"""Remove six exact obsolete legacy images after cache-layer cleanup; preserve four retained containers and every private file."""
import base64
import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import types
from pathlib import Path

CURRENT = 'd536c1547c4d82a339ed68ced7d8503f09b6810b'
GENERATION = 'gen_china_45655051136_1'
MANIFEST = '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d'
FORBIDDEN_RUNTIMES = {CURRENT, '56d6b94fea70457e0ce2b0820596da9972846b90', '83ff17075e9188dcf227c8752dc064248d5f42e0', 'a182cd21b21ecf612b63613d263e5bdd817ea4c0', 'e4f2781ed52f12f53430118bea51ef150608ccfe'}
# Exact legacy images: canonical inventory and fresh post-cache-cleanup metadata must agree.
TARGETS = [{'id': 'sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984', 'runtimeSha': '85296f6b8797aaa93227b69da7e9e9e928e8f9b5', 'created': '2026-11-20T09:06:59.403273852Z', 'sizeBytes': 270357382, 'tags': ['avtocena-regcloud:85296f6b8797aaa93227b69da7e9e9e928e8f9b5'], 'digestCount': 1, 'digests': ['avtocena-regcloud@sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984']}, {'id': 'sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f', 'runtimeSha': '463fd22559a2f9c5acd60f8f5e4b269689215c84', 'created': '2026-11-08T02:06:00.485738176Z', 'sizeBytes': 270241578, 'tags': ['avtocena-regcloud:463fd22559a2f9c5acd60f8f5e4b269689215c84'], 'digestCount': 1, 'digests': ['avtocena-regcloud@sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f']}, {'id': 'sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb', 'runtimeSha': '7f9165125edc773221da8e17a5ed39f3592db31c', 'created': '2026-11-16T10:13:25.078343907Z', 'sizeBytes': 1394114995, 'tags': ['avtocena-regcloud:7f9165125edc773221da8e17a5ed39f3592db31c'], 'digestCount': 1, 'digests': ['avtocena-regcloud@sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb']}, {'id': 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8', 'runtimeSha': '22867cbcfaee27b2e8917b6bf880e44827f67b60', 'created': '2026-11-20T11:44:40.733942543Z', 'sizeBytes': 270355678, 'tags': ['avtocena-regcloud:22867cbcfaee27b2e8917b6bf880e44827f67b60'], 'digestCount': 1, 'digests': ['avtocena-regcloud@sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8']}, {'id': 'sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc', 'runtimeSha': 'f45efaf2b172af41d14987fb642e8e6b6df78cdd', 'created': '2026-11-17T07:59:38.869035488Z', 'sizeBytes': 1394119194, 'tags': ['avtocena-regcloud:f45efaf2b172af41d14987fb642e8e6b6df78cdd'], 'digestCount': 1, 'digests': ['avtocena-regcloud@sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc']}, {'id': 'sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8', 'runtimeSha': '17a686182574097b5ade22b37ef8b485e2b53844', 'created': '2026-11-11T02:40:14.311441812Z', 'sizeBytes': 270242944, 'tags': ['avtocena-regcloud:17a686182574097b5ade22b37ef8b485e2b53844'], 'digestCount': 1, 'digests': ['avtocena-regcloud@sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8']}]
CONTAINER_PINS = [{'id': 'bf233b651cc4c84afae4b59c2f17279ea2db7475bfeef6158ca012315a7f1c23', 'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009', 'running': True}, {'id': '21a7093914645595d2cfcfc26335f8e8dbf155f6906840bbfb72855ed587e1e3', 'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009', 'running': True}, {'id': '2c180485762c286c7e73f983cd0c93a718d9dec5c2f8e442e7ee44c1a51f6729', 'imageId': 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba', 'running': False}, {'id': '21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78', 'imageId': 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 'running': False}]
OBSERVED_IMAGE_IDS = set(['sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984', 'sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f', 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 'sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb', 'sha256:6c10441c7b9b4a8a0a9f0eef75de1d8bbc7f6bbef889935a40b65cd18d67150e', 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba', 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8', 'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac', 'sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc', 'sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8', 'sha256:d8e03f29c649c75878e7602bcc2afdc4c71bd38e93ebb86434090b0c4f754a32', 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f', 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009'])


def need(value, code):
    if not value:
        raise RuntimeError('legacy_images_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprint(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def validate_targets():
    need(len(TARGETS) == 6 and len({r['id'] for r in TARGETS}) == 6, 'target_count')
    for row in TARGETS:
        need(set(row) == {'id', 'runtimeSha', 'created', 'sizeBytes', 'tags', 'digestCount', 'digests'}
             and re.fullmatch(r'sha256:[a-f0-9]{64}', row['id'])
             and re.fullmatch(r'[a-f0-9]{40}', row['runtimeSha']) and row['runtimeSha'] not in FORBIDDEN_RUNTIMES
             and type(row['sizeBytes']) is int and row['sizeBytes'] > 0
             and row['tags'] == ['avtocena-regcloud:' + row['runtimeSha']]
             and row['digestCount'] == 1 and row['digests'] == ['avtocena-regcloud@' + row['id']], 'target_identity')
    need(len(CONTAINER_PINS) == 4 and len(OBSERVED_IMAGE_IDS) == 13
         and {r['id'] for r in TARGETS}.issubset(OBSERVED_IMAGE_IDS)
         and not ({r['id'] for r in TARGETS} & {r['imageId'] for r in CONTAINER_PINS}), 'inventory_identity')


def image_fingerprint(row):
    keys = ('Id', 'Created', 'Size', 'Config', 'RootFS', 'Architecture', 'Os', 'Parent', 'Descriptor')
    values = {key: row.get(key) for key in keys}
    values['RepoTags'] = sorted(row.get('RepoTags') or [])
    values['RepoDigests'] = sorted(row.get('RepoDigests') or [])
    return fingerprint(values)


def container_fingerprint(row, host):
    values = {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Created', 'RestartCount')}
    values['Mounts'] = host.canonical_mounts(row.get('Mounts', []))
    values['State'] = {key: row.get('State', {}).get(key) for key in
                       ('Status', 'Running', 'Paused', 'Restarting', 'Dead', 'Pid', 'ExitCode',
                        'OOMKilled', 'StartedAt', 'FinishedAt')}
    return fingerprint(values)


def referenced_images(value, depth=0):
    need(depth <= 24, 'reference_depth')
    result = set()
    if isinstance(value, dict):
        for encoded, hashed in (('hostReceiptBase64', 'hostReceiptSha256'),
                                ('hostRollbackBase64', 'hostRollbackSha256')):
            if encoded in value:
                need(isinstance(value[encoded], str) and len(value[encoded]) <= 350000
                     and re.fullmatch(r'[a-f0-9]{64}', value.get(hashed, '')), 'reference_proof')
                raw = base64.b64decode(value[encoded], validate=True)
                need(len(raw) <= 256 * 1024 and sha(raw) == value[hashed], 'reference_proof_hash')
                result.update(referenced_images(json.loads(raw), depth + 1))
        for key, child in value.items():
            if key in ('imageId', 'retainedImageId') and isinstance(child, str):
                need(re.fullmatch(r'sha256:[a-f0-9]{64}', child), 'reference_image')
                result.add(child)
            result.update(referenced_images(child, depth + 1))
    elif isinstance(value, list):
        for child in value:
            result.update(referenced_images(child, depth + 1))
    return result


def validate_image(row, expected, protected, policy):
    labels = row.get('Config', {}).get('Labels') or {}
    need(row.get('Id') == expected['id'] and row.get('Created') == expected['created']
         and row.get('Size') == expected['sizeBytes']
         and labels.get('org.opencontainers.image.revision') == expected['runtimeSha']
         and row.get('Os') == 'linux' and row.get('Architecture') == 'amd64', 'image_identity')
    need(sorted(row.get('RepoTags') or []) == expected['tags']
         and sorted(row.get('RepoDigests') or []) == expected['digests'], 'image_tags')
    need(row['Id'] not in protected and expected['runtimeSha'] not in FORBIDDEN_RUNTIMES
         and not policy.pinned_image(row), 'protected_image')
    # Use the established legacy ownership policy, which proves exact repository,
    # runtime tag/digest and age even for older images without newer OCI owner labels.
    need(policy.owned_application_image(row)
         and policy.eligible_unused_image(row, protected, datetime.datetime.now(datetime.timezone.utc)), 'image_owner')


def read_message():
    raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
    need(raw.endswith(b'\n') and len(raw) <= 1024 * 1024, 'input_bound')
    value = json.loads(raw)
    need(isinstance(value, dict), 'input_object')
    return value


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


class Cleanup:
    def __init__(self, host, policy, authority):
        validate_targets()
        self.h, self.policy, self.authority = host, policy, authority
        self.locks = []
        self.removed = []
        self.sequence = 0
        self.inflight = False
        self.steps = []
        self.check_authority(authority)
        # Same order as established application retention and preparation.
        for name in ('avtocena-staging-prepare', 'avtocena-runtime-change'):
            descriptor = os.open('/run/lock/' + name + '.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            self.locks.append(descriptor)
            info = os.fstat(descriptor)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'lock_identity')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.prepare()

    def free(self):
        usage = os.statvfs(self.h.BASE)
        return usage.f_bavail * usage.f_frsize

    def check_authority(self, authority):
        need(isinstance(authority, dict) and set(authority) == {'publicationState', 'lease'}
             and authority == self.authority, 'authority_changed')
        state, intent = self.h.checked_publication_view(authority['publicationState'])
        need(state.get('pending') is None and state['current']['runtimeSha'] == CURRENT
             and state['current']['generationId'] == GENERATION
             and state['current']['generationManifestSha256'] == MANIFEST
             and state.get('rollback', {}).get('runtimeSha') == CURRENT
             and state['rollback']['generationId'] == 'gen_china_45369451603_1'
             and (intent is None or intent.get('status') in ('committed', 'aborted')), 'state')
        lease = self.h.checked_observation(authority['lease'])
        need(lease.get('kind') == 'china-market-lease-v1' and lease.get('market') == 'china'
             and lease.get('status') == 'held'
             and datetime.datetime.fromisoformat(lease['expiresAt'].replace('Z', '+00:00'))
                 > datetime.datetime.now(datetime.timezone.utc), 'lease')
        return state

    def containers(self):
        rows = self.h.docker('GET', '/containers/json?all=1')
        need(isinstance(rows, list) and len(rows) == len(CONTAINER_PINS), 'container_count')
        output = {}
        for item in rows:
            row = self.h.docker('GET', '/containers/' + item['Id'] + '/json')
            need(re.fullmatch(r'[a-f0-9]{64}', row.get('Id', '')) and row['Id'] not in output, 'container_id')
            output[row['Id']] = row
        for pin in CONTAINER_PINS:
            row = output.get(pin['id'])
            need(row is not None and row['Image'] == pin['imageId']
                 and row.get('State', {}).get('Running') is pin['running'], 'container_pin')
        return output

    def images(self):
        rows = self.h.docker('GET', '/images/json?all=1')
        need(isinstance(rows, list) and len(rows) <= 150, 'image_bound')
        ids = {item['Id'] for item in rows}
        need(len(ids) == len(rows) and ids == OBSERVED_IMAGE_IDS - set(self.removed), 'image_set_changed')
        return {identifier: self.h.docker('GET', '/images/' + identifier + '/json') for identifier in sorted(ids)}

    def prepare(self):
        h = self.h
        state = self.check_authority(self.authority)
        self.protected = referenced_images(self.authority['publicationState'])
        self.proof_files = []
        self.protected_containers = []
        for reference in (state['current'], state.get('rollback')):
            if reference is None:
                continue
            receipt = h.verified_history(reference)
            directory, _ = h.reference_plan(reference, receipt)
            h.generation_reference(reference, receipt['nonce'])
            containers = self.containers()
            matches = [row for row in containers.values() if (row.get('Config', {}).get('Labels') or {}).get('avtocena.china.nonce') == receipt['nonce']]
            need(len(matches) == 1, 'protected_container')
            h.check_mounted_reference(matches[0], reference, receipt['nonce'])
            self.protected_containers.append((matches[0]['Id'], reference, receipt['nonce']))
            for name in ('PLAN.json', 'ACCEPTED.json', 'generation/GENERATION.json'):
                filename = directory / name
                h.regular(filename, 256 * 1024)
                self.proof_files.append((filename, h.file_sha(filename)))
            if reference == state['current']:
                self.current, self.current_nonce = reference, receipt['nonce']
        self.live = h.verify_live_reference(self.current, self.current_nonce)
        self.ingress = h.CONFIG.read_bytes()
        self.original_containers = self.containers()
        self.container_fingerprints = {key: container_fingerprint(row, h) for key, row in self.original_containers.items()}
        self.protected.update(row['Image'] for row in self.original_containers.values())
        self.original_images = self.images()
        self.image_fingerprints = {key: image_fingerprint(row) for key, row in self.original_images.items()}
        for expected in TARGETS:
            validate_image(self.original_images[expected['id']], expected, self.protected, self.policy)
        self.before = self.free()
        self.fence()

    def fence(self):
        h = self.h
        self.check_authority(self.authority)
        need(h.CONFIG.read_bytes() == self.ingress, 'ingress_changed')
        rows = self.containers()
        need({key: container_fingerprint(row, h) for key, row in rows.items()} == self.container_fingerprints,
             'container_changed')
        images = self.images()
        expected = {key: value for key, value in self.image_fingerprints.items() if key not in self.removed}
        need({key: image_fingerprint(row) for key, row in images.items()} == expected, 'image_changed')
        for filename, digest in self.proof_files:
            h.regular(filename, 256 * 1024)
            need(h.file_sha(filename) == digest, 'accepted_proof_changed')
        for identity, reference, nonce in self.protected_containers:
            h.check_mounted_reference(rows[identity], reference, nonce)
            ports = {int(value['HostPort']) for values in (rows[identity].get('HostConfig', {}).get('PortBindings') or {}).values()
                     for value in (values or []) if str(value.get('HostPort', '')).isdigit()}
            need(len(ports) == 1, 'protected_port')
            h.health(next(iter(ports)), reference['runtimeSha'])
        h.verify_live_reference(self.current, self.current_nonce)
        return rows, images

    def prepared(self):
        return {'kind': 'legacy-images-prepared-v1', 'targets': TARGETS, 'imagesPlanned': len(TARGETS),
                'containersPreserved': len(self.original_containers), 'diskFreeBytesBefore': self.before,
                'planSha256': fingerprint(TARGETS), 'privateStateWrites': 0}

    def step(self, message):
        need(set(message) == {'action', 'index', 'authority'} and message['action'] == 'remove'
             and type(message['index']) is int and message['index'] == self.sequence
             and self.sequence < len(TARGETS), 'sequence')
        self.check_authority(message['authority'])
        rows, images = self.fence()
        expected = TARGETS[self.sequence]
        protected = self.protected | referenced_images(self.check_authority(message['authority'])) | {row['Image'] for row in rows.values()}
        validate_image(images[expected['id']], expected, protected, self.policy)
        self.h.verify_live_reference(self.current, self.current_nonce)
        before = self.free()
        self.inflight = True
        result = self.h.docker('DELETE', '/images/' + expected['id'] + '?force=false&noprune=true')
        need(isinstance(result, list), 'delete_reply')
        self.removed.append(expected['id'])
        self.fence()
        self.h.verify_live_reference(self.current, self.current_nonce)
        after = self.free()
        self.inflight = False
        value = {'kind': 'legacy-image-removed-v1', 'index': self.sequence, 'imageId': expected['id'],
                 'diskFreeBytesBefore': before, 'diskFreeBytesAfter': after, 'measuredFreeBytesChange': after - before}
        self.steps.append(value)
        self.sequence += 1
        return value

    def finish(self, message):
        need(set(message) == {'action', 'authority'} and message['action'] == 'finish'
             and self.sequence == len(TARGETS), 'finish')
        self.check_authority(message['authority'])
        self.fence()
        self.h.verify_live_reference(self.current, self.current_nonce)
        after = self.free()
        return {'kind': 'legacy-images-result-v1', 'completed': True, 'imagesRemoved': self.removed,
                'diskFreeBytesBefore': self.before, 'diskFreeBytesAfter': after,
                'measuredFreeBytesChange': after - self.before, 'containersPreserved': len(self.original_containers),
                'containersDeleted': 0, 'filesDeleted': 0, 'volumesDeleted': 0,
                'acceptedStateWrites': 0, 'intentStateWrites': 0,
                'liveRuntimeSha': CURRENT, 'generationId': GENERATION, 'planSha256': fingerprint(TARGETS)}

    def close(self):
        for descriptor in reversed(self.locks):
            os.close(descriptor)
        self.locks = []


def module_from_source(name, raw, expected):
    need(isinstance(raw, str) and sha(raw.encode()) == expected, 'source')
    result = types.ModuleType(name)
    exec(compile(raw, name + '.py', 'exec'), result.__dict__)
    return result


def main():
    validate_targets()
    if sys.argv[1:] == ['--verify-targets']:
        emit({'imagesPlanned': len(TARGETS), 'planSha256': fingerprint(TARGETS)})
        return
    need(not sys.argv[1:], 'arguments')
    cleanup = None
    try:
        value = read_message()
        need(set(value) == {'hostSource', 'hostSourceSha256', 'policySource', 'policySourceSha256', 'authority'}, 'bootstrap')
        host = module_from_source('legacy_images_verified_host', value['hostSource'], value['hostSourceSha256'])
        policy = module_from_source('legacy_images_retention_policy', value['policySource'], value['policySourceSha256'])
        cleanup = Cleanup(host, policy, value['authority'])
        emit(cleanup.prepared())
        for _ in TARGETS:
            emit(cleanup.step(read_message()))
        emit(cleanup.finish(read_message()))
    except BaseException as error:
        code = str(error)
        emit({'errorCode': code if re.fullmatch(r'(?:legacy_images|china_host)_[a-z0-9_]{1,140}', code)
              else 'legacy_images_host_failed', 'uncertain': bool(cleanup and cleanup.inflight),
              'removedImageIds': cleanup.removed if cleanup else []})
        raise SystemExit(1)
    finally:
        if cleanup is not None:
            cleanup.close()


if __name__ == '__main__':
    main()

