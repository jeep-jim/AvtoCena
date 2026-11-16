import contextlib
import copy
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load('reviewed_cleanup', 'scripts/regcloud-reviewed-vm-cleanup.py')
safe = load('retention_safeguards', 'scripts/regcloud-failed-encar-retention.py')
REAL_PLAN = json.loads((ROOT / 'docs/operations/2026-11-16-vm-cleanup-plan.json').read_text())
NOW = dt.datetime(2026, 11, 16, 10, tzinfo=dt.timezone.utc)


def fixture():
    plan = copy.deepcopy(REAL_PLAN)
    containers, images = {}, {}
    for row in plan['images']:
        images[row['id']] = {'Id': row['id'], 'Created': row['created'], 'RepoTags': row['repoTags'],
                            'RepoDigests': row['repoDigests'], 'Parent': None,
                            'Config': {'Labels': {safe.REVISION: row['revision']}}, 'RootFS': {'Layers': []}}
    for number, revision in enumerate(sorted(m.PROTECTED), 1):
        identifier = safe.ACCEPTED_IMAGE if revision.startswith('a182') else 'sha256:' + format(number, '064x')
        image = {'Id': identifier, 'Created': '2026-10-01T00:00:00Z', 'RepoTags': ['avtocena-regcloud:' + revision],
                 'RepoDigests': [], 'Config': {'Labels': {safe.REVISION: revision}}, 'RootFS': {'Layers': []}}
        images[identifier] = image
        plan['allImageFingerprints'][identifier] = safe.image_fingerprint(image)
        row = {'id': format(number + 500, '064x'), 'name': '/kept-' + revision[:12], 'revision': revision,
               'role': 'production', 'imageId': identifier, 'writableBytes': 2048,
               'created': '2026-10-02T00:00:00Z', 'finishedAt': '2026-10-03T00:00:00Z'}
        if revision == safe.EXPECTED_PRODUCTION:
            row['name'] = '/avtocena-production'
        containers[row['id']] = container(row)
    for row in plan['containers']:
        containers[row['id']] = container(row)
        row['fingerprint'] = safe.container_fingerprint(containers[row['id']])
    for row in plan['images']:
        row['fingerprint'] = safe.image_fingerprint(images[row['id']])
        row['referenceIds'] = sorted(c['Id'] for c in containers.values() if c['Image'] == row['id'])
    plan['allContainerFingerprints'] = {key: safe.container_fingerprint(value) for key, value in containers.items()}
    plan['allImageFingerprints'] = {key: safe.image_fingerprint(value) for key, value in images.items()}
    plan['production'] = safe.production_view(list(containers.values()), images)
    return plan, containers, images


def container(row):
    production = row['name'] == '/avtocena-production'
    return {'Id': row['id'], 'Name': row['name'], 'Image': row['imageId'], 'Created': row['created'],
            'Config': {'Image': 'avtocena-regcloud:' + row['revision'],
                       'Labels': {safe.REVISION: row['revision'], 'avtocena.role': row['role']},
                       'Env': [key + '=' + value for key, value in safe.ROUTING.items()]
                              + ['AVTOCENA_RELEASE_SHA=' + row['revision'],
                                 'AVTOCENA_CALCULATION_VERSION=' + safe.EXPECTED_CALCULATOR,
                                 'AUTH_SECRET=fixture-must-not-be-logged']},
            'HostConfig': {'Privileged': False, 'VolumesFrom': None,
                           'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3001'}]}},
            'Mounts': [{'Type': 'bind', 'Source': '/opt/avtocena/metrics',
                        'Destination': '/run/avtocena-metrics', 'RW': False}],
            'State': {'Status': 'running' if production else 'exited', 'Running': production,
                      'Paused': False, 'Restarting': False, 'Dead': False, 'Pid': 7 if production else 0,
                      'StartedAt': row['created'], 'FinishedAt': row['finishedAt'], 'ExitCode': 0, 'OOMKilled': False},
            'SizeRw': row['writableBytes']}


class Backend:
    def __init__(self, containers, images):
        self.containers, self.images = copy.deepcopy(containers), copy.deepcopy(images)
        self.removed_containers, self.removed_images = [], []
        self.capture_count, self.health_count = 0, 0
        self.on_capture = lambda: None
        self.on_container = lambda value: value

    def capture(self):
        self.capture_count += 1
        self.on_capture()
        return list(copy.deepcopy(self.containers).values()), list(copy.deepcopy(self.images).values())

    def container(self, identifier, with_size=False):
        return self.on_container(copy.deepcopy(self.containers[identifier]))

    def verify_production(self, expected):
        self.health_count += 1
        m.require(safe.production_view(list(self.containers.values()), self.images) == expected, 'production_changed')

    def free_bytes(self):
        return 8_000_000_000 + len(self.removed_images) * 100_000_000 + len(self.removed_containers) * 1000

    def remove_container(self, identifier):
        assert not self.containers[identifier]['State']['Running']
        self.removed_containers.append(identifier)
        del self.containers[identifier]

    def remove_image(self, identifier):
        assert not any(row['Image'] == identifier for row in self.containers.values())
        self.removed_images.append(identifier)
        del self.images[identifier]


class ReviewedCleanupTest(unittest.TestCase):
    def setUp(self):
        self.plan, self.containers, self.images = fixture()
        self.backend = Backend(self.containers, self.images)
        self.hash_patch = patch.object(m, 'PLAN_SHA256', m.digest(self.plan))
        self.hash_patch.start()
        self.addCleanup(self.hash_patch.stop)
        self.output = io.StringIO()

    def run_cleanup(self, apply=True, expected=None, now=NOW):
        with contextlib.redirect_stdout(self.output):
            return m.execute(self.plan, self.backend, safe, apply,
                             m.PLAN_SHA256 if expected is None else expected, now=now)

    def refused_without_changes(self):
        with self.assertRaises((m.Refused, safe.GuardError)):
            self.run_cleanup()
        self.assertEqual(self.backend.removed_images, [])
        self.assertEqual(self.backend.removed_containers, [])

    def test_real_review_scope_and_pin_identities(self):
        self.assertEqual(m.digest(REAL_PLAN), 'dabf125648bc7b56562886bef911a56dd9a90a47d8462a21480975b67b67b00f')
        self.assertEqual(len(REAL_PLAN['images']), 20)
        self.assertEqual(len(REAL_PLAN['containers']), 9)
        legacy = next(row for row in REAL_PLAN['containers'] if 'rollback-preserved-463' in row['name'])
        self.assertTrue(legacy['revision'].startswith('a5f9a645'))
        self.assertTrue(legacy['imageId'].startswith('sha256:7193fc9569a5'))
        self.assertFalse(any(row['revision'] in m.PROTECTED for row in REAL_PLAN['containers'] + REAL_PLAN['images']))

    def test_dry_run_does_not_remove_anything(self):
        result = self.run_cleanup(apply=False, expected='')
        self.assertEqual(result['removedContainers'], [])
        self.assertEqual(result['removedImages'], [])
        self.assertEqual(self.backend.health_count, 2)

    def test_apply_removes_exact_scope_preserving_every_other_identity(self):
        result = self.run_cleanup()
        self.assertEqual(set(result['removedContainers']), {row['id'] for row in self.plan['containers']})
        self.assertEqual(set(result['removedImages']), {row['id'] for row in self.plan['images']})
        self.assertEqual({row['Config']['Labels'][safe.REVISION] for row in self.backend.images.values()}, m.PROTECTED)
        self.assertNotIn('fixture-must-not-be-logged', self.output.getvalue())
        self.assertTrue(result['retainedContainersUnchanged'] and result['retainedImagesUnchanged'])

    def test_wrong_apply_hash_and_expired_review_refuse_before_mutation(self):
        for arguments in [{'expected': ''}, {'expected': 'f' * 64}, {'now': NOW + dt.timedelta(days=1)}]:
            with self.subTest(arguments=arguments), self.assertRaises(m.Refused):
                self.run_cleanup(**arguments)
        self.assertEqual(self.backend.removed_images, [])

    def test_changed_source_plan_refuses(self):
        self.plan['images'][0]['revision'] = 'f' * 40
        self.refused_without_changes()

    def test_every_target_is_validated_before_the_first_removal(self):
        last = self.plan['containers'][-1]['id']
        self.backend.on_container = lambda row: dict(row, SizeRw=row['SizeRw'] + 1) if row['Id'] == last else row
        self.refused_without_changes()

    def test_new_image_or_container_between_inventory_and_apply_refuses(self):
        extra = copy.deepcopy(next(iter(self.images.values())))
        extra['Id'] = 'sha256:' + 'f' * 64
        self.backend.images[extra['Id']] = extra
        self.refused_without_changes()

    def test_concurrent_change_before_first_deletion_refuses(self):
        def change():
            if self.backend.capture_count == 2:
                production = self.backend.containers[self.plan['production']['id']]
                production['Config']['Env'].append('CHANGED=true')
        self.backend.on_capture = change
        self.refused_without_changes()

    def test_running_mount_env_alias_and_source_changes_are_not_accepted(self):
        target = self.plan['containers'][0]['id']
        mutations = [lambda row: row['State'].update(Running=True, Status='running', Pid=10),
                     lambda row: row['Mounts'].append({'Type': 'volume', 'RW': True}),
                     lambda row: row['HostConfig'].update(Privileged=True),
                     lambda row: row['Config']['Env'].append('JSON_STORAGE_DRIVER=filesystem'),
                     lambda row: row['Config']['Labels'].update({safe.REVISION: safe.EXPECTED_PRODUCTION})]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                self.backend = Backend(self.containers, self.images)
                mutate(self.backend.containers[target])
                self.refused_without_changes()

    def test_protected_revision_and_mount_checks_are_independent_of_fingerprint(self):
        original = self.plan['containers'][0]
        row = copy.deepcopy(self.containers[original['id']])
        for field in ['mount', 'revision', 'state', 'storage', 'age']:
            current = copy.deepcopy(row)
            expected = copy.deepcopy(original)
            if field == 'mount': current['Mounts'][0]['RW'] = True
            if field == 'revision':
                current['Config']['Labels'][safe.REVISION] = safe.EXPECTED_PRODUCTION
                expected['revision'] = safe.EXPECTED_PRODUCTION
            if field == 'state': current['State']['Running'] = True
            if field == 'storage': current['Config']['Env'] = ['JSON_STORAGE_DRIVER=filesystem']
            if field == 'age': current['State']['FinishedAt'] = NOW.isoformat()
            expected['fingerprint'] = safe.container_fingerprint(current)
            with self.subTest(field=field), self.assertRaises((m.Refused, safe.GuardError)):
                m.validate_container(expected, current, safe, NOW)

    def test_image_pin_alias_ref_and_grace_checks(self):
        expected = self.plan['images'][0]
        original = self.images[expected['id']]
        for kind in ['revision', 'accepted_id', 'tag', 'digest', 'age']:
            image, row = copy.deepcopy(original), copy.deepcopy(expected)
            if kind == 'revision':
                image['Config']['Labels'][safe.REVISION] = safe.EXPECTED_PRODUCTION
                row['revision'] = safe.EXPECTED_PRODUCTION
            if kind == 'accepted_id': image['Id'] = row['id'] = safe.ACCEPTED_IMAGE
            if kind == 'tag': image['RepoTags'] = ['other:latest']
            if kind == 'digest': image['RepoDigests'] = ['other@' + image['Id']]
            if kind == 'age': image['Created'] = NOW.isoformat()
            row['fingerprint'] = safe.image_fingerprint(image)
            with self.subTest(kind=kind), self.assertRaises(m.Refused):
                m.validate_image(row, image, safe, NOW)

    def test_backend_removal_commands_are_nonforced_and_do_not_prune_parents(self):
        backend = object.__new__(m.Backend)
        backend.safe = safe
        with patch.object(safe, 'docker', return_value='') as command, contextlib.redirect_stdout(self.output):
            backend.remove_container('a' * 64)
            self.assertEqual(command.call_args.args, ('rm', 'a' * 64))
            backend.remove_image('sha256:' + 'b' * 64)
            self.assertEqual(command.call_args.args, ('image', 'rm', '--no-prune', 'sha256:' + 'b' * 64))


if __name__ == '__main__':
    unittest.main()
