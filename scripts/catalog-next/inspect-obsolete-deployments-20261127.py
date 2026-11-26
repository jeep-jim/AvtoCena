"""Read exact accepted deployment predecessors. No Docker or filesystem mutations."""
import fcntl
import hashlib
import json
import os
import re
import sys
import types

CURRENT = '077cbb17626ab0c64e7f06db055fef9252ad21c0'
ROLLBACK = '36c7ea726e7f070d10dbc65afc6538f13c0c1a24'
OBSOLETE = 'd536c1547c4d82a339ed68ced7d8503f09b6810b'
GENERATION = 'gen_china_45655051136_1'
MANIFEST = '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d'
INVENTORY_SHA256 = '2aef3452af91cc8a7ead189a4d00d66bc3083ccb2ef9f3e0be87d2bd0fe0fe78'
# Only container identities are pinned. Unused-image pruning does not change this capture.
CONTAINERS = [
    ('07838ec491d5866fb1b2b1ff1a6c7590f70105e68317928f4df4555862e7b87c', True, 'b536b3f7fb2677433a9f4516af9d43722c9e107560d13f81673181bf7d2406eb'),
    ('147389d5eed5b3212f54f7afc967745bb85c93e922ef500fea4dcd2e707afa99', True, 'a86853d46df1637ddbc1d14bb459fea19bda31379bf882289ee2c1347f2ca781'),
    ('bf233b651cc4c84afae4b59c2f17279ea2db7475bfeef6158ca012315a7f1c23', False, 'f8ab9b4bfaba10f06fde31fdf9278097e627d43a28b70a1bcfe014515b1b6a4d'),
    ('21a7093914645595d2cfcfc26335f8e8dbf155f6906840bbfb72855ed587e1e3', False, '051f99041aaf6a118d60005df8541cfc38c04c327fa0bce517f575c6387278af'),
    ('2c180485762c286c7e73f983cd0c93a718d9dec5c2f8e442e7ee44c1a51f6729', False, '4eeabbd42092a3fa0c1c19110922f15302ec1b202d4b28a569bf301431bfe56d'),
    ('21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78', False, 'ab660c0ddc1ab44a4517f88e0599c1dc6a3863d933a252d5f4cf87876af43092'),
]
HISTORY = {
    'current': {'runtimeSha': CURRENT, 'generationId': GENERATION, 'manifestSha256': MANIFEST,
        'imageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73',
        'containerId': CONTAINERS[0][0], 'port': 3007, 'attemptHash': 'b12a972f27f0675b',
        'planSha256': '531e2a63b575fad65d6c5e001c30f402568f2edca5108bf363701e280cbd49b4',
        'acceptedSha256': 'fd0520652f8262110349d912c79c16f0ed09accfee724b2d0594c49095da6529'},
    'rollback': {'runtimeSha': ROLLBACK, 'generationId': GENERATION, 'manifestSha256': MANIFEST,
        'imageId': 'sha256:8ae738b860228534707b17eccf40c57163bd5e08c9aee0aa9cea2a2bd9c9fd6a',
        'containerId': CONTAINERS[1][0], 'port': 3006, 'attemptHash': 'd568f2e24271cb73',
        'planSha256': 'dc417eb79f5590df220b4fd9b2c8aab45e0a3d893f65d4c5eda8de2ea84e3114',
        'acceptedSha256': 'ebef946f0e4cb0650be8931a86cc045958004c93a89af1e26bbaf42837a600d3'},
    'obsoleteB': {'runtimeSha': OBSOLETE, 'generationId': GENERATION, 'manifestSha256': MANIFEST,
        'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009',
        'containerId': CONTAINERS[2][0], 'port': 3005, 'attemptHash': '6126db9e94c745c1',
        'planSha256': '32c060600be1799350af87f7a47897e935eebf6dac4a32dfd10891a1061174b3',
        'acceptedSha256': 'e4c05aa966fe34d21d411b8274af6c27e25a033950a3e353779f9599c08b7014'},
    'obsoleteA': {'runtimeSha': OBSOLETE, 'generationId': 'gen_china_45369451603_1',
        'manifestSha256': 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
        'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009',
        'containerId': CONTAINERS[3][0], 'port': 3004, 'attemptHash': '0ddc276f85ea2d45',
        'planSha256': '48d94f93a7998b7af275cae1c76afa775d5744a9581dba0694cad0170324f621',
        'acceptedSha256': '87d3bdf6648c2122e7f6916673006d98997b4069875362206c91c90b0ea91369'},
}


def need(value, code):
    if not value:
        raise ValueError('obsolete_capture_' + code)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def definition():
    return {'inventoryReportSha256': INVENTORY_SHA256, 'containers': CONTAINERS, 'history': HISTORY}


def configuration_sha(row):
    # Same canonical projection as inventory 45868066632; no raw configuration leaves the process.
    value = {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'RestartCount')}
    value['Mounts'] = sorted(row.get('Mounts') or [], key=lambda item: json.dumps(item, sort_keys=True, separators=(',', ':')))
    value['state'] = {key: row.get('State', {}).get(key) for key in
                      ('Running', 'Pid', 'StartedAt', 'FinishedAt', 'Paused', 'Restarting', 'Dead')}
    return sha(canonical(value))


def readonly_host(host):
    docker, response = host.docker, host.response_json
    ids = {row[0] for row in CONTAINERS}

    def get(method, target, body=None):
        need(method == 'GET' and body is None and (target == '/containers/json?all=1'
             or target in {'/containers/' + identifier + '/json' for identifier in ids}), 'docker_scope')
        return docker(method, target)

    def local_health(port, route, timeout=5):
        need(port in (3006, 3007) and route == '/api/health' and 0 < timeout <= 5, 'health_scope')
        return response(port, route, timeout)

    host.docker, host.response_json = get, local_health
    return host


def inspect(host, view):
    state, _ = host.checked_publication_view(view)
    need(view.get('lease', {}).get('value', {}).get('status') == 'released', 'lease_active')
    refs = {'current': state['current'], 'rollback': state['rollback']}
    files, summaries, plans, directories = {}, {}, {}, {}
    host.regular(host.CONFIG, 1024 * 1024)
    ingress = host.CONFIG.read_bytes()
    need(host.backend(ingress) == 3007, 'ingress')

    def containers():
        listing = host.docker('GET', '/containers/json?all=1')
        need(isinstance(listing, list) and len(listing) == len(CONTAINERS)
             and {row.get('Id') for row in listing} == {pin[0] for pin in CONTAINERS}, 'container_set')
        result = {}
        for identifier, running, fingerprint in CONTAINERS:
            row = host.docker('GET', '/containers/' + identifier + '/json')
            need(row.get('Id') == identifier and row.get('State', {}).get('Running') is running
                 and configuration_sha(row) == fingerprint, 'container_changed')
            result[identifier] = row
        return result

    initial = containers()

    def history(name):
        reference, pin = refs[name], HISTORY[name]
        need(all(reference.get(field) == pin[target] for field, target in
                 [('runtimeSha', 'runtimeSha'), ('imageId', 'imageId'), ('generationId', 'generationId'),
                  ('generationManifestSha256', 'manifestSha256')]), 'reference_binding')
        receipt = host.verified_history(reference)
        need(sha(receipt['nonce'].encode())[:16] == pin['attemptHash'], 'attempt_binding')
        directory, plan = host.reference_plan(reference, receipt)
        for filename, expected in [('PLAN.json', pin['planSha256']), ('ACCEPTED.json', pin['acceptedSha256'])]:
            _, raw = host.diagnosis_json(directory / filename)
            need(sha(raw) == expected, 'proof_changed')
            files[directory / filename] = raw
        generation = host.check_mounted_reference(initial[pin['containerId']], reference, receipt['nonce'],
                                                 require_running=name in ('current', 'rollback'))
        _, generation_raw = host.diagnosis_json(directory / 'generation' / 'GENERATION.json')
        need(sha(generation_raw) == pin['manifestSha256'], 'manifest_changed')
        files[directory / 'generation' / 'GENERATION.json'] = generation_raw
        ports = [str(binding.get('HostPort')) for rows in
                 (initial[pin['containerId']].get('HostConfig', {}).get('PortBindings') or {}).values() for binding in rows]
        need(ports == [str(pin['port'])], 'port_binding')
        if name in ('current', 'rollback'):
            host.health(pin['port'], pin['runtimeSha'])
        else:
            need(initial[pin['containerId']]['State']['Running'] is False
                 and initial[pin['containerId']]['State']['Pid'] == 0
                 and not re.search(rb'127\.0\.0\.1:' + str(pin['port']).encode() + rb'\b', ingress), 'obsolete_live')
        summaries[name] = {**pin, 'referenceSha256': host.canonical_sha(reference),
            'nonceSha256': sha(receipt['nonce'].encode()), 'hostReceiptSha256': reference['proof']['hostReceiptSha256'],
            'running': name in ('current', 'rollback'), 'generationVerified': True}
        plans[name], directories[name] = plan, directory

    history('current')
    history('rollback')
    # The actual accepted plans authenticate these references; names or old inventory alone do not.
    for parent, target in [('current', 'obsoleteB'), ('rollback', 'obsoleteA')]:
        plan = plans[parent]
        previous = {'found': True, 'value': plan.get('previousAcceptedState'),
                    'etag': plan.get('previousAcceptedETag'), 'sha256': plan.get('previousAcceptedStateSha256')}
        prior = host.checked_accepted_observation(previous)
        refs[target] = prior['rollback']
        if parent == 'current':
            need(prior['current'] == refs['rollback'], 'predecessor_chain')
        else:
            need(prior['current'] == refs['obsoleteB'], 'predecessor_chain')
        history(target)
        summaries[target]['predecessorOf'] = parent
        summaries[target]['previousAcceptedStateSha256'] = previous['sha256']
        summaries[target]['previousAcceptedETagSha256'] = sha(previous['etag'].encode())

    bulk = []
    for name in ('obsoleteA', 'obsoleteB'):
        directory, plan, target_id = directories[name], plans[name], HISTORY[name]['containerId']
        for identifier, container in initial.items():
            if identifier == target_id:
                continue
            for mount in container.get('Mounts', []):
                source = mount.get('Source')
                if source:
                    mounted = host.Path(source).resolve()
                    need(mounted != directory and mounted not in directory.parents and directory not in mounted.parents,
                         'obsolete_mount_shared')
        for descriptor in plan['files']:
            if descriptor['name'] not in host.HOST_BULK_FILES:
                continue
            filename = (directory if descriptor['name'] == 'image.tar' else directory / 'generation') / descriptor['name']
            try:
                metadata = host.regular(filename)
                need(metadata.st_size == descriptor['bytes'], 'bulk_size_changed')
                present, allocated = True, metadata.st_blocks * 512
            except FileNotFoundError:
                present, allocated = False, 0
            bulk.append({'deployment': name, 'name': descriptor['name'], 'present': present,
                         'declaredBytes': descriptor['bytes'], 'declaredSha256': descriptor['sha256'],
                         'allocatedBytes': allocated, 'contentHashVerified': False})
    for filename, raw in files.items():
        need(host.diagnosis_json(filename)[1] == raw, 'metadata_changed')
    final = containers()
    need(all(host.protected_identity(initial[key]) == host.protected_identity(final[key]) for key in initial)
         and host.CONFIG.read_bytes() == ingress, 'host_changed')
    disk = os.statvfs(host.BASE)
    return {'version': 1, 'kind': 'obsolete-deployments-host-readonly-v1', 'readOnly': True,
        'inventoryReportSha256': INVENTORY_SHA256, 'definitionSha256': sha(canonical(definition())),
        'acceptedStateSha256': view['accepted']['sha256'], 'intentSha256': view['intent']['sha256'],
        'leaseSha256': view['lease']['sha256'], 'containersChecked': len(final), 'containersUnchanged': True,
        'ingressSha256': sha(ingress), 'ingressUnchanged': True, 'history': summaries,
        'bulkFiles': bulk, 'allocatedBulkBytes': sum(row['allocatedBytes'] for row in bulk),
        'diskAvailableBytes': disk.f_bavail * disk.f_frsize, 'bulkContentHashesVerified': False,
        'supplierRequests': 0, 'storageWrites': 0, 'hostWrites': 0, 'localHealthRequests': 2}


def main():
    lock = None
    stage = 'input'
    try:
        raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
        need(0 < len(raw) <= 2 * 1024 * 1024, 'input_bound')
        packet = json.loads(raw)
        need(set(packet) == {'hostSource', 'hostSourceSha256', 'publicationState'}
             and isinstance(packet['hostSource'], str) and sha(packet['hostSource'].encode()) == packet['hostSourceSha256'], 'input')
        stage = 'helper'
        host = types.ModuleType('reviewed_release_host')
        exec(compile(packet['hostSource'], '<reviewed-release-host>', 'exec'), host.__dict__)
        readonly_host(host)
        stage = 'lock'
        # The ordinary publisher creates this lock. Read-only diagnostics never create it.
        lock = os.open('/run/lock/avtocena-runtime-change.lock', os.O_RDONLY | os.O_NOFOLLOW)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stage = 'inspection'
        report = inspect(host, packet['publicationState'])
        sys.stdout.write(json.dumps(report, separators=(',', ':')) + '\n')
    except Exception:
        # Neither helper exception text, private state nor raw Docker responses enter the artifact.
        sys.stdout.write(json.dumps({'version': 1, 'kind': 'obsolete-deployments-host-refused-v1',
                                    'stage': stage, 'readOnly': True}) + '\n')
        return 1
    finally:
        if lock is not None:
            os.close(lock)
    return 0


if __name__ == '__main__':
    if sys.argv[1:] == ['--verify-targets']:
        print(json.dumps({'definition': definition(), 'definitionSha256': sha(canonical(definition()))}, separators=(',', ':')))
    elif not sys.argv[1:]:
        sys.exit(main())
    else:
        sys.exit(1)
