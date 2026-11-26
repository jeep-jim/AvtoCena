import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stopped_layers', ROOT / 'scripts/regcloud-stopped-layers-20261126.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MetadataTests(unittest.TestCase):
    def test_launch_projection_allows_only_fixed_nonsecret_tokens(self):
        raw = '--api-key=do-not-print'
        projected = module.launch({'Config': {'Cmd': ['--max-old-space-size=4096', 'apps/web/server.js', raw]}})
        self.assertEqual(projected['Cmd']['tokens'][0]['value'], '--max-old-space-size=4096')
        self.assertEqual(projected['Cmd']['tokens'][1]['value'], 'apps/web/server.js')
        self.assertEqual(projected['Cmd']['tokens'][2]['kind'], 'opaque')
        self.assertNotIn('do-not-print', json.dumps(projected))
        self.assertNotIn('api-key', json.dumps(projected))

    def test_application_data_cannot_be_misclassified_as_cache(self):
        self.assertEqual(module.category('/app/data/uploads/client.json'), 'application_data')
        self.assertEqual(module.category('/app/apps/web/data/index.sqlite'), 'application_data')
        self.assertEqual(module.category('/app/apps/web/.next/cache/images/a'), 'next_cache')
        self.assertEqual(module.category('/app/public/uploads/client.jpg'), 'uploads_or_media')

    def test_metadata_reader_never_requests_file_bodies(self):
        row = {'Id': 'a' * 64, 'Image': 'sha256:' + 'b' * 64, 'SizeRw': 42}
        calls = []
        def fake(method, path):
            calls.append((method, path))
            if path.endswith('/changes'):
                return [{'Path': '/app/data/private-owner-name.json', 'Kind': 1}, {'Path': '/tmp/old', 'Kind': 2}]
            self.assertEqual(method, 'HEAD')
            return {'size': 42, 'mode': 0o600}
        with mock.patch.object(module, 'api', fake):
            result = module.classify(row, float('inf'))
        self.assertTrue(result['metadataComplete'])
        self.assertEqual(result['regularChangedFileBytes'], {'application_data': 42})
        self.assertNotIn('private-owner-name', json.dumps(result))
        self.assertEqual([method for method, path in calls], ['GET', 'HEAD'])

    def test_expired_metadata_deadline_reports_incomplete(self):
        row = {'Id': 'a' * 64, 'Image': 'sha256:' + 'b' * 64}
        with mock.patch.object(module, 'api', return_value=[{'Path': '/app/data/x', 'Kind': 1}]):
            result = module.classify(row, 0)
        self.assertFalse(result['metadataComplete'])
        self.assertEqual(result['metadataReads'], 0)

    def test_archive_get_and_mutations_are_refused(self):
        with self.assertRaises(RuntimeError):
            module.api('GET', '/containers/' + 'a' * 64 + '/archive?path=%2Fapp%2Fdata')
        for method in ('POST', 'DELETE', 'PUT'):
            with self.assertRaises(RuntimeError):
                module.api(method, '/containers/' + 'a' * 64 + '/start')


if __name__ == '__main__':
    unittest.main()
