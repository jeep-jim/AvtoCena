import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('astra', Path(__file__).parents[1] / 'scripts/encyclopedia/extract-astra.py')
astra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(astra)

class AstraExtractionTest(unittest.TestCase):
    def test_dedup_keeps_conflicting_power_versions_and_drops_identifiers(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'source.csv'
            fields = list(astra.FIELDS.values()) + ['0.11. DateOfManufactureVeh', 'LastModified', '0.10. VehicleIdentificationNumber']
            with p.open('w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=fields, delimiter=';')
                w.writeheader()
                for power, date in [('73', '01.01.2024'), ('73', '02.01.2025'), ('64', '03.01.2025')]:
                    row = dict.fromkeys(fields, '')
                    row.update({'0.1. Make': 'TOYOTA', '27.4. MaximumContinuousRatedPowerVeh': power,
                                '0.11. DateOfManufactureVeh': date, '0.10. VehicleIdentificationNumber': 'EXCLUDED-VIN'})
                    w.writerow(row)
            r = astra.extract(p, p.stat().st_size, 'Toyota')
            self.assertEqual(r['technicalGroups'], 2)
            self.assertEqual(r['selectedRows'], 3)
            self.assertNotIn('EXCLUDED-VIN', json.dumps(r))
            self.assertEqual(next(g for g in r['records'] if g['facts']['power30MinKw'] == '73')['manufactureYears'], [2024, 2025])
            self.assertEqual(r['status'], 'source_evidence_only_not_catalog_matched')
            with self.assertRaisesRegex(ValueError, 'incomplete_or_changed'):
                astra.extract(p, p.stat().st_size + 1)

    def test_schema_changes_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'source.csv'
            p.write_text('make;power\nToyota;150\n')
            with self.assertRaisesRegex(ValueError, 'schema_changed'):
                astra.extract(p, p.stat().st_size)

if __name__ == '__main__':
    unittest.main()
