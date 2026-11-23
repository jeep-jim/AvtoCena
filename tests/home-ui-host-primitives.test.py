import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


host = load('home_host_primitives', ROOT / '.github/operations/home-ui-adapter-20261123/host-primitives.py')
fixtures = load('inventory_fixtures', ROOT / 'tests/home-ui-runtime-inventory.test.py')
CONFIG = fixtures.CONFIG
NONCE = 'a' * 32
IMAGE = 'sha256:' + 'b' * 64
SECRET = fixtures.SECRET


def context():
    local = fixtures.FakeIO()
    for role in host.inventory.ROLES:
        if role[0] in host.ROLLBACK_IDS:
            local.rows[role[1]]['Id'] = host.ROLLBACK_IDS[role[0]]
    with mock.patch.object(host.inventory, 'NGINX_SHA256', host.sha(CONFIG)):
        receipt = host.inventory.run_inventory(local)
    receipt['nginxSha256'] = host.inventory.NGINX_SHA256
    plan = {'version': 1, 'nonce': NONCE, 'source': host.SOURCE, 'tree': host.TREE,
            'sourceCalculationVersion': host.BUILD, 'servingCalculationVersion': host.CALCULATION,
            'privateIndexDigest': host.INDEX, 'privateFileSha256': 'c' * 64, 'privateFileBytes': 100,
            'generationId': 'gen_1790000000000_fixture', 'acceptedReadModelFingerprint': 'f' * 64,
            'imageId': IMAGE, 'inventorySha256': host.sha(host.json_bytes(receipt)),
            'resourceFiles': {name: 'd' * 64 for name in ('home-bootstrap.mjs', 'run-node-with-resources.mjs',
                                                       'lib/node-resource-memory.mjs', 'lib/node-resource-memory-startup.mjs')},
            'imageBuild': {'version': 1, 'status': 'verified_exact_home_image_build', 'activationAuthorized': False,
                           'imageId': IMAGE, 'source': host.SOURCE, 'tree': host.TREE,
                           'sourceCalculationVersion': host.BUILD, 'nodeVersion': 'v24.22.1',
                           'modelAssetSha256': host.ASSET, 'privateIndexInImage': False,
                           'resourceProbePassed': True, 'imageArchiveSha256': 'e' * 64, 'imageUnpackedBytes': 200}}
    plan['imageBuild']['resourceFiles'] = dict(plan['resourceFiles'])
    return plan, receipt, local.rows[host.inventory.ROLES[0][1]]


def inspected(spec, identity, *, running=True):
    mounts = []
    for value in spec['HostConfig']['Binds']:
        source, target, mode = value.rsplit(':', 2)
        mounts.append({'Source': source, 'Destination': target, 'RW': mode != 'ro', 'Type': 'bind'})
    return {'Id': identity, 'Image': spec['Image'], 'RestartCount': 0,
            'Config': {key: copy.deepcopy(spec[key]) for key in ('Env', 'WorkingDir', 'Entrypoint', 'Cmd', 'Labels')},
            'HostConfig': {**copy.deepcopy(spec['HostConfig']), 'Memory': 0, 'MemorySwap': 0, 'NanoCpus': 0, 'PidsLimit': None},
            'Mounts': mounts, 'State': {'Running': running, 'OOMKilled': False, 'Pid': 1234 if running else 0,
                                       'StartedAt': '2026-11-23T06:00:00.000000000Z'}}


def frame(value):
    raw = host.json_bytes(value) + b'\n'
    return b'\x01\0\0\0' + struct.pack('>I', len(raw)) + raw


def memory():
    return {'stage': 'node_resource_memory', 'nodeVersion': 'v24.22.1', 'requestedHeapBytes': 500 * 1048576,
            'actualHeapBytes': 500 * 1048576, 'physicalRamBytes': 1000000000, 'availableRamBytes': 500 * 1048576 + 1024,
            'usableSwapBytes': 0, 'startupAvailableRamBytes': 499000000, 'rssBytes': 1000000,
            'heapUsedBytes': 200000, 'externalBytes': 100000, 'notAllowedPrivate': SECRET}


class FakeLocal:
    def __init__(self, plan):
        self.plan, self.rows, self.owned, self.events = plan, {}, set(), []
        self.fail_start = False

    def create(self, spec, probe=False):
        identity = ('1' if probe else '2') * 64
        self.rows[identity] = inspected(spec, identity, running=False)
        self.owned.add(identity)
        self.events.append(('create', identity, spec))
        return identity

    def docker(self, method, endpoint, body=None):
        self.events.append((method, endpoint, body))
        identity = endpoint.split('/')[2].split('?')[0]
        row = self.rows[identity]
        if endpoint.endswith('/start'):
            if self.fail_start and identity == '2' * 64:
                raise host.HostError('home_host_synthetic_start_failure')
            row['State'].update(Running=True, Pid=1234)
        elif '/wait?' in endpoint:
            row['State'].update(Running=False, Pid=0)
            return {'StatusCode': 0}
        elif '/logs?' in endpoint:
            raw = frame(memory())
            if identity == '1' * 64:
                raw += frame({'stage': 'home_private_probe', 'passed': True, 'nodeVersion': 'v24.22.1',
                              'indexDigest': host.INDEX, 'fileSha256': self.plan['privateFileSha256']})
            return raw
        elif endpoint.endswith('/update'):
            row['HostConfig'].update(copy.deepcopy(body))
        elif '/stop?' in endpoint:
            row['State'].update(Running=False, Pid=0)
        elif method == 'DELETE':
            del self.rows[identity]

    def inspect_owned(self, identity):
        return copy.deepcopy(self.rows[identity])

    def free_port(self):
        self.events.append(('free_port',))

    def resource_snapshot(self):
        self.events.append(('resources',))
        return {'MemAvailable': 1000000000, 'SwapFree': 0}

    def health(self, target):
        self.events.append(('health', target))
        return True


class HostPrimitiveTests(unittest.TestCase):
    def test_transfer_checks_actual_data_mount_and_measured_image_bytes_before_writing(self):
        plan, _, _ = context()
        with tempfile.TemporaryDirectory() as temporary:
            staging, engine = Path(temporary) / 'staging', Path(temporary) / 'engine'
            staging.mkdir(); engine.mkdir()
            transport = mock.Mock(return_value=(200, host.json_bytes({'DockerRootDir': str(engine), 'private': SECRET})))
            local = host.LocalHost(plan, transport)
            original = os.stat
            split = False
            def owned_stat(path, *args, **kwargs):
                values = list(original(path, *args, **kwargs))
                values[4] = 0
                if split and Path(path) == engine:
                    values[2] += 1
                return os.stat_result(values)
            with mock.patch.object(host.os, 'stat', side_effect=owned_stat), \
                 mock.patch.object(host.os, 'statvfs', return_value=types.SimpleNamespace(f_bavail=500, f_frsize=1)):
                result = local.transfer_capacity(staging, 300)
                self.assertTrue(result['sharedFilesystem'])
                self.assertEqual(result['unpackedImageBytes'], 200)
                self.assertNotIn(SECRET, json.dumps(result))
                self.assertNotIn(str(engine), json.dumps(result))
                with self.assertRaisesRegex(host.HostError, 'image_disk_capacity'):
                    local.transfer_capacity(staging, 301)
            split = True
            with mock.patch.object(host.os, 'stat', side_effect=owned_stat), \
                 mock.patch.object(host.os, 'statvfs', side_effect=lambda target: types.SimpleNamespace(
                     f_bavail=300 if Path(target) == staging else 200, f_frsize=1)):
                result = local.transfer_capacity(staging, 300)
                self.assertFalse(result['sharedFilesystem'])
                with self.assertRaisesRegex(host.HostError, 'image_disk_capacity'):
                    local.transfer_capacity(staging, 301)
            self.assertTrue(all(call.args[:2] == ('GET', '/info') for call in transport.call_args_list))

    def test_plan_rejects_diagnostic_receipt_and_wrong_runtime_before_effects(self):
        plan, receipt, _ = context()
        host.checked_plan(plan, host.sha(host.json_bytes(plan)), receipt)
        for change in (lambda p: p.update(servingCalculationVersion=host.BUILD),
                       lambda p: p['imageBuild'].update(privateIndexInImage=True),
                       lambda p: p['imageBuild'].update(nodeVersion='v24.22.3'),
                       lambda p: p.update(generationId='unknown'),
                       lambda p: p['resourceFiles'].update({'extra.js': 'f' * 64})):
            bad = copy.deepcopy(plan)
            change(bad)
            with self.assertRaises(host.HostError):
                host.checked_plan(bad, host.sha(host.json_bytes(bad)), receipt)
        actual = json.loads((ROOT / 'docs/audits/2026-11-23-home-runtime-before.json').read_text())['receipt']
        with self.assertRaisesRegex(host.HostError, 'reviewed_inventory_required'):
            host.checked_inventory(actual)

    def test_spec_preserves_environment_and_ro_mounts_without_old_resource_limits(self):
        plan, _, serving = context()
        serving['Config']['Env'].append('NODE_OPTIONS=--trace-warnings --max-old-space-size=6144')
        original = copy.deepcopy(serving)
        spec = host.candidate_spec(plan, serving)
        env = dict(value.split('=', 1) for value in spec['Env'])
        self.assertNotIn('NODE_OPTIONS', env)
        self.assertEqual(env[host.INHERITED_OPTIONS], '--trace-warnings --max-old-space-size=6144')
        self.assertEqual(env['PRIVATE_TOKEN'], SECRET)
        self.assertEqual(env['AVTOCENA_RELEASE_SHA'], host.SOURCE)
        self.assertEqual(env['AVTOCENA_CALCULATION_VERSION'], host.CALCULATION)
        self.assertEqual(serving, original)
        self.assertEqual(spec['Entrypoint'], ['node'])
        self.assertEqual(spec['HostConfig']['PortBindings']['3000/tcp'], [{'HostIp': '127.0.0.1', 'HostPort': '3003'}])
        self.assertEqual(len(spec['HostConfig']['Binds']), 4)
        self.assertTrue(all(value.endswith(':ro') for value in spec['HostConfig']['Binds']))
        self.assertFalse(set(spec['HostConfig']) & {'Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit'})
        serving['Config']['Env'].append(host.INHERITED_OPTIONS + '=collision')
        with self.assertRaisesRegex(host.HostError, 'inherited_options_collision'):
            host.candidate_spec(plan, serving)

    def test_docker_is_local_and_only_mutates_owned_ids(self):
        plan, _, serving = context()
        calls = []
        def transport(method, endpoint, body):
            calls.append((method, endpoint, body))
            return 201, host.json_bytes({'Id': '2' * 64, 'Warnings': []})
        local = host.LocalHost(plan, transport)
        for endpoint in ('/containers/' + host.inventory.SERVING_ID + '/stop?t=10', '/images/create', '/system/prune'):
            with self.assertRaisesRegex(host.HostError, 'docker_scope'):
                local.docker('POST', endpoint)
        self.assertEqual(calls, [])
        identity = local.create(host.candidate_spec(plan, serving))
        local.docker('POST', '/containers/' + identity + '/start')
        with self.assertRaisesRegex(host.HostError, 'docker_update_scope'):
            local.docker('POST', '/containers/' + identity + '/update', {'Memory': 4294967296})
        self.assertEqual(len(calls), 2)
        sock = mock.Mock()
        with mock.patch.object(host.socket, 'socket', return_value=sock), mock.patch.dict(os.environ, {'DOCKER_HOST': 'ssh://foreign'}):
            connection = host.DockerSocket()
            connection.connect()
            sock.connect.assert_called_once_with('/var/run/docker.sock')

    def test_candidate_identity_rejects_inherited_caps_and_changed_process_or_env(self):
        plan, _, serving = context()
        spec = host.candidate_spec(plan, serving)
        good = inspected(spec, '2' * 64)
        host.candidate_identity(good, spec, '2' * 64)
        for change in (lambda r: r['HostConfig'].update(Memory=4294967296),
                       lambda r: r['HostConfig'].update(PidsLimit=512),
                       lambda r: r['Mounts'][0].update(RW=True),
                       lambda r: r['Config']['Env'].append('FOREIGN=value'),
                       lambda r: r.update(RestartCount=1),
                       lambda r: r.update(Image='sha256:' + 'f' * 64)):
            row = copy.deepcopy(good)
            change(row)
            with self.assertRaises(host.HostError):
                host.candidate_identity(row, spec, '2' * 64)

    def test_start_uses_private_probe_then_fresh_resources_and_cleans_failed_owned_start(self):
        for failure in (False, True):
            plan, receipt, serving = context()
            local = FakeLocal(plan)
            local.fail_start = failure
            authority = []
            adapter = host.HostPrimitives(plan, host.sha(host.json_bytes(plan)), receipt,
                                          lambda *args: authority.append(args), local=local)
            with self.assertRaisesRegex(host.HostError, 'runtime_lock_required'):
                adapter.start_candidate()
            self.assertEqual(local.events, [])
            adapter.locked = True  # The native exclusive flock is tested by the inventory/lock suite.
            with mock.patch.object(adapter, 'fresh_inventory', return_value=serving), \
                 mock.patch.object(adapter, 'checked_materials'), \
                 mock.patch.object(host.inventory.LocalIO, 'config', return_value=CONFIG), \
                 mock.patch.object(host.inventory, 'verify_config'), mock.patch.object(host.inventory, 'verify_health'):
                if failure:
                    with self.assertRaisesRegex(host.HostError, 'synthetic_start_failure'):
                        adapter.start_candidate()
                    self.assertNotIn('2' * 64, local.rows)
                else:
                    receipt = adapter.start_candidate()
                    self.assertEqual(receipt['startupResources']['nodeVersion'], 'v24.22.1')
                    self.assertNotIn(SECRET, json.dumps(receipt))
                    self.assertNotIn('notAllowedPrivate', json.dumps(receipt))
                    self.assertNotIn('1' * 64, local.rows)
                    positions = [event[0] for event in local.events]
                    self.assertLess(positions.index('resources'), positions.index('create', positions.index('create') + 1))
                    adapter.verify_candidate()
                    local.rows['2' * 64]['State']['Pid'] += 1
                    with self.assertRaisesRegex(host.HostError, 'candidate_process_changed'):
                        adapter.verify_candidate()

    def test_startup_memory_records_cannot_hide_missing_or_different_actual_heap(self):
        receipt = host.memory_receipt([memory()])
        self.assertNotIn(SECRET, json.dumps(receipt))
        for change in (lambda r: r.update(actualHeapBytes=1000), lambda r: r.update(nodeVersion='v24.22.3'),
                       lambda r: r.update(availableRamBytes=SECRET)):
            row = memory()
            change(row)
            with self.assertRaises(host.HostError):
                host.memory_receipt([row])
        with self.assertRaises(host.HostError):
            host.decoded_logs(b'not a Docker log frame')

    def test_nginx_atomic_rollback_after_reload_failure_and_foreign_change_refusal(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            directory.chmod(0o700)
            config = directory / 'nginx.conf'
            config.write_bytes(CONFIG)
            config.chmod(0o644)
            calls = []
            reload_failed = False
            def regular(path, **kwargs):
                raw, info = Path(path).read_bytes(), Path(path).stat()
                return raw, types.SimpleNamespace(st_mode=info.st_mode, st_uid=os.getuid(), st_gid=os.getgid())
            def command(args):
                nonlocal reload_failed
                calls.append(args)
                if args[0] == '/usr/bin/systemctl' and not reload_failed:
                    reload_failed = True
                    raise host.HostError('home_host_synthetic_reload_failed')
            transaction = host.NginxCompareAndSwap(directory / NONCE, lambda stage: calls.append(stage),
                                                  config_path=config, command=command)
            with mock.patch.object(host, 'regular', side_effect=regular), \
                 mock.patch.object(host, 'owned_directory', side_effect=lambda path: Path(path)), \
                 mock.patch.object(host.inventory, 'NGINX_SHA256', host.sha(CONFIG)):
                transaction.prepare()
                calls.clear()
                # Account for the switch authority callback before nginx -t.
                with self.assertRaises(host.HostError):
                    transaction.switch()
                self.assertIn(b':3003;', config.read_bytes())
                transaction.rollback()
                self.assertEqual(config.read_bytes(), CONFIG)
                self.assertEqual((directory / NONCE / 'nginx.before').read_bytes(), CONFIG)
                self.assertEqual((directory / NONCE / 'nginx.before').stat().st_mode & 0o777, 0o600)
                config.write_bytes(CONFIG + b'# foreign\n')
                with self.assertRaisesRegex(host.HostError, 'nginx_foreign_rollback'):
                    transaction.rollback()
                self.assertTrue(config.read_bytes().endswith(b'# foreign\n'))

    def test_private_materialization_is_exact_mode400_create_only_and_cleans_partial_input(self):
        plan, receipt, _ = context()
        raw = b'{"synthetic":"private index payload only"}'
        plan.update(privateFileBytes=len(raw), privateFileSha256=host.sha(raw))
        adapter = host.HostPrimitives(plan, host.sha(host.json_bytes(plan)), receipt, lambda *args: None)
        adapter.locked = True
        with tempfile.TemporaryDirectory() as temporary, \
             mock.patch.object(host, 'PRIVATE_PARENT', temporary), \
             mock.patch.object(host, 'PRIVATE_SOURCE', str(Path(temporary) / 'calculation-v1.json')), \
             mock.patch.object(host, 'owned_directory', side_effect=Path):
            target = Path(temporary) / 'calculation-v1.json'
            for invalid in (raw[:-1], raw + b'!', raw[:-1] + b'x'):
                with self.assertRaises(host.HostError):
                    adapter.install_private_index(io.BytesIO(invalid))
                self.assertEqual(list(Path(temporary).iterdir()), [])
            result = adapter.install_private_index(io.BytesIO(raw))
            self.assertTrue(result['created'])
            self.assertEqual(target.read_bytes(), raw)
            self.assertEqual(target.stat().st_mode & 0o777, 0o400)
            self.assertNotIn('payload', json.dumps(result))
            with mock.patch.object(host, 'regular', return_value=(raw + b'foreign', None)):
                with self.assertRaisesRegex(host.HostError, 'existing_private_file'):
                    adapter.install_private_index(io.BytesIO(raw))
            self.assertEqual(target.read_bytes(), raw)

    def test_full_server_runner_preserves_exact_programs_baseline_routes_and_phases(self):
        baseline = json.loads((ROOT / 'docs/operations/2026-11-11-accepted-speed-baseline.json').read_text())
        routes = list(dict.fromkeys(row['path'] for row in baseline['samples']))
        rows = [{'performanceGate': period, 'path': route, 'functionalPassed': True}
                for route in routes for period in ('warm', 'after_ttl', 'after_directory_ttl')]
        rows.append({'performanceGate': 'summary', 'marketScope': '', 'functionalPassed': True,
                     'acceptedBaselineEnforced': True, 'samples': 51, 'routes': routes, 'acceptedBaselineRoutes': routes})
        calls = []
        def execute(args, **kwargs):
            calls.append((args, kwargs))
            return types.SimpleNamespace(returncode=0, stdout=b'\n'.join(host.json_bytes(row) for row in rows))
        with mock.patch.object(host, 'regular', side_effect=lambda path, **_: (Path(path).read_bytes(), None)):
            result = host.run_full_server_gate(ROOT, NONCE, 'private', execute)
            self.assertEqual(len(result['phases']), 51)
            self.assertEqual(calls[0][0][-2:], ['http://127.0.0.1:3003', host.SOURCE])
            self.assertEqual(calls[0][1]['env']['AVTOCENA_RELEASE_MARKETS'], '')
            self.assertEqual(calls[0][1]['env']['AVTOCENA_SPEED_BASELINE_MODE'], 'enforce')
            host.run_full_server_gate(ROOT, NONCE, 'public', execute)
            self.assertEqual(calls[-1][0][-2], 'https://avtocena.com')
            rows.pop(0)
            with self.assertRaisesRegex(host.HostError, 'server_coverage'):
                host.run_full_server_gate(ROOT, NONCE, 'private', execute)

    def test_parity_accepts_only_home_provenance_omission_keeps_prices_unknown_and_auth(self):
        calls, changes = [], {}
        def get(where, path):
            calls.append((where, path))
            if path == '/api/crm/reviews':
                return changes.get('auth', 401), None, b''
            if path.startswith('/cars/offer/'):
                identity = path.split('/')[3].split('?')[0]
                return 200, None, ('<html><main data-offer-id="' + identity + '" data-offer-price-rub="1500000"></main></html>').encode()
            if path in (host.CHINA_GRID,host.CHINA_SAVED_GRID,host.CHINA_FILTER+'&countOnly=1',*host.CHINA_FILTER_PAGES):
                filtered='powerTo=160' in path
                start=24 if 'page=2' in path else 0
                rows=[] if 'countOnly' in path else [
                    {'id':format(i, '024x'),'market':'china','totalRub':1500000,'preparedChinaSelection':{'generationId':host.CHINA_CUT}}
                    for i in range(start,start+24)]
                if changes.get('duplicateChina') and 'page=2' in path: rows[0]['id']=format(0,'024x')
                data={'ok':True,'items':rows,'generationId':host.CHINA_CUT,'total':host.CHINA_FILTER_TOTAL if filtered else host.CHINA_TOTAL}
                return 200,None,host.json_bytes(data)
            market = path.split('market=')[1].split('&')[0] if 'market=' in path else 'korea'
            row = {'id': 'a' * 24, 'market': market, 'totalRub': 1500000, 'powerHp': None,
                   'operational': {'semanticEvidence': {'powerHp': {'confidence': 'unknown', 'provenance': [{'private': SECRET}]}}}}
            if where != 'retained':
                if path == '/api/catalog/home' or changes.get('searchBibliography'):
                    row = host.browser_card(row)
                row.update(changes.get('row', {}))
            payload = {'items': [row], 'total': 1, 'generationId': 'gen_1790000000000_fixture'}
            return 200, None, host.json_bytes(payload)
        receipt = host.check_card_price_auth_parity(lambda _: None, get=get)
        self.assertTrue(receipt['passed'])
        self.assertNotIn(SECRET, json.dumps(receipt))
        self.assertTrue(all('source=existing' in path or path == host.CHINA_GRID for _, path in calls if '/search?' in path))
        self.assertEqual(receipt['chinaSearch']['distinctPageIds'],48)
        for change in ({'duplicateChina': True},{'row': {'powerHp': 0}}, {'row': {'totalRub': None}}, {'auth': 200}, {'searchBibliography': True}):
            changes.clear()
            changes.update(change)
            with self.assertRaises(host.HostError):
                host.check_card_price_auth_parity(lambda _: None, get=get)

    def test_detail_redirect_and_browser_nonce_cannot_escape_scope_or_replay(self):
        with self.assertRaisesRegex(host.HostError, 'detail_redirect'):
            host.detail_identity(lambda *args: (308, 'https://foreign.invalid/private', b''), 'candidate',
                                 {'id': 'a' * 24, 'market': 'korea'})
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(host, 'owned_directory', side_effect=Path):
            (Path(temporary) / ('browser-verdict-' + NONCE + '.json')).write_text('{}')
            with self.assertRaisesRegex(host.HostError, 'browser_nonce_used'):
                host.wait_browser(ROOT, temporary, NONCE)


if __name__ == '__main__':
    unittest.main()
