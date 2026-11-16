#!/usr/bin/env python3
"""Apply only the exact VM inventory reviewed on 16 November 2026.

No force, prune, volume, filesystem, application start, source or storage action.
Both deployment locks, original production checks and all retained fingerprints
remain mandatory. Future inventory changes require a newly reviewed plan.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import re

PLAN_SHA256 = 'dabf125648bc7b56562886bef911a56dd9a90a47d8462a21480975b67b67b00f'
SAFEGUARDS_SHA256 = 'af1a1234b8702633651ae55e2d6f62dbb574280f4cab96f7a3348ef12b05b5ec'
PROTECTED = {
    '83ff17075e9188dcf227c8752dc064248d5f42e0',
    'a182cd21b21ecf612b63613d263e5bdd817ea4c0',
    '17a686182574097b5ade22b37ef8b485e2b53844',
    '463fd22559a2f9c5acd60f8f5e4b269689215c84',
    'e4f2781ed52f12f53430118bea51ef150608ccfe',
}


class Refused(RuntimeError):
    pass


def require(value, code):
    if not value:
        raise Refused(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_plan(plan, now):
    require(digest(plan) == PLAN_SHA256, 'plan_digest_mismatch')
    require(plan['schemaVersion'] == 1 and plan['inventoryRunId'] == 43842173449
            and plan['inventorySource'] == 'c3df53d33094c7f7dc97922966a1e4107632fddc', 'inventory_binding')
    require(set(plan['protectedReleases']) == PROTECTED, 'protected_release_policy')
    require(now < dt.datetime.fromisoformat(plan['expiresAt'].replace('Z', '+00:00')), 'review_expired')
    require(len(plan['containers']) == 9 and len(plan['images']) == 20, 'reviewed_scope_count')
    require(len({row['id'] for row in plan['containers']}) == 9
            and len({row['id'] for row in plan['images']}) == 20, 'duplicate_target')
    for row in plan['containers'] + plan['images']:
        require(row['revision'] not in PROTECTED, 'protected_release_selected')


def validate_snapshot(plan, containers, images, removed_containers, removed_images, safe):
    wanted_containers = {key: value for key, value in plan['allContainerFingerprints'].items()
                         if key not in removed_containers}
    wanted_images = {key: value for key, value in plan['allImageFingerprints'].items()
                     if key not in removed_images}
    require({row['Id']: safe.container_fingerprint(row) for row in containers} == wanted_containers,
            'container_inventory_changed')
    require({row['Id']: safe.image_fingerprint(row) for row in images} == wanted_images,
            'image_inventory_changed')
    require(safe.production_view(containers, {row['Id']: row for row in images}) == plan['production'],
            'production_identity_changed')


def validate_image(expected, image, safe, now):
    require(image.get('Id') == expected['id'] and re.fullmatch(r'sha256:[a-f0-9]{64}', expected['id']), 'image_id')
    require(safe.image_fingerprint(image) == expected['fingerprint'], 'image_fingerprint')
    revision = (image.get('Config', {}).get('Labels') or {}).get(safe.REVISION)
    require(revision == expected['revision'] and re.fullmatch(r'[a-f0-9]{40}', revision)
            and revision not in PROTECTED and image['Id'] != safe.ACCEPTED_IMAGE, 'image_revision_or_pin')
    tags, aliases = image.get('RepoTags') or [], image.get('RepoDigests') or []
    require(tags in [[], ['avtocena-regcloud:' + revision]], 'image_tag_alias')
    require(aliases in [[], ['avtocena-regcloud@' + image['Id']]], 'image_digest_alias')
    require(now - safe.timestamp(image.get('Created')) >= dt.timedelta(days=1), 'image_grace_period')


def validate_container(expected, container, safe, now):
    require(container.get('Id') == expected['id'] and container.get('Name') == expected['name']
            and container.get('Image') == expected['imageId'], 'container_identity')
    require(safe.container_fingerprint(container) == expected['fingerprint'], 'container_fingerprint')
    config, state, host = container.get('Config', {}), container.get('State', {}), container.get('HostConfig', {})
    labels = config.get('Labels') or {}
    require(labels.get(safe.REVISION) == expected['revision'] and expected['revision'] not in PROTECTED,
            'container_revision_or_pin')
    require(labels.get('avtocena.role') == expected['role'] and expected['role'] in ['production', 'isolated-staging'],
            'container_role')
    require(state.get('Status') == 'exited' and state.get('Running') is False and state.get('Pid') == 0
            and state.get('Paused') is False and state.get('Restarting') is False and state.get('Dead') is False,
            'container_not_stopped')
    require(now - safe.timestamp(state.get('FinishedAt')) >= dt.timedelta(days=1), 'container_grace_period')
    require(safe.timestamp(container.get('Created')) <= safe.timestamp(state.get('FinishedAt')), 'container_time_order')
    require(host.get('Privileged') is False and safe.mounts_safe(container), 'container_mounts_or_privilege')
    env = safe.environment(container)
    require(env.get('JSON_STORAGE_DRIVER') == 'object'
            and env.get('YC_OBJECT_STORAGE_ENDPOINT') == 'https://s3.regru.cloud'
            and bool(env.get('YC_OBJECT_STORAGE_BUCKET')) and bool(env.get('YC_OBJECT_STORAGE_PREFIX')),
            'container_object_storage_routing')
    require(container.get('SizeRw') == expected['writableBytes'], 'stopped_writable_size_changed')


def execute(plan, backend, safe, apply, expected_hash, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    validate_plan(plan, now)
    require((apply and expected_hash == PLAN_SHA256) or (not apply and expected_hash in ['', PLAN_SHA256]),
            'reviewed_apply_hash_required')
    removed_containers, removed_images = [], []
    result = {'apply': apply, 'planSha256': PLAN_SHA256, 'removedContainers': removed_containers,
              'removedImages': removed_images, 'beforeFreeBytes': backend.free_bytes()}

    def capture():
        containers, images = backend.capture()
        validate_snapshot(plan, containers, images, removed_containers, removed_images, safe)
        return containers, {row['Id']: row for row in images}

    containers, images = capture()
    backend.verify_production(plan['production'])
    # Validate every target before the first mutation, including legacy names.
    for expected in plan['containers']:
        validate_container(expected, backend.container(expected['id'], with_size=True), safe, now)
    for expected in plan['images']:
        validate_image(expected, images[expected['id']], safe, now)
        require(sorted(row['Id'] for row in containers if row['Image'] == expected['id']) == expected['referenceIds'],
                'reviewed_image_references_changed')
    if apply:
        selected_containers = {row['id']: row for row in plan['containers']}
        for expected in plan['images']:
            containers, images = capture()
            validate_image(expected, images[expected['id']], safe, dt.datetime.now(dt.timezone.utc))
            for identifier in expected['referenceIds']:
                require(identifier in selected_containers, 'referenced_container_not_reviewed')
                current = backend.container(identifier, with_size=True)
                validate_container(selected_containers[identifier], current, safe, dt.datetime.now(dt.timezone.utc))
                backend.remove_container(identifier)
                removed_containers.append(identifier)
            containers, images = capture()
            require(not any(row['Image'] == expected['id'] for row in containers), 'image_still_referenced')
            validate_image(expected, images[expected['id']], safe, dt.datetime.now(dt.timezone.utc))
            backend.remove_image(expected['id'])
            removed_images.append(expected['id'])
            emit('reviewed_vm_cleanup_progress', imageId=expected['id'], removedContainerCount=len(removed_containers),
                 removedImageCount=len(removed_images), freeBytes=backend.free_bytes())
        capture()
    backend.verify_production(plan['production'])
    result['afterFreeBytes'] = backend.free_bytes()
    result['freedBytes'] = result['afterFreeBytes'] - result['beforeFreeBytes']
    result['retainedContainersUnchanged'] = True
    result['retainedImagesUnchanged'] = True
    return result


class Backend:
    def __init__(self, safe):
        self.safe, self.host = safe, safe.HostBackend()

    def capture(self):
        containers = self.host.containers()
        identifiers = sorted(set(self.safe.docker('image', 'ls', '-aq', '--no-trunc').split()))
        require(len(identifiers) <= 512 and all(re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in identifiers),
                'image_inventory_limit')
        images = json.loads(self.safe.docker('image', 'inspect', *identifiers)) if identifiers else []
        return containers, images

    def container(self, identifier, with_size=False):
        return json.loads(self.safe.docker('container', 'inspect', *(['--size'] if with_size else []), identifier))[0]

    def verify_production(self, expected):
        self.host.verify_production(expected)

    def free_bytes(self):
        return self.host.free_bytes()

    def remove_container(self, identifier):
        self.safe.docker('rm', identifier)
        emit('removed_reviewed_vm_container', id=identifier)

    def remove_image(self, identifier):
        self.safe.docker('image', 'rm', '--no-prune', identifier)
        emit('removed_reviewed_vm_image', id=identifier)


def emit(event, **values):
    print(json.dumps({'event': event, **values}, sort_keys=True), flush=True)


def main(safe, plan):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-plan-sha256', default='')
    args = parser.parse_args()
    locks = []
    for name in ['avtocena-staging-prepare', 'avtocena-runtime-change']:
        handle = open('/run/lock/' + name + '.lock', 'a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    backend = Backend(safe)
    try:
        result = execute(plan, backend, safe, args.apply, args.expected_plan_sha256)
    finally:
        backend.verify_production(plan['production'])
    emit('reviewed_vm_cleanup_complete', **result)


if __name__ == '__main__':
    # Local preview only. The workflow bundles these exact files through stdin.
    filename = Path(__file__).with_name('regcloud-failed-encar-retention.py')
    require(hashlib.sha256(filename.read_bytes()).hexdigest() == SAFEGUARDS_SHA256, 'safeguards_source_changed')
    spec = importlib.util.spec_from_file_location('retention_safeguards', filename)
    safe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(safe)
    plan = json.loads((Path(__file__).resolve().parents[1] / 'docs/operations/2026-11-16-vm-cleanup-plan.json').read_text())
    main(safe, plan)
