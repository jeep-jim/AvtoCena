#!/usr/bin/env python3
"""One isolated instrumented image; never activate it or print private data."""
import fcntl
import hashlib
import json
import math
import pathlib
import re
import signal
import subprocess
import sys
import time
import urllib.request

INDEX = '/app/data/knowledge/encyclopedia/calculation-v1.json'
CONFIG = pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf')
PHASES = {'snapshot', 'counts', 'green', 'greenPricing', 'catalogPricing', 'dealer', 'dealerRail', 'japanRail'}

def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()

def inspect(name):
    return json.loads(command('docker', 'inspect', name))[0]

def sha(value, length=40):
    if not re.fullmatch('[a-f0-9]{'+str(length)+'}', value):
        raise ValueError('invalid_digest')
    return value

def baseline(info, release):
    if info['State']['Running'] or info['Config']['Image'] != 'avtocena-regcloud:'+release:
        raise ValueError('stopped_exact_baseline_required')
    if info['HostConfig']['Privileged']:
        raise ValueError('unprivileged_required')

def phase_row(line):
    if not line.startswith('home_phase '):
        return None
    try:
        row = json.loads(line[len('home_phase '):])
    except (ValueError, TypeError):
        return None
    if not isinstance(row, dict) or row.get('phase') not in PHASES:
        return None
    if not re.fullmatch('[a-f0-9-]{36}', str(row.get('trace', ''))):
        return None
    if type(row.get('ms')) not in (int, float) or not math.isfinite(row['ms']) or row['ms'] < 0 or type(row.get('ok')) is not bool:
        return None
    if not all(re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(row.get(k, ''))) for k in ['policyDate', 'completedPolicyDate']):
        return None
    clean = {k: row[k] for k in ['trace', 'phase', 'ms', 'ok', 'policyDate', 'completedPolicyDate']}
    if re.fullmatch('gen_[0-9]+_[a-z0-9-]{1,80}', str(row.get('generation', ''))):
        clean['generation'] = row['generation']
    return clean

def runtime_env(entries, release, calculator):
    overrides = {'AVTOCENA_RELEASE_SHA': sha(release), 'AVTOCENA_CALCULATION_VERSION': sha(calculator, 64),
                 'CATALOG_HOME_PHASE_TIMING': '1'}
    values = [v for v in entries if v.split('=', 1)[0] not in overrides]
    values += [k+'='+v for k, v in overrides.items()]
    if any('\n' in v or '\r' in v for v in values):
        raise ValueError('invalid_environment')
    return '\n'.join(values)+'\n'

def production():
    row = inspect('avtocena-production')
    port = row['NetworkSettings']['Ports']['3000/tcp']
    if not row['State']['Running'] or len(port) != 1 or port[0]['HostIp'] != '127.0.0.1':
        raise ValueError('production_binding_invalid')
    with urllib.request.urlopen('http://127.0.0.1:'+port[0]['HostPort']+'/api/health', timeout=15) as response:
        health = json.load(response)
    if health.get('ok') is not True:
        raise ValueError('production_health_invalid')
    return sha(health['releaseSha'])

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def probe(base_release, release, calculator, directory, expected_production):
    image = 'avtocena-home-phases:'+release
    name = 'avtocena-home-phases-'+release[:12]
    old = inspect('avtocena-release-'+base_release[:12])
    baseline(old, base_release)
    if production() != expected_production:
        raise ValueError('production_changed_before_probe')
    if command('docker', 'image', 'inspect', '--format', '{{ index .Config.Labels "org.opencontainers.image.revision" }}', image) != release:
        raise ValueError('image_revision_mismatch')
    # An active candidate is independent of workflow serialization and must stop us.
    if any(n.startswith(('avtocena-release-', 'avtocena-home-phases-')) for n in command('docker', 'ps', '--format', '{{.Names}}').splitlines()):
        raise ValueError('another_candidate_running')
    config = CONFIG
    config_before = config.read_bytes()
    envfile = directory/'runtime.env'
    envfile.write_text(runtime_env(old['Config']['Env'], release, calculator))
    envfile.chmod(0o600)
    created = False
    finished = False
    rows = []
    try:
        command('docker', 'create', '--name', name, '--label', 'avtocena.role=diagnostic', '--restart', 'no',
                '--memory', '8g', '--cpus', '2', '--pids-limit', '512', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=1',
                '--env-file', str(envfile), '-v', '/opt/avtocena/metrics:/run/avtocena-metrics:ro',
                '-p', '127.0.0.1::3000', image)
        created = True
        # Reuse the exact private index from the baseline, not newly researched facts.
        checkfile = directory/'image-index.json'
        command('docker', 'cp', name+':'+INDEX, str(checkfile))
        if hashlib.sha256(checkfile.read_bytes()).digest() != hashlib.sha256((directory/'calculation-v1.json').read_bytes()).digest():
            raise ValueError('private_index_changed')
        checkfile.unlink()
        command('docker', 'start', name)
        binding = inspect(name)['NetworkSettings']['Ports']['3000/tcp']
        if len(binding) != 1 or binding[0]['HostIp'] != '127.0.0.1':
            raise ValueError('loopback_required')
        address = '127.0.0.1:'+binding[0]['HostPort']
        if address.encode() in config_before:
            raise ValueError('must_not_receive_production_traffic')
        url = 'http://'+address
        for attempt in range(30):
            try:
                with urllib.request.urlopen(url+'/api/health', timeout=2) as response:
                    health = json.load(response)
                if health.get('releaseSha') != release or health.get('calculationVersion') != calculator:
                    raise ValueError('candidate_identity_mismatch')
                break
            except OSError:
                time.sleep(1)
        else:
            raise ValueError('candidate_not_ready')
        for phase, delay in [('cold', 0), ('warm', 0), ('after35', 35), ('after305', 305)]:
            time.sleep(delay)
            start = time.monotonic()
            with urllib.request.urlopen(url+'/', timeout=90) as response:
                body = response.read(20*1024*1024+1)
            complete = b'</html>' in body and b'$RX(' not in body and 50000 < len(body) <= 20*1024*1024
            emit({'homeProbe': phase, 'seconds': round(time.monotonic()-start, 4), 'bytes': len(body), 'complete': complete})
            if not complete:
                raise ValueError('incomplete_home')
        finished = True
    finally:
        # No rename/switch/nginx reload; cleanup also runs on timeout and SSH hangup.
        if created:
            try:
                command('docker', 'stop', '--time', '20', name)
                logs = subprocess.run(['docker', 'logs', name], capture_output=True, text=True, check=True)
                rows = [row for line in (logs.stdout+'\n'+logs.stderr).splitlines() if (row := phase_row(line))]
                emit({'homePhases': rows, 'imageRelease': release, 'baselineRelease': base_release})
                state = inspect(name)['State']
                emit({'candidateState': {k: state.get(k) for k in ['Status', 'ExitCode', 'OOMKilled']}})
            finally:
                command('docker', 'rm', '-f', name)
        envfile.unlink(missing_ok=True)
        after = production()
        unchanged = after == expected_production and config.read_bytes() == config_before
        emit({'productionBefore': expected_production, 'productionAfter': after, 'nginxUnchanged': config.read_bytes() == config_before})
        if not unchanged:
            raise ValueError('production_changed_during_probe')
    if finished:
        traces = {row['trace'] for row in rows}
        if len(rows) != 32 or len(traces) != 4 or any({row['phase'] for row in rows if row['trace'] == trace} != PHASES for trace in traces):
            raise ValueError('incomplete_phase_measurements')

def main():
    mode, base_release, release, calculator, rawdir, expected = sys.argv[1:]
    sha(base_release); sha(release); sha(calculator, 64); sha(expected)
    directory = pathlib.Path(rawdir)
    if not re.fullmatch('/opt/avtocena/staging/home-phases/[0-9]+-[0-9]+', str(directory)):
        raise ValueError('invalid_directory')
    locks = []
    for name in ['avtocena-runtime-change', 'avtocena-staging-prepare']:
        lock = open('/run/lock/'+name+'.lock', 'w')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(lock)
    def interrupt(*_):
        raise TimeoutError('bounded_probe_interrupted')
    for sig in [signal.SIGHUP, signal.SIGTERM, signal.SIGALRM]:
        signal.signal(sig, interrupt)
    signal.alarm(600)
    try:
        if mode == 'export':
            baseline(inspect('avtocena-release-'+base_release[:12]), base_release)
            if production() != expected:
                raise ValueError('production_changed_before_export')
            command('docker', 'cp', 'avtocena-release-'+base_release[:12]+':'+INDEX, str(directory/'calculation-v1.json'))
            (directory/'calculation-v1.json').chmod(0o600)
            emit({'baselineRelease': base_release, 'privateIndexExported': True})
        elif mode == 'probe':
            probe(base_release, release, calculator, directory, expected)
        else:
            raise ValueError('unknown_mode')
    finally:
        signal.alarm(0)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not echo subprocess argv, environment or application output.
        reason = str(error) if isinstance(error, (ValueError, TimeoutError)) and re.fullmatch('[a-z_]+', str(error)) else None
        emit({'diagnosticFailureType': type(error).__name__, 'reason': reason})
        sys.exit(1)
