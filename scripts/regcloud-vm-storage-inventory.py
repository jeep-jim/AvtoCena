#!/usr/bin/env python3
"""Read-only VM attribution. No provider, storage, health or mutation requests.

Output contains selected Docker metadata and private-configuration hashes, never
environment values, file contents, command lines or Docker error bodies. This is
an inventory for a separately reviewed cleanup, not an automatic deletion plan.
"""
import collections
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

REVISION = 'org.opencontainers.image.revision'
MAX_ITEMS = 512
DEADLINE_SECONDS = 300
STARTED = time.monotonic()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def run(command, timeout=45):
    if time.monotonic() - STARTED >= DEADLINE_SECONDS:
        raise RuntimeError('inventory_deadline')
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError('inventory_command_failed')
    if len(result.stdout) > 32 * 1024 * 1024:
        raise RuntimeError('inventory_output_limit')
    return result.stdout


def docker(*args):
    # There is no general remote command input or apply mode.
    if tuple(args[:2]) not in {('ps', '-aq'), ('image', 'ls'), ('image', 'inspect'),
                               ('container', 'inspect'), ('info', '--format')} and args[:1] != ('diff',):
        raise RuntimeError('non_inventory_command')
    return run(['docker', *args])


def ids(kind):
    values = docker('ps', '-aq', '--no-trunc').split() if kind == 'container' else docker('image', 'ls', '-aq', '--no-trunc').split()
    values = sorted(set(values))
    pattern = r'[a-f0-9]{64}' if kind == 'container' else r'sha256:[a-f0-9]{64}'
    if len(values) > MAX_ITEMS or any(not re.fullmatch(pattern, item) for item in values):
        raise RuntimeError('inventory_id_limit_or_format')
    return values


def capture_containers(with_size=False):
    values = ids('container')
    args = ['container', 'inspect'] + (['--size'] if with_size else []) + values
    return json.loads(docker(*args)) if values else []


def capture_images():
    values = ids('image')
    return json.loads(docker('image', 'inspect', *values)) if values else []


def revision(config):
    value = (config.get('Labels') or {}).get(REVISION)
    return value if isinstance(value, str) and re.fullmatch(r'[a-f0-9]{40}', value) else None


def container_fingerprint(value):
    state = value.get('State', {})
    return digest({key: value.get(key) for key in ['Id', 'Name', 'Image', 'Created', 'Config', 'HostConfig', 'Mounts', 'RestartCount']}
                  | {'State': {key: state.get(key) for key in ['Status', 'Running', 'Paused', 'Restarting', 'Dead', 'Pid', 'StartedAt', 'FinishedAt', 'ExitCode', 'OOMKilled']}})


def image_fingerprint(value):
    return digest({key: value.get(key) for key in ['Id', 'Created', 'Config', 'RepoTags', 'RepoDigests', 'RootFS', 'Parent']})


def container_view(value):
    config, host, state = value.get('Config', {}), value.get('HostConfig', {}), value.get('State', {})
    env = dict(row.split('=', 1) for row in config.get('Env', []) if isinstance(row, str) and '=' in row)
    return {
        'id': value['Id'], 'name': value.get('Name'), 'imageId': value.get('Image'),
        'created': value.get('Created'), 'revision': revision(config),
        'role': (config.get('Labels') or {}).get('avtocena.role'),
        'state': {key: state.get(key) for key in ['Status', 'Running', 'Paused', 'Restarting', 'Dead', 'Pid', 'StartedAt', 'FinishedAt', 'ExitCode', 'OOMKilled']},
        'writableBytes': value.get('SizeRw'), 'rootFsBytes': value.get('SizeRootFs'),
        'mounts': [{key: mount.get(key) for key in ['Type', 'Source', 'Destination', 'RW']}
                   for mount in value.get('Mounts', [])],
        'privileged': host.get('Privileged'), 'volumesFrom': host.get('VolumesFrom'),
        'ports': host.get('PortBindings'),
        'storage': {'objectDriver': env.get('JSON_STORAGE_DRIVER') == 'object',
                    'regEndpoint': env.get('YC_OBJECT_STORAGE_ENDPOINT') == 'https://s3.regru.cloud',
                    'bucketConfigured': bool(env.get('YC_OBJECT_STORAGE_BUCKET')),
                    'prefixConfigured': bool(env.get('YC_OBJECT_STORAGE_PREFIX'))},
        'fingerprint': container_fingerprint(value),
    }


def diff_category(path):
    for prefix, category in [('/app/apps/web/.next/', 'next_runtime'), ('/app/.next/', 'next_runtime'),
                             ('/app/data/', 'application_data'), ('/data/', 'application_data'),
                             ('/app/apps/web/public/', 'public_files'), ('/app/node_modules/', 'dependencies'),
                             ('/tmp/', 'temporary'), ('/var/log/', 'logs'), ('/root/', 'root_home')]:
        if path == prefix[:-1] or path.startswith(prefix):
            return category
    return 'application_other' if path.startswith('/app/') else 'other'


def filesystem_tree(path):
    output = run(['du', '-x', '-B1', '-d1', path], timeout=60)
    result = []
    for line in output.splitlines():
        number, name = line.split('\t', 1)
        if name != path and not name.startswith(path + '/'):
            raise RuntimeError('unexpected_du_path')
        result.append({'path': name, 'allocatedBytes': int(number)})
    if len(result) > 256:
        raise RuntimeError('filesystem_entry_limit')
    return sorted(result, key=lambda row: row['allocatedBytes'], reverse=True)


def emit(event, **values):
    print(json.dumps({'event': event, **values}, sort_keys=True), flush=True)


def main():
    if len(sys.argv) != 1:
        raise RuntimeError('inventory_has_no_arguments')
    began = dt.datetime.now(dt.timezone.utc).isoformat()
    before_disk = shutil.disk_usage('/')
    containers = capture_containers(with_size=True)
    images = capture_images()
    production = [row for row in containers if row.get('Name') == '/avtocena-production']
    if len(production) != 1 or production[0].get('State', {}).get('Running') is not True:
        raise RuntimeError('single_running_production_required')
    emit('vm_inventory_started', startedAt=began, readOnly=True, atomicSnapshot=False,
         totalBytes=before_disk.total, usedBytes=before_disk.used, freeBytes=before_disk.free,
         dockerRoot=docker('info', '--format', '{{.DockerRootDir}}').strip(),
         driver=docker('info', '--format', '{{.Driver}}').strip(),
         containerCount=len(containers), imageCount=len(images))
    for row in sorted(containers, key=lambda item: item.get('Name', '')):
        emit('container', **container_view(row))
    for image in sorted(images, key=lambda item: item['Id']):
        references = [row for row in containers if row.get('Image') == image['Id']]
        emit('image', id=image['Id'], created=image.get('Created'), sizeBytes=image.get('Size'),
             revision=revision(image.get('Config', {})), repoTags=image.get('RepoTags') or [],
             repoDigests=image.get('RepoDigests') or [], parent=image.get('Parent'),
             layers=len(image.get('RootFS', {}).get('Layers') or []),
             fingerprint=image_fingerprint(image),
             references=[{'id': row['Id'], 'name': row.get('Name'), 'running': row.get('State', {}).get('Running')}
                         for row in references])
    # Read filenames only, then reduce them to fixed categories without disclosing paths.
    large_stopped = [row for row in containers if row.get('State', {}).get('Status') == 'exited'
                     and row.get('Name', '').startswith('/avtocena-') and (row.get('SizeRw') or 0) > 100_000_000]
    if len(large_stopped) > 12:
        raise RuntimeError('large_container_limit')
    for row in large_stopped:
        counts = collections.Counter()
        for line in docker('diff', row['Id']).splitlines():
            operation, path = line.split(' ', 1)
            if operation not in ['A', 'C', 'D'] or not path.startswith('/'):
                raise RuntimeError('unexpected_container_diff')
            counts[operation + ':' + diff_category(path)] += 1
        emit('container_changes', id=row['Id'], counts=dict(sorted(counts.items())))
    for path in ['/var/lib', '/var/lib/docker', '/var/lib/containerd']:
        if Path(path).is_dir():
            emit('filesystem_tree', root=path, rows=filesystem_tree(path))
    after_containers, after_images = capture_containers(), capture_images()
    unchanged_containers = {row['Id']: container_fingerprint(row) for row in containers} == {row['Id']: container_fingerprint(row) for row in after_containers}
    unchanged_images = {row['Id']: image_fingerprint(row) for row in images} == {row['Id']: image_fingerprint(row) for row in after_images}
    after_disk = shutil.disk_usage('/')
    emit('vm_inventory_complete', finishedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
         readOnly=True, containersUnchanged=unchanged_containers, imagesUnchanged=unchanged_images,
         totalBytes=after_disk.total, usedBytes=after_disk.used, freeBytes=after_disk.free,
         productionId=production[0]['Id'], productionImageId=production[0]['Image'])
    if not unchanged_containers or not unchanged_images:
        raise RuntimeError('docker_inventory_changed_during_read')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only our fixed error codes or the exception type; never subprocess output.
        code = str(error) if type(error) is RuntimeError and re.fullmatch(r'[a-z_]+', str(error)) else type(error).__name__
        emit('vm_inventory_failed', error=code, readOnly=True)
        raise SystemExit(1)
