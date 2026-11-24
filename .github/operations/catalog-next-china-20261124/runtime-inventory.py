#!/usr/bin/env python3
"""Read-only deployment facts. Never print environment values or process arguments."""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
from datetime import datetime, timezone

EXPECTED_RELEASE = '22867cbcfaee27b2e8917b6bf880e44827f67b60'
EXPECTED_CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'


def command(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=30).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def collect():
    record = json.loads(command('docker', 'inspect', 'avtocena-production'))[0]
    env = dict(item.split('=', 1) for item in record['Config']['Env'] if '=' in item)
    assert record['State']['Running'] is True
    assert record['Config']['Labels']['avtocena.role'] == 'production'
    assert env.get('AVTOCENA_RELEASE_SHA') == EXPECTED_RELEASE
    assert env.get('AVTOCENA_CALCULATION_VERSION') == EXPECTED_CALCULATION
    assert re.fullmatch(r'sha256:[a-f0-9]{64}', record['Image'])
    disk = shutil.disk_usage('/opt/avtocena')
    memory = {}
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        if key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'):
            memory[key + 'Bytes'] = int(value.strip().split()[0]) * 1024
    process_evidence = []
    for directory in pathlib.Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            raw = (directory / 'cmdline').read_bytes()
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
        # Only classify known feed families. Arguments, tokens and paths are private.
        categories = [name for name in ('che168', 'catalog-daily', 'catalog-refresh',
                      'catalog-prepare', 'catalog-publish', 'catalog-download',
                      'owned-china', 'nonjp-intake') if name.encode() in raw]
        if categories:
            process_evidence.append({'pid': int(directory.name), 'categories': categories,
                                     'commandSha256': digest(raw)})
    timers = command('systemctl', 'list-timers', '--all', '--no-pager', '--plain')
    matched_timers = [line for line in timers.splitlines()
                      if re.search(rb'avtocena|catalog|che168|encar', line, re.I)]
    cron_evidence = []
    candidates = [pathlib.Path('/etc/crontab'), pathlib.Path('/var/spool/cron/crontabs/root')]
    for directory in ('/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily'):
        parent = pathlib.Path(directory)
        if parent.exists():
            candidates.extend(item for item in parent.iterdir() if item.is_file())
    for filename in candidates:
        if not filename.is_file():
            continue
        raw = filename.read_bytes()
        relevant = [line for line in raw.splitlines() if not line.lstrip().startswith(b'#')
                    and re.search(rb'avtocena|catalog|che168|encar|dubicars', line, re.I)]
        if relevant:
            cron_evidence.append({'fileSha256': digest(str(filename).encode()),
                                  'contentSha256': digest(raw), 'relevantLines': len(relevant)})
    return {
        'version': 1, 'kind': 'china-readonly-runtime-inventory',
        'observedAt': datetime.now(timezone.utc).isoformat(), 'productionWrites': False,
        'releaseSha': EXPECTED_RELEASE, 'calculationVersion': EXPECTED_CALCULATION,
        'imageId': record['Image'], 'containerId': record['Id'],
        'chinaRegcloudRuntime': env.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME') == '1',
        'catalogNextConfigured': bool(env.get('CATALOG_NEXT_CHINA_MANIFEST_PATH')),
        'mounts': [{'type': mount['Type'], 'destination': mount['Destination'],
                    'readOnly': not mount['RW']} for mount in record['Mounts']],
        'diskBytes': {'total': disk.total, 'used': disk.used, 'free': disk.free},
        'memory': memory, 'feedProcesses': process_evidence,
        'matchingTimers': {'count': len(matched_timers),
                           'sha256': digest(b'\n'.join(matched_timers))},
        'matchingCronFiles': cron_evidence,
        'completeWriterFence': False,
        'limitations': ['Point-in-time host observations do not stop writers or prove backup completeness.']
    }


if __name__ == '__main__':
    try:
        print(json.dumps(collect(), ensure_ascii=True, indent=2))
    except Exception:
        print(json.dumps({'version': 1, 'kind': 'china-readonly-runtime-inventory',
                          'productionWrites': False, 'errorCode': 'runtime_inventory_failed'}))
        raise SystemExit(1)
