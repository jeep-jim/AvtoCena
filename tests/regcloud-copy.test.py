import importlib.util
import io
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
spec = importlib.util.spec_from_file_location('migration', Path(__file__).parents[1] / 'scripts/regcloud-copy-s3.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Source:
    def __init__(self): self.reads = 0
    def get_object(self, **args):
        assert args == {'Bucket': 'source', 'Key': 'scope/document', 'IfMatch': '"v1"'}
        self.reads += 1
        return {'Body': io.BytesIO(b'customer-test-bytes'), 'ETag': '"v1"', 'Metadata': {'original': 'yes'}, 'ContentType': 'application/octet-stream', 'CacheControl': 'private', 'ContentDisposition': 'attachment'}

class Target:
    def __init__(self): self.data = None; self.headers = {}; self.corrupt = False; self.uploads = 0
    def upload_file(self, filename, bucket, key, **args):
        assert bucket == m.TARGET_BUCKET and key == m.TARGET_PREFIX + 'document'
        self.data = Path(filename).read_bytes(); self.headers = args['ExtraArgs']; self.uploads += 1
    def get_object(self, **args):
        return {**self.headers, 'Body': io.BytesIO(b'bad' if self.corrupt else self.data)}
    def head_object(self, **args):
        return {**self.headers, 'ContentLength': len(self.data)}

class CopyTests(unittest.TestCase):
    row = {'Key': 'scope/document', 'Size': 19, 'ETag': '"v1"', 'LastModified': '2026-10-11'}
    def setUp(self):
        self.source, self.target = Source(), Target()
        original = tempfile.NamedTemporaryFile
        self.spool = patch.object(m.tempfile, 'NamedTemporaryFile', side_effect=lambda **kw: original(prefix=kw['prefix']))
        self.spool.start(); self.addCleanup(self.spool.stop)
        self.transfer = patch.object(m, 'transfer_config', return_value=None)
        self.transfer.start(); self.addCleanup(self.transfer.stop)
    def copy(self, existing=None):
        return m.copy_one(self.source, self.target, 'source', 'scope/', self.row, existing or {})
    def test_verified_copy_and_headers(self):
        self.assertEqual(self.copy(), ('copied', 19))
        self.assertEqual(self.target.headers['CacheControl'], 'private')
        self.assertEqual(self.target.headers['Metadata']['original'], 'yes')
        self.assertEqual(self.source.reads, 1)
    def test_resume_rehashes_target_without_source_download(self):
        self.copy()
        self.assertEqual(self.copy({m.TARGET_PREFIX + 'document': {}}), ('resumed', 19))
        self.assertEqual(self.source.reads, 1)
        self.assertEqual(self.target.uploads, 1)
    def test_bad_destination_does_not_pass_verification(self):
        self.target.corrupt = True
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'): self.copy()
    def test_wrong_prefix_stops_before_read(self):
        with self.assertRaisesRegex(RuntimeError, 'prefix mismatch'):
            m.copy_one(self.source, self.target, 'source', 'other/', self.row, {})
        self.assertEqual(self.source.reads, 0)
    def test_metadata_timestamp_change_requires_final_sync(self):
        before = {'key': self.row}; after = {'key': {**self.row, 'LastModified': 'later'}}
        self.assertFalse(m.same_inventory(before, after))
    def test_incomplete_pagination_is_failure(self):
        class BadList:
            def list_objects_v2(self, **kwargs): return {'IsTruncated': True}
        with self.assertRaisesRegex(RuntimeError, 'Incomplete pagination'): m.inventory(BadList(), 'source')

if __name__ == '__main__': unittest.main()
