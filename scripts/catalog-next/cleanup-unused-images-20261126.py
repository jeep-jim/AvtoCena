"""Remove only reviewed unused application images; retain every container and private file."""
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
FORBIDDEN_RUNTIMES = {CURRENT, '56d6b94fea70457e0ce2b0820596da9972846b90'}
# Exact unused owned images observed by inventory45757612430; opaque tags remain protected.
TARGETS = [{'id': 'sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea', 'runtimeSha': '1518035b9e6b717cd364ae8d13e63d0127899112', 'created': '2026-11-24T19:19:45.159037575Z', 'sizeBytes': 258504898, 'tags': ['avtocena-china-runtime:1518035b9e6b717cd364ae8d13e63d0127899112-2ccda6dfff61'], 'digestCount': 1, 'digests': ['avtocena-china-runtime@sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea']}, {'id': 'sha256:2e6693575faf62d893cf546a72c81f02cbfe3ffd02746a74da30ce23bfb98753', 'runtimeSha': '36d707bcb599e861918df411e40d8947074f0430', 'created': '2026-11-25T19:38:24.100731673Z', 'sizeBytes': 258503868, 'tags': ['avtocena-china-runtime:36d707bcb599e861918df411e40d8947074f0430-1ba2c0080f30'], 'digestCount': 1, 'digests': ['avtocena-china-runtime@sha256:2e6693575faf62d893cf546a72c81f02cbfe3ffd02746a74da30ce23bfb98753']}, {'id': 'sha256:7b400c45db84145dd591043af255d7bbf41583189eda91fbe268b64b3d427e65', 'runtimeSha': '4302f59a0312f35a64fc3cb9c5b25f9463fa9294', 'created': '2026-11-25T12:20:38.926399807Z', 'sizeBytes': 258506545, 'tags': ['avtocena-china-runtime:4302f59a0312f35a64fc3cb9c5b25f9463fa9294-ccc99139f158'], 'digestCount': 1, 'digests': ['avtocena-china-runtime@sha256:7b400c45db84145dd591043af255d7bbf41583189eda91fbe268b64b3d427e65']}, {'id': 'sha256:c60e2b5cb94c4023681aecb74401b30c40582afad4c2ebce00389942501c25ac', 'runtimeSha': '4302f59a0312f35a64fc3cb9c5b25f9463fa9294', 'created': '2026-11-25T13:23:19.465588516Z', 'sizeBytes': 258502101, 'tags': ['avtocena-china-runtime:4302f59a0312f35a64fc3cb9c5b25f9463fa9294-a58a2b6b819b'], 'digestCount': 1, 'digests': ['avtocena-china-runtime@sha256:c60e2b5cb94c4023681aecb74401b30c40582afad4c2ebce00389942501c25ac']}]
CONTAINER_PINS = [{'idPrefix': 'bf233b651cc4', 'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009', 'running': True}, {'idPrefix': '21a709391464', 'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009', 'running': True}, {'idPrefix': '2c180485762c', 'imageId': 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba', 'running': False}, {'idPrefix': '52e44ba28107', 'imageId': 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8', 'running': False}, {'idPrefix': 'e30facd9dc08', 'imageId': 'sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984', 'running': False}, {'idPrefix': 'bccda9177f15', 'imageId': 'sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc', 'running': False}, {'idPrefix': '08275f6ff0ee', 'imageId': 'sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb', 'running': False}, {'idPrefix': 'c63cde7396b8', 'imageId': 'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac', 'running': False}, {'idPrefix': '21d2c808c25b', 'imageId': 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 'running': False}, {'idPrefix': '9bba3f06c068', 'imageId': 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f', 'running': False}, {'idPrefix': 'c08382956896', 'imageId': 'sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8', 'running': False}, {'idPrefix': 'f664adabeed0', 'imageId': 'sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f', 'running': False}]
OBSERVED_IMAGE_IDS = set(['sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea', 'sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984', 'sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f', 'sha256:2e6693575faf62d893cf546a72c81f02cbfe3ffd02746a74da30ce23bfb98753', 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 'sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb', 'sha256:6c10441c7b9b4a8a0a9f0eef75de1d8bbc7f6bbef889935a40b65cd18d67150e', 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba', 'sha256:7b400c45db84145dd591043af255d7bbf41583189eda91fbe268b64b3d427e65', 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8', 'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac', 'sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc', 'sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8', 'sha256:c60e2b5cb94c4023681aecb74401b30c40582afad4c2ebce00389942501c25ac', 'sha256:d8e03f29c649c75878e7602bcc2afdc4c71bd38e93ebb86434090b0c4f754a32', 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f', 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009'])


def need(value, code):
    if not value:
        raise RuntimeError('unused_images_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprint(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def validate_targets():
    need(len(TARGETS) == 4 and len({r['id'] for r in TARGETS}) == 4, 'target_count')
    for row in TARGETS:
        need(set(row) == {'id', 'runtimeSha', 'created', 'sizeBytes', 'tags', 'digestCount', 'digests'}
             and re.fullmatch(r'sha256:[a-f0-9]{64}', row['id'])
             and re.fullmatch(r'[a-f0-9]{40}', row['runtimeSha'])
             and row['runtimeSha'] not in FORBIDDEN_RUNTIMES
             and type(row['sizeBytes']) is int and row['sizeBytes'] > 0
             and isinstance(row['tags'], list) and len(row['tags']) <= 1
             and row['digestCount'] == len(row['tags']) and row['digests'] == ['avtocena-china-runtime@' + row['id']]
             and all(re.fullmatch(r'avtocena-china-runtime:' + row['runtimeSha'] + r'-[a-f0-9]{12}', tag)
                     for tag in row['tags']), 'target_identity')
    need(len(CONTAINER_PINS) == 12 and len(OBSERVED_IMAGE_IDS) == 17
         and {r['id'] for r in TARGETS}.issubset(OBSERVED_IMAGE_IDS), 'inventory_identity')


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
         and labels.get('org.opencontainers.image.revision') == expected['runtimeSha'], 'image_identity')
    need(labels.get('org.opencontainers.image.source') == 'https://github.com/jeep-jim/AvtoCena'
         and labels.get('avtocena.application') == 'web'
         and row.get('Os') == 'linux' and row.get('Architecture') == 'amd64', 'image_owner')
    need(row['Id'] not in protected and expected['runtimeSha'] not in FORBIDDEN_RUNTIMES
         and not policy.pinned_image(row), 'protected_image')
    tags, digests = row.get('RepoTags') or [], row.get('RepoDigests') or []
    need(sorted(tags) == sorted(expected['tags']) and len(digests) == expected['digestCount']
         and sorted(digests) == sorted(expected['digests']), 'image_tags')
    repositories = {tag.split(':', 1)[0] for tag in tags}
    need(all(isinstance(item, str) and re.fullmatch(r'avtocena-china-runtime@sha256:[a-f0-9]{64}', item)
             and item.split('@', 1)[0] in repositories for item in digests), 'image_digest_scope')


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
            matching = [row for identifier, row in output.items() if identifier.startswith(pin['idPrefix'])]
            need(len(matching) == 1 and matching[0]['Image'] == pin['imageId']
                 and matching[0].get('State', {}).get('Running') is pin['running'], 'container_pin')
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
        self.release_completed_candidate_reference(state)
        for reference in (state['current'], state.get('rollback')):
            if reference is None:
                continue
            receipt = h.verified_history(reference)
            directory, _ = h.reference_plan(reference, receipt)
            h.generation_reference(reference, receipt['nonce'])
            for name in ('PLAN.json', 'ACCEPTED.json'):
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

    def release_completed_candidate_reference(self, state):
        # A resolved failed attempt is historical evidence. This single reviewed
        # exception requires its original rollback AND completed bulk cleanup.
        runtime = '36d707bcb599e861918df411e40d8947074f0430'
        image = 'sha256:2e6693575faf62d893cf546a72c81f02cbfe3ffd02746a74da30ce23bfb98753'
        expected = {'PLAN.json': '1b8455abcd8512467f31bc0e2735922536cee40d933084ae3934ef38515c99dc',
                    'ROLLED_BACK.json': '783809d2dc846fbac6c01699f5419345bb61eca77c6542d304eb283fed0d74e6',
                    'FAILED_CODE_CLEANUP.json': '4488f9fc79ce54859d92a952f73426973e9e3df7555e0ba3daee5b126570f2da'}
        home = self.h.BASE / runtime / 'china-next'
        self.h.private_directory(home)
        directories = list(home.iterdir())
        need(len(directories) <= 64, 'closed_candidate_bound')
        matches = []
        for directory in directories:
            if not re.fullmatch(r'[a-f0-9]{32}', directory.name) or not directory.is_dir() or directory.is_symlink():
                continue
            filename = directory / 'PLAN.json'
            if filename.exists() and self.h.file_sha(filename) == expected['PLAN.json']:
                matches.append(directory)
        need(len(matches) == 1, 'closed_candidate_match')
        directory = matches[0]
        self.h.private_directory(directory)
        values = {}
        for name, checksum in expected.items():
            value, raw = self.h.diagnosis_json(directory / name)
            need(sha(raw) == checksum, 'closed_candidate_proof')
            values[name] = value
            self.proof_files.append((directory / name, checksum))
        plan, rollback, cleanup = (values[name] for name in expected)
        need(not (directory / 'ACCEPTED.json').exists() and plan.get('runtimeSha') == runtime and plan.get('imageId') == image
             and plan.get('generationId') == GENERATION and plan.get('generationManifestSha256') == MANIFEST
             and plan.get('nonce') == directory.name == rollback.get('nonce') == cleanup.get('nonce')
             and isinstance(plan.get('previousAcceptedState'), dict), 'closed_candidate_plan')
        need(rollback.get('kind') == 'china-host-rollback-v1' and rollback.get('release') == runtime
             and rollback.get('imageId') == image and rollback.get('retainedRuntimeSha') == CURRENT
             and rollback.get('retainedImageId') == state['current']['imageId']
             and all(rollback.get(key) is True for key in ('retainedRunning', 'candidateRemoved', 'ingressRestored')), 'closed_candidate_rollback')
        need(cleanup.get('kind') == 'china-failed-code-bulk-cleanup-v1' and cleanup.get('runtimeSha') == runtime
             and cleanup.get('completed') is True and cleanup.get('protectedDeploymentsPreserved') is True
             and cleanup.get('planSha256') == expected['PLAN.json'] and cleanup.get('rollbackSha256') == expected['ROLLED_BACK.json'],
             'closed_candidate_cleanup')
        intent = self.authority['publicationState']['intent'].get('value')
        previous = plan['previousAcceptedState']
        unreserved = state == previous and image not in self.protected
        resolution = (intent or {}).get('resolution') or {}
        rollback_state = state == {**previous, 'revision': previous['revision'] + 2, 'pending': None}
        matching_intent = bool(intent and intent.get('candidate', {}).get('imageId') == image
            and intent.get('status') == 'aborted' and intent.get('nonce') == plan['nonce']
            and intent.get('previous', {}).get('value') == previous
            and intent.get('previous', {}).get('etag') == plan['previousAcceptedETag']
            and intent.get('previous', {}).get('sha256') == plan['previousAcceptedStateSha256']
            and resolution.get('kind') == 'rolled_back'
            and resolution.get('rollbackProof', {}).get('hostRollbackSha256') == expected['ROLLED_BACK.json'])
        diagnostic = {'previousRevision': previous['revision'], 'currentRevision': state['revision'],
          'currentEqualsPrevious': state == previous, 'exactRolledBackState': rollback_state,
          'matchingResolvedRollbackIntent': matching_intent, 'imageReferencedByAuthority': image in self.protected,
          'currentValueSha256': fingerprint(state), 'previousValueSha256': fingerprint(previous)}
        if not (unreserved or (rollback_state and matching_intent)):
            error = RuntimeError('unused_images_closed_candidate_state')
            error.safeDiagnostics = diagnostic
            raise error
        self.closed_candidate_state_binding = {**diagnostic,
          'mode': 'pre_reservation_exact_state' if unreserved else 'reserved_exact_rollback'}
        need(image not in referenced_images(state), 'closed_candidate_accepted')
        self.protected.discard(image)
        self.closed_candidate_proof = {'runtimeSha': runtime, 'imageId': image, 'proofSha256': expected}

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
        return rows, images

    def prepared(self):
        return {'kind': 'unused-images-prepared-v1', 'targets': TARGETS, 'imagesPlanned': len(TARGETS),
                'containersPreserved': len(self.original_containers), 'diskFreeBytesBefore': self.before,
                'planSha256': fingerprint(TARGETS), 'privateStateWrites': 0, 'closedCandidateProof': self.closed_candidate_proof, 'closedCandidateStateBinding': self.closed_candidate_state_binding}

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
        value = {'kind': 'unused-image-removed-v1', 'index': self.sequence, 'imageId': expected['id'],
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
        return {'kind': 'unused-images-result-v1', 'completed': True, 'imagesRemoved': self.removed,
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
        host = module_from_source('unused_images_verified_host', value['hostSource'], value['hostSourceSha256'])
        policy = module_from_source('unused_images_retention_policy', value['policySource'], value['policySourceSha256'])
        cleanup = Cleanup(host, policy, value['authority'])
        emit(cleanup.prepared())
        for _ in TARGETS:
            emit(cleanup.step(read_message()))
        emit(cleanup.finish(read_message()))
    except BaseException as error:
        code = str(error)
        emit({'errorCode': code if re.fullmatch(r'(?:unused_images|china_host)_[a-z0-9_]{1,140}', code)
              else 'unused_images_host_failed', 'uncertain': bool(cleanup and cleanup.inflight),
              'closedCandidateStateCheck': getattr(error, 'safeDiagnostics', None)})
        raise SystemExit(1)
    finally:
        if cleanup is not None:
            cleanup.close()


if __name__ == '__main__':
    main()

