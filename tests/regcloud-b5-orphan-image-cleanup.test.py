import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch, mock_open

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).resolve().parents[1] / 'scripts/regcloud-b5-orphan-image-cleanup.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Backend:
    def __init__(self, free=8406224896, gain=0):
        p = m.APPROVED_PLAN
        self.snapshot = {'plan': {'production': copy.deepcopy(p['production']), 'keepNewest': copy.deepcopy(p['keepNewest9cb'])},
                         'allContainerFingerprints': copy.deepcopy(p['allContainerFingerprints']),
                         'allImageIds': list(p['allImageIds']),
                         'namedOrphanImageInventory': {'readOnly': True, 'sourceRevision': p['sourceRevision'],
                             'requestedImages': copy.deepcopy(p['images']),
                             'otherImagesOfSameRevisionRetained': copy.deepcopy(p['retainedB5Images'])}}
        self.free = free; self.gain = gain; self.calls = []

    def capture(self):
        return copy.deepcopy(self.snapshot)

    def free_bytes(self):
        return self.free

    def verify_production(self, expected):
        if self.snapshot['plan']['production'] != expected:
            raise m.Refused('production_changed')

    def candidate_metadata(self, identifier):
        return next(row for row in self.snapshot['namedOrphanImageInventory']['requestedImages'] if row['imageId'] == identifier)

    def container_references(self, identifier):
        return self.candidate_metadata(identifier)['references']

    def remove_image(self, identifier):
        self.calls.append(identifier)
        self.snapshot['allImageIds'].remove(identifier)
        self.candidate_metadata(identifier).update(present=False)
        self.free += self.gain


class OrphanImageCleanupTest(unittest.TestCase):
    def test_actual_review_binding_and_oldest_first(self):
        plan = m.APPROVED_PLAN
        self.assertEqual(m.plan_digest(plan), m.APPROVED_PLAN_SHA256)
        self.assertEqual(plan['inventoryRunId'], 43828596253)
        self.assertEqual(plan['inventorySource'], 'adc2a474366a13532df94c808d733aed23576eda')
        self.assertEqual(len(plan['allContainerFingerprints']), 25)
        self.assertEqual(len(plan['allImageIds']), 33)
        self.assertTrue(plan['images'][0]['imageId'].startswith('sha256:2fa2c913'))
        self.assertTrue(plan['images'][1]['imageId'].startswith('sha256:fc248eb3'))
        self.assertTrue(all(row['referenceCount'] == 0 and row['repoTags'] == [] and row['repoDigests'] == [] for row in plan['images']))

    def test_readonly_and_goal_reached_both_have_zero_mutations(self):
        for apply, free in [(False, 1), (True, m.APPROVED_PLAN['targetFreeBytes'])]:
            b = Backend(free=free)
            result = m.execute_cleanup(b, apply, m.APPROVED_PLAN_SHA256)
            self.assertEqual(b.calls, [])
            self.assertEqual(result['removedContainers'], [])
            self.assertTrue(result['allContainersUnchanged'])

    def test_missing_confirmation_refuses_before_mutation(self):
        b = Backend()
        with self.assertRaises(m.Refused):
            m.execute_cleanup(b, True, '0' * 64)
        self.assertEqual(b.calls, [])

    def test_stop_after_first_if_real_free_reaches_goal(self):
        b = Backend(gain=3 * 1024 ** 3)
        result = m.execute_cleanup(b, True, m.APPROVED_PLAN_SHA256)
        self.assertEqual(b.calls, [m.APPROVED_PLAN['images'][0]['imageId']])
        self.assertTrue(result['targetReached'])
        self.assertEqual(result['freedBytes'], 3 * 1024 ** 3)

    def test_two_only_and_actual_space_not_logical_image_size(self):
        b = Backend(gain=16)
        result = m.execute_cleanup(b, True, m.APPROVED_PLAN_SHA256)
        self.assertEqual(b.calls, [row['imageId'] for row in m.APPROVED_PLAN['images']])
        self.assertEqual(result['freedBytes'], 32)
        self.assertFalse(result['targetReached'])
        self.assertEqual(result['removedContainers'], [])
        self.assertEqual(len(b.snapshot['allImageIds']), 31)

    def test_source_fingerprint_alias_and_reference_drift_refuse(self):
        for change in [{'imageFingerprint': '0' * 64}, {'revision': '0' * 40}, {'repoTags': ['another:tag']},
                       {'repoDigests': ['another@sha256:abc']}, {'referenceCount': 1, 'references': [{'id': 'new'}]}, {'present': False}]:
            b = Backend(); b.snapshot['namedOrphanImageInventory']['requestedImages'][0].update(change)
            with self.subTest(change=change), self.assertRaises(m.Refused):
                m.execute_cleanup(b, True, m.APPROVED_PLAN_SHA256)
            self.assertEqual(b.calls, [])

    def test_current_production_all_backdrops_and_newest_groups_are_pinned(self):
        changes = [
            lambda s: s['plan']['production'].update(release='0' * 40),
            lambda s: s['allContainerFingerprints'].update({next(iter(s['allContainerFingerprints'])): '0' * 64}),
            lambda s: s['allImageIds'].remove(m.APPROVED_PLAN['retainedB5Images'][0]['imageId']),
            lambda s: s['plan']['keepNewest'].update(image='sha256:' + '0' * 64),
            lambda s: s['namedOrphanImageInventory']['otherImagesOfSameRevisionRetained'][0].update(imageFingerprint='0' * 64),
        ]
        for change in changes:
            b = Backend(); change(b.snapshot)
            with self.assertRaises(m.Refused):
                m.execute_cleanup(b, True, m.APPROVED_PLAN_SHA256)
            self.assertEqual(b.calls, [])

    def test_late_new_reference_is_checked_immediately_before_delete(self):
        b = Backend(); b.container_references = lambda identifier: [{'Id': 'new-reference', 'Image': identifier}]
        with self.assertRaises(m.Refused):
            m.execute_cleanup(b, True, m.APPROVED_PLAN_SHA256)
        self.assertEqual(b.calls, [])

    def test_first_removal_failure_never_selects_another_image(self):
        b = Backend()
        def fail(identifier):
            b.calls.append(identifier); raise m.Refused('docker_refused')
        b.remove_image = fail
        with self.assertRaises(m.Refused):
            m.execute_cleanup(b, True, m.APPROVED_PLAN_SHA256)
        self.assertEqual(b.calls, [m.APPROVED_PLAN['images'][0]['imageId']])

    def test_only_reviewed_image_rm_no_prune_no_container_or_force(self):
        calls = []
        class Safeguards:
            def docker(self, *args):
                calls.append(args)
        b = object.__new__(m.Backend); b.safeguards = Safeguards()
        identifier = m.APPROVED_PLAN['images'][0]['imageId']
        with redirect_stdout(io.StringIO()):
            b.remove_image(identifier)
        self.assertEqual(calls, [('image', 'rm', '--no-prune', identifier)])
        with self.assertRaises(m.Refused):
            b.remove_image(m.APPROVED_PLAN['retainedB5Images'][0]['imageId'])

    def test_reviewed_helper_matches_source_hash_and_loads_without_running(self):
        helper = m.load_safeguards()
        self.assertEqual(helper.EXPECTED_PRODUCTION, m.APPROVED_PLAN['production']['release'])
        self.assertTrue(callable(helper.HostBackend))

    def test_actual_stdin_bundle_loads_both_modules_and_runs_only_readonly_mode(self):
        root = Path(__file__).resolve().parents[1]
        safe = (root / 'scripts/regcloud-failed-encar-retention.py').read_text()
        source = (root / 'scripts/regcloud-b5-orphan-image-cleanup.py').read_text()
        bootstrap = 'import types\nsafe=types.ModuleType("retention_safeguards")\n'
        bootstrap += 'exec(compile(' + repr(safe) + ',"retention_safeguards","exec"),safe.__dict__)\n'
        bootstrap += 'cleanup=types.ModuleType("reviewed_orphan_cleanup")\n'
        bootstrap += 'exec(compile(' + repr(source) + ',"reviewed_orphan_cleanup","exec"),cleanup.__dict__)\n'
        bootstrap += 'cleanup.main(safe)\n'
        backend = Backend()
        actual_exec = exec
        def load(code, scope):
            actual_exec(code, scope)
            if scope.get('__name__') == 'retention_safeguards':
                scope['HostBackend'] = lambda: backend
        with patch('builtins.open', mock_open()), patch.object(m.fcntl, 'flock'), \
             patch('sys.argv', ['cleanup']), redirect_stdout(io.StringIO()) as output:
            actual_exec(compile(bootstrap, 'bundle', 'exec'), {'exec': load})
        result = json.loads(output.getvalue().splitlines()[-1])
        self.assertFalse(result['apply']); self.assertEqual(backend.calls, [])
        self.assertTrue(result['allContainersUnchanged'])


if __name__ == '__main__':
    unittest.main()
