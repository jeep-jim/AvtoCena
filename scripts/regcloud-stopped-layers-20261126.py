#!/usr/bin/env python3
"""Read exact stopped-container writable metadata and sanitized launch structure; never start or delete."""
import base64
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import sys
import time
from urllib.parse import quote

KIND = 'regcloud-stopped-layers-20261126-v1'
LOCK = Path('/run/lock/avtocena-runtime-change.lock')
NGINX = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
CURRENT = 'd536c1547c4d82a339ed68ced7d8503f09b6810b'
PINS = {
 '52e44ba28107': 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8',
 'e30facd9dc08': 'sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984',
 'bccda9177f15': 'sha256:a47629b77de4ff0a8b7338289a14372ae74fa95a9b8de61df11453f7c5e387fc',
 '08275f6ff0ee': 'sha256:54eae297dad0feabf2def829482700547576f20fcf5d3f0d00aef1c4a4c09dcb',
 'c63cde7396b8': 'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac',
 '9bba3f06c068': 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f',
 'c08382956896': 'sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8',
 'f664adabeed0': 'sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f',
}
REPORT = {'kind': KIND, 'mutations': 0, 'providerRequests': 0, 'applicationFileContentReads': 0, 'containers': []}
PHASE = 'start'


def need(value, code):
    if not value:
        raise RuntimeError('stopped_layers_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class DockerConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=12)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def api(method, path, maximum=2 * 1024 * 1024):
    need((method == 'GET' and (path == '/containers/json?all=1' or re.fullmatch(r'/containers/[a-f0-9]{64}/(?:json(?:\?size=1)?|changes)', path)))
         or (method == 'HEAD' and re.fullmatch(r'/containers/[a-f0-9]{64}/archive\?path=[A-Za-z0-9_.%~-]+', path)), 'method')
    connection = DockerConnection()
    try:
        connection.request(method, path)
        response = connection.getresponse()
        if method == 'HEAD':
            if response.status == 404:
                return None
            need(response.status == 200, 'stat_response')
            encoded = response.getheader('X-Docker-Container-Path-Stat')
            need(isinstance(encoded, str) and len(encoded) <= 16384, 'stat_header')
            result = json.loads(base64.b64decode(encoded, validate=True))
            need(isinstance(result, dict) and type(result.get('size')) is int and result['size'] >= 0 and
                 type(result.get('mode')) is int, 'stat_shape')
            return result
        need(response.status == 200, 'docker_response')
        raw = response.read(maximum + 1)
        need(len(raw) <= maximum, 'response_size')
        return json.loads(raw)
    finally:
        connection.close()


def fingerprint(row):
    value = {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts', 'RestartCount')}
    value['state'] = {key: row.get('State', {}).get(key) for key in ('Running', 'Pid', 'StartedAt', 'FinishedAt')}
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def launch_arg(value):
    need(isinstance(value, str) and len(value) <= 65536, 'launch_arg')
    names = {'node', 'nodejs', '/usr/bin/node', '/usr/local/bin/node', 'server.js', './server.js',
             'apps/web/server.js', './apps/web/server.js', '/app/apps/web/server.js',
             '/app/server.js', 'next', 'start', '-e', '--eval', '--require', '-r', '--import',
             '--enable-source-maps', '--trace-gc', '--trace-warnings', '--expose-gc',
             '--trace-uncaught', '--use-largepages=off', '--use-largepages=on',
             './scripts/lib/node-resource-memory-startup.mjs', '/app/scripts/lib/node-resource-memory-startup.mjs',
             'scripts/lib/node-resource-memory-startup.mjs'}
    if value in names or re.fullmatch(r'--(?:max-old-space-size|max-semi-space-size|stack_size|heapsnapshot-near-heap-limit)=\d{1,7}', value):
        return {'kind': 'allowlisted', 'value': value}
    result = {'kind': 'opaque', 'bytes': len(value.encode()), 'sha256': sha(value.encode())}
    if len(value) > 120:
        result['scriptShape'] = {token: token in value for token in
                                ('process.exit', 'setTimeout', 'setInterval', 'SIGTERM', 'SIGINT', 'require(', 'import ', 'server.js')}
    return result


def launch(row):
    config = row.get('Config') or {}
    output = {}
    for key in ('Entrypoint', 'Cmd'):
        args = config.get(key) or []
        need(isinstance(args, list) and len(args) <= 64, 'launch_shape')
        output[key] = {'sha256': sha(json.dumps(args, separators=(',', ':')).encode()), 'tokens': [launch_arg(arg) for arg in args]}
    output['workingDirectory'] = config.get('WorkingDir') if config.get('WorkingDir') in ('/app', '/') else '<other>'
    return output


def category(path):
    if path == '/app/.next/cache' or path.startswith(('/app/.next/cache/', '/app/apps/web/.next/cache/')):
        return 'next_cache'
    if path.startswith(('/tmp/', '/var/tmp/', '/root/.cache/')) or path in ('/tmp', '/var/tmp', '/root/.cache'):
        return 'temporary_cache'
    if path.startswith(('/var/log/', '/root/.npm/_logs/')):
        return 'logs'
    if path.startswith(('/app/data/', '/app/apps/web/data/')) or path in ('/app/data', '/app/apps/web/data'):
        return 'application_data'
    if any(part in ('uploads', 'upload', 'media') for part in path.split('/')):
        return 'uploads_or_media'
    if path.startswith(('/app/node_modules/', '/app/apps/web/node_modules/', '/app/.next/', '/app/apps/web/.next/')):
        return 'runtime_files'
    if path.startswith('/app/'):
        return 'other_application'
    return 'other_system'


def health(ingress):
    ports = re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$', ingress)
    need(len(ports) == 1, 'ingress')
    connection = http.client.HTTPConnection('127.0.0.1', int(ports[0]), timeout=12)
    try:
        connection.request('GET', '/api/health', headers={'Host': 'avtocena.com', 'Connection': 'close'})
        response = connection.getresponse()
        raw = response.read(65537)
        need(response.status == 200 and len(raw) <= 65536, 'health')
        value = json.loads(raw)
        need(value.get('ok') is True and value.get('releaseSha') == CURRENT and
             re.fullmatch(r'[a-f0-9]{64}', value.get('calculationVersion', '')), 'health_identity')
        return {'releaseSha': CURRENT, 'calculationVersion': value['calculationVersion'], 'port': int(ports[0])}
    finally:
        connection.close()


def classify(row, deadline):
    identity = row['Id']
    diffs = api('GET', '/containers/' + identity + '/changes')
    need(isinstance(diffs, list) and len(diffs) <= 16000, 'diff_bound')
    counts = {}
    sizes = {}
    largest = []
    inspected = 0
    missing = 0
    for change in diffs:
        path = change.get('Path')
        kind = change.get('Kind')
        need(isinstance(path, str) and path.startswith('/') and len(path) <= 4096 and '\x00' not in path and
             '..' not in path.split('/') and kind in (0, 1, 2), 'diff_shape')
        group = category(path)
        counts.setdefault(group, {'changed': 0, 'added': 0, 'deleted': 0})[['changed', 'added', 'deleted'][kind]] += 1
        if kind == 2:
            continue
        if time.monotonic() >= deadline or inspected >= 2000:
            continue
        value = api('HEAD', '/containers/' + identity + '/archive?path=' + quote(path, safe=''))
        inspected += 1
        if value is None:
            missing += 1
            continue
        # Docker emits Go FileMode: the high twelve bits encode non-regular types.
        if value['mode'] & 0xFFF00000:
            continue
        sizes[group] = sizes.get(group, 0) + value['size']
        largest.append({'category': group, 'bytes': value['size'], 'pathSha256': sha(path.encode())})
    expected = sum(change['Kind'] != 2 for change in diffs)
    return {'id': identity, 'imageId': row['Image'], 'writableBytes': row.get('SizeRw'),
            'configurationSha256': fingerprint(row), 'changeCount': len(diffs), 'changeCategories': counts,
            'regularChangedFileBytes': sizes, 'metadataReads': inspected, 'metadataMissing': missing,
            'metadataComplete': inspected == expected and missing == 0,
            'largestRegularChangedFiles': sorted(largest, key=lambda value: value['bytes'], reverse=True)[:12]}


def main():
    global PHASE
    need(len(sys.argv) == 1, 'arguments')
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(RuntimeError('stopped_layers_deadline')))
    signal.alarm(240)
    descriptor = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ingress = NGINX.read_bytes()
        before_health = health(ingress)
        PHASE = 'inventory'
        listed = api('GET', '/containers/json?all=1')
        need(isinstance(listed, list) and 0 < len(listed) <= 128, 'containers')
        rows = [api('GET', '/containers/' + item['Id'] + '/json?size=1') for item in listed]
        need(all(re.fullmatch(r'[a-f0-9]{64}', row.get('Id', '')) for row in rows), 'identity')
        before = {row['Id']: fingerprint(row) for row in rows}
        REPORT.update(measuredAtUtc=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
                      health=before_health, runtimeLockHeld=True)
        REPORT['launchStructure'] = [{'id': row['Id'], 'runtimeSha': ((row.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') if re.fullmatch(r'[a-f0-9]{40}', (row.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision', '')) else None),
                                     'launch': launch(row)} for row in rows if row.get('State', {}).get('Running')]
        PHASE = 'stopped_metadata'
        for prefix, image in PINS.items():
            matches = [row for row in rows if row['Id'].startswith(prefix)]
            need(len(matches) == 1 and matches[0]['Image'] == image and matches[0]['State'].get('Running') is False and
                 matches[0]['State'].get('Pid') == 0, 'target_pin')
            REPORT['containers'].append(classify(matches[0], time.monotonic() + 15))
        PHASE = 'verify'
        need({row['Id']: fingerprint(api('GET', '/containers/' + row['Id'] + '/json')) for row in rows} == before, 'containers_changed')
        need({row['Id'] for row in api('GET', '/containers/json?all=1')} == set(before), 'container_set_changed')
        need(NGINX.read_bytes() == ingress and health(ingress) == before_health, 'health_changed')
        REPORT.update(status='observed', healthAndContainersUnchanged=True)
        print(json.dumps(REPORT, separators=(',', ':')), flush=True)
    finally:
        os.close(descriptor)
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error)
        REPORT.update(status='failed', phase=PHASE, error=code if re.fullmatch(r'stopped_layers_[a-z_]+', code)
                      else 'stopped_layers_unavailable', errorType=type(error).__name__)
        print(json.dumps(REPORT, separators=(',', ':')), flush=True)
        sys.exit(1)
