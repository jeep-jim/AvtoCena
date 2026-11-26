"""Remove eight proven cache-only stopped layers; preserve all images, mounts and retained deployments."""
import base64
import datetime
import fcntl
import hashlib
import json
import os
import posixpath
import re
import signal
import stat
import sys
import types
from urllib.parse import quote

CURRENT = 'd536c1547c4d82a339ed68ced7d8503f09b6810b'
GENERATION = 'gen_china_45655051136_1'
MANIFEST = '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d'
ROLLBACK = 'gen_china_45369451603_1'
TARGETS = [{'id': '52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d', 'imageId': 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8', 'configurationSha256': '8987aca675b81ffe0d8e1ca7cc921fcf94ab8992a01f66f62c9a64dfe96cf1a6', 'writableBytes': 1000214528, 'changeCount': 71458, 'runtimeSha': '22867cbcfaee27b2e8917b6bf880e44827f67b60', 'noncacheCount': 8}, {'id': 'e30facd9dc08d28b6e7d8b4423842b027e9b975befcf5bf52de09f29da60d6a7', 'imageId': 'sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984', 'configurationSha256': '2b9a1b4a5c1f871387af9f381b5f788198dccb5b7a46b33993ef98768eb6d7e5', 'writableBytes': 21073920, 'changeCount': 1580, 'runtimeSha': '85296f6b8797aaa93227b69da7e9e9e928e8f9b5', 'noncacheCount': 8}, {'id': 'bccda9177f15d4fa6f511109409e408bd93160b791d6dd15f7d66b66f1497dc9', 'imageId': 'sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc', 'configurationSha256': 'e4601ef38f9af0714cd3a57561044be06f86bc46e7ddb4816992ee285d8af2b9', 'writableBytes': 3756032, 'changeCount': 619, 'runtimeSha': 'f45efaf2b172af41d14987fb642e8e6b6df78cdd', 'noncacheCount': 7}, {'id': '08275f6ff0ee8e9c4b024baae6d7091ae5a266f285ec5b32ef0a0095a61bb854', 'imageId': 'sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb', 'configurationSha256': '72a3b22e3ee196a4d3138c6716072cae7c312aede12a7d54e27806f569e52ddb', 'writableBytes': 3981312, 'changeCount': 664, 'runtimeSha': '7f9165125edc773221da8e17a5ed39f3592db31c', 'noncacheCount': 7}, {'id': 'c63cde7396b895212ed6fe4abbee686caceea9952705758366cae235786de393', 'imageId': 'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac', 'configurationSha256': '5443903c4e707d973b7b183f2be38af609b4b3300c7e1d0a772cd7db5398a290', 'writableBytes': 7606272, 'changeCount': 881, 'runtimeSha': 'e4f2781ed52f12f53430118bea51ef150608ccfe', 'noncacheCount': 7}, {'id': '9bba3f06c0684c7eaba7b15e73fa19b9e71cefd538f08e264792e70a280bc430', 'imageId': 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f', 'configurationSha256': '0b3416be62936d38124da0858d955aa104d91e9c30c0fc3cfdd6414975809ce2', 'writableBytes': 5850570752, 'changeCount': 298666, 'runtimeSha': 'a182cd21b21ecf612b63613d263e5bdd817ea4c0', 'noncacheCount': 7}, {'id': 'c083829568964b058e1a90ea517ceb10df44f6a937a98ee6700d7b5b5976afcf', 'imageId': 'sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8', 'configurationSha256': '3ed8868420f462026d97ecdd8fa8d3ea04ef06749c74aa52aac9a7fa7b013af0', 'writableBytes': 1020809216, 'changeCount': 51161, 'runtimeSha': '17a686182574097b5ade22b37ef8b485e2b53844', 'noncacheCount': 7}, {'id': 'f664adabeed0686ab2feb491fc73495b54420f86c857acc987ec9fed8d2ec01f', 'imageId': 'sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f', 'configurationSha256': '92edc8a0ad8c6f61f57db6064b49d2f76158849b6e0c99bf6ac29a5c9ed19a2f', 'writableBytes': 5065990144, 'changeCount': 249389, 'runtimeSha': '463fd22559a2f9c5acd60f8f5e4b269689215c84', 'noncacheCount': 7}]
RETAINED = [{'id': 'bf233b651cc4c84afae4b59c2f17279ea2db7475bfeef6158ca012315a7f1c23', 'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009', 'running': True}, {'id': '21a7093914645595d2cfcfc26335f8e8dbf155f6906840bbfb72855ed587e1e3', 'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009', 'running': True}, {'id': '2c180485762c286c7e73f983cd0c93a718d9dec5c2f8e442e7ee44c1a51f6729', 'imageId': 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba', 'running': False}, {'id': '21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78', 'imageId': 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 'running': False}]
IMAGE_IDS = set(['sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984', 'sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f', 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 'sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb', 'sha256:6c10441c7b9b4a8a0a9f0eef75de1d8bbc7f6bbef889935a40b65cd18d67150e', 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba', 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8', 'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac', 'sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc', 'sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8', 'sha256:d8e03f29c649c75878e7602bcc2afdc4c71bd38e93ebb86434090b0c4f754a32', 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f', 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009'])
SAFE_DIRECTORIES = frozenset(('/app', '/app/apps', '/app/apps/web', '/app/apps/web/.next',
    '/app/apps/web/.next/cache', '/app/.next', '/run', '/run/avtocena-metrics',
    '/run/avtocena-node-resources', '/run/avtocena-china-generation', '/run/avtocena-china-switch'))
SAFE_LINKS = {'/var/run': '/run', '/var/lock': '/run/lock'}
CACHE_ROOTS = ('/app/.next/cache', '/app/apps/web/.next/cache')


def need(value, code):
    if not value:
        raise RuntimeError('stopped_cleanup_' + code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def validate_targets():
    need(len(TARGETS) == 8 and len({row['id'] for row in TARGETS}) == 8 and len(RETAINED) == 4
         and len(IMAGE_IDS) == 13, 'plan_size')
    need(not ({row['id'] for row in TARGETS} & {row['id'] for row in RETAINED}), 'retained_target')
    for row in TARGETS:
        need(set(row) == {'id', 'imageId', 'runtimeSha', 'configurationSha256', 'writableBytes', 'changeCount', 'noncacheCount'}
             and re.fullmatch(r'[a-f0-9]{64}', row['id']) and row['imageId'] in IMAGE_IDS
             and re.fullmatch(r'[a-f0-9]{40}', row['runtimeSha']) and row['runtimeSha'] != CURRENT
             and re.fullmatch(r'[a-f0-9]{64}', row['configurationSha256'])
             and type(row['writableBytes']) is int and row['writableBytes'] > 0
             and type(row['changeCount']) is int and 0 < row['changeCount'] < 1000000
             and row['noncacheCount'] in (7, 8), 'target_shape')
    for row in RETAINED:
        need(re.fullmatch(r'[a-f0-9]{64}', row['id']) and row['imageId'] in IMAGE_IDS
             and type(row['running']) is bool, 'retained_shape')
    need(sum(row['running'] for row in RETAINED) == 2, 'retained_running')


def image_fingerprint(row):
    value = {key: row.get(key) for key in ('Id', 'Created', 'Size', 'Config', 'RootFS', 'Architecture', 'Os', 'Parent', 'Descriptor')}
    value['RepoTags'] = sorted(row.get('RepoTags') or [])
    value['RepoDigests'] = sorted(row.get('RepoDigests') or [])
    return digest(value)


def referenced_containers(value, depth=0):
    need(depth <= 24, 'reference_depth')
    result = set()
    if isinstance(value, dict):
        for encoded, hashed in (('hostReceiptBase64', 'hostReceiptSha256'), ('hostRollbackBase64', 'hostRollbackSha256')):
            if encoded in value:
                need(isinstance(value[encoded], str) and len(value[encoded]) <= 350000, 'reference_bound')
                raw = base64.b64decode(value[encoded], validate=True)
                need(len(raw) <= 256 * 1024 and sha(raw) == value.get(hashed), 'reference_checksum')
                result.update(referenced_containers(json.loads(raw), depth + 1))
        for key, child in value.items():
            if key in ('containerId', 'retainedContainerId', 'servingContainerId') and isinstance(child, str):
                need(re.fullmatch(r'[a-f0-9]{64}', child), 'reference_identity')
                result.add(child)
            result.update(referenced_containers(child, depth + 1))
    elif isinstance(value, list):
        for child in value:
            result.update(referenced_containers(child, depth + 1))
    return result


def has_container_dependency(target, rows):
    needles = (target['Id'], target['Id'][:12], target.get('Name', '').removeprefix('/'))
    for other in rows.values():
        if other['Id'] == target['Id']:
            continue
        host = other.get('HostConfig') or {}
        values = [host.get(key, '') for key in ('NetworkMode', 'IpcMode', 'PidMode', 'UTSMode')]
        values += list(host.get('VolumesFrom') or []) + list(host.get('Links') or [])
        if any(isinstance(value, str) and any(needle and needle in value for needle in needles) for value in values):
            return True
    return False


def public_image(row, containers):
    labels = row.get('Config', {}).get('Labels') or {}
    runtime = labels.get('org.opencontainers.image.revision')
    tags, digests = sorted(row.get('RepoTags') or []), sorted(row.get('RepoDigests') or [])
    tag_pattern = r'avtocena-(?:regcloud|china-runtime):[a-f0-9]{40}(?:-[a-f0-9]{12})?'
    digest_pattern = r'avtocena-(?:regcloud|china-runtime)@sha256:[a-f0-9]{64}'
    return {'id': row['Id'], 'runtimeSha': runtime if isinstance(runtime, str) and re.fullmatch(r'[a-f0-9]{40}', runtime) else None,
            'sizeBytes': row.get('Size'), 'created': row.get('Created'),
            'applicationOwnerLabel': labels.get('avtocena.application') == 'web',
            'sourceOwnerLabel': labels.get('org.opencontainers.image.source') == 'https://github.com/jeep-jim/AvtoCena',
            'repoTags': [tag for tag in tags if re.fullmatch(tag_pattern, tag)],
            'repoDigests': [value for value in digests if re.fullmatch(digest_pattern, value)],
            'tagCount': len(tags), 'digestCount': len(digests), 'tagsSha256': digest(tags), 'digestsSha256': digest(digests),
            'referencedBy': sorted(identity for identity, container in containers.items() if container['Image'] == row['Id']),
            'retainedBaselinePin': runtime in ('a182cd21b21ecf612b63613d263e5bdd817ea4c0', 'e4f2781ed52f12f53430118bea51ef150608ccfe')}


def public_metadata(path, kind, value):
    result = {'pathSha256': sha(path.encode()), 'changeKind': kind, 'exists': value is not None}
    if path in SAFE_DIRECTORIES or path in SAFE_LINKS:
        result['path'] = path
    if value is not None:
        result.update(mode=value.get('mode'), size=value.get('size'))
        link = value.get('linkTarget')
        if isinstance(link, str) and link:
            result['linkTargetSha256'] = sha(link.encode())
    return result


def safe_noncache(path, kind, value):
    if not isinstance(value, dict) or kind not in (0, 1):
        return False
    mode = value.get('mode')
    if type(mode) is not int or mode < 0 or mode > 0xffffffff:
        return False
    # Go FileMode type bits: directory=31, symlink=27. No regular application
    # files, devices, sockets, dangling links, or unreviewed paths are allowed.
    file_type = mode & 0xfff00000
    if path in SAFE_DIRECTORIES:
        return file_type == 0x80000000 and not value.get('linkTarget')
    return path in SAFE_LINKS and file_type == 0x08000000 and value.get('linkTarget') == SAFE_LINKS[path]


def prove_cache_only(row, target, reader):
    need(row.get('Id') == target['id'] and row.get('Image') == target['imageId']
         and row.get('State', {}).get('Running') is False and row['State'].get('Pid') == 0
         and not any(row['State'].get(key) for key in ('Paused', 'Restarting', 'Dead'))
         and reader.fingerprint(row) == target['configurationSha256']
         and row.get('SizeRw') == target['writableBytes'], 'target_binding')
    hashes, noncache = [], []
    cache_count = 0
    for change in reader.stream_changes(target['id']):
        need(isinstance(change, dict) and set(change) == {'Path', 'Kind'}, 'diff_shape')
        path, kind = change['Path'], change['Kind']
        need(isinstance(path, str) and path.startswith('/') and path == posixpath.normpath(path)
             and '\x00' not in path and len(path) <= 4096 and type(kind) is int and kind in (0, 1, 2), 'diff_shape')
        hashes.append(hashlib.sha256(json.dumps(change, sort_keys=True, separators=(',', ':')).encode()).digest())
        if any(path.startswith(root + '/') for root in CACHE_ROOTS):
            need(kind == 1, 'nonadded_cache')
            cache_count += 1
        else:
            need(len(noncache) < 32, 'noncache_bound')
            noncache.append((path, kind))
    # Stream must be consumed to EOF. A late non-cache file cannot be hidden by a cache sample.
    hashes.sort()
    need(len(hashes) == target['changeCount'] and len(noncache) == target['noncacheCount']
         and all(hashes[index] != hashes[index - 1] for index in range(1, len(hashes))), 'diff_count')
    metadata, allowed = [], True
    for path, kind in sorted(noncache):
        value = reader.api('HEAD', '/containers/' + target['id'] + '/archive?path=' + quote(path, safe=''))
        metadata.append(public_metadata(path, kind, value))
        allowed = safe_noncache(path, kind, value) and allowed
    if not allowed:
        error = RuntimeError('stopped_cleanup_noncache_not_proven')
        error.safePathMetadata = {'containerId': target['id'], 'metadata': metadata}
        raise error
    checksum = hashlib.sha256()
    for item in hashes:
        checksum.update(item)
    return {'containerId': target['id'], 'imageId': target['imageId'], 'writableBytes': row['SizeRw'],
            'changeCount': len(hashes), 'changesComplete': True, 'cacheChangeCount': cache_count,
            'noncacheMetadataComplete': True, 'noncacheMetadata': metadata,
            'changesSha256': checksum.hexdigest(), 'noncacheMetadataSha256': digest(metadata)}


def read():
    raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
    need(raw.endswith(b'\n') and len(raw) <= 1024 * 1024, 'input_bound')
    value = json.loads(raw)
    need(isinstance(value, dict), 'input_object')
    return value


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def module(name, source, checksum):
    need(isinstance(source, str) and sha(source.encode()) == checksum, 'module')
    value = types.ModuleType(name)
    exec(compile(source, name + '.py', 'exec'), value.__dict__)
    return value


class Cleanup:
    def __init__(self, host, inventory, reader, authority):
        validate_targets()
        self.h, self.r, self.c, self.authority = host, inventory, reader, authority
        self.locks, self.removed = [], []
        self.inflight = False
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
        need(state.get('pending') is None and state['current']['runtimeSha'] == CURRENT
             and state['current']['generationId'] == GENERATION and state['current']['generationManifestSha256'] == MANIFEST
             and state.get('rollback', {}).get('runtimeSha') == CURRENT and state['rollback']['generationId'] == ROLLBACK
             and (intent is None or intent.get('status') in ('committed', 'aborted')), 'state')
        need(not ({row['id'] for row in TARGETS} & referenced_containers(authority['publicationState'])), 'authority_reference')
        lease = self.h.checked_observation(authority['lease'])
        need(lease.get('kind') == 'china-market-lease-v1' and lease.get('market') == 'china' and lease.get('status') == 'held'
             and datetime.datetime.fromisoformat(lease['expiresAt'].replace('Z', '+00:00')) > datetime.datetime.now(datetime.timezone.utc), 'lease')
        return state

    def containers(self, size=False):
        listed = self.h.docker('GET', '/containers/json?all=1')
        expected = {row['id'] for row in [*TARGETS, *RETAINED]} - set(self.removed)
        need(isinstance(listed, list) and len(listed) == len(expected) and {row['Id'] for row in listed} == expected, 'container_set')
        target_ids = {row['id'] for row in TARGETS}
        rows = {item['Id']: self.h.docker('GET', '/containers/' + item['Id'] + '/json' +
                ('?size=1' if size and item['Id'] in target_ids else '')) for item in listed}
        for pin in [*TARGETS, *RETAINED]:
            if pin['id'] in self.removed:
                continue
            row = rows[pin['id']]
            need(row.get('Id') == pin['id'] and row.get('Image') == pin['imageId']
                 and row.get('State', {}).get('Running') is pin.get('running', False), 'container_pin')
        return rows

    def images(self):
        listed = self.h.docker('GET', '/images/json?all=1')
        need(isinstance(listed, list) and len(listed) == 13 and {row['Id'] for row in listed} == IMAGE_IDS, 'image_set')
        return {identity: self.h.docker('GET', '/images/' + identity + '/json') for identity in sorted(IMAGE_IDS)}

    def volumes(self):
        value = self.h.docker('GET', '/volumes')
        need(isinstance(value, dict) and isinstance(value.get('Volumes'), (list, type(None))) and not value.get('Warnings'), 'volumes')
        rows = value.get('Volumes') or []
        need(len(rows) <= 128, 'volume_count')
        return sorted([digest({key: row.get(key) for key in ('Name', 'Driver', 'Mountpoint', 'CreatedAt', 'Labels', 'Scope', 'Options')})
                       for row in rows])

    def prepare(self):
        state = self.check_authority(self.authority)
        self.original = self.containers(size=True)
        self.expected = {key: self.r.signature(row) for key, row in self.original.items()}
        self.original_images = self.images()
        self.image_fingerprints = {key: image_fingerprint(row) for key, row in self.original_images.items()}
        self.volume_fingerprints = self.volumes()
        self.proofs, self.protected = [], []
        for reference in (state['current'], state['rollback']):
            receipt = self.h.verified_history(reference)
            directory, _ = self.h.reference_plan(reference, receipt)
            matches = [row for row in self.original.values() if (row.get('Config', {}).get('Labels') or {}).get('avtocena.china.nonce') == receipt['nonce']]
            need(len(matches) == 1 and matches[0]['Id'] in {row['id'] for row in RETAINED if row['running']}, 'protected_container')
            self.h.check_mounted_reference(matches[0], reference, receipt['nonce'])
            self.protected.append((matches[0]['Id'], reference, receipt['nonce']))
            for name in ('PLAN.json', 'ACCEPTED.json', 'generation/GENERATION.json'):
                path = directory / name
                self.h.regular(path, 256 * 1024)
                self.proofs.append((path, self.h.file_sha(path)))
        need(len({value[0] for value in self.protected}) == 2, 'protected_distinct')
        self.current, self.current_nonce = state['current'], self.protected[0][2]
        self.h.verify_live_reference(self.current, self.current_nonce)
        self.ingress, self.routes = self.r.bounded(self.h.CONFIG), self.r.routes()
        for target in TARGETS:
            labels = self.original[target['id']].get('Config', {}).get('Labels') or {}
            need(labels.get('org.opencontainers.image.revision') == target['runtimeSha'], 'runtime_pin')
        self.before_disk, self.before_memory = self.r.disk(), self.r.memory()
        self.fence()
        # Every target is proved safe before the first DELETE, including all
        # non-cache paths. Cache streams never read application file content.
        self.cache_proofs = [prove_cache_only(self.original[target['id']], target, self.c) for target in TARGETS]
        self.fence()

    def unreferenced(self, rows):
        need(self.r.routes() == self.routes and self.r.bounded(self.h.CONFIG) == self.ingress, 'routing_changed')
        connections = self.r.connection_counts()
        references = self.r.service_refs([*rows.values(), *[{**row, 'Id': row['Id'][:12]} for row in rows.values()]])
        for target in TARGETS:
            if target['id'] in self.removed:
                continue
            summary = self.r.container_summary(rows[target['id']], list(rows.values()), self.routes['localPorts'], connections)
            need(not summary['nginxReferencedPorts'] and not summary['dependentContainerIds'] and not references[target['id']]
                 and not references[target['id'][:12]] and not has_container_dependency(rows[target['id']], rows)
                 and not any(summary['establishedConnectionsToPort'].values()), 'target_referenced')

    def fence(self):
        self.check_authority(self.authority)
        rows, images = self.containers(), self.images()
        need({key: self.r.signature(row) for key, row in rows.items()} ==
             {key: value for key, value in self.expected.items() if key not in self.removed}, 'container_changed')
        need({key: image_fingerprint(row) for key, row in images.items()} == self.image_fingerprints, 'image_changed')
        need(self.volumes() == self.volume_fingerprints, 'volumes_changed')
        for path, checksum in self.proofs:
            self.h.regular(path, 256 * 1024)
            need(self.h.file_sha(path) == checksum, 'proof_changed')
        self.unreferenced(rows)
        for identity, reference, nonce in self.protected:
            self.h.check_mounted_reference(rows[identity], reference, nonce)
            ports = self.r.ports(rows[identity])
            need(len(ports) == 1, 'protected_port')
            self.h.health(ports[0], reference['runtimeSha'])
        self.h.verify_live_reference(self.current, self.current_nonce)
        return rows, images

    def prepared(self):
        return {'kind': 'stopped-cache-cleanup-prepared-v1', 'planSha256': digest(TARGETS), 'targets': TARGETS,
                'containersPlanned': 8, 'containersRetained': 4, 'imagesPreserved': 13, 'volumesPreserved': len(self.volume_fingerprints),
                'cacheOnlyProofs': self.cache_proofs, 'plannedWritableBytes': sum(row['writableBytes'] for row in TARGETS),
                'diskBefore': self.before_disk, 'currentGeneration': GENERATION, 'rollbackGeneration': ROLLBACK}

    def step(self, message):
        need(set(message) == {'action', 'index', 'authority'} and message['action'] == 'remove'
             and type(message['index']) is int and message['index'] == len(self.removed) and len(self.removed) < 8, 'sequence')
        self.check_authority(message['authority'])
        self.fence()
        target = TARGETS[len(self.removed)]
        row = self.h.docker('GET', '/containers/' + target['id'] + '/json?size=1')
        need(prove_cache_only(row, target, self.c) == self.cache_proofs[len(self.removed)], 'cache_proof_changed')
        # Recheck references, retained health and all image/mount identities after
        # metadata inspection, immediately before one exact non-forced removal.
        self.fence()
        before = self.r.disk()
        self.inflight = True
        self.h.docker('DELETE', '/containers/' + target['id'] + '?force=false&v=false')
        self.removed.append(target['id'])
        self.fence()
        after = self.r.disk()
        self.inflight = False
        return {'kind': 'stopped-cache-container-removed-v1', 'index': message['index'], 'containerId': target['id'],
                'writableBytes': target['writableBytes'], 'diskBefore': before, 'diskAfter': after,
                'measuredFreeBytesChange': after['availableBytes'] - before['availableBytes'],
                'currentAndRollbackHealthy': True, 'allImagesAndVolumesPreserved': True}

    def finish(self, message):
        need(set(message) == {'action', 'authority'} and message['action'] == 'finish' and len(self.removed) == 8, 'finish')
        self.check_authority(message['authority'])
        rows, images = self.fence()
        after = self.r.disk()
        return {'kind': 'stopped-cache-cleanup-result-v1', 'completed': True, 'removedContainerIds': self.removed,
                'planSha256': digest(TARGETS), 'diskBefore': self.before_disk, 'diskAfter': after,
                'measuredFreeBytesChange': after['availableBytes'] - self.before_disk['availableBytes'],
                'memoryBefore': self.before_memory, 'memoryAfter': self.r.memory(), 'liveRuntimeSha': CURRENT,
                'generationId': GENERATION, 'rollbackGenerationId': ROLLBACK, 'currentAndRollbackHealthy': True,
                'containersRetained': sorted(rows), 'imagesPreserved': len(images), 'volumesPreserved': len(self.volume_fingerprints),
                'images': [public_image(row, rows) for row in images.values()],
                'imagesDeleted': 0, 'hostFilesDeleted': 0, 'volumesDeleted': 0, 'memoryLimitsChanged': 0,
                'acceptedStateWrites': 0, 'intentStateWrites': 0}

    def close(self):
        for descriptor in reversed(self.locks):
            os.close(descriptor)
        self.locks = []


def main():
    validate_targets()
    if sys.argv[1:] == ['--verify-targets']:
        emit({'containersPlanned': 8, 'planSha256': digest(TARGETS)})
        return
    need(not sys.argv[1:], 'arguments')
    def interrupted(*_):
        raise RuntimeError('stopped_cleanup_interrupted')
    for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM, signal.SIGALRM):
        signal.signal(signum, interrupted)
    signal.alarm(900)
    cleanup = None
    try:
        value = read()
        need(set(value) == {'hostSource', 'hostSourceSha256', 'inventorySource', 'inventorySourceSha256',
                            'readerSource', 'readerSourceSha256', 'authority'}, 'bootstrap')
        host = module('stopped_cleanup_host', value['hostSource'], value['hostSourceSha256'])
        inventory = module('stopped_cleanup_inventory', value['inventorySource'], value['inventorySourceSha256'])
        reader = module('stopped_cleanup_reader', value['readerSource'], value['readerSourceSha256'])
        cleanup = Cleanup(host, inventory, reader, value['authority'])
        emit(cleanup.prepared())
        for _ in TARGETS:
            emit(cleanup.step(read()))
        emit(cleanup.finish(read()))
    except BaseException as error:
        code = str(error)
        emit({'errorCode': code if re.fullmatch(r'(?:stopped_cleanup|stopped_layers|resource_inventory|china_host)_[a-z0-9_]{1,140}', code)
              else 'stopped_cleanup_host_failed', 'uncertain': bool(cleanup and cleanup.inflight),
              'removedContainerIds': cleanup.removed if cleanup else [],
              'noncachePathEvidence': getattr(error, 'safePathMetadata', None)})
        raise SystemExit(1)
    finally:
        if cleanup:
            cleanup.close()
        signal.alarm(0)


if __name__ == '__main__':
    main()
