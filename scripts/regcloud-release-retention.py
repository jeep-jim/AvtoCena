#!/usr/bin/env python3
"""Bound production rollback copies. No volumes, storage objects or live containers removed."""
import argparse
import datetime as dt
import fcntl
import hashlib
import http.client
import json
from pathlib import Path
import re
import shutil
import subprocess


# Preserve the exact owner-accepted speed baseline independently of age/count.
# Replace this pin only when a newer release has explicit accepted evidence.
ACCEPTED_RELEASE = 'a182cd21b21ecf612b63613d263e5bdd817ea4c0'
ACCEPTED_IMAGE = 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f'
# Exact current failed-release evidence remains held until its investigation closes.
HELD_RELEASES = {'e4f2781ed52f12f53430118bea51ef150608ccfe'}
HELD_IMAGES = {'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac'}
KEEP_FAILED_IMAGE_GROUPS = 2
MAX_CONTAINER_REMOVALS = 16
MAX_IMAGE_REMOVALS = 16
APP_SOURCE = 'https://github.com/jeep-jim/AvtoCena'
NGINX = Path('/etc/nginx/conf.d/avtocena-prepare.conf')


def pinned_image(image):
    releases = HELD_RELEASES | {ACCEPTED_RELEASE}
    return (image.get('Id') in HELD_IMAGES | {ACCEPTED_IMAGE}
            or any('avtocena-regcloud:' + release in (image.get('RepoTags') or []) for release in releases)
            or (image.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision') in releases)


def docker(*args):
    try:
        result = subprocess.run(['docker', *args], text=True, capture_output=True, timeout=30)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Docker retention command timed out') from None
    if result.returncode != 0:
        raise RuntimeError('Docker retention command failed')
    return result.stdout


def inspect_containers():
    ids = docker('ps', '-aq').split()
    if len(ids) > 512:
        raise RuntimeError('Container inventory exceeds retention bound')
    return json.loads(docker('inspect', *ids)) if ids else []


def environment(c):
    rows = c.get('Config', {}).get('Env')
    if not isinstance(rows, list):
        return None
    values = {}
    for row in rows:
        if not isinstance(row, str) or '=' not in row or '\n' in row or '\r' in row:
            return None
        key, value = row.split('=', 1)
        if key in values:
            return None
        values[key] = value
    return values


def eligible(c, now=None):
    """A managed stopped rollback; its name may identify the successor release."""
    config, state, host = c.get('Config', {}), c.get('State', {}), c.get('HostConfig', {})
    labels = config.get('Labels') or {}
    revision = labels.get('org.opencontainers.image.revision')
    if (c.get('Image') in HELD_IMAGES | {ACCEPTED_IMAGE}
            or revision in HELD_RELEASES | {ACCEPTED_RELEASE}
            or config.get('Image') in {'avtocena-regcloud:' + release for release in HELD_RELEASES | {ACCEPTED_RELEASE}}):
        return False
    if (not re.fullmatch(r'avtocena-before-[0-9a-f]{12}', c.get('Name', '').lstrip('/'))
            or not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}', revision)
            or config.get('Image') != 'avtocena-regcloud:' + revision
            or labels.get('avtocena.role') != 'production'
            or state.get('Status') != 'exited' or state.get('Running') is not False or state.get('Pid') != 0
            or any(state.get(key) is not False for key in ['Paused', 'Restarting', 'Dead'])
            or host.get('Privileged') is not False or host.get('VolumesFrom')):
        return False
    mounts = c.get('Mounts')
    if not isinstance(mounts, list) or len(mounts) > 1 or any(
            m.get('Type') != 'bind' or m.get('RW') is not False or m.get('Source') != '/opt/avtocena/metrics'
            or m.get('Destination') != '/run/avtocena-metrics' for m in mounts):
        return False
    env = environment(c)
    if (not env or env.get('JSON_STORAGE_DRIVER') != 'object'
            or env.get('YC_OBJECT_STORAGE_ENDPOINT') != 'https://s3.regru.cloud'
            or not env.get('YC_OBJECT_STORAGE_BUCKET') or not env.get('YC_OBJECT_STORAGE_PREFIX')):
        return False
    try:
        created = dt.datetime.fromisoformat(c['Created'].replace('Z', '+00:00'))
        finished = dt.datetime.fromisoformat(state['FinishedAt'].replace('Z', '+00:00'))
        return created.tzinfo is not None and finished.tzinfo is not None and created <= finished <= (now or dt.datetime.now(dt.timezone.utc))
    except (KeyError, TypeError, ValueError):
        return False


def owned_application_image(image, managed_images=None):
    labels = image.get('Config', {}).get('Labels') or {}
    revision = labels.get('org.opencontainers.image.revision')
    identifier = image.get('Id')
    tags, digests = image.get('RepoTags') or [], image.get('RepoDigests') or []
    explicit_owner = labels.get('org.opencontainers.image.source') == APP_SOURCE and labels.get('avtocena.application') == 'web'
    return (isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision) is not None
            and isinstance(identifier, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', identifier) is not None
            and tags in [[], ['avtocena-regcloud:' + revision]]
            and digests in [[], ['avtocena-regcloud@' + identifier]]
            and (bool(tags or digests) or explicit_owner or (managed_images or {}).get(identifier) == revision))


def failed_candidate(c, now):
    """A stopped managed release, never a running/prepared/staging/legacy copy."""
    if not re.fullmatch(r'avtocena-release-[0-9a-f]{12}(?:-failed-[0-9]+)?', c['Name'].lstrip('/')):
        return False
    if not eligible(dict(c, Name='/avtocena-before-' + '0' * 12), now):
        return False
    labels = c.get('Config', {}).get('Labels') or {}
    revision = labels.get('org.opencontainers.image.revision')
    if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}', revision):
        return False
    if (not re.fullmatch(r'avtocena-release-' + revision[:12] + r'(?:-failed-[0-9]+)?', c['Name'].lstrip('/'))
            or c['Config'].get('Image') != 'avtocena-regcloud:' + revision):
        return False
    return True


def failed_retention(containers, now):
    """Keep one newest copy from each of two newest failed image groups."""
    candidates = sorted((c for c in containers if failed_candidate(c, now)),
                        key=lambda c: (c['State']['FinishedAt'], c['Created'], c['Id']), reverse=True)
    keep, groups = set(), set()
    for c in candidates:
        if c['Image'] not in groups and len(groups) < KEEP_FAILED_IMAGE_GROUPS:
            groups.add(c['Image'])
            keep.add(c['Id'])
    return keep, list(reversed([c for c in candidates if c['Id'] not in keep]))


def fingerprint(c):
    state = c.get('State', {})
    value = {key: c.get(key) for key in ['Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts', 'RestartCount']}
    value['State'] = {key: state.get(key) for key in ['Status', 'Running', 'Paused', 'Restarting', 'Dead', 'Pid', 'StartedAt', 'FinishedAt']}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def eligible_unused_image(image, referenced, now):
    """Old application images require OCI ownership even when tags are absent."""
    if pinned_image(image):
        return False
    if image.get('Id') in referenced or not owned_application_image(image):
        return False
    try:
        created = dt.datetime.fromisoformat(image['Created'].replace('Z', '+00:00'))
        return created.tzinfo is not None and now - created >= dt.timedelta(days=1)
    except (KeyError, TypeError, ValueError):
        return False


def retain_releases(args, containers):
    now = dt.datetime.now(dt.timezone.utc)
    backups = sorted((c for c in containers if eligible(c, now)),
                     key=lambda c: c['State']['FinishedAt'], reverse=True)
    # The accepted pin and two actual rollback copies remain independent of failed evidence.
    kept_failed, abandoned = failed_retention(containers, now) if len(backups) >= 2 else (set(), [])
    remove = (backups[2:] + abandoned)[:MAX_CONTAINER_REMOVALS]
    retained = {c['Id']: fingerprint(c) for c in containers if c['Id'] not in {x['Id'] for x in remove}}
    before_images = set(docker('image', 'ls', '-aq', '--no-trunc').split())
    if len(before_images) > 512:
        raise RuntimeError('Image inventory exceeds retention bound')
    print('RETAIN_ROLLBACKS', [c['Name'] for c in backups[:2]], flush=True)
    print('REMOVE_STOPPED_COPIES', [c['Name'] for c in remove], flush=True)
    print('RETAIN_FAILED_EVIDENCE', sorted(kept_failed), flush=True)
    before = shutil.disk_usage('/')
    removed_images = {}
    deleted_images = set()
    removed_container_ids = set()
    for c in remove:
        if args.apply:
            # Recheck state and mounts immediately before non-forced removal.
            fresh = json.loads(docker('inspect', c['Id']))[0]
            if fingerprint(fresh) != fingerprint(c) or not (eligible(fresh, now) or failed_candidate(fresh, now)):
                raise RuntimeError('Container changed; refusing removal')
            docker('rm', c['Id'])
            removed_container_ids.add(c['Id'])
            removed_images[c['Image']] = c['Config']['Labels']['org.opencontainers.image.revision']
    if args.apply:
        referenced = {c['Image'] for c in inspect_containers()}
        for image_id in sorted(set(removed_images) - referenced):
            details = json.loads(docker('image', 'inspect', image_id))[0]
            if pinned_image(details) or not owned_application_image(details, removed_images) or len(deleted_images) >= MAX_IMAGE_REMOVALS:
                continue
            # Full identity, no force; --no-prune also preserves untagged parents.
            if image_id in {c['Image'] for c in inspect_containers()}:
                raise RuntimeError('Image became referenced; refusing removal')
            docker('image', 'rm', '--no-prune', image_id)
            deleted_images.add(image_id)
            print('REMOVED_IMAGE', image_id, flush=True)
    # Older failed builds can have no container and were missed by rollback cleanup.
    # Preparation/runtime locks prevent racing a deployment; retain a day as well.
    now = dt.datetime.now(dt.timezone.utc)
    referenced = {c['Image'] for c in inspect_containers()}
    image_ids = sorted(set(docker('image', 'ls', '-aq', '--no-trunc').split()))
    for image_id in image_ids:
        image = json.loads(docker('image', 'inspect', image_id))[0]
        if not eligible_unused_image(image, referenced, now):
            continue
        print('UNUSED_OLD_APPLICATION_IMAGE', image['RepoTags'], flush=True)
        if args.apply:
            if len(deleted_images) >= MAX_IMAGE_REMOVALS:
                break
            fresh = json.loads(docker('image', 'inspect', image_id))[0]
            current_refs = {c['Image'] for c in inspect_containers()}
            if not eligible_unused_image(fresh, current_refs, now):
                raise RuntimeError('Image changed; refusing removal')
            docker('image', 'rm', '--no-prune', image_id)
            deleted_images.add(image_id)
            print('REMOVED_UNUSED_IMAGE', image_id, flush=True)
    after = shutil.disk_usage('/')
    print('DISK_RESULT', json.dumps({'apply': args.apply, 'totalBytes': after.total,
          'usedBytes': after.used, 'freeBytes': after.free,
          'freedBytes': after.free - before.free}), flush=True)
    after_containers = inspect_containers()
    after_fingerprints = {c['Id']: fingerprint(c) for c in after_containers}
    if set(after_fingerprints) != {c['Id'] for c in containers} - removed_container_ids:
        raise RuntimeError('Unreviewed container set changed')
    if any(after_fingerprints.get(identifier) != value for identifier, value in retained.items()):
        raise RuntimeError('Retained container changed')
    if set(docker('image', 'ls', '-aq', '--no-trunc').split()) != before_images - deleted_images:
        raise RuntimeError('Unreviewed image set changed')


def production_identity(c):
    config, host = c.get('Config', {}), c.get('HostConfig', {})
    env = environment(c) or {}
    release, calculator = env.get('AVTOCENA_RELEASE_SHA', ''), env.get('AVTOCENA_CALCULATION_VERSION', '')
    labels = config.get('Labels') or {}
    bindings = host.get('PortBindings') or {}
    ports = bindings.get('3000/tcp') or []
    if (not re.fullmatch(r'[a-f0-9]{40}', release) or not re.fullmatch(r'[a-f0-9]{64}', calculator)
            or labels.get('org.opencontainers.image.revision') != release or config.get('Image') != 'avtocena-regcloud:' + release
            or set(bindings) != {'3000/tcp'} or len(ports) != 1 or ports[0].get('HostIp') != '127.0.0.1'
            or ports[0].get('HostPort') not in ['3000', '3001']):
        raise RuntimeError('Invalid production identity or loopback binding')
    return {'release': release, 'calculator': calculator, 'port': int(ports[0]['HostPort'])}


def verify_health(expected):
    connection = http.client.HTTPConnection('127.0.0.1', expected['port'], timeout=10)
    try:
        connection.request('GET', '/api/health', headers={'Connection': 'close', 'User-Agent': 'AvtoCena-Release-Retention'})
        response = connection.getresponse()
        body = response.read(65537)
        if response.status != 200 or len(body) > 65536:
            raise RuntimeError('Production health response invalid')
        value = json.loads(body)
        if value.get('ok') is not True or value.get('releaseSha') != expected['release'] or value.get('calculationVersion') != expected['calculator']:
            raise RuntimeError('Production health identity changed')
    finally:
        connection.close()


def nginx_digest():
    try:
        return hashlib.sha256(NGINX.read_bytes()).hexdigest()
    except (FileNotFoundError, PermissionError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    # Same locks as image loading and switching; never run inside the deploy script.
    locks = []
    for name in ['avtocena-staging-prepare', 'avtocena-runtime-change']:
        handle = open('/run/lock/' + name + '.lock', 'a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    containers = inspect_containers()
    live = [c for c in containers if c['Name'] == '/avtocena-production' and c['State']['Running']]
    if len(live) != 1:
        raise RuntimeError('Expected running production; refusing cleanup')
    expected, nginx = production_identity(live[0]), nginx_digest()
    verify_health(expected)
    try:
        retain_releases(args, containers)
    finally:
        fresh = json.loads(docker('inspect', live[0]['Id']))[0]
        if fingerprint(fresh) != fingerprint(live[0]) or nginx_digest() != nginx:
            raise RuntimeError('Production configuration or Nginx changed')
        verify_health(expected)


if __name__ == '__main__':
    main()
