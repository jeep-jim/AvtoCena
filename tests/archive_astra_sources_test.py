import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts/encyclopedia/archive-astra-sources.py'
SPEC = importlib.util.spec_from_file_location('archive_astra', MODULE_PATH)
ARCHIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVE)


class ClientError(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code}}
        super().__init__(code)


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.upload_count = 0
        self.download_count = 0

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError('NoSuchKey')
        return {'Body': io.BytesIO(self.objects[Key]['body'])}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError('404')
        obj = self.objects[Key]
        return {'ContentLength': len(obj['body']), 'Metadata': obj.get('metadata', {})}

    def upload_file(self, filename, bucket, key, Config, ExtraArgs):
        self.objects[key] = {'body': Path(filename).read_bytes(), 'metadata': ExtraArgs['Metadata']}
        self.upload_count += 1

    def download_file(self, bucket, key, filename, Config):
        if key not in self.objects:
            raise ClientError('404')
        Path(filename).write_bytes(self.objects[key]['body'])
        self.download_count += 1

    def put_object(self, Bucket, Key, Body, ContentType, IfNoneMatch):
        if Key in self.objects and IfNoneMatch == '*':
            raise ClientError('PreconditionFailed')
        self.objects[Key] = {'body': bytes(Body)}


def fake_modules(client):
    modules = {name: types.ModuleType(name) for name in (
        'boto3', 'boto3.s3', 'boto3.s3.transfer', 'botocore', 'botocore.config', 'botocore.exceptions')}
    modules['boto3'].client = lambda *args, **kwargs: client
    modules['boto3.s3.transfer'].TransferConfig = lambda **kwargs: kwargs
    modules['botocore.config'].Config = lambda **kwargs: kwargs
    modules['botocore.exceptions'].ClientError = ClientError
    return modules


class ArchiveReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.output = self.root / 'corpus'
        self.plan = self.root / 'plan.json'
        self.report = self.root / 'report.json'
        self.content = b'official;type;variant\n'
        self.source = {'path': '3000-eDatenblatt/test.csv',
                       'url': 'https://opendata.astra.admin.ch/ivzod/3000-eDatenblatt/test.csv',
                       'bytes': len(self.content), 'etag': '"test-v1"',
                       'last_modified': 'Fri, 23 Oct 2026 09:00:00 GMT',
                       'sha256': hashlib.sha256(self.content).hexdigest()}
        self.plan.write_text(json.dumps({'sources': [self.source]}))
        self.client = MemoryS3()
        self.downloader = ARCHIVE.get_downloader()
        self.local = self.output / 'raw' / self.source['path']

    def tearDown(self):
        self.temp.cleanup()

    def run_archive(self, should_download=True, metadata_error=None):
        def fake_download(source, output_root, workers):
            if not should_download:
                raise AssertionError('official body must not be redownloaded when receipt exists')
            self.assertEqual(source, self.source)
            self.local.parent.mkdir(parents=True, exist_ok=True)
            self.local.write_bytes(self.content)
            return {**source, 'complete': True, 'local_path': str(self.local)}

        environment = {'YC_OBJECT_STORAGE_ENDPOINT': 'https://s3.regru.cloud',
                       'JSON_STORAGE_DRIVER': 'object', 'YC_OBJECT_STORAGE_BUCKET': 'fixture-private',
                       'YC_OBJECT_STORAGE_PREFIX': 'fixture', 'YC_OBJECT_STORAGE_REGION': 'fixture',
                       'YC_OBJECT_STORAGE_ACCESS_KEY_ID': 'fixture',
                       'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY': 'fixture'}
        argv = ['archive-astra-sources.py', '--plan', str(self.plan),
                '--output-root', str(self.output), '--report', str(self.report)]
        metadata = patch.object(self.downloader, 'get_metadata',
                                side_effect=metadata_error or (lambda source: dict(source)))
        with patch.dict(sys.modules, fake_modules(self.client)), patch.dict(os.environ, environment), patch.object(sys, 'argv', argv), metadata, patch.object(self.downloader, 'download', side_effect=fake_download), patch('builtins.print'):
            ARCHIVE.main()
        return json.loads(self.report.read_text())

    def receipt_key(self):
        return next(k for k in self.client.objects if '/source-receipts/' in k)

    def source_key(self):
        return next(k for k in self.client.objects if '/sources/' in k)

    def change_receipt(self, **values):
        key = self.receipt_key()
        receipt = json.loads(self.client.objects[key]['body'])
        receipt.update(values)
        self.client.objects[key]['body'] = json.dumps(receipt).encode()

    def test_first_archive_and_s3_restore_are_complete_and_content_addressed(self):
        report = self.run_archive()
        self.assertTrue(report['complete'])
        self.assertEqual(report['sourcePlanSha256'], hashlib.sha256(self.plan.read_bytes()).hexdigest())
        self.assertEqual(report['plannedPaths'], [self.source['path']])
        self.assertEqual(report['sourceCount'], 1)
        self.assertEqual(self.client.upload_count, 1)
        self.local.unlink()
        report = self.run_archive(should_download=False)
        self.assertTrue(report['complete'])
        self.assertTrue(report['sources'][0]['reused'])
        self.assertEqual(self.local.read_bytes(), self.content)
        self.assertEqual(self.client.download_count, 1)
        self.assertEqual(self.client.upload_count, 1)
        gate = json.loads((self.output / 'download_complete.json').read_text())
        self.assertEqual(gate['source_plan_sha256'], report['sourcePlanSha256'])
        self.assertEqual(gate['source_count'], 1)

    def test_invalid_receipt_key_rejected_even_when_local_file_is_valid(self):
        self.run_archive()
        self.change_receipt(key='knowledge/astra/v1/sources/wrong/path.csv')
        with self.assertRaisesRegex(ValueError, 'source_receipt_key_invalid'):
            self.run_archive(should_download=False)
        self.assertFalse(json.loads(self.report.read_text())['complete'])
        self.assertFalse((self.output / 'download_complete.json').exists())
        self.assertEqual(self.client.upload_count, 1)

    def test_receipt_digest_conflict_is_rejected(self):
        self.run_archive()
        self.change_receipt(sha256='0' * 64)
        with self.assertRaisesRegex(ValueError, 'source_receipt_conflict'):
            self.run_archive(should_download=False)
        self.assertFalse(json.loads(self.report.read_text())['complete'])

    def test_corrupt_s3_restore_is_not_installed_as_local_source(self):
        self.run_archive()
        self.local.unlink()
        self.client.objects[self.source_key()]['body'] = b'x' * self.source['bytes']
        with self.assertRaisesRegex(ValueError, 'restored_source_checksum_mismatch'):
            self.run_archive(should_download=False)
        self.assertFalse(self.local.exists())
        self.assertFalse(json.loads(self.report.read_text())['complete'])

    def test_immutable_archive_metadata_conflict_fails(self):
        self.run_archive()
        self.client.objects[self.source_key()]['metadata']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'immutable_source_archive_conflict'):
            self.run_archive(should_download=False)
        self.assertFalse(json.loads(self.report.read_text())['complete'])

    def test_failed_first_request_replaces_stale_success_report(self):
        self.run_archive()
        with self.assertRaisesRegex(RuntimeError, 'official_unavailable'):
            self.run_archive(metadata_error=RuntimeError('official_unavailable'))
        self.assertFalse(json.loads(self.report.read_text())['complete'])
        self.assertFalse((self.output / 'download_complete.json').exists())

    def test_manifest_source_requires_matching_url_path_and_allowed_origin(self):
        self.local.parent.mkdir(parents=True)
        self.local.write_bytes(self.content)
        for change in ({'path': 'other.csv'},
                       {'url': self.source['url'] + '?mirror=1'},
                       {'url': self.source['url'].replace('.ch/', '.ch:444/')},
                       {'path': '../outside.csv'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                ARCHIVE.checked_source({**self.source, **change, 'complete': True}, self.output / 'raw')


if __name__ == '__main__':
    unittest.main()
