import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as production from '../scripts/catalog-next/cleanup-unused-images-20261127.mjs';
import {inspectChinaPublicationState} from '../scripts/catalog-next/china-state.mjs';

const current = '077cbb17626ab0c64e7f06db055fef9252ad21c0';
const rollback = '36c7ea726e7f070d10dbc65afc6538f13c0c1a24';
const failed = 'b25a95122199378afc5166ed7ac8882a84ed9fe3';
const currentImage = 'sha256:6d64802f85263a3a1806aec8e469a459874e5b7737142f484a70d0e9f6c96f73';
const rollbackImage = 'sha256:8ae738b860228534707b17eccf40c57163bd5e08c9aee0aa9cea2a2bd9c9fd6a';
const failedImage = 'sha256:43a330f7267704fed1f1a9827e309bca4f704b8b3b607daed2c516305a627f57';
const generation = 'gen_china_45655051136_1';
const manifest = '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d';
const planSha = '511f65ecb1230755d9a3bd15d000dbb2b5b3cc1cd2f23d6e0ad31eb5588440db';
const inventorySha = '2aef3452af91cc8a7ead189a4d00d66bc3083ccb2ef9f3e0be87d2bd0fe0fe78';
const realRollbackSha = '16f40753b869c22ce0563e7e7353e57cc044a50e26f4c4333ac0acfab2965e7f';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const digest = value => hash(JSON.stringify(ordered(value)));
const observe = (value, etag) => ({found: true, etag, sha256: digest(value), value});
const common = {market: 'china', generationId: generation, owner: {runId: '45655051136', attempt: '1', revision: '1'.repeat(40)},
  receiptSha256: '2'.repeat(64), sourceDescriptorSha256: '3'.repeat(64), generationManifestSha256: manifest,
  sourceCursor: 1, sourceObservedAt: '2026-11-25T12:00:00.000Z', pricingRuntimeSha: '4'.repeat(40)};

function acceptedReference(runtimeSha, imageId, nonce, previous) {
  const reference = {...structuredClone(common), runtimeSha, imageId};
  const receipt = {version: 1, kind: 'china-host-acceptance-v1', release: runtimeSha,
    pricingRuntimeSha: reference.pricingRuntimeSha, generationId: generation, generationManifestSha256: manifest,
    privateGenerationReceiptSha256: reference.receiptSha256, sourceDescriptorSha256: reference.sourceDescriptorSha256,
    sourceCursor: reference.sourceCursor, sourceObservedAt: reference.sourceObservedAt, imageId,
    nonce, acceptedAt: '2026-11-26T10:00:00.000Z', retainedContainerId: '5'.repeat(64),
    browser: {release: runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
      reportSha256: '6'.repeat(64), speedReportSha256: '7'.repeat(64), detailsReportSha256: '8'.repeat(64)}};
  if (previous) Object.assign(receipt, {transition: 'code-update', previousAcceptedETag: '"previous"',
    previousAcceptedStateSha256: '9'.repeat(64), retainedRuntimeSha: previous.runtimeSha, retainedImageId: previous.imageId});
  const bytes = Buffer.from(JSON.stringify(receipt));
  return {...reference, proof: {kind: 'china-accepted-proof-v1', hostReceiptBase64: bytes.toString('base64'), hostReceiptSha256: hash(bytes)}};
}

function fixture() {
  const retained = acceptedReference(rollback, rollbackImage, 'a'.repeat(32));
  const live = acceptedReference(current, currentImage, 'b'.repeat(32), retained);
  const previous = observe({version: 1, kind: 'china-accepted-state-v1', market: 'china', revision: 10,
    current: live, rollback: retained, pending: null,
    commit: {nonce: 'b'.repeat(32), intentSha256: 'a'.repeat(64), previousETag: '"previous"',
      previousStateSha256: '9'.repeat(64), acceptedAt: '2026-11-26T10:00:00.000Z'}}, '"before"');
  const accepted = observe({...structuredClone(previous.value), revision: 12}, '"after"');
  const candidate = {...structuredClone(common), runtimeSha: failed, imageId: failedImage};
  const rawRollback = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-rollback-v1', nonce: 'c'.repeat(32),
    release: failed, pricingRuntimeSha: candidate.pricingRuntimeSha, generationId: generation,
    generationManifestSha256: manifest, privateGenerationReceiptSha256: candidate.receiptSha256,
    sourceDescriptorSha256: candidate.sourceDescriptorSha256, imageId: failedImage,
    previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256,
    rolledBackAt: '2026-11-26T17:08:00.000Z', retainedContainerId: '5'.repeat(64),
    retainedRuntimeSha: current, retainedImageId: currentImage, retainedRunning: true, ingressRestored: true, candidateRemoved: true}));
  const intent = observe({version: 1, kind: 'china-publication-intent-v1', market: 'china', revision: 1,
    nonce: 'c'.repeat(32), owner: {runId: '45861459029', attempt: '1', revision: '1'.repeat(40)},
    createdAt: '2026-11-26T17:00:00.000Z', candidate, previous, transition: 'code-update', status: 'aborted',
    resolution: {kind: 'rolled_back', at: '2026-11-26T17:09:00.000Z', acceptedETag: accepted.etag,
      acceptedSha256: accepted.sha256, hostReceiptSha256: null,
      rollbackProof: {kind: 'china-rollback-proof-v1', hostRollbackBase64: rawRollback.toString('base64'), hostRollbackSha256: hash(rawRollback)}}}, '"intent"');
  return {view: {accepted, intent}, rollbackSha: hash(rawRollback)};
}

// The private host proof is intentionally unavailable to tests. Remap only its
// literal hash in memory; all real shared state and cleanup validators execute.
const sourceUrl = new URL('../scripts/catalog-next/cleanup-unused-images-20261127.mjs', import.meta.url);
const source = await fs.readFile(sourceUrl, 'utf8');
assert.equal(source.split(realRollbackSha).length, 2);
const fixtureSource = source.replace(realRollbackSha, fixture().rollbackSha)
  .replace(/from '(\.[^']+)'/g, (_match, relative) => `from '${new URL(relative, sourceUrl).href}'`)
  .replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
const controller = await import('data:text/javascript;base64,' + Buffer.from(fixtureSource).toString('base64'));

test('exact resolved b25 state passes only with its pinned proof; a valid fabricated proof cannot authorize production', () => {
  const {view} = fixture();
  assert.equal(inspectChinaPublicationState(view).status, 'resolved');
  controller.verifyUnusedImagesState(view);
  assert.throws(() => production.verifyUnusedImagesState(view), /unused_images_state/);
});

test('idle, pending, conflicting and a changed retained reference are refused', () => {
  for (const scenario of ['idle', 'pending', 'conflict', 'current', 'rollback', 'candidate', 'proof']) {
    const {view} = fixture();
    if (scenario === 'idle') view.intent = {found: false, etag: null, sha256: null, value: null};
    else if (scenario === 'pending') {
      view.intent.value.status = 'pending'; view.intent.value.resolution = null;
      view.intent.sha256 = digest(view.intent.value);
    } else if (scenario === 'conflict') view.accepted.etag = '"changed"';
    else if (scenario === 'current' || scenario === 'rollback') {
      view.accepted.value[scenario].runtimeSha = 'f'.repeat(40); view.accepted.sha256 = digest(view.accepted.value);
    } else if (scenario === 'candidate') {
      view.intent.value.candidate.imageId = 'sha256:' + 'f'.repeat(64); view.intent.sha256 = digest(view.intent.value);
    } else {
      view.intent.value.resolution.rollbackProof.hostRollbackSha256 = 'f'.repeat(64); view.intent.sha256 = digest(view.intent.value);
    }
    assert.throws(() => controller.verifyUnusedImagesState(view), /unused_images_|china_state_/, scenario);
  }
});

test('the host plan emits exactly eight reviewed targets and both immutable provenance hashes without contacting a host', () => {
  const output = execFileSync('python3', [new URL('../scripts/catalog-next/cleanup-unused-images-20261127.py', import.meta.url).pathname,
    '--verify-targets'], {encoding: 'utf8', timeout: 10000});
  assert.deepEqual(JSON.parse(output), {imagesPlanned: 8, planSha256: planSha, inventoryReportSha256: inventorySha});
});

test('invocation rejects any other workflow or job before Git or host access', () => {
  const workflow = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-unused-images-cleanup-20261127.yml@refs/heads/main';
  assert.throws(() => production.verifyInvocation({GITHUB_WORKFLOW_REF: workflow, GITHUB_JOB: 'other'}), /unused_images_workflow/);
  assert.throws(() => production.verifyInvocation({GITHUB_WORKFLOW_REF: workflow.replace('20261127', '20261126'), GITHUB_JOB: 'cleanup'}), /unused_images_workflow/);
});

test('workflow uses only the new immutable marker and executes refusal checks before cleanup', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/catalog-next-unused-images-cleanup-20261127.yml', import.meta.url), 'utf8');
  assert.match(workflow, /paths: \[\.github\/market-runs\/catalog-next-unused-images-cleanup-20261127\.json\]/);
  assert(!/workflow_dispatch:|schedule:|inputs:/.test(workflow));
  assert.match(workflow, /group: catalog-next-china\n/);
  assert(workflow.indexOf('cleanup-unused-images-20261127.mjs --verify') < workflow.indexOf('cleanup-unused-images-20261127.mjs --run'));
  for (const file of ['catalog-next-unused-images-cleanup-20261127.test.py', 'catalog-next-unused-images-cleanup-20261127.test.mjs',
    'readonly-marker-invocation.test.mjs', 'release-speed-guard-contract.test.mjs']) assert(workflow.includes(file));
  assert.match(workflow, /if: always\(\)/);
  assert(source.includes("operation: 'prune-exact-unused-application-images'"));
  assert(source.includes('verifyFrozenSpeedBaselines(ROOT)'));
});
