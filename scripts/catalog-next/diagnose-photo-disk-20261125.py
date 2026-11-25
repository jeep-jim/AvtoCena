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


def ordinary(path):
    try:
        st = path.lstat()
        return stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1
    except FileNotFoundError:
        return False


def proof(path):
    if not ordinary(path) or path.stat().st_size > 256 * 1024:
        return {}
    return json.loads(path.read_bytes())


def docker_json(arguments):
    result = subprocess.run(['/usr/bin/docker', *arguments], check=True, capture_output=True, timeout=30)
    if len(result.stdout) > 2 * 1024 * 1024:
        raise RuntimeError('photo_disk_inventory_too_large')
    return json.loads(result.stdout)


def main():
    usage = os.statvfs(BASE)
    report = {'kind': 'photo-release-disk-readonly-v1',
              'diskFreeBytes': usage.f_bavail * usage.f_frsize,
              'diskTotalBytes': usage.f_blocks * usage.f_frsize}
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
    ids_result = subprocess.run(['/usr/bin/docker', 'ps', '-aq', '--no-trunc'],
                                check=True, capture_output=True, text=True, timeout=30)
    ids = ids_result.stdout.splitlines()
    if len(ids) >= 150 or any(not re.fullmatch(r'[a-f0-9]{64}', row) for row in ids):
        raise RuntimeError('photo_disk_container_identity')
    mounted = []
    report['containers'] = []
    for identity in ids:
        row = docker_json(['inspect', identity])[0]
        mounts = [os.path.realpath(m['Source']) for m in row.get('Mounts', [])
                  if isinstance(m.get('Source'), str) and m['Source'].startswith('/')]
        mounted.extend(mounts)
        report['containers'].append({'id': identity[:12], 'running': row['State']['Running'],
                                     'imageId': row['Image'], 'releaseMounts':
                                     [m.split('/china-next/')[0] for m in mounts if m.startswith(str(BASE) + '/')]})
    report['runtimes'] = {}
    for runtime in RUNTIMES:
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
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'kind': 'photo-release-disk-readonly-v1', 'error': 'photo_disk_inventory_failed'}))
        raise SystemExit(1)
