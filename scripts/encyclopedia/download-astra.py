#!/usr/bin/env python3
"""Download a pinned ASTRA source plan into a temporary raw corpus.

Uses at most four concurrent HTTP ranges, validates every range and final SHA256,
and resumes only chunks identified by the exact URL, ETag, and object length.
The output is a source corpus, never a catalog update or publication decision.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.parse
import urllib.request

BASE_URL = 'https://opendata.astra.admin.ch/ivzod/'
CHUNK_BYTES = 8 * 1024 * 1024


def checked_url(url):
    value = urllib.parse.urlsplit(url)
    decoded = urllib.parse.unquote(value.path)
    if (value.scheme != 'https' or value.netloc != 'opendata.astra.admin.ch'
            or value.username or value.password or value.query or value.fragment
            or not decoded.startswith('/ivzod/') or '\\' in decoded
            or any(part in ('.', '..') for part in decoded.split('/'))
            or '\x00' in decoded):
        raise ValueError('invalid_astra_source_url')
    return url


class AstraRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        checked_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def request(url, **kwargs):
    checked_url(url)
    opener = urllib.request.build_opener(AstraRedirectHandler())
    return opener.open(urllib.request.Request(url, **kwargs), timeout=90)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for data in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(data)
    return digest.hexdigest()


def validate_source(source):
    url = checked_url(source['url'])
    path = source['path']
    if (not path or Path(path).is_absolute() or '..' in Path(path).parts
            or '\\' in path or '\x00' in path
            or urllib.parse.unquote(urllib.parse.urlsplit(url).path) != '/ivzod/' + path):
        raise ValueError('invalid_astra_source_path')
    if not isinstance(source.get('bytes'), int) or source['bytes'] <= 0:
        raise ValueError('source_length_required')
    if not source.get('etag') and not source.get('sha256'):
        raise ValueError('pinned_etag_or_checksum_required')
    digest = source.get('sha256')
    if digest and (len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest)):
        raise ValueError('invalid_source_checksum')
    return source


def get_metadata(source):
    validate_source(source)
    with request(source['url'], method='HEAD') as response:
        observed = {'bytes': int(response.headers['Content-Length']),
                    'etag': response.headers.get('ETag'),
                    'last_modified': response.headers.get('Last-Modified')}
    for key in ('bytes', 'etag', 'last_modified'):
        if source.get(key) is not None and source[key] != observed[key]:
            raise ValueError(f'official_source_changed:{source["path"]}:{key}')
    return {**source, **observed}


def part_directory(source, output_root):
    identity = json.dumps([source['url'], source['etag'], source['bytes']], separators=(',', ':'))
    return output_root / '.parts' / hashlib.sha256(identity.encode()).hexdigest()


def download_part(task):
    source, part_root, index = task
    path = part_root / f'{index:06d}.part'
    start = index * CHUNK_BYTES
    end = min(start + CHUNK_BYTES, source['bytes']) - 1
    required = end - start + 1
    if path.exists() and path.stat().st_size > required:
        raise ValueError('oversized_resumable_part')
    for attempt in range(5):
        offset = path.stat().st_size if path.exists() else 0
        if offset == required:
            return required
        headers = {'Range': f'bytes={start + offset}-{end}', 'Accept-Encoding': 'identity'}
        if source.get('etag'):
            headers['If-Range'] = source['etag']
        try:
            with request(source['url'], headers=headers) as response:
                expected = f'bytes {start + offset}-{end}/{source["bytes"]}'
                if response.status != 206 or response.headers.get('Content-Range') != expected:
                    raise ValueError('source_range_mismatch')
                if source.get('etag') and response.headers.get('ETag') != source['etag']:
                    raise ValueError('source_etag_changed_during_download')
                with path.open('ab') as target:
                    while data := response.read(256 * 1024):
                        target.write(data)
            if path.stat().st_size != required:
                raise ValueError('incomplete_source_range')
            return required
        except ValueError:
            raise
        except Exception:
            if attempt == 4:
                raise
            time.sleep(min(2 ** attempt, 8))


def download(source, output_root, workers=4):
    raw_root = (output_root / 'raw').resolve()
    target = (raw_root / source['path']).resolve()
    if not target.is_relative_to(raw_root):
        raise ValueError('source_outside_raw_root')
    target.parent.mkdir(parents=True, exist_ok=True)
    # A complete local file is reusable only with a pinned checksum.
    if target.exists() and target.stat().st_size == source['bytes'] and source.get('sha256'):
        digest = sha256(target)
        if digest != source['sha256']:
            raise ValueError('existing_source_checksum_mismatch')
        return {**source, 'sha256': digest, 'complete': True, 'local_path': str(target), 'reused': True}
    part_root = part_directory(source, output_root)
    part_root.mkdir(parents=True, exist_ok=True)
    count = (source['bytes'] + CHUNK_BYTES - 1) // CHUNK_BYTES
    done = 0
    last_log = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for size in pool.map(download_part, ((source, part_root, i) for i in range(count))):
            done += size
            if time.monotonic() - last_log > 30 or done == source['bytes']:
                print(json.dumps({'stage': 'astra_download', 'path': source['path'],
                                  'completedBytes': done, 'totalBytes': source['bytes']}), flush=True)
                last_log = time.monotonic()
    assembled = target.with_name(target.name + '.assembling')
    with assembled.open('wb') as output:
        for index in range(count):
            with (part_root / f'{index:06d}.part').open('rb') as part:
                shutil.copyfileobj(part, output)
    if assembled.stat().st_size != source['bytes']:
        raise ValueError('assembled_source_length_mismatch')
    digest = sha256(assembled)
    if source.get('sha256') and digest != source['sha256']:
        raise ValueError('downloaded_source_checksum_mismatch')
    os.replace(assembled, target)
    shutil.rmtree(part_root)
    return {**source, 'sha256': digest, 'complete': True, 'local_path': str(target), 'reused': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', help='Pinned source-plan JSON')
    parser.add_argument('--output-root', required=True, help='Temporary corpus root; contains raw/')
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    parser.add_argument('--manifest', help='Output verified manifest; defaults to output-root/download_manifest.json')
    args = parser.parse_args()
    plan_bytes = Path(args.plan).read_bytes()
    plan = json.loads(plan_bytes)
    plan_digest = hashlib.sha256(plan_bytes).hexdigest()
    sources = plan if isinstance(plan, list) else plan['sources']
    if not sources:
        raise ValueError('empty_source_plan')
    if len({source['path'] for source in sources}) != len(sources):
        raise ValueError('duplicate_source_paths')
    for source in sources:
        validate_source(source)
    output_root = Path(args.output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    manifest = Path(args.manifest) if args.manifest else output_root / 'download_manifest.json'
    manifest.parent.mkdir(parents=True, exist_ok=True)
    completion = output_root / 'download_complete.json'
    if completion.exists():
        completion.unlink()
    results = []
    for source in sources:
        result = download(get_metadata(source), output_root, args.workers)
        results.append(result)
        temporary = manifest.with_name(manifest.name + '.tmp')
        temporary.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
        os.replace(temporary, manifest)
        print(json.dumps({'stage': 'astra_source_verified', 'path': result['path'],
                          'bytes': result['bytes'], 'sha256': result['sha256']}), flush=True)
    completion.write_text(json.dumps({
        'complete': True,
        'source_plan_sha256': plan_digest,
        'manifest_sha256': sha256(manifest),
        'source_count': len(results),
        'verified_bytes': sum(source['bytes'] for source in results),
        'paths': [source['path'] for source in results],
    }, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
