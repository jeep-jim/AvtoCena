"""Bounded loopback-only checks. Print counts/statuses, never customer data."""
import json
import sys
import time
import urllib.request

base = 'http://127.0.0.1:3000'
release = sys.argv[1]
results = []

def get(path, timeout=120):
    with urllib.request.urlopen(base + path, timeout=timeout) as response:
        return response.status, response.read()

for attempt in range(36):
    try:
        status, body = get('/api/health', 5)
        health = json.loads(body)
        if status == 200 and health.get('ok') and health.get('releaseSha') == release:
            break
    except Exception:
        pass
    time.sleep(5)
else:
    raise SystemExit('Application health/release check failed')
print(json.dumps({'health': 'ok', 'release': release}), flush=True)
for market in ['japan', 'china', 'korea', 'uae', 'europe', 'georgia']:
    started = time.monotonic()
    try:
        status, body = get('/api/catalog/search?market=' + market + '&pageSize=1')
        payload = json.loads(body)
        items = payload.get('items')
        ok = status == 200 and isinstance(items, list) and len(items) > 0
        row = {'market': market, 'status': status, 'itemsReturned': len(items) if isinstance(items, list) else 0, 'ok': ok}
    except Exception as error:
        row = {'market': market, 'ok': False, 'errorType': type(error).__name__}
    row['seconds'] = round(time.monotonic() - started, 2)
    results.append(row)
    print(json.dumps(row), flush=True)
for path in ['/', '/cars']:
    try:
        status, body = get(path)
        ok = status == 200 and len(body) > 100
    except Exception:
        status, ok = 0, False
    results.append({'path': path, 'status': status, 'ok': ok})
    print(json.dumps(results[-1]), flush=True)
with open('/opt/avtocena/staging/runtime-smoke.json', 'w') as report:
    json.dump({'release': release, 'checks': results, 'publicSiteSwitched': False}, report)
if not all(r['ok'] for r in results):
    raise SystemExit('Some runtime checks failed; DNS unchanged')
print('Isolated application checks passed. DNS remains unchanged.')
