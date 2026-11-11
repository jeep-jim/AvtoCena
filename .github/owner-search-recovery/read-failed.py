import collections
import json
import subprocess
import io
import tarfile

name = 'avtocena-release-c57dc8ccefeb'
meta = json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
assert meta['Config']['Labels']['avtocena.role'] == 'production'
assert not meta['State']['Running'], 'failed candidate must remain stopped'
print('CANDIDATE', json.dumps({'name': name, 'image': meta['Image'], 'state': {key: meta['State'].get(key) for key in ['Status', 'OOMKilled', 'ExitCode', 'StartedAt', 'FinishedAt']}}))
log = subprocess.run(['docker', 'logs', '--timestamps', '--since', '2026-11-11T01:49:50Z', '--until', '2026-11-11T01:51:02Z', '--tail', '20000', name], capture_output=True, text=True, check=True)
lines = (log.stdout + '\n' + log.stderr).splitlines()
counts = collections.Counter()
reads = []
stacks = []
keep = 0
codes = ['detail_cache_queue_timeout', 'detail_cache_queue_full', 'catalog_market_unavailable', 'catalog_page_unavailable', 'catalog_offer_related_search_failed', 'object_storage_response_timeout', 'heap out of memory', 'FATAL ERROR']
for line in lines:
    for code in codes:
        if code in line:
            counts[code] += 1
    if 'catalog_storage_read ' in line:
        try:
            row = json.loads(line.split('catalog_storage_read ', 1)[1])
            reads.append(row)
        except Exception:
            pass
    if any(code in line for code in ['catalog_market_unavailable', 'catalog_page_unavailable', 'catalog_offer_related_search_failed']):
        keep = 12
    if keep:
        if any(code in line for code in codes) or ' at ' in line or 'market:' in line or 'code:' in line or 'error:' in line:
            stacks.append(line[:700])
        keep -= 1
print('ERROR_COUNTS', json.dumps(counts))
print('SLOW_READS', json.dumps(sorted(reads, key=lambda row: row.get('ms', 0), reverse=True)[:40]))
print('FAILURE_STACKS', json.dumps(stacks[-160:]))
live = json.loads(subprocess.check_output(['docker', 'inspect', 'avtocena-production']))[0]
print('RETAINED_PRODUCTION', json.dumps({'image': live['Image'], 'running': live['State']['Running'], 'memoryLimit': live['HostConfig']['Memory'], 'nanoCpus': live['HostConfig']['NanoCpus']}))
for chunk, columns in [('4053.js', [13337]), ('2279.js', [5609]), ('7272.js', [3158, 2937])]:
    archive = subprocess.check_output(['docker', 'cp', name + ':/app/apps/web/.next/server/chunks/' + chunk, '-'])
    with tarfile.open(fileobj=io.BytesIO(archive)) as files:
        member = next(item for item in files.getmembers() if item.isfile())
        assert member.size < 8_000_000
        source = files.extractfile(member).read().decode()
    for column in columns:
        print('STACK_CODE', json.dumps({'chunk': chunk, 'column': column, 'code': source[max(0, column - 1400):column + 1400]}))
