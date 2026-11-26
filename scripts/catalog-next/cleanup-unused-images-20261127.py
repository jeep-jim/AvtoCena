"""Remove only reviewed unused application images; retain every container and private file."""
import base64
import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import types
from pathlib import Path

# Exact identities and immutable proof hashes from read-only inventory 45868066632.
CURRENT = '077cbb17626ab0c64e7f06db055fef9252ad21c0'
ROLLBACK = '36c7ea726e7f070d10dbc65afc6538f13c0c1a24'
GENERATION = 'gen_china_45655051136_1'
MANIFEST = '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d'
INVENTORY_RUN_ID = 45868066632
INVENTORY_REPORT_SHA256 = '2aef3452af91cc8a7ead189a4d00d66bc3083ccb2ef9f3e0be87d2bd0fe0fe78'
LATEST_CANDIDATE_IMAGE_ID = 'sha256:43a330f7267704fed1f1a9827e309bca4f704b8b3b607daed2c516305a627f57'
TARGETS = [{'id': 'sha256:43a330f7267704fed1f1a9827e309bca4f704b8b3b607daed2c516305a627f57',
  'runtimeSha': 'b25a95122199378afc5166ed7ac8882a84ed9fe3',
  'created': '2026-11-26T16:49:30.708652394Z',
  'sizeBytes': 258544941,
  'tags': ['avtocena-china-runtime:b25a95122199378afc5166ed7ac8882a84ed9fe3-3dccda063d9e'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:43a330f7267704fed1f1a9827e309bca4f704b8b3b607daed2c516305a627f57'],
  'attemptHash': '6653baae33343716',
  'proofSha256': {'PLAN.json': 'fec233847e65e83ef497d5952ec0fc4081795a7f0114213e3de7156207620753',
                  'ROLLED_BACK.json': '16f40753b869c22ce0563e7e7353e57cc044a50e26f4c4333ac0acfab2965e7f',
                  'FAILED_CODE_CLEANUP.json': 'b1cba1db94bb46ee76a972d93949264c89479b1f6d0e2ffc394e926c77005344'},
  'retainedRuntimeSha': '077cbb17626ab0c64e7f06db055fef9252ad21c0',
  'retainedImageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73'},
 {'id': 'sha256:63429295e578122a4e3c36a5b9e9f7660db8f86d008e0cbad6500718e1b270e2',
  'runtimeSha': '8cc5f755f0792c0dcd5517ec2df3295d5c0b2b1a',
  'created': '2026-11-26T09:17:24.829020925Z',
  'sizeBytes': 258518489,
  'tags': ['avtocena-china-runtime:8cc5f755f0792c0dcd5517ec2df3295d5c0b2b1a-d2a14d431f0d'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:63429295e578122a4e3c36a5b9e9f7660db8f86d008e0cbad6500718e1b270e2'],
  'attemptHash': '09f3254b911c6ed5',
  'proofSha256': {'PLAN.json': 'ce75c71729f4cfabe14001a321f900945d32f7183fae80cc58bd088590eb01cc',
                  'ROLLED_BACK.json': '46696bcedf2a68d4f7793be88caee903f78a870f73644d3baca44f6e9f063361',
                  'FAILED_CODE_CLEANUP.json': 'feddf98cfbb9b078257cea9f1f329b96a1633346311672526c4aed077c8c830e'},
  'retainedRuntimeSha': '36c7ea726e7f070d10dbc65afc6538f13c0c1a24',
  'retainedImageId': 'sha256:8ae738b860228534707b17eccf40c57163bd5e08c9aee0aa9cea2a2bd9c9fd6a'},
 {'id': 'sha256:68a54583a3329969e0911674a5ece21b2277660465a47a6a4460d7f037b3d6de',
  'runtimeSha': '996ad32a03707d1d4702e17d80419ded454628d2',
  'created': '2026-11-26T15:42:50.154230532Z',
  'sizeBytes': 258549655,
  'tags': ['avtocena-china-runtime:996ad32a03707d1d4702e17d80419ded454628d2-94ee5b0450f4'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:68a54583a3329969e0911674a5ece21b2277660465a47a6a4460d7f037b3d6de'],
  'attemptHash': 'b1d0d89e0990b674',
  'proofSha256': {'PLAN.json': 'fa3d6e5e26b6efab7e9959fe552bcdc0a1f5d8e599bb62d604ba5bf84451a962',
                  'ROLLED_BACK.json': '7e2826f15e7f3e7b96c4447ec661ab71289cdbf45b7f4812a02a89ccd3121248',
                  'FAILED_CODE_CLEANUP.json': 'f7779e667dc6da61875b3528ef3074bcc4728ae090e6a6d035c9e7f74e1c6735'},
  'retainedRuntimeSha': '077cbb17626ab0c64e7f06db055fef9252ad21c0',
  'retainedImageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73'},
 {'id': 'sha256:8f385c14a1c0015575f5c33fa2865efa4495d7bd70d64974cde852c262297505',
  'runtimeSha': 'cf932b18644b5317c142ffdeb8f1586526644012',
  'created': '2026-11-26T14:46:33.569242009Z',
  'sizeBytes': 258539112,
  'tags': ['avtocena-china-runtime:cf932b18644b5317c142ffdeb8f1586526644012-c068fafb5725'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:8f385c14a1c0015575f5c33fa2865efa4495d7bd70d64974cde852c262297505'],
  'attemptHash': '6b8640838c98a6b5',
  'proofSha256': {'PLAN.json': 'e56428e9fe9c1721c6c2b79efbb2d4a2ccfca3e9b26177e8d0aaf00f3b6e7b4c',
                  'ROLLED_BACK.json': '18d0726048fa4c840a16be7c2f714945e7fc96b853b4d1496c65e94e5c6818c6',
                  'FAILED_CODE_CLEANUP.json': '348c4e95c688e50a927a8d6c925c6ec93a0474a7497f9651c9359628283847f1'},
  'retainedRuntimeSha': '077cbb17626ab0c64e7f06db055fef9252ad21c0',
  'retainedImageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73'},
 {'id': 'sha256:9c0fd19a6c1ce9ddea76fd214fbc2438577addf7c143d83e712450682b73fa91',
  'runtimeSha': 'fe4439d89ee10d022e3d122963aa9dbb9a3ecfd5',
  'created': '2026-11-26T13:17:01.770374936Z',
  'sizeBytes': 258539284,
  'tags': ['avtocena-china-runtime:fe4439d89ee10d022e3d122963aa9dbb9a3ecfd5-aa0288b64636'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:9c0fd19a6c1ce9ddea76fd214fbc2438577addf7c143d83e712450682b73fa91'],
  'attemptHash': '137053f3ce2460dd',
  'proofSha256': {'PLAN.json': '6f9492485752f01a7a00efd13523607032add41e5119b318bd80363f063b41a2',
                  'ROLLED_BACK.json': 'afa2bb550696508d48ab8fe98976a9349c5173a495c2cf1424cfcfe24d3a4fa9',
                  'FAILED_CODE_CLEANUP.json': '4e684e52813ad59b187e0404c456be82e8aeb819dce8a7fd1bfbf9b08c4b3bc5'},
  'retainedRuntimeSha': '077cbb17626ab0c64e7f06db055fef9252ad21c0',
  'retainedImageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73'},
 {'id': 'sha256:9cdc2f0c2eac3b8cbee6c623fe8a02932cf995976afb27e9f7bffc5612e552c6',
  'runtimeSha': '7f1231f99129cc071bdba48462d17f6eae78c5ad',
  'created': '2026-11-26T12:20:39.239019579Z',
  'sizeBytes': 258546645,
  'tags': ['avtocena-china-runtime:7f1231f99129cc071bdba48462d17f6eae78c5ad-526a463d9d27'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:9cdc2f0c2eac3b8cbee6c623fe8a02932cf995976afb27e9f7bffc5612e552c6'],
  'attemptHash': '64283bb02a816a6e',
  'proofSha256': {'PLAN.json': '0349e1314a6ae8a1680b4ec91ec4a10a00963c58901ae71b0314915c041308e1',
                  'ROLLED_BACK.json': '0e05ecd626d25baf949af0f08327d2782b2f452d0d4bb7a68d2dff828d888ec3',
                  'FAILED_CODE_CLEANUP.json': '40ea7d7762abfc05348fae0a96d0c4b1565c59a9a0e571cb99e62475322b8cdf'},
  'retainedRuntimeSha': '077cbb17626ab0c64e7f06db055fef9252ad21c0',
  'retainedImageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73'},
 {'id': 'sha256:9f420c21046ca02f2cf4105eacc4478f344f782f58bac45c7aba92f968dcc618',
  'runtimeSha': 'fe4439d89ee10d022e3d122963aa9dbb9a3ecfd5',
  'created': '2026-11-26T13:44:02.144745081Z',
  'sizeBytes': 258543301,
  'tags': ['avtocena-china-runtime:fe4439d89ee10d022e3d122963aa9dbb9a3ecfd5-e26c8e475d94'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:9f420c21046ca02f2cf4105eacc4478f344f782f58bac45c7aba92f968dcc618'],
  'attemptHash': '51d968f85be2a818',
  'proofSha256': {'PLAN.json': '411da3386a29f15d829ac299c4582c9f2e0be292f8ed80a3ee9886642d40ed59',
                  'ROLLED_BACK.json': '91b560a5b9e1e60e8f3579bd275d9efb921d7c69a6281bc04c32ea121f5df766',
                  'FAILED_CODE_CLEANUP.json': 'f9e85c461f1ef145633ce5f2f1d4fb51f56bec9e9c20cd7defe82b7e58710cb9'},
  'retainedRuntimeSha': '077cbb17626ab0c64e7f06db055fef9252ad21c0',
  'retainedImageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73'},
 {'id': 'sha256:fb1678ee498af616d06869da66c94dad41331c49c859294343d3b28e576d6d6b',
  'runtimeSha': '9c2a2bb55aec0a1d68d12b9744dff164b9dda053',
  'created': '2026-11-26T05:44:26.951769967Z',
  'sizeBytes': 258511613,
  'tags': ['avtocena-china-runtime:9c2a2bb55aec0a1d68d12b9744dff164b9dda053-47f4787e890c'],
  'digestCount': 1,
  'digests': ['avtocena-china-runtime@sha256:fb1678ee498af616d06869da66c94dad41331c49c859294343d3b28e576d6d6b'],
  'attemptHash': 'e9a5f6985affe481',
  'proofSha256': {'PLAN.json': '7191f9bed519177f19bdb9ac6557185f4e41b92130bc2ce2f0343c26eeb494dc',
                  'ROLLED_BACK.json': 'e79006b518176697726bd27b0af0becfb04cabf684b3da1060010e6e15eea8ce',
                  'FAILED_CODE_CLEANUP.json': '44e0cb16a7ff95bfc617b24434d1703b194467474bb335f22aa3c830a806ab6d'},
  'retainedRuntimeSha': 'd536c1547c4d82a339ed68ced7d8503f09b6810b',
  'retainedImageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009'}]
CONTAINER_PINS = [{'id': '07838ec491d5866fb1b2b1ff1a6c7590f70105e68317928f4df4555862e7b87c',
  'imageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73',
  'running': True,
  'configurationSha256': 'b536b3f7fb2677433a9f4516af9d43722c9e107560d13f81673181bf7d2406eb'},
 {'id': '147389d5eed5b3212f54f7afc967745bb85c93e922ef500fea4dcd2e707afa99',
  'imageId': 'sha256:8ae738b860228534707b17eccf40c57163bd5e08c9aee0aa9cea2a2bd9c9fd6a',
  'running': True,
  'configurationSha256': 'a86853d46df1637ddbc1d14bb459fea19bda31379bf882289ee2c1347f2ca781'},
 {'id': 'bf233b651cc4c84afae4b59c2f17279ea2db7475bfeef6158ca012315a7f1c23',
  'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009',
  'running': False,
  'configurationSha256': 'f8ab9b4bfaba10f06fde31fdf9278097e627d43a28b70a1bcfe014515b1b6a4d'},
 {'id': '21a7093914645595d2cfcfc26335f8e8dbf155f6906840bbfb72855ed587e1e3',
  'imageId': 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009',
  'running': False,
  'configurationSha256': '051f99041aaf6a118d60005df8541cfc38c04c327fa0bce517f575c6387278af'},
 {'id': '2c180485762c286c7e73f983cd0c93a718d9dec5c2f8e442e7ee44c1a51f6729',
  'imageId': 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba',
  'running': False,
  'configurationSha256': '4eeabbd42092a3fa0c1c19110922f15302ec1b202d4b28a569bf301431bfe56d'},
 {'id': '21d2c808c25bad327a6d8ac13891d878aeb67fadce52350dcc6f1433e3f6ca78',
  'imageId': 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd',
  'running': False,
  'configurationSha256': 'ab660c0ddc1ab44a4517f88e0599c1dc6a3863d933a252d5f4cf87876af43092'}]
OBSERVED_IMAGE_IDS = {'sha256:43a330f7267704fed1f1a9827e309bca4f704b8b3b607daed2c516305a627f57',
 'sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd',
 'sha256:63429295e578122a4e3c36a5b9e9f7660db8f86d008e0cbad6500718e1b270e2',
 'sha256:68a54583a3329969e0911674a5ece21b2277660465a47a6a4460d7f037b3d6de',
 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73',
 'sha256:7294634293906ae2bb95dd42625111894ef4a736115245a9c1097fbe59c213ba',
 'sha256:8ae738b860228534707b17eccf40c57163bd5e08c9aee0aa9cea2a2bd9c9fd6a',
 'sha256:8f385c14a1c0015575f5c33fa2865efa4495d7bd70d64974cde852c262297505',
 'sha256:93ed4336bd73431ab98e261c078dd3d62d5e5a802940eefa2e055eb7fad55aac',
 'sha256:9c0fd19a6c1ce9ddea76fd214fbc2438577addf7c143d83e712450682b73fa91',
 'sha256:9cdc2f0c2eac3b8cbee6c623fe8a02932cf995976afb27e9f7bffc5612e552c6',
 'sha256:9f420c21046ca02f2cf4105eacc4478f344f782f58bac45c7aba92f968dcc618',
 'sha256:e36c969dc5a21a1654d738a2fe76c4657cd75ad48ffeff4c87845f67035c6f6f',
 'sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009',
 'sha256:fb1678ee498af616d06869da66c94dad41331c49c859294343d3b28e576d6d6b'}
PROTECTED_HISTORY = {'077cbb17626ab0c64e7f06db055fef9252ad21c0': {'attemptHash': 'b12a972f27f0675b',
                                              'imageId': 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73',
                                              'proofSha256': {'PLAN.json': '531e2a63b575fad65d6c5e001c30f402568f2edca5108bf363701e280cbd49b4',
                                                              'ACCEPTED.json': 'fd0520652f8262110349d912c79c16f0ed09accfee724b2d0594c49095da6529'}},
 '36c7ea726e7f070d10dbc65afc6538f13c0c1a24': {'attemptHash': 'd568f2e24271cb73',
                                              'imageId': 'sha256:8ae738b860228534707b17eccf40c57163bd5e08c9aee0aa9cea2a2bd9c9fd6a',
                                              'proofSha256': {'PLAN.json': 'dc417eb79f5590df220b4fd9b2c8aab45e0a3d893f65d4c5eda8de2ea84e3114',
                                                              'ACCEPTED.json': 'ebef946f0e4cb0650be8931a86cc045958004c93a89af1e26bbaf42837a600d3'}}}
EXPECTED_PLAN_SHA256 = '511f65ecb1230755d9a3bd15d000dbb2b5b3cc1cd2f23d6e0ad31eb5588440db'
FORBIDDEN_RUNTIMES = {CURRENT, ROLLBACK, 'd536c1547c4d82a339ed68ced7d8503f09b6810b',
                      '56d6b94fea70457e0ce2b0820596da9972846b90'}

def need(value, code):
    if not value:
        raise RuntimeError('unused_images_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprint(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def plan_definition():
    return {'inventoryRunId': INVENTORY_RUN_ID, 'inventoryReportSha256': INVENTORY_REPORT_SHA256,
            'current': CURRENT, 'rollback': ROLLBACK, 'generationId': GENERATION,
            'generationManifestSha256': MANIFEST, 'latestCandidateImageId': LATEST_CANDIDATE_IMAGE_ID,
            'targets': TARGETS, 'containers': CONTAINER_PINS,
            'observedImageIds': sorted(OBSERVED_IMAGE_IDS), 'protectedHistory': PROTECTED_HISTORY}


def plan_sha256():
    return fingerprint(plan_definition())


def validate_targets():
    need(INVENTORY_RUN_ID == 45868066632
         and INVENTORY_REPORT_SHA256 == '2aef3452af91cc8a7ead189a4d00d66bc3083ccb2ef9f3e0be87d2bd0fe0fe78'
         and plan_sha256() == EXPECTED_PLAN_SHA256, 'inventory_plan')
    need(len(TARGETS) == 8 and len({r['id'] for r in TARGETS}) == 8, 'target_count')
    for row in TARGETS:
        need(set(row) == {'id', 'runtimeSha', 'created', 'sizeBytes', 'tags', 'digestCount', 'digests',
                          'attemptHash', 'proofSha256', 'retainedRuntimeSha', 'retainedImageId'}
             and re.fullmatch(r'sha256:[a-f0-9]{64}', row['id'])
             and re.fullmatch(r'[a-f0-9]{40}', row['runtimeSha'])
             and row['runtimeSha'] not in FORBIDDEN_RUNTIMES
             and type(row['sizeBytes']) is int and row['sizeBytes'] > 0
             and isinstance(row['tags'], list) and len(row['tags']) == 1
             and row['digestCount'] == 1 and row['digests'] == ['avtocena-china-runtime@' + row['id']]
             and all(re.fullmatch(r'avtocena-china-runtime:' + row['runtimeSha'] + r'-[a-f0-9]{12}', tag)
                     for tag in row['tags'])
             and re.fullmatch(r'[a-f0-9]{16}', row['attemptHash'])
             and set(row['proofSha256']) == {'PLAN.json', 'ROLLED_BACK.json', 'FAILED_CODE_CLEANUP.json'}
             and all(re.fullmatch(r'[a-f0-9]{64}', digest) for digest in row['proofSha256'].values())
             and re.fullmatch(r'[a-f0-9]{40}', row['retainedRuntimeSha'])
             and re.fullmatch(r'sha256:[a-f0-9]{64}', row['retainedImageId']), 'target_identity')
    need(len(CONTAINER_PINS) == 6 and len({row['id'] for row in CONTAINER_PINS}) == 6
         and all(re.fullmatch(r'[a-f0-9]{64}', row['id'])
                 and re.fullmatch(r'[a-f0-9]{64}', row['configurationSha256']) for row in CONTAINER_PINS)
         and len(OBSERVED_IMAGE_IDS) == 15
         and {r['id'] for r in TARGETS}.issubset(OBSERVED_IMAGE_IDS)
         and not {r['id'] for r in TARGETS}.intersection(row['imageId'] for row in CONTAINER_PINS)
         and set(PROTECTED_HISTORY) == {CURRENT, ROLLBACK}, 'inventory_identity')


def inventory_container_fingerprint(row):
    # Identical projection to the immutable read-only inventory; no private fields are emitted.
    selected = {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts', 'RestartCount')}
    selected['Mounts'] = sorted(row.get('Mounts') or [], key=lambda value: json.dumps(value, sort_keys=True, separators=(',', ':')))
    selected['state'] = {key: row.get('State', {}).get(key) for key in
                         ('Running', 'Pid', 'StartedAt', 'FinishedAt', 'Paused', 'Restarting', 'Dead')}
    return fingerprint(selected)


def image_fingerprint(row):
    keys = ('Id', 'Created', 'Size', 'Config', 'RootFS', 'Architecture', 'Os', 'Parent', 'Descriptor')
    values = {key: row.get(key) for key in keys}
    values['RepoTags'] = sorted(row.get('RepoTags') or [])
    values['RepoDigests'] = sorted(row.get('RepoDigests') or [])
    return fingerprint(values)


def container_fingerprint(row, host):
    values = {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Created', 'RestartCount')}
    values['Mounts'] = host.canonical_mounts(row.get('Mounts', []))
    values['State'] = {key: row.get('State', {}).get(key) for key in
                       ('Status', 'Running', 'Paused', 'Restarting', 'Dead', 'Pid', 'ExitCode',
                        'OOMKilled', 'StartedAt', 'FinishedAt')}
    return fingerprint(values)


def referenced_images(value, depth=0):
    need(depth <= 24, 'reference_depth')
    result = set()
    if isinstance(value, dict):
        for encoded, hashed in (('hostReceiptBase64', 'hostReceiptSha256'),
                                ('hostRollbackBase64', 'hostRollbackSha256')):
            if encoded in value:
                need(isinstance(value[encoded], str) and len(value[encoded]) <= 350000
                     and re.fullmatch(r'[a-f0-9]{64}', value.get(hashed, '')), 'reference_proof')
                raw = base64.b64decode(value[encoded], validate=True)
                need(len(raw) <= 256 * 1024 and sha(raw) == value[hashed], 'reference_proof_hash')
                result.update(referenced_images(json.loads(raw), depth + 1))
        for key, child in value.items():
            if key in ('imageId', 'retainedImageId') and isinstance(child, str):
                need(re.fullmatch(r'sha256:[a-f0-9]{64}', child), 'reference_image')
                result.add(child)
            result.update(referenced_images(child, depth + 1))
    elif isinstance(value, list):
        for child in value:
            result.update(referenced_images(child, depth + 1))
    return result


def validate_image(row, expected, protected, policy):
    labels = row.get('Config', {}).get('Labels') or {}
    need(row.get('Id') == expected['id'] and row.get('Created') == expected['created']
         and row.get('Size') == expected['sizeBytes']
         and labels.get('org.opencontainers.image.revision') == expected['runtimeSha'], 'image_identity')
    need(labels.get('org.opencontainers.image.source') == 'https://github.com/jeep-jim/AvtoCena'
         and labels.get('avtocena.application') == 'web'
         and row.get('Os') == 'linux' and row.get('Architecture') == 'amd64', 'image_owner')
    need(row['Id'] not in protected and expected['runtimeSha'] not in FORBIDDEN_RUNTIMES
         and not policy.pinned_image(row), 'protected_image')
    tags, digests = row.get('RepoTags') or [], row.get('RepoDigests') or []
    need(sorted(tags) == sorted(expected['tags']) and len(digests) == expected['digestCount']
         and sorted(digests) == sorted(expected['digests']), 'image_tags')
    repositories = {tag.split(':', 1)[0] for tag in tags}
    need(all(isinstance(item, str) and re.fullmatch(r'avtocena-china-runtime@sha256:[a-f0-9]{64}', item)
             and item.split('@', 1)[0] in repositories for item in digests), 'image_digest_scope')


def read_message():
    raw = sys.stdin.buffer.readline(1024 * 1024 + 1)
    need(raw.endswith(b'\n') and len(raw) <= 1024 * 1024, 'input_bound')
    value = json.loads(raw)
    need(isinstance(value, dict), 'input_object')
    return value


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


class Cleanup:
    def __init__(self, host, policy, authority):
        validate_targets()
        self.h, self.policy, self.authority = host, policy, authority
        self.locks = []
        self.removed = []
        self.sequence = 0
        self.inflight = False
        self.steps = []
        self.check_authority(authority)
        # Same order as established application retention and preparation.
        for name in ('avtocena-staging-prepare', 'avtocena-runtime-change'):
            descriptor = os.open('/run/lock/' + name + '.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            self.locks.append(descriptor)
            info = os.fstat(descriptor)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'lock_identity')
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.prepare()

    def free(self):
        usage = os.statvfs(self.h.BASE)
        return usage.f_bavail * usage.f_frsize

    def check_authority(self, authority):
        need(isinstance(authority, dict) and set(authority) == {'publicationState', 'lease'}
             and authority == self.authority, 'authority_changed')
        state, intent = self.h.checked_publication_view(authority['publicationState'])
        need(state.get('pending') is None and state['current']['runtimeSha'] == CURRENT
             and state['current']['imageId'] == PROTECTED_HISTORY[CURRENT]['imageId']
             and state['current']['generationId'] == GENERATION
             and state['current']['generationManifestSha256'] == MANIFEST
             and state.get('rollback', {}).get('runtimeSha') == ROLLBACK
             and state['rollback']['imageId'] == PROTECTED_HISTORY[ROLLBACK]['imageId']
             and state['rollback']['generationId'] == GENERATION
             and state['rollback']['generationManifestSha256'] == MANIFEST
             and intent is not None and intent.get('status') == 'aborted'
             and intent.get('candidate', {}).get('imageId') == LATEST_CANDIDATE_IMAGE_ID
             and intent.get('resolution', {}).get('kind') == 'rolled_back', 'state')
        lease = self.h.checked_observation(authority['lease'])
        need(lease.get('kind') == 'china-market-lease-v1' and lease.get('market') == 'china'
             and lease.get('status') == 'held'
             and datetime.datetime.fromisoformat(lease['expiresAt'].replace('Z', '+00:00'))
                 > datetime.datetime.now(datetime.timezone.utc), 'lease')
        return state

    def containers(self):
        rows = self.h.docker('GET', '/containers/json?all=1')
        need(isinstance(rows, list) and len(rows) == len(CONTAINER_PINS), 'container_count')
        output = {}
        for item in rows:
            row = self.h.docker('GET', '/containers/' + item['Id'] + '/json')
            need(re.fullmatch(r'[a-f0-9]{64}', row.get('Id', '')) and row['Id'] not in output, 'container_id')
            output[row['Id']] = row
        for pin in CONTAINER_PINS:
            row = output.get(pin['id'])
            need(row is not None and row['Image'] == pin['imageId']
                 and row.get('State', {}).get('Running') is pin['running']
                 and inventory_container_fingerprint(row) == pin['configurationSha256'], 'container_pin')
        return output

    def images(self):
        rows = self.h.docker('GET', '/images/json?all=1')
        need(isinstance(rows, list) and len(rows) <= 150, 'image_bound')
        ids = {item['Id'] for item in rows}
        need(len(ids) == len(rows) and ids == OBSERVED_IMAGE_IDS - set(self.removed), 'image_set_changed')
        return {identifier: self.h.docker('GET', '/images/' + identifier + '/json') for identifier in sorted(ids)}

    def prepare(self):
        h = self.h
        state = self.check_authority(self.authority)
        self.protected = referenced_images(self.authority['publicationState'])
        self.proof_files = []
        self.failed_directories = []
        self.closed_proofs = {target['id']: self.verify_closed_target(target) for target in TARGETS}
        self.release_completed_candidate_reference(state)
        for reference in (state['current'], state.get('rollback')):
            if reference is None:
                continue
            receipt = h.verified_history(reference)
            directory, _ = h.reference_plan(reference, receipt)
            h.generation_reference(reference, receipt['nonce'])
            pin = PROTECTED_HISTORY[reference['runtimeSha']]
            need(reference['imageId'] == pin['imageId']
                 and sha(receipt['nonce'].encode())[:16] == pin['attemptHash'], 'protected_history_identity')
            for name, digest in pin['proofSha256'].items():
                filename = directory / name
                h.regular(filename, 256 * 1024)
                need(h.file_sha(filename) == digest, 'protected_history_proof')
                self.proof_files.append((filename, digest))
            if reference == state['current']:
                self.current, self.current_nonce = reference, receipt['nonce']
        self.live = h.verify_live_reference(self.current, self.current_nonce)
        self.ingress = h.CONFIG.read_bytes()
        self.original_containers = self.containers()
        self.container_fingerprints = {key: container_fingerprint(row, h) for key, row in self.original_containers.items()}
        self.protected.update(row['Image'] for row in self.original_containers.values())
        self.original_images = self.images()
        self.image_fingerprints = {key: image_fingerprint(row) for key, row in self.original_images.items()}
        for expected in TARGETS:
            validate_image(self.original_images[expected['id']], expected, self.protected, self.policy)
        self.before = self.free()
        self.fence()

    def verify_closed_target(self, target):
        runtime, image, expected = target['runtimeSha'], target['id'], target['proofSha256']
        home = self.h.BASE / runtime / 'china-next'
        self.h.private_directory(home)
        directories = list(home.iterdir())
        need(len(directories) <= 64, 'closed_candidate_bound')
        matches = [directory for directory in directories
                   if re.fullmatch(r'[a-f0-9]{32}', directory.name) and directory.is_dir()
                   and not directory.is_symlink() and sha(directory.name.encode())[:16] == target['attemptHash']]
        need(len(matches) == 1, 'closed_candidate_match')
        directory = matches[0]
        self.h.private_directory(directory)
        need(not (directory / 'ACCEPTED.json').exists() and not (directory / 'ACCEPTED.json').is_symlink(),
             'closed_candidate_accepted')
        values = {}
        for name, checksum in expected.items():
            value, raw = self.h.diagnosis_json(directory / name)
            need(sha(raw) == checksum, 'closed_candidate_proof')
            values[name] = value
            self.proof_files.append((directory / name, checksum))
        plan, rollback, cleanup = (values[name] for name in ('PLAN.json', 'ROLLED_BACK.json', 'FAILED_CODE_CLEANUP.json'))
        previous = plan.get('previousAcceptedState')
        need(plan.get('runtimeSha') == runtime and plan.get('imageId') == image
             and plan.get('generationId') == GENERATION and plan.get('generationManifestSha256') == MANIFEST
             and plan.get('nonce') == directory.name == rollback.get('nonce') == cleanup.get('nonce')
             and isinstance(previous, dict) and isinstance(previous.get('current'), dict)
             and plan.get('previousAcceptedStateSha256') == fingerprint(previous)
             and previous['current'].get('runtimeSha') == target['retainedRuntimeSha']
             and previous['current'].get('imageId') == target['retainedImageId'], 'closed_candidate_plan')
        need(rollback.get('kind') == 'china-host-rollback-v1' and rollback.get('release') == runtime
             and rollback.get('imageId') == image and rollback.get('retainedRuntimeSha') == target['retainedRuntimeSha']
             and rollback.get('retainedImageId') == target['retainedImageId']
             and rollback.get('previousAcceptedETag') == plan.get('previousAcceptedETag')
             and rollback.get('previousAcceptedStateSha256') == plan['previousAcceptedStateSha256']
             and all(rollback.get(key) is True for key in ('retainedRunning', 'candidateRemoved', 'ingressRestored')),
             'closed_candidate_rollback')
        need(cleanup.get('kind') == 'china-failed-code-bulk-cleanup-v1' and cleanup.get('runtimeSha') == runtime
             and cleanup.get('completed') is True and cleanup.get('protectedDeploymentsPreserved') is True
             and cleanup.get('imagesDeleted') == 0 and cleanup.get('directoriesDeleted') == 0
             and cleanup.get('planSha256') == expected['PLAN.json']
             and cleanup.get('rollbackSha256') == expected['ROLLED_BACK.json'], 'closed_candidate_cleanup')
        self.failed_directories.append(directory)
        return values

    def release_completed_candidate_reference(self, state):
        # Only the latest exact resolved b25 rollback can release an intent reference.
        # Older candidates remain protected if any current authority still references them.
        target = next(row for row in TARGETS if row['id'] == LATEST_CANDIDATE_IMAGE_ID)
        values = self.closed_proofs[target['id']]
        plan, rollback = values['PLAN.json'], values['ROLLED_BACK.json']
        intent = self.authority['publicationState']['intent'].get('value')
        previous = plan['previousAcceptedState']
        resolution = (intent or {}).get('resolution') or {}
        rollback_state = state == {**previous, 'revision': previous['revision'] + 2, 'pending': None}
        matching_intent = bool(intent and intent.get('candidate', {}).get('imageId') == target['id']
            and intent.get('candidate', {}).get('runtimeSha') == target['runtimeSha']
            and intent.get('status') == 'aborted' and intent.get('nonce') == plan['nonce']
            and intent.get('previous', {}).get('value') == previous
            and intent.get('previous', {}).get('etag') == plan['previousAcceptedETag']
            and intent.get('previous', {}).get('sha256') == plan['previousAcceptedStateSha256']
            and resolution.get('kind') == 'rolled_back'
            and resolution.get('rollbackProof', {}).get('hostRollbackSha256') == target['proofSha256']['ROLLED_BACK.json'])
        diagnostic = {'previousRevision': previous['revision'], 'currentRevision': state['revision'],
          'currentEqualsPrevious': state == previous, 'exactRolledBackState': rollback_state,
          'matchingResolvedRollbackIntent': matching_intent, 'imageReferencedByAuthority': target['id'] in self.protected,
          'currentValueSha256': fingerprint(state), 'previousValueSha256': fingerprint(previous)}
        if not (rollback_state and matching_intent):
            error = RuntimeError('unused_images_closed_candidate_state')
            error.safeDiagnostics = diagnostic
            raise error
        need(rollback.get('retainedRuntimeSha') == CURRENT
             and rollback.get('retainedImageId') == state['current']['imageId']
             and target['id'] not in referenced_images(state), 'closed_candidate_accepted')
        self.protected.discard(target['id'])
        self.closed_candidate_state_binding = {**diagnostic, 'mode': 'reserved_exact_rollback'}
        self.closed_candidate_proof = {'runtimeSha': target['runtimeSha'], 'imageId': target['id'],
                                       'proofSha256': target['proofSha256']}

    def fence(self):
        h = self.h
        self.check_authority(self.authority)
        need(h.CONFIG.read_bytes() == self.ingress, 'ingress_changed')
        rows = self.containers()
        need({key: container_fingerprint(row, h) for key, row in rows.items()} == self.container_fingerprints,
             'container_changed')
        images = self.images()
        expected = {key: value for key, value in self.image_fingerprints.items() if key not in self.removed}
        need({key: image_fingerprint(row) for key, row in images.items()} == expected, 'image_changed')
        for directory in self.failed_directories:
            need(not (directory / 'ACCEPTED.json').exists() and not (directory / 'ACCEPTED.json').is_symlink(),
                 'closed_candidate_accepted')
        for filename, digest in self.proof_files:
            h.regular(filename, 256 * 1024)
            need(h.file_sha(filename) == digest, 'accepted_proof_changed')
        return rows, images

    def prepared(self):
        return {'kind': 'unused-images-prepared-v1', 'targets': TARGETS, 'imagesPlanned': len(TARGETS),
                'containersPreserved': len(self.original_containers), 'diskFreeBytesBefore': self.before,
                'planSha256': plan_sha256(), 'inventoryReportSha256': INVENTORY_REPORT_SHA256, 'privateStateWrites': 0, 'closedCandidateProof': self.closed_candidate_proof, 'closedCandidateStateBinding': self.closed_candidate_state_binding}

    def step(self, message):
        need(set(message) == {'action', 'index', 'authority'} and message['action'] == 'remove'
             and type(message['index']) is int and message['index'] == self.sequence
             and self.sequence < len(TARGETS), 'sequence')
        self.check_authority(message['authority'])
        rows, images = self.fence()
        expected = TARGETS[self.sequence]
        protected = self.protected | referenced_images(self.check_authority(message['authority'])) | {row['Image'] for row in rows.values()}
        validate_image(images[expected['id']], expected, protected, self.policy)
        self.h.verify_live_reference(self.current, self.current_nonce)
        before = self.free()
        self.inflight = True
        result = self.h.docker('DELETE', '/images/' + expected['id'] + '?force=false&noprune=true')
        need(isinstance(result, list), 'delete_reply')
        self.removed.append(expected['id'])
        self.fence()
        self.h.verify_live_reference(self.current, self.current_nonce)
        after = self.free()
        self.inflight = False
        value = {'kind': 'unused-image-removed-v1', 'index': self.sequence, 'imageId': expected['id'],
                 'diskFreeBytesBefore': before, 'diskFreeBytesAfter': after, 'measuredFreeBytesChange': after - before}
        self.steps.append(value)
        self.sequence += 1
        return value

    def finish(self, message):
        need(set(message) == {'action', 'authority'} and message['action'] == 'finish'
             and self.sequence == len(TARGETS), 'finish')
        self.check_authority(message['authority'])
        self.fence()
        self.h.verify_live_reference(self.current, self.current_nonce)
        after = self.free()
        return {'kind': 'unused-images-result-v1', 'completed': True, 'imagesRemoved': self.removed,
                'diskFreeBytesBefore': self.before, 'diskFreeBytesAfter': after,
                'measuredFreeBytesChange': after - self.before, 'containersPreserved': len(self.original_containers),
                'containersDeleted': 0, 'filesDeleted': 0, 'volumesDeleted': 0,
                'acceptedStateWrites': 0, 'intentStateWrites': 0,
                'liveRuntimeSha': CURRENT, 'rollbackRuntimeSha': ROLLBACK, 'generationId': GENERATION, 'planSha256': plan_sha256(), 'inventoryReportSha256': INVENTORY_REPORT_SHA256}

    def close(self):
        for descriptor in reversed(self.locks):
            os.close(descriptor)
        self.locks = []


def module_from_source(name, raw, expected):
    need(isinstance(raw, str) and sha(raw.encode()) == expected, 'source')
    result = types.ModuleType(name)
    exec(compile(raw, name + '.py', 'exec'), result.__dict__)
    return result


def main():
    validate_targets()
    if sys.argv[1:] == ['--verify-targets']:
        emit({'imagesPlanned': len(TARGETS), 'planSha256': plan_sha256(), 'inventoryReportSha256': INVENTORY_REPORT_SHA256})
        return
    need(not sys.argv[1:], 'arguments')
    cleanup = None
    try:
        value = read_message()
        need(set(value) == {'hostSource', 'hostSourceSha256', 'policySource', 'policySourceSha256', 'authority'}, 'bootstrap')
        host = module_from_source('unused_images_verified_host', value['hostSource'], value['hostSourceSha256'])
        policy = module_from_source('unused_images_retention_policy', value['policySource'], value['policySourceSha256'])
        cleanup = Cleanup(host, policy, value['authority'])
        emit(cleanup.prepared())
        for _ in TARGETS:
            emit(cleanup.step(read_message()))
        emit(cleanup.finish(read_message()))
    except BaseException as error:
        code = str(error)
        emit({'errorCode': code if re.fullmatch(r'(?:unused_images|china_host)_[a-z0-9_]{1,140}', code)
              else 'unused_images_host_failed', 'uncertain': bool(cleanup and cleanup.inflight),
              'closedCandidateStateCheck': getattr(error, 'safeDiagnostics', None)})
        raise SystemExit(1)
    finally:
        if cleanup is not None:
            cleanup.close()


if __name__ == '__main__':
    main()

