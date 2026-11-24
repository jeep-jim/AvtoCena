import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {normalizeAutoApiChe168} from '../apps/web/lib/catalog/auto-api-che168.ts';
import {refreshChinaSource, openLocalRefreshedChinaSource} from '../scripts/catalog-next/refresh-china-source.mjs';
import {savePrivateChinaGeneration, restorePrivateChinaGeneration} from '../scripts/catalog-next/private-generation.mjs';
import {chinaGenerationRoot, CHINA_GENERATION_FILES} from '../scripts/catalog-next/generation-storage.mjs';
import {selectChinaPreparationSource, restoreChinaPreparationSource, prepareChinaGeneration}
  from '../scripts/catalog-next/prepare-generation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const collect = async input => { const values = []; for await (const value of input) values.push(value); return values; };
const initial = '2026-11-22T09:00:00.000Z';
const acceptedAt = '2026-11-24T09:00:00.000Z';
const freshAt = '2026-11-25T09:00:00.000Z';
const previousOwner = {runId: '12345', attempt: '1', revision: '1'.repeat(40)};
const nextOwner = {runId: '12346', attempt: '1', revision: '2'.repeat(40)};
const pricingRuntimeSha = '3'.repeat(40), servingRuntimeSha = '4'.repeat(40);
const firstSource = {owner: {runId: '45349439965', attempt: '1', revision: 'be1da8b4c7c54ccfb8285a96a4b8d702aec52741'},
  receiptSha256: 'ba1475890fdee71c5a4a16b3461e3f7e03ae62bda6d6a20fb3175d75eb494edb'};
const plan = () => ({version: 1, market: 'china', minimumYear: 2014, runtimeSha: pricingRuntimeSha,
  runtimeTree: '5'.repeat(40), runtimeDiffSha256: '6'.repeat(64), source: structuredClone(firstSource),
  encyclopedia: {bindingReleaseSha: '7'.repeat(40), expectedIndexDigest: '8'.repeat(64)}});
const page = (cursor, next, result = []) => ({meta: {cur_change_id: cursor, next_change_id: next}, result});
const raw = (id, year = 2020) => ({inner_id: String(id), data: {inner_id: String(id),
  url: `https://www.che168.com/dealer/5/${id}.html`, mark: 'Kia', model: 'K3', year: String(year),
  price: '100000', power: '120', engine_type: 'бензин'}});
const enabledControls = () => ({version: 1, revision: 17,
  markets: {china: {enabled: true}, japan: {enabled: 'irrelevant-invalid'}},
  sources: {che168_feed: {enabled: true}, aj_system: null}});

// This is exclusively a small in-memory acceptance fixture. Production proof
// is received from the authenticated release host and validated by china-state.
function withFixtureProof(reference) {
  const nonce = 'a'.repeat(32);
  const bytes = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1',
    release: reference.runtimeSha, pricingRuntimeSha: reference.pricingRuntimeSha,
    generationId: reference.generationId, generationManifestSha256: reference.generationManifestSha256,
    privateGenerationReceiptSha256: reference.receiptSha256, sourceDescriptorSha256: reference.sourceDescriptorSha256,
    imageId: reference.imageId, sourceCursor: reference.sourceCursor, sourceObservedAt: reference.sourceObservedAt,
    nonce, acceptedAt: '2026-11-25T10:00:00.000Z', retainedContainerId: 'b'.repeat(64),
    browser: {release: reference.runtimeSha, nonce, passed: true, functionalPassed: true, speedPassed: true,
      reportSha256: 'c'.repeat(64), speedReportSha256: 'd'.repeat(64), detailsReportSha256: 'e'.repeat(64)}}));
  return {...reference, proof: {kind: 'china-accepted-proof-v1', hostReceiptBase64: bytes.toString('base64'),
    hostReceiptSha256: hash(bytes)}};
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-preparation-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const originalRows = [raw(1), raw(2, 2010)].map(row => normalizeAutoApiChe168(row, initial));
  assert(originalRows.every(Boolean));
  const manifest = {version: 1, kind: 'china-saved-source-v1', market: 'china', sourceId: 'autohome_used_china_open',
    sourceObservedAt: initial, supplierLatestVerified: false, source: {cursor: 100, snapshotBinding: 'f'.repeat(64)}};
  const original = {complete: true, manifest, reconciliation: {sourceRows: originalRows.length, sourceReportedQuarantined: 0},
    receiptSha256: '9'.repeat(64), receipt: {sourceManifestSha256: digest(manifest)},
    async *offers(options) { assert.deepEqual(options, {eligibleOnly: false}); yield* structuredClone(originalRows); }};
  const priorSource = await refreshChinaSource({source: original, outputDirectory: path.join(directory, 'prior-source'),
    client: async (endpoint, params) => { assert.equal(endpoint, 'changes'); assert.equal(params.change_id, 100); return page(100, null); },
    checkControl: async () => true, now: () => acceptedAt});
  const objects = new Map(), calls = [];
  const storage = {
    async assertPrivateBucket() { calls.push({method: 'privacy'}); return {verified: true}; },
    async getBinary(key) { calls.push({method: 'get', key}); assert(objects.has(key), `missing fixture object ${key}`);
      const data = Buffer.from(objects.get(key)); return {data, size: data.length, checksum: hash(data)}; },
    async putBinary(key, value, _contentType, condition) {
      assert.deepEqual(condition, {ifNoneMatch: '*'}); assert(!objects.has(key));
      calls.push({method: 'put', key}); objects.set(key, Buffer.from(value));
    },
  };
  const artifacts = path.join(directory, 'prior-artifacts'); await fs.mkdir(artifacts);
  const files = {};
  for (const name of CHINA_GENERATION_FILES) {
    if (name === 'SOURCE.json') files[name] = priorSource.paths.descriptor;
    else if (name === 'source.sqlite') files[name] = priorSource.paths.database;
    else {
      files[name] = path.join(artifacts, name);
      await fs.writeFile(files[name], JSON.stringify({fixture: 'prior-generation-do-not-reuse', name}));
    }
  }
  const binding = {market: 'china', generationId: 'gen_china_12345_1', runtimeSha: pricingRuntimeSha,
    sourceDescriptorSha256: priorSource.descriptorSha256, generationManifestSha256: hash(await fs.readFile(files['GENERATION.json']))};
  const saved = await savePrivateChinaGeneration({storage, owner: previousOwner, files, binding});
  const reference = withFixtureProof({market: 'china', generationId: binding.generationId, owner: previousOwner,
    receiptSha256: saved.receiptSha256, sourceDescriptorSha256: priorSource.descriptorSha256,
    generationManifestSha256: binding.generationManifestSha256, sourceCursor: 100, sourceObservedAt: acceptedAt,
    runtimeSha: servingRuntimeSha, pricingRuntimeSha, imageId: 'sha256:' + '1'.repeat(64)});
  calls.length = 0;
  return {directory, originalRows, original, priorSource, objects, calls, storage, saved, reference,
    sourceSelection: {kind: 'accepted-generation', generation: reference}};
}

test('the unchanged first-run choice is exact; accepted inputs are explicit and require bound acceptance', async () => {
  const selected = selectChinaPreparationSource({plan: plan()});
  assert.deepEqual(selected, {kind: 'initial-saved-source', ...firstSource});
  assert(Object.isFrozen(selected.owner));
  for (const changed of [{owner: {...firstSource.owner, runId: '999'}}, {receiptSha256: 'a'.repeat(64)}])
    assert.throws(() => selectChinaPreparationSource({plan: {...plan(), source: {...firstSource, ...changed}}}), /source_plan/);
  for (const sourceSelection of [null, {}, {kind: 'initial-saved-source'}, {kind: 'accepted-generation', generation: {}},
    {kind: 'accepted-generation', generation: {}, allowUnaccepted: true}])
    assert.throws(() => selectChinaPreparationSource({plan: plan(), sourceSelection}), /china_prepare_|china_state_/);
});

test('accepted source restoration reads only the exact source pair, retains all years, and binds both runtime identities', async t => {
  const f = await fixture(t), outputDirectory = path.join(f.directory, 'restored');
  const result = await restoreChinaPreparationSource({plan: plan(), sourceSelection: f.sourceSelection, outputDirectory,
    storage: {assertPrivateBucket: f.storage.assertPrivateBucket, getBinary: f.storage.getBinary}});
  assert.equal(result.selection.generation.runtimeSha, servingRuntimeSha);
  assert.equal(result.selection.generation.pricingRuntimeSha, pricingRuntimeSha);
  assert.equal(result.source.receiptSha256, f.saved.receiptSha256);
  assert.notEqual(result.source.receiptSha256, f.original.receiptSha256);
  const rows = await collect(result.source.offers());
  assert.deepEqual(rows.map(row => row.year).sort(), [2010, 2020]);
  assert.equal((await collect(result.source.offers({eligibleOnly: true}))).length, 1);
  assert.deepEqual((await fs.readdir(outputDirectory)).sort(), ['SOURCE.json', 'source.sqlite']);
  const root = chinaGenerationRoot(previousOwner);
  assert(f.calls.every(call => call.method === 'privacy' || call.method === 'get' &&
    (call.key === root + '/complete.json' || /\/files\/(SOURCE\.json|source\.sqlite)\//.test(call.key))));
  assert.equal(f.calls.filter(call => call.method === 'put').length, 0);
  assert.equal((await fs.stat(result.source.paths.database)).mode & 0o777, 0o400);
});

test('a candidate without acceptance is refused before source storage is read', async t => {
  const f = await fixture(t), candidate = {...f.reference}; delete candidate.proof;
  await assert.rejects(restoreChinaPreparationSource({plan: plan(), storage: f.storage,
    sourceSelection: {kind: 'accepted-generation', generation: candidate}, outputDirectory: path.join(f.directory, 'unaccepted')}),
  /accepted_proof_required/);
  assert.equal(f.calls.length, 0);
});

test('a bound but mismatched accepted receipt, pricing runtime or cursor never leaves a reusable source', async t => {
  const f = await fixture(t);
  const changes = [{receiptSha256: 'a'.repeat(64)}, {pricingRuntimeSha: 'b'.repeat(40)},
    {sourceDescriptorSha256: 'c'.repeat(64)}, {generationManifestSha256: 'd'.repeat(64)},
    {sourceCursor: 101}, {sourceObservedAt: '2026-11-24T08:00:00.000Z'}];
  for (const [index, change] of changes.entries()) {
    const outputDirectory = path.join(f.directory, 'mismatch-' + index);
    const reference = withFixtureProof({...f.reference, ...change});
    await assert.rejects(restoreChinaPreparationSource({plan: plan(), storage: f.storage, outputDirectory,
      sourceSelection: {kind: 'accepted-generation', generation: reference}}), /receipt_checksum|accepted_source_binding|accepted_source_cursor/);
    await assert.rejects(fs.stat(outputDirectory), {code: 'ENOENT'});
  }
});

test('corrupted accepted source bytes are refused, with no fallback or modification of other private generation objects', async t => {
  const f = await fixture(t), part = f.saved.receipt.files.find(file => file.name === 'source.sqlite').parts[0];
  f.objects.set(part.key, Buffer.from('corrupt'));
  const before = new Map([...f.objects].map(([key, bytes]) => [key, hash(bytes)]));
  const outputDirectory = path.join(f.directory, 'corrupt');
  await assert.rejects(restoreChinaPreparationSource({plan: plan(), storage: f.storage,
    sourceSelection: f.sourceSelection, outputDirectory}), /part_checksum/);
  assert.deepEqual(new Map([...f.objects].map(([key, bytes]) => [key, hash(bytes)])), before);
  await assert.rejects(fs.stat(outputDirectory), {code: 'ENOENT'});
  assert.equal(f.calls.filter(call => call.method === 'put').length, 0);
});

async function orchestration(f, overrides = {}) {
  const expectedPlan = plan(), providerCalls = [], pricingCalls = [], contextCalls = [], storageOwners = [], progress = [];
  const runtimeChecks = [];
  const capabilities = {
    verifyRuntime(runtimeRoot, value) { assert.equal(runtimeRoot, f.directory); assert.deepEqual(value, expectedPlan);
      runtimeChecks.push(runtimeRoot); return {runtimeSha: value.runtimeSha, runtimeTree: value.runtimeTree,
        runtimeDiffSha256: value.runtimeDiffSha256}; },
    readCollectionControls: async () => enabledControls(),
    async captureRuntimeContext({runtimeRoot, runtimeSha, outputDirectory}) {
      assert.equal(runtimeRoot, f.directory); assert.equal(runtimeSha, pricingRuntimeSha); contextCalls.push(outputDirectory);
      const data = path.join(outputDirectory, 'data'); await fs.mkdir(data, {recursive: true});
      for (const name of ['markets/markets.json', 'fees/exchange-rates.json', 'catalog-editorial/current.json',
        'catalog/china-cny-prices/current.json']) {
        const filename = path.join(data, name); await fs.mkdir(path.dirname(filename), {recursive: true});
        await fs.writeFile(filename, JSON.stringify({fixture: 'fresh-context', name}));
      }
      const receipt = {runtimeSha, encyclopedia: {indexSha256: '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c'}};
      const receiptPath = path.join(outputDirectory, 'RUNTIME_CONTEXT.json');
      await fs.writeFile(receiptPath, JSON.stringify(receipt));
      return {receipt, receiptSha256: digest(receipt), paths: {directory: outputDirectory, data, receipt: receiptPath}};
    },
    async initialSourceStorage() { assert.fail('an accepted source must never restore the first snapshot'); },
    async generationStorage(owner) { storageOwners.push(structuredClone(owner)); return f.storage; },
    async createProviderClient() { return async (endpoint, params) => {
      assert.equal(endpoint, 'changes'); providerCalls.push({endpoint, ...params});
      if (params.change_id === 100) return page(100, 102, [
        {id: 100, inner_id: '1', change_type: 'changed', created_at: freshAt, data: {new_price: 110000}},
        {id: 101, inner_id: '3', change_type: 'added', created_at: freshAt, data: raw(3, 2024).data}]);
      assert.equal(params.change_id, 102); return page(102, null);
    }; },
    async preparePricing({runtimeRoot, context, source, outputDirectory, generationId}) {
      assert.equal(runtimeRoot, f.directory); assert.equal(context.receipt.runtimeSha, pricingRuntimeSha);
      const offers = await collect(source.offers({eligibleOnly: false}));
      assert.deepEqual(offers.map(row => row.sourceOfferId).sort(), ['1', '2', '3']);
      assert.equal(offers.find(row => row.sourceOfferId === '2').year, 2010);
      assert.equal(offers.find(row => row.sourceOfferId === '1').sourcePrice, 110000);
      assert(offers.every(row => row.totalRub === null));
      assert.equal(source.lineage.inputPrivateReceiptSha256, f.saved.receiptSha256);
      pricingCalls.push({source, generationId, outputDirectory});
      await fs.mkdir(outputDirectory);
      for (const name of ['DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'GENERATION.json',
        'RECONCILIATION.json', 'details.sqlite', 'query.sqlite'])
        await fs.writeFile(path.join(outputDirectory, name), JSON.stringify({fixture: 'fresh-pricing-output', name, generationId}));
      return {completed: true, runtimeSha: pricingRuntimeSha, generationId,
        sourceDescriptorSha256: source.descriptorSha256,
        generationManifestSha256: hash(await fs.readFile(path.join(outputDirectory, 'GENERATION.json')))};
    },
    now: () => freshAt,
    ...overrides,
  };
  return {providerCalls, pricingCalls, contextCalls, storageOwners, runtimeChecks, progress,
    args: {runtimeRoot: f.directory, runnerTemp: f.directory, plan: expectedPlan,
      invocation: {version: 1, sourceSha: nextOwner.revision}, owner: nextOwner,
      sourceSelection: f.sourceSelection, reportPath: path.join(f.directory, 'REPORT.json'), capabilities,
      onProgress: value => progress.push(structuredClone(value))}};
}

test('a later cycle refreshes the accepted cursor and rebuilds fresh context/prices before saving the complete next generation', async t => {
  const f = await fixture(t), run = await orchestration(f);
  let authorityChecks = 0;
  const oldObjects = new Map([...f.objects].map(([key, bytes]) => [key, hash(bytes)]));
  const report = await prepareChinaGeneration({...run.args, assertAuthority: async () => { authorityChecks++; }});
  assert.equal(report.completed, true); assert.equal(report.published, false);
  assert.equal(report.liveCatalogWrites, 0); assert.equal(report.encyclopediaWrites, 0); assert.equal(report.deletions, 0);
  assert.deepEqual(report.sourceInput.owner, previousOwner);
  assert.equal(report.sourceInput.receiptSha256, f.saved.receiptSha256);
  assert.equal(report.sourceInput.runtimeSha, servingRuntimeSha);
  assert.equal(report.sourceInput.pricingRuntimeSha, pricingRuntimeSha);
  assert.equal(report.source.sourceCursor, 102); assert.equal(report.source.sourceObservedAt, freshAt);
  assert.equal(report.source.reconciliation.sourceRows, 3); assert.equal(report.source.reconciliation.yearBeforeMinimum, 1);
  assert.deepEqual(run.providerCalls, [{endpoint: 'changes', change_id: 100}, {endpoint: 'changes', change_id: 102}]);
  assert.equal(run.contextCalls.length, 1); assert.equal(run.pricingCalls.length, 1);
  assert.equal(run.runtimeChecks.length, 2); assert(authorityChecks > 5);
  assert.deepEqual(run.storageOwners, [previousOwner, nextOwner]);
  assert.deepEqual(JSON.parse(await fs.readFile(run.args.reportPath)), report);
  const nextRoot = chinaGenerationRoot(nextOwner), priorRoot = chinaGenerationRoot(previousOwner);
  assert(f.calls.filter(call => call.method === 'put').every(call => call.key.startsWith(nextRoot + '/')));
  assert.equal(f.calls.filter(call => call.method === 'put').at(-1).key, nextRoot + '/complete.json');
  for (const [key, before] of oldObjects) assert.equal(hash(f.objects.get(key)), before, key);
  assert(f.calls.filter(call => call.method === 'get' && call.key.startsWith(priorRoot + '/')).every(call =>
    call.key === priorRoot + '/complete.json' || /\/files\/(SOURCE\.json|source\.sqlite)\//.test(call.key)));
  const restored = await restorePrivateChinaGeneration({storage: f.storage, owner: nextOwner,
    expectedReceiptSha256: report.privateGeneration.receiptSha256,
    outputDirectory: path.join(f.directory, 'next-source'), names: ['SOURCE.json', 'source.sqlite']});
  const nextSource = await openLocalRefreshedChinaSource({descriptorPath: restored.paths['SOURCE.json'],
    expectedSha256: report.privateGeneration.sourceDescriptorSha256});
  assert.equal((await collect(nextSource.offers())).length, 3);
  assert.equal(nextSource.manifest.source.cursor, 102);
  assert.equal(nextSource.lineage.inputPrivateReceiptSha256, f.saved.receiptSha256);
  assert.equal(restored.receipt.files.length, CHINA_GENERATION_FILES.length);
  await assert.rejects(fs.stat(path.join(path.dirname(run.contextCalls[0]), 'saved-source')), {code: 'ENOENT'});
});

test('a disabled China source stops before context capture, private restoration, or supplier access', async t => {
  const f = await fixture(t), run = await orchestration(f, {readCollectionControls: async () => {
    const controls = enabledControls(); controls.sources.che168_feed.enabled = false; return controls;
  }});
  await assert.rejects(prepareChinaGeneration(run.args), /control_disabled/);
  assert.equal(run.contextCalls.length, 0); assert.equal(run.storageOwners.length, 0);
  assert.equal(run.providerCalls.length, 0); assert.equal(run.pricingCalls.length, 0);
  assert.equal(f.calls.length, 0);
  const report = JSON.parse(await fs.readFile(run.args.reportPath));
  assert.equal(report.completed, false); assert.equal(report.published, false);
});

test('loss of the caller authority before upload cannot publish a completed private generation', async t => {
  const f = await fixture(t), run = await orchestration(f);
  await assert.rejects(prepareChinaGeneration({...run.args, assertAuthority: async () => {
    if (run.pricingCalls.length) throw Error('china_state_lease_lost');
  }}), /china_state_lease_lost/);
  assert.equal(run.pricingCalls.length, 1);
  assert.equal(f.calls.filter(call => call.method === 'put').length, 0);
  assert(!f.objects.has(chinaGenerationRoot(nextOwner) + '/complete.json'));
  const report = JSON.parse(await fs.readFile(run.args.reportPath));
  assert.equal(report.completed, false); assert.equal(report.published, false);
  assert.equal(report.errorCode, 'china_state_lease_lost');
});
