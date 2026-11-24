"""Bounded, read-only Docker observations for one already failed AJ release.

No application logs, environment values, full configurations or error bodies are
returned. Configuration fingerprints identify observations, not OCI config blobs.
"""
import datetime
import hashlib
import http.client
import json
import re
import signal
import socket
import sys
import time
import urllib.parse

RELEASE = '53af59971f25c7cda6358ee18242ee5e5232eede'
NONCE = '07ed22ab738b76da4ad7fa1fc964970e'
EXPECTED_IMAGE = 'sha256:1f1a6149d16a9b94f8d6124fbba0095578284039756c642bd7f31c61b83394c5'
SINCE = '2026-11-24T02:28:33Z'
UNTIL = '2026-11-24T02:34:20Z'
MAX_BODY = 2 * 1024 * 1024
MAX_IMAGES, MAX_CONTAINERS, MAX_EVENTS = 16, 8, 128
REQUEST_SECONDS, TOTAL_SECONDS = 5, 75
IMAGE_LABEL = 'org.opencontainers.image.revision=' + RELEASE
NONCE_LABEL = 'avtocena.aj.nonce=' + NONCE
IMAGE_LIST = '/images/json?' + urllib.parse.urlencode({'all': '1', 'filters': json.dumps({'label': [IMAGE_LABEL]}, separators=(',', ':'))})
CONTAINER_LIST = '/containers/json?' + urllib.parse.urlencode({'all': '1', 'filters': json.dumps({'label': [NONCE_LABEL]}, separators=(',', ':'))})
EVENTS = '/events?' + urllib.parse.urlencode({'since': SINCE, 'until': UNTIL, 'filters': json.dumps({'type': ['container'], 'label': [NONCE_LABEL]}, separators=(',', ':'))})
EXACT_IMAGE = '/images/' + EXPECTED_IMAGE + '/json'


class ReadScopeError(Exception):
    pass


def canonical_fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def digest(value):
    return value if isinstance(value, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', value) else None


def integer(value, minimum=0, maximum=2**53-1):
    return value if type(value) is int and minimum <= value <= maximum else None


def version(value):
    return value if isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_.+~-]{1,80}', value) else None


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z', value):
        return None
    return value


def safe_labels(labels):
    labels = labels if isinstance(labels, dict) else {}
    expected = {'org.opencontainers.image.revision': RELEASE, 'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena',
                'avtocena.application': 'web', 'avtocena.role': 'aj-system-japan-only', 'avtocena.aj.nonce': NONCE}
    # Emit only known exact values, never a new arbitrary label or label value.
    return {key: value for key, value in expected.items() if labels.get(key) == value}


def platform(value):
    value = value if isinstance(value, dict) else {}
    return {key: version(value.get(key, value.get(key.lower()))) for key in ('Os', 'Architecture', 'Variant')}


def descriptor(value):
    value = value if isinstance(value, dict) else {}
    return {'digest': digest(value.get('digest')), 'size': integer(value.get('size')), 'platform': platform(value.get('platform'))}


class DockerSocket(http.client.HTTPConnection):
    def __init__(self, timeout):
        super().__init__('localhost', timeout=timeout)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def transport(method, endpoint, timeout, maximum):
    if method != 'GET':
        raise ReadScopeError('read_only_method')
    connection = DockerSocket(timeout)
    try:
        connection.request('GET', endpoint, headers={'Accept': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        return response.status, response.read(maximum + 1)
    finally:
        connection.close()


class Reader:
    def __init__(self, fetch=transport, clock=time.monotonic):
        self.fetch, self.clock = fetch, clock
        self.deadline = clock() + TOTAL_SECONDS
        self.allowed = {'/version', '/info', EXACT_IMAGE, IMAGE_LIST, CONTAINER_LIST, EVENTS}
        self.requests = 0

    def allow_inspection(self, kind, identity):
        valid = digest(identity) if kind == 'images' else isinstance(identity, str) and re.fullmatch(r'[a-f0-9]{64}', identity)
        if kind not in ('images', 'containers') or not valid:
            raise ReadScopeError('inspection_identity')
        self.allowed.add('/' + kind + '/' + identity + '/json')

    def read(self, endpoint, lines=False):
        if endpoint not in self.allowed:
            raise ReadScopeError('read_only_endpoint')
        remaining = self.deadline - self.clock()
        if remaining <= 0:
            return {'httpStatus': None, 'errorCode': 'deadline'}, None
        self.requests += 1
        receipt = {'httpStatus': None}
        try:
            status, raw = self.fetch('GET', endpoint, min(REQUEST_SECONDS, remaining), MAX_BODY)
            status = integer(status, 100, 599)
            receipt = {'httpStatus': status}
            if len(raw) > MAX_BODY:
                return {**receipt, 'errorCode': 'body_bound'}, None
            if status != 200:
                return {**receipt, 'errorCode': 'not_found' if status == 404 else 'http_error'}, None
            value = [json.loads(line) for line in raw.splitlines() if line.strip()] if lines else json.loads(raw)
            return receipt, value
        except TimeoutError:
            return {'httpStatus': None, 'errorCode': 'timeout'}, None
        except (ValueError, UnicodeError):
            return {**receipt, 'errorCode': 'invalid_json'}, None
        except Exception:
            return {'httpStatus': None, 'errorCode': 'transport_error'}, None


def image_observation(requested, receipt, value):
    output = {'requestedId': requested, **receipt}
    if not isinstance(value, dict):
        return output
    config = value.get('Config') if isinstance(value.get('Config'), dict) else {}
    manifests = value.get('Manifests') if isinstance(value.get('Manifests'), list) else []
    return {**output, 'actualId': digest(value.get('Id')), 'platform': platform(value), 'descriptor': descriptor(value.get('Descriptor')),
            'configObservationFingerprint': canonical_fingerprint(config), 'labels': safe_labels(config.get('Labels')),
            'sourceRevisionMatches': config.get('Labels', {}).get('org.opencontainers.image.revision') == RELEASE if isinstance(config.get('Labels'), dict) else False,
            'size': integer(value.get('Size')), 'manifestCount': len(manifests), 'manifestsTruncated': len(manifests) > MAX_IMAGES,
            'manifests': [descriptor(row.get('Descriptor')) for row in manifests[:MAX_IMAGES] if isinstance(row, dict)]}


def container_observation(identity, receipt, value):
    output = {'id': identity, **receipt}
    if not isinstance(value, dict):
        return output
    config = value.get('Config') if isinstance(value.get('Config'), dict) else {}
    state = value.get('State') if isinstance(value.get('State'), dict) else {}
    names = {'/aj-japan-' + RELEASE[:12] + '-' + NONCE: 'candidate', '/aj-japan-probe-' + RELEASE[:12] + '-' + NONCE: 'probe'}
    status = state.get('Status')
    return {**output, 'identityMatches': value.get('Id') == identity, 'kind': names.get(value.get('Name'), 'other'),
            'actualImageId': digest(value.get('Image')), 'configObservationFingerprint': canonical_fingerprint(config),
            'labels': safe_labels(config.get('Labels')), 'restartCount': integer(value.get('RestartCount')),
            'state': {'status': status if status in ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead') else 'other',
                      'running': state.get('Running') is True, 'paused': state.get('Paused') is True,
                      'restarting': state.get('Restarting') is True, 'oomKilled': state.get('OOMKilled') is True,
                      'pid': integer(state.get('Pid')), 'exitCode': integer(state.get('ExitCode'), -255, 65535),
                      'hasError': bool(state.get('Error')), 'startedAt': instant(state.get('StartedAt')), 'finishedAt': instant(state.get('FinishedAt'))}}


def scoped_list(reader, endpoint, kind, label, expected, maximum):
    receipt, rows = reader.read(endpoint)
    if not isinstance(rows, list):
        return {**receipt, 'inspections': [], 'complete': False}
    identities = []
    rejected = 0
    for row in rows:
        labels = row.get('Labels') if isinstance(row, dict) else None
        identity = row.get('Id') if isinstance(row, dict) else None
        valid_id = digest(identity) if kind == 'images' else isinstance(identity, str) and re.fullmatch(r'[a-f0-9]{64}', identity)
        if not valid_id or not isinstance(labels, dict) or labels.get(label) != expected:
            rejected += 1
            continue
        if identity not in identities:
            identities.append(identity)
    values = []
    for identity in sorted(identities)[:maximum]:
        reader.allow_inspection(kind, identity)
        checked, value = reader.read('/' + kind + '/' + identity + '/json')
        values.append((image_observation if kind == 'images' else container_observation)(identity, checked, value))
    return {**receipt, 'returnedRows': len(rows), 'matchingIds': len(identities), 'rejectedRows': rejected,
            'truncated': len(identities) > maximum, 'inspections': values,
            'complete': rejected == 0 and len(identities) <= maximum and all(row.get('httpStatus') == 200 and 'errorCode' not in row for row in values)}


def event_observations(reader):
    receipt, rows = reader.read(EVENTS, lines=True)
    if not isinstance(rows, list):
        return {**receipt, 'rows': [], 'complete': False}
    start, end = (int(datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()) for value in (SINCE, UNTIL))
    actions = {'create', 'start', 'restart', 'stop', 'kill', 'die', 'destroy', 'oom', 'pause', 'unpause', 'update', 'rename',
               'health_status: healthy', 'health_status: unhealthy', 'health_status: starting'}
    output, rejected = [], 0
    for row in rows:
        actor = row.get('Actor', {}) if isinstance(row, dict) else {}
        attrs = actor.get('Attributes', {}) if isinstance(actor, dict) else {}
        identity = actor.get('ID') if isinstance(actor, dict) else None
        at = row.get('time') if isinstance(row, dict) else None
        if not isinstance(row, dict) or not isinstance(attrs, dict) or attrs.get('avtocena.aj.nonce') != NONCE or row.get('Type') != 'container' or not isinstance(identity, str) or not re.fullmatch(r'[a-f0-9]{64}', identity) or type(at) is not int or not start <= at <= end:
            rejected += 1
            continue
        action = row.get('Action')
        output.append({'containerId': identity, 'epochSeconds': at, 'action': action if action in actions else 'other',
                       'exitCode': int(attrs['exitCode']) if isinstance(attrs.get('exitCode'), str) and re.fullmatch(r'\d{1,3}', attrs['exitCode']) else None})
    return {**receipt, 'returnedRows': len(rows), 'rejectedRows': rejected, 'truncated': len(output) > MAX_EVENTS,
            'rows': output[:MAX_EVENTS], 'complete': rejected == 0 and len(output) <= MAX_EVENTS}


def observe(reader=None):
    reader = reader or Reader()
    v_status, v = reader.read('/version')
    i_status, info = reader.read('/info')
    valid_metadata = isinstance(v, dict) and isinstance(info, dict)
    v, info = v if isinstance(v, dict) else {}, info if isinstance(info, dict) else {}
    driver_rows = info.get('DriverStatus') if isinstance(info.get('DriverStatus'), list) else []
    driver_type = next((row[1] for row in driver_rows if isinstance(row, list) and len(row) == 2 and row[0] == 'driver-type'), None)
    exact_status, exact = reader.read(EXACT_IMAGE)
    images = scoped_list(reader, IMAGE_LIST, 'images', 'org.opencontainers.image.revision', RELEASE, MAX_IMAGES)
    containers = scoped_list(reader, CONTAINER_LIST, 'containers', 'avtocena.aj.nonce', NONCE, MAX_CONTAINERS)
    events = event_observations(reader)
    return {'version': 1, 'operation': 'read-serving-aj-release-failure', 'release': RELEASE, 'nonce': NONCE,
            'since': SINCE, 'until': UNTIL, 'readOnly': True, 'mutations': 0, 'dockerRequests': reader.requests,
            'bounds': {'requestSeconds': REQUEST_SECONDS, 'totalSeconds': TOTAL_SECONDS, 'responseBytes': MAX_BODY,
                       'images': MAX_IMAGES, 'containers': MAX_CONTAINERS, 'events': MAX_EVENTS},
            'dockerVersion': {**v_status, 'version': version(v.get('Version')), 'apiVersion': version(v.get('ApiVersion')), 'minApiVersion': version(v.get('MinAPIVersion'))},
            'dockerDriver': {**i_status, 'driver': version(info.get('Driver')), 'driverType': version(driver_type), 'serverVersion': version(info.get('ServerVersion'))},
            'expectedImage': image_observation(EXPECTED_IMAGE, exact_status, exact), 'releaseImages': images,
            'nonceContainers': containers, 'nonceEvents': events,
            'complete': valid_metadata and v_status.get('httpStatus') == 200 and i_status.get('httpStatus') == 200
                        and 'errorCode' not in v_status and 'errorCode' not in i_status
                        and (exact_status.get('httpStatus') == 404 or exact_status.get('httpStatus') == 200 and isinstance(exact, dict) and 'errorCode' not in exact_status)
                        and images['complete'] and containers['complete'] and events['complete']}


def main():
    if len(sys.argv) != 1:
        raise ReadScopeError('arguments_not_allowed')
    def deadline(_signum, _frame):
        raise TimeoutError('diagnostic_deadline')
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(TOTAL_SECONDS)
    try:
        result = observe()
        print(json.dumps(result, separators=(',', ':'), ensure_ascii=False), flush=True)
        return 0 if result['complete'] else 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print(json.dumps({'version': 1, 'operation': 'read-serving-aj-release-failure', 'readOnly': True,
                          'mutations': 0, 'complete': False, 'errorCode': 'diagnostic_unverified'}), flush=True)
        sys.exit(1)
