import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('unused_images_new', ROOT / 'scripts/catalog-next/cleanup-unused-images-20261126.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def image(target):
    return {'Id': target['id'], 'Created': target['created'], 'Size': target['sizeBytes'],
      'Config': {'Labels': {'org.opencontainers.image.revision': target['runtimeSha'],
        'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena', 'avtocena.application': 'web'}},
      'Os': 'linux', 'Architecture': 'amd64', 'RepoTags': target['tags'],
      'RepoDigests': target['digests']}


class CleanupTests(unittest.TestCase):
    def test_exact_four_images_never_include_current_or_opaque_tags(self):
        m.validate_targets()
        self.assertEqual(len(m.TARGETS), 4)
        self.assertNotIn(m.CURRENT, {target['runtimeSha'] for target in m.TARGETS})
        for target in m.TARGETS:
            self.assertTrue(all(tag.startswith('avtocena-china-runtime:') for tag in target['tags']))

    def test_referenced_image_cannot_be_deleted(self):
        target = m.TARGETS[0]
        with self.assertRaises(RuntimeError):
            m.validate_image(image(target), target, {target['id']}, types.SimpleNamespace(pinned_image=lambda _: False))

    def test_image_identity_owner_tags_and_existing_policy_pins_remain_strict(self):
        target = m.TARGETS[0]
        policy = types.SimpleNamespace(pinned_image=lambda _: False)
        m.validate_image(image(target), target, set(), policy)
        row = image(target)
        row['Config']['Labels']['avtocena.application'] = 'other'
        with self.assertRaises(RuntimeError):
            m.validate_image(row, target, set(), policy)
        with self.assertRaises(RuntimeError):
            m.validate_image(image(target), target, set(), types.SimpleNamespace(pinned_image=lambda _: True))

    def test_failed_candidate_reference_needs_exact_complete_rollback_and_cleanup(self):
        runtime = '36d707bcb599e861918df411e40d8947074f0430'
        target = next(row for row in m.TARGETS if row['runtimeSha'] == runtime)
        checks = {'PLAN.json': '1b8455abcd8512467f31bc0e2735922536cee40d933084ae3934ef38515c99dc',
          'ROLLED_BACK.json': '783809d2dc846fbac6c01699f5419345bb61eca77c6542d304eb283fed0d74e6',
          'FAILED_CODE_CLEANUP.json': '4488f9fc79ce54859d92a952f73426973e9e3df7555e0ba3daee5b126570f2da'}
        current_image = 'sha256:' + 'a' * 64
        previous = {'revision': 10, 'pending': None, 'current': {'imageId': current_image}}
        state = {**previous, 'revision': 12}
        nonce = 'd' * 32
        plan = {'runtimeSha': runtime, 'imageId': target['id'], 'generationId': m.GENERATION,
          'generationManifestSha256': m.MANIFEST, 'nonce': nonce, 'previousAcceptedState': previous,
          'previousAcceptedETag': 'etag', 'previousAcceptedStateSha256': 'c' * 64}
        rollback = {'kind': 'china-host-rollback-v1', 'nonce': nonce, 'release': runtime, 'imageId': target['id'],
          'retainedRuntimeSha': m.CURRENT, 'retainedImageId': current_image,
          'retainedRunning': True, 'candidateRemoved': True, 'ingressRestored': True}
        cleanup = {'kind': 'china-failed-code-bulk-cleanup-v1', 'nonce': nonce, 'runtimeSha': runtime,
          'completed': True, 'protectedDeploymentsPreserved': True, 'planSha256': checks['PLAN.json'],
          'rollbackSha256': checks['ROLLED_BACK.json']}
        values = {'PLAN.json': plan, 'ROLLED_BACK.json': rollback, 'FAILED_CODE_CLEANUP.json': cleanup}
        intent = {'candidate': {'imageId': target['id']}, 'status': 'aborted', 'nonce': nonce,
          'previous': {'value': previous, 'etag': 'etag', 'sha256': 'c' * 64},
          'resolution': {'kind': 'rolled_back', 'rollbackProof': {'hostRollbackSha256': checks['ROLLED_BACK.json']}}}
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            attempt = base / runtime / 'china-next' / nonce
            attempt.mkdir(parents=True)
            (attempt / 'PLAN.json').write_text('{}')
            value = m.Cleanup.__new__(m.Cleanup)
            value.authority = {'publicationState': {'intent': {'value': intent}}}
            value.protected = {target['id'], current_image}
            value.proof_files = []
            value.h = types.SimpleNamespace(BASE=base, private_directory=lambda _: None,
              file_sha=lambda path: checks[path.name], diagnosis_json=lambda path: (values[path.name], path.name.encode()))
            with mock.patch.object(m, 'sha', side_effect=lambda raw: checks[raw.decode()]):
                value.release_completed_candidate_reference(state)
                self.assertEqual(value.protected, {current_image})
                value.protected.add(target['id'])
                cleanup['completed'] = False
                with self.assertRaises(RuntimeError):
                    value.release_completed_candidate_reference(state)
                self.assertIn(target['id'], value.protected)

    def test_encoded_proof_reference_checksum_is_not_ignored(self):
        import base64
        raw = json.dumps({'imageId': m.TARGETS[0]['id']}).encode()
        value = {'hostRollbackBase64': base64.b64encode(raw).decode(), 'hostRollbackSha256': '0' * 64}
        with self.assertRaises(RuntimeError):
            m.referenced_images(value)


if __name__ == '__main__':
    unittest.main()
