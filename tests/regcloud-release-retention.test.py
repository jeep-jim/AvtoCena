import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('retention', Path(__file__).resolve().parents[1] / 'scripts/regcloud-release-retention.py')
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class ImageRetentionTest(unittest.TestCase):
    def test_only_old_unreferenced_application_images(self):
        now = dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc)
        tag = 'avtocena-regcloud:' + 'a' * 40
        image = {'Id': 'sha256:a', 'RepoTags': [tag], 'Created': '2026-10-16T00:00:00Z'}
        self.assertTrue(retention.eligible_unused_image(image, set(), now))
        self.assertFalse(retention.eligible_unused_image(image, {'sha256:a'}, now))
        for changed in ({'RepoTags': []}, {'RepoTags': [tag, 'other:latest']},
                        {'RepoTags': ['avtocena-regcloud:latest']},
                        {'Created': now.isoformat()}, {'Created': 'invalid'},
                        {'Created': '2026-10-01T00:00:00'}):
            with self.subTest(changed=changed):
                self.assertFalse(retention.eligible_unused_image(dict(image, **changed), set(), now))


if __name__ == '__main__':
    unittest.main()
