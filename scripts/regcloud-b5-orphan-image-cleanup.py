#!/usr/bin/env python3
"""Delete at most two reviewed, unreferenced b5 image IDs; retain every container.

Only the exact metadata from successful inventory43828596253 is accepted.
The10GiB goal is checked against real free bytes after each image removal.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

APPROVED_PLAN = json.loads('{"allContainerFingerprints":{"21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78":"09825ee9a1efea5f27ab611516849300f90e9732907e685d07d11578bfc88775","540557802d1a0d7f75c598e8815cb2364cd94a457379eba61638a46d03586af8":"2efac9727e5e792d9eb4c405afc5cde29fdf38f71a5b737eb9d597db66058ba9","66008b8b31ba8e570041c3088864de413cd614fd6b37973c23585869a0f29f07":"3630be624c306a4ef9ead73d59e847cfa4c521e4d8e879cacafa2481bb770c94","6c0f7b7215e187f3fd7f232ef77548873927c384a875a0066ea75f71591a8175":"5e241ebb243e24697ddbe3b6dd141fc460afdf31077d6ac480d58aafaa3ac794","6c4287f78e8db46bdf80706b1e712b2ccbc2e3040d48e69090c2efe775e2b089":"8fd5a05bae9097a898bda8e68c074cd452ae7b5b9211c19de6b435e492e818f1","6f06ce2f951632d251c8382205650c6ec3ee2dafa4af07b4adc19ac20e8efa4e":"db4a1a9481e2931766f320b305e877423ae88c8f296de47d53fe44ce65ebeaa2","764b0b9681c5f38e0d66e6fd8dd794651ff7ec9085513c70026aa647da4e75be":"36e82ce0a994a509d73c555dc2b67eee08f7e425afae2e0df2824a22a8c124ea","9168e3bf01e5b09866541718ab8522ee2dffc0eeecd36c51c55877a862b32871":"211f4b1f80401dad3c0dc4ba7c1a27b1a2e3a132448a25b13a8c8042a4bb36df","9485e49a381bf1474dd3f5793b417d3047eff206f75c67ceb4a36dd946f2cf16":"6b9a9f9cbde16b45b6eaf2f10da80a86b184e48ca0db60f918f68bedd56cbebb","9bba3f06c0684c7eaba7b15e73fa19b9e71cefd538f08e264792e70a280bc430":"e575df43734df7bccaa2c71311127ad236f533852b033925d15184c688cc809e","9c22e96f0cba041c5a64fd6d5f54bbd4b8d0537edb985e3f4b096ef814fcb7a1":"4de2abc10cbb6d25baabafb7b09446903cfac3b21c3a7545fc05c5056c8a48f5","9c51d5d7d7a668104a14400a81be06aa758991a9ca2299a2c640ddec54e4a64d":"6cbeb778e5ab8b58f5d20f321fc7bdeed9e5513a64e6eb450ab0eb1179e58172","a126460e026d73b06150c23a78c871a472563ce874d44cf22bc743872d9cde3f":"0f4a672d5357b47a84a9e7d915bbbf71366023f524ae076aa950a312c26dc107","a61bd91a853158ed9a03eac482045b456c6d28edf3328dabdc5adb1be6aafb39":"8fbd27de2788a8869af78356f579e1b3a8062a940deb0181b341972754c24120","a78792122f0c6a338e6c4688562a77737a304d3d45efcf7173ff3811aa48857b":"d447bf5a84e9f1dc7d193e8309ea079780dacd6bdcb0e9d10cdac7157573c8e0","ab2dd33e8b7330b91c3f56558c4a545504f8e21b6fabc8fcdca3ae1df73ef1cd":"bc6aea46fea76f621a554e97aff5d2068e1c3dccc962e5d3d7346c8a44b7ec0e","b79f7989f96290a854dd3b1f28f3187a3b761b3db26ade989085b32aee7f1201":"955337ac8df9884f8de4dd08d3ae36b18506978cd05e82a89c63f05057ae1241","c07ed22f77e9467958ef3a95b456731e8dbf36a3264710105675a95d8f3579df":"bc5447e71f97ef5ea857d14fa456ddfc4d8f5f430c80ebb4c4baadbc6b32e553","c083829568964b058e1a90ea517ceb10df44f6a937a98ee6700d7b5b5976afcf":"5f629d904fcb025261567f71333d3bc7071cf18402dd7cfba15722bb498e66ab","c3fe3f09e7065897c82fcd232f4551aaae525d977928b7a75214209b4973dfbc":"f871aec8024deffb2ce7b0ee428dfb18a61c3c4c1b8d3944d1833d0f1b7d5f49","d3f6c9af9a5cd549dfee9c49c408a5201197cefed84541319d1cfcbcf11cb14c":"d5aa062d9efe4768d4bf91c0df10a367bbfa31ace37418ae202d8614b44a3499","f17db977935e2e918fd19474feaee3e0d02d420989c9ae6689d592b994d12020":"4ffd9478c0346a76dc262bf6f14271c33f8b1f943b41cee8d8e6c59b07267302","f664adabeed0686ab2feb491fc73495b54420f86c857acc987ec9fed8d2ec01f":"4618e92920a9beb8028d72f33dd7c8ed462300b246401e0aee3e467c8fc7e596","f9c0cbfd090ae61f946c2064ca8ccfff053a97f8d51fadb1fdd83581938f3b50":"cf2c87cfee43d63db65664efdd4809a087d0f8e43ef73a6dee08b3ede4a2cdeb","fa3903352b8d626484ff402211a422fdbc582267fb36bd0859940d5e7ad51f7e":"b4dcb9fa044f902408ac0deb8cf7e6ddcaaff447dfeedd51d009d0ce219e2fed"},"allImageIds":["sha256:04a0e4ab49162be012780d304269430fcd7004e9a2feeda56fcabc3b32ffe7b0","sha256:08c7cdc29babb0d9e9c905e067d7ce5a23fdf0314809305be1691c4f6c343a12","sha256:181c6706069a9138414bd0aba2015839ba30feec0b43cf0e7e9889a5ae2f2ab1","sha256:1ed16164c0aa87d0c2e48d14ea1aa5570b7e004f123d48244974546217b29f81","sha256:20e8b137401228d6ec664f046094aa32306a28400dd39237765e2651e97c342e","sha256:2110809abc3a3bad1589f62e8c79122f26ca61cda79b33c265fd4872040db98f","sha256:2fa2c913567930cfc0b0e716b27cde6e76a34ca530f42fa383c7ee4870beb1f8","sha256:44c596a793bb0c75f4c3e30f40a8fe6b6f6a3c9501ab0c3eb0ae38953e682885","sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd","sha256:4fdc9d4e565896d7eca668b3c64499e31cb28463ddf4401507e7e8668eb476f4","sha256:5d4d507918cc3be333f8c33ce73a4f0325213e43d15d459c3696c687e93cd422","sha256:7193fc9569a5ff95760a93a005f2ba8a84adb64874c6812f29de8a3f069bf6b6","sha256:73181d873ae5ea890f3d98e15a323614a7d3f442a97c1eb757974c2aafc8fc8d","sha256:798366590b9882ef063e1a18b78f65dcee92428914a1027c6361d55e5b1d3bd9","sha256:8351b6ab2ef73dab1ba4c75a3f8fe77f208fcc8aa4a5115caa7ffe2f35bd9378","sha256:86994ffb4ff55c1788bd18f3f3e426106db8ccc6352ddf17e80ff1fba4a98c34","sha256:8ce3e4fe56f6bbce6d002890120de4111e6bb3a45bd8b427f0b7b645c9baf00d","sha256:98b16b1fbbc9457bfbcefde6ebcd7234b6a76c6b0a69c8d70548eff48e6305f9","sha256:9f87837741443a519693fa084acdd1ee088e5ed039e2898f6f0bd7f877972372","sha256:a60befae2ca422040c025c02f3298f9eb5f17ef1acef112b4d4bfe001b7d41d6","sha256:acb612b3d2a99e9ec7e5d0b0d6b28af43c0d1872b3623afdb9b6674b27f4a9e6","sha256:aeb5bea53d97721fb6d7283765863eaf8893836f8ccfaaa4aa2abbe6d7705718","sha256:bc2ed2b27a1a3448678af0a8340d837e8757785f78a6a49f037853b38f522981","sha256:bdf4d5a3c207945453f4b2c4ad828b5aea858672de0c9052d47e29bf2197edae","sha256:c04fbe5c188d56e10ece7860509ab622b46d732b01e7a86dcec9c3db966f3bc8","sha256:c714b84a5b3f5f533726a364aa63836cea9f5335238503f94f89847a74e36b0c","sha256:c99d9700593caeacf2bdbf062b801c37072c761bf9b204b3c0eb8cfb6f8cd497","sha256:ccfe8f9fb7382dc1ae2bd711f52723e657bab65a4b49a6f9604ff952438aa444","sha256:d909519d647357acae8f5347ed696e503031e706b564a5b808b27d75738d3e89","sha256:db9db9d8630343b722a1b9625cc9b18058a6d6f3c4d9b9a239001a3c6e40bc49","sha256:e084bb738abaf12042cd220bb48f699a6e101316d0b223a5725d74436fb62c85","sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f","sha256:fc248eb393edfec3a5b37376b5fe51ea335fb8078ebe522df606b3777da9fb04"],"images":[{"created":"2026-11-15T05:52:13.996919413Z","expectedRevisionMatched":true,"imageFingerprint":"558706748bdd96cd645ad16d6583303b42205458dc7a53dcce6c107a17fa7c23","imageId":"sha256:2fa2c913567930cfc0b0e716b27cde6e76a34ca530f42fa383c7ee4870beb1f8","present":true,"referenceCount":0,"references":[],"repoDigests":[],"repoTags":[],"revision":"b5ad05ee8ad042e4ff7b911a1990fbcd8b703b30","sizeBytes":1394057140},{"created":"2026-11-15T06:30:16.438664751Z","expectedRevisionMatched":true,"imageFingerprint":"d4fc714a0ee10b8eaf2b0514a914cbc44039b20ee9bfa54ba4cfc04afcaf345e","imageId":"sha256:fc248eb393edfec3a5b37376b5fe51ea335fb8078ebe522df606b3777da9fb04","present":true,"referenceCount":0,"references":[],"repoDigests":[],"repoTags":[],"revision":"b5ad05ee8ad042e4ff7b911a1990fbcd8b703b30","sizeBytes":1394057139}],"inventoryPlanSha256":"09c738f4d7ca9d9e66068d020204082657646b7ef590ac73a6a18a3335ddc3cc","inventoryRunId":43828596253,"inventorySource":"adc2a474366a13532df94c808d733aed23576eda","keepNewest9cb":{"id":"a61bd91a853158ed9a03eac482045b456c6d28edf3328dabdc5adb1be6aafb39","image":"sha256:44c596a793bb0c75f4c3e30f40a8fe6b6f6a3c9501ab0c3eb0ae38953e682885","name":"avtocena-release-9cb571fcce50"},"maximumImages":2,"production":{"calculator":"4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90","fingerprint":"09825ee9a1efea5f27ab611516849300f90e9732907e685d07d11578bfc88775","id":"21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78","image":"sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd","port":3001,"release":"83ff17075e9188dcf227c8752dc064248d5f42e0"},"retainedB5Images":[{"created":"2026-11-15T07:20:47.118679832Z","expectedRevisionMatched":true,"imageFingerprint":"afb123af3f929ff3b0c09a40df518ffd332ba4a8893c53d6b30b081d5563bfd4","imageId":"sha256:c714b84a5b3f5f533726a364aa63836cea9f5335238503f94f89847a74e36b0c","present":true,"referenceCount":1,"references":[{"id":"f9c0cbfd090ae61f946c2064ca8ccfff053a97f8d51fadb1fdd83581938f3b50","name":"avtocena-release-b5ad05ee8ad0","revision":"b5ad05ee8ad042e4ff7b911a1990fbcd8b703b30","running":false,"state":"exited"}],"repoDigests":["avtocena-regcloud@sha256:c714b84a5b3f5f533726a364aa63836cea9f5335238503f94f89847a74e36b0c"],"repoTags":["avtocena-regcloud:b5ad05ee8ad042e4ff7b911a1990fbcd8b703b30"],"revision":"b5ad05ee8ad042e4ff7b911a1990fbcd8b703b30","sizeBytes":1394060724}],"schemaVersion":1,"sourceRevision":"b5ad05ee8ad042e4ff7b911a1990fbcd8b703b30","targetFreeBytes":10737418240}')
APPROVED_PLAN_SHA256 = '8a00492edf9748e7f696d1fcfb8ff8abfc0f394f2ab40e388392daefe223b653'
SAFEGUARDS_SHA256 = 'af1a1234b8702633651ae55e2d6f62dbb574280f4cab96f7a3348ef12b05b5ec'


class Refused(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def plan_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_snapshot(snapshot, removed):
    plan = APPROVED_PLAN
    require(snapshot['plan']['production'] == plan['production'], 'production_changed_since_inventory')
    require(snapshot['allContainerFingerprints'] == plan['allContainerFingerprints'], 'container_inventory_changed')
    require(set(snapshot['allImageIds']) == set(plan['allImageIds']) - set(removed), 'image_inventory_changed')
    require(snapshot['plan']['keepNewest'] == plan['keepNewest9cb'], 'newest_9cb_changed')
    current = snapshot.get('namedOrphanImageInventory', {})
    require(current.get('readOnly') is True and current.get('sourceRevision') == plan['sourceRevision'], 'orphan_inventory_scope')
    require(current.get('otherImagesOfSameRevisionRetained') == plan['retainedB5Images'], 'current_b5_image_changed')
    rows = current.get('requestedImages') or []
    require(len(rows) == 2 and len({row.get('imageId') for row in rows}) == 2, 'orphan_inventory_shape')
    indexed = {row['imageId']: row for row in rows}
    for expected in plan['images']:
        current = indexed.get(expected['imageId'])
        require(current is not None, 'reviewed_image_not_reported')
        if expected['imageId'] in removed:
            require(current.get('present') is False, 'removed_image_still_present')
        else:
            require(current == expected, 'reviewed_image_metadata_changed')


def execute_cleanup(backend, apply=False, expected_plan_sha256=''):
    require(plan_digest(APPROVED_PLAN) == APPROVED_PLAN_SHA256, 'compiled_review_plan_changed')
    require(len(APPROVED_PLAN['images']) == APPROVED_PLAN['maximumImages'] == 2, 'image_limit')
    require(not apply or expected_plan_sha256 == APPROVED_PLAN_SHA256, 'reviewed_plan_confirmation_required')
    before = backend.capture()
    validate_snapshot(before, [])
    backend.verify_production(APPROVED_PLAN['production'])
    result = {'schemaVersion': 1, 'apply': apply, 'inventoryRunId': APPROVED_PLAN['inventoryRunId'],
              'inventorySource': APPROVED_PLAN['inventorySource'], 'planSha256': APPROVED_PLAN_SHA256,
              'removedImages': [], 'removedContainers': [], 'beforeFreeBytes': backend.free_bytes(),
              'targetFreeBytes': APPROVED_PLAN['targetFreeBytes'], 'measurements': []}
    for expected in APPROVED_PLAN['images']:
        if not apply or backend.free_bytes() >= APPROVED_PLAN['targetFreeBytes']:
            break
        # Hold both application locks and recheck the entire retained inventory.
        validate_snapshot(backend.capture(), result['removedImages'])
        backend.verify_production(APPROVED_PLAN['production'])
        # Fresh exact image metadata and ALL-container references immediately
        # precede non-forced removal. No tag or calculated replacement is used.
        require(backend.candidate_metadata(expected['imageId']) == expected, 'image_changed_immediately_before_remove')
        require(backend.container_references(expected['imageId']) == [], 'image_became_referenced')
        backend.remove_image(expected['imageId'])
        result['removedImages'].append(expected['imageId'])
        backend.verify_production(APPROVED_PLAN['production'])
        validate_snapshot(backend.capture(), result['removedImages'])
        result['measurements'].append({'imageId': expected['imageId'], 'freeBytes': backend.free_bytes()})
    validate_snapshot(backend.capture(), result['removedImages'])
    backend.verify_production(APPROVED_PLAN['production'])
    result['afterFreeBytes'] = backend.free_bytes()
    result['freedBytes'] = result['afterFreeBytes'] - result['beforeFreeBytes']
    result['targetReached'] = result['afterFreeBytes'] >= APPROVED_PLAN['targetFreeBytes']
    result['allContainersUnchanged'] = True
    result['otherImagesRetained'] = True
    return result


class Backend:
    def __init__(self, safeguards):
        self.safeguards = safeguards
        self.host = safeguards.HostBackend()

    def capture(self):
        return self.host.capture()

    def free_bytes(self):
        return self.host.free_bytes()

    def verify_production(self, expected):
        self.host.verify_production(expected)

    def container_references(self, identifier):
        return self.host.container_references(identifier)

    def candidate_metadata(self, identifier):
        image = self.host.inspect_image(identifier)
        rows = self.safeguards.named_orphan_image_inventory(self.host.containers(), {identifier: image})['requestedImages']
        return next(row for row in rows if row['imageId'] == identifier)

    def remove_image(self, identifier):
        require(identifier in {row['imageId'] for row in APPROVED_PLAN['images']}, 'image_outside_review')
        # --no-prune also preserves untagged parent image objects.
        self.safeguards.docker('image', 'rm', '--no-prune', identifier)
        print(json.dumps({'event': 'removed_reviewed_unreferenced_b5_image', 'imageId': identifier}), flush=True)


def load_safeguards():
    filename = Path(__file__).with_name('regcloud-failed-encar-retention.py')
    require(hashlib.sha256(filename.read_bytes()).hexdigest() == SAFEGUARDS_SHA256, 'safeguards_source_changed')
    spec = importlib.util.spec_from_file_location('retention_safeguards', filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(safeguards=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-plan-sha256', default='')
    args = parser.parse_args()
    locks = []
    for name in ['avtocena-staging-prepare', 'avtocena-runtime-change']:
        handle = open('/run/lock/' + name + '.lock', 'a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    backend = Backend(safeguards or load_safeguards())
    try:
        result = execute_cleanup(backend, args.apply, args.expected_plan_sha256)
    finally:
        backend.verify_production(APPROVED_PLAN['production'])
    print(json.dumps({'event': 'reviewed_b5_orphan_cleanup_complete', **result}, sort_keys=True), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'event': 'reviewed_b5_orphan_cleanup_refused', 'error': str(error) if isinstance(error, Refused) else type(error).__name__}), flush=True)
        raise SystemExit(1)
