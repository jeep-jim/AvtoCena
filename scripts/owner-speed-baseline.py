#!/usr/bin/env python3
"""One owner-requested, sequential capture. Never restarts or changes production."""
import importlib.util, json, pathlib, sys, time, urllib.request

root = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gate', root / 'regcloud-performance-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
base, release = sys.argv[1:3]
routes = gate.ROUTES + [
 ('/cars/china/BMW/3?powerTo=160&sort=totalRub', 2., 'catalog'),
 ('/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub', 2., 'catalog'),
 ('/api/catalog/search?market=china&budgetTo=1500000&pageSize=6', 1., 'search'),
]
report = {'schemaVersion': 1, 'release': release, 'capturedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
          'environment': 'production VM loopback, existing visitor traffic, sequential probes',
          'samples': [], 'providerDiagnostics': [], 'complete': False}
gate.sample(base, '/api/health', 'health', release)
for phase, delay in [('warm_1', 0), ('warm_2', 0), ('warm_3', 0), ('after_ttl', 35), ('after_directory_ttl', 305)]:
 if delay: time.sleep(delay)
 for path, target, kind in routes:
  row = {'phase': phase, 'path': path, 'kind': kind, 'targetSeconds': target}
  start = time.monotonic()
  try:
   row.update(seconds=round(gate.sample(base, path, kind, release), 4), functionalPassed=True)
  except Exception as error:
   row.update(seconds=round(time.monotonic()-start, 4), functionalPassed=False, error=type(error).__name__ + ':' + str(error)[:160])
  report['samples'].append(row)
  print('BASELINE_SAMPLE ' + json.dumps(row), flush=True)

# Four explicit owner-budget queries; no inventory enumeration or background crawl.
for market in ['japan', 'korea']:
 for sort in ['', '&sort=totalRub']:
  path = '/api/catalog/search?market=' + market + '&budgetTo=1500000&pageSize=6' + sort
  start = time.monotonic()
  row = {'market': market, 'path': path}
  try:
   request = urllib.request.Request(base+path, headers=gate.probe_headers(base, '/cars?market='+market, 'catalog'))
   with urllib.request.urlopen(request, timeout=30) as response:
    value = json.load(response)
    row.update(http=response.status, timings=response.headers.get('Server-Timing'))
   row.update({key:value.get(key) for key in ['ok','total','partial','stale','filteredByPage','hasMore','nextCursor','scanLimited','reads','interrupted']})
   row['cards'] = len(value.get('items', []))
   row['prices'] = [{'totalRub':v.get('totalRub'), 'japanPreviewRub':(v.get('japanDeliveredPreview') or {}).get('totalRub'),
                     'deliveredPreviewRub':(v.get('deliveredCalculationPreview') or {}).get('totalRub'),
                     'status':v.get('calculationStatus')} for v in value.get('items', [])]
  except Exception as error: row['error'] = type(error).__name__ + ':' + str(error)[:160]
  row['seconds'] = round(time.monotonic()-start, 4)
  report['providerDiagnostics'].append(row)
  print('BUDGET_DIAGNOSTIC ' + json.dumps(row), flush=True)
gate.sample(base, '/api/health', 'health', release)
report['complete'] = True
print('BASELINE_REPORT ' + json.dumps(report), flush=True)
