#!/usr/bin/env python3
"""Read the installed runtime; a successful inventory never authorizes activation."""
import contextlib
import datetime
import fcntl
import hashlib
import http.client
import json
import os
import re
import socket
import ssl
import stat
import sys

RELEASE = '22867cbcfaee27b2e8917b6bf880e44827f67b60'
BUILD = '672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761'
CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
BASE = '85296f6b8797aaa93227b69da7e9e9e928e8f9b5'
LEGACY = '83ff17075e9188dcf227c8752dc064248d5f42e0'
SERVING_ID = '52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d'
NGINX_SHA256 = 'b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f'
CONFIG_PATH = '/etc/nginx/conf.d/avtocena-prepare.conf'
LOCK_PATH = '/run/lock/avtocena-runtime-change.lock'
HOST = 'avtocena.com'
ROLES = (
    ('serving', 'avtocena-china-grid-dark-22867cbcfaee', RELEASE,
     'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8', 3002, True),
    ('chinaRollback', 'avtocena-china-candidate-85296f6b8797', BASE,
     'sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984', 3000, True),
    ('legacyRollback', 'avtocena-production', LEGACY,
     'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd', 3001, False),
)
MOUNTS = {
    ('/opt/avtocena/metrics', '/run/avtocena-metrics'),
    ('/opt/avtocena/releases/' + BASE + '/china-private', '/run/avtocena-china-switch'),
}
DOCKER_GET_PATHS = frozenset('/containers/' + role[1] + '/json' for role in ROLES)


class InventoryError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise InventoryError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def environment(container):
    entries = container['Config']['Env']
    need(isinstance(entries, list), 'inventory_env_invalid')
    result = {}
    for entry in entries:
        need(isinstance(entry, str) and '=' in entry, 'inventory_env_invalid')
        key, value = entry.split('=', 1)
        need(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) is not None
             and not re.search(r'[\x00\r\n]', value), 'inventory_env_invalid')
        need(key not in result, 'inventory_env_duplicate')
        result[key] = value
    return result


def validate_container(container, role):
    kind, name, revision, image, port, armed = role
    need(isinstance(container, dict), 'inventory_container_invalid')
    config, host, state = container['Config'], container['HostConfig'], container['State']
    env = environment(container)
    need(container['Name'] == '/' + name and container['Image'] == image
         and config['Labels'].get('org.opencontainers.image.revision') == revision,
         'inventory_container_identity')
    need(re.fullmatch(r'[a-f0-9]{64}', container['Id']) is not None,
         'inventory_container_id')
    need(state['Running'] is True and host['Privileged'] is False,
         'inventory_container_state')
    need(type(state['Pid']) is int and state['Pid'] > 0
         and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z', state['StartedAt']) is not None
         and type(container['RestartCount']) is int and container['RestartCount'] >= 0,
         'inventory_process_identity')
    need(host['PortBindings'] == {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(port)}]},
         'inventory_port_binding')
    need(env.get('AVTOCENA_RELEASE_SHA') == revision
         and env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION
         and (env.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME') == '1') == armed,
         'inventory_runtime_env')
    if kind in ('serving', 'chinaRollback'):
        mounts = container['Mounts']
        need(isinstance(mounts, list) and len(mounts) == 2
             and all(m['Type'] == 'bind' and m['RW'] is False for m in mounts)
             and {(m['Source'], m['Destination']) for m in mounts} == MOUNTS,
             'inventory_mounts')
    if kind == 'serving':
        need(container['Id'] == SERVING_ID, 'inventory_serving_id')
        need(config['Labels'].get('avtocena.role') == 'china-ui-grid-dark'
             and env.get('AVTOCENA_BUILD_CALCULATION_VERSION') == BUILD,
             'inventory_serving_build')
        # These are the existing installed identity guards, not new resource settings.
        need(state['OOMKilled'] is False and container['RestartCount'] == 0
             and host['Memory'] == host['MemorySwap'] == 4 * 1024**3
             and host['NanoCpus'] == 2000000000 and host['PidsLimit'] == 512
             and host['RestartPolicy'] == {'Name': 'unless-stopped', 'MaximumRetryCount': 0},
             'inventory_serving_resources')
    safe = {
        'name': name, 'id': container['Id'], 'image': image, 'release': revision,
        'port': port, 'pid': state['Pid'], 'startedAt': state['StartedAt'],
        'restartCount': container['RestartCount'], 'environmentSha256': digest(env),
        'environmentCount': len(env),
        'hostConfigSha256': digest(host), 'mountsSha256': digest(container['Mounts']),
        'containerConfigSha256': digest({k: v for k, v in config.items() if k != 'Env'}),
    }
    return safe, env


def snapshot(io):
    safe, environments = {}, {}
    for role in ROLES:
        safe[role[0]], environments[role[0]] = validate_container(io.inspect(role[1]), role)
    excluded = {'AVTOCENA_RELEASE_SHA', 'AVTOCENA_BUILD_CALCULATION_VERSION'}
    inherited = [{k: v for k, v in environments[kind].items() if k not in excluded}
                 for kind in ('serving', 'chinaRollback')]
    need(inherited[0] == inherited[1], 'inventory_env_inheritance')
    need(len({row['id'] for row in safe.values()}) == len(ROLES), 'inventory_role_id_duplicate')
    return safe


def verify_config(raw):
    need(isinstance(raw, bytes) and hashlib.sha256(raw).hexdigest() == NGINX_SHA256,
         'inventory_nginx_postimage')
    ports = re.findall(rb'(?m)^[\t ]*proxy_pass[\t ]+http://127\.0\.0\.1:(\d+);[\t ]*$', raw)
    need(ports == [b'3002'], 'inventory_nginx_upstream')


def verify_health(io):
    for role in ROLES:
        observed = io.health(role[4])
        need(observed.get('ok') is True and observed.get('releaseSha') == role[2]
             and observed.get('calculationVersion') == CALCULATION, 'inventory_health_identity')
    observed = io.health(443)
    need(observed.get('ok') is True and observed.get('releaseSha') == RELEASE
         and observed.get('calculationVersion') == CALCULATION, 'inventory_gateway_health')


def run_inventory(io):
    with io.lock():
        verify_config(io.config())
        before = snapshot(io)
        verify_health(io)
        need(3003 not in io.listening_ports(), 'inventory_candidate_port_listening')
        after = snapshot(io)
        verify_config(io.config())
        verify_health(io)
        need(before == after, 'inventory_identity_changed')
        need(3003 not in io.listening_ports(), 'inventory_candidate_port_listening')
        return {
            'version': 1, 'status': 'verified_inventory_requires_review', 'readOnly': True,
            'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'activationAuthorized': False, 'requiresReviewedRollbackPins': True,
            'lockMode': 'shared_nonblocking', 'nginxSha256': NGINX_SHA256,
            'containers': after,
            'rollbackPins': {kind: row['id'] for kind, row in after.items() if kind != 'serving'},
            'candidatePort': {'port': 3003, 'socketListening': False,
                              'dockerReservationVerified': False},
            'supplierRequests': 0, 'mutations': 0,
        }


def listening_ports_from_proc(raw):
    ports = set()
    for line in raw.splitlines()[1:]:
        fields = line.split()
        need(len(fields) >= 4, 'inventory_socket_table_invalid')
        if fields[3] == '0A':
            try:
                ports.add(int(fields[1].rsplit(':', 1)[1], 16))
            except (IndexError, ValueError):
                raise InventoryError('inventory_socket_table_invalid') from None
    return ports


class LoopbackTLS(http.client.HTTPSConnection):
    def connect(self):
        self.sock = self._context.wrap_socket(
            socket.create_connection(('127.0.0.1', 443), self.timeout), server_hostname=HOST)


class DockerUnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=20)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


class LocalIO:
    def __init__(self, docker_get=None):
        self.docker_get = docker_get or self._docker_get

    @staticmethod
    def _docker_get(path):
        need(path in DOCKER_GET_PATHS, 'inventory_docker_endpoint_scope')
        connection = DockerUnixHTTPConnection()
        try:
            # No CLI, API negotiation, redirects, ping, or mutation endpoints.
            connection.request('GET', path, headers={'Accept': 'application/json'})
            response = connection.getresponse()
            need(response.status == 200, 'inventory_inspect_http')
            raw = response.read(4194305)
            need(len(raw) <= 4194304, 'inventory_inspect_result')
            return raw
        except InventoryError:
            raise
        except Exception:
            raise InventoryError('inventory_inspect_failed') from None
        finally:
            connection.close()

    def inspect(self, name):
        need(name in {role[1] for role in ROLES}, 'inventory_inspect_scope')
        raw = self.docker_get('/containers/' + name + '/json')
        try:
            value = json.loads(raw)
            need(isinstance(value, dict), 'inventory_inspect_result')
            return value
        except (ValueError, TypeError):
            raise InventoryError('inventory_inspect_result') from None

    @contextlib.contextmanager
    def lock(self):
        try:
            fd = os.open(LOCK_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        except FileNotFoundError:
            raise InventoryError('inventory_lock_absent') from None
        except OSError:
            raise InventoryError('inventory_lock_unavailable') from None
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1,
                 'inventory_lock_metadata')
            try:
                fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except OSError:
                raise InventoryError('inventory_lock_busy') from None
            yield
        finally:
            os.close(fd)

    @staticmethod
    def config():
        try:
            fd = os.open(CONFIG_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as handle:
                info = os.fstat(handle.fileno())
                need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1,
                     'inventory_config_metadata')
                raw = handle.read(1048577)
                need(len(raw) <= 1048576, 'inventory_config_invalid')
                return raw
        except OSError:
            raise InventoryError('inventory_config_read_failed') from None

    @staticmethod
    def listening_ports():
        ports = set()
        try:
            for path in ('/proc/net/tcp', '/proc/net/tcp6'):
                with open(path, 'r', encoding='ascii') as handle:
                    ports.update(listening_ports_from_proc(handle.read()))
        except OSError:
            raise InventoryError('inventory_socket_read_failed') from None
        return ports

    @staticmethod
    def health(port):
        need(port in {443, 3000, 3001, 3002}, 'inventory_health_scope')
        connection = (LoopbackTLS(HOST, timeout=8, context=ssl.create_default_context()) if port == 443
                      else http.client.HTTPConnection('127.0.0.1', port, timeout=8))
        try:
            connection.request('GET', '/api/health', headers={'Host': HOST, 'Accept': 'application/json'})
            response = connection.getresponse()
            need(response.status == 200, 'inventory_health_http')
            raw = response.read(65537)
            need(len(raw) <= 65536, 'inventory_health_invalid')
            value = json.loads(raw)
            need(isinstance(value, dict), 'inventory_health_invalid')
            return value
        except InventoryError:
            raise
        except Exception:
            raise InventoryError('inventory_health_transport') from None
        finally:
            connection.close()


def main(argv=None, io=None):
    try:
        need(not (sys.argv[1:] if argv is None else argv), 'inventory_arguments_not_allowed')
        receipt = run_inventory(io or LocalIO())
        print(json.dumps(receipt, sort_keys=True))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, InventoryError) else 'inventory_failed'
        print(json.dumps({'status': 'failed', 'errorCode': code, 'readOnly': True,
                          'activationAuthorized': False}, sort_keys=True))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
