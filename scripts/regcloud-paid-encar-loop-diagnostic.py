#!/usr/bin/env python3
"""One bounded local replay against an owner-labelled exact-image clone.

Does not publish ports beyond loopback, touch Nginx, start the rejected original,
collect suppliers, change source controls, or print private configuration/logs.
Public routes may perform their existing normal derivative writes.
"""
import argparse
import base64
import fcntl
import hashlib
import http.client
import json
import os
import pathlib
import queue
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid

RELEASE = '9cb571fcce503c9a3ca1a1496514899839b75395'
IMAGE = 'sha256:44c596a793bb0c75f4c3e30f40a8fe6b6f6a3c9501ab0c3eb0ae38953e682885'
RETAINED = 'a182cd21b21ecf612b63613d263e5bdd817ea4c0'
CALCULATION = '67fe0492c93784b490491f90a9820101959c0a2f39f276a1c4f5798408ac431a'
ORIGINAL = 'avtocena-release-' + RELEASE[:12]
PRODUCTION = 'avtocena-production'
NGINX = pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf')
MAX_SECONDS = 240
BODY_LIMIT = 20 * 1024 * 1024
DIAGNOSTIC_DEADLINE = None
QUERY_KEYS = {'scope', 'market', 'make', 'model', 'q', 'limit', 'color', 'bodyType', 'transmission', 'fuel', 'drive', 'yearFrom', 'yearTo', 'budgetFrom', 'budgetTo', 'budget', 'mileageFrom', 'mileageTo', 'engineFrom', 'engineTo', 'powerFrom', 'powerTo'}


class ScopeError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise ScopeError(code)


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}, ensure_ascii=False), flush=True)


def command(args, timeout=15):
    # Never let Docker's stderr echo environment arguments or private content.
    if DIAGNOSTIC_DEADLINE is not None:
        timeout = min(timeout, DIAGNOSTIC_DEADLINE - time.monotonic())
        require(timeout > 0, 'diagnostic_total_deadline')
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, 'docker_command_failed')
    return result.stdout


def inspect(name):
    return json.loads(command(['docker', 'inspect', name]))[0]


def port_of(info):
    ports = info['HostConfig']['PortBindings']
    require(set(ports) == {'3000/tcp'}, 'unexpected_published_ports')
    require(len(ports['3000/tcp']) == 1 and ports['3000/tcp'][0]['HostIp'] == '127.0.0.1', 'http_not_loopback')
    actual = info['NetworkSettings']['Ports']['3000/tcp']
    require(len(actual) == 1 and actual[0]['HostIp'] == '127.0.0.1', 'http_actual_not_loopback')
    return int(actual[0]['HostPort'])


def safe_query(encoded):
    try:
        query = base64.b64decode(encoded, validate=True).decode('utf-8') if encoded else ''
    except (ValueError, UnicodeDecodeError):
        raise ScopeError('models_query_encoding') from None
    require(len(query) <= 1600 and not any(ord(char) < 32 for char in query), 'models_query_size_or_controls')
    require(not query.startswith('?') and '#' not in query, 'models_query_format')
    pairs = urllib.parse.parse_qsl(query, keep_blank_values=True, strict_parsing=True) if query else []
    require(len(pairs) <= 24 and len({key for key, _ in pairs}) == len(pairs), 'models_query_duplicate_or_count')
    for key, value in pairs:
        require(key in QUERY_KEYS and len(value) <= 240 and not any(ord(char) < 32 for char in value), 'models_query_scope')
        require(not any(char in value for char in ['/', '\\', '<', '>']), 'models_query_value')
    scope = dict(pairs).get('scope', '')
    require(scope in {'', 'inventory', 'autocalc', 'facets', 'makes'}, 'models_query_scope_value')
    return urllib.parse.urlencode(pairs)


def paths_for(scenario, models_query):
    if scenario == 'incident':
        return ['/cars/brand/chrysler/model/crossfire', '/api/catalog/models' + ('?' + models_query if models_query else '')]
    if scenario == 'sort-korea':
        return ['/cars?sort=totalRub', '/cars?market=korea']
    if scenario == 'power160':
        return ['/cars?powerTo=160&sort=totalRub', '/api/catalog/search?market=korea&powerTo=160&pageSize=6']
    raise ScopeError('scenario_scope')


def public_request(port, path, timeout, health=False):
    started = time.monotonic()
    deadline = started + timeout
    result = {'path': path, 'status': None, 'headersSeconds': None, 'bytes': 0, 'eof': False}
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    response = None
    body = bytearray()
    try:
        # No cookies, visitor token, X-Forwarded-For, or arbitrary destination.
        connection.request('GET', path, headers={'User-Agent': 'AvtoCena-Isolated-Diagnostic', 'Connection': 'close'})
        response = connection.getresponse()
        result.update(status=response.status, headersSeconds=round(time.monotonic() - started, 4))
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            current_socket = connection.sock or getattr(getattr(response.fp, 'raw', None), '_sock', None)
            if current_socket:
                current_socket.settimeout(remaining)
            block = response.read1(65536)
            if not block:
                result['eof'] = True
                break
            result['bytes'] += len(block)
            require(result['bytes'] <= (65536 if health else BODY_LIMIT), 'response_body_limit')
            body.extend(block)
        if path.startswith('/api/'):
            try:
                value = json.loads(body)
                result['jsonComplete'] = isinstance(value, dict)
                if isinstance(value, dict):
                    result['ok'] = value.get('ok') if isinstance(value.get('ok'), bool) else None
                    for name in ['items', 'models']:
                        if isinstance(value.get(name), list):
                            result[name + 'Count'] = len(value[name])
                    if health:
                        result['releaseSha'] = value.get('releaseSha')
                        result['calculationVersion'] = value.get('calculationVersion')
            except (ValueError, UnicodeDecodeError):
                result['jsonComplete'] = False
        else:
            result['htmlClosed'] = b'</html>' in body
            result['streamErrorMarker'] = b'$RX(' in body
            result['linkedCards'] = len(set(re.findall(rb'href="(/cars/offer/[^"?#]+)', body)))
    except (TimeoutError, socket.timeout):
        result['error'] = 'request_deadline'
    except ScopeError as error:
        result['error'] = str(error)
    except Exception as error:
        result['error'] = type(error).__name__
    finally:
        if response:
            response.close()
        connection.close()
    result['seconds'] = round(time.monotonic() - started, 4)
    return result


def production_snapshot():
    info = inspect(PRODUCTION)
    require(info['State']['Running'], 'production_not_running')
    require(info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == RETAINED, 'production_release_scope')
    remaining = 15 if DIAGNOSTIC_DEADLINE is None else min(15, DIAGNOSTIC_DEADLINE - time.monotonic())
    require(remaining > 0, 'diagnostic_total_deadline')
    response = public_request(port_of(info), '/api/health', remaining, health=True)
    require(response.get('status') == 200 and response.get('ok') is True and response.get('releaseSha') == RETAINED, 'production_health_scope')
    return {'id': info['Id'], 'image': info['Image'], 'pid': info['State']['Pid'], 'restarts': info['RestartCount'], 'releaseSha': response['releaseSha'], 'calculationVersion': response.get('calculationVersion')}


def validate_candidate(info):
    require(not info['State']['Running'], 'original_candidate_must_be_stopped')
    require(info['Image'] == IMAGE, 'candidate_image_scope')
    require(info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == RELEASE, 'candidate_release_scope')
    require(info['HostConfig']['Memory'] == 10 * 1024 ** 3 and info['HostConfig']['NanoCpus'] == 6_000_000_000, 'candidate_serving_resources_changed')
    require(len(info.get('Mounts', [])) == 1, 'candidate_mount_count')
    mount = info['Mounts'][0]
    require(mount.get('Type') == 'bind' and mount.get('Source') == '/opt/avtocena/metrics' and mount.get('Destination') == '/run/avtocena-metrics' and mount.get('RW') is False, 'candidate_mount_scope')
    environment = dict(item.split('=', 1) for item in info['Config']['Env'])
    require(environment.get('AVTOCENA_RELEASE_SHA') == RELEASE, 'candidate_env_release_scope')
    require(environment.get('UV_THREADPOOL_SIZE') == '16' and environment.get('VIPS_CONCURRENCY') == '1', 'candidate_pool_scope')
    return environment


def cgroup_sample(pid):
    try:
        rows = pathlib.Path('/proc/' + str(pid) + '/cgroup').read_text().splitlines()
        relative = next(row.split(':', 2)[2] for row in rows if row.startswith('0::'))
        directory = pathlib.Path('/sys/fs/cgroup') / relative.lstrip('/')
        cpu = dict(line.split() for line in (directory / 'cpu.stat').read_text().splitlines())
        events = dict(line.split() for line in (directory / 'memory.events').read_text().splitlines())
        available = int(re.search(r'^MemAvailable:\s+(\d+)', pathlib.Path('/proc/meminfo').read_text(), re.M).group(1)) * 1024
        return {'cpuUsec': int(cpu['usage_usec']), 'throttledUsec': int(cpu.get('throttled_usec', 0)), 'memoryBytes': int((directory / 'memory.current').read_text()), 'oom': int(events.get('oom', 0)), 'oomKill': int(events.get('oom_kill', 0)), 'hostAvailableBytes': available}
    except (OSError, ValueError, StopIteration, AttributeError):
        return {'unavailable': True}


def main():
    global DIAGNOSTIC_DEADLINE
    parser = argparse.ArgumentParser()
    parser.add_argument('--scenario', choices=['incident', 'sort-korea', 'power160'], default='incident')
    parser.add_argument('--models-query-base64', default='')
    args = parser.parse_args()
    paths = paths_for(args.scenario, safe_query(args.models_query_base64))
    lock = open('/run/lock/avtocena-runtime-change.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise ScopeError('runtime_change_lock_busy') from None
    started = time.monotonic()
    DIAGNOSTIC_DEADLINE = started + MAX_SECONDS

    def interrupt(signum, frame):
        raise ScopeError('diagnostic_deadline_or_signal')

    for item in [signal.SIGHUP, signal.SIGINT, signal.SIGTERM, signal.SIGALRM]:
        signal.signal(item, interrupt)
    # This includes all startup reads and reserves 30 seconds for owned cleanup.
    signal.setitimer(signal.ITIMER_REAL, MAX_SECONDS - 30)
    owner = uuid.uuid4().hex
    name = 'avtocena-diag-loop-' + owner[:12]
    before = production_snapshot()
    config = NGINX.read_bytes()
    original = inspect(ORIGINAL)
    environment = validate_candidate(original)
    profiler_source = pathlib.Path(__file__).with_name('regcloud-loop-cpu-sample.mjs').read_text()
    events = queue.Queue()
    profiler = None
    environment_path = None
    clone_created = False
    stop_health = threading.Event()
    health_thread = None
    completed = False

    try:
        fd, environment_path = tempfile.mkstemp(prefix='loop-env-' + owner[:12] + '-', dir=str(pathlib.Path(__file__).parent))
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as output:
            for key, value in environment.items():
                require(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key) is not None and '\n' not in value and '\r' not in value, 'environment_format')
                output.write(key + '=' + value + '\n')
        # Record ownership before Docker run: partial creation is cleaned too.
        clone_created = True
        command(['docker', 'run', '-d', '--name', name, '--label', 'avtocena.diagnostic.owner=' + owner,
                 '--label', 'avtocena.diagnostic.source=' + RELEASE, '--env-file', environment_path,
                 '--memory', str(10 * 1024 ** 3), '--cpus', '6', '--pids-limit', '512',
                 '--log-opt', 'max-size=5m', '--log-opt', 'max-file=1',
                 '-p', '127.0.0.1::3000', '--mount', 'type=bind,src=/opt/avtocena/metrics,dst=/run/avtocena-metrics,readonly',
                 IMAGE, 'node', '--inspect=127.0.0.1:9229', 'apps/web/server.js'], timeout=25)
        os.unlink(environment_path)
        environment_path = None
        clone = inspect(name)
        require(clone['Image'] == IMAGE and clone['Config']['Labels'].get('avtocena.diagnostic.owner') == owner, 'clone_identity_changed')
        port = port_of(clone)
        ready_deadline = time.monotonic() + 35
        while True:
            ready = public_request(port, '/api/health', 2, health=True)
            if ready.get('status') == 200 and ready.get('ok') is True:
                require(ready.get('releaseSha') == RELEASE and ready.get('calculationVersion') == CALCULATION, 'clone_health_identity')
                break
            require(time.monotonic() < ready_deadline, 'clone_not_ready')
            time.sleep(0.5)
        emit('clone_ready', releaseSha=RELEASE, image=IMAGE, memoryLimitBytes=10 * 1024 ** 3, cpuLimit=6, pool=16, vipsConcurrency=1, scenario=args.scenario, paths=paths)
        profiler = subprocess.Popen(['docker', 'exec', '-i', name, 'node', '--input-type=module'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        profiler.stdin.write(profiler_source)
        profiler.stdin.close()

        def read_profile():
            for line in profiler.stdout:
                try:
                    value = json.loads(line)
                    if value.get('event') in {'profile_ready', 'cpu_profile', 'profile_error'}:
                        events.put(('profile', value))
                except (ValueError, AttributeError):
                    pass
            events.put(('profile_exit', None))

        threading.Thread(target=read_profile, daemon=True).start()
        profile_ready_deadline = time.monotonic() + 25
        while True:
            require(time.monotonic() < profile_ready_deadline, 'profile_not_ready')
            try:
                kind, value = events.get(timeout=0.25)
            except queue.Empty:
                continue
            require(kind == 'profile' and value.get('event') == 'profile_ready', 'profile_start_failed')
            emit(**value)
            break

        def health_loop():
            while not stop_health.is_set():
                tick = time.monotonic()
                value = public_request(port, '/api/health', 2, health=True)
                events.put(('health', value))
                stop_health.wait(max(0, 1 - (time.monotonic() - tick)))

        health_thread = threading.Thread(target=health_loop, daemon=True)
        health_thread.start()
        for path in paths:
            threading.Thread(target=lambda target=path: events.put(('request', public_request(port, target, 90))), daemon=True).start()
        pending_requests = len(paths)
        profile_received = False
        profile_exited = False
        next_metrics = 0.0
        next_health_output = 0.0
        while pending_requests or not profile_exited:
            now = time.monotonic()
            require(now - started < MAX_SECONDS - 40, 'replay_deadline')
            if now >= next_metrics:
                metrics = cgroup_sample(clone['State']['Pid'])
                emit('resources', elapsedSeconds=round(now - started, 3), **metrics)
                require(metrics.get('hostAvailableBytes', 2 * 1024 ** 3) >= 2 * 1024 ** 3, 'host_memory_reserve')
                next_metrics = now + 5
            try:
                kind, value = events.get(timeout=0.25)
            except queue.Empty:
                continue
            if kind == 'request':
                pending_requests -= 1
                emit('request', elapsedSeconds=round(time.monotonic() - started, 3), **value)
            elif kind == 'health':
                if value.get('status') == 200:
                    require(value.get('releaseSha') == RELEASE and value.get('calculationVersion') == CALCULATION, 'sample_health_identity_changed')
                if now >= next_health_output or value.get('error') or value.get('status') != 200:
                    emit('health', elapsedSeconds=round(time.monotonic() - started, 3), **value)
                    next_health_output = now + 5
            elif kind == 'profile':
                emit(**value)
                profile_received |= value.get('event') == 'cpu_profile'
            elif kind == 'profile_exit':
                profile_exited = True
        require(profile_received and profiler.wait(timeout=5) == 0, 'cpu_profile_missing')
        completed = True
    finally:
        signal.setitimer(signal.ITIMER_REAL, max(0.01, DIAGNOSTIC_DEADLINE - time.monotonic()))
        stop_health.set()
        cleanup_ok = True
        try:
            if clone_created:
                result = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    owned = json.loads(result.stdout)[0]
                    require(owned['Config']['Labels'].get('avtocena.diagnostic.owner') == owner, 'cleanup_owner_mismatch')
                    command(['docker', 'rm', '-f', name], timeout=12)
                else:
                    require('No such object' in result.stderr, 'cleanup_inspect_failed')
        except Exception:
            cleanup_ok = False
        if profiler is not None and profiler.poll() is None:
            profiler.terminate()
            try:
                profiler.wait(timeout=2)
            except subprocess.TimeoutExpired:
                profiler.kill()
        if environment_path:
            try:
                os.unlink(environment_path)
            except FileNotFoundError:
                pass
        require(cleanup_ok, 'owned_clone_cleanup_failed')
        require(NGINX.read_bytes() == config, 'nginx_changed')
        after = production_snapshot()
        original_after = inspect(ORIGINAL)
        require(original_after['Id'] == original['Id'] and original_after['Image'] == IMAGE and not original_after['State']['Running'], 'original_candidate_changed')
        emit('unchanged_production', unchanged=before == after, releaseSha=after['releaseSha'], nginxSha256=hashlib.sha256(config).hexdigest(), ownedCloneRemoved=True, privateEnvRemoved=environment_path is None or not pathlib.Path(environment_path).exists(), elapsedSeconds=round(time.monotonic() - started, 3))
        require(before == after, 'production_changed')
        require(time.monotonic() - started <= MAX_SECONDS, 'diagnostic_total_deadline')
        signal.setitimer(signal.ITIMER_REAL, 0)
    emit('diagnostic_complete', complete=completed)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Messages from arbitrary libraries/subprocesses may contain private data.
        emit('diagnostic_failed', code=str(error) if isinstance(error, ScopeError) else type(error).__name__)
        raise SystemExit(1) from None
