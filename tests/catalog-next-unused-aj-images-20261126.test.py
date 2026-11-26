import base64
import copy
import datetime
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


m = load('unused_aj_images', 'scripts/catalog-next/cleanup-unused-aj-images-20261126.py')
policy = load('legacy_retention_policy', 'scripts/regcloud-release-retention.py')


def image(target):
    return {'Id': target['id'], 'Created': target['created'], 'Size': target['sizeBytes'],
            'Config': {'Labels': {'org.opencontainers.image.revision': target['runtimeSha'],
              'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena', 'avtocena.application': 'web'}},
            'Os': 'linux', 'Architecture': 'amd64', 'RepoTags': list(target['tags']), 'RepoDigests': list(target['digests'])}


class UnusedAjImageTests(unittest.TestCase):
    def test_final_memory_metrics_are_bytes_and_only_allowlisted_aggregates(self):
        raw = 'MemTotal: 16000 kB\nMemAvailable: 7200 kB\nSwapFree: 0 kB\nPrivateUnknown: 42 kB\n'
        with mock.patch.object(m.Path, 'read_text', return_value=raw):
            self.assertEqual(m.memory_snapshot(), {'MemTotal': 16384000, 'MemAvailable': 7372800, 'SwapFree': 0})
        action = m.Cleanup.__new__(m.Cleanup)
        action.h = types.SimpleNamespace(BASE='/fixed-base')
        with mock.patch.object(m.os, 'statvfs', return_value=types.SimpleNamespace(f_blocks=100, f_bavail=30, f_bfree=31, f_frsize=4096)):
            self.assertEqual(action.disk(), {'totalBytes': 409600, 'availableBytes': 122880, 'freeBytes': 126976})

    def test_exact_two_targets_preserve_both_baseline_pins_and_all_four_retained_containers(self):
        m.validate_targets()
        self.assertEqual(len(m.TARGETS), 2)
        self.assertEqual(len(m.CONTAINER_PINS), 4)
        self.assertEqual(len(m.OBSERVED_IMAGE_IDS), 7)
        self.assertFalse({row['imageId'] for row in m.CONTAINER_PINS} & {row['id'] for row in m.TARGETS})
        self.assertTrue({policy.ACCEPTED_IMAGE, *policy.HELD_IMAGES}.issubset(m.OBSERVED_IMAGE_IDS))
        self.assertFalse({policy.ACCEPTED_IMAGE, *policy.HELD_IMAGES} & {row['id'] for row in m.TARGETS})

    def test_exact_aj_repository_identity_requires_both_owner_labels(self):
        for target in m.TARGETS:
            row = image(target)
            m.validate_image(row, target, set(), policy)
            for key in ('org.opencontainers.image.source', 'avtocena.application'):
                changed = copy.deepcopy(row)
                del changed['Config']['Labels'][key]
                with self.assertRaisesRegex(RuntimeError, 'image_owner'):
                    m.validate_image(changed, target, set(), policy)

    def test_referenced_images_and_explicit_held_policy_cannot_be_removed(self):
        target = m.TARGETS[0]
        with self.assertRaisesRegex(RuntimeError, 'protected_image'):
            m.validate_image(image(target), target, {target['id']}, policy)
        with mock.patch.object(policy, 'pinned_image', return_value=True):
            with self.assertRaisesRegex(RuntimeError, 'protected_image'):
                m.validate_image(image(target), target, set(), policy)

    def test_identity_tag_digest_architecture_and_age_changes_refuse(self):
        target = m.TARGETS[0]
        for key, replacement in [('RepoTags', ['unrelated:latest']), ('RepoDigests', []), ('Size', target['sizeBytes'] + 1),
                                 ('Architecture', 'arm64')]:
            row = image(target)
            row[key] = replacement
            with self.assertRaises(RuntimeError):
                m.validate_image(row, target, set(), policy)
        young = {**target, 'created': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        with self.assertRaisesRegex(RuntimeError, 'image_age'):
            m.validate_image(image(young), young, set(), policy)

    def test_exact_nonforced_image_delete_never_prunes_parents_or_containers(self):
        action = m.Cleanup.__new__(m.Cleanup)
        action.sequence, action.removed, action.inflight, action.steps = 0, [], False, []
        target = m.TARGETS[0]
        action.protected, action.policy = set(), policy
        action.check_authority = mock.Mock(return_value={})
        action.fence = mock.Mock(return_value=({}, {target['id']: image(target)}))
        action.current, action.current_nonce = {}, 'a' * 32
        action.free = mock.Mock(side_effect=[10, 20])
        action.h = types.SimpleNamespace(verify_live_reference=mock.Mock(), docker=mock.Mock(return_value=[]))
        result = action.step({'action': 'remove', 'index': 0, 'authority': {}})
        self.assertEqual(action.h.docker.call_args_list,
                         [mock.call('DELETE', '/images/' + target['id'] + '?force=false&noprune=true')])
        self.assertEqual(result['measuredFreeBytesChange'], 10)
        self.assertFalse(action.inflight)

    def test_wrong_step_sequence_never_calls_docker(self):
        action = m.Cleanup.__new__(m.Cleanup)
        action.sequence = 0
        action.h = types.SimpleNamespace(docker=mock.Mock())
        with self.assertRaisesRegex(RuntimeError, 'sequence'):
            action.step({'action': 'remove', 'index': 1, 'authority': {}})
        action.h.docker.assert_not_called()

    def test_encoded_authority_receipt_image_is_protected_and_checksum_checked(self):
        raw = json.dumps({'imageId': m.TARGETS[0]['id']}).encode()
        proof = {'hostReceiptBase64': base64.b64encode(raw).decode(), 'hostReceiptSha256': m.sha(raw)}
        self.assertEqual(m.referenced_images(proof), {m.TARGETS[0]['id']})
        proof['hostReceiptSha256'] = '0' * 64
        with self.assertRaises(RuntimeError):
            m.referenced_images(proof)


if __name__ == '__main__':
    unittest.main()
