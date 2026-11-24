import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {CHINA_GENERATION_FILES, chinaGenerationRoot} from '../../scripts/catalog-next/generation-storage.mjs';
import {savePrivateChinaGeneration, restorePrivateChinaGeneration} from '../../scripts/catalog-next/private-generation.mjs';
import {createChinaState} from '../../scripts/catalog-next/china-state.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const empty = () => ({found: false, etag: null, sha256: null, value: null});
const clock = '2026-11-25T12:00:00.000Z', sourceAt = '2026-11-24T09:00:00.000Z';
const pricingSha = '3'.repeat(40), servingSha = '4'.repeat(40), nonce = 'a'.repeat(32);
const owner = id => ({runId: String(id), attempt: '1', revision: '1'.repeat(40)});
function candidate(id) {
  return {market: 'china', generationId: `gen_china_${id}_1`, owner: owner(id), receiptSha256: hash('receipt' + id),
    sourceDescriptorSha256: hash('source' + id), generationManifestSha256: hash('generation' + id),
    sourceCursor: 100, sourceObservedAt: sourceAt, runtimeSha: servingSha, pricingRuntimeSha: pricingSha,
    imageId: 'sha256:' + '5'.repeat(64)};
}
function acceptance(reference) {
  const browserSpeedBytes = Buffer.from(JSON.stringify({release: servingSha, passed: true, browserPassed: true, speedGuard: {passed: true}}));
  const browserDetailsBytes = Buffer.from(JSON.stringify({version: 1, kind: 'china-browser-details-v1', release: servingSha,
    nonce, passed: true, generationManifestSha256: reference.generationManifestSha256,
    precedingSpeedReportSha256: hash(browserSpeedBytes)}));
  const raw = Buffer.from(JSON.stringify({version: 1, kind: 'china-host-acceptance-v1', release: servingSha, pricingRuntimeSha: pricingSha,
    generationId: reference.generationId, generationManifestSha256: reference.generationManifestSha256,
    privateGenerationReceiptSha256: reference.receiptSha256, sourceDescriptorSha256: reference.sourceDescriptorSha256,
    sourceCursor: reference.sourceCursor, sourceObservedAt: reference.sourceObservedAt, imageId: reference.imageId,
    nonce, acceptedAt: clock, retainedContainerId: '6'.repeat(64), browser: {release: servingSha, nonce,
      passed: true, functionalPassed: true, speedPassed: true, reportSha256: hash(Buffer.concat([browserSpeedBytes, browserDetailsBytes])),
      speedReportSha256: hash(browserSpeedBytes), detailsReportSha256: hash(browserDetailsBytes)}}));
  return {hostReceiptBase64: raw.toString('base64'), hostReceiptSha256: hash(raw), browserSpeedBytes, browserDetailsBytes};
}
function objectStore() {
  const objects = new Map(), calls = []; let sequence = 0;
  const storage = {
    objects, calls, beforeDelete: null, afterDelete: null, afterRetirement: null,
    async assertPrivateBucket() { calls.push({method: 'privacy'}); return {verified: true}; },
    async putBinary(key, bytes, _type, condition) {
      assert.deepEqual(condition, {ifNoneMatch: '*'}); assert(!objects.has(key));
      objects.set(key, {data: Buffer.from(bytes), etag: '"opaque-' + ++sequence + '"'});
      calls.push({method: 'put', key});
    },
    async getBinary(key) { calls.push({method: 'get', key}); const value = objects.get(key);
      return value ? {found: true, data: Buffer.from(value.data), size: value.data.length, etag: value.etag} : {found: false}; },
    async headObject(key) { calls.push({method: 'head', key}); const value = objects.get(key);
      return value ? {found: true, size: value.data.length, etag: value.etag} : {found: false}; },
    async putRetirement(key, bytes, condition) {
      await storage.putBinary(key, bytes, 'application/json', condition); await storage.afterRetirement?.(key);
    },
    async deleteIfMatch(key, condition) {
      calls.push({method: 'delete', key, condition}); await storage.beforeDelete?.(key);
      const value = objects.get(key); assert(value && value.etag === condition.ifMatch, 'fixture_etag_conflict');
      objects.delete(key); await storage.afterDelete?.(key); return {settled: true, deleted: true};
    },
    replace(key, bytes) { const old = objects.get(key); assert(old);
      objects.set(key, {data: bytes ? Buffer.from(bytes) : old.data, etag: '"opaque-' + ++sequence + '"'}); },
  };
  return storage;
}
function stateStore() {
  const values = new Map(); let sequence = 0;
  return {
    async read(name) { return copy(values.get(name) ?? empty()); },
    async compareAndSwap(name, previous, value) {
      const actual = values.get(name) ?? empty(); assert.equal(actual.etag, previous.etag);
      values.set(name, {found: true, etag: '"state-' + ++sequence + '"',
        sha256: hash(JSON.stringify(ordered(value))), value: copy(value)});
    },
  };
}

async function fixture(t, {badPart = false, badGeneration = false, large = false} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-generation-gc-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const storage = objectStore(), files = {}, descriptors = {};
  for (const name of CHINA_GENERATION_FILES.filter(name => !['SOURCE.json', 'GENERATION.json'].includes(name))) {
    files[name] = path.join(directory, name);
    const bytes = large && name === 'source.sqlite' ? Buffer.alloc(17 * 1024 * 1024, 73) : Buffer.from('immutable fixture ' + name);
    await fs.writeFile(files[name], bytes); descriptors[name] = {name, bytes: bytes.length, sha256: hash(bytes)};
  }
  const sourceManifest = {version: 1, kind: 'china-refreshed-source-v1', market: 'china',
    sourceObservedAt: sourceAt, supplierLatestVerified: true, source: {cursor: 100}};
  const source = {version: 1, kind: 'china-refreshed-source-descriptor-v1', market: 'china',
    file: descriptors['source.sqlite'], manifest: sourceManifest};
  const generation = {version: 1, kind: 'china-local-generation-v1', market: 'china', generationId: 'gen_china_1001_1',
    runtimeSha: badGeneration ? 'f'.repeat(40) : pricingSha, prepared: true, published: false, activationAuthorized: false,
    source: {cursor: 100, sourceObservedAt: sourceAt, manifestSha256: hash(JSON.stringify(sourceManifest))},
    queryIndex: {binding: {generationId: 'gen_china_1001_1'}, file: descriptors['query.sqlite']},
    files: Object.fromEntries(Object.entries({details: 'details.sqlite', semantics: 'FILTER_SEMANTICS.json', fx: 'FX_RECEIPT.json',
      dispositions: 'DISPOSITIONS.ndjson', reconciliation: 'RECONCILIATION.json'}).map(([key, name]) => [key, descriptors[name]]))};
  files['SOURCE.json'] = path.join(directory, 'SOURCE.json'); files['GENERATION.json'] = path.join(directory, 'GENERATION.json');
  await fs.writeFile(files['SOURCE.json'], JSON.stringify(source)); await fs.writeFile(files['GENERATION.json'], JSON.stringify(generation));
  const reference = {...candidate(1001), sourceDescriptorSha256: hash(JSON.stringify(source)), generationManifestSha256: hash(JSON.stringify(generation))};
  const saved = await savePrivateChinaGeneration({storage, owner: reference.owner, files,
    binding: {market: 'china', generationId: reference.generationId, runtimeSha: pricingSha,
      sourceDescriptorSha256: reference.sourceDescriptorSha256, generationManifestSha256: reference.generationManifestSha256}});
  reference.receiptSha256 = saved.receiptSha256;
  const root = chinaGenerationRoot(reference.owner), completeKey = root + '/complete.json';
  if (badPart) {
    const receipt = copy(saved.receipt); receipt.files[0].parts[0].key = 'catalog/market-rebuild/v1/korea/runs/1001/1/generation/secret';
    const bytes = Buffer.from(JSON.stringify(receipt)); storage.replace(completeKey, bytes); reference.receiptSha256 = hash(bytes);
  }
  const state = createChinaState({storage: stateStore(), now: () => clock});
  const lease = await state.acquireLease({previous: empty(), owner: owner(9999), nonce, expiresAt: '2026-11-25T14:00:00.000Z'});
  const publish = async ref => state.commit({lease, ...await state.reserve({lease, previous: await state.read('accepted'),
    previousIntent: await state.read('intent'), candidate: ref}), evidence: acceptance(ref)});
  const first = await publish(reference), second = await publish(candidate(1002)), third = await publish(candidate(1003));
  const protectedKeys = [chinaGenerationRoot(owner(1002)) + '/complete.json', chinaGenerationRoot(owner(1003)) + '/complete.json',
    'catalog/manifest.json', 'knowledge/encyclopedia/calculation-v1.json', 'catalog/market-rebuild/v1/korea/accepted.json'];
  for (const key of protectedKeys) storage.objects.set(key, {data: Buffer.from('must remain ' + key), etag: '"protected"'});
  storage.calls.length = 0;
  let authority = true, viewOverride = null;
  const options = {previousAccepted: second.accepted, storage, now: () => clock,
    readState: async () => viewOverride ?? {accepted: await state.read('accepted'), intent: await state.read('intent')},
    assertAuthority: async () => { if (!authority) throw Error('china_daily_lease_lost'); }};
  return {directory, storage, saved, reference, root, completeKey, files, protectedKeys, first, second, third, state, lease, options,
    loseAuthority: () => { authority = false; }, restoreAuthority: () => { authority = true; },
    overrideState: value => { viewOverride = value; }};
}

export {hash, copy, ordered, empty, clock, sourceAt, pricingSha, servingSha, nonce, owner, candidate, acceptance, objectStore, stateStore, fixture};
