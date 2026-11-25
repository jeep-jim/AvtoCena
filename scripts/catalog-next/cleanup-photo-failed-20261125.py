"""Exact failed photo-release database copies; no recursive deletion or Docker mutation."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import types

CURRENT = 'd536c1547c4d82a339ed68ced7d8503f09b6810b'
FAILED = '4302f59a0312f35a64fc3cb9c5b25f9463fa9294'
GENERATION = 'gen_china_45369451603_1'
MANIFEST = 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75'
CONTROLLERS = {'118ce5777e3be3a18f99c902db20202f8476d51a', 'a32ead4127d8a57c18e39fe088f8708ea2c02156'}
FILES = ('details.sqlite', 'query.sqlite')
# Read-only inventory run45627566167: the second attempt has malformed rollback
# evidence and is deliberately excluded. Only this fully rolled-back copy qualifies.
TARGETS = [{'attemptHash': '106d43b93feba748',
            'controllerSha': '118ce5777e3be3a18f99c902db20202f8476d51a',
            'planSha256': '05e398d98be77b082d713da7a0984ecfce11733f9b7b7179da87f5206a8b5534'}]


def need(value, code):
    if not value:
        raise RuntimeError('photo_cleanup_' + code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def validate_targets(targets):
    need(isinstance(targets, list) and 1 <= len(targets) <= 2, 'target_count')
    need(all(isinstance(row, dict) and set(row) == {'attemptHash', 'controllerSha', 'planSha256'}
             and re.fullmatch(r'[a-f0-9]{16}', row['attemptHash'])
             and row['controllerSha'] in CONTROLLERS
             and re.fullmatch(r'[a-f0-9]{64}', row['planSha256']) for row in targets), 'target_identity')
    need(len({row['attemptHash'] for row in targets}) == len(targets), 'target_duplicate')


def identity(info):
    return tuple(getattr(info, name) for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def disjoint(directory, paths):
    return all(directory != path and directory not in path.parents and path not in directory.parents for path in paths)


def read_message():
    raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
    need(raw.endswith(b'\n') and len(raw) <= 1024 * 1024, 'input_bound')
    value = json.loads(raw)
    need(isinstance(value, dict), 'input_object')
    return value


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


class Cleanup:
    def __init__(self, host, authority):
        validate_targets(TARGETS)
        self.h = host
        self.authority = authority
        self.lock = None
        self.targets = []
        self.deleted = 0
        self.absent = 0
        self.logical = 0
        self.sequence = 0
        self.current = None
        self.protected = []
        self.proofs = []
        self.source_files = {}
        self.before = self.free()
        self.check_authority(authority)
        lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        self.lock = lock
        info = os.fstat(lock)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'lock_identity')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.prepare()

    def free(self):
        usage = os.statvfs(self.h.BASE)
        return usage.f_bavail * usage.f_frsize

    def check_authority(self, authority):
        need(isinstance(authority, dict) and set(authority) == {'publicationState', 'lease'}, 'authority')
        for key in ('accepted', 'intent'):
            need(authority['publicationState'][key] == self.authority['publicationState'][key], 'state_changed')
        need(authority['lease'] == self.authority['lease'], 'lease_changed')
        state, _ = self.h.checked_publication_view(authority['publicationState'])
        need(state.get('pending') is None and state['current']['runtimeSha'] == CURRENT
             and state['current']['generationId'] == GENERATION
             and state['current']['generationManifestSha256'] == MANIFEST, 'current')
        lease = self.h.checked_observation(authority['lease'])
        need(lease.get('kind') == 'china-market-lease-v1' and lease.get('market') == 'china'
             and lease.get('status') == 'held' and re.fullmatch(r'[a-f0-9]{32}', lease.get('nonce', '')), 'lease')
        expires = datetime.datetime.fromisoformat(lease['expiresAt'].replace('Z', '+00:00'))
        need(expires > datetime.datetime.now(datetime.timezone.utc), 'lease_expired')
        return state

    def prepare(self):
        h = self.h
        state = self.check_authority(self.authority)
        for ref in (state['current'], state.get('rollback')):
            if ref is None:
                continue
            receipt = h.verified_history(ref)
            directory, plan = h.reference_plan(ref, receipt)
            self.protected.append(directory)
            for name in ('PLAN.json', 'ACCEPTED.json'):
                h.regular(directory / name, 256 * 1024)
                self.proofs.append((directory / name, h.file_sha(directory / name)))
            h.generation_reference(ref, receipt['nonce'])
            if ref == state['current']:
                self.current = ref
                self.current_nonce = receipt['nonce']
                self.current_directory = directory
                self.current_descriptors = {item['name']: item for item in plan['files']}
        live = h.verify_live_reference(self.current, self.current_nonce)
        self.live_id = live['Id']
        self.live_identity = h.protected_identity(live)
        self.ingress = h.CONFIG.read_bytes()
        home = h.BASE / FAILED / 'china-next'
        for directory in (h.BASE, home.parent, home):
            h.private_directory(directory)
        entries = list(home.iterdir())
        need(len(entries) <= 64, 'directory_bound')
        for wanted in TARGETS:
            matches = [entry for entry in entries if re.fullmatch(r'[a-f0-9]{32}', entry.name)
                       and digest(entry.name.encode())[:16] == wanted['attemptHash']]
            need(len(matches) == 1, 'target_match')
            directory = matches[0]
            h.private_directory(directory)
            h.private_directory(directory / 'generation')
            need(disjoint(directory, self.protected), 'protected_target')
            need(not (directory / 'ACCEPTED.json').exists() and not (directory / 'ACCEPTED.json').is_symlink(), 'target_accepted')
            for name in ('PLAN.json', 'ROLLED_BACK.json'):
                h.regular(directory / name, 256 * 1024)
            raw = (directory / 'PLAN.json').read_bytes()
            need(digest(raw) == wanted['planSha256'], 'plan_hash')
            plan = json.loads(raw)
            h.validate_plan(plan)
            need(plan['runtimeSha'] == FAILED and plan['controllerSha'] == wanted['controllerSha']
                 and plan['nonce'] == directory.name and plan.get('mode') == 'code-update'
                 and plan.get('codeScope') == 'catalog-photo-japan-power-v1'
                 and plan['generationId'] == GENERATION and plan['generationManifestSha256'] == MANIFEST
                 and plan['retainedRuntime'] == CURRENT, 'plan_binding')
            previous, previous_receipt, _ = h.accepted_predecessor(plan)
            need(previous == self.current and previous_receipt['nonce'] == self.current_nonce, 'previous_changed')
            outcome = h.read_outcome({'runtimeSha': FAILED, 'nonce': directory.name})
            need(outcome['status'] == 'rolled_back', 'rollback_missing')
            rollback = json.loads((directory / 'ROLLED_BACK.json').read_bytes())
            need(rollback.get('version') == 1 and rollback.get('kind') == 'china-host-rollback-v1'
                 and rollback.get('release') == FAILED and rollback.get('nonce') == directory.name
                 and rollback.get('retainedRuntimeSha') == CURRENT
                 and rollback.get('retainedContainerId') == self.live_id
                 and rollback.get('retainedImageId') == self.current['imageId']
                 and all(rollback.get(key) is True for key in ('candidateRemoved', 'ingressRestored', 'retainedRunning')),
                 'rollback_binding')
            self.proofs.extend([(directory / 'PLAN.json', wanted['planSha256']),
                                (directory / 'ROLLED_BACK.json', h.file_sha(directory / 'ROLLED_BACK.json'))])
            descriptors = {item['name']: item for item in plan['files']}
            for name in FILES:
                descriptor = descriptors[name]
                need(descriptor == self.current_descriptors[name], 'different_generation')
                source = self.current_directory / 'generation' / name
                if name not in self.source_files:
                    meta = h.regular(source)
                    need(meta.st_size == descriptor['bytes'] and h.file_sha(source) == descriptor['sha256'], 'source_hash')
                    self.source_files[name] = (source, identity(meta))
                target = directory / 'generation' / name
                if not target.exists() and not target.is_symlink():
                    self.targets.append((directory, target, descriptor, None))
                    self.absent += 1
                    continue
                meta = h.regular(target)
                need(meta.st_size == descriptor['bytes'] and identity(meta)[:2] != self.source_files[name][1][:2]
                     and h.file_sha(target) == descriptor['sha256'], 'target_hash')
                need(identity(h.regular(target)) == identity(meta), 'target_changed')
                self.targets.append((directory, target, descriptor, identity(meta)))
        self.fence()

    def fence(self):
        h = self.h
        self.check_authority(self.authority)
        need(h.CONFIG.read_bytes() == self.ingress, 'ingress_changed')
        current = h.docker('GET', '/containers/' + self.live_id + '/json')
        need(h.protected_identity(current) == self.live_identity, 'live_changed')
        rows = h.docker('GET', '/containers/json?all=1')
        need(isinstance(rows, list) and len(rows) < 150, 'containers_bound')
        mounts = []
        for row in rows:
            container = h.docker('GET', '/containers/' + row['Id'] + '/json')
            for mount in container.get('Mounts', []):
                if mount.get('Source'):
                    need(isinstance(mount['Source'], str) and Path(mount['Source']).is_absolute(), 'mount_path')
                    mounts.append(Path(mount['Source']).resolve())
        for directory, filename, _, expected in self.targets:
            h.private_directory(directory)
            h.private_directory(filename.parent)
            need(disjoint(directory, mounts + self.protected), 'target_mounted')
            need(not (directory / 'ACCEPTED.json').exists() and not (directory / 'ACCEPTED.json').is_symlink(), 'accepted_changed')
        for filename, expected in self.proofs:
            h.regular(filename, 256 * 1024)
            need(h.file_sha(filename) == expected, 'proof_changed')
        for source, expected in self.source_files.values():
            need(identity(h.regular(source)) == expected, 'source_changed')

    def step(self, message):
        need(set(message) == {'action', 'index', 'authority'} and message['action'] == 'unlink'
             and type(message['index']) is int and message['index'] == self.sequence
             and self.sequence < len(self.targets), 'sequence')
        self.check_authority(message['authority'])
        self.fence()
        directory, filename, descriptor, expected = self.targets[self.sequence]
        deleted = expected is not None
        if deleted:
            need(identity(self.h.regular(filename)) == expected, 'target_changed')
            parent = os.open(filename.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                need(identity(os.stat(filename.name, dir_fd=parent, follow_symlinks=False)) == expected, 'opened_target_changed')
                os.unlink(filename.name, dir_fd=parent)
                os.fsync(parent)
            finally:
                os.close(parent)
            self.deleted += 1
            self.logical += descriptor['bytes']
        else:
            need(not filename.exists() and not filename.is_symlink(), 'absent_target_changed')
        self.sequence += 1
        self.fence()
        return {'kind': 'photo-cleanup-step-v1', 'index': message['index'], 'deleted': deleted,
                'logicalBytesUnlinked': descriptor['bytes'] if deleted else 0}

    def finish(self, message):
        need(set(message) == {'action', 'authority'} and message['action'] == 'finish'
             and self.sequence == len(self.targets), 'finish_scope')
        self.check_authority(message['authority'])
        self.fence()
        self.h.verify_live_reference(self.current, self.current_nonce)
        return {'kind': 'photo-cleanup-result-v1', 'completed': True, 'filesDeleted': self.deleted,
                'alreadyAbsentFiles': self.absent, 'logicalBytesUnlinked': self.logical,
                'diskFreeBytesBefore': self.before, 'diskFreeBytesAfter': self.free(),
                'liveRuntimeSha': CURRENT, 'generationId': GENERATION,
                'imagesDeleted': 0, 'containersDeleted': 0, 'directoriesDeleted': 0,
                'acceptedStateWrites': 0, 'intentStateWrites': 0}

    def close(self):
        if self.lock is not None:
            os.close(self.lock)
            self.lock = None


def main():
    validate_targets(TARGETS)
    if sys.argv[1:] == ['--verify-targets']:
        emit({'targetCount': len(TARGETS), 'fileCount': len(TARGETS) * len(FILES)})
        return
    need(not sys.argv[1:], 'arguments')
    bootstrap = read_message()
    need(set(bootstrap) == {'hostSource', 'hostSourceSha256', 'authority'}
         and isinstance(bootstrap['hostSource'], str)
         and digest(bootstrap['hostSource'].encode()) == bootstrap['hostSourceSha256'], 'source')
    host = types.ModuleType('photo_cleanup_verified_host')
    exec(compile(bootstrap['hostSource'], 'verified-release-host.py', 'exec'), host.__dict__)
    cleanup = None
    try:
        cleanup = Cleanup(host, bootstrap['authority'])
        emit({'kind': 'photo-cleanup-prepared-v1', 'fileCount': len(cleanup.targets), 'alreadyAbsentFiles': cleanup.absent})
        for _ in range(len(cleanup.targets)):
            emit(cleanup.step(read_message()))
        emit(cleanup.finish(read_message()))
    finally:
        if cleanup is not None:
            cleanup.close()


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = str(error)
        emit({'errorCode': code if re.fullmatch(r'(?:photo_cleanup|china_host)_[a-z0-9_]{1,140}', code)
              else 'photo_cleanup_host_failed'})
        sys.exit(1)
