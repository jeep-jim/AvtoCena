import csv
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    'astra_bulk', Path(__file__).parents[1] / 'scripts/encyclopedia/extract-astra-bulk.py')
bulk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bulk)


def write_source(path, dataset, rows, extra=()):
    fields = sorted(bulk.REQUIRED[dataset] | set(extra))
    info = bulk.SOURCE_INFO[dataset]
    with path.open('w', encoding=info['encoding'], newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields, delimiter=info['delimiter'],
                                quoting=info.get('quoting', csv.QUOTE_MINIMAL))
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    return path.stat().st_size


def records(directory, manifest):
    return [json.loads(line) for shard in manifest['shards']
            for line in (Path(directory) / shard['path']).read_text().splitlines()]


class AstraBulkTest(unittest.TestCase):
    def test_complete_corpus_deduplicates_without_merging_conflicting_specs_or_years(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'ed.csv'
            base = {'0.1. Make': 'TOYOTA', '0.2. TypeApprovalNumber': 'e6*test*001*02',
                    '0.2. Type': 'AA', '0.2. Variant': 'B', '0.2. Version': 'C',
                    '0.2.1. CommercialName': 'Test Hybrid', '0.4. VehicleCategoryCode': 'M1',
                    '23. PureElectricVehIndicator': 'N', '23.1. ClassOfHybridVehicleCode': 'NOVC-HEV',
                    '25. EngineCapacity': '1490', '26. FuelCode': '10', 'N3 Tstof': 'C',
                    '27.1. MaximumNetPower': '68.00', '27.3. MaximumNetPowerElectricEngine': '59.00',
                    '27.4. MaximumContinuousRatedPowerVeh': '37.00', '5. Length': '3940',
                    '0.10. VehicleIdentificationNumber': 'WVWZZZ1KZ6W000001',
                    '0.5. StageManufacturerNameAndAdress': 'PRIVATE ADDRESS',
                    '52. Remarks': 'SECRET REMARKS WBA8E32040A019760',
                    '38. CodeForBodywork': 'AF'}
            rows = [dict(base, **{'0.11. DateOfManufactureVeh': '01.03.2024'}),
                    dict(base, **{'0.11. DateOfManufactureVeh': '02.03.2025'}),
                    dict(base, **{'27.4. MaximumContinuousRatedPowerVeh': '43.00'}),
                    dict(base, **{'5. Length': '3950'})]
            size = write_source(source, 'edatenblatt', rows, base)
            output = root / 'out'
            manifest = bulk.normalize_sources([('edatenblatt', source, size)], output, shard_size=1)
            result = records(output, manifest)
            self.assertEqual(manifest['sourceRows'], 4)
            self.assertEqual(manifest['technicalGroups'], 2)
            self.assertEqual(len(manifest['shards']), 2)
            self.assertEqual(manifest['technicalDetailGroups'], 3)
            repeated = next(row for row in result if row['sourceRows'] == 3)
            self.assertEqual(repeated['manufactureYears'], [2024, 2025])
            self.assertNotIn('modelYear', repeated)
            self.assertEqual(repeated['values']['power30MinKw'], 37)
            self.assertEqual(repeated['values']['icePowerKw'], 68)
            self.assertNotIn('powerKw', repeated['values'])
            self.assertNotIn('bodyType', repeated['values'])  # AF is not always SUV/MPV.
            self.assertNotIn('5. Length', repeated['additionalFacts'])
            self.assertEqual(repeated['additionalFactsRef']['observations'], 2)
            details = [json.loads(line) for shard in manifest['detailFiles']
                       for line in gzip.open(output / shard['path'], 'rt', encoding='utf-8')]
            self.assertEqual({d['additionalFacts']['5. Length'] for d in details if d['parentEvidenceId'] == repeated['evidenceId']}, {'3940', '3950'})
            all_json = json.dumps(result)
            for secret in ['WVWZZZ1KZ6W000001', 'WBA8E32040A019760', 'PRIVATE ADDRESS', 'SECRET REMARKS']:
                self.assertNotIn(secret, all_json)
            for shard in manifest['shards']:
                self.assertEqual(bulk.sha_file(output / shard['path']), shard['sha256'])
            for shard in manifest['detailFiles']:
                self.assertEqual(bulk.sha_file(output / shard['path']), shard['sha256'])
                self.assertEqual(shard['format'], 'astra-technical-details-jsonl-gzip-v1')
                self.assertEqual((output / shard['path']).read_bytes()[4:8], b'\x00\x00\x00\x00')
            self.assertEqual(sum(s['sourceRows'] for s in manifest['shards']), 4)
            self.assertTrue(manifest['complete'])
            self.assertFalse((output / 'normalization.work.sqlite').exists())
            repeated_manifest = bulk.normalize_sources([('edatenblatt', source, size)], root / 'repeated', shard_size=1)
            self.assertEqual(manifest['manifestDigest'], repeated_manifest['manifestDigest'])

    def test_tas_handles_quoted_newlines_decimal_comma_and_ch_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'tas.csv'
            row = {'chTypeApprovalNumber': '1AA101', 'makeName': 'ALFA ROMEO',
                   'commercialName': '145\n1.9 TD', 'type': '930A4A', 'vehicleCategoryCode': 'M1',
                   'chVehicleType': '10', 'chFuelType': 'D', 'engineCapacity': '1929',
                   'maximumNetPower': '66,00', 'maximumContinuousRatedPower': '',
                   'driveType': 'V', 'technicallyPermissibleMaximumLadenMassMinimum': '1730',
                   'technicallyPermissibleMaximumLadenMassMaximum': '1800'}
            size = write_source(source, 'tas', [row], row)
            manifest = bulk.normalize_sources([('tas', source, size)], root / 'out')
            result = records(root / 'out', manifest)[0]
            self.assertEqual(result['sourceRecordIds'], ['1AA101'])
            self.assertEqual(result['facts']['approval'], '')
            self.assertEqual(result['values']['powerKw'], 66)
            self.assertEqual(result['values']['icePowerKw'], 66)
            self.assertNotIn('power30MinKw', result['values'])
            self.assertNotIn('grossVehicleWeightKg', result['values'])
            self.assertEqual(result['additionalFacts']['technicallyPermissibleMaximumLadenMassMaximum'], '1800')
            self.assertEqual(result['manufactureYears'], [])

    def test_targa_trailing_empty_header_and_hybrid_power_are_not_30_minute_or_system(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'tg.txt'
            row = {'Typengenehmigungsnummer': '1TA001', '04 Marke': 'TOYOTA',
                   '04 Typ': 'Test HEV', '03 Fahrzeugklasse': 'M1', '01 Fahrzeugart': 'PERSONENWAGEN',
                   '05 Typ; Variante/Version': 'ABC; X/1, Y/2', '26 Bauart Treibstoff': 'C',
                   '28 Leistung kW': '85', '27 Hubraum': '1490', '17 Achsantrieb': 'Vorne',
                   '34 Motorkennzeichen': '"T" 1NZ',
                   'Typengenehmigung erteilt': '20190101', 'Bemerkungen Z1': 'WBA8E32040A019760'}
            fields = sorted(bulk.REQUIRED['targa'] | set(row))
            with source.open('w', encoding='cp1252', newline='') as f:
                writer = csv.writer(f, delimiter='\t', quoting=csv.QUOTE_NONE, quotechar=None)
                writer.writerow(fields + [''])
                writer.writerow([row.get(field, '') for field in fields])
            manifest = bulk.normalize_sources([('targa', source, source.stat().st_size)], root / 'out')
            result = records(root / 'out', manifest)[0]
            self.assertEqual(result['facts']['type'], 'ABC')
            self.assertEqual(result['facts']['variant'], '')
            self.assertEqual(result['facts']['version'], '')
            self.assertEqual(result['facts']['typeVariantVersionRaw'], 'ABC; X/1, Y/2')
            self.assertEqual(result['facts']['powerKw'], '85')
            for field in ['icePowerKw', 'powerKw', 'motorPeakKw', 'power30MinKw']:
                self.assertNotIn(field, result['values'])
            self.assertEqual(result['values']['drive'], 'fwd')
            self.assertEqual(result['values']['engineCode'], '"T" 1NZ')
            self.assertEqual(result['manufactureYears'], [])
            self.assertNotIn('WBA8E32040A019760', json.dumps(result))

    def test_tas_hybrid_explicit_30_minutes_does_not_reclassify_generic_motor_power(self):
        row = dict.fromkeys(bulk.REQUIRED['tas'], '')
        row.update({'chTypeApprovalNumber': '1NB612', 'makeName': 'NISSAN',
                    'commercialName': 'Qashqai', 'type': 'J12', 'variant': 'D',
                    'version': 'D01, -/D02, -/D03, -/D04', 'chFuelType': 'C',
                    'maximumNetPower': '116,00', 'maximumContinuousRatedPower': '70,0',
                    'engineCapacity': '1498', 'offVehicleChargingIndex': 'FALSE'})
        result = bulk.normalize_row('tas', row)
        self.assertEqual(result['facts']['powerKw'], '116,00')
        self.assertEqual(result['facts']['version'], 'D01, -/D02, -/D03, -/D04')
        self.assertEqual(result['values']['power30MinKw'], 70)
        self.assertEqual(result['values']['engineCc'], 1498)
        for field in ['powerKw', 'icePowerKw', 'motorPeakKw']:
            self.assertNotIn(field, result['values'])

    def test_numeric_parser_and_contradictory_electric_classification_fail_closed(self):
        for value in ['0', '-1', '100/110', '37 - 43', '150kW', 'nan', 'inf', '1e3', '']:
            self.assertIsNone(bulk.positive(value))
        self.assertEqual(bulk.positive('37,5'), 37.5)
        self.assertEqual(bulk.scalar_from_range('1730', '0'), '1730')
        self.assertEqual(bulk.scalar_from_range('1730', '1730,00'), '1730')
        for invalid_upper in ['1800', '1700-1800', 'unknown', '1800 kg']:
            self.assertEqual(bulk.scalar_from_range('1730', invalid_upper), '')
        row = dict.fromkeys(bulk.REQUIRED['edatenblatt'], '')
        row.update({'23. PureElectricVehIndicator': 'Y', 'N3 Tstof': 'C',
                    '23.1. ClassOfHybridVehicleCode': 'OVC-HEV',
                    '27.3. MaximumNetPowerElectricEngine': '200',
                    '27.4. MaximumContinuousRatedPowerVeh': '73'})
        result = bulk.normalize_row('edatenblatt', row)
        self.assertEqual(result['facts']['power30MinKw'], '73')
        for field in ['fuel', 'powertrainKind', 'powerKw', 'motorPeakKw', 'power30MinKw']:
            self.assertNotIn(field, result['values'])
        self.assertEqual(result['qualityFlags'], ['contradictory_electric_classification'])

    def test_continuous_power_above_maximum_is_preserved_but_withheld(self):
        row = dict.fromkeys(bulk.REQUIRED['edatenblatt'], '')
        row.update({'23. PureElectricVehIndicator': 'Y', 'N3 Tstof': 'E',
                    '27.3. MaximumNetPowerElectricEngine': '158',
                    '27.4. MaximumContinuousRatedPowerVeh': '175'})
        result = bulk.normalize_row('edatenblatt', row)
        self.assertEqual(result['facts']['power30MinKw'], '175')
        self.assertEqual(result['values']['motorPeakKw'], 158)
        self.assertNotIn('power30MinKw', result['values'])
        self.assertEqual(result['qualityFlags'], ['continuous_power_exceeds_declared_electric_maximum'])

    def test_source_conflicts_do_not_emit_certified_continuous_power_flag(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'ed.csv'
            rows = [
                {'0.1. Make': 'Tesla', '0.2.1. CommercialName': 'Model Y',
                 '23. PureElectricVehIndicator': 'Y', 'N3 Tstof': 'E',
                 '27.3. MaximumNetPowerElectricEngine': '158',
                 '27.4. MaximumContinuousRatedPowerVeh': '175'},
                {'0.1. Make': 'Mercedes-Benz', '0.2.1. CommercialName': 'GLE 350 de',
                 '23. PureElectricVehIndicator': 'Y', 'N3 Tstof': 'F',
                 '23.1. ClassOfHybridVehicleCode': 'OVC-HEV',
                 '27.1. MaximumNetPower': '145', '27.3. MaximumNetPowerElectricEngine': '100',
                 '27.4. MaximumContinuousRatedPowerVeh': '60'},
                {'0.1. Make': 'Toyota', '0.2.1. CommercialName': 'Test Hybrid',
                 '23. PureElectricVehIndicator': 'N', 'N3 Tstof': 'C',
                 '23.1. ClassOfHybridVehicleCode': 'NOVC-HEV',
                 '27.3. MaximumNetPowerElectricEngine': '59',
                 '27.4. MaximumContinuousRatedPowerVeh': '37'},
            ]
            size = write_source(source, 'edatenblatt', rows)
            manifest = bulk.normalize_sources([('edatenblatt', source, size)], root / 'out')
            result = {r['facts']['make']: r for r in records(root / 'out', manifest)}
            for make in ['Tesla', 'Mercedes-Benz']:
                self.assertFalse(result[make]['certified30Min'])
                self.assertNotIn('power30MinKw', result[make]['values'])
                self.assertTrue(result[make]['facts']['power30MinKw'])
            self.assertTrue(result['Toyota']['certified30Min'])
            self.assertEqual(result['Toyota']['values']['power30MinKw'], 37)

    def test_charging_class_preserves_explicit_range_extender_architecture(self):
        for hybrid in ['OVC-HEV', 'NOVC-HEV']:
            row = dict.fromkeys(bulk.REQUIRED['edatenblatt'], '')
            row.update({'23. PureElectricVehIndicator': 'N', 'N3 Tstof': 'R',
                        '23.1. ClassOfHybridVehicleCode': hybrid})
            result = bulk.normalize_row('edatenblatt', row)
            self.assertEqual(result['values']['fuel'], 'hybrid')
            self.assertEqual(result['values']['powertrainKind'], 'series_hybrid')
            self.assertEqual(result['facts']['hybridClass'], hybrid)

    def test_incomplete_wrong_hash_or_changed_schema_cannot_publish_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'wrong.csv'
            source.write_text('make;power\nToyota;150\n')
            for reason, length, shas, name in [
                ('incomplete_or_changed_source_length', source.stat().st_size + 1, {}, 'size'),
                ('source_sha_mismatch', source.stat().st_size, {'edatenblatt': '0' * 64}, 'sha'),
                ('source_schema_changed', source.stat().st_size, {}, 'schema'),
            ]:
                with self.assertRaisesRegex(ValueError, reason):
                    bulk.normalize_sources([('edatenblatt', source, length)], root / name, expected_shas=shas)
                self.assertFalse((root / name / 'manifest.json').exists())

    def test_missing_cell_in_named_column_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'broken.txt'
            fields = sorted(bulk.REQUIRED['targa'])
            with source.open('w', encoding='cp1252', newline='') as f:
                writer = csv.writer(f, delimiter='\t')
                writer.writerow(fields)
                writer.writerow([''] * (len(fields) - 1))
            with self.assertRaisesRegex(ValueError, 'malformed_row'):
                bulk.normalize_sources([('targa', source, source.stat().st_size)], root / 'out')


if __name__ == '__main__':
    unittest.main()
