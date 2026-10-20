#!/usr/bin/env python3
"""Bound production rollback copies. No volumes, storage objects or live containers removed."""
import argparse
import datetime as dt
import fcntl
import json
import re
import shutil
import subprocess


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True)


def inspect_containers():
    ids = docker('ps', '-aq').split()
    return json.loads(docker('inspect', *ids)) if ids else []


def eligible(c):
    name = c['Name'].lstrip('/')
    return (bool(re.fullmatch(r'avtocena-before-[0-9a-f]{12}', name))
            and c['State']['Status'] == 'exited'
            and c['Config'].get('Labels', {}).get('avtocena.role') == 'production'
            and all(m.get('Type') == 'bind' and not m.get('RW')
                    and m.get('Source') == '/opt/avtocena/metrics'
                    and m.get('Destination') == '/run/avtocena-metrics'
                    for m in c.get('Mounts', [])))


def eligible_old_release(c, now):
    """Abandoned deployment candidates also pin images; retain one day of evidence."""
    name = c['Name'].lstrip('/')
    if not re.fullmatch(r'avtocena-release-[0-9a-f]{12}(?:-failed-[0-9]+)?', name):
        return False
    # Reuse the exact label, stopped-state and read-only-mount safeguards.
    if not eligible(dict(c, Name='/avtocena-before-' + '0' * 12)):
        return False
    try:
        finished = dt.datetime.fromisoformat(c['State']['FinishedAt'].replace('Z', '+00:00'))
        return finished.tzinfo is not None and now - finished >= dt.timedelta(days=1)
    except (KeyError, TypeError, ValueError):
        return False


def eligible_unused_image(image, referenced, now):
    """Only old, named application images; never containers or data volumes."""
    tags = image.get('RepoTags') or []
    if image.get('Id') in referenced or not tags:
        return False
    if not all(re.fullmatch(r'avtocena-regcloud:[0-9a-f]{40}', t) for t in tags):
        return False
    try:
        created = dt.datetime.fromisoformat(image['Created'].replace('Z', '+00:00'))
        return created.tzinfo is not None and now - created >= dt.timedelta(days=1)
    except (KeyError, TypeError, ValueError):
        return False


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
    backups = sorted((c for c in containers if eligible(c)),
                     key=lambda c: c['State']['FinishedAt'], reverse=True)
    now = dt.datetime.now(dt.timezone.utc)
    # Only clean abandoned candidates when two actual rollback containers exist.
    abandoned = [c for c in containers if eligible_old_release(c, now)] if len(backups) >= 2 else []
    remove = backups[2:] + abandoned
    print('RETAIN_ROLLBACKS', [c['Name'] for c in backups[:2]], flush=True)
    print('REMOVE_STOPPED_COPIES', [c['Name'] for c in remove], flush=True)
    before = shutil.disk_usage('/')
    removed_images = set()
    for c in remove:
        if args.apply:
            # Recheck state and mounts immediately before non-forced removal.
            fresh = json.loads(docker('inspect', c['Id']))[0]
            if not (eligible(fresh) or eligible_old_release(fresh, now)):
                raise RuntimeError('Container changed; refusing removal')
            docker('rm', c['Id'])
            removed_images.add(c['Image'])
    if args.apply:
        referenced = {c['Image'] for c in inspect_containers()}
        for image_id in sorted(removed_images - referenced):
            details = json.loads(docker('image', 'inspect', image_id))[0]
            tags = details.get('RepoTags') or []
            # Only application tags, no forced deletion or broad prune.
            if tags and all(re.fullmatch(r'avtocena-regcloud:[0-9a-f]{40}', t) for t in tags):
                for tag in tags:
                    docker('image', 'rm', tag)
                    print('REMOVED_IMAGE', tag, flush=True)
    # Older failed builds can have no container and were missed by rollback cleanup.
    # Preparation/runtime locks prevent racing a deployment; retain a day as well.
    now = dt.datetime.now(dt.timezone.utc)
    referenced = {c['Image'] for c in inspect_containers()}
    image_ids = sorted(set(docker('image', 'ls', '-q', '--no-trunc').split()))
    for image_id in image_ids:
        image = json.loads(docker('image', 'inspect', image_id))[0]
        if not eligible_unused_image(image, referenced, now):
            continue
        print('UNUSED_OLD_APPLICATION_IMAGE', image['RepoTags'], flush=True)
        if args.apply:
            fresh = json.loads(docker('image', 'inspect', image_id))[0]
            current_refs = {c['Image'] for c in inspect_containers()}
            if not eligible_unused_image(fresh, current_refs, now):
                raise RuntimeError('Image changed; refusing removal')
            for tag in fresh['RepoTags']:
                docker('image', 'rm', tag)
                print('REMOVED_UNUSED_IMAGE', tag, flush=True)
    after = shutil.disk_usage('/')
    print('DISK_RESULT', json.dumps({'apply': args.apply, 'totalBytes': after.total,
          'usedBytes': after.used, 'freeBytes': after.free,
          'freedBytes': after.free - before.free}), flush=True)
    assert json.loads(docker('inspect', 'avtocena-production'))[0]['State']['Running']


if __name__ == '__main__':
    main()
