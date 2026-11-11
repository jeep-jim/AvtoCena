#!/usr/bin/env python3
"""Run the owner's explicit, pinned ASTRA import using existing private storage."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

CORE_PATHS = {
    'edatenblatt': '3000-eDatenblatt/eDatenblatt.csv',
    'tas': '4000-Typengenehmigungen_TAS/4300-Datensaetze/TAS_Automobil.csv',
    'targa': '2000-Typengenehmigungen_TG_TARGA/2200-Basisdaten_TG_ab_1995/TG-Automobil.txt',
}


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read_request(marker_path):
    marker = json.loads(Path(marker_path).read_text())
    if marker.get('mode') not in ('preview', 'apply'):
        raise ValueError('astra_import_mode_required')
    plan_path = marker.get('sourcePlan', '')
    if not re.fullmatch(r'docs/encyclopedia/astra/source-plan-\d{4}-\d{2}-\d{2}\.json', plan_path):
        raise ValueError('invalid_astra_source_plan_path')
    if not re.fullmatch(r'[a-f0-9]{64}', marker.get('sourcePlanSha256', '')) or sha(plan_path) != marker['sourcePlanSha256']:
        raise ValueError('astra_source_plan_checksum_mismatch')
    plan = json.loads(Path(plan_path).read_text())
    sources = plan if isinstance(plan, list) else plan['sources']
    if not sources or len({s['path'] for s in sources}) != len(sources):
        raise ValueError('invalid_astra_source_plan')
    if any(not re.fullmatch(r'[a-f0-9]{64}', s.get('sha256', '')) for s in sources):
        raise ValueError('every_astra_source_requires_reviewed_checksum')
    if marker['mode'] == 'apply' and not re.fullmatch(r'[a-f0-9]{64}', marker.get('expectedPlanDigest', '')):
        raise ValueError('reviewed_astra_plan_digest_required')
    return marker, sources


def check_downloads(sources, downloaded, archive):
    planned = {s['path']: s for s in sources}
    if (not isinstance(downloaded, list) or len(downloaded) != len(planned)
            or {s['path'] for s in downloaded} != set(planned)
            or not archive.get('complete') or len(archive.get('sources', [])) != len(planned)):
        raise ValueError('astra_source_corpus_incomplete')
    archived = {s['path']: s for s in archive['sources']}
    for actual in downloaded:
        source = planned[actual['path']]
        saved = archived.get(actual['path'], {})
        if not actual.get('complete') or not saved.get('verified'):
            raise ValueError('astra_source_not_verified')
        for field in ('url', 'path', 'bytes', 'sha256'):
            if source[field] != actual.get(field) or source[field] != saved.get(field):
                raise ValueError('astra_source_differs_from_pinned_plan:' + field)
    if archive['verifiedBytes'] != sum(s['bytes'] for s in sources):
        raise ValueError('astra_archive_byte_count_mismatch')


def run(command):
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--marker', default='.github/market-runs/encyclopedia-astra-import.json')
    parser.add_argument('--root', required=True)
    parser.add_argument('--reports', default='reports')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    marker, sources = read_request(args.marker)
    print(json.dumps({'stage': 'astra_request_verified', 'mode': marker['mode'],
        'sourceCount': len(sources), 'sourcePlanSha256': marker['sourcePlanSha256']}), flush=True)
    if args.check:
        return
    reports, root = Path(args.reports).resolve(), Path(args.root).resolve()
    reports.mkdir(parents=True, exist_ok=True)
    root.mkdir(parents=True, exist_ok=True)
    if marker['mode'] == 'apply':
        run(['node', '--import', 'tsx', 'scripts/encyclopedia/apply-astra-corpus.mjs',
             '--mode', 'apply', '--expected-plan-digest', marker['expectedPlanDigest'], '--reports', str(reports)])
        return
    archive_path = reports / 'astra-source-archive.json'
    run([sys.executable, 'scripts/encyclopedia/archive-astra-sources.py',
         '--plan', marker['sourcePlan'], '--output-root', str(root), '--workers', '4', '--report', str(archive_path)])
    downloads_path = root / 'download_manifest.json'
    downloaded = json.loads(downloads_path.read_text())
    archive = json.loads(archive_path.read_text())
    check_downloads(sources, downloaded, archive)
    if archive.get('sourcePlanSha256') != marker['sourcePlanSha256']:
        raise ValueError('astra_archived_plan_mismatch')
    shutil.copyfile(downloads_path, reports / 'astra-download-manifest.json')
    by_path = {s['path']: s for s in downloaded}
    command = [sys.executable, 'scripts/encyclopedia/extract-astra-bulk.py']
    for dataset, relative in CORE_PATHS.items():
        source = by_path[relative]
        command.extend(['--source', dataset, str(root / 'raw' / relative), str(source['bytes']),
                        '--expected-sha', dataset + '=' + source['sha256']])
    corpus = root / 'corpus'
    command.extend(['--output-dir', str(corpus), '--shard-size', '1000'])
    run(command)
    manifest = corpus / 'manifest.json'
    run([sys.executable, 'scripts/encyclopedia/extract-astra-supplements.py',
         '--manifest', str(manifest), '--downloads', str(downloads_path), '--raw-root', str(root / 'raw'),
         '--report', str(reports / 'astra-supplements.json')])
    shutil.copyfile(manifest, reports / 'astra-input-manifest.json')
    run(['node', '--import', 'tsx', 'scripts/encyclopedia/apply-astra-corpus.mjs',
         '--mode', 'preview', '--manifest', str(manifest), '--reports', str(reports)])


if __name__ == '__main__':
    main()
