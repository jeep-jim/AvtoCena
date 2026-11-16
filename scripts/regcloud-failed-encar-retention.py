#!/usr/bin/env python3
"""Inventory, then apply a reviewed plan for superseded failed 9cb images only.

No force/prune/volume operations, application restart, Nginx edit, or storage
writes. All other releases and the newest failed 9cb image group are retained.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

EXPECTED_PRODUCTION = '83ff17075e9188dcf227c8752dc064248d5f42e0'
EXPECTED_CALCULATOR = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
FAILED_RELEASE = '9cb571fcce503c9a3ca1a1496514899839b75395'
ACCEPTED_IMAGE = 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f'
FAILED_TAG = 'avtocena-regcloud:' + FAILED_RELEASE
# Read-only follow-up to the two stopped b5 containers already removed by the
# existing guarded retention. These IDs are NEVER added to an apply plan here.
ORPHAN_REVIEW_RELEASE = 'b5ad05ee8ad042e4ff7b911a1990fbcd8b703b30'
ORPHAN_REVIEW_IDS = (
    'sha256:fc248eb393edfec3a5b37376b5fe51ea335fb8078ebe522df606b3777da9fb04',
    'sha256:2fa2c913567930cfc0b0e716b27cde6e76a34ca530f42fa383c7ee4870beb1f8',
)
TARGET_FREE_BYTES = 10 * 1024 ** 3
MAX_GROUPS = 2
NAME = re.compile(r'^avtocena-release-9cb571fcce50(?:-failed-\d+)?$')
REVISION = 'org.opencontainers.image.revision'
ROUTING = {
    'JSON_STORAGE_DRIVER': 'object',
    'YC_OBJECT_STORAGE_ENDPOINT': 'https://s3.regru.cloud',
    'YC_OBJECT_STORAGE_REGION': 'us-east-1',
    'YC_OBJECT_STORAGE_BUCKET': 'avtocena-staging-8120751',
    'YC_OBJECT_STORAGE_PREFIX': 'migration-staging/full-20261011/',
}
NGINX = Path('/etc/nginx/conf.d/avtocena-prepare.conf')


class GuardError(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise GuardError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def name_of(container):
    return str(container.get('Name', '')).removeprefix('/')


def environment(container):
    rows = container.get('Config', {}).get('Env')
    require(isinstance(rows, list), 'environment_missing')
    result = {}
    for row in rows:
        require(isinstance(row, str) and '=' in row and '\n' not in row and '\r' not in row, 'environment_invalid')
        key, value = row.split('=', 1)
        require(key not in result, 'environment_duplicate_key')
        result[key] = value
    return result


def mounts_safe(container):
    mounts = container.get('Mounts')
    return (isinstance(mounts, list) and len(mounts) <= 1
            and all(m.get('Type') == 'bind' and m.get('RW') is False
                    and m.get('Source') == '/opt/avtocena/metrics'
                    and m.get('Destination') == '/run/avtocena-metrics' for m in mounts)
            and not container.get('HostConfig', {}).get('VolumesFrom'))


def timestamp(value):
    require(isinstance(value, str), 'timestamp_missing')
    try:
        result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise GuardError('timestamp_invalid') from None
    require(result.tzinfo is not None and result.year >= 2026, 'timestamp_invalid')
    return result


def container_fingerprint(container):
    # Hash the full configuration privately; never emit environment values.
    state = container.get('State', {})
    return digest({key: container.get(key) for key in ['Id', 'Name', 'Image', 'Created', 'Config', 'HostConfig', 'Mounts', 'RestartCount']}
                  | {'State': {key: state.get(key) for key in ['Status', 'Running', 'Paused', 'Restarting', 'Dead', 'Pid', 'StartedAt', 'FinishedAt', 'ExitCode', 'OOMKilled']}})


def image_fingerprint(image):
    return digest({key: image.get(key) for key in ['Id', 'Created', 'Config', 'RepoTags', 'RepoDigests', 'RootFS', 'Parent']})


def named_orphan_image_inventory(containers, images):
    """Only sanitized metadata for the two exact requested image IDs; no writes."""
    def row(identifier):
        image = images.get(identifier)
        refs = [c for c in containers if c.get('Image') == identifier]
        labels = image.get('Config', {}).get('Labels') or {} if image else {}
        revision = labels.get(REVISION)
        return {'imageId': identifier, 'present': image is not None,
                'revision': revision if isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision) else None,
                'expectedRevisionMatched': revision == ORPHAN_REVIEW_RELEASE,
                'created': image.get('Created') if image else None,
                'sizeBytes': image.get('Size') if image else None,
                'repoTags': image.get('RepoTags') or [] if image else [],
                'repoDigests': image.get('RepoDigests') or [] if image else [],
                'imageFingerprint': image_fingerprint(image) if image else None,
                'referenceCount': len(refs),
                'references': [{'id': c['Id'], 'name': name_of(c), 'state': c.get('State', {}).get('Status'),
                                'running': c.get('State', {}).get('Running'),
                                'revision': (c.get('Config', {}).get('Labels') or {}).get(REVISION)}
                               for c in refs]}
    others = sorted(identifier for identifier, image in images.items()
                    if identifier not in ORPHAN_REVIEW_IDS
                    and (image.get('Config', {}).get('Labels') or {}).get(REVISION) == ORPHAN_REVIEW_RELEASE)
    return {'readOnly': True, 'sourceRevision': ORPHAN_REVIEW_RELEASE,
            'requestedImages': [row(identifier) for identifier in ORPHAN_REVIEW_IDS],
            'otherImagesOfSameRevisionRetained': [row(identifier) for identifier in others]}


def production_view(containers, images):
    matches = [c for c in containers if name_of(c) == 'avtocena-production']
    require(len(matches) == 1, 'production_count')
    c = matches[0]
    state, config, host = c.get('State', {}), c.get('Config', {}), c.get('HostConfig', {})
    labels = config.get('Labels') or {}
    require(state.get('Status') == 'running' and state.get('Running') is True
            and state.get('Paused') is False and state.get('Restarting') is False and state.get('Dead') is False, 'production_not_running')
    require(labels.get('avtocena.role') == 'production' and labels.get(REVISION) == EXPECTED_PRODUCTION, 'production_revision')
    require(config.get('Image') == 'avtocena-regcloud:' + EXPECTED_PRODUCTION, 'production_config_image')
    image = images.get(c.get('Image'))
    require(image and image.get('Id') == c.get('Image')
            and (image.get('Config', {}).get('Labels') or {}).get(REVISION) == EXPECTED_PRODUCTION, 'production_image_revision')
    env = environment(c)
    require(env.get('AVTOCENA_RELEASE_SHA') == EXPECTED_PRODUCTION
            and env.get('AVTOCENA_CALCULATION_VERSION') == EXPECTED_CALCULATOR, 'production_environment_revision')
    require(all(env.get(key) == value for key, value in ROUTING.items()), 'production_object_storage_routing')
    require(host.get('Privileged') is False and mounts_safe(c), 'production_mount_or_privilege')
    ports = host.get('PortBindings') or {}
    require(set(ports) == {'3000/tcp'} and len(ports['3000/tcp'] or []) == 1, 'production_ports')
    binding = ports['3000/tcp'][0]
    require(binding.get('HostIp') == '127.0.0.1' and binding.get('HostPort') in ['3000', '3001'], 'production_port_binding')
    return {'id': c['Id'], 'image': c['Image'], 'port': int(binding['HostPort']),
            'release': EXPECTED_PRODUCTION, 'calculator': EXPECTED_CALCULATOR,
            'fingerprint': container_fingerprint(c)}


def candidate_reasons(container, image, now):
    reasons = []
    c, state, config = container, container.get('State', {}), container.get('Config', {})
    labels = config.get('Labels') or {}
    def check(value, reason):
        if not value:
            reasons.append(reason)
    check(bool(NAME.fullmatch(name_of(c))), 'name')
    check(bool(re.fullmatch(r'[a-f0-9]{64}', str(c.get('Id', '')))), 'container_id')
    check(state.get('Status') == 'exited' and state.get('Running') is False
          and state.get('Paused') is False and state.get('Restarting') is False
          and state.get('Dead') is False and state.get('Pid') == 0, 'not_stopped')
    check(labels.get('avtocena.role') == 'production' and labels.get(REVISION) == FAILED_RELEASE, 'container_labels')
    check(config.get('Image') == FAILED_TAG, 'config_image')
    check(c.get('HostConfig', {}).get('Privileged') is False and mounts_safe(c), 'mounts_or_privilege')
    try:
        env = environment(c)
        check(env.get('AVTOCENA_RELEASE_SHA') == FAILED_RELEASE, 'environment_release')
        check(all(env.get(key) == value for key, value in ROUTING.items()), 'object_storage_routing')
    except GuardError as error:
        reasons.append(str(error))
    try:
        check(timestamp(c.get('Created')) <= timestamp(state.get('FinishedAt')) <= now, 'finished_time_order')
    except GuardError:
        reasons.append('finished_time_invalid')
    if not isinstance(image, dict):
        reasons.append('image_missing')
    else:
        check(image.get('Id') == c.get('Image') and bool(re.fullmatch(r'sha256:[a-f0-9]{64}', str(image.get('Id', '')))), 'image_id')
        check((image.get('Config', {}).get('Labels') or {}).get(REVISION) == FAILED_RELEASE, 'image_revision')
        check(image.get('Id') != ACCEPTED_IMAGE, 'accepted_image')
        tags, aliases = image.get('RepoTags') or [], image.get('RepoDigests') or []
        check(isinstance(tags, list) and (tags == [] or tags == [FAILED_TAG]) and not aliases, 'image_aliases')
        try:
            check(timestamp(image.get('Created')) <= timestamp(c.get('Created')), 'image_time_order')
        except GuardError:
            reasons.append('image_time_invalid')
    return reasons


def make_plan(containers, images, free_bytes, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    require(len({c.get('Id') for c in containers}) == len(containers), 'duplicate_container_id')
    production = production_view(containers, images)
    targets = [c for c in containers if NAME.fullmatch(name_of(c))]
    reasons = {c['Id']: candidate_reasons(c, images.get(c.get('Image')), now) for c in targets}
    unknown_newest = any('finished_time_invalid' in reasons[c['Id']] or 'finished_time_order' in reasons[c['Id']] for c in targets)
    newest = None if unknown_newest or not targets else max(targets, key=lambda c: (timestamp(c['State']['FinishedAt']), timestamp(c['Created']), c['Id']))
    refs = {}
    for c in containers:
        refs.setdefault(c.get('Image'), []).append(c)
    groups = []
    for image_id in sorted({c.get('Image') for c in targets}):
        referenced = refs[image_id]
        if unknown_newest or newest is None or newest.get('Image') == image_id:
            continue
        if any(c['Id'] not in reasons or reasons[c['Id']] for c in referenced):
            continue
        image = images[image_id]
        finished = max(timestamp(c['State']['FinishedAt']) for c in referenced)
        groups.append({'imageId': image_id, 'imageFingerprint': image_fingerprint(image),
                       'finishedAt': finished.isoformat(),
                       'containers': [{'id': c['Id'], 'name': name_of(c), 'fingerprint': container_fingerprint(c)}
                                      for c in sorted(referenced, key=lambda c: (c['State']['FinishedAt'], c['Id']))]})
    groups.sort(key=lambda group: (group['finishedAt'], group['imageId']))
    groups = groups[:MAX_GROUPS]
    selected_ids = {c['id'] for group in groups for c in group['containers']}
    selected_images = {group['imageId'] for group in groups}
    plan = {'schemaVersion': 1, 'failedRelease': FAILED_RELEASE, 'production': production,
            'targetFreeBytes': TARGET_FREE_BYTES, 'maximumGroups': MAX_GROUPS,
            'keepNewest': None if newest is None else {'id': newest['Id'], 'name': name_of(newest), 'image': newest['Image']},
            'groups': groups,
            'retainedContainerFingerprints': {c['Id']: container_fingerprint(c) for c in sorted(containers, key=lambda c: c['Id']) if c['Id'] not in selected_ids},
            'retainedImageIds': sorted(set(images) - selected_images)}
    inventory = [{'id': c['Id'], 'name': name_of(c), 'imageId': c.get('Image'),
                  'created': c.get('Created'), 'finishedAt': c.get('State', {}).get('FinishedAt'),
                  'state': c.get('State', {}).get('Status'), 'reasons': reasons[c['Id']],
                  'imageTags': (images.get(c.get('Image'), {}).get('RepoTags') or []) if not reasons[c['Id']] else None,
                  'referenceCount': len(refs[c.get('Image')]),
                  'references': [{'id': ref['Id'], 'name': name_of(ref)} for ref in refs[c.get('Image')]],
                  'selected': c['Id'] in selected_ids} for c in sorted(targets, key=lambda c: name_of(c))]
    return {'plan': plan, 'planSha256': digest(plan), 'inventory': inventory, 'freeBytes': free_bytes,
            'noOpReason': 'newest_failure_unproven' if unknown_newest else 'no_independent_eligible_image_groups' if not groups else None}


def execute_plan(reviewed, expected_hash, backend):
    require(re.fullmatch(r'[a-f0-9]{64}', expected_hash or '') is not None, 'reviewed_plan_hash_required')
    require(reviewed['planSha256'] == expected_hash == digest(reviewed['plan']), 'reviewed_plan_hash_mismatch')
    fresh = backend.capture()
    require(fresh['planSha256'] == expected_hash, 'inventory_changed_since_review')
    plan = reviewed['plan']
    backend.verify_production(plan['production'])
    result = {'removedContainers': [], 'removedImages': [], 'beforeFreeBytes': backend.free_bytes()}
    require(len(plan['groups']) <= MAX_GROUPS, 'group_limit')
    for group in plan['groups']:
        if backend.free_bytes() >= TARGET_FREE_BYTES:
            break
        fresh = backend.capture()
        backend.verify_production(plan['production'])
        require(fresh['plan']['production'] == plan['production'], 'production_changed')
        current_group = next((g for g in fresh['plan']['groups'] if g['imageId'] == group['imageId']), None)
        require(current_group == group, 'selected_group_changed')
        require(fresh['plan']['keepNewest'] == plan['keepNewest'], 'newest_failure_changed')
        for row in group['containers']:
            current = backend.inspect_container(row['id'])
            require(container_fingerprint(current) == row['fingerprint'], 'container_changed_before_remove')
            image = backend.inspect_image(group['imageId'])
            require(not candidate_reasons(current, image, dt.datetime.now(dt.timezone.utc)), 'container_no_longer_eligible')
            require(image_fingerprint(image) == group['imageFingerprint'], 'image_changed_before_remove')
            refs = backend.container_references(group['imageId'])
            allowed = {entry['id'] for entry in group['containers']} - set(result['removedContainers'])
            require({c['Id'] for c in refs} == allowed, 'image_references_changed')
            backend.remove_container(row['id'])
            result['removedContainers'].append(row['id'])
        require(backend.container_references(group['imageId']) == [], 'image_still_referenced')
        require(image_fingerprint(backend.inspect_image(group['imageId'])) == group['imageFingerprint'], 'image_changed_before_remove')
        backend.remove_image(group['imageId'])
        result['removedImages'].append(group['imageId'])
        backend.verify_production(plan['production'])
    after = backend.capture()
    backend.verify_production(plan['production'])
    after_fingerprints = after['allContainerFingerprints']
    for identifier, fingerprint in plan['retainedContainerFingerprints'].items():
        require(after_fingerprints.get(identifier) == fingerprint, 'retained_container_changed')
    require(set(plan['retainedImageIds']).issubset(after['allImageIds']), 'retained_image_missing')
    result['afterFreeBytes'] = backend.free_bytes()
    result['freedBytes'] = result['afterFreeBytes'] - result['beforeFreeBytes']
    result['targetReached'] = result['afterFreeBytes'] >= TARGET_FREE_BYTES
    return result


def docker(*args):
    try:
        result = subprocess.run(['docker', *args], text=True, capture_output=True, timeout=30)
    except subprocess.TimeoutExpired:
        raise GuardError('docker_command_timeout') from None
    require(result.returncode == 0, 'docker_command_failed')
    return result.stdout


class HostBackend:
    def __init__(self):
        require(Path('/opt/avtocena/PRODUCTION_ACTIVE').is_file(), 'production_marker_missing')
        root = docker('info', '--format', '{{.DockerRootDir}}').strip()
        require(root == '/var/lib/docker' and os.stat(root).st_dev == os.stat('/').st_dev, 'docker_root_not_root_filesystem')
        self.nginx = NGINX.read_bytes()
        require(len(self.nginx) <= 256 * 1024, 'nginx_config_size')

    def free_bytes(self):
        return shutil.disk_usage('/').free

    def containers(self):
        ids = docker('ps', '-aq', '--no-trunc').split()
        require(len(ids) <= 512, 'container_inventory_limit')
        return json.loads(docker('inspect', *ids)) if ids else []

    def inspect_container(self, identifier):
        return json.loads(docker('inspect', identifier))[0]

    def inspect_image(self, identifier):
        return json.loads(docker('image', 'inspect', identifier))[0]

    def capture(self):
        containers = self.containers()
        ids = sorted(set(docker('image', 'ls', '-aq', '--no-trunc').split()))
        require(len(ids) <= 512, 'image_inventory_limit')
        images = {identifier: self.inspect_image(identifier) for identifier in ids}
        result = make_plan(containers, images, self.free_bytes())
        result['allContainerFingerprints'] = {c['Id']: container_fingerprint(c) for c in containers}
        result['allImageIds'] = ids
        result['namedOrphanImageInventory'] = named_orphan_image_inventory(containers, images)
        return result

    def verify_production(self, expected):
        container = self.inspect_container(expected['id'])
        image = self.inspect_image(container['Image'])
        require(production_view([container], {image['Id']: image}) == expected, 'production_identity_changed')
        require(NGINX.read_bytes() == self.nginx, 'nginx_changed')
        require(('proxy_pass http://127.0.0.1:' + str(expected['port']) + ';').encode() in self.nginx, 'production_proxy_binding')
        connection = http.client.HTTPConnection('127.0.0.1', expected['port'], timeout=10)
        try:
            connection.request('GET', '/api/health', headers={'Connection': 'close', 'User-Agent': 'AvtoCena-Failed-Release-Retention'})
            response = connection.getresponse()
            body = response.read(65537)
            require(response.status == 200 and len(body) <= 65536, 'production_health_response')
            value = json.loads(body)
            require(value.get('ok') is True and value.get('releaseSha') == EXPECTED_PRODUCTION
                    and value.get('calculationVersion') == EXPECTED_CALCULATOR, 'production_health_identity')
        finally:
            connection.close()

    def container_references(self, image_id):
        return [c for c in self.containers() if c.get('Image') == image_id]

    def remove_container(self, identifier):
        docker('rm', identifier)
        print(json.dumps({'event': 'removed_exact_failed_container', 'id': identifier}), flush=True)

    def remove_image(self, identifier):
        docker('image', 'rm', '--no-prune', identifier)
        print(json.dumps({'event': 'removed_exact_failed_image', 'id': identifier}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-plan-sha256', default='')
    args = parser.parse_args()
    require(args.apply or not args.expected_plan_sha256, 'plan_hash_only_for_apply')
    locks = []
    for name in ['avtocena-staging-prepare', 'avtocena-runtime-change']:
        handle = open('/run/lock/' + name + '.lock', 'a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    backend = HostBackend()
    reviewed = backend.capture()
    backend.verify_production(reviewed['plan']['production'])
    print(json.dumps({'event': 'failed_encar_retention_inventory', **reviewed}, sort_keys=True), flush=True)
    result = execute_plan(reviewed, args.expected_plan_sha256, backend) if args.apply else {
        'beforeFreeBytes': reviewed['freeBytes'], 'afterFreeBytes': backend.free_bytes(),
        'removedContainers': [], 'removedImages': [], 'targetReached': backend.free_bytes() >= TARGET_FREE_BYTES}
    backend.verify_production(reviewed['plan']['production'])
    print(json.dumps({'event': 'failed_encar_retention_complete', 'apply': args.apply,
                      'planSha256': reviewed['planSha256'], **result}, sort_keys=True), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not expose Docker stderr, environment, health bodies, or credentials.
        print(json.dumps({'event': 'failed_encar_retention_refused', 'error': str(error) if isinstance(error, GuardError) else type(error).__name__}), flush=True)
        raise SystemExit(1)
