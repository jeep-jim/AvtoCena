import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {HOME_UI, HOME_RUNTIME, GATE_FILES, assertHomeSourceEvidence, verifyHomeGateFiles, homeServerGateInvocation, sha256}
  from '../.github/operations/home-ui-only-20261123/contract.mjs';
import {assertFullServerReceipt, assertHomeBrowserVerdict, assertReviewedInventory, acceptReviewedHomeUi}
  from '../.github/operations/home-ui-only-20261123/acceptance.mjs';
import {assertStagedCalculatorBuild} from '../scripts/lib/catalog-staged-budget.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceProof = () => ({version:1, clean:true, closureUnchanged:true,
  ...Object.fromEntries(['source','tree','retainedSource','retainedTree','sourceCalculationVersion',
    'servingCalculationVersion','codeDiffSha256','sourceClosureRecords','codePaths'].map(key => [key, structuredClone(HOME_UI[key])]))});
const nonce = 'a'.repeat(32), {routes} = verifyHomeGateFiles(root);
const serverReceipt = phase => ({release:HOME_UI.source, nonce, phase, exitCode:0, logSha256:'b'.repeat(64),
  baselineSha256:GATE_FILES['docs/operations/2026-11-11-accepted-speed-baseline.json'],
  summary:{performanceGate:'summary', marketScope:'', functionalPassed:true, acceptedBaselineEnforced:true,
    samples:51, routes:[...routes], acceptedBaselineRoutes:[...routes], performanceAccepted:false},
  phases:routes.flatMap(path => ['warm','after_ttl','after_directory_ttl'].map(performanceGate => ({path, performanceGate, functionalPassed:true}))),
});
const browserVerdict = () => ({schemaVersion:1, release:HOME_UI.source, nonce,
  passed:true, functionalPassed:true, speedPassed:true, reportSha256:'c'.repeat(64)});
function inventoryFixture() {
  const kinds = ['serving','chinaRollback','legacyRollback'];
  const containers = Object.fromEntries(kinds.map((kind, index) => [kind, {...HOME_RUNTIME[kind],
    id:HOME_RUNTIME[kind].id || String(index).repeat(64), pid:100 + index,
    startedAt:HOME_RUNTIME[kind].startedAt || '2026-11-23T03:00:00.000Z', restartCount:HOME_RUNTIME[kind].restartCount ?? 0,
    environmentCount:12, environmentSha256:'d'.repeat(64), hostConfigSha256:'e'.repeat(64), mountsSha256:'f'.repeat(64), containerConfigSha256:'0'.repeat(64)}]));
  return {version:1, status:'verified_inventory_requires_review', readOnly:true, observedAt:'2026-11-23T03:00:00.000Z',
    activationAuthorized:false, requiresReviewedRollbackPins:true, lockMode:'shared_nonblocking',
    nginxSha256:HOME_RUNTIME.nginxSha256, containers,
    rollbackPins:Object.fromEntries(kinds.slice(1).map(kind => [kind, containers[kind].id])),
    candidatePort:{port:3003, socketListening:false, dockerReservationVerified:false}, supplierRequests:0, mutations:0};
}

test('the bridge admits only the exact reviewed home tuple and source proof', () => {
  assertHomeSourceEvidence(sourceProof());
  assert.doesNotThrow(() => assertStagedCalculatorBuild(HOME_UI.source, HOME_UI.sourceCalculationVersion, HOME_UI.servingCalculationVersion));
  for (const [release, build, serving] of [
    ['f'.repeat(40), HOME_UI.sourceCalculationVersion, HOME_UI.servingCalculationVersion],
    [HOME_UI.source, 'f'.repeat(64), HOME_UI.servingCalculationVersion],
    [HOME_UI.source, HOME_UI.sourceCalculationVersion, 'f'.repeat(64)],
    [HOME_UI.source, HOME_UI.servingCalculationVersion, HOME_UI.servingCalculationVersion],
  ]) assert.throws(() => assertStagedCalculatorBuild(release, build, serving), /calculation_version_mismatch/);
  for (const change of [proof => proof.tree = 'f'.repeat(40), proof => proof.clean = false,
    proof => proof.closureUnchanged = false, proof => proof.codePaths.push('apps/web/lib/catalog/storage.ts'),
    proof => proof.sourceClosureRecords--]) {
    const proof = sourceProof(); change(proof); assert.throws(() => assertHomeSourceEvidence(proof), /home_ui_source/);
  }
});

test('server invocation pins both original baselines and all 17 routes, overriding inherited Korea-only scope', async () => {
  const command = homeServerGateInvocation(root, 'http://127.0.0.1:3003', {
    AVTOCENA_RELEASE_MARKETS:'korea', AVTOCENA_SPEED_BASELINE_MODE:'observe', KEEP:'same',
  });
  assert.equal(command.routes.length, 17); assert.ok(command.routes.includes('/'));
  assert.ok(command.routes.includes('/api/catalog/search?market=china&budgetTo=1500000&pageSize=6'));
  assert.equal(command.env.AVTOCENA_RELEASE_MARKETS, '');
  assert.equal(command.env.AVTOCENA_SPEED_BASELINE_MODE, 'enforce');
  assert.equal(command.env.KEEP, 'same'); assert.equal(command.args[2], HOME_UI.source);
  assert.throws(() => homeServerGateInvocation(root, 'https://avtocena.com'), /candidate_gate_address/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-gate-contract-'));
  try {
    for (const name of Object.keys(GATE_FILES)) {
      await fs.mkdir(path.dirname(path.join(directory, name)), {recursive:true});
      await fs.copyFile(path.join(root, name), path.join(directory, name));
    }
    assert.equal(verifyHomeGateFiles(directory).routes.length, 17);
    await fs.appendFile(path.join(directory, 'scripts/regcloud-performance-gate.py'), '\n# changed\n');
    assert.throws(() => verifyHomeGateFiles(directory), /gate_changed/);
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});

test('partial routes, missing expired phases, changed baselines and stale browser receipts cannot pass', () => {
  assertFullServerReceipt(serverReceipt('public'), routes, nonce, 'public');
  for (const change of [r => r.summary.routes.pop(), r => r.summary.marketScope = 'korea',
    r => r.summary.acceptedBaselineEnforced = false, r => r.baselineSha256 = 'd'.repeat(64),
    r => r.phases[0] = {...r.phases[1]}, r => r.phases.pop(), r => r.exitCode = 1,
    r => r.nonce = 'd'.repeat(32)]) {
    const receipt = serverReceipt('public'); change(receipt);
    assert.throws(() => assertFullServerReceipt(receipt, routes, nonce, 'public'), /home_ui_acceptance_server/);
  }
  assertHomeBrowserVerdict(browserVerdict(), nonce);
  for (const change of [v => v.nonce = 'd'.repeat(32), v => v.release = HOME_UI.retainedSource,
    v => v.speedPassed = false, v => v.functionalPassed = false, v => delete v.reportSha256]) {
    const verdict = browserVerdict(); change(verdict);
    assert.throws(() => assertHomeBrowserVerdict(verdict, nonce), /home_ui_acceptance_browser/);
  }
});

function actor(overrides = {}) {
  const calls = [], inventory = inventoryFixture();
  const context = {sourceProof:sourceProof(), inventory, reviewedInventorySha256:sha256(JSON.stringify(inventory)), nonce, controllerRoot:root};
  const methods = ['assertFreshInventory','assertNonceUnused','verifyPinnedBuildAndRequiredChecks','verifyExactPrivateBinding',
    'assertLeaseOwned','verifyCandidateIdentity','verifyPrivateCardPriceAndAuthParity','switchExactIngressCompareAndSwap',
    'verifyPublicCandidateIdentity','recordAcceptedRelease','restoreExactIngressCompareAndSwap','verifyRetainedPublicIdentity',
    'cleanupOnlyOwnedUnroutedCandidate','releaseOnlyOwnedPublicationLease'];
  const io = Object.fromEntries(methods.map(name => [name, async () => {calls.push(name); return overrides[name]?.();}]));
  io.withRuntimeChangeLock = async work => {calls.push('lock'); try {return await work();} finally {calls.push('unlock');}};
  io.acquirePublicationLease = async () => {calls.push('acquirePublicationLease'); if (overrides.acquirePublicationLease) return overrides.acquirePublicationLease(); return {owner:'home-ui-test'};};
  io.startExactInactiveCandidate = async () => {calls.push('startExactInactiveCandidate'); return {id:'synthetic-owned-candidate'};};
  io.runFullServerGate = async (_candidate, _nonce, phase) => {calls.push('server:' + phase); return overrides.runFullServerGate ? overrides.runFullServerGate(phase) : serverReceipt(phase);};
  io.waitForRequiredBrowserVerdict = async () => {calls.push('browser'); return overrides.waitForRequiredBrowserVerdict ? overrides.waitForRequiredBrowserVerdict() : browserVerdict();};
  return {io, context, calls};
}

test('a reviewed hash cannot turn failed inventory or mismatched rollback identities into a successful receipt', () => {
  const good = inventoryFixture(); assertReviewedInventory(good, sha256(JSON.stringify(good)));
  const failed = {version:1, status:'failed', errorCode:'inventory_lock_busy', readOnly:true, activationAuthorized:false};
  assert.throws(() => assertReviewedInventory(failed, sha256(JSON.stringify(failed))), /inventory_kind/);
  const resourceMismatch = {...good, status:'resource_state_mismatch_requires_review',
    errorCode:'inventory_serving_resources', servingResourceObservation:{historicalPinsMatch:false}};
  assert.throws(() => assertReviewedInventory(resourceMismatch, sha256(JSON.stringify(resourceMismatch))), /inventory_kind/);
  for (const change of [r => r.containers.serving.id = '9'.repeat(64), r => delete r.containers.legacyRollback,
    r => r.containers.serving.restartCount = 2, r => r.containers.serving.startedAt = '2026-11-23T04:30:00.000Z',
    r => r.rollbackPins.chinaRollback = '9'.repeat(64), r => r.nginxSha256 = '9'.repeat(64),
    r => r.candidatePort.socketListening = true, r => r.containers.serving.environmentSha256 = 'invalid']) {
    const receipt = inventoryFixture(); change(receipt);
    assert.throws(() => assertReviewedInventory(receipt, sha256(JSON.stringify(receipt))), /inventory_/);
  }
});

test('the reviewed restart observation is durable evidence, never an activation receipt', async () => {
  const evidence = JSON.parse(await fs.readFile(path.join(root, 'docs/audits/2026-11-23-home-runtime-before.json'), 'utf8'));
  assert.equal(evidence.sourceRun, 'https://github.com/jeep-jim/AvtoCena/actions/runs/45110094845');
  assert.equal(evidence.receipt.containers.serving.restartCount, HOME_RUNTIME.serving.restartCount);
  assert.equal(evidence.receipt.containers.serving.startedAt, HOME_RUNTIME.serving.startedAt);
  assert.deepEqual(evidence.receipt.servingResourceObservation.mismatchedFields, ['RestartCount']);
  assert.equal(evidence.receipt.activationAuthorized, false);
  assert.throws(() => assertReviewedInventory(evidence.receipt, sha256(JSON.stringify(evidence.receipt))), /inventory_kind/);
});

test('reviewable cutover keeps the lock and publication lease through both full server gates and the browser verdict', async () => {
  const {io, context, calls} = actor();
  assert.equal((await acceptReviewedHomeUi(io, context)).accepted, true);
  assert.ok(calls.indexOf('acquirePublicationLease') < calls.indexOf('startExactInactiveCandidate'));
  assert.ok(calls.indexOf('server:private') < calls.indexOf('switchExactIngressCompareAndSwap'));
  assert.ok(calls.indexOf('server:public') < calls.indexOf('browser'));
  assert.ok(calls.indexOf('browser') < calls.indexOf('recordAcceptedRelease'));
  assert.ok(calls.indexOf('recordAcceptedRelease') < calls.indexOf('releaseOnlyOwnedPublicationLease'));
  assert.equal(calls.at(-1), 'unlock'); assert.equal(calls.includes('restoreExactIngressCompareAndSwap'), false);
});

test('a busy publisher prevents candidate start; missing browser or an exception after ingress write rolls back', async () => {
  const busy = actor({acquirePublicationLease:() => {throw Error('publication_busy');}});
  await assert.rejects(acceptReviewedHomeUi(busy.io, busy.context), /publication_busy/);
  assert.equal(busy.calls.includes('startExactInactiveCandidate'), false);
  for (const overrides of [{waitForRequiredBrowserVerdict:() => null},
    {switchExactIngressCompareAndSwap:() => {throw Error('reload_failed_after_write');}}]) {
    const a = actor(overrides);
    await assert.rejects(acceptReviewedHomeUi(a.io, a.context), error => {
      assert.deepEqual(error.homeUiOutcome, {release:HOME_UI.source, accepted:false, ingressState:'retained', nonce}); return true;
    });
    assert.ok(a.calls.includes('restoreExactIngressCompareAndSwap'));
    assert.ok(a.calls.indexOf('verifyRetainedPublicIdentity') < a.calls.indexOf('cleanupOnlyOwnedUnroutedCandidate'));
    assert.equal(a.calls.includes('recordAcceptedRelease'), false);
    assert.ok(a.calls.includes('releaseOnlyOwnedPublicationLease'));
  }
});

test('foreign ingress prevents destructive cleanup, and lease-cleanup errors keep factual accepted state', async () => {
  const foreign = actor({waitForRequiredBrowserVerdict:() => null,
    restoreExactIngressCompareAndSwap:() => {throw Error('foreign_gateway');}});
  await assert.rejects(acceptReviewedHomeUi(foreign.io, foreign.context), error => {
    assert.equal(error.homeUiOutcome.ingressState, 'unknown'); return true;
  });
  assert.equal(foreign.calls.includes('cleanupOnlyOwnedUnroutedCandidate'), false);
  const cleanup = actor({releaseOnlyOwnedPublicationLease:() => {throw Error('lease_release_failed');}});
  await assert.rejects(acceptReviewedHomeUi(cleanup.io, cleanup.context), error => {
    assert.equal(error.homeUiOutcome.accepted, true); assert.equal(error.homeUiOutcome.ingressState, 'candidate'); return true;
  });
});

async function bindingFixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-binding-contract-'));
  try {
    // Only the private expected digest and source IO are substituted. The real
    // binding implementation is copied unchanged; no real private data or store
    // is used, and production code exposes no digest/source override.
    const models = {synthetic:[{powerHp:76}]}, digest = sha256(JSON.stringify(models));
    const fixtureContract = {...HOME_UI, privateIndexDigest:digest};
    const original = pathToFileURL(path.join(root, '.github/operations/home-ui-only-20261123/contract.mjs')).href;
    await fs.writeFile(path.join(directory, 'contract.mjs'), `export {sha256,assertHomeSourceEvidence} from ${JSON.stringify(original)};\nexport const HOME_UI=${JSON.stringify(fixtureContract)};\nexport function verifyHomeSourceCheckout(root){if(root!=='approved-source')throw Error('source_head');return ${JSON.stringify(sourceProof())};}\n`);
    await fs.copyFile(path.join(root, '.github/operations/home-ui-only-20261123/private-binding.mjs'), path.join(directory, 'private-binding.mjs'));
    const api = await import(pathToFileURL(path.join(directory, 'private-binding.mjs')).href);
    const key = 'knowledge/encyclopedia/calculation-indexes/' + digest + '.json';
    const sourceKey = 'knowledge/encyclopedia/calculation-releases/' + HOME_UI.privateIndexParent + '.json';
    const targetKey = 'knowledge/encyclopedia/calculation-releases/' + HOME_UI.source + '.json';
    const values = new Map([[sourceKey, {version:1, release:HOME_UI.privateIndexParent, digest, key}], [key, {version:1, digest, models}]]), writes = [], reads = [];
    const storage = {driver:'object', readJson:async (name, fallback) => {reads.push(name); return values.get(name) ?? fallback;},
      writeJson:async (name, value, options) => {writes.push({name, value, options}); if (values.has(name)) throw Error('conditional_conflict'); values.set(name, value);}};
    const options = {storage, sourceRoot:'approved-source', readLiveIdentity:async () => ({release:HOME_UI.retainedSource, calculationVersion:HOME_UI.servingCalculationVersion})};
    await run({api, options, values, writes, reads, targetKey, key, digest});
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
}

test('private binding preparation is read-only and applying its reviewed plan can create only the exact new immutable binding', async () => bindingFixture(async ({api, options, writes, values, targetKey}) => {
  const plan = await api.prepareHomeBindingPlan(options); assert.equal(writes.length, 0);
  const receipt = await api.applyReviewedHomeBinding({...options, reviewedPlanSha256:plan.planSha256});
  assert.equal(receipt.readbackVerified, true); assert.equal(writes.length, 1);
  assert.equal(writes[0].name, targetKey); assert.deepEqual(writes[0].options, {ifNoneMatch:'*'});
  assert.equal(values.get(targetKey).release, HOME_UI.source);
  assert.equal((await api.applyReviewedHomeBinding({...options, reviewedPlanSha256:plan.planSha256})).created, false);
  assert.equal(writes.length, 1);
}));

test('unknown source, changed private index, conflicting target, changed live identity and missing approval cannot write', async () => {
  for (const mode of ['source','index','target','live','approval']) await bindingFixture(async ({api, options, values, writes, targetKey, key}) => {
    const plan = await api.prepareHomeBindingPlan(options);
    if (mode === 'source') options.sourceRoot = 'unreviewed-source';
    if (mode === 'index') values.get(key).models.synthetic[0].powerHp = 77;
    if (mode === 'target') values.set(targetKey, {version:1, release:HOME_UI.source, digest:'d'.repeat(64), key});
    if (mode === 'live') options.readLiveIdentity = async () => ({release:'d'.repeat(40), calculationVersion:HOME_UI.servingCalculationVersion});
    await assert.rejects(api.applyReviewedHomeBinding({...options, reviewedPlanSha256:mode === 'approval' ? undefined : plan.planSha256}));
    assert.equal(writes.length, 0, mode);
  });
});
