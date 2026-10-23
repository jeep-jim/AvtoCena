import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts/encyclopedia/download-astra.py'
SPEC = importlib.util.spec_from_file_location('download_astra', MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Response(io.BytesIO):
    def __init__(self, data, headers, status=206):
        super().__init__(data)
        self.headers = headers
        self.status = status


class AstraDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.content = b'correct official source'
        self.source = {
            'path': '3000-eDatenblatt/test.csv',
            'url': MODULE.BASE_URL + '3000-eDatenblatt/test.csv',
            'bytes': len(self.content), 'etag': '"fixture-v1"',
            'last_modified': 'Fri, 23 Oct 2026 09:00:00 GMT',
            'sha256': hashlib.sha256(self.content).hexdigest(),
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_source_and_redirect_allowlist_rejects_external_and_traversal(self):
        for url in ('http://opendata.astra.admin.ch/ivzod/x',
                    'https://evil.example/ivzod/x',
                    MODULE.BASE_URL + '%2e%2e/private',
                    MODULE.BASE_URL + 'x?redirect=https://evil.example',
                    'https://user@opendata.astra.admin.ch/ivzod/x'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                MODULE.checked_url(url)
        with self.assertRaises(ValueError):
            MODULE.AstraRedirectHandler().redirect_request(
                None, None, 302, '', {}, 'https://evil.example/data')

    def test_changed_official_length_blocks_before_download(self):
        headers = {'Content-Length': str(self.source['bytes'] + 1),
                   'ETag': self.source['etag'], 'Last-Modified': self.source['last_modified']}
        with patch.object(MODULE, 'request', return_value=Response(b'', headers)), self.assertRaisesRegex(ValueError, 'official_source_changed'):
            MODULE.get_metadata(self.source)

    def test_existing_corrupt_complete_file_is_not_trusted(self):
        target = self.root / 'raw' / self.source['path']
        target.parent.mkdir(parents=True)
        target.write_bytes(b'x' * self.source['bytes'])
        with self.assertRaisesRegex(ValueError, 'existing_source_checksum_mismatch'):
            MODULE.download(self.source, self.root)
        self.assertEqual(target.read_bytes(), b'x' * self.source['bytes'])

    def test_exact_local_source_reused_only_after_hash_validation(self):
        target = self.root / 'raw' / self.source['path']
        target.parent.mkdir(parents=True)
        target.write_bytes(self.content)
        with patch.object(MODULE, 'request', side_effect=AssertionError('unexpected HTTP')):
            result = MODULE.download(self.source, self.root)
        self.assertTrue(result['complete'])
        self.assertTrue(result['reused'])

    def test_partial_range_resumes_from_actual_offset_and_verifies_hash(self):
        part_root = MODULE.part_directory(self.source, self.root)
        part_root.mkdir(parents=True)
        (part_root / '000000.part').write_bytes(self.content[:4])

        def response(url, headers):
            self.assertEqual(headers['Range'], f'bytes=4-{len(self.content)-1}')
            self.assertEqual(headers['If-Range'], self.source['etag'])
            return Response(self.content[4:], {
                'ETag': self.source['etag'],
                'Content-Range': f'bytes 4-{len(self.content)-1}/{len(self.content)}',
            })

        with patch.object(MODULE, 'request', side_effect=response):
            result = MODULE.download(self.source, self.root, workers=1)
        self.assertEqual(Path(result['local_path']).read_bytes(), self.content)
        self.assertFalse(part_root.exists())

    def test_server_ignoring_range_cannot_replace_a_source(self):
        with patch.object(MODULE, 'request', return_value=Response(self.content, {}, status=200)), self.assertRaisesRegex(ValueError, 'source_range_mismatch'):
            MODULE.download(self.source, self.root, workers=1)
        self.assertFalse((self.root / 'raw' / self.source['path']).exists())

    def test_final_hash_mismatch_cannot_replace_a_source(self):
        bad = b'x' * self.source['bytes']
        headers = {'ETag': self.source['etag'],
                   'Content-Range': f'bytes 0-{len(bad)-1}/{len(bad)}'}
        with patch.object(MODULE, 'request', return_value=Response(bad, headers)), self.assertRaisesRegex(ValueError, 'downloaded_source_checksum_mismatch'):
            MODULE.download(self.source, self.root, workers=1)
        self.assertFalse((self.root / 'raw' / self.source['path']).exists())


if __name__ == '__main__':
    unittest.main()
