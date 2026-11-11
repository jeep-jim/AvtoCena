"""Extract official technical evidence, never apply it to catalog variants.

Requires the complete public ASTRA CSV's advertised byte length. Retains exact
approval/type/variant/version and manufacturing year; omits VIN and addresses.
Registration/manufacturing years are not inferred to be catalog model years.
"""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path

FIELDS = {
    'make': '0.1. Make', 'approval': '0.2. TypeApprovalNumber',
    'type': '0.2. Type', 'variant': '0.2. Variant', 'version': '0.2. Version',
    'commercialName': '0.2.1. CommercialName', 'category': '0.4. VehicleCategoryCode',
    'poweredAxles': '3. NumberOfPoweredAxles', 'axles': '3. AxlesInformation',
    'engineCode': '21. EngineCodeAsMarkedOnTheEngine',
    'pureElectric': '23. PureElectricVehIndicator', 'hybridClass': '23.1. ClassOfHybridVehicleCode',
    'engineCc': '25. EngineCapacity', 'fuelCode': '26. FuelCode',
    'icePowerKw': '27.1. MaximumNetPower',
    'motorPeakKw': '27.3. MaximumNetPowerElectricEngine',
    'power30MinKw': '27.4. MaximumContinuousRatedPowerVeh',
    'grossVehicleWeightKg': '16.1. TechnPermMaxLadenMass',
    'gearboxCode': '28. GearboxTypeCode', 'bodyworkCode': '38. CodeForBodywork',
}
SOURCE = 'https://opendata.astra.admin.ch/ivzod/3000-eDatenblatt/eDatenblatt.csv'
SCHEMA = 'https://opendata.astra.admin.ch/ivzod/3000-eDatenblatt/Testdatensatz_eDatenblatt_mit_Beschreibung.xlsx'

def extract(input_path, expected_bytes, make=None):
    path = Path(input_path)
    if path.stat().st_size != expected_bytes:
        raise ValueError('incomplete_or_changed_source_length')
    groups, counts, selected, total = {}, collections.Counter(), 0, 0
    sha = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            sha.update(block)
    with path.open(encoding='utf-8-sig', newline='') as source:
        reader = csv.DictReader(source, delimiter=';', strict=True)
        required = set(FIELDS.values()) | {'0.11. DateOfManufactureVeh', 'LastModified'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError('source_schema_changed')
        for row in reader:
            total += 1
            if None in row or any(value is None for value in row.values()):
                raise ValueError('malformed_row:' + str(total))
            counts[row[FIELDS['make']].casefold()] += 1
            if make and row[FIELDS['make']].casefold() != make.casefold():
                continue
            selected += 1
            facts = {key: row[field] for key, field in FIELDS.items()}
            # Preserve source number strings and missing/zero distinctions.
            key = json.dumps(facts, sort_keys=True, ensure_ascii=False)
            if key not in groups:
                groups[key] = {'facts': facts, 'sourceRows': 0, 'manufactureYears': set(), 'exampleRecordNumbers': []}
            group = groups[key]
            group['sourceRows'] += 1
            date = row['0.11. DateOfManufactureVeh']
            if len(date) == 10 and date[2] == '.' and date[5] == '.' and date[-4:].isdigit():
                group['manufactureYears'].add(int(date[-4:]))
            if len(group['exampleRecordNumbers']) < 3:
                group['exampleRecordNumbers'].append(total)
    if path.stat().st_size != expected_bytes:
        raise ValueError('source_changed_during_read')
    records = []
    for key in sorted(groups):
        group = groups[key]
        group['manufactureYears'] = sorted(group['manufactureYears'])
        group['evidenceId'] = hashlib.sha256(key.encode()).hexdigest()
        records.append(group)
    return {'version': 1, 'sourceUrl': SOURCE, 'schemaUrl': SCHEMA,
            'sourceSha256': sha.hexdigest(), 'sourceBytes': expected_bytes,
            'sourceRows': total, 'selectedMake': make, 'selectedRows': selected,
            'makes': dict(sorted(counts.items())), 'technicalGroups': len(records),
            'status': 'source_evidence_only_not_catalog_matched', 'records': records}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--expected-bytes', type=int, required=True)
    parser.add_argument('--make')
    args = parser.parse_args()
    report = extract(args.input, args.expected_bytes, args.make)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['records', 'makes']}))
