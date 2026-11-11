"""Bounded read-only follow-up: process, restart policy and crash evidence, no profiler."""
import datetime, json, pathlib, re, subprocess, sys, time, urllib.request

def run(args, timeout=20):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    assert result.returncode == 0, 'read_failed:' + args[0]
    return result.stdout

def emit(label, value):
    print(label, json.dumps(value, ensure_ascii=False), flush=True)

container = json.loads(run(['docker', 'inspect', 'avtocena-production']))[0]
env = dict(row.split('=', 1) for row in container['Config']['Env'] if '=' in row)
assert len(sys.argv) == 2 and re.fullmatch(r'[a-f0-9]{40}', sys.argv[1])
assert env.get('AVTOCENA_RELEASE_SHA') == sys.argv[1]
assert container['Config']['Labels'].get('avtocena.role') == 'production'
emit('RUNTIME', {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'release': env['AVTOCENA_RELEASE_SHA'], 'state': container['State'],
    'restartPolicy': container['HostConfig']['RestartPolicy'], 'restartCount': container['RestartCount'],
    'memoryLimit': container['HostConfig']['Memory'], 'nodeOptions': env.get('NODE_OPTIONS'),
    'nanoCpus': container['HostConfig']['NanoCpus'], 'image': container['Image']})
emit('DOCKER_VERSION', json.loads(run(['docker', 'version', '--format', '{{json .Server}}'])))
root = pathlib.Path(run(['docker', 'info', '--format', '{{.DockerRootDir}}']).strip())
assert root.is_absolute() and re.fullmatch(r'[a-f0-9]{64}', container['Id'])
metadata = json.loads((root / 'containers' / container['Id'] / 'config.v2.json').read_text())
emit('RESTART_FLAGS', {key: metadata.get(key) for key in ['HasBeenManuallyStopped', 'HasBeenStartedBefore', 'RestartCount']})
emit('RESOURCES', run(['docker', 'stats', '--no-stream', '--format', '{{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}}', 'avtocena-production']).strip())
log = subprocess.run(['docker', 'logs', '--timestamps', '--since', '2026-11-11T04:00:00Z', '--tail', '10000', 'avtocena-production'], capture_output=True, text=True, timeout=20)
patterns = ['FATAL ERROR', 'heap out of memory', 'Mark-Compact', 'Scavenge', 'Ready in', 'Debugger listening', 'Debugger attached']
emit('CRASH_EVIDENCE', [line[:800] for line in (log.stdout + '\n' + log.stderr).splitlines() if any(p in line for p in patterns)][-25:])
until = str(int(datetime.datetime.now(datetime.timezone.utc).timestamp()))
events = run(['docker', 'events', '--since', '2026-11-11T03:30:00Z', '--until', until, '--filter', 'container=' + container['Id'], '--format', '{{json .}}'])
rows = []
for line in events.splitlines():
    event = json.loads(line)
    if event.get('Action') not in ['kill', 'die', 'start', 'restart', 'oom', 'update']: continue
    attributes = event.get('Actor', {}).get('Attributes', {})
    rows.append({'time': event.get('time'), 'action': event.get('Action'),
        'signal': attributes.get('signal'), 'exitCode': attributes.get('exitCode')})
emit('LIFECYCLE_EVENTS', rows[-25:])
if container['State']['Running']:
    pid = container['State']['Pid']
    emit('PROCESS_MEMORY', [line for line in pathlib.Path('/proc/' + str(pid) + '/status').read_text().splitlines() if line.startswith(('Name:', 'VmRSS:', 'VmHWM:', 'VmSize:', 'Threads:'))])
    status = run(['docker', 'exec', 'avtocena-production', 'node', '-e', "fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(1500)}).then(()=>console.log('open'),()=>console.log('closed'))"])
    emit('INSPECTOR', status.strip())

    bindings = container['NetworkSettings']['Ports'].get('3000/tcp') or []
    assert len(bindings) == 1 and bindings[0]['HostIp'] == '127.0.0.1'
    started = time.monotonic()
    try:
        request = urllib.request.Request('http://127.0.0.1:' + bindings[0]['HostPort'] + '/api/health', headers={'Host':'avtocena.com'})
        with urllib.request.urlopen(request, timeout=5) as response:
            body = json.loads(response.read(8192))
            emit('LOOPBACK_HEALTH', {'http': response.status, 'seconds': round(time.monotonic()-started,3), 'release': body.get('releaseSha'), 'ok': body.get('ok')})
    except Exception as error:
        emit('LOOPBACK_HEALTH', {'seconds': round(time.monotonic()-started,3), 'error': type(error).__name__})
