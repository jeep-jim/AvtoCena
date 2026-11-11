#!/usr/bin/env python3
"""Restore the exact owner-accepted fast container after measured browser regression.
Application rollback only; preserve data, Nginx crawler rules and ordinary schedules.
"""
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

RELEASE = 'a182cd21b21ecf612b63613d263e5bdd817ea4c0'
PREVIOUS = '3048aede91dbfa4287e038075700e1434ba53e85'
IMAGE = 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f'
PREVIOUS_IMAGE = 'sha256:e084bb738abaf12042cd220bb48f699a6e101316d0b223a5725d74436fb62c85'
ORIGINAL_NAME = 'avtocena-before-3048aede91db'
CONFIG = pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf')


def run(*args, timeout=45):
    return subprocess.run(args, capture_output=True, text=True,
                          check=True, timeout=timeout).stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def emit(event, **fields):
    print(event, json.dumps(fields, ensure_ascii=False), flush=True)


def port(container):
    bindings = container['HostConfig']['PortBindings']['3000/tcp']
    assert len(bindings) == 1 and bindings[0]['HostIp'] == '127.0.0.1'
    value = int(bindings[0]['HostPort'])
    assert value in (3000, 3001)
    return value


def environment(container):
    return dict(row.split('=', 1) for row in container['Config']['Env'])


def request(base, path, data=None, timeout=25):
    headers = {'Connection': 'close', 'Origin': 'https://avtocena.com',
               'Content-Type': 'application/json'}
    req = urllib.request.Request(base + path, data=data, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(20 * 1024 * 1024 + 1)
        assert len(body) <= 20 * 1024 * 1024, 'response_too_large'
        return response.status, body


def exact_health(base, expected, origin=False):
    deadline = time.monotonic() + 45
    while True:
        try:
            if origin:
                body = run('curl', '--fail', '--silent', '--show-error',
                           '--max-time', '5', '-H', 'Connection: close',
                           '--resolve', 'avtocena.com:443:127.0.0.1',
                           'https://avtocena.com/api/health', timeout=8)
                value = json.loads(body)
            else:
                status, body = request(base, '/api/health', timeout=4)
                assert status == 200
                value = json.loads(body)
            assert value.get('ok') is True and value.get('releaseSha') == expected
            return value
        except (AssertionError, ValueError, OSError, subprocess.SubprocessError):
            if time.monotonic() >= deadline:
                raise RuntimeError('exact_release_health_not_ready') from None
            time.sleep(1)


def replace_config(contents, stat, suffix):
    temporary = CONFIG.with_name(CONFIG.name + '.' + suffix + '.tmp')
    with temporary.open('x') as stream:
        stream.write(contents)
    os.chmod(temporary, stat.st_mode & 0o7777)
    os.chown(temporary, stat.st_uid, stat.st_gid)
    os.replace(temporary, CONFIG)
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')


def main():
    run_id = sys.argv[1]
    assert re.fullmatch(r'[0-9]+', run_id)
    assert os.environ.get('OWNER_ACCEPTED_SPEED_RELEASE') == RELEASE
    os.umask(0o077)
    lock = open('/run/lock/avtocena-runtime-change.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert pathlib.Path('/opt/avtocena/PRODUCTION_ACTIVE').exists()

    old = inspect('avtocena-production')
    target = inspect(ORIGINAL_NAME)
    for container, release, running in [(old, PREVIOUS, True), (target, RELEASE, False)]:
        assert container['Config']['Labels']['avtocena.role'] == 'production'
        assert container['Config']['Labels']['org.opencontainers.image.revision'] == release
        assert container['State']['Running'] is running
        assert not container['State']['OOMKilled'] and not container['HostConfig']['Privileged']
        assert container['HostConfig']['Memory'] == 10 * 1024 ** 3
        assert container['HostConfig']['NanoCpus'] == 6_000_000_000
        assert all(m['Destination'] == '/run/avtocena-metrics' and not m['RW']
                   and m['Source'] == '/opt/avtocena/metrics' for m in container['Mounts'])
    assert target['Image'] == IMAGE, 'original_image_mismatch'
    assert old['Image'] == PREVIOUS_IMAGE, 'rejected_image_mismatch'
    assert target['Mounts'] == old['Mounts'], 'runtime_mounts_changed'
    a, b = environment(old), environment(target)
    assert a.get('AVTOCENA_RELEASE_SHA') == PREVIOUS and b.get('AVTOCENA_RELEASE_SHA') == RELEASE
    differences = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    assert set(differences) <= {'AVTOCENA_RELEASE_SHA', 'AVTOCENA_CALCULATION_VERSION', 'CATALOG_HOME_PHASE_TIMING'}, 'unrelated_environment_changed'
    assert a.get('CATALOG_HOME_PHASE_TIMING') == '1'
    for env in (a, b):
        assert re.fullmatch(r'[a-f0-9]{64}', env.get('AVTOCENA_CALCULATION_VERSION', ''))
    old_id, target_id = old['Id'], target['Id']
    old_port, target_port = port(old), port(target)
    assert old_port != target_port
    old_base, target_base = 'http://127.0.0.1:' + str(old_port), 'http://127.0.0.1:' + str(target_port)
    exact_health(old_base, PREVIOUS)
    original_config, config_stat = CONFIG.read_text(), CONFIG.stat()
    old_upstream, new_upstream = '127.0.0.1:' + str(old_port), '127.0.0.1:' + str(target_port)
    assert original_config.count(old_upstream) == 1, 'unexpected_nginx_upstream'
    backup = 'avtocena-speed-rejected-3048-' + run_id
    assert subprocess.run(['docker', 'inspect', backup], capture_output=True).returncode != 0
    evidence = pathlib.Path('/opt/avtocena/owner-rollbacks') / run_id
    evidence.mkdir(parents=True, mode=0o700, exist_ok=False)
    (evidence / 'nginx-before.conf').write_text(original_config)
    emit('OWNER_SPEED_PREFLIGHT', targetRelease=RELEASE, originalContainer=ORIGINAL_NAME,
         exactImage=IMAGE, unrelatedEnvironmentMatches=True, permittedEnvironmentDifferences=differences, oldPort=old_port, targetPort=target_port,
         retainedBackupName=backup)

    config_touched = False
    def interrupted(signum, frame):
        raise RuntimeError('owner_rollback_interrupted_' + str(signum))
    for signum in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupted)
    try:
        run('docker', 'start', target_id)
        exact_health(target_base, RELEASE)
        for path in ['/login', '/autocalc', '/cars/china?totalTo=1500000&sort=totalRub', '/cars/china?totalTo=2000000&sort=totalRub']:
            status, body = request(target_base, path)
            assert status == 200 and b'</html>' in body and b'$RX(' not in body
            if path.startswith('/cars/'):
                assert b'ac-catalog-card' in body and b'/cars/offer/' in body, 'catalog_cards_missing'
            emit('MANDATORY_PAGE_PASS', path=path, status=status)
        status, body = request(target_base, '/api/leads', data=b'{}')
        assert status == 400 and json.loads(body).get('error') == 'personal_data_consent_required'
        emit('MANDATORY_LEAD_CONSENT_PASS', status=status)
        status, _ = request(target_base, '/api/crm/server-resources')
        assert status in (401, 403), 'anonymous_metrics_exposed'
        emit('MANDATORY_PRIVATE_ACCESS_PASS', status=status)

        config_touched = True
        replace_config(original_config.replace(old_upstream, new_upstream), config_stat, run_id + '-activate')
        exact_health(target_base, RELEASE, origin=True)
        run('docker', 'stop', '--time', '30', old_id)
        exact_health(target_base, RELEASE)
        run('docker', 'rename', old_id, backup)
        run('docker', 'rename', target_id, 'avtocena-production')
        current = inspect('avtocena-production')
        assert current['Id'] == target_id and current['State']['Running']
        health = exact_health(target_base, RELEASE, origin=True)
        receipt = {'release': RELEASE, 'previousRelease': PREVIOUS, 'originalContainerId': target_id,
                   'backupContainer': backup, 'backupContainerId': old_id,
                   'reason': 'Repeated mobile filter regression including 60.105 seconds', 'applicationCodeChanged': False,
                   'normalDeploymentGatesChanged': False, 'health': health,
                   'activatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        (evidence / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        emit('OWNER_SPEED_ROLLBACK_ACTIVE', **receipt)
    except BaseException:
        # IDs are stable through either partial rename; never delete a container.
        for signum in (signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, signal.SIG_IGN)
        emit('OWNER_ROLLBACK_RESTORING_PREVIOUS', previousRelease=PREVIOUS)
        run('docker', 'start', old_id)
        exact_health(old_base, PREVIOUS)
        if config_touched:
            replace_config(original_config, config_stat, run_id + '-restore')
            exact_health(old_base, PREVIOUS, origin=True)
        if inspect(target_id)['Name'].lstrip('/') != ORIGINAL_NAME:
            run('docker', 'rename', target_id, ORIGINAL_NAME)
        if inspect(old_id)['Name'].lstrip('/') != 'avtocena-production':
            run('docker', 'rename', old_id, 'avtocena-production')
        run('docker', 'stop', '--time', '20', target_id)
        emit('OWNER_ROLLBACK_PREVIOUS_RESTORED', previousRelease=PREVIOUS)
        raise


if __name__ == '__main__':
    main()
