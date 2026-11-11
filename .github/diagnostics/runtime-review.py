"""Owner-requested bounded read-only audit. No provider requests or mutations."""
import collections
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request


def command(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=20, check=True).stdout


port = command(['docker', 'inspect', '--format', '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}', 'avtocena-production']).strip()
assert port.isdigit()
base = 'http://127.0.0.1:' + port


def read(path):
    start = time.monotonic()
    try:
        with urllib.request.urlopen(base + path, timeout=20) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            assert len(body) <= 2 * 1024 * 1024
            data = json.loads(body)
            return data, {'seconds': round(time.monotonic() - start, 4), 'status': response.status,
                          'bytes': len(body), 'serverTiming': response.headers.get('Server-Timing')}
    except urllib.error.HTTPError as error:
        return None, {'seconds': round(time.monotonic() - start, 4), 'error': 'HTTPError', 'status': error.code}
    except Exception as error:
        return None, {'seconds': round(time.monotonic() - start, 4), 'error': type(error).__name__}


health, _ = read('/api/health')
assert health and health.get('ok')
release = health.get('releaseSha')
assert isinstance(release, str) and re.fullmatch('[a-f0-9]{40}', release)
print('AUDIT_RELEASE', release, flush=True)
paths = ['/api/catalog/search?market=' + market + '&marketPage=1&page=2' for market in ['china', 'uae', 'europe', 'georgia']]
paths += ['/api/catalog/search?market=' + market + '&marketPage=1&yearFrom=2021&page=1' for market in ['china', 'uae', 'europe', 'georgia']]
if '--logs-only' in sys.argv:
    paths = []
failed = set()
for phase, delay in [('first_observed', 0), ('repeat_after_35s', 35)]:
    if delay and paths:
        time.sleep(delay)
    for path in paths:
        if path in failed:
            continue
        data, result = read(path)
        result.update(path=path, phase=phase)
        if data is not None:
            items = data.get('items', [])
            result.update(items=len(items), uniqueIds=len({x.get('id') for x in items}), total=data.get('total'), generation=data.get('generationId'))
        else:
            failed.add(path)  # No retry of an unavailable route.
        print('LOCAL_SAMPLE', json.dumps(result), flush=True)
health_after, _ = read('/api/health')
print('RELEASE_STABLE', bool(health_after and health_after.get('releaseSha') == release), flush=True)
print('CONTAINER_STATS', command(['docker', 'stats', '--no-stream', '--format', 'memory={{.MemUsage}} cpu={{.CPUPerc}}', 'avtocena-production']).strip())
print('CONTAINER_STATE', command(['docker', 'inspect', '--format', 'running={{.State.Running}} oomKilled={{.State.OOMKilled}} restarts={{.RestartCount}}', 'avtocena-production']).strip())
logs = subprocess.run(['docker', 'logs', '--since', '30m', '--tail', '10000', 'avtocena-production'], capture_output=True, text=True, timeout=20)
counts = collections.Counter()
storage = collections.defaultdict(list)
for line in (logs.stdout + logs.stderr).splitlines():
    match = re.search(r'AJES_PUBLIC_FAILURE\s+(\w+)', line)
    if match:
        code = match.group(1)
        counts[code if code in ['visitor_restricted', 'request_timeout', 'operation_failed', 'local_busy', 'invalid_response'] else 'other'] += 1
    if 'catalog_storage_read ' in line:
        try:
            row = json.loads(line.split('catalog_storage_read ', 1)[1])
            path = str(row.get('path', ''))
            category = next((name for name, token in [('partner', '/partner-cache/'), ('budget', 'budget'), ('projection', 'projection'), ('encyclopedia', 'encyclopedia')] if token in path), 'other')
            storage[category].append(float(row['ms']))
        except (ValueError, KeyError, TypeError):
            pass
print('RECENT_AJES_LOG_COUNTS', json.dumps(counts))
codes = ['detail_cache_queue_timeout', 'detail_cache_queue_full', 'object_storage_response_timeout', 'object_storage_request_failed', 'read_deadline', 'ETIMEDOUT', 'ECONNRESET', 'TypeError', 'heap out of memory', 'FATAL ERROR', 'ENOMEM', 'catalog_page_unavailable']
print('RECENT_ERROR_COUNTS', json.dumps({code: (logs.stdout + logs.stderr).count(code) for code in codes}))
print('SLOW_STORAGE_AGGREGATES', json.dumps({key: {'count': len(values), 'maxMs': max(values), 'sumMsOverlapping': sum(values)} for key, values in storage.items()}))
