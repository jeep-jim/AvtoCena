import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).parents[1] / 'scripts/encyclopedia/run-astra-import.py'
SPEC = importlib.util.spec_from_file_location('astra_run', MODULE)
astra = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(astra)


class AstraRunTests(unittest.TestCase):
    def fixture(self):
        source = {'url': 'https://opendata.astra.admin.ch/ivzod/3000-eDatenblatt/eDatenblatt.csv',
            'path': '3000-eDatenblatt/eDatenblatt.csv', 'bytes': 10, 'sha256': 'a' * 64}
        return [source], [{**source, 'complete': True}], {
            'complete': True, 'sources': [{**source, 'verified': True}], 'verifiedBytes': 10}

    def test_complete_archive_requires_exact_full_source_set(self):
        sources, downloaded, archive = self.fixture()
        astra.check_downloads(sources, downloaded, archive)
        for invalid in [[], downloaded + downloaded]:
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                astra.check_downloads(sources, invalid, archive)

    def test_partial_report_or_changed_bytes_never_claims_complete(self):
        sources, downloaded, archive = self.fixture()
        for modify in [('complete', False), ('verifiedBytes', 11)]:
            changed = {**archive, modify[0]: modify[1]}
            with self.assertRaises(ValueError):
                astra.check_downloads(sources, downloaded, changed)
        changed = copy.deepcopy(downloaded)
        changed[0]['sha256'] = 'b' * 64
        with self.assertRaisesRegex(ValueError, 'pinned_plan'):
            astra.check_downloads(sources, changed, archive)

    def test_repository_request_pins_all_core_sources(self):
        marker, sources = astra.read_request('.github/market-runs/encyclopedia-astra-import.json')
        self.assertIn(marker['mode'], ('preview', 'apply'))
        self.assertTrue(set(astra.CORE_PATHS.values()).issubset({s['path'] for s in sources}))

    def test_apply_without_exact_preview_digest_is_rejected(self):
        marker, _ = astra.read_request('.github/market-runs/encyclopedia-astra-import.json')
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'marker.json'
            path.write_text(json.dumps({**marker, 'mode': 'apply', 'expectedPlanDigest': ''}))
            with self.assertRaisesRegex(ValueError, 'plan_digest_required'):
                astra.read_request(path)


if __name__ == '__main__':
    unittest.main()
