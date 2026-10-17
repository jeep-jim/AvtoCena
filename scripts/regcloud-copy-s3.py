"""Initial/resumable copy only. Source is read-only; no deletion or DNS change."""
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse

TARGET_BUCKET = 'avtocena-staging-8120751'
TARGET_PREFIX = 'migration-staging/full-20261011/'
HEADERS = ['ContentType', 'CacheControl', 'ContentDisposition', 'ContentEncoding', 'ContentLanguage', 'Expires']
MARKER = 'ac-migration-sha256'
SOURCE_TAG = 'ac-migration-source-etag'
SOURCE_TIME = 'ac-migration-source-modified'

class MigrationStop(RuntimeError):
    pass

def require(ok, message):
    if not ok:
        raise MigrationStop(message)

def checksum_stream(body, out=None):
    digest, size = hashlib.sha256(), 0
    try:
        while True:
            chunk = body.read(4 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            if out:
                out.write(chunk)
    finally:
        body.close()
    return digest.hexdigest(), size

def inventory(client, bucket, prefix=''):
    objects, token, seen_tokens = {}, None, set()
    for _ in range(3000):
        args = dict(Bucket=bucket, Prefix=prefix, MaxKeys=1000)
        if token:
            args['ContinuationToken'] = token
        page = client.list_objects_v2(**args)
        for row in page.get('Contents', []):
            require(row['Key'] not in objects, 'Duplicate inventory key')
            require(isinstance(row['Size'], int) and row['Size'] >= 0, 'Invalid object size')
            objects[row['Key']] = row
        if not page.get('IsTruncated'):
            return objects
        token = page.get('NextContinuationToken')
        require(token and token not in seen_tokens, 'Incomplete pagination')
        seen_tokens.add(token)
    raise MigrationStop('Inventory page limit exceeded')

def same_inventory(left, right):
    return {k: (v['Size'], v.get('ETag'), str(v.get('LastModified'))) for k, v in left.items()} == {k: (v['Size'], v.get('ETag'), str(v.get('LastModified'))) for k, v in right.items()}

def copy_one(source, target, source_bucket, source_prefix, row, existing):
    key = row['Key']
    require(key.startswith(source_prefix), 'Source prefix mismatch')
    destination = TARGET_PREFIX + key[len(source_prefix):]
    require(row.get('ETag'), 'Source ETag missing')
    if destination in existing:
        head = target.head_object(Bucket=TARGET_BUCKET, Key=destination)
        metadata = head.get('Metadata', {})
        recorded = metadata.get(MARKER, '')
        if head['ContentLength'] == row['Size'] and metadata.get(SOURCE_TAG) == row['ETag'] and metadata.get(SOURCE_TIME) == str(row.get('LastModified')) and re.fullmatch('[0-9a-f]{64}', recorded):
            got, length = checksum_stream(target.get_object(Bucket=TARGET_BUCKET, Key=destination)['Body'])
            if got == recorded and length == row['Size']:
                return 'resumed', length
    response = source.get_object(Bucket=source_bucket, Key=key, IfMatch=row['ETag'])
    metadata = dict(response.get('Metadata', {}))
    require(MARKER not in metadata and SOURCE_TAG not in metadata and SOURCE_TIME not in metadata, 'Migration metadata name collision')
    extras = {name: response[name] for name in HEADERS if name in response}
    with tempfile.NamedTemporaryFile(prefix='avtocena-copy-', dir='/opt/avtocena/staging/migration') as spool:
        digest, length = checksum_stream(response['Body'], spool)
        require(length == row['Size'], 'Source size changed')
        require(response.get('ETag') == row['ETag'], 'Source version changed')
        spool.flush()
        metadata[MARKER] = digest
        metadata[SOURCE_TAG] = row['ETag']
        metadata[SOURCE_TIME] = str(row.get('LastModified'))
        extras['Metadata'] = metadata
        # upload_file preserves headers/metadata and supports large objects; no source writes.
        target.upload_file(spool.name, TARGET_BUCKET, destination, ExtraArgs=extras,
                           Config=transfer_config())
    copied = target.get_object(Bucket=TARGET_BUCKET, Key=destination)
    for name in HEADERS:
        if name in extras:
            require(copied.get(name) == extras[name], 'Destination content header differs')
    require(copied.get('Metadata', {}) == metadata, 'Destination metadata differs')
    got, actual_size = checksum_stream(copied['Body'])
    require(got == digest and actual_size == length, 'Destination checksum mismatch')
    return 'copied', length


QUARANTINE_PREFIX = 'migration-staging/quarantine-20261011/'

def quarantine_extra(target, row):
    """Preserve and verify an obsolete staging object before removing its active key."""
    key = row['Key']
    require(key.startswith(TARGET_PREFIX), 'Quarantine outside staging refused')
    require(not any(os.path.exists(p) for p in ['/opt/avtocena/PRODUCTION_ACTIVE', '/opt/avtocena/STAGING_APP_ACTIVE']), 'Production marker present')
    response = target.get_object(Bucket=TARGET_BUCKET, Key=key, IfMatch=row['ETag'])
    headers = {name: response[name] for name in HEADERS if name in response}
    headers['Metadata'] = dict(response.get('Metadata', {}))
    with tempfile.NamedTemporaryFile(prefix='avtocena-quarantine-', dir='/opt/avtocena/staging/migration') as spool:
        digest, size = checksum_stream(response['Body'], spool)
        require(size == row['Size'], 'Quarantine source size changed')
        spool.flush()
        destination = QUARANTINE_PREFIX + hashlib.sha256(key.encode()).hexdigest() + '/' + digest
        target.upload_file(spool.name, TARGET_BUCKET, destination, ExtraArgs=headers, Config=transfer_config())
    saved = target.get_object(Bucket=TARGET_BUCKET, Key=destination)
    require(saved.get('Metadata', {}) == headers['Metadata'], 'Quarantine metadata mismatch')
    for name in HEADERS:
        if name in headers:
            require(saved.get(name) == headers[name], 'Quarantine header mismatch')
    got, actual = checksum_stream(saved['Body'])
    require(got == digest and actual == size, 'Quarantine checksum mismatch')
    current = target.head_object(Bucket=TARGET_BUCKET, Key=key)
    require(current.get('ETag') == row['ETag'] and current['ContentLength'] == size, 'Staging object changed before quarantine')
    # Root-only, fsynced recovery mapping. Never print object keys in public logs.
    with open('/opt/avtocena/staging/migration/quarantine-recovery.jsonl', 'a') as journal:
        journal.write(json.dumps({'original': key, 'quarantine': destination, 'sha256': digest, 'bytes': size}) + '\n')
        journal.flush()
        os.fsync(journal.fileno())
    require(not any(os.path.exists(p) for p in ['/opt/avtocena/PRODUCTION_ACTIVE', '/opt/avtocena/STAGING_APP_ACTIVE']), 'Production marker present')
    target.delete_object(Bucket=TARGET_BUCKET, Key=key)
    return size

def transfer_config():
    from boto3.s3.transfer import TransferConfig
    return TransferConfig(multipart_threshold=64 * 1024 * 1024, multipart_chunksize=16 * 1024 * 1024, max_concurrency=2)

def main(config_path):
    import boto3
    from botocore.config import Config
    require(not any(os.path.exists(p) for p in ['/opt/avtocena/PRODUCTION_ACTIVE', '/opt/avtocena/STAGING_APP_ACTIVE']), 'Production marker present; initial migration disabled')
    with open(config_path) as source_file:
        cfg = json.load(source_file)
    endpoint = cfg.get('source_endpoint') or 'https://storage.yandexcloud.net'
    parsed = urlparse(endpoint)
    require(parsed.scheme == 'https' and re.search(r'(^|\.)yandexcloud\.net$', parsed.hostname or '') and not parsed.username and not parsed.password, 'Invalid source endpoint')
    for name in ['source_bucket', 'source_access', 'source_secret', 'target_access', 'target_secret']:
        require(bool(cfg.get(name)), 'Missing credential configuration')
    prefix = cfg.get('source_prefix', '').strip('/')
    prefix = prefix + '/' if prefix else ''
    common = Config(signature_version='s3v4', retries={'max_attempts': 2, 'mode': 'standard'}, connect_timeout=15, read_timeout=90, s3={'addressing_style': 'path'})
    source = boto3.client('s3', endpoint_url=endpoint, region_name=cfg.get('source_region') or 'ru-central1', aws_access_key_id=cfg['source_access'], aws_secret_access_key=cfg['source_secret'], config=common)
    target = boto3.client('s3', endpoint_url='https://s3.regru.cloud', region_name='us-east-1', aws_access_key_id=cfg['target_access'], aws_secret_access_key=cfg['target_secret'], config=common)
    before = inventory(source, cfg['source_bucket'], prefix)
    require(bool(before), 'Empty source; stopped')
    if os.environ.get('REGCLOUD_RECONCILE') == '1':
        time.sleep(10)
        require(same_inventory(before, inventory(source, cfg['source_bucket'], prefix)), 'Source still changing after workflow pause; external writers must stop')
    target_before = inventory(target, TARGET_BUCKET)
    total = sum(row['Size'] for row in before.values())
    outside = sum(row['Size'] for key, row in target_before.items() if not key.startswith(TARGET_PREFIX))
    require(total + outside < 90_000_000_000, 'Expected destination exceeds 90 GB safety budget')
    require(max(row['Size'] for row in before.values()) <= 2_000_000_000, 'Object exceeds bounded spool size')
    require(os.statvfs('/opt/avtocena/staging/migration').f_bavail * os.statvfs('/opt/avtocena/staging/migration').f_frsize > 8_000_000_000, 'Insufficient temporary disk space')
    print(json.dumps({'phase': 'initial-copy', 'objects': len(before), 'bytes': total, 'targetPrefix': TARGET_PREFIX}), flush=True)
    stopped = threading.Event()
    lock = threading.Lock()
    counters = {'copied': 0, 'resumed': 0, 'verifiedBytes': 0}
    last_report = time.monotonic()
    def worker(row):
        nonlocal last_report
        if stopped.is_set():
            return
        try:
            kind, length = copy_one(source, target, cfg['source_bucket'], prefix, row, target_before)
            with lock:
                counters[kind] += 1
                counters['verifiedBytes'] += length
                if time.monotonic() - last_report >= 30:
                    print(json.dumps(counters), flush=True)
                    last_report = time.monotonic()
        except Exception:
            stopped.set()
            raise
    rows = list(before.values())
    worker(rows[0])  # Confirm permissions/metadata with one object before parallel transfer.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for _ in pool.map(worker, rows[1:]):
            pass
    after = inventory(source, cfg['source_bucket'], prefix)
    if os.environ.get('REGCLOUD_RECONCILE') == '1':
        # Never reconcile a moving source. No source mutation is performed.
        require(same_inventory(before, after), 'Source changed during copy; final sync still required')
        expected_keys = {TARGET_PREFIX + key[len(prefix):] for key in before}
        current_target = inventory(target, TARGET_BUCKET, TARGET_PREFIX)
        extras = [row for key, row in current_target.items() if key not in expected_keys]
        print(json.dumps({'phase': 'quarantine', 'extraObjects': len(extras), 'extraBytes': sum(r['Size'] for r in extras)}), flush=True)
        require(sum(r['Size'] for r in inventory(target, TARGET_BUCKET).values()) + max([r['Size'] for r in extras] or [0]) < 90_000_000_000, 'Insufficient quarantine safety budget')
        for index, row in enumerate(extras):
            quarantine_extra(target, row)
            if (index + 1) % 100 == 0:
                print(json.dumps({'quarantined': index + 1}), flush=True)
        after = inventory(source, cfg['source_bucket'], prefix)
    target_after = inventory(target, TARGET_BUCKET, TARGET_PREFIX)
    expected = {TARGET_PREFIX + key[len(prefix):]: row['Size'] for key, row in before.items()}
    actual = {key: row['Size'] for key, row in target_after.items()}
    report = {**counters, 'sourceUnchangedDuringCopy': same_inventory(before, after), 'targetKeysAndSizesMatch': expected == actual,
              'readyForDns': False, 'historicalVersionsCopied': False, 'sourceDeleted': False}
    with open('/opt/avtocena/staging/migration/last-report.json', 'w') as out:
        json.dump(report, out)
    print(json.dumps(report), flush=True)
    require(report['sourceUnchangedDuringCopy'], 'Source changed during copy; final sync still required')
    require(report['targetKeysAndSizesMatch'], 'Destination inventory differs; no automatic deletion')
    print('Initial copy verified. Application and DNS are NOT switched. Final quiesced sync still required.', flush=True)

if __name__ == '__main__':
    os.umask(0o077)
    try:
        require(len(sys.argv) == 2, 'Expected private configuration file')
        main(sys.argv[1])
    except Exception as error:
        # Logs are public. Do not print keys, paths, bodies, credentials or raw exceptions.
        code = getattr(error, 'response', {}).get('Error', {}).get('Code', '')
        code = code if re.fullmatch(r'[A-Za-z0-9_]{1,60}', str(code)) else ''
        print(json.dumps({'status': 'failed', 'type': type(error).__name__, 's3Code': code, 'reason': str(error) if isinstance(error, MigrationStop) else '', 'readyForDns': False}), flush=True)
        sys.exit(1)
