import copy
import datetime
import importlib.util
from pathlib import Path
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('legacy_stop', ROOT / 'scripts/catalog-next/stop-unused-legacy-20261126.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def action():
    value = m.Stop.__new__(m.Stop)
    value.stopped, value.restored, value.inflight = [], [], False
    value.authority = {'ok': True}
    value.check_authority = mock.Mock()
    value.original = {row['id']: {'Id': row['id'], 'Image': row['imageId'], 'State': {'Running': True, 'Pid': 5}}
                      for row in m.TARGETS}
    rows = copy.deepcopy(value.original)
    operations = []
    def docker(method, path):
        identity = path.split('/')[2]
        operations.append((method, path))
        if method == 'POST' and path.endswith('/stop?t=25'):
            rows[identity]['State'] = {'Running': False, 'Pid': 0}
        elif method == 'POST' and path.endswith('/start'):
            rows[identity]['State'] = {'Running': True, 'Pid': 6}
        elif method != 'GET':
            raise AssertionError('Unexpected mutation')
        return copy.deepcopy(rows[identity])
    value.h = types.SimpleNamespace(docker=docker)
    value.r = types.SimpleNamespace(signature=m.digest, memory=lambda: {'MemAvailable': 100}, disk=lambda: {})
    value.fence = mock.Mock()
    value.expected = {key: m.digest(row) for key, row in value.original.items()}
    return value, rows, operations


class LegacyStopTests(unittest.TestCase):
    def test_plan_does_not_target_current_or_rollback(self):
        m.validate_targets()
        self.assertNotIn(m.CURRENT, {row['runtimeSha'] for row in m.TARGETS})
        self.assertEqual({row['port'] for row in m.TARGETS}, {3001, 3003})

    def test_only_exact_stop_is_used_no_container_or_image_delete(self):
        value, rows, operations = action()
        result = value.step({'action': 'stop', 'index': 0, 'authority': value.authority})
        self.assertFalse(rows[m.TARGETS[0]['id']]['State']['Running'])
        self.assertEqual(result['containerId'], m.TARGETS[0]['id'])
        self.assertEqual([path for method, path in operations if method == 'POST'],
                         ['/containers/' + m.TARGETS[0]['id'] + '/stop?t=25'])
        self.assertTrue(result['currentAndRollbackHealthy'])
        self.assertFalse(value.inflight)

    def test_reference_or_health_failure_before_stop_refuses_mutation(self):
        value, rows, operations = action()
        value.fence.side_effect = RuntimeError('legacy_stop_target_referenced')
        with self.assertRaises(RuntimeError):
            value.step({'action': 'stop', 'index': 0, 'authority': value.authority})
        self.assertEqual(operations, [])
        self.assertEqual(value.stopped, [])

    def test_failed_health_after_stop_restarts_original_process(self):
        value, rows, operations = action()
        value.fence.side_effect = [None, RuntimeError('china_host_health')]
        with mock.patch.object(m.signal, 'signal'), self.assertRaises(RuntimeError):
            value.step({'action': 'stop', 'index': 0, 'authority': value.authority})
        self.assertTrue(rows[m.TARGETS[0]['id']]['State']['Running'])
        self.assertEqual(value.restored, [m.TARGETS[0]['id']])
        self.assertFalse(value.inflight)

    def test_out_of_order_action_cannot_stop_second_process(self):
        value, rows, operations = action()
        with self.assertRaises(RuntimeError):
            value.step({'action': 'stop', 'index': 1, 'authority': value.authority})
        self.assertEqual(operations, [])

    def test_restore_uncertainty_is_explicit(self):
        value, rows, operations = action()
        value.stopped = [m.TARGETS[0]['id']]
        value.h.docker = mock.Mock(side_effect=RuntimeError('disconnected'))
        with mock.patch.object(m.signal, 'signal'):
            value.restore()
        self.assertTrue(value.inflight)
        self.assertEqual(value.restored, [])

    def test_authority_requires_accepted_current_b_and_rollback_a(self):
        value = m.Stop.__new__(m.Stop)
        state = {'pending': None, 'current': {'runtimeSha': m.CURRENT, 'generationId': m.GENERATION,
                 'generationManifestSha256': m.MANIFEST}, 'rollback': {'runtimeSha': m.CURRENT, 'generationId': m.ROLLBACK}}
        lease = {'kind': 'china-market-lease-v1', 'market': 'china', 'status': 'held',
                 'expiresAt': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=1)).isoformat()}
        value.authority = {'publicationState': state, 'lease': lease}
        value.h = types.SimpleNamespace(checked_publication_view=lambda view: (view, None), checked_observation=lambda item: item)
        self.assertEqual(value.check_authority(value.authority), state)
        state['rollback']['generationId'] = 'different'
        with self.assertRaises(RuntimeError):
            value.check_authority(value.authority)


if __name__ == '__main__':
    unittest.main()
