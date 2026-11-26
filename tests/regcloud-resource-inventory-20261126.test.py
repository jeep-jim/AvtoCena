import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('resource_inventory', ROOT / 'scripts/regcloud-resource-inventory-20261126.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def container():
    return {'Id': 'a' * 64, 'Name': '/avtocena-accepted-123456789012', 'Image': 'sha256:' + 'b' * 64,
      'Config': {'Env': ['SECRET=private-secret'], 'Labels': {'org.opencontainers.image.revision': 'c' * 40,
        'avtocena.role': 'independent-china'}, 'Cmd': ['secret-argument']},
      'HostConfig': {'PortBindings': {'3000/tcp': [{'HostPort': '3005'}]}, 'NetworkMode': 'bridge'},
      'State': {'Running': True, 'Pid': 124}, 'Mounts': [
        {'Type': 'bind', 'Source': '/private/customer-records', 'Destination': '/app/private-ledger', 'RW': True},
        {'Type': 'bind', 'Source': str(module.ROOT) + '/' + 'c' * 40 + '/china-next/' + 'd' * 32 + '/generation',
         'Destination': '/run/private-data', 'RW': False}], 'SizeRw': 2024}


class InventoryTests(unittest.TestCase):
    def test_public_container_projection_does_not_emit_private_configuration_or_paths(self):
        row = container()
        value = module.container_summary(row, [row], [3005], {3005: 2})
        raw = json.dumps(value)
        for forbidden in ('private-secret', 'SECRET', 'secret-argument', 'customer-records', 'private-ledger', 'private-data', 'd' * 32):
            self.assertNotIn(forbidden, raw)
        self.assertEqual(value['nginxReferencedPorts'], [3005])
        self.assertEqual(value['establishedConnectionsToPort'], {'3005': 2})
        self.assertEqual(value['mounts'][1]['release']['category'], 'china-next')
        self.assertEqual(value['writableBytes'], 2024)

    def test_mount_record_order_is_ignored_but_cmd_and_env_order_are_not(self):
        row = container()
        before = module.signature(row)
        row['Mounts'].reverse()
        self.assertEqual(module.signature(row), before)
        row['Config']['Env'].append('SECOND=private')
        before = module.signature(row)
        row['Config']['Env'].reverse()
        self.assertNotEqual(module.signature(row), before)

    def test_changed_component_report_contains_hashes_not_private_configuration(self):
        import copy
        before = container()
        after = copy.deepcopy(before)
        after['Config']['Env'] = ['SECRET=new-private-secret']
        after['State']['Pid'] += 1
        value = module.stability_difference(before, after)
        self.assertEqual(set(value['changedComponents']), {'Config', 'state'})
        self.assertNotIn('new-private-secret', json.dumps(value))
        self.assertEqual(value['stateAfter']['Pid'], 125)

    def test_dependency_prevents_calling_other_container_unreferenced(self):
        row = container()
        dependent = container()
        dependent['Id'] = 'e' * 64
        dependent['HostConfig']['NetworkMode'] = 'container:' + row['Id']
        value = module.container_summary(row, [row, dependent], [], {})
        self.assertEqual(value['dependentContainerIds'], ['e' * 64])

    def test_retained_configuration_fingerprint_changes_with_environment_mount_or_process(self):
        row = container()
        before = module.signature(row)
        row['Config']['Env'].append('ANOTHER=hidden')
        self.assertNotEqual(module.signature(row), before)
        before = module.signature(row)
        row['State']['Pid'] += 1
        self.assertNotEqual(module.signature(row), before)

    def test_bounded_reader_refuses_symlink_and_oversized_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proof.json'
            path.write_bytes(b'{}')
            link = Path(directory) / 'link.json'
            link.symlink_to(path)
            self.assertEqual(module.bounded(path, 2), b'{}')
            with self.assertRaises(RuntimeError):
                module.bounded(path, 1)
            with self.assertRaises(OSError):
                module.bounded(link)

    def test_nginx_route_report_hashes_sensitive_configuration(self):
        with mock.patch.object(module, 'run', return_value=b'password private; proxy_pass http://127.0.0.1:3005; server localhost:3006;'):
            result = module.routes()
        self.assertEqual(result['localPorts'], [3005, 3006])
        self.assertNotIn('private', json.dumps(result))

    def test_untrusted_names_and_release_mount_tails_never_become_public_labels(self):
        row = container()
        row['Name'] = '/secret-client-name'
        row['Config']['Labels']['avtocena.role'] = 'secret/role'
        result = module.container_summary(row, [row], [], {})
        self.assertEqual(result['name'], '<other>')
        self.assertEqual(result['role'], '<unknown>')
        self.assertIsNone(module.release_mount('/private/c' * 40))


if __name__ == '__main__':
    unittest.main()
