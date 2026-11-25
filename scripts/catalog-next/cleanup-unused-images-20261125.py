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
GENERATION = 'gen_china_45369451603_1'
MANIFEST = 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75'
FORBIDDEN_RUNTIMES = {'4302f59a0312f35a64fc3cb9c5b25f9463fa9294',
                      '1518035b9e6b717cd364ae8d13e63d0127899112', CURRENT}
# Immutable plan from read-only inventory45631575364. Two opaque-tag images are
# excluded in addition to the photo candidate and failed-witness image.
TARGETS = json.loads(r'''[
  {
    "id": "sha256:0964a9deb8961628a48e72862a0711789c31f587229cfffc3281371ef94d2583",
    "runtimeSha": "38895e53f7f770ee68edb0b8ad53056468b928a5",
    "created": "2026-11-25T03:01:44.135277672Z",
    "sizeBytes": 258502721,
    "tags": [
      "avtocena-china-runtime:38895e53f7f770ee68edb0b8ad53056468b928a5-2084a654c2f5"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:3b226795c5d36ba9f66330896a426361735d198620a6494bef39a84e80a75b35",
    "runtimeSha": "53af59971f25c7cda6358ee18242ee5e5232eede",
    "created": "2026-11-24T02:28:01.518162343Z",
    "sizeBytes": 1148580378,
    "tags": [],
    "digestCount": 0
  },
  {
    "id": "sha256:3c0389d7fcd0986a850d2f87c3259a75bddff3b0090ed0aef56eb1e190ef2238",
    "runtimeSha": "860e1ff601c6852eb3b1474982e52e3a5300c4af",
    "created": "2026-11-24T16:43:11.02919832Z",
    "sizeBytes": 258502884,
    "tags": [
      "avtocena-china-runtime:860e1ff601c6852eb3b1474982e52e3a5300c4af-59956c5a514e"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:443e87ed141838f003ce6209fc290f4a2435113b7cfb83126e3d88fb6877cf83",
    "runtimeSha": "822f925bb30c4e07010f6e14b6574f1b4bd6306e",
    "created": "2026-11-24T11:17:45.616516099Z",
    "sizeBytes": 258502633,
    "tags": [
      "avtocena-china-runtime:822f925bb30c4e07010f6e14b6574f1b4bd6306e-0dab51e9f00d"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:7a653897f9939b4851dff43c8a54a9327b80979cb7932e3ccd542ee330fff878",
    "runtimeSha": "38895e53f7f770ee68edb0b8ad53056468b928a5",
    "created": "2026-11-25T02:19:22.799930672Z",
    "sizeBytes": 258504104,
    "tags": [
      "avtocena-china-runtime:38895e53f7f770ee68edb0b8ad53056468b928a5-3dbd780a981d"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:7af5df7fa93163687fcb5c0e1ad834176234319de13a4dd92ddc1d954fcc9381",
    "runtimeSha": "5e62f9ff3a0079b07cd13b8ab912c5720dd22250",
    "created": "2026-11-24T15:01:33.067446083Z",
    "sizeBytes": 258503668,
    "tags": [
      "avtocena-china-runtime:5e62f9ff3a0079b07cd13b8ab912c5720dd22250-af64f3ac09bc"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:7c093eedb12cd825ba204d8f3758438a834d5bcece80c7a25f0040e4147159d9",
    "runtimeSha": "38895e53f7f770ee68edb0b8ad53056468b928a5",
    "created": "2026-11-25T00:29:53.461839949Z",
    "sizeBytes": 258504013,
    "tags": [
      "avtocena-china-runtime:38895e53f7f770ee68edb0b8ad53056468b928a5-ff3b423efca6"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:c12a500a0e50fc692701e2f5a28733a6c8a995c241df9d193c294a2cd85cb87d",
    "runtimeSha": "99c45a3b5d8439bbc1ee34702ba41340ada08125",
    "created": "2026-11-24T21:42:55.227269138Z",
    "sizeBytes": 258506424,
    "tags": [
      "avtocena-china-runtime:99c45a3b5d8439bbc1ee34702ba41340ada08125-c895c59fa5d7"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:c883ec9bd2203f5fbdac0da2860826da9ed8cd2233008feb567d128699dcbb54",
    "runtimeSha": "38895e53f7f770ee68edb0b8ad53056468b928a5",
    "created": "2026-11-25T01:14:11.954196209Z",
    "sizeBytes": 258503776,
    "tags": [
      "avtocena-china-runtime:38895e53f7f770ee68edb0b8ad53056468b928a5-315f6bdadda9"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:c8fca211f0b5a7beede7e62ed6384b81ecc2c40f78f948053365392073f0c47e",
    "runtimeSha": "38895e53f7f770ee68edb0b8ad53056468b928a5",
    "created": "2026-11-25T01:46:39.557686491Z",
    "sizeBytes": 258504430,
    "tags": [
      "avtocena-china-runtime:38895e53f7f770ee68edb0b8ad53056468b928a5-e3b116e0ba7b"
    ],
    "digestCount": 1
  },
  {
    "id": "sha256:d2f449d9c410da6d0d7691cac41cd0b8bf1c5f1f9c9d4fe6c149d915edc0f9d0",
    "runtimeSha": "a05987cc725c950614ac7310c7de782b73cb093a",
    "created": "2026-11-23T15:04:11.381504609Z",
    "sizeBytes": 258969747,
    "tags": [],
    "digestCount": 0
  },
  {
    "id": "sha256:fccb762fc99b972d3b2978cdf53213d1ad7232c6787ff27093e1a25b8eb9cc56",
    "runtimeSha": "53af59971f25c7cda6358ee18242ee5e5232eede",
    "created": "2026-11-24T03:17:12.359303525Z",
    "sizeBytes": 258806830,
    "tags": [],
    "digestCount": 0
  }
]''')
CONTAINER_PINS = json.loads(r'''[
  {
    "idPrefix": "21a709391464",
    "imageId": "sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009",
    "running": true
  },
  {
    "idPrefix": "2c180485762c",
    "imageId": "sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba",
    "running": true
  },
  {
    "idPrefix": "52e44ba28107",
    "imageId": "sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8",
    "running": false
  },
  {
    "idPrefix": "e30facd9dc08",
    "imageId": "sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984",
    "running": false
  },
  {
    "idPrefix": "bccda9177f15",
    "imageId": "sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc",
    "running": false
  },
  {
    "idPrefix": "08275f6ff0ee",
    "imageId": "sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb",
    "running": false
  },
  {
    "idPrefix": "c63cde7396b8",
    "imageId": "sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac",
    "running": false
  },
  {
    "idPrefix": "21d2c808c25b",
    "imageId": "sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd",
    "running": true
  },
  {
    "idPrefix": "9bba3f06c068",
    "imageId": "sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f",
    "running": false
  },
  {
    "idPrefix": "c08382956896",
    "imageId": "sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8",
    "running": false
  },
  {
    "idPrefix": "f664adabeed0",
    "imageId": "sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f",
    "running": false
  }
]''')
OBSERVED_IMAGE_IDS = set(json.loads(r'''[
  "sha256:0964a9deb8961628a48e72862a0711789c31f587229cfffc3281371ef94d2583",
  "sha256:0a1d136f6b292f9d027354fe8db3c14e12079e689e3f7b5773a7b014860213ea",
  "sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984",
  "sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f",
  "sha256:3b226795c5d36ba9f66330896a426361735d198620a6494bef39a84e80a75b35",
  "sha256:3c0389d7fcd0986a850d2f87c3259a75bddff3b0090ed0aef56eb1e190ef2238",
  "sha256:443e87ed141838f003ce6209fc290f4a2435113b7cfb83126e3d88fb6877cf83",
  "sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd",
  "sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb",
  "sha256:6c10441c7b9b4a8a0a9f0eef75de1d8bbc7f6bbef889935a40b65cd18d67150e",
  "sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba",
  "sha256:7a653897f9939b4851dff43c8a54a9327b80979cb7932e3ccd542ee330fff878",
  "sha256:7af5df7fa93163687fcb5c0e1ad834176234319de13a4dd92ddc1d954fcc9381",
  "sha256:7b400c45db84145dd591043af255d7bbf41583189eda91fbe268b64b3d427e65",
  "sha256:7c093eedb12cd825ba204d8f3758438a834d5bcece80c7a25f0040e4147159d9",
  "sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8",
  "sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac",
  "sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc",
  "sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8",
  "sha256:c12a500a0e50fc692701e2f5a28733a6c8a995c241df9d193c294a2cd85cb87d",
  "sha256:c60e2b5cb94c4023681aecb74401b30c40582afad4c2ebce00389942501c25ac",
  "sha256:c883ec9bd2203f5fbdac0da2860826da9ed8cd2233008feb567d128699dcbb54",
  "sha256:c8fca211f0b5a7beede7e62ed6384b81ecc2c40f78f948053365392073f0c47e",
  "sha256:d2f449d9c410da6d0d7691cac41cd0b8bf1c5f1f9c9d4fe6c149d915edc0f9d0",
  "sha256:d8e03f29c649c75878e7602bcc2afdc4c71bd38e93ebb86434090b0c4f754a32",
  "sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f",
  "sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009",
  "sha256:fccb762fc99b972d3b2978cdf53213d1ad7232c6787ff27093e1a25b8eb9cc56"
]'''))


def need(value, code):
    if not value:
        raise RuntimeError('unused_images_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprint(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def validate_targets():
    need(len(TARGETS) == 12 and len({r['id'] for r in TARGETS}) == 12, 'target_count')
    for row in TARGETS:
        need(set(row) == {'id', 'runtimeSha', 'created', 'sizeBytes', 'tags', 'digestCount'}
             and re.fullmatch(r'sha256:[a-f0-9]{64}', row['id'])
             and re.fullmatch(r'[a-f0-9]{40}', row['runtimeSha'])
             and row['runtimeSha'] not in FORBIDDEN_RUNTIMES
             and type(row['sizeBytes']) is int and row['sizeBytes'] > 0
             and isinstance(row['tags'], list) and len(row['tags']) <= 1
             and row['digestCount'] == len(row['tags'])
             and all(re.fullmatch(r'avtocena-china-runtime:' + row['runtimeSha'] + r'-[a-f0-9]{12}', tag)
                     for tag in row['tags']), 'target_identity')
    need(len(CONTAINER_PINS) == 11 and len(OBSERVED_IMAGE_IDS) == 28
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
    need(sorted(tags) == sorted(expected['tags']) and len(digests) == expected['digestCount'], 'image_tags')
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
                'planSha256': fingerprint(TARGETS), 'privateStateWrites': 0}

    def step(self, message):
        need(set(message) == {'action', 'index', 'authority'} and message['action'] == 'remove'
             and type(message['index']) is int and message['index'] == self.sequence
             and self.sequence < len(TARGETS), 'sequence')
        self.check_authority(message['authority'])
        rows, images = self.fence()
        expected = TARGETS[self.sequence]
        protected = self.protected | referenced_images(message['authority']['publicationState']) | {row['Image'] for row in rows.values()}
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
              else 'unused_images_host_failed', 'uncertain': bool(cleanup and cleanup.inflight)})
        raise SystemExit(1)
    finally:
        if cleanup is not None:
            cleanup.close()


if __name__ == '__main__':
    main()

