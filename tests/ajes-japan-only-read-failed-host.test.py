"""Offline scope and privacy checks; never opens Docker or SSH."""
import datetime
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('failed_host_reader', ROOT / '.github/operations/ajes-japan-only-20261124/read-failed-host.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)
IMAGE = 'sha256:' + 'a' * 64
CONTAINER = 'b' * 64
SECRET = 'PRIVATE_SENTINEL_NOT_FOR_OUTPUT'


def fixture():
    revision = {'org.opencontainers.image.revision': reader.RELEASE}
    nonce = {'avtocena.aj.nonce': reader.NONCE}
    epoch = int(datetime.datetime.fromisoformat(reader.SINCE.replace('Z', '+00:00')).timestamp())
    return {
        '/version': (200, {'Version': '29.0.1', 'ApiVersion': '1.52', 'MinAPIVersion': '1.44', 'Secret': SECRET}),
        '/info': (200, {'Driver': 'overlay2', 'ServerVersion': '29.0.1', 'DriverStatus': [['driver-type', 'io.containerd.snapshotter.v1']], 'Name': SECRET}),
        reader.EXACT_IMAGE: (404, {'message': SECRET}),
        reader.IMAGE_LIST: (200, [{'Id': IMAGE, 'Labels': revision}]),
        '/images/' + IMAGE + '/json': (200, {'Id': IMAGE, 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Env': [SECRET], 'Labels': {**revision, 'private': SECRET}}, 'Size': 123}),
        reader.CONTAINER_LIST: (200, [{'Id': CONTAINER, 'Labels': nonce}]),
        '/containers/' + CONTAINER + '/json': (200, {'Id': CONTAINER, 'Name': '/aj-japan-probe-' + reader.RELEASE[:12] + '-' + reader.NONCE, 'Image': IMAGE,
            'Config': {'Env': [SECRET], 'Labels': {**nonce, **revision, 'private': SECRET}}, 'State': {'Status': 'exited', 'Error': SECRET, 'ExitCode': 1}, 'RestartCount': 0}),
        reader.EVENTS: (200, [{'Type': 'container', 'Actor': {'ID': CONTAINER, 'Attributes': {**nonce, 'private': SECRET, 'exitCode': '1'}}, 'time': epoch, 'Action': 'exec_create: ' + SECRET}]),
    }


class Fake:
    def __init__(self, values=None):
        self.values, self.calls = values or fixture(), []

    def __call__(self, method, endpoint, timeout, maximum):
        self.calls.append((method, endpoint, timeout, maximum))
        status, value = self.values[endpoint]
        raw = '\n'.join(json.dumps(row) for row in value) if endpoint == reader.EVENTS else json.dumps(value)
        return status, raw.encode()


class FailedHostReaderTests(unittest.TestCase):
    def test_missing_manifest_id_observes_filtered_alternate_without_leaking(self):
        fake = Fake()
        result = reader.observe(reader.Reader(fetch=fake))
        self.assertTrue(result['complete'])
        self.assertEqual(result['expectedImage']['httpStatus'], 404)
        alternate = result['releaseImages']['inspections'][0]
        self.assertEqual(alternate['actualId'], IMAGE)
        self.assertEqual(alternate['platform']['Architecture'], 'amd64')
        self.assertRegex(alternate['configObservationFingerprint'], r'^[a-f0-9]{64}$')
        container = result['nonceContainers']['inspections'][0]
        self.assertEqual(container['kind'], 'probe')
        self.assertTrue(container['state']['hasError'])
        self.assertEqual(result['nonceEvents']['rows'][0]['action'], 'other')
        serialized = json.dumps(result)
        for forbidden in [SECRET, '"Env"', '"Config"', '"message"', '"private"']:
            self.assertNotIn(forbidden, serialized)
        allowed = {'/version', '/info', reader.EXACT_IMAGE, reader.IMAGE_LIST, reader.CONTAINER_LIST, reader.EVENTS,
                   '/images/' + IMAGE + '/json', '/containers/' + CONTAINER + '/json'}
        self.assertEqual({row[1] for row in fake.calls}, allowed)
        self.assertTrue(all(method == 'GET' and 0 < timeout <= 5 and maximum == reader.MAX_BODY for method, _, timeout, maximum in fake.calls))

    def test_foreign_rows_do_not_authorize_inspections(self):
        values = fixture()
        foreign = 'sha256:' + 'c' * 64
        values[reader.IMAGE_LIST][1].append({'Id': foreign, 'Labels': {'org.opencontainers.image.revision': 'foreign'}})
        fake = Fake(values)
        result = reader.observe(reader.Reader(fetch=fake))
        self.assertFalse(result['complete'])
        self.assertEqual(result['releaseImages']['rejectedRows'], 1)
        self.assertNotIn('/images/' + foreign + '/json', [row[1] for row in fake.calls])

    def test_mutating_method_and_unregistered_get_rejected_before_transport(self):
        with self.assertRaises(reader.ReadScopeError):
            reader.transport('POST', '/containers/create', 1, 1)
        fake = Fake()
        local = reader.Reader(fetch=fake)
        with self.assertRaises(reader.ReadScopeError):
            local.read('/containers/' + 'd' * 64 + '/json')
        self.assertEqual(fake.calls, [])

    def test_deadline_and_response_bounds_fail_closed(self):
        now = [0.0]
        fake = Fake()
        local = reader.Reader(fetch=fake, clock=lambda: now[0])
        now[0] = reader.TOTAL_SECONDS - 0.25
        local.read('/version')
        self.assertEqual(fake.calls[0][2], 0.25)
        now[0] = reader.TOTAL_SECONDS
        status, _ = local.read('/version')
        self.assertEqual(status['errorCode'], 'deadline')
        self.assertEqual(len(fake.calls), 1)
        oversized = reader.Reader(fetch=lambda *_: (200, b'x' * (reader.MAX_BODY + 1)))
        self.assertEqual(oversized.read('/version')[0]['errorCode'], 'body_bound')
        invalid = reader.Reader(fetch=lambda *_: (200, b'not-json ' + SECRET.encode()))
        self.assertEqual(invalid.read('/version')[0], {'httpStatus': 200, 'errorCode': 'invalid_json'})

    def test_malformed_and_outside_window_events_are_not_emitted(self):
        values = fixture()
        values[reader.EVENTS][1].extend([None, {'Actor': None}, {'Type': 'container', 'Actor': {'ID': CONTAINER, 'Attributes': {'avtocena.aj.nonce': reader.NONCE}}, 'time': 1, 'Action': 'start'}])
        result = reader.observe(reader.Reader(fetch=Fake(values)))
        self.assertFalse(result['complete'])
        self.assertEqual(result['nonceEvents']['rejectedRows'], 3)
        self.assertEqual(len(result['nonceEvents']['rows']), 1)


if __name__ == '__main__':
    unittest.main()
