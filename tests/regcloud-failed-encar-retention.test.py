import copy
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch, mock_open
from contextlib import redirect_stdout

spec = importlib.util.spec_from_file_location('retention', Path(__file__).resolve().parents[1] / 'scripts/regcloud-failed-encar-retention.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def image(number, revision=m.FAILED_RELEASE, tagged=False):
    return {'Id': 'sha256:' + f'{number:064x}', 'Created': '2026-11-01T00:00:00Z',
            'Config': {'Labels': {m.REVISION: revision}},
            'RepoTags': ['avtocena-regcloud:' + revision] if tagged else [], 'RepoDigests': [],
            'RootFS': {'Type': 'layers', 'Layers': ['sha256:' + 'b' * 64]}, 'Parent': ''}


def container(number, img, production=False):
    revision = m.EXPECTED_PRODUCTION if production else m.FAILED_RELEASE
    env = dict(m.ROUTING, AVTOCENA_RELEASE_SHA=revision,
               AVTOCENA_CALCULATION_VERSION=m.EXPECTED_CALCULATOR if production else 'a' * 64,
               PRIVATE_FIXTURE_SECRET='do_not_emit_private_value')
    return {'Id': f'{number + 100:064x}', 'Name': '/avtocena-production' if production else '/avtocena-release-9cb571fcce50-failed-' + str(number),
            'Image': img['Id'], 'Created': '2026-11-02T00:00:00Z',
            'Config': {'Image': 'avtocena-regcloud:' + revision,
                       'Labels': {'avtocena.role': 'production', m.REVISION: revision},
                       'Env': [key + '=' + value for key, value in env.items()]},
            'State': {'Status': 'running' if production else 'exited', 'Running': production,
                      'Paused': False, 'Restarting': False, 'Dead': False, 'Pid': 1234 if production else 0,
                      'StartedAt': '2026-11-02T00:00:00Z', 'FinishedAt': f'2026-11-02T{number:02d}:00:00Z',
                      'ExitCode': 0, 'OOMKilled': False}, 'RestartCount': 0,
            'HostConfig': {'Privileged': False, 'VolumesFrom': None,
                           'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3000'}]}},
            'Mounts': [{'Type': 'bind', 'RW': False, 'Source': '/opt/avtocena/metrics', 'Destination': '/run/avtocena-metrics'}]}


class Backend:
    def __init__(self, count=4, free=None, gain=0):
        prod = image(99, m.EXPECTED_PRODUCTION, True)
        self.images = {prod['Id']: prod}
        self.rows = [container(0, prod, True)]
        for number in range(1, count + 1):
            img = image(number)
            self.images[img['Id']] = img
            self.rows.append(container(number, img))
        self.free = m.TARGET_FREE_BYTES - 1000 if free is None else free
        self.gain = gain
        self.commands = []
        self.health_checks = 0

    def capture(self):
        result = m.make_plan(self.rows, self.images, self.free)
        result['allContainerFingerprints'] = {c['Id']: m.container_fingerprint(c) for c in self.rows}
        result['allImageIds'] = sorted(self.images)
        return result

    def free_bytes(self):
        return self.free

    def verify_production(self, expected):
        self.health_checks += 1
        if m.production_view(self.rows, self.images) != expected:
            raise m.GuardError('production_identity_changed')

    def inspect_container(self, identifier):
        return next(c for c in self.rows if c['Id'] == identifier)

    def inspect_image(self, identifier):
        return self.images[identifier]

    def container_references(self, identifier):
        return [c for c in self.rows if c['Image'] == identifier]

    def remove_container(self, identifier):
        self.commands.append(('rm', identifier))
        self.rows = [c for c in self.rows if c['Id'] != identifier]

    def remove_image(self, identifier):
        if self.container_references(identifier):
            raise m.GuardError('still_referenced')
        self.commands.append(('image', 'rm', '--no-prune', identifier))
        del self.images[identifier]
        self.free += self.gain


class FailedEncarRetentionTest(unittest.TestCase):
    def test_two_requested_orphans_are_inventory_only_and_other_b5_image_is_retained(self):
        b = Backend()
        for identifier in m.ORPHAN_REVIEW_IDS:
            img = image(8, m.ORPHAN_REVIEW_RELEASE)
            img['Id'] = identifier
            b.images[identifier] = img
        other = image(9, m.ORPHAN_REVIEW_RELEASE, True)
        b.images[other['Id']] = other
        kept = container(9, other); kept['Name'] = '/avtocena-before-current-b5'
        b.rows.append(kept)
        inventory = m.named_orphan_image_inventory(b.rows, b.images)
        self.assertTrue(inventory['readOnly'])
        self.assertEqual([r['imageId'] for r in inventory['requestedImages']], list(m.ORPHAN_REVIEW_IDS))
        self.assertTrue(all(r['referenceCount'] == 0 and r['expectedRevisionMatched'] for r in inventory['requestedImages']))
        self.assertEqual(inventory['otherImagesOfSameRevisionRetained'][0]['referenceCount'], 1)
        self.assertTrue(set(m.ORPHAN_REVIEW_IDS).issubset(b.capture()['plan']['retainedImageIds']))
        self.assertNotIn('do_not_emit_private_value', json.dumps(inventory))
        self.assertEqual(b.commands, [])

    def test_exact_groups_and_newest_preserved_without_private_values(self):
        b = Backend()
        result = b.capture()
        plan = result['plan']
        self.assertEqual([g['imageId'] for g in plan['groups']], [image(1)['Id'], image(2)['Id']])
        self.assertEqual(plan['keepNewest']['image'], image(4)['Id'])
        self.assertIn(image(3)['Id'], plan['retainedImageIds'])
        self.assertEqual(b.commands, [])
        self.assertNotIn('do_not_emit_private_value', json.dumps(result))
        self.assertNotIn('PRIVATE_FIXTURE_SECRET', json.dumps(result))

    def test_wrong_production_or_calculator_or_route_refuses(self):
        for key, value in [('AVTOCENA_RELEASE_SHA', 'f' * 40), ('AVTOCENA_CALCULATION_VERSION', 'f' * 64), ('JSON_STORAGE_DRIVER', 'local')]:
            b = Backend()
            b.rows[0]['Config']['Env'] = [key + '=' + value if row.startswith(key + '=') else row for row in b.rows[0]['Config']['Env']]
            with self.subTest(key=key), self.assertRaises(m.GuardError):
                b.capture()

    def test_target_requires_complete_metadata_and_exact_source(self):
        changes = [
            lambda c: c['State'].pop('Running'),
            lambda c: c['State'].update(Status='running', Running=True),
            lambda c: c['State'].update(Dead=True),
            lambda c: c['State'].update(Pid=55),
            lambda c: c['Config']['Labels'].update({m.REVISION: m.FAILED_RELEASE[:-1] + '0'}),
            lambda c: c['Config'].update(Image='avtocena-regcloud:other'),
            lambda c: c['Config']['Env'].append('AVTOCENA_RELEASE_SHA=' + m.FAILED_RELEASE),
            lambda c: c['Config']['Env'].append('JSON_STORAGE_DRIVER=local'),
            lambda c: c['Mounts'][0].update(RW=True),
            lambda c: c['Mounts'][0].update(Source='/customer-data'),
            lambda c: c['HostConfig'].update(Privileged=True),
        ]
        for mutate in changes:
            b = Backend(); mutate(b.rows[1])
            with self.subTest(mutate=mutate):
                self.assertNotIn(image(1)['Id'], [g['imageId'] for g in b.capture()['plan']['groups']])

    def test_same_image_as_newest_keeps_whole_group(self):
        b = Backend()
        b.rows[1]['Image'] = b.rows[-1]['Image']
        result = b.capture()
        self.assertNotIn(b.rows[-1]['Image'], [g['imageId'] for g in result['plan']['groups']])
        self.assertIn(b.rows[1]['Id'], result['plan']['retainedContainerFingerprints'])

    def test_any_other_container_reference_keeps_group(self):
        for name in ['/avtocena-staging', '/avtocena-before-a182cd21b21e', '/unknown-backdrop']:
            b = Backend(); other = copy.deepcopy(b.rows[1]); other['Id'] = 'e' * 64; other['Name'] = name
            b.rows.append(other)
            self.assertNotIn(image(1)['Id'], [g['imageId'] for g in b.capture()['plan']['groups']])

    def test_other_backdrops_and_unbound_orphan_images_are_retained(self):
        b = Backend()
        for number, revision in [(5, 'a182cd21b21ecf612b63613d263e5bdd817ea4c0'), (6, '17a' + '0' * 37), (7, 'f' * 40)]:
            img = image(number, revision, True); c = container(number, img)
            c['Name'] = '/avtocena-before-' + revision[:12]
            b.images[img['Id']] = img; b.rows.append(c)
        orphan = image(8); b.images[orphan['Id']] = orphan
        plan = b.capture()['plan']
        for number in [5, 6, 7, 8]:
            self.assertIn(image(number)['Id'], plan['retainedImageIds'])

    def test_wrong_image_revision_alias_or_pinned_image_is_not_eligible(self):
        for field, value in [('RepoTags', [m.FAILED_TAG, 'another:latest']), ('RepoDigests', ['private@sha256:' + 'a' * 64]), ('Config', {'Labels': {m.REVISION: m.EXPECTED_PRODUCTION}})]:
            b = Backend(); b.images[image(1)['Id']][field] = value
            self.assertNotIn(image(1)['Id'], [g['imageId'] for g in b.capture()['plan']['groups']])
        b = Backend(); img = b.images.pop(image(1)['Id']); img['Id'] = m.ACCEPTED_IMAGE
        b.images[img['Id']] = img; b.rows[1]['Image'] = img['Id']
        self.assertNotIn(m.ACCEPTED_IMAGE, [g['imageId'] for g in b.capture()['plan']['groups']])

    def test_unknown_newest_time_yields_no_removal_plan(self):
        b = Backend(); b.rows[-1]['State']['FinishedAt'] = 'invalid'
        result = b.capture()
        self.assertEqual(result['plan']['groups'], [])
        self.assertEqual(result['noOpReason'], 'newest_failure_unproven')

    def test_review_hash_and_metadata_drift_refuse_before_mutations(self):
        b = Backend(); reviewed = b.capture()
        with self.assertRaises(m.GuardError):
            m.execute_plan(reviewed, '0' * 64, b)
        b.rows[1]['Config']['Env'].append('OTHER_METADATA=changed')
        with self.assertRaises(m.GuardError):
            m.execute_plan(reviewed, reviewed['planSha256'], b)
        self.assertEqual(b.commands, [])

    def test_already_at_goal_does_not_remove_even_one_container(self):
        b = Backend(free=m.TARGET_FREE_BYTES); reviewed = b.capture()
        result = m.execute_plan(reviewed, reviewed['planSha256'], b)
        self.assertEqual(b.commands, [])
        self.assertTrue(result['targetReached'])

    def test_remeasure_after_first_image_and_stop_at_goal(self):
        b = Backend(gain=2000); reviewed = b.capture()
        result = m.execute_plan(reviewed, reviewed['planSha256'], b)
        self.assertEqual(result['removedImages'], [image(1)['Id']])
        self.assertIn(image(2)['Id'], b.images)
        self.assertEqual(result['freedBytes'], 2000)
        self.assertTrue(result['targetReached'])

    def test_two_group_limit_even_if_space_stays_below_goal(self):
        b = Backend(gain=1); reviewed = b.capture()
        result = m.execute_plan(reviewed, reviewed['planSha256'], b)
        self.assertEqual(result['removedImages'], [image(1)['Id'], image(2)['Id']])
        self.assertIn(image(3)['Id'], b.images); self.assertIn(image(4)['Id'], b.images)
        self.assertFalse(result['targetReached'])

    def test_reference_added_just_before_removal_refuses(self):
        b = Backend(); reviewed = b.capture(); original = b.container_references
        def changed(identifier):
            return original(identifier) + [{'Id': 'e' * 64, 'Image': identifier}]
        b.container_references = changed
        with self.assertRaises(m.GuardError):
            m.execute_plan(reviewed, reviewed['planSha256'], b)
        self.assertEqual(b.commands, [])

    def test_removal_error_never_proceeds_to_other_groups(self):
        b = Backend(); reviewed = b.capture()
        def refuse(_identifier):
            raise m.GuardError('docker_refused')
        b.remove_image = refuse
        with self.assertRaises(m.GuardError):
            m.execute_plan(reviewed, reviewed['planSha256'], b)
        self.assertEqual(len(b.commands), 1)
        self.assertEqual(b.commands[0][0], 'rm')

    def test_actual_commands_have_no_force_volume_or_implicit_parent_prune(self):
        backend = object.__new__(m.HostBackend)
        calls = []
        with patch.object(m, 'docker', side_effect=lambda *args: calls.append(args) or ''), redirect_stdout(io.StringIO()):
            backend.remove_container('a' * 64)
            backend.remove_image('sha256:' + 'b' * 64)
        self.assertEqual(calls, [('rm', 'a' * 64), ('image', 'rm', '--no-prune', 'sha256:' + 'b' * 64)])

    def test_read_only_main_holds_existing_lock_order_and_never_calls_apply(self):
        backend = Backend()
        with patch.object(m, 'HostBackend', return_value=backend), patch.object(m, 'execute_plan') as execute, \
             patch('builtins.open', mock_open()) as opened, patch.object(m.fcntl, 'flock') as flock, \
             patch('sys.argv', ['retention']), redirect_stdout(io.StringIO()):
            m.main()
        self.assertEqual([c.args[0] for c in opened.call_args_list], ['/run/lock/avtocena-staging-prepare.lock', '/run/lock/avtocena-runtime-change.lock'])
        self.assertEqual(flock.call_count, 2); execute.assert_not_called(); self.assertEqual(backend.commands, [])


if __name__ == '__main__':
    unittest.main()
