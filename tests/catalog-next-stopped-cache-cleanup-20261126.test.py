import base64
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stopped_cache_cleanup', ROOT / 'scripts/catalog-next/cleanup-stopped-cache-containers-20261126.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture(paths, metadata=None):
    target = {**m.TARGETS[0], 'changeCount': len(paths),
              'noncacheCount': sum(not path.startswith('/app/apps/web/.next/cache/') for path, _ in paths)}
    row = {'Id': target['id'], 'Image': target['imageId'], 'SizeRw': target['writableBytes'], 'State': {'Running': False, 'Pid': 0}}
    heads = []
    consumed = []
    def stream(_):
        for path, kind in paths:
            consumed.append(path)
            yield {'Path': path, 'Kind': kind}
    def api(method, path):
        from urllib.parse import unquote
        assert method == 'HEAD'
        actual = unquote(path.split('path=')[1])
        heads.append(actual)
        return (metadata or {}).get(actual, {'size': 4096, 'mode': 0x800001ed, 'linkTarget': ''})
    reader = types.SimpleNamespace(stream_changes=stream, api=api, fingerprint=lambda _: target['configurationSha256'])
    return target, row, reader, heads, consumed


class CacheCleanupTests(unittest.TestCase):
    def test_exact_plan_retains_current_rollback_shared_legacy_and_every_image(self):
        m.validate_targets()
        self.assertEqual(sum(row['writableBytes'] for row in m.TARGETS), 12974002176)
        self.assertEqual(len(m.IMAGE_IDS), 13)
        self.assertEqual({row['id'][:12] for row in m.RETAINED}, {'bf233b651cc4', '21a709391464', '2c180485762c', '21d2c808c25b'})
        for runtime in ('a182cd21b21ecf612b63613d263e5bdd817ea4c0', 'e4f2781ed52f12f53430118bea51ef150608ccfe'):
            pin = next(row for row in m.TARGETS if row['runtimeSha'] == runtime)
            self.assertIn(pin['imageId'], m.IMAGE_IDS)
        with mock.patch.object(m, 'TARGETS', [{**m.TARGETS[0], 'id': m.RETAINED[0]['id']}, *m.TARGETS[1:]]):
            with self.assertRaisesRegex(RuntimeError, 'retained_target'):
                m.validate_targets()

    def test_all_noncache_directories_are_head_checked_and_diff_order_is_canonical(self):
        paths = [('/app', 0), ('/run', 0), ('/app/apps/web/.next/cache', 1),
                 ('/app/apps/web/.next/cache/images/first.webp', 1)]
        target, row, reader, heads, consumed = fixture(paths)
        proof = m.prove_cache_only(row, target, reader)
        self.assertEqual(sorted(heads), sorted(path for path, _ in paths[:3]))
        self.assertEqual(consumed, [path for path, _ in paths])
        self.assertTrue(proof['changesComplete'] and proof['noncacheMetadataComplete'])
        target2, row2, reader2, _, _ = fixture(list(reversed(paths)))
        self.assertEqual(m.prove_cache_only(row2, target2, reader2), proof)

    def test_late_unique_application_file_cannot_hide_in_a_large_cache(self):
        paths = [('/app/apps/web/.next/cache/images/' + str(index) + '.webp', 1) for index in range(50001)]
        paths.extend([('/app/data/unique.json', 1), ('/run', 0)])
        target, row, reader, heads, consumed = fixture(paths, {'/app/data/unique.json': {'size': 123, 'mode': 0o644}})
        with self.assertRaisesRegex(RuntimeError, 'noncache_not_proven') as caught:
            m.prove_cache_only(row, target, reader)
        self.assertEqual(len(consumed), len(paths))
        self.assertEqual(sorted(heads), ['/app/data/unique.json', '/run'])
        output = json.dumps(caught.exception.safePathMetadata)
        self.assertNotIn('/app/data/unique.json', output)
        self.assertIn(m.sha('/app/data/unique.json'.encode()), output)

    def test_regular_file_at_allowlisted_directory_and_unknown_directory_are_refused(self):
        for path, value in [('/app', {'mode': 0o644, 'size': 5}),
                            ('/app/customer-data', {'mode': 0x800001ed, 'size': 4096})]:
            target, row, reader, _, _ = fixture([(path, 1)], {path: value})
            with self.assertRaisesRegex(RuntimeError, 'noncache_not_proven'):
                m.prove_cache_only(row, target, reader)

    def test_symlink_targets_and_missing_metadata_are_strict(self):
        self.assertTrue(m.safe_noncache('/var/run', 1, {'mode': 0x080001ff, 'size': 4, 'linkTarget': '/run'}))
        self.assertFalse(m.safe_noncache('/var/run', 1, {'mode': 0x080001ff, 'size': 11, 'linkTarget': '/app/data'}))
        self.assertFalse(m.safe_noncache('/run', 1, {'mode': 0x080001ff, 'size': 4, 'linkTarget': '/run'}))
        self.assertFalse(m.safe_noncache('/run', 1, None))
        self.assertFalse(m.safe_noncache('/run', 2, {'mode': 0x800001ed, 'size': 4096}))

    def test_running_or_changed_layer_and_incomplete_or_duplicate_diffs_refuse(self):
        paths = [('/app', 0), ('/app/apps/web/.next/cache/images/a', 1)]
        target, row, reader, _, _ = fixture(paths)
        for changed in [{**row, 'State': {'Running': True, 'Pid': 1}}, {**row, 'SizeRw': row['SizeRw'] + 1}]:
            with self.assertRaisesRegex(RuntimeError, 'target_binding'):
                m.prove_cache_only(changed, target, reader)
        with self.assertRaisesRegex(RuntimeError, 'diff_count'):
            m.prove_cache_only(row, {**target, 'changeCount': 3}, reader)
        target2, row2, reader2, _, _ = fixture([('/app', 0), ('/app', 0)])
        with self.assertRaisesRegex(RuntimeError, 'diff_count'):
            m.prove_cache_only(row2, target2, reader2)

    def test_namespace_short_id_references_and_verified_receipts_protect_targets(self):
        target = {'Id': m.TARGETS[0]['id'], 'Name': '/old-container'}
        for reference in [target['Id'], target['Id'][:12], 'old-container']:
            other = {'Id': m.RETAINED[0]['id'], 'HostConfig': {'NetworkMode': 'container:' + reference}}
            self.assertTrue(m.has_container_dependency(target, {target['Id']: target, other['Id']: other}))
        raw = json.dumps({'containerId': target['Id']}).encode()
        proof = {'hostReceiptBase64': base64.b64encode(raw).decode(), 'hostReceiptSha256': m.sha(raw)}
        self.assertEqual(m.referenced_containers(proof), {target['Id']})
        proof['hostReceiptSha256'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'reference_checksum'):
            m.referenced_containers(proof)

    def test_one_exact_nonforced_delete_preserves_images_volumes_and_checks_health(self):
        action = m.Cleanup.__new__(m.Cleanup)
        action.removed, action.inflight = [], False
        action.check_authority = mock.Mock()
        action.fence = mock.Mock(return_value=({}, {}))
        action.cache_proofs = [{'verified': True}]
        action.c = object()
        action.r = types.SimpleNamespace(disk=mock.Mock(side_effect=[{'availableBytes': 10}, {'availableBytes': 20}]))
        action.h = types.SimpleNamespace(docker=mock.Mock(return_value={}))
        with mock.patch.object(m, 'prove_cache_only', return_value={'verified': True}):
            value = action.step({'action': 'remove', 'index': 0, 'authority': {}})
        calls = action.h.docker.call_args_list
        self.assertEqual(calls, [mock.call('GET', '/containers/' + m.TARGETS[0]['id'] + '/json?size=1'),
                                mock.call('DELETE', '/containers/' + m.TARGETS[0]['id'] + '?force=false&v=false')])
        self.assertEqual(action.fence.call_count, 3)
        self.assertFalse(action.inflight)
        self.assertEqual(value['measuredFreeBytesChange'], 10)

    def test_failed_predelete_fence_never_deletes_and_failed_postdelete_is_uncertain(self):
        for failure_number in (2, 3):
            action = m.Cleanup.__new__(m.Cleanup)
            action.removed, action.inflight = [], False
            action.check_authority = mock.Mock()
            action.fence = mock.Mock(side_effect=[({}, {})] * (failure_number - 1) + [RuntimeError('stopped_cleanup_proof_changed')])
            action.cache_proofs = [{}]
            action.c = object()
            action.r = types.SimpleNamespace(disk=lambda: {'availableBytes': 10})
            action.h = types.SimpleNamespace(docker=mock.Mock(return_value={}))
            with mock.patch.object(m, 'prove_cache_only', return_value={}):
                with self.assertRaisesRegex(RuntimeError, 'proof_changed'):
                    action.step({'action': 'remove', 'index': 0, 'authority': {}})
            deletions = [call for call in action.h.docker.call_args_list if call.args[0] == 'DELETE']
            self.assertEqual(len(deletions), int(failure_number == 3))
            self.assertEqual(action.inflight, failure_number == 3)
            self.assertEqual(len(action.removed), int(failure_number == 3))

    def test_public_image_output_omits_environment_and_unknown_tag_material(self):
        row = {'Id': next(iter(m.IMAGE_IDS)), 'Config': {'Env': ['PASSWORD=do-not-print'], 'Labels': {'org.opencontainers.image.revision': m.CURRENT}},
               'RepoTags': ['private/token-secret:secret', 'avtocena-regcloud:' + m.CURRENT],
               'RepoDigests': ['private/token-secret@sha256:' + 'a' * 64]}
        output = m.public_image(row, {})
        self.assertEqual(output['repoTags'], ['avtocena-regcloud:' + m.CURRENT])
        self.assertEqual(output['repoDigests'], [])
        self.assertNotIn('secret', json.dumps(output))
        self.assertNotIn('PASSWORD', json.dumps(output))


if __name__ == '__main__':
    unittest.main()
