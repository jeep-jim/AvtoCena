"""Authenticated stdin payload; generated bundle is hashed before this executes."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import stat

payload = json.loads(base64.b64decode('__HOME_CONTROLLER_BUNDLE__'))
nonce = payload['nonce']
assert re.fullmatch(r'[a-f0-9]{32}', nonce)
release = '0509e76cb02523157c98804c52edd7eb784916ba'
lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
info = os.fstat(lock)
assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
parent = Path('/opt/avtocena/releases')
assert parent.resolve() == parent and parent.is_dir() and parent.stat().st_uid == 0 and not (parent.stat().st_mode & 0o022)
for directory in (parent / release, parent / release / 'home-controller'):
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    assert directory.resolve() == directory and directory.is_dir() and directory.stat().st_uid == 0
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
root = parent / release / 'home-controller' / nonce
root.mkdir(mode=0o700)  # Exclusive nonce: a previous session cannot be adopted.
allowed = {
    '.github/operations/home-ui-only-20261123/inventory.py',
    '.github/operations/home-ui-adapter-20261123/host-primitives.py',
    '.github/operations/home-ui-activation-20261123/host-driver.py',
    'scripts/regcloud-performance-gate.py', 'scripts/regcloud-browser-verdict.py',
    'docs/operations/2026-11-11-accepted-speed-baseline.json',
}
assert set(payload['files']) == allowed
for name, item in payload['files'].items():
    raw = base64.b64decode(item['base64'], validate=True)
    assert hashlib.sha256(raw).hexdigest() == item['sha256']
    target = root / name
    target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o400)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
try:
    runpy.run_path(str(root / '.github/operations/home-ui-activation-20261123/host-driver.py'),
                   run_name='__main__', init_globals={'HELD_RUNTIME_LOCK': lock, 'SESSION_NONCE': nonce})
finally:
    os.close(lock)
