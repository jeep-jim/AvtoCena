import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
import copy
import contextlib
import io
import os
import tempfile
import urllib.request
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('retention', Path(__file__).resolve().parents[1] / 'scripts/regcloud-release-retention.py')
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class ImageRetentionTest(unittest.TestCase):
    def test_accepted_image_is_retained_even_when_old_unreferenced_or_retagged(self):
        now = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)
        base = {'Id': 'sha256:' + 'f' * 64, 'RepoTags': ['avtocena-regcloud:' + 'f' * 40],
                'Created': '2026-10-01T00:00:00Z', 'Config': {'Labels': {'org.opencontainers.image.revision': 'f' * 40}}}
        self.assertTrue(retention.eligible_unused_image(base, set(), now))
        for changed in ({'Id': retention.ACCEPTED_IMAGE},
                        {'RepoTags': ['avtocena-regcloud:' + retention.ACCEPTED_RELEASE]},
                        {'Config': {'Labels': {'org.opencontainers.image.revision': retention.ACCEPTED_RELEASE}}}):
            pinned = dict(base, **changed)
            self.assertTrue(retention.pinned_image(pinned))
            self.assertFalse(retention.eligible_unused_image(pinned, set(), now))

    def test_accepted_container_survives_backup_and_abandoned_cleanup(self):
        now = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)
        c = failed(1, 1, 1)
        c['Name'] = '/avtocena-before-' + 'f' * 12
        self.assertTrue(retention.eligible(c, now))
        for changed in ({'Image': retention.ACCEPTED_IMAGE},
                        {'Config': {'Labels': {'avtocena.role': 'production', 'org.opencontainers.image.revision': retention.ACCEPTED_RELEASE}}}):
            pinned = dict(c, **changed)
            self.assertFalse(retention.eligible(pinned))
            self.assertFalse(retention.failed_candidate(dict(pinned, Name='/avtocena-release-'+'f'*12), now))


    def test_failed_candidate_guards(self):
        now = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
        c = failed(1, 1, 1)
        c['Name'] = '/avtocena-release-' + c['Config']['Labels']['org.opencontainers.image.revision'][:12]
        c['Created'] = '2026-10-17T00:00:00Z'
        c['State']['FinishedAt'] = '2026-10-18T00:00:00Z'
        c['Mounts'] = [{'Type': 'bind', 'RW': False, 'Source': '/opt/avtocena/metrics',
                        'Destination': '/run/avtocena-metrics'}]
        self.assertTrue(retention.failed_candidate(c, now))
        self.assertTrue(retention.failed_candidate(dict(c, Name=c['Name'] + '-failed-123'), now))
        for changed in ({'Name': '/avtocena-production'}, {'Name': '/avtocena-staging'},
                        {'Name': '/avtocena-before-' + 'b' * 12},
                        {'Config': {'Labels': {}}},
                        {'State': {'Status': 'running', 'FinishedAt': '2026-10-18T00:00:00Z'}},
                        {'State': {'Status': 'exited', 'FinishedAt': now.isoformat()}},
                        {'State': {'Status': 'exited', 'FinishedAt': 'invalid'}},
                        {'Mounts': [{'Type': 'volume', 'RW': True}]},
                        {'Mounts': [dict(c['Mounts'][0], RW=True)]}):
            with self.subTest(changed=changed):
                self.assertFalse(retention.failed_candidate(dict(c, **changed), now))

    def test_only_old_unreferenced_application_images(self):
        now = dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc)
        tag = 'avtocena-regcloud:' + 'a' * 40
        image = {'Id': 'sha256:' + 'a' * 64, 'RepoTags': [tag], 'Created': '2026-10-16T00:00:00Z',
                 'Config': {'Labels': {'org.opencontainers.image.revision': 'a' * 40}}}
        self.assertTrue(retention.eligible_unused_image(image, set(), now))
        self.assertFalse(retention.eligible_unused_image(image, {image['Id']}, now))
        self.assertFalse(retention.eligible_unused_image(dict(image, RepoTags=[]), set(), now))
        for changed in ({'Config': {'Labels': {}}}, {'RepoTags': [tag, 'other:latest']},
                        {'RepoTags': ['avtocena-regcloud:latest']},
                        {'RepoDigests': ['other@' + image['Id']]},
                        {'Created': now.isoformat()}, {'Created': 'invalid'},
                        {'Created': '2026-10-01T00:00:00'}):
            with self.subTest(changed=changed):
                self.assertFalse(retention.eligible_unused_image(dict(image, **changed), set(), now))

    def test_foreign_oci_image_requires_application_provenance(self):
        image = {'Id': 'sha256:' + 'a' * 64, 'RepoTags': [], 'RepoDigests': [],
                 'Config': {'Labels': {'org.opencontainers.image.revision': 'a' * 40}}}
        self.assertFalse(retention.owned_application_image(image))
        self.assertFalse(retention.owned_application_image(image, {image['Id']: 'b' * 40}))
        self.assertTrue(retention.owned_application_image(image, {image['Id']: 'a' * 40}))
        image['Config']['Labels'].update({'org.opencontainers.image.source': retention.APP_SOURCE,
                                         'avtocena.application': 'web'})
        self.assertTrue(retention.owned_application_image(image))
        image['Config']['Labels']['org.opencontainers.image.source'] = 'https://github.com/foreign/project'
        self.assertFalse(retention.owned_application_image(image))

    def test_filesystem_or_unproven_rollback_is_never_removed(self):
        now = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)
        row = failed(1, 1, 1)
        # A rollback name identifies its successor, not its own source revision.
        row['Name'] = '/avtocena-before-' + 'f' * 12
        self.assertTrue(retention.eligible(row, now))
        for kind in ['filesystem', 'pid', 'running', 'missing_state', 'rw_mount', 'missing_prefix']:
            candidate = copy.deepcopy(row)
            if kind == 'filesystem': candidate['Config']['Env'] = ['JSON_STORAGE_DRIVER=filesystem']
            if kind == 'pid': candidate['State']['Pid'] = 99
            if kind == 'running': candidate['State']['Running'] = True
            if kind == 'missing_state': del candidate['State']['Dead']
            if kind == 'rw_mount': candidate['Mounts'] = [{'Type': 'bind', 'RW': True, 'Source': '/private'}]
            if kind == 'missing_prefix': candidate['Config']['Env'] = [x for x in candidate['Config']['Env'] if not x.startswith('YC_OBJECT_STORAGE_PREFIX=')]
            with self.subTest(kind=kind):
                self.assertFalse(retention.eligible(candidate, now))

    def test_e4_hold_survives_orphan_and_container_retention(self):
        release = next(iter(retention.HELD_RELEASES))
        image = {'Id': next(iter(retention.HELD_IMAGES)), 'RepoTags': [], 'Created': '2026-10-01T00:00:00Z',
                 'Config': {'Labels': {'org.opencontainers.image.revision': release}}}
        self.assertFalse(retention.eligible_unused_image(image, set(), dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)))
        for change in [{'Id': 'sha256:' + 'b' * 64}, {'Config': {'Labels': {}}}, {'RepoTags': ['other:tag']}]:
            self.assertTrue(retention.pinned_image(dict(image, **change)))
        container = failed(1, 1, 1)
        container['Config']['Labels']['org.opencontainers.image.revision'] = release
        self.assertFalse(retention.eligible(dict(container, Name='/avtocena-before-' + 'b' * 12)))

    def test_two_latest_failed_groups_keep_one_evidence_copy_each(self):
        # 12 distinct failures in one day cannot retain all images for 24 hours.
        now = dt.datetime(2026, 11, 16, 23, tzinfo=dt.timezone.utc)
        rows = [failed(i, i, i) for i in range(1, 13)]
        rows.append(failed(13, 12, 14))
        keep, remove = retention.failed_retention(rows, now)
        self.assertEqual(keep, {rows[-1]['Id'], rows[-3]['Id']})
        self.assertEqual(len(remove), 11)
        self.assertTrue(all(row['Id'] not in keep for row in remove))

    def test_failed_selection_excludes_running_unknown_and_data_mounts(self):
        now = dt.datetime(2026, 11, 16, 23, tzinfo=dt.timezone.utc)
        ordinary = failed(1, 1, 1)
        self.assertTrue(retention.failed_candidate(ordinary, now))
        for kind in ['running', 'mount', 'volumes_from', 'privileged', 'local_data', 'missing_bucket', 'missing_prefix', 'alias', 'legacy', 'wrong_name', 'held']:
            row = copy.deepcopy(ordinary)
            if kind == 'running': row['State'].update(Status='running', Running=True, Pid=100)
            if kind == 'mount': row['Mounts'] = [{'Type': 'volume', 'RW': True}]
            if kind == 'volumes_from': row['HostConfig']['VolumesFrom'] = ['private-data']
            if kind == 'privileged': row['HostConfig']['Privileged'] = True
            if kind == 'local_data': row['Config']['Env'] = ['JSON_STORAGE_DRIVER=filesystem']
            if kind == 'missing_bucket': row['Config']['Env'] = [x for x in row['Config']['Env'] if not x.startswith('YC_OBJECT_STORAGE_BUCKET=')]
            if kind == 'missing_prefix': row['Config']['Env'] = [x for x in row['Config']['Env'] if not x.startswith('YC_OBJECT_STORAGE_PREFIX=')]
            if kind == 'alias': row['Config']['Image'] = 'unrelated:latest'
            if kind == 'legacy': row['Name'] = '/avtocena-staging'
            if kind == 'wrong_name': row['Name'] = '/avtocena-release-' + 'f' * 12
            if kind == 'held': row['Image'] = next(iter(retention.HELD_IMAGES))
            with self.subTest(kind=kind):
                self.assertFalse(retention.failed_candidate(row, now))

    def test_actual_main_removes_only_bounded_failed_and_proven_orphan_images(self):
        backend = FakeDocker(8)
        backend.images['sha256:' + format(1, '064x')]['RepoTags'] = []
        before_kept = backend.preserved()
        self.assertEqual(run_main(backend, apply=True), 2)
        self.assertEqual(backend.preserved(), before_kept)
        self.assertEqual(len(backend.removed_containers), 6)
        self.assertEqual(len(backend.removed_images), 7)  # Six old failed groups plus one old orphan.
        self.assertNotIn(backend.young_image, backend.removed_images)
        self.assertNotIn(backend.unknown_image, backend.removed_images)
        self.assertNotIn(backend.foreign_image, backend.removed_images)
        self.assertTrue(all(call[:3] == ('image', 'rm', '--no-prune') for call in backend.calls if call[:2] == ('image', 'rm')))

    def test_actual_main_caps_large_failed_backlog(self):
        backend = FakeDocker(50)
        before_kept = backend.preserved()
        run_main(backend, apply=True)
        self.assertEqual(len(backend.removed_containers), retention.MAX_CONTAINER_REMOVALS)
        self.assertEqual(len(backend.removed_images), retention.MAX_IMAGE_REMOVALS)
        self.assertEqual(backend.preserved(), before_kept)

    def test_actual_main_dry_run_has_no_docker_mutations(self):
        backend = FakeDocker(8)
        run_main(backend, apply=False)
        self.assertEqual(backend.removed_containers, [])
        self.assertEqual(backend.removed_images, [])

    def test_actual_main_refuses_image_that_became_referenced(self):
        backend = FakeDocker(8)
        backend.add_reference_on_image_check = True
        with self.assertRaisesRegex(RuntimeError, 'became referenced'):
            run_main(backend, apply=True)
        self.assertEqual(backend.removed_images, [])
        self.assertTrue(backend.containers['current']['State']['Running'])

    def test_bad_production_health_stops_before_any_cleanup(self):
        backend = FakeDocker(8)
        with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
            run_main(backend, apply=True, health_failure=RuntimeError('unhealthy'))
        self.assertEqual(backend.removed_containers, [])
        self.assertEqual(backend.removed_images, [])

    def test_health_checks_dynamic_production_identity_only_on_loopback(self):
        expected = {'release': 'f' * 40, 'calculator': 'e' * 64, 'port': 3001}
        response = SimpleNamespace(status=200, read=lambda _limit: json.dumps({'ok': True, 'releaseSha': expected['release'], 'calculationVersion': expected['calculator']}).encode())
        with patch.object(retention.http.client, 'HTTPConnection') as constructor:
            connection = constructor.return_value
            connection.getresponse.return_value = response
            retention.verify_health(expected)
            constructor.assert_called_once_with('127.0.0.1', 3001, timeout=10)
            self.assertEqual(connection.request.call_args.args, ('GET', '/api/health'))
            with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                retention.verify_health(dict(expected, release='d' * 40))


def failed(identifier, group, hour):
    release = format(group + 100, '040x')
    return {'Id': format(identifier, '064x'), 'Name': '/avtocena-release-' + release[:12] + '-failed-' + str(identifier),
            'Image': 'sha256:' + format(group, '064x'), 'Created': '2026-11-16T00:00:00Z',
            'Config': {'Labels': {'avtocena.role': 'production', 'org.opencontainers.image.revision': release},
                       'Image': 'avtocena-regcloud:' + release,
                       'Env': ['JSON_STORAGE_DRIVER=object', 'YC_OBJECT_STORAGE_ENDPOINT=https://s3.regru.cloud',
                               'YC_OBJECT_STORAGE_BUCKET=fixture-bucket', 'YC_OBJECT_STORAGE_PREFIX=fixture-prefix']},
            'HostConfig': {'Privileged': False, 'VolumesFrom': None}, 'Mounts': [],
            'State': {'Status': 'exited', 'Running': False, 'Pid': 0, 'Paused': False, 'Restarting': False, 'Dead': False,
                      'FinishedAt': '2026-11-16T' + str(hour).zfill(2) + ':00:00Z'}}


class FakeDocker:
    def __init__(self, failures):
        self.containers, self.images, self.calls = {}, {}, []
        self.removed_containers, self.removed_images = [], []
        self.add_reference_on_image_check = False
        for i in range(1, failures + 1):
            row = failed(i, i, 1)
            row['State']['FinishedAt'] = '2026-11-16T01:' + str(i).zfill(2) + ':00Z'
            self.containers[row['Id']] = row
        for number, label in [(900, 'current'), (901, 'rollback1'), (902, 'rollback2'), (903, 'accepted'), (904, 'held')]:
            row = failed(number, number, 1)
            row['Id'] = label
            if label == 'current':
                row['Name'] = '/avtocena-production'
                row['State'].update(Status='running', Running=True, Pid=123)
                row['HostConfig']['PortBindings'] = {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3000'}]}
                row['Config']['Env'] += ['AVTOCENA_RELEASE_SHA=' + row['Config']['Labels']['org.opencontainers.image.revision'],
                                         'AVTOCENA_CALCULATION_VERSION=' + 'e' * 64]
            else:
                row['Name'] = '/avtocena-before-' + format(number, '012x')
            if label == 'accepted':
                row['Image'] = retention.ACCEPTED_IMAGE
                row['Config']['Labels']['org.opencontainers.image.revision'] = retention.ACCEPTED_RELEASE
                row['Config']['Image'] = 'avtocena-regcloud:' + retention.ACCEPTED_RELEASE
            if label == 'held':
                row['Image'] = next(iter(retention.HELD_IMAGES))
                row['Config']['Labels']['org.opencontainers.image.revision'] = next(iter(retention.HELD_RELEASES))
                row['Config']['Image'] = 'avtocena-regcloud:' + next(iter(retention.HELD_RELEASES))
            self.containers[label] = row
        for row in self.containers.values():
            self.images[row['Image']] = {'Id': row['Image'], 'Created': '2026-11-16T00:00:00Z',
                                        'RepoTags': [row['Config']['Image']], 'RepoDigests': [],
                                        'Config': {'Labels': copy.deepcopy(row['Config']['Labels'])}}
        self.old_image, self.young_image, self.unknown_image, self.foreign_image = ['sha256:' + format(i, '064x') for i in [1001, 1002, 1003, 1004]]
        template = {'Id': self.old_image, 'Created': '2026-11-10T00:00:00Z', 'RepoTags': [], 'RepoDigests': [],
                    'Config': {'Labels': {'org.opencontainers.image.revision': 'f' * 40,
                                          'org.opencontainers.image.source': retention.APP_SOURCE, 'avtocena.application': 'web'}}}
        self.images[self.old_image] = template
        self.images[self.young_image] = dict(copy.deepcopy(template), Id=self.young_image, Created='2026-11-16T15:00:00Z')
        self.images[self.unknown_image] = dict(copy.deepcopy(template), Id=self.unknown_image, Config={'Labels': {}})
        self.images[self.foreign_image] = dict(copy.deepcopy(template), Id=self.foreign_image, Config={'Labels': {'org.opencontainers.image.revision': 'f' * 40}})

    def preserved(self):
        return {key: retention.fingerprint(value) for key, value in self.containers.items()
                if key in ['current', 'rollback1', 'rollback2', 'accepted', 'held']}

    def docker(self, *args):
        self.calls.append(args)
        if args[0] == 'ps': return '\n'.join(self.containers)
        if args[0] == 'inspect':
            return json.dumps([self.containers['current' if key == 'avtocena-production' else key] for key in args[1:]])
        if args[:2] == ('image', 'ls'):
            assert '-aq' in args
            return '\n'.join(self.images)
        if args[:2] == ('image', 'inspect'):
            if self.add_reference_on_image_check and self.removed_containers:
                row = copy.deepcopy(self.containers['held'])
                row['Id'] = 'unexpected-reference'
                row['Image'] = args[2]
                self.containers[row['Id']] = row
                self.add_reference_on_image_check = False
            return json.dumps([self.images[key] for key in args[2:]])
        if args[0] == 'rm':
            assert len(args) == 2 and not self.containers[args[1]]['State']['Running']
            self.removed_containers.append(args[1])
            del self.containers[args[1]]
            return ''
        if args[:2] == ('image', 'rm'):
            assert len(args) == 4 and args[2] == '--no-prune'
            assert not any(row['Image'] == args[3] for row in self.containers.values())
            self.removed_images.append(args[3])
            del self.images[args[3]]
            return ''
        raise AssertionError('Unexpected command ' + repr(args))


def run_main(backend, apply, health_failure=None):
    class Clock(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return dt.datetime(2026, 11, 16, 23, tzinfo=dt.timezone.utc)
    clock = SimpleNamespace(datetime=Clock, timedelta=dt.timedelta, timezone=dt.timezone)
    with patch.object(retention, 'docker', side_effect=backend.docker), patch.object(retention, 'dt', clock), \
         patch.object(retention, 'verify_health', side_effect=health_failure) as health, patch.object(retention, 'nginx_digest', return_value='fixture'), \
         patch.object(retention.fcntl, 'flock'), patch('builtins.open', side_effect=lambda *_args, **_kw: io.StringIO()), \
         patch.object(retention.shutil, 'disk_usage', return_value=SimpleNamespace(total=1000, used=900, free=100)), \
         patch('sys.argv', ['retention'] + (['--apply'] if apply else [])), contextlib.redirect_stdout(io.StringIO()):
        retention.main()
        return health.call_count


class WorkflowReleaseGuardTest(unittest.TestCase):
    def run_gate(self, runs):
        workflow = Path(__file__).resolve().parents[1] / '.github/workflows/regcloud-release-retention.yml'
        body = workflow.read_text().split("python3 - <<'PY'\n", 1)[1].split('\n          PY', 1)[0]
        source = '\n'.join(line[10:] for line in body.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            env = {'GITHUB_REPOSITORY': 'jeep-jim/AvtoCena', 'GITHUB_TOKEN': 'offline-fixture', 'GITHUB_OUTPUT': str(output)}
            response = io.StringIO(json.dumps({'workflow_runs': runs}))
            with patch.dict(os.environ, env), patch.object(urllib.request, 'urlopen', return_value=response), contextlib.redirect_stdout(io.StringIO()):
                exec(compile(source, str(workflow), 'exec'), {})
            return output.read_text()

    def test_terminal_release_allows_retention_without_active_vm_work(self):
        self.assertEqual(self.run_gate([{'id': 5, 'path': '.github/workflows/catalog-market-korea.yml'}]), 'ready=true\n')

    def test_release_or_owned_diagnostic_defers_without_ssh(self):
        for path in ['.github/workflows/release-paid-korea-history.yml',
                     '.github/workflows/diagnose-paid-korea-home-phases.yml',
                     '.github/workflows/regcloud-reviewed-vm-cleanup.yml']:
            with self.subTest(path=path):
                self.assertEqual(self.run_gate([{'id': 7, 'path': path}]), 'ready=false\n')


if __name__ == '__main__':
    unittest.main()
