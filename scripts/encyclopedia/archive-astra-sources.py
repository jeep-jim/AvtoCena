#!/usr/bin/env python3
"""Archive verified public ASTRA source files in the existing private REG bucket.

Content-addressed keys allow safe reuse after an interrupted import. No bucket
permissions, publication pointers, production disk, or credentials are changed.
"""
import argparse
import hashlib
import importlib.util
import json
import mimetypes
import os
import re
from pathlib import Path

_DOWNLOADER = None


def get_downloader():
    global _DOWNLOADER
    if _DOWNLOADER is None:
        spec = importlib.util.spec_from_file_location(
            'astra_downloader', Path(__file__).with_name('download-astra.py'))
        _DOWNLOADER = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_DOWNLOADER)
    return _DOWNLOADER


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def sha256(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def checked_source(source, raw_root):
    get_downloader().validate_source(source)
    digest = source.get('sha256', '')
    if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('source_checksum_missing')
    relative = source.get('path', '')
    if not relative or Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise ValueError('invalid_source_path')
    raw_root = raw_root.resolve()
    path = (raw_root / relative).resolve()
    if not path.is_relative_to(raw_root):
        raise ValueError('source_outside_raw_root')
    if not source.get('complete') or path.stat().st_size != source['bytes']:
        raise ValueError('incomplete_source')
    if sha256(path) != digest:
        raise ValueError('source_checksum_mismatch')
    return path, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--manifest')
    mode.add_argument('--plan', help='Download or restore each source and archive it immediately')
    parser.add_argument('--raw-root')
    parser.add_argument('--output-root')
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    parser.add_argument('--report', default='reports/astra-source-archive.json')
    args = parser.parse_args()
    target = Path(args.report)
    # A failed first request must not leave a stale success receipt behind.
    write_json(target, {'version': 1, 'complete': False, 'status': 'starting',
                        'sources': [], 'verifiedBytes': 0})
    if args.plan and args.output_root:
        prior_completion = Path(args.output_root) / 'download_complete.json'
        if prior_completion.exists():
            prior_completion.unlink()
    import boto3
    from boto3.s3.transfer import TransferConfig
    from botocore.config import Config
    from botocore.exceptions import ClientError

    endpoint = os.environ['YC_OBJECT_STORAGE_ENDPOINT'].rstrip('/')
    if endpoint != 'https://s3.regru.cloud' or os.environ.get('JSON_STORAGE_DRIVER') != 'object':
        raise ValueError('existing_reg_object_storage_required')
    bucket = os.environ['YC_OBJECT_STORAGE_BUCKET']
    prefix = os.environ['YC_OBJECT_STORAGE_PREFIX'].strip('/')
    if not bucket or not prefix or '..' in prefix.split('/'):
        raise ValueError('invalid_storage_scope')
    client = boto3.client('s3', endpoint_url=endpoint,
        region_name=os.environ['YC_OBJECT_STORAGE_REGION'],
        aws_access_key_id=os.environ['YC_OBJECT_STORAGE_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'],
        config=Config(connect_timeout=15, read_timeout=120,
            retries={'max_attempts': 3, 'mode': 'standard'},
            s3={'addressing_style': 'path'}))
    transfer = TransferConfig(multipart_threshold=64 * 1024 * 1024,
        multipart_chunksize=16 * 1024 * 1024, max_concurrency=3)
    downloader = get_downloader()
    plan_digest = None
    if args.plan:
        if not args.output_root or args.raw_root:
            parser.error('--plan requires --output-root and no --raw-root')
        output_root = Path(args.output_root).resolve()
        output_root.mkdir(parents=True, exist_ok=True)
        raw_root = output_root / 'raw'
        plan_bytes = Path(args.plan).read_bytes()
        plan_digest = hashlib.sha256(plan_bytes).hexdigest()
        plan = json.loads(plan_bytes)
        sources = plan if isinstance(plan, list) else plan['sources']
    else:
        if not args.raw_root:
            parser.error('--manifest requires --raw-root')
        manifest = json.loads(Path(args.manifest).read_text())
        sources = manifest if isinstance(manifest, list) else manifest['files']
        raw_root = Path(args.raw_root).resolve()
    if not sources:
        raise ValueError('empty_source_manifest')
    for source in sources:
        downloader.validate_source(source)
    if len({s['path'] for s in sources}) != len(sources):
        raise ValueError('duplicate_source_paths')
    report = {'version': 1, 'complete': False, 'sourcePlanSha256': plan_digest,
              'plannedSourceCount': len(sources),
              'plannedPaths': [s['path'] for s in sources],
              'sources': [], 'verifiedBytes': 0}
    downloaded = []
    write_json(target, report)
    for source in sources:
        receipt_key = None
        if args.plan:
            source = downloader.get_metadata(source)
            receipt_identity = {k: source.get(k) for k in ('url', 'bytes', 'etag', 'last_modified')}
            receipt_digest = hashlib.sha256(json.dumps(receipt_identity, sort_keys=True).encode()).hexdigest()
            receipt_key = f'{prefix}/knowledge/astra/v1/source-receipts/{receipt_digest}.json'
            try:
                response = client.get_object(Bucket=bucket, Key=receipt_key)
                with response['Body'] as body:
                    receipt = json.loads(body.read())
            except ClientError as error:
                if error.response['Error']['Code'] not in ('404', 'NoSuchKey', 'NotFound'):
                    raise
                receipt = None
            if receipt is not None:
                if (not isinstance(receipt, dict) or receipt.get('version') != 1
                        or receipt.get('identity') != receipt_identity
                        or not re.fullmatch(r'[a-f0-9]{64}', receipt.get('sha256', ''))
                        or source.get('sha256') and source['sha256'] != receipt['sha256']):
                    raise ValueError('source_receipt_conflict')
                source = {**source, 'sha256': receipt['sha256']}
                local = (raw_root / source['path']).resolve()
                if not local.is_relative_to(raw_root):
                    raise ValueError('restore_outside_raw_root')
                expected_key = f"knowledge/astra/v1/sources/{source['sha256']}/{local.name}"
                if receipt.get('key') != expected_key:
                    raise ValueError('source_receipt_key_invalid')
                if not local.exists() or local.stat().st_size != source['bytes'] or sha256(local) != source['sha256']:
                    local.parent.mkdir(parents=True, exist_ok=True)
                    part = local.with_name(local.name + '.restoring')
                    client.download_file(bucket, f'{prefix}/{expected_key}', str(part), Config=transfer)
                    if part.stat().st_size != source['bytes'] or sha256(part) != source['sha256']:
                        raise ValueError('restored_source_checksum_mismatch')
                    part.replace(local)
                source = {**source, 'complete': True, 'local_path': str(local), 'restored': True}
            else:
                source = downloader.download(source, output_root, args.workers)
        path, digest = checked_source(source, raw_root)
        relative_key = f'knowledge/astra/v1/sources/{digest}/{path.name}'
        key = f'{prefix}/{relative_key}'
        try:
            head = client.head_object(Bucket=bucket, Key=key)
        except ClientError as error:
            if error.response['Error']['Code'] not in ('404', 'NoSuchKey', 'NotFound'):
                raise
            head = None
        if head is not None and (head['ContentLength'] != source['bytes']
                or head.get('Metadata', {}).get('sha256') != digest):
            raise ValueError('immutable_source_archive_conflict')
        reused = head is not None
        if not reused:
            client.upload_file(str(path), bucket, key, Config=transfer,
                ExtraArgs={'ContentType': mimetypes.guess_type(path.name)[0]
                    or 'application/octet-stream', 'Metadata': {'sha256': digest}})
        confirmed = client.head_object(Bucket=bucket, Key=key)
        if (confirmed['ContentLength'] != source['bytes']
                or confirmed.get('Metadata', {}).get('sha256') != digest):
            raise ValueError('source_archive_verification_failed')
        item = {k: source[k] for k in ('url', 'path', 'bytes', 'sha256')}
        item.update(key=relative_key, reused=reused, verified=True)
        if receipt_key:
            receipt = {'version': 1, 'identity': receipt_identity, 'sha256': digest, 'key': relative_key}
            payload = json.dumps(receipt, sort_keys=True).encode()
            try:
                client.put_object(Bucket=bucket, Key=receipt_key, Body=payload,
                                  ContentType='application/json', IfNoneMatch='*')
            except ClientError as error:
                if error.response['Error']['Code'] not in ('PreconditionFailed', '412'):
                    raise
                prior = client.get_object(Bucket=bucket, Key=receipt_key)
                with prior['Body'] as body:
                    if json.loads(body.read()) != receipt:
                        raise ValueError('immutable_source_receipt_changed')
            downloaded.append(source)
            write_json(output_root / 'download_manifest.json', downloaded)
        report['sources'].append(item)
        report['verifiedBytes'] += source['bytes']
        write_json(target, report)
        print(json.dumps({'stage': 'astra_source_archived', **item}), flush=True)
    report['complete'] = True
    report['sourceCount'] = len(report['sources'])
    if args.plan:
        write_json(output_root / 'download_complete.json', {
            'complete': True, 'source_plan_sha256': plan_digest,
            'manifest_sha256': sha256(output_root / 'download_manifest.json'),
            'source_count': len(downloaded),
            'verified_bytes': sum(s['bytes'] for s in downloaded),
            'paths': [s['path'] for s in downloaded],
        })
    write_json(target, report)


if __name__ == '__main__':
    main()
