#!/usr/bin/env python3
"""Attach all useful ASTRA JSON and auxiliary technical tables to a core corpus.

Approval-level attachments retain gearbox/version selectors. They are references,
not automatic statements about every version or a model year. Source archives
are streamed; no individual vehicle identifiers or free-form remarks are copied.
"""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import re
import zipfile
from pathlib import Path

BASE = 'https://opendata.astra.admin.ch/ivzod/'
PATHS = {
    'tas_json': '4000-Typengenehmigungen_TAS/4200-json-Files-zip/json-Files-20260928.zip',
    'tas_emissions': '4000-Typengenehmigungen_TAS/4300-Datensaetze/TAS_Emission.csv',
    'targa_emissions': '2000-Typengenehmigungen_TG_TARGA/2200-Basisdaten_TG_ab_1995/emissionen.txt',
    'targa_consumption': '2000-Typengenehmigungen_TG_TARGA/2200-Basisdaten_TG_ab_1995/verbrauch.txt',
    'targa_eu_approvals': '2000-Typengenehmigungen_TG_TARGA/2500-Basetables_fuer_Entwickler/2520_Daten/egnr.csv',
    'targa_engine_approvals': '2000-Typengenehmigungen_TG_TARGA/2500-Basetables_fuer_Entwickler/2520_Daten/tarmeg68.csv',
}
PRIVATE_KEY = re.compile(r'^vin$|^chvinprefix$|vehicleidentification|fahrgestell|adress|address|holder|owner|plate|plakette|remarks|bemerk|bemtxt|locationof|anbringung|stammnummer|^createdby$|^businessid$|^id$', re.I)
VIN = re.compile(r'(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])', re.I)
PASSENGER = {'M1', 'M1G', 'M1S', 'M1GS', 'N1', 'N1G'}


def stable(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def sanitize(value):
    if isinstance(value, dict):
        return {str(k): sanitize(v) for k, v in value.items()
                if not PRIVATE_KEY.search(str(k)) and v is not None
                and not (isinstance(v, str) and (VIN.search(v) or '@' in v))}
    if isinstance(value, list):
        return [sanitize(v) for v in value
                if not (isinstance(v, str) and (VIN.search(v) or '@' in v))]
    return value


class Shards:
    def __init__(self, directory, prefix):
        self.directory, self.prefix = Path(directory), prefix
        self.directory.mkdir(parents=True, exist_ok=True)
        self.files, self.file, self.raw_file, self.descriptor = [], None, None, None

    def write(self, value):
        line = (stable(value) + '\n').encode('utf-8')
        if self.file is None or self.descriptor['rows'] >= 500 or self.descriptor['decodedBytes'] + len(line) > 2 * 1024 * 1024:
            self.close()
            name = f'{self.prefix}-{len(self.files) + 1:05d}.jsonl.gz'
            self.raw_file = (self.directory / (name + '.tmp')).open('wb')
            self.file = gzip.GzipFile(filename='', mode='wb', fileobj=self.raw_file, mtime=0, compresslevel=6)
            self.descriptor = {'path': name, 'rows': 0, 'decodedBytes': 0,
                'format': 'astra-technical-supplement-jsonl-gz-v1'}
        self.file.write(line)
        self.descriptor['rows'] += 1
        self.descriptor['decodedBytes'] += len(line)

    def close(self):
        if self.file is None:
            return
        self.file.close()
        self.raw_file.close()
        target = self.directory / self.descriptor['path']
        (self.directory / (self.descriptor['path'] + '.tmp')).replace(target)
        self.descriptor['sha256'] = sha_file(target)
        self.descriptor['bytes'] = target.stat().st_size
        self.files.append(self.descriptor)
        self.file, self.raw_file, self.descriptor = None, None, None


def iter_table(path, dataset):
    developer_table = dataset in {'targa_eu_approvals', 'targa_engine_approvals'}
    encoding = 'utf-8-sig' if dataset == 'tas_emissions' else 'cp1252'
    delimiter = ';' if dataset == 'tas_emissions' or developer_table else '\t'
    quotechar = '¦' if developer_table else '"'
    csv.field_size_limit(16 * 1024 * 1024)
    with path.open(encoding=encoding, newline='') as source:
        reader = csv.DictReader(source, delimiter=delimiter, quotechar=quotechar, strict=True)
        required = 'chTypeApprovalNumber' if dataset == 'tas_emissions' else 'TGCODE' if dataset == 'targa_eu_approvals' else 'MKZEICH' if dataset == 'targa_engine_approvals' else 'TG-Code'
        if required not in (reader.fieldnames or []):
            raise ValueError('supplement_schema_changed:' + dataset)
        for number, row in enumerate(reader, 1):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f'malformed_supplement:{dataset}:{number}')
            yield number, row


def iter_json_archive(path, counters):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        counters['archiveEntries'] = len(entries)
        for entry in entries:
            if entry.is_dir() or not Path(entry.filename).name.startswith('MV_') or not entry.filename.endswith('.json'):
                counters['nonAutomobileArchiveEntries'] += 1
                continue
            if entry.file_size > 32 * 1024 * 1024:
                raise ValueError('unexpectedly_large_type_approval_json')
            with archive.open(entry) as source:
                rows = json.load(source)
            if not isinstance(rows, list):
                raise ValueError('tas_json_schema_changed')
            for row in rows:
                if not isinstance(row, dict) or 'chTypeApprovalNumber' not in row or 'languageCode' not in row:
                    raise ValueError('tas_json_identity_missing')
                if row['languageCode'] != 'de':
                    counters['equivalentOtherLanguageRows'] += 1
                    continue
                counters['sourceRows'] += 1
                if str(row.get('vehicleCategoryCode', '')).upper() not in PASSENGER:
                    counters['outsidePassengerLightScope'] += 1
                    continue
                yield entry.filename, row


def attach_supplements(core_manifest, downloads, raw_root, report_path):
    manifest_path = Path(core_manifest)
    root, raw_root = manifest_path.parent.resolve(), Path(raw_root).resolve()
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('supplementsComplete'):
        raise ValueError('supplements_already_attached')
    sources = downloads if isinstance(downloads, list) else downloads['files']
    by_path = {s['path']: s for s in sources}
    approvals, engines = set(), set()
    for part in manifest['files']:
        with (root / part['path']).open() as source:
            for line in source:
                row = json.loads(line)
                facts = row['facts']
                if str(facts.get('category', '')).upper() not in PASSENGER:
                    continue
                if facts.get('approvalCH'):
                    approvals.add(facts['approvalCH'])
                if facts.get('engineCode'):
                    engines.add(facts['engineCode'].strip().upper())
    report = {'version': 1, 'datasets': {}, 'approvalJoinMode': 'reference_only_preserve_version_and_gearbox_selectors',
              'modelYearsInferred': False, 'supplementValuesPromotedToCalculations': False}
    detail_files = list(manifest.get('detailFiles', []))
    for dataset, relative in PATHS.items():
        if relative not in by_path:
            raise ValueError('required_supplement_missing:' + dataset)
        descriptor = by_path[relative]
        path = (raw_root / relative).resolve()
        if not path.is_relative_to(raw_root) or not descriptor.get('complete') or path.stat().st_size != descriptor['bytes']:
            raise ValueError('incomplete_supplement:' + dataset)
        if sha_file(path) != descriptor['sha256']:
            raise ValueError('supplement_checksum_mismatch:' + dataset)
        counters = collections.Counter()
        output = Shards(root / 'supplements', dataset)
        seen = set()
        iterator = iter_json_archive(path, counters) if dataset == 'tas_json' else iter_table(path, dataset)
        for number, original in iterator:
            if dataset != 'tas_json':
                counters['sourceRows'] += 1
            approval = str(original.get('chTypeApprovalNumber') or original.get('TG-Code') or original.get('TGCODE') or '').strip()
            if approval and approval not in approvals:
                counters['noPassengerCoreApproval'] += 1
                continue
            if not approval:
                if dataset != 'targa_engine_approvals' or str(original.get('MKZEICH', '')).strip().upper() not in engines:
                    counters['noPassengerCoreEngine'] += 1
                    continue
            data = sanitize(original)
            selectors = {key: data[key] for key in ['type', 'variant', 'version', 'versionNo', 'versionDefined',
                'gearboxNumber', 'chGearboxType', 'Getriebe', 'GBEZ', 'MKZEICH', 'MOTORMK', 'MTYP'] if key in data and data[key] not in ('', None)}
            identity = {'dataset': dataset, 'approvalCH': approval, 'selectors': selectors, 'additionalFacts': data}
            evidence_id = hashlib.sha256(stable(identity).encode()).hexdigest()
            if evidence_id in seen:
                counters['duplicateRows'] += 1
                continue
            seen.add(evidence_id)
            output.write({'evidenceId': evidence_id, 'parentApprovalCH': approval or None,
                'selectors': selectors, 'sourceDataset': dataset, 'sourceUrl': descriptor['url'],
                'sourceSha256': descriptor['sha256'], 'sourceRecordId': str(number),
                'additionalFacts': data, 'relationship': 'technical_reference_requires_exact_version_selection'})
            counters['savedRecords'] += 1
        output.close()
        for item in output.files:
            detail_files.append({**item, 'path': 'supplements/' + item['path'], 'sourceDataset': dataset})
        manifest['sources'].append({'sourceDataset': dataset, 'url': descriptor['url'], 'sha256': descriptor['sha256'],
            'bytes': descriptor['bytes'], 'sourceUrl': descriptor['url'], 'sourceSha256': descriptor['sha256'],
            'sourceBytes': descriptor['bytes'], 'sourceRows': counters['sourceRows'], 'role': 'technical_supplement'})
        report['datasets'][dataset] = dict(counters)
        print(json.dumps({'stage': 'astra_supplement_normalized', 'dataset': dataset, **counters}), flush=True)
    manifest['detailFiles'] = detail_files
    manifest['supplementsComplete'] = True
    manifest['supplementSummary'] = report
    manifest.pop('manifestDigest', None)
    manifest['manifestDigest'] = hashlib.sha256(stable(manifest).encode()).hexdigest()
    temporary = manifest_path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(manifest_path)
    target = Path(report_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--downloads', required=True)
    parser.add_argument('--raw-root', required=True)
    parser.add_argument('--report', default='reports/astra-supplements.json')
    args = parser.parse_args()
    attach_supplements(args.manifest, json.loads(Path(args.downloads).read_text()), args.raw_root, args.report)


if __name__ == '__main__':
    main()
