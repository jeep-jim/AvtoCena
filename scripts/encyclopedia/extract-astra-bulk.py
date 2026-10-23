"""Normalize complete ASTRA datasets into auditable technical-evidence JSONL.

This program never writes the encyclopedia or assigns model years. It preserves
the three distinct power concepts, technical identities, conflicting versions
and structured extra specifications. VINs, addresses and unstructured remarks
are excluded from the normalized corpus. The original files remain the source
of truth. A verified byte count is mandatory for each input.

Example:
  python extract-astra-bulk.py --source edatenblatt /tmp/eDatenblatt.csv 851983508 \
      --source tas /tmp/TAS_Automobil.csv 354566574 --output-dir /tmp/astra-corpus
"""

import argparse
import collections
import csv
import datetime
import gzip
import hashlib
import io
import json
import math
import re
import sqlite3
import sys
import tempfile
from pathlib import Path


BASE = 'https://opendata.astra.admin.ch/ivzod/'
ED_SCHEMA = BASE + '3000-eDatenblatt/Testdatensatz_eDatenblatt_mit_Beschreibung.xlsx'
TAS_SCHEMA = BASE + '4000-Typengenehmigungen_TAS/4250-json-Schema/govServices_TypeApproval_Schema.json'
TARGA_SCHEMA = BASE + '2000-Typengenehmigungen_TG_TARGA/2100-Dokumentation_und_Uebersichtstabelle/%5B711584087%5D%20Dokumentation%20TARGA%20Daten.pdf'
SOURCE_INFO = {
    'edatenblatt': {
        'url': BASE + '3000-eDatenblatt/eDatenblatt.csv',
        'schema': ED_SCHEMA, 'encoding': 'utf-8-sig', 'delimiter': ';',
    },
    'tas': {
        'url': BASE + '4000-Typengenehmigungen_TAS/4300-Datensaetze/TAS_Automobil.csv',
        'schema': TAS_SCHEMA, 'encoding': 'utf-8-sig', 'delimiter': ';',
    },
    'targa': {
        'url': BASE + '2000-Typengenehmigungen_TG_TARGA/2200-Basisdaten_TG_ab_1995/TG-Automobil.txt',
        'schema': TARGA_SCHEMA, 'encoding': 'cp1252', 'delimiter': '\t',
        # This is an unquoted TSV export; quotation marks are literal text.
        'quoting': csv.QUOTE_NONE,
    },
}

ED_FIELDS = {
    'make': '0.1. Make', 'approval': '0.2. TypeApprovalNumber',
    'type': '0.2. Type', 'variant': '0.2. Variant', 'version': '0.2. Version',
    'commercialName': '0.2.1. CommercialName', 'category': '0.4. VehicleCategoryCode',
    'engineCode': '21. EngineCodeAsMarkedOnTheEngine',
    'pureElectric': '23. PureElectricVehIndicator', 'hybridClass': '23.1. ClassOfHybridVehicleCode',
    'engineCc': '25. EngineCapacity', 'fuelCode': '26. FuelCode',
    'icePowerKw': '27.1. MaximumNetPower',
    'motorPeakKw': '27.3. MaximumNetPowerElectricEngine',
    'power30MinKw': '27.4. MaximumContinuousRatedPowerVeh',
    'grossVehicleWeightKg': '16.1. TechnPermMaxLadenMass',
    'gearboxCode': '28. GearboxTypeCode', 'bodyworkCode': '38. CodeForBodywork',
    'poweredAxles': '3. NumberOfPoweredAxles', 'axles': '3. AxlesInformation',
    'driveCode': 'N2 Antri', 'fuelCodeCH': 'N3 Tstof',
}
TAS_FIELDS = {
    'make': 'makeName', 'approval': 'typeApprovalNumber', 'approvalCH': 'chTypeApprovalNumber',
    'type': 'type', 'variant': 'variant', 'version': 'version',
    'commercialName': 'commercialName', 'category': 'vehicleCategoryCode',
    'engineCode': 'chEngineCodeAsMarkedOnTheEngine', 'engineCc': 'engineCapacity',
    'powerKw': 'maximumNetPower', 'power30MinKw': 'maximumContinuousRatedPower',
    'fuelCodeCH': 'chFuelType', 'driveCode': 'driveType',
}
TARGA_FIELDS = {
    'make': '04 Marke', 'approval': '09 EU-Gesamtgenehmigung',
    'approvalCH': 'Typengenehmigungsnummer', 'commercialName': '04 Typ',
    'category': '03 Fahrzeugklasse', 'engineCode': '34 Motorkennzeichen',
    'engineCc': '27 Hubraum', 'powerKw': '28 Leistung kW',
    'fuelCodeCH': '26 Bauart Treibstoff', 'driveCode': '17 Achsantrieb',
}
FACT_KEYS = sorted(set(ED_FIELDS) | set(TAS_FIELDS) | set(TARGA_FIELDS) | {
    'powerSemantics', 'offVehicleCharging', 'bodyworkCodeCH', 'vehicleTypeCH',
    'gearboxCodeCH', 'typeVariantVersionRaw', 'engineType',
})
REQUIRED = {
    'edatenblatt': set(ED_FIELDS.values()) | {'0.11. DateOfManufactureVeh'},
    'tas': set(TAS_FIELDS.values()) | {'offVehicleChargingIndex', 'chVehicleType'},
    'targa': set(TARGA_FIELDS.values()) | {'05 Typ; Variante/Version', '01 Fahrzeugart'},
}

# Exact code translations, not model-name classification. AF deliberately has
# no bodyType mapping: a multi-purpose CoC body may be an SUV or another body.
EU_BODIES = {'AA': 'sedan', 'AB': 'hatchback', 'AC': 'wagon', 'AD': 'coupe',
             'AE': 'convertible', 'AG': 'pickup', 'BB': 'van', 'BE': 'pickup'}
EU_GEARBOXES = {'M': 'manual', 'A': 'automatic', 'C': 'cvt', 'D': 'dct',
               'F': 'Одноступенчатый редуктор'}
DIRECT_DRIVES = {'V': 'fwd', 'VORNE': 'fwd', 'VORDERRÄDER': 'fwd',
                 'H': 'rwd', 'HINTEN': 'rwd', 'HINTERRÄDER': 'rwd',
                 'A': 'awd', 'ALLRAD': 'awd'}
FUEL_CH = {
    'B': ('petrol', 'combustion'), 'D': ('diesel', 'combustion'),
    'C': ('hybrid', 'other_hybrid'), 'F': ('hybrid', 'other_hybrid'),
    'E': ('electric', 'electric'), 'R': ('hybrid', 'series_hybrid'),
    'L': ('lpg', 'combustion'), 'N': ('cng', 'combustion'),
}
NUMERIC_VALUE_FIELDS = ['engineCc', 'icePowerKw', 'motorPeakKw',
                        'power30MinKw', 'grossVehicleWeightKg']
VIN_RE = re.compile(r'(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])', re.I)


def stable(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha_file(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def clean(value):
    return str(value or '').strip()


def positive(value):
    """A single positive decimal. No range, list, formula or unit stripping."""
    s = clean(value)
    if not re.fullmatch(r'\d+(?:[.,]\d+)?', s):
        return None
    v = float(s.replace(',', '.'))
    if not math.isfinite(v) or v <= 0:
        return None
    return int(v) if v.is_integer() else v


def manufacture_year(value):
    s = clean(value)
    for fmt in ('%d.%m.%Y', '%Y-%m-%d', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.datetime.strptime(s, fmt).year
        except ValueError:
            pass
    return None


def scalar_from_range(minimum, maximum):
    """A legacy 0 upper bound means no second value; conflicting bounds stay raw."""
    lo, hi = positive(minimum), positive(maximum)
    upper = clean(maximum)
    no_upper = not upper or bool(re.fullmatch(r'0+(?:[.,]0+)?', upper))
    return clean(minimum) if lo and (no_upper or lo == hi) else ''


def technical_type(raw):
    """Split only a single unambiguous type;variant/version, preserve raw too."""
    raw = clean(raw)
    if ';' not in raw:
        return raw, '', ''
    first, tail = raw.split(';', 1)
    if re.fullmatch(r'\s*[^\s,;/]+/[^\s,;/]+\s*', tail):
        variant, version = (s.strip() for s in tail.split('/'))
        return first.strip(), '' if variant == '-' else variant, '' if version == '-' else version
    return first.strip(), '', ''


def safe_extra(dataset, field, value):
    """Only structured technical columns; never free-text notes or identities."""
    value = clean(value)
    if not value:
        return False
    lower = field.lower()
    if any(x in lower for x in ['vin', 'address', 'adress', 'fahrgestellnummer',
                                'vorziffer', 'herstellerplakette', 'stammnummer',
                                'remarks', 'bemerkung', 'anbringungsort',
                                'locationof', 'locof', 'crypt', 'businessid',
                                'manufacturername', '10 hersteller']):
        return False
    if VIN_RE.search(value) or '@' in value:
        return False
    if dataset == 'edatenblatt':
        if field in {'LastModified', '0.11. DateOfManufactureVeh'}:
            return False
        # CoC technical sections and national structured classifications only.
        m = re.match(r'^(\d+)\.', field)
        return bool((m and 1 <= int(m.group(1)) <= 51) or field.startswith(('N1 ', 'N4 ', 'N8 ', 'N9 ')))
    if dataset == 'tas':
        # Legal/type identity dates are intentionally retained as dates, never
        # interpreted as production/model years.
        if any(x in lower for x in ['reasonof', 'changingpositions', 'goodtoprint',
                                    'techtypeadditionalinformation', 'placeofmanufacture']):
            return False
        return True
    if dataset == 'targa':
        return bool(re.match(r'^\d{2} ', field) or field in {
            'Typengenehmigung erteilt', 'gültig für Importdatum bis', 'Erweiterung TG vom:',
        })
    return False


def decoded_values(facts, dataset):
    values = {}
    ch = facts['fuelCodeCH'].upper()
    fuel_kind = FUEL_CH.get(ch)
    hybrid = facts['hybridClass'].upper()
    pure = facts['pureElectric'].upper()
    # Explicit contradictory source classification is not silently repaired.
    contradictory = pure == 'Y' and (hybrid or ch in {'B', 'C', 'D', 'F', 'R'})
    if not contradictory:
        if pure == 'Y':
            fuel_kind = ('electric', 'electric')
        elif hybrid in {'OVC-HEV', 'NOVC-HEV'}:
            # OVC/NOVC only describes external charging. It cannot erase the
            # more specific Swiss R = electric with range extender identity.
            fuel_kind = ('hybrid', 'series_hybrid' if ch == 'R' else 'other_hybrid')
        elif not fuel_kind and dataset == 'edatenblatt' and pure == 'N' and not hybrid:
            code = facts['fuelCode']
            if code in {'10', '11', '12', '13', '14'}:
                fuel_kind = ('petrol', 'combustion')
            elif code in {'20', '21', '23', '24', '25', '26', '27', '81', '82', '83', '84', '85', '86', '87'}:
                fuel_kind = ('diesel', 'combustion')
        if fuel_kind:
            values['fuel'], values['powertrainKind'] = fuel_kind
    for key in NUMERIC_VALUE_FIELDS:
        value = positive(facts.get(key))
        if value is not None:
            values[key] = value
    if contradictory:
        for key in ['icePowerKw', 'motorPeakKw', 'power30MinKw']:
            values.pop(key, None)
    if (values.get('power30MinKw', 0) > values.get('motorPeakKw', 0) > 0):
        # One source can report incompatible component/vehicle powers. Keep
        # both declarations as raw evidence, but do not certify their use.
        values.pop('power30MinKw', None)
    if not contradictory and facts['powerSemantics'] in {'ice_maximum_net', 'electric_maximum_net'}:
        if (power := positive(facts['powerKw'])) is not None:
            values['powerKw'] = power
    if facts['driveCode'].upper() in DIRECT_DRIVES:
        values['drive'] = DIRECT_DRIVES[facts['driveCode'].upper()]
    if dataset == 'edatenblatt' and facts['gearboxCode'] in EU_GEARBOXES:
        values['transmission'] = EU_GEARBOXES[facts['gearboxCode']]
    if facts['bodyworkCode'] in EU_BODIES:
        values['bodyType'] = EU_BODIES[facts['bodyworkCode']]
    if facts['engineCode'] and len(facts['engineCode']) <= 160:
        values['engineCode'] = facts['engineCode']
    return values


def quality_flags(facts):
    flags = []
    if facts['pureElectric'].upper() == 'Y' and (
            facts['hybridClass'] or facts['fuelCodeCH'].upper() in {'B', 'C', 'D', 'F', 'R'}):
        flags.append('contradictory_electric_classification')
    peak, continuous = positive(facts.get('motorPeakKw')), positive(facts.get('power30MinKw'))
    if peak and continuous and continuous > peak:
        flags.append('continuous_power_exceeds_declared_electric_maximum')
    return flags


def normalize_row(dataset, row):
    facts = dict.fromkeys(FACT_KEYS, '')
    fields = {'edatenblatt': ED_FIELDS, 'tas': TAS_FIELDS, 'targa': TARGA_FIELDS}[dataset]
    facts.update({key: clean(row.get(field)) for key, field in fields.items()})
    used = set(fields.values())
    if dataset == 'edatenblatt':
        if facts['pureElectric'] == 'Y':
            facts['powerKw'] = facts['motorPeakKw']
            facts['powerSemantics'] = 'electric_maximum_net'
        elif not facts['hybridClass'] and facts['fuelCodeCH'] not in {'C', 'F', 'R', 'X'}:
            facts['powerKw'] = facts['icePowerKw']
            facts['powerSemantics'] = 'ice_maximum_net' if facts['powerKw'] else ''
        else:
            facts['powerSemantics'] = 'ice_and_electric_separate_no_system_power'
    elif dataset == 'tas':
        facts['offVehicleCharging'] = clean(row.get('offVehicleChargingIndex'))
        facts['bodyworkCodeCH'] = clean(row.get('chVehicleBodyFormCode'))
        facts['vehicleTypeCH'] = clean(row.get('chVehicleType'))
        facts['engineType'] = clean(row.get('engineType'))
        facts['grossVehicleWeightKg'] = scalar_from_range(
            row.get('technicallyPermissibleMaximumLadenMassMinimum'),
            row.get('technicallyPermissibleMaximumLadenMassMaximum'))
        gearbox = sorted({clean(row.get(f'gearboxEmissions{i}.chGearboxType')) for i in range(1, 5)} - {''})
        facts['gearboxCodeCH'] = gearbox[0] if len(gearbox) == 1 else ''
        if facts['fuelCodeCH'] == 'E':
            facts['pureElectric'] = 'Y'
            facts['motorPeakKw'] = facts['powerKw']
            facts['powerSemantics'] = 'electric_maximum_net'
        elif facts['fuelCodeCH'] in {'B', 'D', 'L', 'N'}:
            facts['icePowerKw'] = facts['powerKw']
            facts['powerSemantics'] = 'ice_maximum_net'
        else:
            facts['powerSemantics'] = 'declared_motor_power_unspecified_component'
    else:
        raw_type = clean(row.get('05 Typ; Variante/Version'))
        facts['type'], facts['variant'], facts['version'] = technical_type(raw_type)
        facts['typeVariantVersionRaw'] = raw_type
        facts['bodyworkCodeCH'] = clean(row.get('07 Karosserieform Code'))
        facts['vehicleTypeCH'] = clean(row.get('01 Fahrzeugart'))
        facts['engineType'] = clean(row.get('25 Motor Typ'))
        facts['grossVehicleWeightKg'] = scalar_from_range(
            row.get('53 Garantiegewicht von'), row.get('53 Garantiegewicht bis'))
        gearbox = sorted({clean(row.get(f'18 Getriebe {i}')) for i in range(1, 5)} - {''})
        facts['gearboxCodeCH'] = gearbox[0] if len(gearbox) == 1 else ''
        # TARGA calls this only Leistung kW. Never reinterpret EV/hybrid registry
        # power as either a certified 30-minute or marketing/system maximum.
        if facts['fuelCodeCH'] in {'B', 'D', 'L', 'N'}:
            facts['icePowerKw'] = facts['powerKw']
            facts['powerSemantics'] = 'ice_maximum_net'
        else:
            facts['powerSemantics'] = 'declared_motor_power_unspecified_component'
        if facts['fuelCodeCH'] == 'E':
            facts['pureElectric'] = 'Y'
    extra = {field: clean(value) for field, value in row.items()
             if field not in used and safe_extra(dataset, field, value)}
    # sourceRecordIds identify approvals, never individual vehicles.
    record_id = facts['approvalCH'] or '|'.join(facts[k] for k in ['approval', 'type', 'variant', 'version'])
    years = []
    if dataset == 'edatenblatt' and (year := manufacture_year(row.get('0.11. DateOfManufactureVeh'))):
        years.append(year)
    return {
        'facts': facts, 'values': decoded_values(facts, dataset),
        'qualityFlags': quality_flags(facts),
        'additionalFacts': extra, 'manufactureYears': years,
        'sourceRecordIds': [record_id] if record_id.strip('|') else [],
    }


def iter_rows(path, dataset):
    info = SOURCE_INFO[dataset]
    csv.field_size_limit(16 * 1024 * 1024)
    with Path(path).open(encoding=info['encoding'], errors='strict', newline='') as f:
        reader = csv.reader(f, delimiter=info['delimiter'], strict=True,
                            quoting=info.get('quoting', csv.QUOTE_MINIMAL))
        header = next(reader, None)
        if not header or not REQUIRED[dataset].issubset(header):
            missing = sorted(REQUIRED[dataset] - set(header or []))
            raise ValueError('source_schema_changed:' + dataset + ':' + ','.join(missing))
        named = [h for h in header if h]
        if len(named) != len(set(named)):
            raise ValueError('duplicate_named_header:' + dataset)
        for number, values in enumerate(reader, 1):
            if not values:
                continue
            # The official TG text has one extra unnamed trailing header cell.
            if len(values) < len(header) and not any(header[len(values):]):
                values += [''] * (len(header) - len(values))
            if len(values) != len(header):
                raise ValueError(f'malformed_row:{dataset}:{number}:columns={len(values)}/{len(header)}')
            yield number, {k: v for k, v in zip(header, values) if k}


class DetailWriter:
    """Stream supplemental observations without expanding core variants."""
    def __init__(self, directory, shard_size):
        self.directory = Path(directory)
        (self.directory / 'details').mkdir(parents=True, exist_ok=True)
        self.shard_size = shard_size
        self.files, self.handle, self.current = [], None, None
        self.raw_handle = None

    def close_current(self):
        if not self.handle:
            return
        self.handle.close()
        self.handle = None
        self.raw_handle.close()
        self.raw_handle = None
        final = self.directory / self.current['path']
        (self.directory / (self.current['path'] + '.tmp')).rename(final)
        self.current.update({'bytes': final.stat().st_size, 'sha256': sha_file(final)})
        self.files.append(self.current)

    def write(self, record):
        if self.handle is None or self.current['rows'] >= self.shard_size:
            self.close_current()
            filename = f'details/technical-{len(self.files) + 1:05d}.jsonl.gz'
            self.raw_handle = (self.directory / (filename + '.tmp')).open('wb')
            # No filename or wall clock in gzip metadata: identical normalized
            # rows produce identical compressed bytes on every reproducible run.
            compressed = gzip.GzipFile(filename='', mode='wb', compresslevel=6,
                                       fileobj=self.raw_handle, mtime=0)
            self.handle = io.TextIOWrapper(compressed, encoding='utf-8', newline='\n')
            self.current = {'path': filename, 'rows': 0, 'sourceRows': 0,
                            'format': 'astra-technical-details-jsonl-gzip-v1'}
        self.handle.write(stable(record) + '\n')
        self.current['rows'] += 1
        self.current['sourceRows'] += record['sourceRows']
        return self.current['path']


def normalize_sources(sources, output_dir, shard_size=1000, expected_shas=None):
    """sources is a list of (dataset, path, advertised_bytes). No network calls."""
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'manifest.json').exists():
        raise ValueError('output_manifest_exists_choose_new_directory')
    if not 1 <= shard_size <= 10000:
        raise ValueError('invalid_shard_size')
    expected_shas = expected_shas or {}
    seen = set()
    checked = []
    for dataset, path, expected_bytes in sources:
        if dataset not in SOURCE_INFO or dataset in seen:
            raise ValueError('unknown_or_duplicate_dataset:' + dataset)
        seen.add(dataset)
        path, expected_bytes = Path(path), int(expected_bytes)
        before = path.stat()
        if before.st_size != expected_bytes or expected_bytes <= 0:
            raise ValueError('incomplete_or_changed_source_length:' + dataset)
        sha = sha_file(path)
        if expected_shas.get(dataset) and sha != expected_shas[dataset]:
            raise ValueError('source_sha_mismatch:' + dataset)
        checked.append((dataset, path, before, sha))
    # SQLite is disposable aggregation, not a deliverable. Use OS scratch to
    # prevent large in-place database writes from creating workspace snapshots.
    temp_db = tempfile.NamedTemporaryFile(prefix='astra-normalize-', suffix='.sqlite', delete=False)
    db_path = Path(temp_db.name)
    temp_db.close()
    db = sqlite3.connect(db_path)
    db.execute('PRAGMA journal_mode=OFF')
    db.execute('PRAGMA synchronous=OFF')
    db.execute('PRAGMA temp_store=FILE')
    db.execute('PRAGMA cache_size=-32768')
    db.execute('CREATE TABLE records (id TEXT PRIMARY KEY, dataset TEXT, make TEXT, payload TEXT, source_rows INTEGER) WITHOUT ROWID')
    db.execute('CREATE TABLE years (id TEXT, year INTEGER, PRIMARY KEY(id,year)) WITHOUT ROWID')
    db.execute('CREATE TABLE details (id TEXT PRIMARY KEY, parent_id TEXT, payload TEXT, source_rows INTEGER) WITHOUT ROWID')
    db.execute('CREATE TABLE detail_years (id TEXT, year INTEGER, PRIMARY KEY(id,year)) WITHOUT ROWID')
    db.execute('CREATE INDEX by_make ON records(dataset,make,id)')
    db.execute('CREATE INDEX details_by_parent ON details(parent_id,id)')
    manifest = {
        'version': 1, 'format': 'astra-technical-evidence-jsonl-v1',
        'status': 'source_evidence_only_not_catalog_matched',
        'sourceRows': 0, 'technicalGroups': 0, 'sources': [], 'shards': [],
        'qualityFlagGroups': {},
        'modelYearsInferred': False, 'individualVehicleIdentifiersIncluded': False,
        'power30MinDerivedFromPeak': False,
    }
    try:
        for dataset, path, before, source_sha in checked:
            counts, makes, count = collections.Counter(), collections.Counter(), 0
            for number, row in iter_rows(path, dataset):
                count += 1
                normalized = normalize_row(dataset, row)
                years = normalized.pop('manufactureYears')
                additional = normalized.pop('additionalFacts')
                facts = normalized['facts']
                # Core calculation facts determine the technical group. Tyre,
                # dimension and consumption observations remain lossless in
                # separately sharded evidence, not artificial catalog variants.
                identity = stable({'dataset': dataset, 'facts': facts})
                evidence_id = hashlib.sha256(identity.encode('utf-8')).hexdigest()
                normalized.update({
                    'evidenceId': evidence_id, 'sourceDataset': dataset,
                    'sourceUrl': SOURCE_INFO[dataset]['url'], 'schemaUrl': SOURCE_INFO[dataset]['schema'],
                    'sourceSha256': source_sha,
                    # A populated raw field is not usable evidence when source
                    # classifications/powers conflict and decoded_values held it.
                    'certified30Min': bool(normalized['values'].get('power30MinKw')) and dataset in {'edatenblatt', 'tas'},
                })
                db.execute('INSERT INTO records VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET source_rows=source_rows+1',
                           (evidence_id, dataset, facts['make'], stable(normalized)))
                detail_id = hashlib.sha256(stable({'parentEvidenceId': evidence_id, 'additionalFacts': additional}).encode('utf-8')).hexdigest()
                db.execute('INSERT INTO details VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET source_rows=source_rows+1',
                           (detail_id, evidence_id, stable(additional)))
                if years:
                    db.executemany('INSERT OR IGNORE INTO years VALUES (?,?)', [(evidence_id, y) for y in years])
                    db.executemany('INSERT OR IGNORE INTO detail_years VALUES (?,?)', [(detail_id, y) for y in years])
                makes[facts['make']] += 1
                counts['withExplicit30Min'] += int(bool(positive(facts['power30MinKw'])))
                counts['passengerOrLightCategories'] += int(facts['category'].upper() in {'M1', 'M1G', 'M1S', 'M1GS', 'N1', 'N1G'})
                counts['withoutApprovalIdentity'] += int(not facts['approvalCH'] and not facts['approval'])
                if count % 5000 == 0:
                    db.commit()
                if count % 100000 == 0:
                    print(json.dumps({'dataset': dataset, 'processedRows': count}), file=sys.stderr, flush=True)
            db.commit()
            after = path.stat()
            if (after.st_size, after.st_mtime_ns, after.st_ino) != (before.st_size, before.st_mtime_ns, before.st_ino):
                raise ValueError('source_changed_during_read:' + dataset)
            groups = db.execute('SELECT COUNT(*) FROM records WHERE dataset=?', (dataset,)).fetchone()[0]
            manifest['sourceRows'] += count
            manifest['technicalGroups'] += groups
            manifest['sources'].append({
                'sourceDataset': dataset, 'sourceUrl': SOURCE_INFO[dataset]['url'],
                'schemaUrl': SOURCE_INFO[dataset]['schema'], 'sourceBytes': before.st_size,
                'sourceSha256': source_sha, 'sourceRows': count, 'technicalGroups': groups,
                'dataset': dataset, 'url': SOURCE_INFO[dataset]['url'],
                'sha256': source_sha, 'bytes': before.st_size,
                'makes': dict(sorted(makes.items())), 'rowCounts': dict(counts),
            })
        # Stable, bounded shards. Source files and this manifest authenticate
        # every record without shipping raw archives through public git.
        shard_number, handle, shard = 0, None, None
        detail_writer = DetailWriter(output, shard_size)
        previous_scope = None
        try:
            for evidence_id, dataset, make, payload, source_rows in db.execute('SELECT id,dataset,make,payload,source_rows FROM records ORDER BY dataset,make,id'):
                scope = (dataset, make)
                if handle is None or shard['recordCount'] >= shard_size or scope != previous_scope:
                    if handle:
                        handle.close()
                        final = output / shard['path']
                        (output / (shard['path'] + '.tmp')).rename(final)
                        shard['bytes'], shard['sha256'] = final.stat().st_size, sha_file(final)
                        manifest['shards'].append(shard)
                    shard_number += 1
                    filename = f'{dataset}-{shard_number:05d}.jsonl'
                    handle = (output / (filename + '.tmp')).open('w', encoding='utf-8', newline='\n')
                    shard = {'path': filename, 'sourceDataset': dataset, 'make': make, 'recordCount': 0, 'sourceRows': 0}
                record = json.loads(payload)
                for flag in record['qualityFlags']:
                    manifest['qualityFlagGroups'][flag] = manifest['qualityFlagGroups'].get(flag, 0) + 1
                record['sourceRows'] = source_rows
                record['manufactureYears'] = [r[0] for r in db.execute('SELECT year FROM years WHERE id=? ORDER BY year', (evidence_id,))]
                common, detail_paths, observations = None, set(), 0
                for detail_id, additional_json, detail_source_rows in db.execute('SELECT id,payload,source_rows FROM details WHERE parent_id=? ORDER BY id', (evidence_id,)):
                    additional = json.loads(additional_json)
                    if common is None:
                        common = dict(additional)
                    else:
                        common = {key: value for key, value in common.items() if additional.get(key) == value}
                    detail = {
                        'evidenceId': detail_id, 'parentEvidenceId': evidence_id,
                        'sourceDataset': dataset, 'sourceUrl': record['sourceUrl'],
                        'sourceSha256': record['sourceSha256'], 'sourceRows': detail_source_rows,
                        'additionalFacts': additional,
                        'manufactureYears': [r[0] for r in db.execute('SELECT year FROM detail_years WHERE id=? ORDER BY year', (detail_id,))],
                    }
                    detail_paths.add(detail_writer.write(detail))
                    observations += 1
                record['additionalFacts'] = common or {}
                record['additionalFactsRef'] = {'parentEvidenceId': evidence_id, 'files': sorted(detail_paths), 'observations': observations}
                handle.write(stable(record) + '\n')
                shard['recordCount'] += 1
                shard['sourceRows'] += source_rows
                previous_scope = scope
            if handle:
                handle.close()
                handle = None
                final = output / shard['path']
                (output / (shard['path'] + '.tmp')).rename(final)
                shard['bytes'], shard['sha256'] = final.stat().st_size, sha_file(final)
                manifest['shards'].append(shard)
        finally:
            if handle:
                handle.close()
            detail_writer.close_current()
        manifest['detailFiles'] = detail_writer.files
        manifest['technicalDetailGroups'] = db.execute('SELECT COUNT(*) FROM details').fetchone()[0]
        if sum(s['recordCount'] for s in manifest['shards']) != manifest['technicalGroups']:
            raise ValueError('shard_record_count_mismatch')
        if sum(s['sourceRows'] for s in manifest['shards']) != manifest['sourceRows']:
            raise ValueError('shard_source_row_count_mismatch')
        if sum(s['rows'] for s in manifest['detailFiles']) != manifest['technicalDetailGroups']:
            raise ValueError('detail_record_count_mismatch')
        if sum(s['sourceRows'] for s in manifest['detailFiles']) != manifest['sourceRows']:
            raise ValueError('detail_source_row_count_mismatch')
        manifest['files'] = [dict(s, rows=s['recordCount']) for s in manifest['shards']]
        manifest['complete'] = True
        manifest['manifestDigest'] = hashlib.sha256(stable(manifest).encode('utf-8')).hexdigest()
        temp_manifest = output / 'manifest.json.tmp'
        temp_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temp_manifest.rename(output / 'manifest.json')
    finally:
        db.close()
        # Disposable data can always be regenerated from authenticated inputs.
        db_path.unlink(missing_ok=True)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', nargs=3, action='append', metavar=('DATASET', 'PATH', 'EXPECTED_BYTES'), required=True)
    parser.add_argument('--expected-sha', action='append', default=[], metavar='DATASET=SHA256')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--shard-size', type=int, default=1000)
    args = parser.parse_args()
    shas = {}
    for item in args.expected_sha:
        dataset, sep, sha = item.partition('=')
        if not sep or dataset not in SOURCE_INFO or not re.fullmatch(r'[a-f0-9]{64}', sha):
            parser.error('invalid --expected-sha; use DATASET=64_lowercase_hex_characters')
        shas[dataset] = sha
    manifest = normalize_sources(args.source, args.output_dir, args.shard_size, shas)
    print(json.dumps({k: manifest[k] for k in ['complete', 'sourceRows', 'technicalGroups', 'manifestDigest']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
