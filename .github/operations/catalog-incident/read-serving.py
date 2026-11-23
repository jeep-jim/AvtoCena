"""Read a fixed serving process and anonymous resource counters during the catalog incident."""
import datetime as dt
import hashlib
import http.client
import json
import pathlib
import re
import socket
import time

ID = '52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d'
RELEASE = '22867cbcfaee27b2e8917b6bf880e44827f67b60'
IMAGE = 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8'
NGINX = 'b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f'
BASE = '/containers/' + ID


class Docker(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(8)
        self.sock.connect('/var/run/docker.sock')


def inspect():
    conn = Docker('localhost', timeout=8)
    try:
        conn.request('GET', BASE + '/json')
        res = conn.getresponse()
        assert res.status == 200
        raw = res.read(4 * 1024**2 + 1)
        assert len(raw) <= 4 * 1024**2
        data = json.loads(raw)
    finally:
        conn.close()
    assert data['Id'] == ID and data['Image'] == IMAGE
    assert data['Config']['Labels']['org.opencontainers.image.revision'] == RELEASE
    host, state = data['HostConfig'], data['State']
    assert state['Running'] is True and re.fullmatch(r'[0-9TZ:.\-]+', state['StartedAt'])
    assert host['PortBindings'] == {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3002'}]}
    return dict(id=ID, release=RELEASE, image=IMAGE, pid=state['Pid'], startedAt=state['StartedAt'],
                restartCount=data['RestartCount'], oomKilled=state['OOMKilled'],
                memoryLimit=host['Memory'], nanoCpus=host['NanoCpus'], pidsLimit=host['PidsLimit'])


def counters(pid):
    group = pathlib.Path('/proc', str(pid), 'cgroup').read_text().splitlines()
    paths = [line[3:] for line in group if line.startswith('0::/')]
    if len(paths) != 1:
        return None
    root = pathlib.Path('/sys/fs/cgroup')
    path = (root / paths[0].lstrip('/')).resolve()
    assert path.is_relative_to(root) and ID in path.name
    result = {}
    for name, keys in [('cpu.stat', {'usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec'}),
                       ('memory.events', {'low', 'high', 'max', 'oom', 'oom_kill'})]:
        result[name] = {k: int(v) for k, v in (line.split() for line in (path/name).read_text().splitlines())
                        if k in keys}
    result['memoryBytes'] = int((path/'memory.current').read_text())
    return result


def host_sample():
    value = json.loads(pathlib.Path('/opt/avtocena/metrics/resources.json').read_text())
    return dict(sampledAt=int(value['sampledAt']), cpuPercent=value['cpu']['usedPercent'],
                hostCores=int(value['cpu']['cores']), availableBytes=int(value['memory']['available']),
                totalBytes=int(value['memory']['total']), diskAvailable=int(value['disk']['available']))


def health():
    start = time.monotonic()
    conn = http.client.HTTPConnection('127.0.0.1', 3002, timeout=10)
    try:
        conn.request('GET', '/api/health', headers={'Host': 'avtocena.com'})
        response = conn.getresponse()
        b = response.read(4097)
        assert response.status == 200 and len(b) <= 4096 and json.loads(b).get('releaseSha') == RELEASE
        return {'verified': True, 'ms': round(1000*(time.monotonic()-start))}
    except (OSError, http.client.HTTPException, AssertionError, ValueError):
        return {'verified': False, 'ms': round(1000*(time.monotonic()-start))}
    finally:
        conn.close()


def main():
    assert hashlib.sha256(pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_bytes()).hexdigest() == NGINX
    before = inspect()
    samples = []
    for iteration in range(2):
        try:
            stats = counters(before['pid'])
        except (OSError, ValueError, AssertionError):
            stats = None
        try:
            resources = host_sample()
        except (OSError, ValueError, KeyError):
            resources = None
        samples.append({'time': dt.datetime.now(dt.timezone.utc).isoformat(), 'resources': resources,
                        'cgroup': stats, 'health': health()})
        if iteration == 0:
            time.sleep(8)
    after = inspect()
    print(json.dumps({'processBefore': before, 'processAfter': after, 'stable': before == after,
                      'samples': samples, 'readOnly': True, 'activationAuthorized': False}))


if __name__ == '__main__':
    main()
