"""One bounded saved-log read; no application, storage or supplier requests."""
import collections
import json
import re
import subprocess

START = '2026-10-29T14:39:35Z'
END = '2026-10-29T14:40:10Z'
result = subprocess.run(
    ['docker', 'logs', '--timestamps', '--since', START, '--until', END,
     '--tail', '5000', 'avtocena-release-9d1fe7bc2fab'],
    capture_output=True, text=True, timeout=25, check=True)
lines = (result.stdout + '\n' + result.stderr).splitlines()
assert sum(len(line) for line in lines) < 32 * 1024 * 1024
codes = collections.Counter()
events = []
timings = {}
for index, line in enumerate(lines):
    # Only fixed error codes and generated bundle locations leave the VM.
    # No messages, object keys, request URLs, addresses or vehicle/customer IDs.
    found = re.findall(r'\b(?:object_storage_[A-Za-z_]+|detail_cache_queue_[a-z_]+|catalog_[a-z_]+|ajes_[a-z_]+|green_[a-z_]+|japan_[a-z_]+|currency_[a-z_]+|rates_[a-z_]+|ETIMEDOUT|ECONNRESET|ENOMEM|TypeError|RangeError|SyntaxError|AbortError|TimeoutError)\b', line)
    codes.update(found)
    if 'catalog_storage_read ' in line:
        try:
            value = json.loads(line.split('catalog_storage_read ', 1)[1])
            path = value.get('path', '')
            group = next((name for name in ['budget-cards', 'specification-selector', 'encyclopedia', 'calculation-previews', 'search-projection', 'market-landing', 'price', 'ajes'] if name in path), 'other_catalog')
            timings.setdefault(group, []).append(value['ms'])
        except (ValueError, KeyError, TypeError):
            pass
    significant = [code for code in found if code != 'catalog_storage_read' and not code.startswith('ajes_')]
    if significant:
        stamp = re.match(r'\d{4}-\d\d-\d\dT[\d:.]+Z', line)
        context = '\n'.join(lines[index:index + 7])
        events.append({'at': stamp.group() if stamp else None, 'codes': significant,
                       'locations': re.findall(r'\.next/server/[A-Za-z0-9_./()\[\]-]+\.js:\d+:\d+', context)[:5]})
known = {message: sum(message in line for line in lines) for message in ['Invalid string length','Maximum call stack size exceeded','Cannot read properties of undefined','Cannot read properties of null','fetch failed','array buffer allocation failed','out of memory','detail_cache_queue_timeout','detail_cache_queue_full','catalog_budget_context_changed','catalog_budget_snapshot_invalid']}
print(json.dumps({'knownErrors': known, 'window': [START, END], 'lines': len(lines),
                  'categories': dict(codes), 'events': events[-40:],
                  'slowStorage': {key: {'reads': len(values), 'maxMs': max(values)} for key, values in timings.items()}}))
