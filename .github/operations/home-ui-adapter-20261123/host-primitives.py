"""Exact catalog-0509 host operations. Imported by a reviewed driver; no activation CLI.

The existing acceptance.mjs owns the transaction order and publication lease.
Each mutating primitive calls its mandatory live-authority callback first. The
callback must prove that driver's own unexpired catalog lease/current manifest.
This module has no credentials, collector, catalog writer or remote transport.
"""
import contextlib
import copy
import fcntl
import hashlib
from html.parser import HTMLParser
import http.client
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import struct
import subprocess
import tempfile
import time
import urllib.parse

ROOT = Path(__file__).resolve().parents[3]
SOURCE = '0509e76cb02523157c98804c52edd7eb784916ba'
TREE = '6a65cc95e3bebeaf88fe972a9329f05c7474d06e'
BUILD = '5d791a95278c760ed50d53a4ddf78373f33980c228e7cdc3e1fc5d916bb48d9b'
CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
INDEX = 'bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b'
ASSET = 'ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662'
HOST = 'avtocena.com'
PORT = 3003
RESOURCE_TARGET = '/run/avtocena-node-resources'
PRIVATE_TARGET = '/app/data/knowledge/encyclopedia/calculation-v1.json'
PRIVATE_SOURCE = '/opt/avtocena/releases/' + SOURCE + '/home-private/calculation-v1.json'
RESOURCE_SOURCE = '/opt/avtocena/releases/' + SOURCE + '/home-node-resources'
ROLLBACK_PARENT = '/opt/avtocena/releases/' + SOURCE + '/home-rollback'
RELEASE_DIRECTORY = '/opt/avtocena/releases/' + SOURCE
PRIVATE_PARENT = str(Path(PRIVATE_SOURCE).parent)
INHERITED_OPTIONS = 'AVTOCENA_HOME_INHERITED_NODE_OPTIONS'
ROLLBACK_IDS = {
    'chinaRollback': 'e30facd9dc08d28b6e7d8b4423842b027e9b975befcf5bf52de09f29da60d6a7',
    'legacyRollback': '21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78',
}
GATES = {
    'scripts/regcloud-performance-gate.py': 'e16247e26a6ed63d3fb635b0ad1270a616d51b13f52bc6fe29b7801a1949d5ab',
    'scripts/regcloud-browser-verdict.py': '48853ef1f58e1cac5c3270adf8f03f7103b29ed83d8b1fb8d03573774cca827b',
    'docs/operations/2026-11-11-accepted-speed-baseline.json': '32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59',
}


class HostError(Exception):
    """Only a fixed code may cross the public receipt/log boundary."""


def need(value, code):
    if not value:
        raise HostError('home_host_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


inventory = load_module('home_inventory', ROOT / '.github/operations/home-ui-only-20261123/inventory.py')


def regular(path, *, mode=None, maximum=4 * 1024 * 1024):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, 'file_path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'file_metadata')
        need(mode is None or stat.S_IMODE(info.st_mode) == mode, 'file_mode')
        raw = handle.read(maximum + 1)
        need(len(raw) <= maximum, 'file_size')
    return raw, info


def owned_directory(path):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, 'directory_path')
    info = path.stat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
         and stat.S_IMODE(info.st_mode) == 0o700, 'directory_metadata')
    return path


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    with os.fdopen(fd, 'wb') as handle:
        os.fchmod(handle.fileno(), mode)
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())


def checked_inventory(value):
    need(value.get('version') == 1 and value.get('status') == 'verified_inventory_requires_review'
         and value.get('readOnly') is True and value.get('activationAuthorized') is False
         and value.get('requiresReviewedRollbackPins') is True, 'reviewed_inventory_required')
    need(value.get('rollbackPins') == ROLLBACK_IDS, 'rollback_ids')
    need(value.get('nginxSha256') == inventory.NGINX_SHA256, 'reviewed_nginx')
    need(set(value.get('containers', {})) == {'serving', *ROLLBACK_IDS}, 'inventory_roles')
    for role in inventory.ROLES:
        kind, name, revision, image, port, _ = role
        row = value['containers'][kind]
        need((row.get('name'), row.get('release'), row.get('image'), row.get('port'))
             == (name, revision, image, port), 'reviewed_role')
        need(row.get('id') == (inventory.SERVING_ID if kind == 'serving' else ROLLBACK_IDS[kind]), 'reviewed_id')
    serving = value['containers']['serving']
    need(serving.get('restartCount') == 1 and serving.get('startedAt') == inventory.SERVING_STARTED_AT,
         'reviewed_process')
    return value


def checked_plan(plan, reviewed_sha256, reviewed_inventory):
    need(re.fullmatch(r'[a-f0-9]{64}', reviewed_sha256 or '') and sha(json_bytes(plan)) == reviewed_sha256,
         'plan_not_reviewed')
    need(plan.get('version') == 1 and plan.get('source') == SOURCE and plan.get('tree') == TREE
         and plan.get('sourceCalculationVersion') == BUILD and plan.get('servingCalculationVersion') == CALCULATION
         and plan.get('privateIndexDigest') == INDEX, 'plan_source')
    need(re.fullmatch(r'[a-f0-9]{32}', plan.get('nonce', '')) is not None
         and re.fullmatch(r'sha256:[a-f0-9]{64}', plan.get('imageId', '')) is not None, 'plan_identity')
    need(plan.get('inventorySha256') == sha(json_bytes(checked_inventory(reviewed_inventory))), 'plan_inventory')
    need(re.fullmatch(r'[a-f0-9]{64}', plan.get('privateFileSha256', '')) is not None
         and type(plan.get('privateFileBytes')) is int and plan['privateFileBytes'] > 0, 'plan_private_file')
    expected_files = {'home-bootstrap.mjs', 'run-node-with-resources.mjs',
                      'lib/node-resource-memory.mjs', 'lib/node-resource-memory-startup.mjs'}
    need(set(plan.get('resourceFiles', {})) == expected_files
         and all(re.fullmatch(r'[a-f0-9]{64}', value) for value in plan['resourceFiles'].values()), 'plan_resource_files')
    need(plan.get('imageBuild', {}).get('version') == 1
         and plan['imageBuild'].get('status') == 'verified_exact_home_image_build'
         and plan['imageBuild'].get('activationAuthorized') is False
         and plan['imageBuild'].get('imageId') == plan['imageId']
         and plan['imageBuild'].get('source') == SOURCE and plan['imageBuild'].get('tree') == TREE
         and plan['imageBuild'].get('sourceCalculationVersion') == BUILD
         and plan['imageBuild'].get('nodeVersion') == 'v24.22.1'
         and plan['imageBuild'].get('modelAssetSha256') == ASSET
         and plan['imageBuild'].get('privateIndexInImage') is False
         and plan['imageBuild'].get('resourceProbePassed') is True
         and type(plan['imageBuild'].get('imageUnpackedBytes')) is int and plan['imageBuild']['imageUnpackedBytes'] > 0
         and plan['imageBuild'].get('resourceFiles') == plan['resourceFiles']
         and re.fullmatch(r'[a-f0-9]{64}', plan['imageBuild'].get('imageArchiveSha256', '')),
         'image_build_evidence')
    need(re.fullmatch(r'gen_\d+_[a-z0-9]+', plan.get('generationId', '')) is not None
         and re.fullmatch(r'[a-f0-9]{64}', plan.get('acceptedReadModelFingerprint', '')) is not None,
         'accepted_read_model_identity')
    return plan


def candidate_spec(plan, serving, *, mode='serve'):
    need(mode in ('serve', 'private-probe'), 'candidate_mode')
    env = inventory.environment(serving)
    need(INHERITED_OPTIONS not in env, 'inherited_options_collision')
    if 'NODE_OPTIONS' in env:
        env[INHERITED_OPTIONS] = env.pop('NODE_OPTIONS')
    env.update(AVTOCENA_RELEASE_SHA=SOURCE, AVTOCENA_BUILD_CALCULATION_VERSION=BUILD)
    need(env.get('AVTOCENA_CALCULATION_VERSION') == CALCULATION
         and env.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME') == '1', 'candidate_environment')
    binds = sorted([source + ':' + target + ':ro' for source, target in inventory.MOUNTS])
    binds += [RESOURCE_SOURCE + ':' + RESOURCE_TARGET + ':ro', PRIVATE_SOURCE + ':' + PRIVATE_TARGET + ':ro']
    return {
        'Image': plan['imageId'], 'WorkingDir': '/app', 'Entrypoint': ['node'],
        'Cmd': [RESOURCE_TARGET + '/home-bootstrap.mjs', mode],
        'Env': [key + '=' + value for key, value in sorted(env.items())],
        'Labels': {'org.opencontainers.image.revision': SOURCE, 'avtocena.role': 'home-ui-only-candidate',
                   'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena', 'avtocena.application': 'web',
                   'avtocena.home.nonce': plan['nonce']},
        'ExposedPorts': {'3000/tcp': {}},
        'HostConfig': {'Privileged': False, 'NetworkMode': 'bridge' if mode == 'serve' else 'none',
                       'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(PORT)}]} if mode == 'serve' else {},
                       'Binds': binds, 'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
    }


class DockerSocket(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=30)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


class LocalHost:
    """No Docker CLI, inherited Docker context, shell, remote endpoint or pull."""
    def __init__(self, plan, transport=None):
        self.plan = plan
        self.names = {'home-ui-' + SOURCE[:12] + '-' + plan['nonce'],
                      'home-ui-probe-' + SOURCE[:12] + '-' + plan['nonce']}
        self.owned = set()
        self.transport = transport or self._transport

    @staticmethod
    def _transport(method, endpoint, body):
        conn = DockerSocket()
        try:
            conn.request(method, endpoint, body=None if body is None else json_bytes(body),
                         headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
            response = conn.getresponse()
            raw = response.read(4 * 1024 * 1024 + 1)
            need(len(raw) <= 4 * 1024 * 1024, 'docker_response_bound')
            return response.status, raw
        except HostError:
            raise
        except Exception:
            raise HostError('home_host_docker_transport') from None
        finally:
            conn.close()

    def docker(self, method, endpoint, body=None):
        static_gets = {'/containers/json?all=1', '/images/' + self.plan['imageId'] + '/json', '/info'}
        static_gets.update('/containers/' + role[1] + '/json' for role in inventory.ROLES)
        allowed = method == 'GET' and endpoint in static_gets
        for identity in self.owned:
            prefix = '/containers/' + identity
            allowed |= (method == 'GET' and endpoint in (prefix + '/json', prefix + '/logs?stdout=1&stderr=1&tail=100'))
            allowed |= (method == 'POST' and endpoint in (prefix + '/start', prefix + '/stop?t=10', prefix + '/update', prefix + '/wait?condition=not-running'))
            allowed |= method == 'DELETE' and endpoint == prefix + '?v=false&force=false'
        allowed |= method == 'POST' and endpoint in {'/containers/create?name=' + name for name in self.names}
        need(allowed, 'docker_scope')
        if endpoint.endswith('/update'):
            need(body in ({'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
                          {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}}), 'docker_update_scope')
        status, raw = self.transport(method, endpoint, body)
        need(status in (200, 201, 204), 'docker_http')
        if '/logs?' in endpoint:
            return raw
        return json.loads(raw) if raw else None

    def create(self, spec, probe=False):
        name = ('home-ui-probe-' if probe else 'home-ui-') + SOURCE[:12] + '-' + self.plan['nonce']
        need(spec['Image'] == self.plan['imageId'], 'create_image')
        response = self.docker('POST', '/containers/create?name=' + name, spec)
        identity = response.get('Id')
        need(re.fullmatch(r'[a-f0-9]{64}', identity or '') is not None, 'create_response')
        self.owned.add(identity)
        return identity

    def inspect_retained(self, name):
        return self.docker('GET', '/containers/' + name + '/json')

    def inspect_owned(self, identity):
        need(identity in self.owned, 'owned_identity')
        return self.docker('GET', '/containers/' + identity + '/json')

    def free_port(self):
        rows = self.docker('GET', '/containers/json?all=1')
        need(isinstance(rows, list), 'container_list')
        need(all(all(port.get('PublicPort') != PORT for port in row.get('Ports', [])) for row in rows), 'port_reserved')
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            # No SO_REUSEADDR: an actual bind checks host availability. Docker
            # performs the final atomic bind when start runs; its failure blocks.
            sock.bind(('127.0.0.1', PORT))
        except OSError:
            raise HostError('home_host_port_bound') from None
        finally:
            sock.close()

    def transfer_capacity(self, directory, archive_bytes):
        # Inspect the actual engine data mount rather than assuming /var/lib/docker.
        info = self.docker('GET', '/info')
        root = Path(info.get('DockerRootDir', ''))
        need(root.is_absolute() and root.resolve() == root and root.is_dir()
             and root.stat().st_uid == 0, 'docker_data_directory')
        def free(target):
            value = os.statvfs(target)
            return value.f_bavail * value.f_frsize
        archive_free, engine_free = free(directory), free(root)
        unpacked = self.plan['imageBuild']['imageUnpackedBytes']
        shared = Path(directory).stat().st_dev == root.stat().st_dev
        need(archive_free >= archive_bytes + (unpacked if shared else 0)
             and engine_free >= unpacked + (archive_bytes if shared else 0), 'image_disk_capacity')
        return {'archiveFreeBytes': archive_free, 'engineFreeBytes': engine_free,
                'archiveBytes': archive_bytes, 'unpackedImageBytes': unpacked, 'sharedFilesystem': shared}

    @staticmethod
    def resource_snapshot():
        values = {}
        with open('/proc/meminfo', encoding='ascii') as handle:
            for line in handle:
                key = line.split(':', 1)[0]
                if key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'):
                    values[key] = int(line.split()[1]) * 1024
        need(set(values) == {'MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'}
             and values['MemTotal'] > 0 and values['MemAvailable'] > 0
             and 0 <= values['SwapFree'] <= values['SwapTotal'], 'host_resource_observation')
        return {**values, 'sampledAtNs': time.time_ns(), 'swapVerifiedForHeap': False}

    @staticmethod
    def health(target):
        need(target in ('candidate', 'retained', 'public'), 'health_scope')
        connection = (http.client.HTTPSConnection(HOST, timeout=10, context=ssl.create_default_context())
                      if target == 'public' else http.client.HTTPConnection('127.0.0.1', PORT if target == 'candidate' else 3002, timeout=10))
        try:
            connection.request('GET', '/api/health', headers={'Host': HOST, 'Accept': 'application/json',
                                                             'Cache-Control': 'no-cache', 'Connection': 'close'})
            response = connection.getresponse()
            raw = response.read(65537)
            need(response.status == 200 and len(raw) <= 65536, 'health_http')
            value = json.loads(raw)
            need(value.get('ok') is True and value.get('releaseSha') == (inventory.RELEASE if target == 'retained' else SOURCE)
                 and value.get('calculationVersion') == CALCULATION, 'health_identity')
            return True
        except HostError:
            raise
        except Exception:
            raise HostError('home_host_health_unavailable') from None
        finally:
            connection.close()


def candidate_identity(row, spec, identity, *, running=True, policy='no', healthy=True):
    need(row.get('Id') == identity and row.get('Image') == spec['Image'], 'candidate_identity')
    config, host, state = row['Config'], row['HostConfig'], row['State']
    for key in ('WorkingDir', 'Entrypoint', 'Cmd', 'Labels'):
        need(config.get(key) == spec[key], 'candidate_config')
    need(inventory.environment(row) == dict(item.split('=', 1) for item in spec['Env']), 'candidate_env')
    need(host.get('Privileged') is False and host.get('NetworkMode') == spec['HostConfig']['NetworkMode']
         and (host.get('PortBindings') or {}) == spec['HostConfig']['PortBindings'], 'candidate_host')
    # Do not silently inherit the old 4GiB/2CPU/512-PID budget or a daemon limit.
    need(all(host.get(key, 0) == 0 for key in ('Memory', 'MemorySwap', 'NanoCpus', 'CpuQuota', 'CpuPeriod', 'CpuShares'))
         and host.get('PidsLimit') in (None, -1) and not host.get('CpusetCpus')
         and host.get('RestartPolicy') == {'Name': policy, 'MaximumRetryCount': 0}, 'candidate_resource_config')
    expected = {(part.rsplit(':', 2)[0], part.rsplit(':', 2)[1]) for part in spec['HostConfig']['Binds']}
    mounts = row.get('Mounts', [])
    need(len(mounts) == len(expected) and all(item['Type'] == 'bind' and item['RW'] is False for item in mounts)
         and {(item['Source'], item['Destination']) for item in mounts} == expected, 'candidate_mounts')
    need(state.get('Running') is running, 'candidate_process')
    if healthy:
        need(state.get('OOMKilled') is False and row.get('RestartCount') == 0, 'candidate_process')
    if running:
        need(type(state.get('Pid')) is int and state['Pid'] > 0 and isinstance(state.get('StartedAt'), str), 'candidate_pid')
    return (identity, state.get('Pid'), state.get('StartedAt'), row['RestartCount'])


def decoded_logs(raw):
    # Docker non-TTY log framing. Never forward raw app output or exception text.
    chunks = []
    while raw:
        need(len(raw) >= 8 and raw[0] in (1, 2) and raw[1:4] == b'\0\0\0', 'probe_log_frame')
        length = struct.unpack('>I', raw[4:8])[0]
        need(len(raw) >= 8 + length, 'probe_log_frame')
        chunks.append(raw[8:8 + length])
        raw = raw[8 + length:]
    values = []
    for line in b''.join(chunks).splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get('stage') in ('node_resource_memory', 'home_private_probe'):
            values.append(value)
    return values


def memory_receipt(records):
    rows = [row for row in records if row['stage'] == 'node_resource_memory']
    need(len(rows) == 1 and rows[0].get('nodeVersion') == 'v24.22.1', 'startup_node_version')
    row = rows[0]
    keys = ('requestedHeapBytes', 'actualHeapBytes', 'physicalRamBytes', 'availableRamBytes',
            'usableSwapBytes', 'startupAvailableRamBytes', 'rssBytes', 'heapUsedBytes', 'externalBytes')
    need(all(type(row.get(key)) is int and row[key] >= 0 for key in keys)
         and row['requestedHeapBytes'] > 0 and row['requestedHeapBytes'] == row['actualHeapBytes']
         and row['requestedHeapBytes'] == (row['availableRamBytes'] + row['usableSwapBytes']) // 1048576 * 1048576, 'startup_heap')
    optional = ('constrainedRamBytes', 'observedSwapFreeBytes', 'cgroupMemoryHeadroomBytes', 'cgroupSwapHeadroomBytes', 'cgroupScopes')
    need(all(row.get(key) is None or type(row[key]) is int and row[key] >= 0 for key in optional), 'startup_memory_observation')
    reason = row.get('swapReason')
    need(reason is None or re.fullmatch(r'[a-z0-9_]{1,80}', reason) is not None, 'startup_swap_reason')
    return {'nodeVersion': row['nodeVersion'], **{key: row[key] for key in keys},
            **{key: row.get(key) for key in optional}, 'swapReason': reason}


class NginxCompareAndSwap:
    def __init__(self, rollback_directory, guard, *, config_path=inventory.CONFIG_PATH, command=None):
        need(callable(guard), 'authority_callback')
        self.guard, self.config_path = guard, Path(config_path)
        self.directory = Path(rollback_directory)
        self.command = command or self._command
        self.before = self.after = None

    @staticmethod
    def _command(args):
        need(args in (['/usr/sbin/nginx', '-t'], ['/usr/bin/systemctl', 'reload', 'nginx']), 'nginx_command')
        result = subprocess.run(args, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        need(result.returncode == 0, 'nginx_command_failed')

    def prepare(self):
        self.guard('ingress_prepare')
        before, _ = regular(self.config_path, maximum=1024 * 1024)
        inventory.verify_config(before)
        after, count = re.subn(rb'(?m)^([\t ]*proxy_pass[\t ]+http://127\.0\.0\.1:)3002(;[\t ]*)$',
                               rb'\g<1>3003\g<2>', before)
        need(count == 1, 'nginx_single_upstream')
        owned_directory(self.directory.parent)
        self.directory.mkdir(mode=0o700)
        write_new(self.directory / 'nginx.before', before)
        write_new(self.directory / 'nginx.after.sha256', sha(after).encode())
        fsync_directory(self.directory)
        fsync_directory(self.directory.parent)
        self.before, self.after = before, after
        return {'beforeSha256': sha(before), 'afterSha256': sha(after)}

    def replace(self, target, expected):
        need(self.before is not None and target in (self.before, self.after), 'nginx_transaction')
        current, info = regular(self.config_path, maximum=1024 * 1024)
        need(sha(current) == expected, 'nginx_foreign_preimage')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.config_path.parent, prefix='.home-ui-', delete=False) as handle:
                temporary = Path(handle.name)
                os.fchmod(handle.fileno(), stat.S_IMODE(info.st_mode))
                os.fchown(handle.fileno(), info.st_uid, info.st_gid)
                handle.write(target)
                handle.flush()
                os.fsync(handle.fileno())
                need(sha(regular(self.config_path, maximum=1024 * 1024)[0]) == expected, 'nginx_foreign_preimage_race')
                os.replace(temporary, self.config_path)
                fsync_directory(self.config_path.parent)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def reload(self):
        self.command(['/usr/sbin/nginx', '-t'])
        self.command(['/usr/bin/systemctl', 'reload', 'nginx'])

    def switch(self):
        self.guard('ingress_switch')
        self.replace(self.after, sha(self.before))
        self.reload()
        need(regular(self.config_path)[0] == self.after, 'nginx_switch_readback')

    def rollback(self):
        # Restoration remains possible when a lease is lost. Never replace a
        # foreign postimage and never stop the candidate until retained health.
        current = regular(self.config_path)[0]
        need(self.before is not None and current in (self.before, self.after), 'nginx_foreign_rollback')
        if current == self.after:
            self.replace(self.before, sha(self.after))
        self.reload()
        need(regular(self.config_path)[0] == self.before, 'nginx_rollback_readback')


class HostPrimitives:
    def __init__(self, plan, reviewed_plan_sha256, reviewed_inventory, authority, *, local=None):
        self.plan = checked_plan(plan, reviewed_plan_sha256, reviewed_inventory)
        need(callable(authority), 'authority_callback')
        self.authority, self.reviewed_inventory = authority, reviewed_inventory
        self.local = local or LocalHost(plan)
        self.candidate = self.spec = self.process = None
        self.restart_policy = 'no'
        self.locked = False
        self.ingress = None

    @contextlib.contextmanager
    def runtime_lock(self):
        fd = os.open(inventory.LOCK_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        try:
            metadata = os.fstat(fd)
            need(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1, 'lock_metadata')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.locked = True
            try:
                yield
            finally:
                self.locked = False
        finally:
            os.close(fd)

    def guard(self, phase):
        need(self.locked, 'runtime_lock_required')
        self.authority(phase, self.plan['generationId'], self.plan['acceptedReadModelFingerprint'])

    def fresh_inventory(self):
        self.guard('retained_identity')
        reader = inventory.LocalIO(lambda path: json_bytes(self.local.inspect_retained(path.split('/')[2])))
        snapshot = inventory.snapshot(reader)
        need(snapshot == self.reviewed_inventory['containers'], 'retained_inventory_changed')
        inventory.verify_config(inventory.LocalIO.config())
        inventory.verify_health(inventory.LocalIO())
        return self.local.inspect_retained(inventory.ROLES[0][1])

    def checked_materials(self):
        self.guard('materials')
        owned_directory(PRIVATE_PARENT)
        raw, _ = regular(PRIVATE_SOURCE, mode=0o400, maximum=self.plan['privateFileBytes'])
        need(len(raw) == self.plan['privateFileBytes'] and sha(raw) == self.plan['privateFileSha256'], 'private_file_changed')
        owned_directory(RESOURCE_SOURCE)
        for relative, expected in self.plan['resourceFiles'].items():
            raw, info = regular(Path(RESOURCE_SOURCE) / relative)
            need(not (info.st_mode & 0o022) and sha(raw) == expected, 'resource_bundle_changed')
        image = self.local.docker('GET', '/images/' + self.plan['imageId'] + '/json')
        need(image.get('Id') == self.plan['imageId'] and image.get('Config', {}).get('Labels') == {
                 'org.opencontainers.image.revision': SOURCE, 'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena',
                 'avtocena.application': 'web'}
             and image['Config'].get('WorkingDir') == '/app' and image['Config'].get('Cmd') == ['node', 'apps/web/server.js'], 'loaded_image')

    def prepare_material_directories(self):
        self.guard('material_directories')
        releases = Path(RELEASE_DIRECTORY).parent
        info = releases.stat()
        need(releases.resolve() == releases and stat.S_ISDIR(info.st_mode) and info.st_uid == 0
             and not (info.st_mode & 0o022), 'release_parent')
        for directory in (RELEASE_DIRECTORY, PRIVATE_PARENT, RESOURCE_SOURCE,
                          str(Path(RESOURCE_SOURCE) / 'lib'), ROLLBACK_PARENT):
            try:
                os.mkdir(directory, 0o700)
                fsync_directory(Path(directory).parent)
            except FileExistsError:
                pass
            owned_directory(directory)

    def install_resource_bundle(self, files):
        self.guard('resource_materialize')
        need(isinstance(files, dict) and set(files) == set(self.plan['resourceFiles']), 'resource_input_paths')
        owned_directory(RESOURCE_SOURCE)
        owned_directory(Path(RESOURCE_SOURCE) / 'lib')
        for relative, expected in self.plan['resourceFiles'].items():
            raw = files[relative]
            need(isinstance(raw, bytes) and sha(raw) == expected, 'resource_input_digest')
        # Validate every input first. Only four pinned files can be created;
        # existing differing bytes are never overwritten or made executable.
        for relative, raw in files.items():
            target = Path(RESOURCE_SOURCE) / relative
            if os.path.lexists(target):
                need(sha(regular(target, mode=0o400)[0]) == self.plan['resourceFiles'][relative], 'existing_resource_file')
            else:
                write_new(target, raw, 0o400)
                fsync_directory(target.parent)
        return {'files': len(files), 'sha256': dict(self.plan['resourceFiles'])}

    def install_private_index(self, stream):
        """Install only the plan's verified REG-restored bytes, never overwrite.

        The driver uses the existing private-binding/REG restore checks first;
        its reviewed plan pins this full-file SHA and byte count. The separate
        network-isolated image probe rechecks JSON.stringify(models)==bf2….
        """
        self.guard('private_materialize')
        parent = owned_directory(PRIVATE_PARENT)
        target = Path(PRIVATE_SOURCE)
        if os.path.lexists(target):
            raw, _ = regular(target, mode=0o400, maximum=self.plan['privateFileBytes'])
            need(len(raw) == self.plan['privateFileBytes'] and sha(raw) == self.plan['privateFileSha256'], 'existing_private_file')
            return {'created': False, 'sha256': sha(raw), 'bytes': len(raw)}
        temporary = parent / ('.index-' + self.plan['nonce'] + '.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        digest, count = hashlib.sha256(), 0
        try:
            with os.fdopen(fd, 'wb') as handle:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    need(isinstance(chunk, bytes), 'private_input_type')
                    count += len(chunk)
                    need(count <= self.plan['privateFileBytes'], 'private_input_size')
                    digest.update(chunk)
                    handle.write(chunk)
                need(count == self.plan['privateFileBytes'] and digest.hexdigest() == self.plan['privateFileSha256'], 'private_input_digest')
                os.fchmod(handle.fileno(), 0o400)
                handle.flush()
                os.fsync(handle.fileno())
            # Atomic create-if-absent. A file that appeared meanwhile is never
            # replaced, even if it happens to have a plausible name.
            os.link(temporary, target, follow_symlinks=False)
            temporary.unlink()
            fsync_directory(parent)
            return {'created': True, 'sha256': digest.hexdigest(), 'bytes': count}
        finally:
            temporary.unlink(missing_ok=True)

    def private_probe(self, serving):
        self.guard('private_probe')
        spec = candidate_spec(self.plan, serving, mode='private-probe')
        identity = self.local.create(spec, probe=True)
        try:
            self.local.docker('POST', '/containers/' + identity + '/start')
            result = self.local.docker('POST', '/containers/' + identity + '/wait?condition=not-running')
            need(result.get('StatusCode') == 0 and not result.get('Error'), 'private_probe_exit')
            row = self.local.inspect_owned(identity)
            candidate_identity(row, spec, identity, running=False)
            records = decoded_logs(self.local.docker('GET', '/containers/' + identity + '/logs?stdout=1&stderr=1&tail=100'))
            memory = memory_receipt(records)
            index = [item for item in records if item['stage'] == 'home_private_probe']
            need(len(index) == 1 and index[0].get('passed') is True and index[0].get('indexDigest') == INDEX
                 and index[0].get('fileSha256') == self.plan['privateFileSha256'], 'private_probe_index')
            return {'privateIndexVerified': True, **memory}
        finally:
            # This owned, network-isolated probe never receives traffic.
            row = self.local.inspect_owned(identity)
            candidate_identity(row, spec, identity, running=row['State']['Running'], healthy=False)
            if row['State']['Running']:
                self.local.docker('POST', '/containers/' + identity + '/stop?t=10')
            self.local.docker('DELETE', '/containers/' + identity + '?v=false&force=false')

    def start_candidate(self):
        self.guard('candidate_start')
        need(self.candidate is None, 'candidate_already_created')
        serving = self.fresh_inventory()
        self.checked_materials()
        probe = self.private_probe(serving)
        self.fresh_inventory()
        self.checked_materials()
        self.local.free_port()
        capacity = self.local.resource_snapshot()
        self.guard('candidate_create')
        self.spec = candidate_spec(self.plan, serving)
        self.candidate = self.local.create(self.spec)
        try:
            self.local.docker('POST', '/containers/' + self.candidate + '/start')
            self.process = candidate_identity(self.local.inspect_owned(self.candidate), self.spec, self.candidate)
            deadline = time.monotonic() + 60
            while True:
                try:
                    self.local.health('candidate')
                    break
                except HostError:
                    self.verify_candidate(health=False)
                    need(time.monotonic() < deadline, 'candidate_health_timeout')
                    time.sleep(1)
            startup = memory_receipt(decoded_logs(self.local.docker('GET', '/containers/' + self.candidate + '/logs?stdout=1&stderr=1&tail=100')))
            return {'id': self.candidate, 'imageId': self.plan['imageId'], 'source': SOURCE,
                    'resourceProbe': probe, 'startupResources': startup, 'hostResourcesBeforeStart': capacity, 'port': PORT}
        except BaseException:
            # No ingress operation was attempted yet. An error must not leak a
            # new running process merely because the driver never received it.
            self.cleanup_candidate()
            self.candidate = None
            raise

    def verify_candidate(self, *, health=True):
        self.guard('candidate_identity')
        need(self.candidate is not None, 'candidate_missing')
        current = candidate_identity(self.local.inspect_owned(self.candidate), self.spec, self.candidate,
                                     policy=self.restart_policy)
        need(current == self.process, 'candidate_process_changed')
        if health:
            self.local.health('candidate')
        return current

    def switch(self, rollback_directory):
        need(Path(rollback_directory) == Path(ROLLBACK_PARENT) / self.plan['nonce'], 'rollback_directory_scope')
        self.verify_candidate()
        self.fresh_inventory()
        ingress = NginxCompareAndSwap(rollback_directory, self.guard)
        ingress.prepare()
        # A transaction exists only once its exact before/after bytes exist.
        # A failed authority/preparation check has not touched live ingress.
        self.ingress = ingress
        self.local.docker('POST', '/containers/' + self.candidate + '/update',
                          {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}})
        self.restart_policy = 'unless-stopped'
        self.verify_candidate()
        self.ingress.switch()

    def rollback(self):
        need(self.locked and self.ingress is not None, 'rollback_transaction')
        self.ingress.rollback()
        inventory.verify_health(inventory.LocalIO())
        self.local.docker('POST', '/containers/' + self.candidate + '/update',
                          {'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}})
        self.restart_policy = 'no'

    def cleanup_candidate(self):
        need(self.locked and self.candidate in self.local.owned, 'cleanup_owned_lock')
        inventory.verify_config(inventory.LocalIO.config())
        inventory.verify_health(inventory.LocalIO())
        row = self.local.inspect_owned(self.candidate)
        candidate_identity(row, self.spec, self.candidate, running=row['State']['Running'], policy=self.restart_policy, healthy=False)
        if row['State']['Running']:
            self.local.docker('POST', '/containers/' + self.candidate + '/stop?t=10')
        self.local.docker('DELETE', '/containers/' + self.candidate + '?v=false&force=false')


PARITY_MARKETS = ('china', 'korea', 'uae', 'europe', 'georgia')

CHINA_GRID = '/api/catalog/search?market=china&marketPage=1&page=1'
CHINA_SAVED_GRID = CHINA_GRID + '&source=existing'
CHINA_FILTER = '/api/catalog/search?market=china&source=existing&powerTo=160'
CHINA_FILTER_PAGES = [CHINA_FILTER + '&marketPage=1&page=' + str(page) for page in (1, 2)]
CHINA_CUT = 'gen_1795239842026_china44871616387'
CHINA_TOTAL = 168662
CHINA_FILTER_TOTAL = 64605


def parity_search(market):
    if market == 'china':
        return CHINA_GRID
    return '/api/catalog/search?source=existing&market=' + market + '&pageSize=2'


def verify_saved_china(get, where, canonical):
    status, _, raw = get(where, CHINA_SAVED_GRID)
    need(status == 200 and json.loads(raw) == canonical and canonical.get('total') == CHINA_TOTAL
         and canonical.get('generationId') == CHINA_CUT and len(canonical['items']) == 24, 'china_saved_grid')
    ids = set()
    for route in [CHINA_FILTER + '&countOnly=1', *CHINA_FILTER_PAGES]:
        status, _, raw = get(where, route)
        need(status == 200, 'china_filter_http')
        data = json.loads(raw)
        need(data.get('ok') is True and data.get('total') == CHINA_FILTER_TOTAL
             and data.get('generationId') == CHINA_CUT, 'china_filter_count')
        if route.endswith('countOnly=1'):
            need(data.get('items') == [], 'china_count_items')
            continue
        need(len(data.get('items', [])) == 24, 'china_filter_rows')
        for row in data['items']:
            item_id = row.get('id')
            need(isinstance(item_id,str) and re.fullmatch(r'[a-f0-9]{24}',item_id)
                 and item_id not in ids and row.get('market') == 'china'
                 and (row.get('preparedChinaSelection') or {}).get('generationId') == CHINA_CUT,'china_filter_membership')
            ids.add(item_id)
    return {'rows': CHINA_TOTAL, 'powerTo160': CHINA_FILTER_TOTAL, 'distinctPageIds':len(ids)}


def public_get(where, path):
    need(where in ('retained', 'candidate', 'public'), 'parity_origin')
    searches = {parity_search(market) for market in PARITY_MARKETS} | {CHINA_SAVED_GRID, CHINA_FILTER + '&countOnly=1', *CHINA_FILTER_PAGES}
    parsed = urllib.parse.urlsplit(path)
    detail = re.fullmatch(r'/cars/offer/[a-f0-9]{24}(?:/[a-z0-9-]{1,200})?', parsed.path)
    query = urllib.parse.parse_qs(parsed.query)
    need(path in {'/api/catalog/home', '/api/crm/reviews', *searches}
         or detail and not parsed.netloc and not parsed.fragment and set(query) == {'market'}
         and query['market'][0] in PARITY_MARKETS and len(query['market']) == 1, 'parity_path')
    connection = (http.client.HTTPSConnection(HOST, timeout=90, context=ssl.create_default_context()) if where == 'public'
                  else http.client.HTTPConnection('127.0.0.1', PORT if where == 'candidate' else 3002, timeout=90))
    try:
        headers = {'Host': HOST, 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache', 'Connection': 'close'}
        if where != 'public' and query.get('market') == ['korea']:
            connection_parts = os.environ.get('SSH_CONNECTION', '').split()
            need(len(connection_parts) == 4, 'parity_ssh_peer_missing')
            try:
                peer = ipaddress.ip_address(connection_parts[0])
            except ValueError:
                raise HostError('home_host_parity_ssh_peer_invalid') from None
            need(peer.is_global, 'parity_ssh_peer_not_public')
            headers['X-Real-IP'] = str(peer)
        connection.request('GET', path, headers=headers)
        response = connection.getresponse()
        raw = response.read(20 * 1024 * 1024 + 1)
        need(len(raw) <= 20 * 1024 * 1024, 'parity_response_bound')
        return response.status, response.getheader('Location'), raw
    except HostError:
        raise
    except Exception:
        raise HostError('home_host_parity_transport') from None
    finally:
        connection.close()


def browser_card(value):
    result = copy.deepcopy(value)
    operational = result.get('operational')
    evidence = operational.get('semanticEvidence') if isinstance(operational, dict) else None
    if isinstance(evidence, dict):
        for fact in evidence.values():
            if isinstance(fact, dict) and isinstance(fact.get('provenance'), list):
                del fact['provenance']
    return result


class DetailIdentity(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'main' and 'data-offer-id' in values:
            self.rows.append({key: value for key, value in values.items() if key.startswith('data-offer-')})


def detail_identity(get, where, row):
    identity, market = row.get('id'), row.get('market')
    need(re.fullmatch(r'[a-f0-9]{24}', identity or '') is not None and market in PARITY_MARKETS, 'detail_identity')
    prefix = '/cars/offer/' + identity
    path = prefix + '?market=' + market
    status, location, raw = get(where, path)
    if status in (307, 308):
        target = urllib.parse.urlsplit(urllib.parse.urljoin('https://' + HOST, location or ''))
        need(target.scheme == 'https' and target.netloc == HOST and not target.fragment
             and re.fullmatch(re.escape(prefix) + r'/[a-z0-9-]{1,200}', target.path) is not None
             and urllib.parse.parse_qsl(target.query) == [('market', market)], 'detail_redirect')
        status, _, raw = get(where, target.path + '?' + target.query)
    need(status == 200 and b'</html>' in raw and b'$RX(' not in raw, 'detail_complete')
    parsed = DetailIdentity()
    parsed.feed(raw.decode('utf8'))
    need(len(parsed.rows) == 1 and parsed.rows[0].get('data-offer-id') == identity, 'detail_bound_offer')
    # Missing/null are not changed into zero or an invented quote. The exact
    # retained/candidate attributes are compared even for unpriced cards.
    if type(row.get('totalRub')) is int and row['totalRub'] > 0:
        need(parsed.rows[0].get('data-offer-price-rub') == str(row['totalRub']), 'detail_price')
    return parsed.rows[0]


def check_card_price_auth_parity(guard, *, get=public_get, target='candidate'):
    """Small saved snapshots only. No namespace preparation or provider URL."""
    need(target in ('candidate', 'public') and callable(guard), 'parity_context')
    guard('private_parity' if target == 'candidate' else 'public_parity')
    before, after = {}, {}
    for where, bucket in (('retained', before), (target, after)):
        status, _, raw = get(where, '/api/crm/reviews')
        need(status == 401, 'anonymous_crm_authorization')
        paths = ['/api/catalog/home'] + [parity_search(market) for market in PARITY_MARKETS]
        for path in paths:
            status, _, raw = get(where, path)
            need(status == 200, 'parity_api_status')
            value = json.loads(raw)
            need(isinstance(value, dict) and not value.get('error') and value.get('ok') is not False
                 and not any(value.get(key) for key in ('stale', 'partial', 'interrupted', 'countIncomplete'))
                 and isinstance(value.get('items'), list) and value['items']
                 and type(value.get('total')) is int and value['total'] > 0, 'parity_api_complete')
            # Only the intentionally removed home bibliography differs. Every
            # other row, price/unknown value, count and generation stays exact.
            if path == '/api/catalog/home':
                value['items'] = [browser_card(row) for row in value['items']]
            bucket[path] = value
            if path != '/api/catalog/home':
                first = value['items'][0]
                bucket['detail:' + first['market']] = detail_identity(get, where, first)
    need(before == after, 'card_price_or_generation_changed')
    china_search = verify_saved_china(get, target, after[CHINA_GRID])
    guard('parity_readback')
    return {'source': SOURCE, 'target': target, 'passed': True, 'anonymousCrmRejected': True,
            'catalogWrites': 0, 'supplierRequests': 0, 'snapshotSha256': inventory.digest(before),
            'marketSamples': len(PARITY_MARKETS), 'chinaSearch':china_search, 'homeCards': len(before['/api/catalog/home']['items'])}


def run_full_server_gate(controller_root, nonce, phase, execute=subprocess.run):
    need(re.fullmatch(r'[a-f0-9]{32}', nonce or '') and phase in ('private', 'public'), 'server_context')
    root = Path(controller_root)
    for relative, expected in GATES.items():
        need(sha(regular(root / relative)[0]) == expected, 'server_gate_source')
    baseline = 'docs/operations/2026-11-11-accepted-speed-baseline.json'
    routes = list(dict.fromkeys(row['path'] for row in json.loads(regular(root / baseline)[0])['samples']))
    need(len(routes) == 17, 'server_routes')
    base = 'http://127.0.0.1:3003' if phase == 'private' else 'https://avtocena.com'
    env = {'PATH': '/usr/bin:/bin', 'AVTOCENA_RELEASE_MARKETS': '', 'AVTOCENA_SPEED_BASELINE_MODE': 'enforce',
           'AVTOCENA_SPEED_BASELINE': str(root / baseline)}
    # An SSH peer is needed only for any original route that requires it. It
    # may come from sshd's real connection, never a fabricated proxy address.
    if 'SSH_CONNECTION' in os.environ:
        env['SSH_CONNECTION'] = os.environ['SSH_CONNECTION']
    result = execute(['/usr/bin/python3', '-I', '-B', str(root / 'scripts/regcloud-performance-gate.py'), base, SOURCE],
                     env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1800)
    need(result.returncode == 0, 'server_gate_failed')
    rows = []
    for line in result.stdout.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    summaries = [row for row in rows if row.get('performanceGate') == 'summary']
    phases = [row for row in rows if row.get('performanceGate') in ('warm', 'after_ttl', 'after_directory_ttl')]
    need(len(summaries) == 1, 'server_summary')
    summary = summaries[0]
    need(summary.get('marketScope') == '' and summary.get('functionalPassed') is True
         and summary.get('acceptedBaselineEnforced') is True and summary.get('samples') == 51
         and set(summary.get('routes', [])) == set(routes) and set(summary.get('acceptedBaselineRoutes', [])) == set(routes)
         and len(phases) == 51, 'server_coverage')
    for route in routes:
        for period in ('warm', 'after_ttl', 'after_directory_ttl'):
            need(sum(row.get('path') == route and row.get('performanceGate') == period
                     and row.get('functionalPassed') is True for row in phases) == 1, 'server_phase_missing')
    return {'release': SOURCE, 'nonce': nonce, 'phase': phase, 'exitCode': 0,
            'logSha256': sha(result.stdout), 'baselineSha256': GATES[baseline], 'summary': summary, 'phases': phases}


def wait_browser(controller_root, directory, nonce):
    need(re.fullmatch(r'[a-f0-9]{32}', nonce or '') is not None, 'browser_nonce')
    directory = owned_directory(directory)
    for kind in ('browser-ready-', 'browser-verdict-'):
        target = directory / (kind + nonce + '.json')
        need(not os.path.lexists(target) and not os.path.lexists(target.with_suffix('.tmp')), 'browser_nonce_used')
    path = Path(controller_root) / 'scripts/regcloud-browser-verdict.py'
    need(sha(regular(path)[0]) == GATES['scripts/regcloud-browser-verdict.py'], 'browser_gate_source')
    module = load_module('home_browser_verdict', path)
    return module.wait_for_verdict(directory, SOURCE, nonce)


if __name__ == '__main__':
    raise SystemExit('home_host_no_activation_entrypoint')
