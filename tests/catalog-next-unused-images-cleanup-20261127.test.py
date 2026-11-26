import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('unused_images_20261127',
    ROOT / 'scripts/catalog-next/cleanup-unused-images-20261127.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def image(target):
    return {'Id': target['id'], 'Created': target['created'], 'Size': target['sizeBytes'],
        'Config': {'Labels': {'org.opencontainers.image.revision': target['runtimeSha'],
            'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena', 'avtocena.application': 'web'}},
        'Os': 'linux', 'Architecture': 'amd64', 'RepoTags': list(target['tags']),
        'RepoDigests': list(target['digests'])}


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


class Fixture:
    """Synthetic private bytes, real cleanup control flow; no Docker or SSH access.

    Only the immutable hashes of unavailable private metadata are rebound in memory.
    Production has no test override, environment input or alternate target path.
    """
    def __init__(self, test):
        self.stack = ExitStack()
        test.addCleanup(self.stack.close)
        self.base = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.calls = []
        self.free_bytes = 123456789
        self.reclaim = [9, 23, 7, 0, 12, 4, 6, 41]
        self.fail_delete = None
        self.targets = copy.deepcopy(m.TARGETS)
        self.protected = copy.deepcopy(m.PROTECTED_HISTORY)
        self.files = []
        self.nonces = {}
        self.rows = {}
        pins = []
        for pin in m.CONTAINER_PINS:
            row = {'Id': pin['id'], 'Name': '/fixture-' + pin['id'][:12], 'Image': pin['imageId'],
                'Config': {'Env': ['PRIVATE_VALUE=never-report-this'], 'Labels': {}},
                'HostConfig': {'RestartPolicy': {'Name': 'no'}}, 'Mounts': [], 'RestartCount': 0,
                'State': {'Status': 'running' if pin['running'] else 'exited', 'Running': pin['running'],
                    'Pid': 123 if pin['running'] else 0, 'StartedAt': '2026-11-26T10:00:00Z',
                    'FinishedAt': '0001-01-01T00:00:00Z', 'Paused': False, 'Restarting': False, 'Dead': False}}
            self.rows[row['Id']] = row
            pins.append({**pin, 'configurationSha256': m.inventory_container_fingerprint(row)})
        self.images = {identifier: {'Id': identifier, 'Config': {}, 'RepoTags': [], 'RepoDigests': []}
                       for identifier in m.OBSERVED_IMAGE_IDS}
        self.images.update({target['id']: image(target) for target in self.targets})
        current = {'runtimeSha': m.CURRENT, 'imageId': self.protected[m.CURRENT]['imageId'],
                   'generationId': m.GENERATION, 'generationManifestSha256': m.MANIFEST}
        rollback = {'runtimeSha': m.ROLLBACK, 'imageId': self.protected[m.ROLLBACK]['imageId'],
                    'generationId': m.GENERATION, 'generationManifestSha256': m.MANIFEST}
        latest_values = None
        for index, target in enumerate(self.targets):
            nonce = f'{index + 1:032x}'
            self.nonces[target['id']] = nonce
            directory = self.base / target['runtimeSha'] / 'china-next' / nonce
            directory.mkdir(parents=True)
            previous_current = {**current, 'runtimeSha': target['retainedRuntimeSha'],
                                'imageId': target['retainedImageId']}
            previous = {'revision': 10, 'pending': None, 'current': previous_current, 'rollback': rollback}
            plan = {'runtimeSha': target['runtimeSha'], 'imageId': target['id'], 'generationId': m.GENERATION,
                'generationManifestSha256': m.MANIFEST, 'nonce': nonce, 'previousAcceptedState': previous,
                'previousAcceptedETag': '"previous-' + str(index) + '"',
                'previousAcceptedStateSha256': m.fingerprint(previous)}
            rolled_back = {'kind': 'china-host-rollback-v1', 'nonce': nonce, 'release': target['runtimeSha'],
                'imageId': target['id'], 'retainedRuntimeSha': target['retainedRuntimeSha'],
                'retainedImageId': target['retainedImageId'], 'retainedRunning': True,
                'candidateRemoved': True, 'ingressRestored': True,
                'previousAcceptedETag': plan['previousAcceptedETag'],
                'previousAcceptedStateSha256': plan['previousAcceptedStateSha256']}
            hashes = {'PLAN.json': m.sha(encode(plan)), 'ROLLED_BACK.json': m.sha(encode(rolled_back))}
            cleanup = {'kind': 'china-failed-code-bulk-cleanup-v1', 'nonce': nonce,
                'runtimeSha': target['runtimeSha'], 'completed': True, 'protectedDeploymentsPreserved': True,
                'imagesDeleted': 0, 'directoriesDeleted': 0, 'planSha256': hashes['PLAN.json'],
                'rollbackSha256': hashes['ROLLED_BACK.json']}
            hashes['FAILED_CODE_CLEANUP.json'] = m.sha(encode(cleanup))
            target.update(attemptHash=m.sha(nonce.encode())[:16], proofSha256=hashes)
            values = {'PLAN.json': plan, 'ROLLED_BACK.json': rolled_back, 'FAILED_CODE_CLEANUP.json': cleanup}
            for name, value in values.items():
                filename = directory / name
                filename.write_bytes(encode(value))
                self.files.append(filename)
            if target['id'] == m.LATEST_CANDIDATE_IMAGE_ID:
                latest_values = values
        for index, runtime in enumerate((m.CURRENT, m.ROLLBACK)):
            nonce = f'{index + 100:032x}'
            self.nonces[runtime] = nonce
            directory = self.base / runtime / 'china-next' / nonce
            directory.mkdir(parents=True)
            hashes = {}
            for name in ('PLAN.json', 'ACCEPTED.json'):
                filename = directory / name
                filename.write_bytes(encode({'nonce': nonce, 'runtimeSha': runtime, 'imageId': self.protected[runtime]['imageId']}))
                hashes[name] = m.sha(filename.read_bytes())
                self.files.append(filename)
            self.protected[runtime].update(attemptHash=m.sha(nonce.encode())[:16], proofSha256=hashes)
        plan = latest_values['PLAN.json']
        self.state = {**copy.deepcopy(plan['previousAcceptedState']), 'revision': 12}
        self.intent = {'status': 'aborted', 'nonce': plan['nonce'],
            'candidate': {'imageId': m.LATEST_CANDIDATE_IMAGE_ID, 'runtimeSha': plan['runtimeSha']},
            'previous': {'value': copy.deepcopy(plan['previousAcceptedState']), 'etag': plan['previousAcceptedETag'],
                         'sha256': plan['previousAcceptedStateSha256']},
            'resolution': {'kind': 'rolled_back', 'rollbackProof': {
                'hostRollbackSha256': next(t for t in self.targets if t['id'] == m.LATEST_CANDIDATE_IMAGE_ID)['proofSha256']['ROLLED_BACK.json']}}}
        self.authority = {'publicationState': {'accepted': {'value': self.state}, 'intent': {'value': self.intent}},
            'lease': {'value': {'kind': 'china-market-lease-v1', 'market': 'china', 'status': 'held',
                                'expiresAt': '2099-01-01T00:00:00Z'}}}
        config = self.base / 'nginx.conf'
        config.write_bytes(b'fixed ingress\n')
        self.files.append(config)
        generation = self.base / 'private-generation.sqlite'
        generation.write_bytes(b'private authoritative generation - preserve')
        self.files.append(generation)
        def regular(path, limit=None):
            if path.is_symlink() or not path.is_file() or (limit is not None and path.stat().st_size > limit):
                raise RuntimeError('china_host_regular')
            return path.stat()
        def diagnosis(path):
            regular(path, 256 * 1024)
            raw = path.read_bytes()
            return json.loads(raw), raw
        def private_directory(path):
            if path.is_symlink() or not path.is_dir():
                raise RuntimeError('china_host_private_directory')
        def live(reference, nonce):
            self.calls.append(('health', reference['runtimeSha']))
            return next(row for row in self.rows.values() if row['Image'] == reference['imageId'])
        self.host = types.SimpleNamespace(BASE=self.base, CONFIG=config, docker=self.docker,
            checked_publication_view=lambda view: (view['accepted']['value'], view['intent']['value']),
            checked_observation=lambda observation: observation['value'],
            private_directory=private_directory, regular=regular, diagnosis_json=diagnosis,
            file_sha=lambda path: m.sha(path.read_bytes()),
            verified_history=lambda reference: {'nonce': self.nonces[reference['runtimeSha']]},
            reference_plan=lambda reference, receipt: (self.base / reference['runtimeSha'] / 'china-next' / receipt['nonce'], {}),
            generation_reference=lambda reference, nonce: {'preserved': True},
            verify_live_reference=live, canonical_mounts=lambda mounts: sorted(mounts, key=lambda row: json.dumps(row, sort_keys=True)))
        self.policy = types.SimpleNamespace(pinned_image=lambda row: False)
        self.stack.enter_context(mock.patch.object(m, 'TARGETS', self.targets))
        self.stack.enter_context(mock.patch.object(m, 'CONTAINER_PINS', pins))
        self.stack.enter_context(mock.patch.object(m, 'PROTECTED_HISTORY', self.protected))
        self.stack.enter_context(mock.patch.object(m, 'EXPECTED_PLAN_SHA256', m.plan_sha256()))
        self.stack.enter_context(mock.patch.object(m.Cleanup, 'free', lambda _: self.free_bytes))
        real_open, real_fstat = os.open, os.fstat
        descriptors = []
        def safe_open(path, flags, *args, **kwargs):
            if str(path).startswith('/run/lock/'):
                path = self.base / Path(path).name
                path.touch(mode=0o600)
                descriptor = real_open(path, flags, *args, **kwargs)
                descriptors.append(descriptor)
                return descriptor
            return real_open(path, flags, *args, **kwargs)
        def close_descriptors():
            for descriptor in descriptors:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
        self.stack.callback(close_descriptors)
        self.stack.enter_context(mock.patch.object(m.os, 'open', side_effect=safe_open))
        def lock_stat(descriptor):
            info = real_fstat(descriptor)
            if descriptor in descriptors:
                # Model only the owner of our synthetic lock; production still requires uid 0.
                fields = list(info)
                fields[4] = 0
                return os.stat_result(fields)
            return info
        self.stack.enter_context(mock.patch.object(m.os, 'fstat', side_effect=lock_stat))

    def docker(self, method, path):
        self.calls.append((method, path))
        if method == 'GET' and path == '/containers/json?all=1':
            return [{'Id': identifier} for identifier in self.rows]
        if method == 'GET' and path.startswith('/containers/'):
            return copy.deepcopy(self.rows[path.removeprefix('/containers/').removesuffix('/json')])
        if method == 'GET' and path == '/images/json?all=1':
            return [{'Id': identifier} for identifier in self.images]
        if method == 'GET' and path.startswith('/images/'):
            return copy.deepcopy(self.images[path.removeprefix('/images/').removesuffix('/json')])
        if method == 'DELETE':
            identifier, flags = path.removeprefix('/images/').split('?', 1)
            assert flags == 'force=false&noprune=true'
            index = [t['id'] for t in self.targets].index(identifier)
            assert identifier not in {row['Image'] for row in self.rows.values()}
            if self.fail_delete == index:
                raise RuntimeError('china_host_docker_transport')
            del self.images[identifier]
            self.free_bytes += self.reclaim[index]
            return [{'Deleted': identifier}]
        raise AssertionError((method, path))

    def prepare(self):
        cleanup = m.Cleanup(self.host, self.policy, self.authority)
        self.stack.callback(cleanup.close)
        return cleanup

    def remove_calls(self):
        return [call for call in self.calls if call[0] == 'DELETE']


class CleanupTests(unittest.TestCase):
    def test_production_plan_exactly_matches_reviewed_inventory_and_protects_all_six_containers(self):
        m.validate_targets()
        self.assertEqual(m.plan_sha256(), '511f65ecb1230755d9a3bd15d000dbb2b5b3cc1cd2f23d6e0ad31eb5588440db')
        self.assertEqual(len(m.TARGETS), 8)
        self.assertEqual(len(m.CONTAINER_PINS), 6)
        self.assertEqual(len(m.OBSERVED_IMAGE_IDS), 15)
        self.assertEqual(sum(t['sizeBytes'] for t in m.TARGETS), 2068293040)
        self.assertFalse({t['runtimeSha'] for t in m.TARGETS} & m.FORBIDDEN_RUNTIMES)
        altered = copy.deepcopy(m.TARGETS)
        altered[0]['proofSha256']['PLAN.json'] = '0' * 64
        with mock.patch.object(m, 'TARGETS', altered), self.assertRaisesRegex(RuntimeError, 'inventory_plan'):
            m.validate_targets()

    def test_exact_eight_deletes_preserve_private_files_and_report_measured_not_virtual_reclaim(self):
        f = Fixture(self)
        files = {str(path): path.read_bytes() for path in f.files}
        containers = copy.deepcopy(f.rows)
        authority = copy.deepcopy(f.authority)
        cleanup = f.prepare()
        prepared = cleanup.prepared()
        self.assertEqual(prepared['imagesPlanned'], 8)
        self.assertEqual(prepared['containersPreserved'], 6)
        self.assertEqual(prepared['inventoryReportSha256'], m.INVENTORY_REPORT_SHA256)
        for index, target in enumerate(m.TARGETS):
            step = cleanup.step({'action': 'remove', 'index': index, 'authority': f.authority})
            self.assertEqual(step['imageId'], target['id'])
            self.assertEqual(step['measuredFreeBytesChange'], f.reclaim[index])
        result = cleanup.finish({'action': 'finish', 'authority': f.authority})
        self.assertTrue(result['completed'])
        self.assertEqual(result['imagesRemoved'], [t['id'] for t in m.TARGETS])
        self.assertEqual(result['measuredFreeBytesChange'], sum(f.reclaim))
        self.assertEqual(result['diskFreeBytesAfter'] - result['diskFreeBytesBefore'], sum(f.reclaim))
        self.assertEqual(result['rollbackRuntimeSha'], m.ROLLBACK)
        for key in ('containersDeleted', 'filesDeleted', 'volumesDeleted', 'acceptedStateWrites', 'intentStateWrites'):
            self.assertEqual(result[key], 0)
        self.assertEqual(len(f.remove_calls()), 8)
        self.assertEqual(f.rows, containers)
        self.assertEqual(f.authority, authority)
        self.assertEqual({str(path): path.read_bytes() for path in f.files}, files)
        self.assertEqual(set(f.images), m.OBSERVED_IMAGE_IDS - {t['id'] for t in m.TARGETS})
        self.assertNotIn('never-report-this', json.dumps([prepared, result]))

    def test_current_rollback_generation_and_expired_lease_refuse_before_deletion(self):
        for scenario in ('current', 'rollback', 'generation', 'lease'):
            with self.subTest(scenario=scenario):
                f = Fixture(self)
                if scenario == 'lease':
                    f.authority['lease']['value']['expiresAt'] = '2000-01-01T00:00:00Z'
                elif scenario == 'generation':
                    f.state['current']['generationId'] = 'gen_china_1_1'
                else:
                    f.state[scenario]['runtimeSha'] = '0' * 40
                with self.assertRaises(RuntimeError):
                    f.prepare()
                self.assertEqual(f.remove_calls(), [])

    def test_latest_exception_rejects_idle_unreserved_wrong_revision_and_different_intent(self):
        for scenario in ('idle', 'unreserved', 'revision', 'candidate', 'rollback_proof'):
            with self.subTest(scenario=scenario):
                f = Fixture(self)
                if scenario == 'idle':
                    f.authority['publicationState']['intent']['value'] = None
                elif scenario == 'unreserved':
                    f.state['revision'] = 10
                elif scenario == 'revision':
                    f.state['revision'] = 13
                elif scenario == 'candidate':
                    f.intent['candidate']['imageId'] = f.targets[1]['id']
                else:
                    f.intent['resolution']['rollbackProof']['hostRollbackSha256'] = '0' * 64
                with self.assertRaises(RuntimeError):
                    f.prepare()
                self.assertEqual(f.remove_calls(), [])

    def test_latest_exception_never_releases_another_referenced_image(self):
        f = Fixture(self)
        cleanup = f.prepare()
        other = f.targets[1]['id']
        cleanup.protected.add(other)
        cleanup.release_completed_candidate_reference(f.state)
        self.assertIn(other, cleanup.protected)
        cleanup.step({'action': 'remove', 'index': 0, 'authority': f.authority})
        with self.assertRaisesRegex(RuntimeError, 'protected_image'):
            cleanup.step({'action': 'remove', 'index': 1, 'authority': f.authority})
        self.assertEqual(len(f.remove_calls()), 1)
        self.assertIn(other, f.images)

    def test_target_owner_tags_size_and_existing_baseline_pins_remain_strict(self):
        target = m.TARGETS[0]
        for scenario in ('owner', 'tags', 'digest', 'size', 'protected', 'policy'):
            with self.subTest(scenario=scenario):
                row = image(target)
                protected = set()
                policy = types.SimpleNamespace(pinned_image=lambda _: scenario == 'policy')
                if scenario == 'owner':
                    row['Config']['Labels']['avtocena.application'] = 'other'
                elif scenario == 'tags':
                    row['RepoTags'].append('unreviewed:latest')
                elif scenario == 'digest':
                    row['RepoDigests'] = ['other@' + target['id']]
                elif scenario == 'size':
                    row['Size'] += 1
                elif scenario == 'protected':
                    protected.add(target['id'])
                with self.assertRaises(RuntimeError):
                    m.validate_image(row, target, protected, policy)

    def test_changed_inventory_container_or_extra_image_is_rejected(self):
        for scenario in ('mount', 'image'):
            with self.subTest(scenario=scenario):
                f = Fixture(self)
                if scenario == 'mount':
                    next(iter(f.rows.values()))['Mounts'].append({'Type': 'bind', 'Source': '/new/private', 'Destination': '/private'})
                else:
                    f.images['sha256:' + 'f' * 64] = {'Id': 'sha256:' + 'f' * 64}
                with self.assertRaisesRegex(RuntimeError, 'container_pin|image_set_changed'):
                    f.prepare()
                self.assertEqual(f.remove_calls(), [])

    def test_every_target_proof_is_verified_not_only_latest_b25(self):
        f = Fixture(self)
        target = f.targets[-1]
        filename = f.base / target['runtimeSha'] / 'china-next' / f.nonces[target['id']] / 'FAILED_CODE_CLEANUP.json'
        filename.write_bytes(b'{"completed":false}')
        with self.assertRaisesRegex(RuntimeError, 'closed_candidate_proof'):
            f.prepare()
        self.assertEqual(f.remove_calls(), [])

    def test_dangling_acceptance_symlink_cannot_pass_absence_check(self):
        f = Fixture(self)
        target = f.targets[1]
        filename = f.base / target['runtimeSha'] / 'china-next' / f.nonces[target['id']] / 'ACCEPTED.json'
        filename.symlink_to(filename.parent / 'missing')
        with self.assertRaisesRegex(RuntimeError, 'closed_candidate_accepted'):
            f.prepare()
        self.assertEqual(f.remove_calls(), [])

    def test_acceptance_or_proof_appearing_after_preparation_stops_before_first_delete(self):
        for scenario in ('acceptance', 'proof', 'authority'):
            with self.subTest(scenario=scenario):
                f = Fixture(self)
                cleanup = f.prepare()
                target = f.targets[-1]
                directory = f.base / target['runtimeSha'] / 'china-next' / f.nonces[target['id']]
                authority = f.authority
                if scenario == 'acceptance':
                    (directory / 'ACCEPTED.json').write_bytes(b'{}')
                elif scenario == 'proof':
                    (directory / 'PLAN.json').write_bytes(b'{}')
                else:
                    authority = copy.deepcopy(f.authority)
                    authority['publicationState']['accepted']['value']['revision'] += 1
                with self.assertRaises(RuntimeError):
                    cleanup.step({'action': 'remove', 'index': 0, 'authority': authority})
                self.assertEqual(f.remove_calls(), [])

    def test_main_stops_on_partial_transport_failure_and_marks_unknown_outcome(self):
        f = Fixture(self)
        f.fail_delete = 2
        bootstrap = {'hostSource': 'host', 'hostSourceSha256': 'h', 'policySource': 'policy',
                     'policySourceSha256': 'p', 'authority': f.authority}
        messages = [bootstrap, *({'action': 'remove', 'index': i, 'authority': f.authority} for i in range(8))]
        emitted = []
        with mock.patch.object(m, 'module_from_source', side_effect=[f.host, f.policy]), \
             mock.patch.object(m, 'read_message', side_effect=messages) as reads, \
             mock.patch.object(m, 'emit', side_effect=emitted.append), \
             mock.patch.object(m.sys, 'argv', ['cleanup-unused-images-20261127.py']):
            with self.assertRaises(SystemExit) as stopped:
                m.main()
        self.assertEqual(stopped.exception.code, 1)
        self.assertEqual(reads.call_count, 4)
        self.assertEqual(len(f.remove_calls()), 3)
        self.assertEqual([row['index'] for row in emitted if row.get('kind') == 'unused-image-removed-v1'], [0, 1])
        self.assertTrue(emitted[-1]['uncertain'])
        self.assertEqual(emitted[-1]['errorCode'], 'china_host_docker_transport')
        self.assertEqual(set(f.images), m.OBSERVED_IMAGE_IDS - {f.targets[0]['id'], f.targets[1]['id']})
        self.assertFalse(any(row.get('completed') for row in emitted))

    def test_encoded_proof_references_require_their_original_hash(self):
        raw = encode({'imageId': m.TARGETS[0]['id']})
        value = {'hostRollbackBase64': base64.b64encode(raw).decode(), 'hostRollbackSha256': m.sha(raw)}
        self.assertEqual(m.referenced_images(value), {m.TARGETS[0]['id']})
        value['hostRollbackSha256'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'reference_proof_hash'):
            m.referenced_images(value)


if __name__ == '__main__':
    unittest.main()
