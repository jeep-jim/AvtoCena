#!/usr/bin/env python3
"""Read exact stopped-container writable metadata and sanitized launch structure; never start or delete."""
import base64
import codecs
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
    value['Mounts'] = sorted(row.get('Mounts') or [], key=lambda item: json.dumps(item, sort_keys=True, separators=(',', ':')))
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


def json_array_records(response, metadata_limit=128 * 1024 * 1024):
    # Docker changes can contain many cache paths. Decode one object at a time,
    # retaining no file paths after their category/sample has been selected.
    decoder = json.JSONDecoder()
    utf8 = codecs.getincrementaldecoder('utf8')()
    buffer, consumed, eof = '', 0, False
    def more():
        nonlocal buffer, consumed, eof
        chunk = response.read(65536)
        consumed += len(chunk)
        need(consumed <= metadata_limit, 'diff_metadata_bound')
        eof = not chunk
        buffer += utf8.decode(chunk, final=eof)
    def whitespace():
        nonlocal buffer
        buffer = buffer.lstrip()
        while not buffer and not eof:
            more()
            buffer = buffer.lstrip()
    whitespace()
    need(buffer.startswith('['), 'diff_array')
    buffer = buffer[1:]
    count, need_value = 0, True
    while True:
        whitespace()
        need(buffer or not eof, 'diff_truncated')
        if buffer.startswith(']'):
            need(need_value or count > 0, 'diff_array')
            buffer = buffer[1:]
            while not eof:
                more()
                need(not buffer.strip(), 'diff_trailing')
                buffer = ''
            need(not buffer.strip(), 'diff_trailing')
            return
        if not need_value:
            need(buffer.startswith(','), 'diff_separator')
            buffer = buffer[1:]
            whitespace()
            need(not buffer.startswith(']'), 'diff_trailing_comma')
        while True:
            try:
                value, end = decoder.raw_decode(buffer)
                break
            except json.JSONDecodeError:
                need(not eof and len(buffer) <= 16384, 'diff_object')
                more()
        buffer = buffer[end:]
        count += 1
        need(count <= 1000000, 'diff_records_bound')
        yield value
        need_value = False


def stream_changes(identity):
    need(re.fullmatch(r'[a-f0-9]{64}', identity), 'diff_identity')
    connection = DockerConnection()
    try:
        connection.request('GET', '/containers/' + identity + '/changes')
        response = connection.getresponse()
        need(response.status == 200, 'diff_response')
        yield from json_array_records(response)
    finally:
        connection.close()


def classify(row, deadline):
    identity = row['Id']
    counts, sizes, samples, sample_counts = {}, {}, [], {}
    largest = []
    inspected = missing = total = expected = 0
    for change in stream_changes(identity):
        path = change.get('Path')
        kind = change.get('Kind')
        need(isinstance(path, str) and path.startswith('/') and len(path) <= 4096 and '\x00' not in path and
             '..' not in path.split('/') and kind in (0, 1, 2), 'diff_shape')
        group = category(path)
        total += 1
        counts.setdefault(group, {'changed': 0, 'added': 0, 'deleted': 0})[['changed', 'added', 'deleted'][kind]] += 1
        if kind == 2:
            continue
        expected += 1
        # The FULL metadata stream is classified. HEAD calls sample up to 32
        # paths per category, so a busy cache cannot hide application-data paths.
        if sample_counts.get(group, 0) < 32:
            samples.append((path, group))
            sample_counts[group] = sample_counts.get(group, 0) + 1
    for path, group in samples:
        if time.monotonic() >= deadline:
            break
        value = api('HEAD', '/containers/' + identity + '/archive?path=' + quote(path, safe=''))
        inspected += 1
        if value is None:
            missing += 1
            continue
        if value['mode'] & 0xFFF00000:
            continue
        sizes[group] = sizes.get(group, 0) + value['size']
        largest.append({'category': group, 'bytes': value['size'], 'pathSha256': sha(path.encode())})
    return {'id': identity, 'imageId': row['Image'], 'writableBytes': row.get('SizeRw'),
            'configurationSha256': fingerprint(row), 'changeCount': total, 'changesComplete': True,
            'changeCategories': counts, 'sampledRegularChangedFileBytes': sizes, 'metadataScope': 'category_sample',
            'metadataReads': inspected, 'metadataMissing': missing, 'metadataSamplePlanned': len(samples),
            'metadataSampleComplete': inspected == len(samples) and missing == 0,
            'metadataComplete': inspected == expected and missing == 0,
            'largestSampledRegularChangedFiles': sorted(largest, key=lambda value: value['bytes'], reverse=True)[:12]}


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
