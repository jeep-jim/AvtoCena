#!/usr/bin/env python3
"""Read-only, bounded RAM/disk ownership inventory. No credentials or application rows are emitted."""
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

ROOT = Path('/opt/avtocena/releases')
NGINX = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
LOCK = Path('/run/lock/avtocena-runtime-change.lock')
SHA = re.compile(r'[a-f0-9]{40}')
ID = re.compile(r'[a-f0-9]{64}')
GEN = re.compile(r'gen_china_[0-9]+_[0-9]+')
KIND = 'regcloud-resource-inventory-20261126-v1'
PHASE = 'start'
REPORT = {'kind': KIND, 'mutations': 0, 'providerRequests': 0}


def need(value, code):
    if not value:
        raise RuntimeError('resource_inventory_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe(value, pattern, default=None):
    return value if isinstance(value, str) and re.fullmatch(pattern, value) else default


def bounded(path, limit=1024 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'file_shape')
        raw = b''
        while len(raw) <= limit:
            part = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not part:
                break
            raw += part
        after = os.fstat(fd)
        need(len(raw) <= limit and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'file_changed')
        return raw
    finally:
        os.close(fd)


def run(argv, seconds=25, limit=2 * 1024 * 1024):
    # Every argv is constructed by this file, never from an application field.
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=seconds, check=False)
    need(result.returncode == 0 and len(result.stdout) <= limit, 'command')
    return result.stdout


def docker(*args):
    return json.loads(run(['/usr/bin/docker', *args]))


def disk():
    value = os.statvfs('/')
    return {'totalBytes': value.f_blocks * value.f_frsize, 'availableBytes': value.f_bavail * value.f_frsize,
            'freeBytes': value.f_bfree * value.f_frsize}


def kib(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        match = re.fullmatch(r'([A-Za-z_()]+):\s+(\d+)\s*kB', line)
        if match:
            result[match[1]] = int(match[2]) * 1024
    return result


def memory():
    values = kib('/proc/meminfo')
    keys = ('MemTotal', 'MemAvailable', 'MemFree', 'Buffers', 'Cached', 'SReclaimable',
            'Slab', 'SUnreclaim', 'Shmem', 'Dirty', 'SwapTotal', 'SwapFree')
    return {key: values.get(key) for key in keys}


def ports(row):
    return sorted({int(binding['HostPort']) for bindings in
                   (row.get('HostConfig', {}).get('PortBindings') or {}).values() for binding in (bindings or [])
                   if str(binding.get('HostPort', '')).isdigit() and 1 <= int(binding['HostPort']) <= 65535})


def signature(row):
    selected = {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts', 'RestartCount')}
    selected['state'] = {key: row.get('State', {}).get(key) for key in
                         ('Running', 'Pid', 'StartedAt', 'FinishedAt', 'Paused', 'Restarting', 'Dead')}
    return sha(json.dumps(selected, sort_keys=True, separators=(',', ':')).encode())


def routes():
    raw = run(['/usr/sbin/nginx', '-T'], 15, 2 * 1024 * 1024)
    # Full nginx output stays private. This also covers included upstream blocks.
    local = re.findall(rb'(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})\b', raw)
    return {'configurationSha256': sha(raw), 'localPorts': sorted({int(port) for port in local if 1 <= int(port) <= 65535})}


def health(ingress):
    matches = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', ingress)
    need(len(matches) == 1 and 1 <= int(matches[0]) <= 65535, 'ingress')
    port = int(matches[0])
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=12)
    try:
        connection.request('GET', '/api/health', headers={'Host': 'avtocena.com', 'Connection': 'close'})
        response = connection.getresponse()
        raw = response.read(65537)
        need(response.status == 200 and len(raw) <= 65536, 'health')
        value = json.loads(raw)
        need(value.get('ok') is True and SHA.fullmatch(value.get('releaseSha', '')) and
             ID.fullmatch(value.get('calculationVersion', '')), 'health_identity')
        return {'port': port, 'status': response.status, 'ok': True, 'releaseSha': value['releaseSha'],
                'calculationVersion': value['calculationVersion']}
    finally:
        connection.close()


def release_mount(source):
    match = re.fullmatch(re.escape(str(ROOT)) + r'/([a-f0-9]{40})(?:/(.*))?', source)
    if not match:
        return None
    tail = match.group(2) or ''
    parts = tail.split('/')
    category = parts[0] if parts[0] in ('china-next', 'china-private', 'aj-private', 'aj-resources') else 'other'
    result = {'runtimeSha': match.group(1), 'category': category, 'pathSha256': sha(source.encode())}
    if category == 'china-next' and len(parts) >= 2 and re.fullmatch(r'[a-f0-9]{32}', parts[1]):
        result['attemptHash'] = sha(parts[1].encode())[:16]
    return result


def container_summary(row, all_rows, route_ports, connections):
    config = row.get('Config') or {}
    host = row.get('HostConfig') or {}
    state = row.get('State') or {}
    labels = config.get('Labels') or {}
    identity = row.get('Id', '')
    need(ID.fullmatch(identity), 'container_identity')
    name = row.get('Name', '').removeprefix('/')
    mounts = []
    for mount in row.get('Mounts') or []:
        source = mount.get('Source', '')
        destination = mount.get('Destination', '')
        description = {'type': safe(mount.get('Type'), r'bind|volume|tmpfs', 'other'),
                       'readOnly': mount.get('RW') is False,
                       'sourceSha256': sha(source.encode()), 'destinationSha256': sha(destination.encode()),
                       'metrics': source == '/opt/avtocena/metrics'}
        released = release_mount(source)
        if released:
            description['release'] = released
        mounts.append(description)
    dependencies = []
    for other in all_rows:
        if other['Id'] == identity:
            continue
        other_host = other.get('HostConfig') or {}
        references = [other_host.get('NetworkMode', ''), other_host.get('IpcMode', ''),
                      other_host.get('PidMode', ''), *(other_host.get('VolumesFrom') or []), *(other_host.get('Links') or [])]
        if any(isinstance(value, str) and (identity in value or name in value) for value in references):
            dependencies.append(other['Id'])
    own_ports = ports(row)
    return {'id': identity, 'name': safe(name, r'avtocena-[a-zA-Z0-9_.-]{1,100}', '<other>'),
            'imageId': safe(row.get('Image'), r'sha256:[a-f0-9]{64}'),
            'runtimeSha': safe(labels.get('org.opencontainers.image.revision'), r'[a-f0-9]{40}'),
            'role': safe(labels.get('avtocena.role'), r'[a-z0-9-]{1,70}', '<unknown>'),
            'configurationSha256': signature(row),
            'running': state.get('Running') is True, 'pid': state.get('Pid'),
            'startedAt': safe(state.get('StartedAt'), r'[0-9TZ:.-]+'), 'finishedAt': safe(state.get('FinishedAt'), r'[0-9TZ:.-]+'),
            'restartCount': row.get('RestartCount'), 'restartPolicy': safe(host.get('RestartPolicy', {}).get('Name'), r'[a-z-]+'),
            'oomKilled': state.get('OOMKilled'), 'writableBytes': row.get('SizeRw'), 'rootfsBytes': row.get('SizeRootFs'),
            'ports': own_ports, 'nginxReferencedPorts': sorted(set(own_ports) & set(route_ports)),
            'establishedConnectionsToPort': {str(port): connections.get(port, 0) for port in own_ports},
            'mounts': mounts, 'dependentContainerIds': dependencies,
            'nonDefaultNamespace': any(str(host.get(key, '')).startswith('container:') for key in ('NetworkMode', 'IpcMode', 'PidMode')),
            'volumesFromCount': len(host.get('VolumesFrom') or []), 'privileged': host.get('Privileged') is True}


def connection_counts():
    raw = run(['/usr/bin/ss', '-ntH', 'state', 'established'], 10, 1024 * 1024).decode('utf8', 'replace')
    counts = {}
    for line in raw.splitlines():
        for address in line.split():
            found = re.fullmatch(r'(?:127\.0\.0\.1|\[::1\]|::ffff:127\.0\.0\.1):(\d+)', address)
            if found:
                port = int(found[1])
                counts[port] = counts.get(port, 0) + 1
    return counts


def processes(rows):
    output = []
    clock = os.sysconf('SC_CLK_TCK')
    uptime = float(Path('/proc/uptime').read_text().split()[0])
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            values = kib(directory / 'status')
            rss = values.get('VmRSS', 0)
            if rss < 15 * 1024**2:
                continue
            rollup = kib(directory / 'smaps_rollup')
            cgroups = (directory / 'cgroup').read_text()
            bound = [row['Id'] for row in rows if row['Id'] in cgroups]
            comm = (directory / 'comm').read_text().strip()
            stat_fields = (directory / 'stat').read_text().rsplit(')', 1)[1].split()
            output.append({'pid': int(directory.name), 'comm': safe(comm, r'[A-Za-z0-9_.()+ -]{1,50}', '<other>'),
                           'rssBytes': rss, 'pssBytes': rollup.get('Pss'), 'privateDirtyBytes': rollup.get('Private_Dirty'),
                           'swapBytes': values.get('VmSwap', 0), 'containerIds': bound,
                           'ageSeconds': max(0, round(uptime - int(stat_fields[19]) / clock))})
        except (OSError, ValueError, IndexError):
            continue
    return sorted(output, key=lambda value: value.get('pssBytes') or value['rssBytes'], reverse=True)[:24]


def cgroup_memory(row):
    pid = row.get('State', {}).get('Pid')
    if not row.get('State', {}).get('Running') or not isinstance(pid, int) or pid <= 0:
        return None
    try:
        cgroup = Path('/proc', str(pid), 'cgroup').read_text()
        matches = re.findall(r'^0::(/[^\n]*)$', cgroup, re.M)
        if len(matches) != 1 or '..' in Path(matches[0]).parts:
            return {'status': 'not_cgroup_v2'}
        base = Path('/sys/fs/cgroup') / matches[0].lstrip('/')
        values = {key: int(value) for key, value in (line.split() for line in (base / 'memory.stat').read_text().splitlines())}
        keys = ('anon', 'file', 'shmem', 'file_mapped', 'inactive_file', 'active_file', 'kernel', 'slab', 'slab_reclaimable')
        return {'status': 'ok', 'currentBytes': int((base / 'memory.current').read_text()),
                'swapBytes': int((base / 'memory.swap.current').read_text()),
                'statBytes': {key: values.get(key) for key in keys}}
    except (OSError, ValueError):
        return {'status': 'unavailable'}


def local_history(rows):
    summaries = []
    children = [path for path in ROOT.iterdir() if SHA.fullmatch(path.name) and not path.is_symlink() and path.is_dir()]
    need(len(children) <= 4096, 'release_count')
    for release in children:
        if not SHA.fullmatch(release.name) or release.is_symlink() or not release.is_dir():
            continue
        home = release / 'china-next'
        if not home.exists() or home.is_symlink() or not home.is_dir():
            continue
        attempts = list(home.iterdir())
        need(len(attempts) <= 128, 'attempt_count')
        for attempt in attempts:
            if not re.fullmatch(r'[a-f0-9]{32}', attempt.name) or attempt.is_symlink() or not attempt.is_dir():
                continue
            entry = {'runtimeSha': release.name, 'attemptHash': sha(attempt.name.encode())[:16], 'proofs': {}}
            for name in ('PLAN.json', 'ACCEPTED.json', 'ROLLED_BACK.json', 'RETIRED.json', 'FAILED_CODE_CLEANUP.json'):
                path = attempt / name
                if not path.exists():
                    continue
                try:
                    raw = bounded(path, 256 * 1024)
                    value = json.loads(raw)
                    need(isinstance(value, dict), 'proof_shape')
                    proof = {'sha256': sha(raw), 'bytes': len(raw), 'validJson': True}
                    for key, pattern in [('generationId', r'gen_china_[0-9]+_[0-9]+'), ('mode', r'[a-z-]+'),
                                         ('runtimeSha', r'[a-f0-9]{40}'), ('release', r'[a-f0-9]{40}'),
                                         ('generationManifestSha256', r'[a-f0-9]{64}'),
                                         ('retainedRuntimeSha', r'[a-f0-9]{40}'), ('retainedContainerId', r'[a-f0-9]{64}'),
                                         ('retainedImageId', r'sha256:[a-f0-9]{64}'), ('imageId', r'sha256:[a-f0-9]{64}')]:
                        if key in value:
                            proof[key] = safe(value[key], pattern)
                    if name == 'PLAN.json':
                        previous = value.get('previousAcceptedState') or {}
                        proof['previous'] = {kind: {'runtimeSha': safe((previous.get(kind) or {}).get('runtimeSha'), r'[a-f0-9]{40}'),
                                                   'generationId': safe((previous.get(kind) or {}).get('generationId'), r'gen_china_[0-9]+_[0-9]+'),
                                                   'imageId': safe((previous.get(kind) or {}).get('imageId'), r'sha256:[a-f0-9]{64}')}
                                             for kind in ('current', 'rollback')}
                    entry['proofs'][name] = proof
                except (ValueError, OSError, RuntimeError):
                    entry['proofs'][name] = {'validJson': False}
            entry['mountedBy'] = [row['Id'] for row in rows if any(
                str(mount.get('Source', '')).startswith(str(attempt) + '/') or str(mount.get('Source', '')) == str(attempt)
                for mount in row.get('Mounts') or [])]
            summaries.append(entry)
    need(len(summaries) <= 256, 'history_count')
    return summaries


def service_refs(rows):
    # Configuration content remains private. Only direct identity-reference counts are public.
    output = {row['Id']: [] for row in rows}
    candidates = []
    for root in (Path('/etc/systemd/system'), Path('/etc/cron.d')):
        if not root.is_dir():
            continue
        for directory, names, files in os.walk(root, followlinks=False):
            names[:] = [name for name in names if not (Path(directory) / name).is_symlink()]
            for name in files:
                path = Path(directory) / name
                if path.is_symlink() or not path.is_file() or path.stat().st_size > 256 * 1024:
                    continue
                candidates.append(path)
    need(len(candidates) <= 512, 'service_files')
    for path in candidates:
        raw = bounded(path, 256 * 1024)
        for row in rows:
            name = row.get('Name', '').removeprefix('/')
            matches = [token for token in (row['Id'], name) if token and token.encode() in raw]
            if matches:
                output[row['Id']].append({'configurationPathSha256': sha(str(path).encode()),
                                         'contentSha256': sha(raw), 'identityReferences': len(matches)})
    return output


def main():
    global PHASE
    need(len(sys.argv) == 1, 'arguments')
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(RuntimeError('resource_inventory_deadline')))
    signal.alarm(240)
    descriptor = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        REPORT.update(measuredAtUtc=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
                      runtimeLockHeld=True, diskBefore=disk(), memoryBefore=memory())
        PHASE = 'ingress'
        ingress = bounded(NGINX)
        before_health = health(ingress)
        before_routes = routes()
        PHASE = 'containers'
        identities = run(['/usr/bin/docker', 'ps', '-aq', '--no-trunc']).decode().split()
        need(0 < len(identities) <= 128 and all(ID.fullmatch(identity) for identity in identities), 'containers')
        rows = docker('inspect', '--size', *identities)
        need(len(rows) == len(identities) and {row['Id'] for row in rows} == set(identities), 'container_binding')
        serving = [row for row in rows if row.get('State', {}).get('Running') and before_health['port'] in ports(row)]
        need(len(serving) == 1 and (serving[0].get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') ==
             before_health['releaseSha'], 'serving')
        connections = connection_counts()
        references = service_refs(rows)
        REPORT['health'] = before_health
        REPORT['nginx'] = before_routes
        REPORT['servingContainerId'] = serving[0]['Id']
        REPORT['containers'] = [{**container_summary(row, rows, before_routes['localPorts'], connections),
                                 'memory': cgroup_memory(row), 'serviceDefinitionReferences': references[row['Id']]}
                                for row in rows]
        REPORT['topProcesses'] = processes(rows)
        PHASE = 'history'
        REPORT['localHistory'] = local_history(rows)
        PHASE = 'sizes'
        roots = ('/opt/avtocena/releases', '/var/lib/docker', '/var/lib/containerd', '/var/log', '/tmp')
        raw = run(['/usr/bin/du', '-x', '-B1', '-s', *roots], 45).decode()
        REPORT['storageBytes'] = {path: int(size) for size, path in (line.split('\t', 1) for line in raw.splitlines())
                                  if path in roots and size.isdigit()}
        raw = run(['/usr/bin/du', '-x', '-B1', '-d1', str(ROOT)], 35).decode()
        REPORT['releaseBytes'] = [{'runtimeSha': Path(path).name, 'allocatedBytes': int(size)}
                                  for size, path in (line.split('\t', 1) for line in raw.splitlines())
                                  if Path(path).parent == ROOT and SHA.fullmatch(Path(path).name) and size.isdigit()]
        PHASE = 'images'
        ids = sorted(set(run(['/usr/bin/docker', 'image', 'ls', '-aq', '--no-trunc']).decode().split()))
        need(len(ids) <= 128 and all(re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in ids), 'images')
        images = docker('image', 'inspect', *ids) if ids else []
        REPORT['images'] = []
        for value in images:
            labels = value.get('Config', {}).get('Labels') or {}
            REPORT['images'].append({'id': value['Id'], 'runtimeSha': safe(labels.get('org.opencontainers.image.revision'), r'[a-f0-9]{40}'),
              'sizeBytes': value.get('Size'), 'created': safe(value.get('Created'), r'[0-9TZ:.-]+'),
              'ownedApplication': labels.get('org.opencontainers.image.source') == 'https://github.com/jeep-jim/AvtoCena' and labels.get('avtocena.application') == 'web',
              'referencedBy': [row['Id'] for row in rows if row.get('Image') == value['Id']],
              'tags': [safe(tag, r'avtocena-(?:regcloud|china-runtime):[a-f0-9-]+', '<other>') for tag in (value.get('RepoTags') or [])]})
        PHASE = 'storage_summary'
        raw = run(['/usr/bin/docker', 'system', 'df', '--format', '{{json .}}'], 30).decode()
        REPORT['dockerStorage'] = [{key: value.get(key) for key in ('Type', 'TotalCount', 'Active', 'Size', 'Reclaimable')}
                                    for value in (json.loads(line) for line in raw.splitlines())]
        PHASE = 'verify'
        after_rows = docker('inspect', *identities)
        need({row['Id']: signature(row) for row in after_rows} == {row['Id']: signature(row) for row in rows}, 'containers_changed')
        need(set(run(['/usr/bin/docker', 'ps', '-aq', '--no-trunc']).decode().split()) == set(identities), 'container_set_changed')
        need(bounded(NGINX) == ingress and routes() == before_routes and health(ingress) == before_health, 'ingress_changed')
        REPORT.update(healthAndContainersUnchanged=True, diskAfter=disk(), memoryAfter=memory(), status='observed')
        print(json.dumps(REPORT, separators=(',', ':')), flush=True)
    finally:
        os.close(descriptor)
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error)
        REPORT.update(status='failed', phase=PHASE, error=code if re.fullmatch(r'resource_inventory_[a-z_]+', code)
                      else 'resource_inventory_unavailable', errorType=type(error).__name__)
        print(json.dumps(REPORT, separators=(',', ':')), flush=True)
        sys.exit(1)
