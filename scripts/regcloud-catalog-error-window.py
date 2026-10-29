"""One bounded saved-log read; no application, storage or supplier requests."""
import collections
import json
import re
import subprocess

START = '2026-10-29T10:18:00Z'
END = '2026-10-29T10:24:00Z'
result = subprocess.run(
    ['docker', 'logs', '--timestamps', '--since', START, '--until', END,
     '--tail', '5000', 'avtocena-production'],
    capture_output=True, text=True, timeout=25, check=True)
lines = (result.stdout + '\n' + result.stderr).splitlines()
assert sum(len(line) for line in lines) < 32 * 1024 * 1024
codes = collections.Counter()
events = []
for index, line in enumerate(lines):
    # Only fixed error codes and generated bundle locations leave the VM.
    # No messages, object keys, request URLs, addresses or vehicle/customer IDs.
    found = re.findall(r'\b(?:object_storage_[A-Za-z_]+|detail_cache_queue_[a-z_]+|catalog_[a-z_]+|ajes_[a-z_]+|ETIMEDOUT|ECONNRESET|ENOMEM|TypeError)\b', line)
    codes.update(found)
    if found:
        stamp = re.match(r'\d{4}-\d\d-\d\dT[\d:.]+Z', line)
        context = '\n'.join(lines[index:index + 7])
        events.append({'at': stamp.group() if stamp else None, 'codes': found,
                       'locations': re.findall(r'\.next/server/[A-Za-z0-9_./()\[\]-]+\.js:\d+:\d+', context)[:5]})
print(json.dumps({'window': [START, END], 'lines': len(lines),
                  'categories': dict(codes), 'events': events[-40:]}))
