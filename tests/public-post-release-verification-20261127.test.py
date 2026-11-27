import copy
import datetime
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_verification', ROOT / 'scripts/public-post-release-verification-20261127.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ResourceRuntimeBindingTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 11, 27, 5, tzinfo=datetime.timezone.utc)
        self.old, self.new = 'a' * 40, 'b' * 40
        self.value = {'kind': 'regcloud-resource-inventory-20261126-v1', 'status': 'observed',
            'healthAndContainersUnchanged': True, 'runtimeLockHeld': True, 'mutations': 0, 'providerRequests': 0,
            'measuredAtUtc': '2026-11-27T04:59:00Z', 'servingContainerId': 'c' * 64,
            'health': {'releaseSha': self.new, 'calculationVersion': module.CALCULATION, 'status': 200, 'ok': True},
            'containers': [{'id': 'c' * 64, 'runtimeSha': self.new, 'running': True}]}

    def test_new_reviewed_runtime_can_be_compared_without_a_fixed_old_failure_artifact(self):
        self.assertEqual(module.checked_resource_runtime(self.value, [self.old, self.new], self.now), self.new)
        self.assertEqual(module.GENERATION, 'gen_china_45875678028_1')
        self.assertEqual(module.TOTAL, 281310)

    def test_unreviewed_or_unstable_observation_cannot_select_public_identity(self):
        with self.assertRaises(ValueError):
            module.checked_resource_runtime(self.value, [self.old], self.now)
        for key, value in [('status', 'failed'), ('mutations', 1), ('providerRequests', 1),
                           ('runtimeLockHeld', False), ('healthAndContainersUnchanged', False),
                           ('measuredAtUtc', '2026-11-26T04:59:00Z')]:
            bad = copy.deepcopy(self.value)
            bad[key] = value
            with self.assertRaises(ValueError):
                module.checked_resource_runtime(bad, [self.old, self.new], self.now)
        for patch in [{'runtimeSha': self.old}, {'running': False}, {'id': 'd' * 64}]:
            bad = copy.deepcopy(self.value)
            bad['containers'][0].update(patch)
            with self.assertRaises(ValueError):
                module.checked_resource_runtime(bad, [self.old, self.new], self.now)


if __name__ == '__main__':
    unittest.main()
