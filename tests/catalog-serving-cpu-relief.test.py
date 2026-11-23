import contextlib
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


inv = load('incumbent_inventory', '.github/operations/home-ui-only-20261123/inventory.py')
relief = load('cpu_relief', '.github/operations/catalog-incident/restore-cpu.py')
fixtures = load('cpu_inventory_fixture', 'tests/home-ui-runtime-inventory.test.py')


class ReliefTest(unittest.TestCase):
    def setUp(self):
        self.io = fixtures.FakeIO()
        self.row = self.io.rows[inv.ROLES[0][1]]
        self.row['RestartCount'] = relief.RESTARTS
        self.row['State'].update(Pid=relief.OBSERVED_PID, StartedAt=relief.STARTED)
        for role, name, *_ in inv.ROLES[1:]:
            self.io.rows[name]['Id'] = relief.ROLLBACKS[role]
        self.calls = []
        self.io.lock = contextlib.nullcontext
        self.patch = patch.object(inv, 'NGINX_SHA256', inv.hashlib.sha256(fixtures.CONFIG).hexdigest())
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def write(self, cores):
        self.calls.append(cores)
        self.row['HostConfig']['NanoCpus'] = cores*10**9

    def apply(self, **options):
        return relief.apply(self.io, options.get('write', self.write),
                            lambda: self.row['HostConfig']['NanoCpus']//10**9,
                            options.get('read', relief.observed))

    def test_resource_change_then_idempotent_replay(self):
        receipt, changed = self.apply()
        self.assertTrue(changed)
        self.assertEqual(receipt['containers']['serving']['resources']['NanoCpus'], 8_000_000_000)
        self.assertEqual(receipt['containers']['serving']['pid'], relief.OBSERVED_PID)
        self.assertFalse(receipt['activationAuthorized'])
        self.assertFalse(self.apply()[1])
        self.assertEqual(self.calls, [8])

    def test_health_failure_after_update_restores_original_cpu_only(self):
        def read(io, cores):
            if cores == relief.HOST_CORES:
                raise RuntimeError('health read failed')
            return relief.observed(io, cores)
        with self.assertRaisesRegex(RuntimeError, 'health read failed'):
            self.apply(read=read)
        self.assertEqual(self.calls, [8, 2])

    def test_foreign_process_or_ingress_prevents_update(self):
        self.row['State']['StartedAt'] = inv.SERVING_STARTED_AT
        with self.assertRaises(inv.InventoryError):
            self.apply()
        self.assertEqual(self.calls, [])

    def test_unexpected_additional_config_change_rolls_back_only_cpu(self):
        def write(cores):
            self.write(cores)
            self.row['HostConfig']['ExtraChange'] = True
        with self.assertRaises(AssertionError):
            self.apply(write=write)
        self.assertTrue(self.row['HostConfig']['ExtraChange'])
        self.assertEqual(self.calls, [8, 2])


if __name__ == '__main__':
    unittest.main()
