"""Verify signal semantics in a disposable no-network shell, never signal production."""
import json, pathlib, subprocess, time

def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, 'probe_command_failed:' + args[0]
    return result.stdout

production = json.loads(run(['docker', 'inspect', 'avtocena-production']))[0]
assert production['Config']['Labels'].get('avtocena.role') == 'production'
root = pathlib.Path(run(['docker', 'info', '--format', '{{.DockerRootDir}}']).strip())
name = 'avtocena-owner-signal-proof-20261111'
exists = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True, timeout=10)
assert exists.returncode != 0, 'probe_name_already_exists'
created = False
try:
    ident = run(['docker', 'run', '-d', '--name', name, '--label', 'avtocena.role=owner-signal-proof',
        '--network', 'none', '--read-only', '--memory', '32m', '--cpus', '0.1', '--pids-limit', '16',
        '--restart', 'unless-stopped', '--entrypoint', '/bin/sh', production['Image'],
        '-c', "trap '' USR1; while :; do sleep 1; done"]).strip()
    created = True
    def flags():
        data = json.loads((root / 'containers' / ident / 'config.v2.json').read_text())
        state = json.loads(run(['docker', 'inspect', name]))[0]
        return {'manualStop': data.get('HasBeenManuallyStopped'), 'running': state['State']['Running'], 'policy': state['HostConfig']['RestartPolicy']['Name']}
    time.sleep(1)
    before = flags()
    run(['docker', 'kill', '--signal=USR1', name])
    after_docker_signal = flags()
    run(['docker', 'restart', '--time', '1', name])
    time.sleep(1)
    reset = flags()
    run(['docker', 'exec', name, '/bin/sh', '-c', 'kill -USR1 1'])
    after_process_signal = flags()
    result = {'before': before, 'dockerSignal': after_docker_signal, 'afterRestart': reset, 'processSignal': after_process_signal}
    print('ISOLATED_SIGNAL_PROOF', json.dumps(result), flush=True)
    assert before['manualStop'] is False and after_docker_signal['manualStop'] is True
    assert reset['manualStop'] is False and after_process_signal['manualStop'] is False
    assert all(row['running'] and row['policy'] == 'unless-stopped' for row in result.values())
finally:
    if created:
        check = json.loads(run(['docker', 'inspect', name]))[0]
        assert check['Config']['Labels'].get('avtocena.role') == 'owner-signal-proof'
        run(['docker', 'rm', '-f', name])
        print('PROBE_REMOVED; production was not signalled or restarted', flush=True)
