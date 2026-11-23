import contextlib
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / '.github/operations/home-ui-only-20261123/inventory.py'
SPEC = importlib.util.spec_from_file_location('home_ui_inventory', SOURCE)
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)
CONFIG = b'server {\n  proxy_pass http://127.0.0.1:3002;\n}\n'
SECRET = 'synthetic-secret-never-printed'


def containers():
    result = {}
    for index, role in enumerate(inventory.ROLES):
        kind, name, revision, image, port, armed = role
        env = {'AVTOCENA_RELEASE_SHA': revision, 'AVTOCENA_BUILD_CALCULATION_VERSION': inventory.BUILD,
               'AVTOCENA_CALCULATION_VERSION': inventory.CALCULATION, 'PRIVATE_TOKEN': SECRET}
        if armed:
            env['AVTOCENA_CHINA_REGCLOUD_RUNTIME'] = '1'
        result[name] = {
            'Id': inventory.SERVING_ID if kind == 'serving' else str(index) * 64,
            'Name': '/' + name, 'Image': image, 'RestartCount': 0,
            'Config': {'Env': [key + '=' + value for key, value in env.items()],
                       'Labels': {'org.opencontainers.image.revision': revision,
                                  'avtocena.role': 'china-ui-grid-dark'}},
            'State': {'Running': True, 'OOMKilled': False, 'Pid': 4000 + index,
                      'StartedAt': '2026-11-20T11:46:00.123456789Z'},
            'HostConfig': {'Privileged': False,
                           'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(port)}]},
                           'Memory': 4 * 1024**3, 'MemorySwap': 4 * 1024**3,
                           'NanoCpus': 2000000000, 'PidsLimit': 512,
                           'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}},
            'Mounts': [{'Type': 'bind', 'RW': False, 'Source': src, 'Destination': dest}
                       for src, dest in sorted(inventory.MOUNTS)],
        }
    return result


class FakeIO(inventory.LocalIO):
    def __init__(self):
        self.rows = containers()
        self.commands = []
        self.raw_config = CONFIG
        self.lock_error = None
        self.health_override = {}
        self.ports = set()
        self.on_inspect = None
        super().__init__(self.mock_docker_get)

    def mock_docker_get(self, endpoint):
        self.commands.append(('GET', endpoint))
        if self.on_inspect:
            self.on_inspect(self, len(self.commands))
        return json.dumps(self.rows[endpoint.split('/')[2]]).encode()

    @contextlib.contextmanager
    def lock(self):
        if self.lock_error:
            raise inventory.InventoryError(self.lock_error)
        yield

    def config(self):
        return self.raw_config

    def listening_ports(self):
        return self.ports

    def health(self, port):
        if port in self.health_override:
            return self.health_override[port]
        release = inventory.RELEASE if port == 443 else next(role[2] for role in inventory.ROLES if role[4] == port)
        return {'ok': True, 'releaseSha': release, 'calculationVersion': inventory.CALCULATION}


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.sha = mock.patch.object(inventory, 'NGINX_SHA256', hashlib.sha256(CONFIG).hexdigest())
        self.sha.start()
        self.addCleanup(self.sha.stop)

    def test_valid_inventory_is_readonly_and_requires_reviewed_rollback_ids(self):
        local = FakeIO()
        receipt = inventory.run_inventory(local)
        self.assertEqual(receipt['containers']['serving']['id'], inventory.SERVING_ID)
        self.assertEqual(receipt['rollbackPins'], {'chinaRollback': '1' * 64, 'legacyRollback': '2' * 64})
        self.assertFalse(receipt['activationAuthorized'])
        self.assertTrue(receipt['requiresReviewedRollbackPins'])
        self.assertFalse(receipt['candidatePort']['dockerReservationVerified'])
        self.assertEqual(receipt['mutations'], 0)
        self.assertEqual(local.commands, [('GET', '/containers/' + role[1] + '/json')
                                          for _ in range(2) for role in inventory.ROLES])
        serialized = json.dumps(receipt)
        self.assertNotIn(SECRET, serialized)
        self.assertNotIn('PRIVATE_TOKEN', serialized)
        self.assertNotIn('proxy_pass', serialized)
        for row in receipt['containers'].values():
            self.assertRegex(row['environmentSha256'], r'^[0-9a-f]{64}$')
            self.assertRegex(row['hostConfigSha256'], r'^[0-9a-f]{64}$')
            self.assertEqual(row['environmentCount'], len(local.rows[row['name']]['Config']['Env']))

    def test_foreign_identity_mount_resources_and_env_fail_closed(self):
        mutations = {
            'container': lambda row: row.update(Id='f' * 64),
            'image': lambda row: row.update(Image='sha256:' + 'f' * 64),
            'source': lambda row: row['Config']['Labels'].update({'org.opencontainers.image.revision': 'f' * 40}),
            'port': lambda row: row['HostConfig']['PortBindings']['3000/tcp'][0].update(HostIp='0.0.0.0'),
            'mount_rw': lambda row: row['Mounts'][0].update(RW=True),
            'mount_path': lambda row: row['Mounts'][0].update(Source='/foreign'),
            'resources': lambda row: row['HostConfig'].update(Memory=8 * 1024**3),
            'env_inheritance': lambda row: row['Config']['Env'].append('UNREVIEWED=value'),
            'env_duplicate': lambda row: row['Config']['Env'].append('PRIVATE_TOKEN=' + SECRET),
            'build': lambda row: row['Config']['Env'].__setitem__(1, 'AVTOCENA_BUILD_CALCULATION_VERSION=' + 'f' * 64),
        }
        for name, change in mutations.items():
            with self.subTest(name=name):
                local = FakeIO()
                change(local.rows[inventory.ROLES[0][1]])
                with self.assertRaises(inventory.InventoryError):
                    inventory.run_inventory(local)

    def test_rollback_identity_and_changed_process_are_rejected(self):
        for index in (1, 2):
            local = FakeIO()
            local.rows[inventory.ROLES[index][1]]['Image'] = 'sha256:' + 'f' * 64
            with self.assertRaisesRegex(inventory.InventoryError, 'inventory_container_identity'):
                inventory.run_inventory(local)
        local = FakeIO()
        def change_at_second_snapshot(fake, count):
            if count == 4:
                fake.rows[inventory.ROLES[1][1]]['Id'] = 'a' * 64
        local.on_inspect = change_at_second_snapshot
        with self.assertRaisesRegex(inventory.InventoryError, 'inventory_identity_changed'):
            inventory.run_inventory(local)

    def test_nginx_health_lock_and_listening_port_fail_closed(self):
        local = FakeIO()
        local.raw_config += b'# foreign change\n'
        with self.assertRaisesRegex(inventory.InventoryError, 'inventory_nginx_postimage'):
            inventory.run_inventory(local)
        for port in (3000, 3001, 3002, 443):
            local = FakeIO()
            local.health_override[port] = {'ok': True, 'releaseSha': 'wrong', 'calculationVersion': inventory.CALCULATION}
            with self.assertRaises(inventory.InventoryError):
                inventory.run_inventory(local)
        for code in ('inventory_lock_absent', 'inventory_lock_busy'):
            local = FakeIO()
            local.lock_error = code
            with self.assertRaisesRegex(inventory.InventoryError, code):
                inventory.run_inventory(local)
            self.assertEqual(local.commands, [])
        local = FakeIO()
        local.ports.add(3003)
        with self.assertRaisesRegex(inventory.InventoryError, 'inventory_candidate_port_listening'):
            inventory.run_inventory(local)

    def test_cli_never_prints_private_payloads_or_unexpected_exception_text(self):
        for failing in (False, True):
            local = FakeIO()
            if failing:
                local.on_inspect = lambda *args: (_ for _ in ()).throw(RuntimeError(SECRET))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = inventory.main([], local)
            receipt = json.loads(output.getvalue())
            self.assertEqual(result, int(failing))
            self.assertFalse(receipt['activationAuthorized'])
            self.assertNotIn(SECRET, output.getvalue())
            self.assertNotIn('PRIVATE_TOKEN', output.getvalue())
        with self.assertRaisesRegex(inventory.InventoryError, 'inventory_inspect_scope'):
            FakeIO().inspect('foreign-container')

    def test_lock_opens_existing_file_readonly_and_uses_shared_nonblocking(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'runtime.lock'
            path.write_text('')
            real_fstat = os.fstat
            def root_metadata(fd):
                result = real_fstat(fd)
                return types.SimpleNamespace(st_mode=result.st_mode, st_uid=0, st_nlink=result.st_nlink)
            with mock.patch.object(inventory, 'LOCK_PATH', str(path)), mock.patch.object(inventory.os, 'fstat', side_effect=root_metadata):
                with mock.patch.object(inventory.fcntl, 'flock', wraps=fcntl.flock) as flock:
                    with inventory.LocalIO().lock():
                        self.assertEqual(flock.call_args.args[1], fcntl.LOCK_SH | fcntl.LOCK_NB)
                with open(path, 'r') as writer:
                    fcntl.flock(writer.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    with self.assertRaisesRegex(inventory.InventoryError, 'inventory_lock_busy'):
                        with inventory.LocalIO().lock():
                            self.fail('busy writer must refuse inventory')
            with mock.patch.object(inventory, 'LOCK_PATH', str(path) + '-absent'):
                with self.assertRaisesRegex(inventory.InventoryError, 'inventory_lock_absent'):
                    with inventory.LocalIO().lock():
                        self.fail('must not create a missing lock')
                self.assertFalse(Path(str(path) + '-absent').exists())

    def test_proc_listening_observation_does_not_bind_a_port(self):
        text = 'sl local_address rem_address st\n0: 0100007F:0BBB 00000000:0000 0A\n1: 0100007F:0BBC 00000000:0000 01\n'
        self.assertEqual(inventory.listening_ports_from_proc(text), {3003})

    def test_docker_uses_only_exact_get_endpoints_and_local_unix_socket(self):
        body = json.dumps(containers()[inventory.ROLES[0][1]]).encode()
        response = types.SimpleNamespace(status=200, read=lambda limit: body)
        with mock.patch.dict(os.environ, {'DOCKER_HOST': 'ssh://foreign', 'DOCKER_CONTEXT': 'foreign',
                                          'PRIVATE_TOKEN': SECRET}), mock.patch.object(inventory, 'DockerUnixHTTPConnection') as connection:
            connection.return_value.getresponse.return_value = response
            inventory.LocalIO().inspect(inventory.ROLES[0][1])
            connection.return_value.request.assert_called_once_with(
                'GET', '/containers/' + inventory.ROLES[0][1] + '/json', headers={'Accept': 'application/json'})
            for endpoint in ('/version', '/_ping', '/containers/foreign/json',
                             '/containers/' + inventory.ROLES[0][1] + '/stop'):
                with self.assertRaisesRegex(inventory.InventoryError, 'inventory_docker_endpoint_scope'):
                    inventory.LocalIO._docker_get(endpoint)
            self.assertEqual(connection.call_count, 1)
        with mock.patch.object(inventory.socket, 'socket') as socket_factory:
            transport = inventory.DockerUnixHTTPConnection()
            transport.connect()
            socket_factory.assert_called_once_with(inventory.socket.AF_UNIX, inventory.socket.SOCK_STREAM)
            socket_factory.return_value.connect.assert_called_once_with('/var/run/docker.sock')


if __name__ == '__main__':
    unittest.main()
