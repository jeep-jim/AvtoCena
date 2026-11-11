import collections
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).parents[1] / 'scripts/encyclopedia/extract-astra-supplements.py'
SPEC = importlib.util.spec_from_file_location('astra_supplements', MODULE)
astra = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(astra)


class AstraSupplementTests(unittest.TestCase):
    def test_private_fields_removed_but_driving_range_preserved(self):
        value = astra.sanitize({'vin': '1HGCM82633A004352', 'ownerName': 'Person',
            'drivingElectricRange': 520, 'remarks': 'Free text',
            'gearboxEmissions1': {'power': 110, 'holderAddress': 'Address'},
            'reference': 'mail@example.com', 'chVinPrefix': 'WVWZZZCDXP......',
            'createdBy': 'staff-id', 'businessId': 123, 'id': 'row-id',
            'chTypeApprovalNumber': '1TA001', 'type': 'NRE', 'version': '11'})
        self.assertEqual(value, {'drivingElectricRange': 520,
            'gearboxEmissions1': {'power': 110}, 'chTypeApprovalNumber': '1TA001',
            'type': 'NRE', 'version': '11'})

    def test_archive_deduplicates_language_and_excludes_heavy_categories(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'source.zip'
            with zipfile.ZipFile(path, 'w') as target:
                target.writestr('MV_1T1111.json', json.dumps([
                    {'chTypeApprovalNumber': '1T1111', 'languageCode': 'de', 'vehicleCategoryCode': 'M1'},
                    {'chTypeApprovalNumber': '1T1111', 'languageCode': 'fr', 'vehicleCategoryCode': 'M1'},
                    {'chTypeApprovalNumber': '3T1111', 'languageCode': 'de', 'vehicleCategoryCode': 'N3'}]))
                target.writestr('TR_1.json', '[]')
            counts = collections.Counter()
            rows = list(astra.iter_json_archive(path, counts))
            self.assertEqual(len(rows), 1)
            self.assertEqual(counts['equivalentOtherLanguageRows'], 1)
            self.assertEqual(counts['outsidePassengerLightScope'], 1)
            self.assertEqual(counts['archiveEntries'], 2)

    def fixture(self, temporary):
        root = Path(temporary)
        raw, corpus = root / 'raw', root / 'corpus'
        raw.mkdir(); corpus.mkdir()
        (corpus / 'core.jsonl').write_text(json.dumps({'facts': {
            'category': 'M1', 'approvalCH': '1T1111', 'engineCode': 'ABC'}}) + '\n')
        manifest = corpus / 'manifest.json'
        manifest.write_text(json.dumps({'files': [{'path': 'core.jsonl'}], 'sources': []}))
        tables = {
            'tas_emissions': 'chTypeApprovalNumber;gearboxNumber;versionDefined;drivingElectricRange\n1T1111;3;7;510\n',
            'targa_emissions': 'TG-Code\tGetriebe\tLeistung\n1T1111\tA6\t110\n',
            'targa_consumption': 'TG-Code\tGetriebe\tReichweite\n1T1111\tA6\t510\n',
            'targa_eu_approvals': '¦TGCODE¦;¦GBEZ¦;¦GG-NR¦\n¦1T1111¦;¦A6¦;¦e1*123¦\n',
            'targa_engine_approvals': '¦MKZEICH¦;¦MTYP¦\n¦ABC¦;¦Exact engine¦\n',
        }
        downloads = []
        for dataset, relative in astra.PATHS.items():
            file = raw / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            if dataset == 'tas_json':
                with zipfile.ZipFile(file, 'w') as archive:
                    archive.writestr('MV_1T1111.json', json.dumps([{
                        'chTypeApprovalNumber': '1T1111', 'languageCode': 'de',
                        'vehicleCategoryCode': 'M1', 'versionNo': 7, 'maximumContinuousRatedPower': 40,
                        'vin': '1HGCM82633A004352'}]))
            else:
                file.write_text(tables[dataset], encoding='utf-8' if dataset == 'tas_emissions' else 'cp1252')
            downloads.append({'path': relative, 'url': astra.BASE + relative,
                'sha256': astra.sha_file(file), 'bytes': file.stat().st_size, 'complete': True})
        return manifest, downloads, raw

    def test_attachments_keep_selectors_without_promoting_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, downloads, raw = self.fixture(temporary)
            report = astra.attach_supplements(manifest, downloads, raw, Path(temporary) / 'report.json')
            saved = json.loads(manifest.read_text())
            self.assertTrue(saved['supplementsComplete'])
            self.assertFalse(report['supplementValuesPromotedToCalculations'])
            self.assertFalse(report['modelYearsInferred'])
            self.assertEqual(len(saved['detailFiles']), 6)
            rows = []
            for part in saved['detailFiles']:
                path = manifest.parent / part['path']
                self.assertEqual(path.stat().st_size, part['bytes'])
                self.assertEqual(astra.sha_file(path), part['sha256'])
                with gzip.open(path, 'rt') as source:
                    rows.extend(json.loads(line) for line in source)
            self.assertEqual(len(rows), 6)
            emission = next(r for r in rows if r['sourceDataset'] == 'tas_emissions')
            self.assertEqual(emission['selectors'], {'gearboxNumber': '3', 'versionDefined': '7'})
            self.assertEqual(emission['additionalFacts']['drivingElectricRange'], '510')
            for row in rows:
                self.assertNotIn('values', row)
                self.assertNotIn('year', row)
                self.assertNotIn('vin', row['additionalFacts'])
                self.assertEqual(row['relationship'], 'technical_reference_requires_exact_version_selection')

    def test_checksum_mismatch_blocks_attachment(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, downloads, raw = self.fixture(temporary)
            downloads[0]['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'checksum_mismatch'):
                astra.attach_supplements(manifest, downloads, raw, Path(temporary) / 'report.json')
            self.assertNotIn('supplementsComplete', json.loads(manifest.read_text()))


if __name__ == '__main__':
    unittest.main()
