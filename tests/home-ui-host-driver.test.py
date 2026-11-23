import base64
import importlib.util
import io
import json
from pathlib import Path
import queue
import tarfile
import tempfile
import threading
import time
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


driver = load('home_driver', ROOT / '.github/operations/home-ui-activation-20261123/host-driver.py')
fixtures = load('home_host_fixtures', ROOT / 'tests/home-ui-host-primitives.test.py')
host = driver.host
NONCE = 'a' * 32


class HostDriverTests(unittest.TestCase):
    def test_preparation_authority_failure_has_no_ingress_transaction_and_cleans_only_owned_candidate(self):
        plan, receipt, serving = fixtures.context()
        local = fixtures.FakeLocal(plan)
        def authority(phase, *_):
            if phase == 'ingress_prepare':
                raise host.HostError('home_host_controller_authority')
        adapter = host.HostPrimitives(plan, host.sha(host.json_bytes(plan)), receipt, authority, local=local)
        adapter.locked = True
        with mock.patch.object(adapter, 'fresh_inventory', return_value=serving), \
             mock.patch.object(adapter, 'checked_materials'), \
             mock.patch.object(host.inventory.LocalIO, 'config', return_value=fixtures.CONFIG), \
             mock.patch.object(host.inventory, 'verify_config') as config, mock.patch.object(host.inventory, 'verify_health') as health:
            adapter.start_candidate()
            protocol = types.SimpleNamespace(nonce=NONCE)
            runner = driver.Driver(protocol)
            runner.adapter, runner.switched = adapter, True
            with self.assertRaisesRegex(host.HostError, 'controller_authority'):
                adapter.switch(Path(host.ROLLBACK_PARENT) / NONCE)
            self.assertIsNone(adapter.ingress)
            runner.emergency_rollback()
            self.assertIsNone(adapter.candidate)
            self.assertNotIn('2' * 64, local.rows)
            self.assertTrue(config.called)
            self.assertTrue(health.called)

    def test_foreign_ingress_refuses_cleanup_and_accepted_session_never_rolls_back_on_disconnect(self):
        events = []
        adapter = types.SimpleNamespace(candidate='2' * 64, ingress=object(),
                                        rollback=mock.Mock(side_effect=host.HostError('home_host_nginx_foreign_rollback')),
                                        cleanup_candidate=lambda: events.append('cleanup'))
        runner = driver.Driver(types.SimpleNamespace(nonce=NONCE))
        runner.adapter, runner.switched = adapter, True
        with self.assertRaisesRegex(host.HostError, 'nginx_foreign_rollback'):
            runner.emergency_rollback()
        self.assertEqual(events, [])
        runner.accepted = True
        runner.emergency_rollback()
        self.assertEqual(adapter.rollback.call_count, 1)

    def test_streaming_upload_announces_only_on_read_and_failed_queue_is_drained_before_control(self):
        output = io.StringIO()
        protocol = driver.Protocol(io.BytesIO(), output, NONCE, interrupt=lambda: None)
        protocol.uploads[1] = queue.Queue(maxsize=8)
        protocol.uploads[1].put(b'abcdef')
        protocol.uploads[1].put(None)
        stream = protocol.upload_stream(1)
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(stream.read(3), b'abc')
        self.assertEqual(stream.read(3), b'def')
        self.assertEqual(stream.read(3), b'')
        self.assertEqual(json.loads(output.getvalue()), {'kind': 'upload-ready', 'id': 1})
        for _ in range(8):
            protocol.uploads[1].put(b'pending')
        protocol.finish_upload(1)
        self.assertNotIn(1, protocol.uploads)
        self.assertIn(1, protocol.finished_uploads)
        frames = [{'kind': 'chunk', 'id': 1, 'data': base64.b64encode(b'ignored').decode()},
                  {'kind': 'call', 'id': 1, 'method': 'rollback', 'params': {}}]
        protocol.reader = io.BytesIO(b''.join(host.json_bytes(row) + b'\n' for row in frames))
        protocol.read_loop()
        self.assertEqual(protocol.commands.get()['method'], 'rollback')

    def test_authority_reply_must_match_owner_generation_fingerprint_and_expiry(self):
        for fault in (None, 'operationId', 'generationId', 'acceptedReadModelFingerprint', 'lockedUntilMs'):
            protocol = driver.Protocol(io.BytesIO(), io.StringIO(), NONCE, interrupt=lambda: None)
            def emit(value):
                reply = {'ok': True, 'operationId': 'home-ui-catalog-b4d2-' + NONCE, 'generationId': 'gen_1_test',
                         'acceptedReadModelFingerprint': 'b' * 64, 'lockedUntilMs': int(time.time() * 1000) + 60000}
                if fault:
                    reply[fault] = 0 if fault == 'lockedUntilMs' else 'foreign'
                protocol.replies[value['id']].put(reply)
            protocol.emit = emit
            if fault:
                with self.assertRaisesRegex(host.HostError, 'controller_authority'):
                    protocol.authority('candidate_create', 'gen_1_test', 'b' * 64)
            else:
                protocol.authority('candidate_create', 'gen_1_test', 'b' * 64)
            self.assertEqual(protocol.replies, {})

    def test_browser_verdict_requires_exact_nonce_before_writing_and_replay_interrupts(self):
        with tempfile.TemporaryDirectory() as temporary:
            for fault in (True, False):
                target = Path(temporary) / ('bad' if fault else 'good')
                target.mkdir()
                verdict = {'schemaVersion': 1, 'release': host.SOURCE, 'nonce': 'b' * 32 if fault else NONCE,
                           'passed': True, 'functionalPassed': True, 'speedPassed': True, 'reportSha256': 'c' * 64}
                frame = host.json_bytes({'kind': 'browser-verdict', 'value': verdict}) + b'\n'
                interrupted = []
                protocol = driver.Protocol(io.BytesIO(frame + frame), io.StringIO(), NONCE, interrupt=lambda: interrupted.append(True))
                protocol.verdict_directory = target
                protocol.read_loop()
                self.assertTrue(interrupted)
                self.assertEqual(len(list(target.iterdir())), 0 if fault else 1)

    def test_image_digest_size_and_tag_scope_are_checked_before_local_docker_load(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as tar:
            raw = host.json_bytes([{'Config': 'synthetic.json', 'RepoTags': ['foreign-production:latest'], 'Layers': []}])
            info = tarfile.TarInfo('manifest.json')
            info.size = len(raw)
            tar.addfile(info, io.BytesIO(raw))
        data = archive.getvalue()
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(driver, 'ROOT', Path(temporary)), \
             mock.patch.object(driver, 'private_execute') as execute:
            runner = driver.Driver(types.SimpleNamespace(nonce=NONCE))
            runner.adapter = types.SimpleNamespace(guard=lambda phase: None, local=types.SimpleNamespace(transfer_capacity=lambda *args: {}),
                                                    plan={'imageBuild': {'imageArchiveSha256': host.sha(data)}, 'imageArchiveBytes': len(data), 'imageId': 'sha256:' + 'a' * 64})
            with self.assertRaisesRegex(host.HostError, 'image_tag_scope'):
                runner.install_image(io.BytesIO(data), len(data))
            with self.assertRaisesRegex(host.HostError, 'image_archive_size'):
                runner.install_image(io.BytesIO(data), len(data) - 1)
            with self.assertRaisesRegex(host.HostError, 'image_archive_digest'):
                runner.install_image(io.BytesIO(data[:-1] + b'x'), len(data))
            execute.assert_not_called()
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_accept_requires_private_public_and_browser_sequence(self):
        runner = driver.Driver(types.SimpleNamespace(nonce=NONCE))
        runner.adapter = types.SimpleNamespace(verify_candidate=mock.Mock(), local=mock.Mock())
        runner.completed.add('init')
        for method in ('start', 'switch', 'browser', 'accept'):
            with self.assertRaisesRegex(host.HostError, 'driver_phase'):
                runner.command(method, {}, 1)
        runner.adapter.verify_candidate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
