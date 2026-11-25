"""Bounded, read-only inventory for the two failed photo/PW releases."""
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import subprocess

BASE = Path('/opt/avtocena/releases')
CONFIG = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
RUNTIMES = (
    '4302f59a0312f35a64fc3cb9c5b25f9463fa9294',
    'd536c1547c4d82a339ed68ced7d8503f09b6810b',
    '38895e53f7f770ee68edb0b8ad53056468b928a5',
)
FILES = ('GENERATION.json', 'details.sqlite', 'query.sqlite',
         'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson')
PHASE = 'begin'
REPORT = {}


def ordinary(path):
    try:
        st = path.lstat()
        return stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1
    except FileNotFoundError:
        return False


def proof(path):
    if not ordinary(path) or path.stat().st_size > 256 * 1024:
        return {}
    try:
        value = json.loads(path.read_bytes())
        return value if isinstance(value, dict) else {'_invalidJson': True}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {'_invalidJson': True}


def docker_json(arguments):
    result = subprocess.run(['/usr/bin/docker', *arguments], check=True, capture_output=True, timeout=30)
    if len(result.stdout) > 2 * 1024 * 1024:
        raise RuntimeError('photo_disk_inventory_too_large')
    return json.loads(result.stdout)


def main():
    global PHASE, REPORT
    PHASE = 'disk'
    usage = os.statvfs(BASE)
    report = {'kind': 'photo-release-disk-readonly-v1',
              'diskFreeBytes': usage.f_bavail * usage.f_frsize,
              'diskTotalBytes': usage.f_blocks * usage.f_frsize}
    REPORT = report
    PHASE = 'lock'
    fd = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            report['runtimeLockBusy'] = False
            fcntl.flock(fd, fcntl.LOCK_UN)
        except BlockingIOError:
            report['runtimeLockBusy'] = True
    finally:
        os.close(fd)
    PHASE = 'health'
    found = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', CONFIG.read_bytes())
    if len(found) != 1:
        raise RuntimeError('photo_disk_ingress')
    con = http.client.HTTPConnection('127.0.0.1', int(found[0]), timeout=15)
    try:
        con.request('GET', '/api/health', headers={'Host': 'avtocena.com', 'Connection': 'close'})
        res = con.getresponse()
        raw = res.read(100000)
        health = json.loads(raw)
        report['health'] = {'status': res.status, 'ok': health.get('ok'),
                            'releaseSha': health.get('releaseSha'),
                            'calculationVersion': health.get('calculationVersion')}
    finally:
        con.close()
    PHASE = 'docker_list'
    ids_result = subprocess.run(['/usr/bin/docker', 'ps', '-aq', '--no-trunc'],
                                check=True, capture_output=True, text=True, timeout=30)
    ids = ids_result.stdout.splitlines()
    if len(ids) >= 150 or any(not re.fullmatch(r'[a-f0-9]{64}', row) for row in ids):
        raise RuntimeError('photo_disk_container_identity')
    mounted = []
    referenced_images = set()
    report['containers'] = []
    for identity in ids:
        PHASE = 'docker_inspect'
        row = docker_json(['inspect', identity])[0]
        referenced_images.add(row['Image'])
        mounts = [os.path.realpath(m['Source']) for m in row.get('Mounts', [])
                  if isinstance(m.get('Source'), str) and m['Source'].startswith('/')]
        mounted.extend(mounts)
        report['containers'].append({'id': identity[:12], 'running': row['State']['Running'],
                                     'imageId': row['Image'], 'releaseMounts':
                                     [m.split('/china-next/')[0] for m in mounts if m.startswith(str(BASE) + '/')]})
    report['runtimes'] = {}
    for runtime in RUNTIMES:
        PHASE = 'runtime_inventory'
        home = BASE / runtime / 'china-next'
        attempts = []
        if home.is_dir() and not home.is_symlink():
            for directory in sorted(home.iterdir()):
                if not re.fullmatch(r'[a-f0-9]{32}', directory.name) or not directory.is_dir() or directory.is_symlink():
                    continue
                if len(attempts) >= 40:
                    raise RuntimeError('photo_disk_attempt_limit')
                plan = proof(directory / 'PLAN.json')
                rollback = proof(directory / 'ROLLED_BACK.json')
                described = {r.get('name'): r for r in plan.get('files', []) if isinstance(r, dict)}
                files = {}
                for name in (*FILES, 'image.tar', 'details.sqlite.incoming.gz', 'query.sqlite.incoming.gz'):
                    item = directory / ('generation/' if name in FILES else '') / name
                    if ordinary(item):
                        st = item.stat()
                        files[name] = {'bytes': st.st_size, 'allocatedBytes': st.st_blocks * 512,
                                       'matchesDescribedSize': st.st_size == described.get(name, {}).get('bytes')}
                attempts.append({'attemptHash': hashlib.sha256(directory.name.encode()).hexdigest()[:16],
                    'mode': plan.get('mode'), 'controllerSha': plan.get('controllerSha'),
                    'planSha256': hashlib.sha256((directory / 'PLAN.json').read_bytes()).hexdigest() if plan else None,
                    'generationId': plan.get('generationId'),
                    'accepted': (directory / 'ACCEPTED.json').exists(),
                    'planInvalidJson': plan.get('_invalidJson', False),
                    'rollbackInvalidJson': rollback.get('_invalidJson', False),
                    'rollbackBytes': (directory / 'ROLLED_BACK.json').stat().st_size if ordinary(directory / 'ROLLED_BACK.json') else None,
                    'rollbackSha256': hashlib.sha256((directory / 'ROLLED_BACK.json').read_bytes()).hexdigest() if ordinary(directory / 'ROLLED_BACK.json') and (directory / 'ROLLED_BACK.json').stat().st_size <= 256 * 1024 else None,
                    'rollback': bool(rollback),
                    'rollbackBindsPlan': bool(rollback) and rollback.get('nonce') == plan.get('nonce') and
                        rollback.get('release') == plan.get('runtimeSha') and
                        rollback.get('generationManifestSha256') == plan.get('generationManifestSha256'),
                    'candidateRemoved': rollback.get('candidateRemoved'),
                    'ingressRestored': rollback.get('ingressRestored'),
                    'retainedRuntimeSha': rollback.get('retainedRuntimeSha'),
                    'mounted': any(m == str(directory) or m.startswith(str(directory) + '/') or
                                   str(directory).startswith(m + '/') for m in mounted),
                    'files': files})
        report['runtimes'][runtime] = attempts
    PHASE = 'journal'
    journal = subprocess.run(['/usr/bin/journalctl', '-u', 'docker', '-u', 'containerd',
                              '--since', '2026-11-25 13:23:00 UTC', '--until', '2026-11-25 13:27:00 UTC',
                              '--no-pager', '-o', 'cat'], capture_output=True, timeout=20)
    lines = journal.stdout[:4 * 1024 * 1024].decode('utf-8', errors='replace').lower().splitlines()
    report['dockerErrorCategories'] = {
        'noSpaceLeft': sum('no space left on device' in line for line in lines),
        'snapshotMissing': sum('snapshot' in line and ('not found' in line or 'does not exist' in line) for line in lines),
        'readOnlyFilesystem': sum('read-only file system' in line for line in lines),
        'inputOutputError': sum('input/output error' in line for line in lines),
        'journalAvailable': journal.returncode == 0,
    }
    PHASE = 'storage_totals'
    roots = ('/opt/avtocena/releases', '/var/lib/docker', '/var/lib/containerd', '/var/log', '/tmp')
    totals = subprocess.run(['/usr/bin/du', '-x', '-B1', '-s', *roots], capture_output=True, text=True, timeout=50)
    report['storageTotals'] = {}
    for line in totals.stdout.splitlines():
        parts = line.split('\t', 1)
        if len(parts) == 2 and parts[0].isdigit() and parts[1] in roots:
            report['storageTotals'][parts[1]] = int(parts[0])
    releases = subprocess.run(['/usr/bin/du', '-x', '-B1', '-d1', str(BASE)], capture_output=True, text=True, timeout=40)
    sizes = []
    for line in releases.stdout.splitlines():
        parts = line.split('\t', 1)
        if len(parts) == 2 and parts[0].isdigit() and re.fullmatch(re.escape(str(BASE)) + r'/[a-f0-9]{40}', parts[1]):
            sizes.append({'runtimeSha': Path(parts[1]).name, 'allocatedBytes': int(parts[0])})
    report['largestReleaseDirectories'] = sorted(sizes, key=lambda row: row['allocatedBytes'], reverse=True)[:20]
    usage = subprocess.run(['/usr/bin/docker', 'system', 'df', '--format', '{{json .}}'], capture_output=True, text=True, timeout=25)
    report['dockerStorageUsage'] = []
    if usage.returncode == 0:
        for line in usage.stdout.splitlines()[:8]:
            value = json.loads(line)
            report['dockerStorageUsage'].append({key: value.get(key) for key in ('Type', 'TotalCount', 'Active', 'Size', 'Reclaimable')})
    PHASE = 'image_inventory'
    image_ids_result = subprocess.run(['/usr/bin/docker', 'image', 'ls', '-aq', '--no-trunc'],
                                      capture_output=True, text=True, check=True, timeout=30)
    image_ids = sorted(set(image_ids_result.stdout.splitlines()))
    if len(image_ids) > 150 or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', identity) for identity in image_ids):
        raise RuntimeError('photo_disk_image_identity')
    report['images'] = []
    for identity in image_ids:
        row = docker_json(['image', 'inspect', identity])[0]
        labels = row.get('Config', {}).get('Labels') or {}
        revision = labels.get('org.opencontainers.image.revision')
        report['images'].append({'id': identity, 'created': row.get('Created'), 'sizeBytes': row.get('Size'),
            'referencedByContainer': identity in referenced_images,
            'runtimeSha': revision if isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision) else None,
            'ownedApplication': labels.get('org.opencontainers.image.source') == 'https://github.com/jeep-jim/AvtoCena'
                and labels.get('avtocena.application') == 'web',
            'tagCount': len(row.get('RepoTags') or []), 'digestCount': len(row.get('RepoDigests') or []),
            'tags': [tag if re.fullmatch(r'avtocena-(?:regcloud|china-runtime):[a-f0-9-]+', tag) else '<other>'
                     for tag in (row.get('RepoTags') or [])[:10]]})
    PHASE = 'image_space'
    detailed = subprocess.run(['/usr/bin/docker', 'system', 'df', '-v'], capture_output=True, text=True, timeout=30)
    report['imageSpace'] = []
    short_ids = {identity.removeprefix('sha256:')[:12] for identity in image_ids}
    if detailed.returncode == 0:
        for line in detailed.stdout.splitlines():
            parts = re.split(r'\s{2,}', line.strip())
            if len(parts) == 8 and parts[2] in short_ids:
                report['imageSpace'].append({'id': parts[2], 'size': parts[4],
                    'sharedSize': parts[5], 'uniqueSize': parts[6], 'containers': parts[7]})
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        REPORT.update({'kind': 'photo-release-disk-readonly-v1', 'error': 'photo_disk_inventory_failed',
                       'phase': PHASE, 'errorType': type(error).__name__,
                       'errorNumber': getattr(error, 'errno', None),
                       'safeReason': str(error) if re.fullmatch(r'photo_disk_[a-z_]+', str(error)) else None})
        print(json.dumps(REPORT))
        raise SystemExit(1)
