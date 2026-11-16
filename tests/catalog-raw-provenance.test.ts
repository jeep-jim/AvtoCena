import assert from 'node:assert/strict';
import test from 'node:test';
import {RAW_PREFIXES, rawDigest, rawReferences, rawGenerationKey, intakeRawReferences,
  collectPaidReportReferences, buildRawGenerationProvenance, assertRawGenerationProvenance,
  stageRawGenerationProvenance, openRawFeedPin, readRawRootHandoff, writeRawRootHandoff, releaseRawHandoff} from '../scripts/lib/catalog-raw-provenance.mjs';
import {planRawFeedRetention} from '../scripts/lib/catalog-raw-retention-plan.mjs';
import {prepareRawPublication} from '../scripts/lib/catalog-raw-publication.mjs';
import {publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {saveChe168Replica} from '../scripts/lib/che168-replica.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const now = Date.parse('2026-11-16T12:00:00Z'), day = 86400000;
const sha = n => n.toString(16).padStart(64, '0');
const uuid = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const snapshotConfig = {version: 1, host: 'https://autobase-barrett.auto-api.com', date: '2026-11-01', filename: 'active_offer.csv',
  delimiter: '|', initialCursor: 100, bytes: 1024, etag: '"fixture"', modifiedAt: '2026-11-01T00:00:00Z'};
const binding = rawDigest(snapshotConfig);
const replicaRoot = n => RAW_PREFIXES['che168-replica'] + uuid(n + 1);
const journalRoot = n => RAW_PREFIXES['che168-journal'] + (100 + n);
const replicaReceipt = n => ({version: 1, binding, cursor: 100 + n, bytes: 1024, parts: [{bytes: 1024, sha256: sha(n + 1)}]});
const manifest = n => ({version: 2, generationId: `gen_${now - n * day}_abcdef${n}`,
  updatedAt: new Date(now - n * day).toISOString(), markets: {china: {count: 1, chunks: ['chunk-00001']}}});
const emptyPaid = value => ({generationId: value.generationId, manifestSha256: rawDigest(value), market: 'korea', count: 0, paidCount: 0, chunkProofs: [], observations: [], references: []});
const chinaIntake = n => ({market: 'china', completed: true, completedAt: new Date(now - n * day).toISOString(), sources: [{
  sourceId: 'autohome_new_china_open', provider: 'auto_api_che168', completeInventory: true, snapshotBinding: binding, cursor: 100 + n,
  replica: {key: replicaRoot(n), sha256: rawDigest(replicaReceipt(n)), binding, cursor: 100 + n},
  workingJournal: {key: journalRoot(n), binding: sha(n + 20)},
}]});
const provenance = n => buildRawGenerationProvenance({manifest: manifest(n), marketSources: {china: intakeRawReferences(chinaIntake(n))}, paidReports: emptyPaid(manifest(n))});

class MemoryStorage {
  driver = 'object'; values = new Map(); writes = []; revision = 0;
  set(key, value) { this.values.set(key, {value: structuredClone(value), etag: String(++this.revision)}); }
  async readJson(key, fallback) { return structuredClone(this.values.get(key)?.value ?? fallback); }
  async readJsonWithMeta(key, fallback) {
    const row = this.values.get(key);
    return row ? {found: true, value: structuredClone(row.value), etag: row.etag} : {found: false, value: fallback};
  }
  async writeJson(key, value, condition) {
    const old = this.values.get(key);
    if (condition?.ifNoneMatch === '*' && old || condition?.ifMatch && old?.etag !== condition.ifMatch) {
      const error = Error('conflict'); error.name = 'StorageConflictError'; throw error;
    }
    this.writes.push({key, condition: structuredClone(condition)}); this.set(key, value);
  }
}

test('intake metadata preserves China snapshot replica base and journal identities without provider payloads', () => {
  const intake = chinaIntake(0);
  intake.sources[0].baseReplica = {key: replicaRoot(2), sha256: rawDigest(replicaReceipt(2)), secret: 'excluded'};
  intake.sources[0].url = 'https://private.invalid';
  const result = intakeRawReferences(intake);
  assert.equal(result.complete, true);
  assert.deepEqual(result.references.map(row => row.root).sort(), [RAW_PREFIXES['che168-snapshot'] + binding, replicaRoot(0), replicaRoot(2), journalRoot(0)].sort());
  assert.ok(!JSON.stringify(result).includes('private.invalid'));
  assert.ok(!JSON.stringify(result).includes('excluded'));
  delete intake.sources[0].workingJournal;
  assert.equal(intakeRawReferences(intake).complete, false);
});

test('paid Encar producer run and attempt survive provenance instead of being lost in a cursor', () => {
  const intake = {market: 'korea', completed: true, completedAt: new Date(now).toISOString(), snapshotRun: '43800000000', snapshotAttempt: '2',
    sources: [{sourceId: 'encar_direct', provider: 'auto_api_encar'}]};
  const result = intakeRawReferences(intake);
  assert.equal(result.complete, true);
  assert.equal(result.producers[0].snapshotRun, '43800000000');
  assert.equal(result.producers[0].snapshotAttempt, '2');
  assert.equal(result.references[0].root, 'catalog/intake-staging/encar/43800000000/2');
  assert.throws(() => intakeRawReferences({...intake, snapshotAttempt: '../1'}), /raw_encar_snapshot/);
});

test('invalid roots and conflicting checksums cannot enter metadata or pins', () => {
  for (const root of ['crm/clients', 'catalog/provider-replicas/che168/../customer', replicaRoot(0) + '/manifest.json']) {
    assert.throws(() => rawReferences([{kind: 'che168-replica', root}]), /scope/);
  }
  assert.throws(() => rawReferences([{kind: 'che168-replica', root: replicaRoot(0), sha256: sha(1)},
    {kind: 'che168-replica', root: replicaRoot(0), sha256: sha(2)}]), /conflict/);
});

function paidFixture() {
  const storage = new MemoryStorage();
  const value = manifest(0);
  const borrowed = `catalog/generations/${manifest(3).generationId}/offers/korea/chunk-00002.json`;
  value.markets.korea = {provider: 'auto_api_encar', count: 2, chunks: ['chunk-00001', borrowed]};
  const keys = [`catalog/generations/${value.generationId}/offers/korea/chunk-00001.json`, borrowed];
  const roots = [];
  for (let n = 0; n < 2; n++) {
    const at = now - n * day, run = String(400 + n);
    const row = {id: 'offer-' + n, market: 'korea', sourceId: 'encar_direct', firstSeenAt: new Date(at).toISOString(),
      updatedAt: new Date(now).toISOString(), operational: {provider: 'auto_api_encar', lastSeenAt: new Date(at).toISOString()}};
    if (n) row.operational.paidEncarReportSnapshot = {run, attempt: '1', observedAt: new Date(at).toISOString()};
    storage.set(keys[n], [row]);
    const root = RAW_PREFIXES['encar-reports'] + at;
    roots.push(root);
    storage.set(root + '/complete.json', {version: 1, provider: 'auto_api_encar', observedAtMs: at,
      observedAt: new Date(at).toISOString(), sourceRunId: run, sourceRunAttempt: '1'});
  }
  return {storage, manifest: value, keys, roots};
}

test('all paid observation roots are protected across borrowed chunks and mixed freshness', async () => {
  const fixture = paidFixture(), result = await collectPaidReportReferences(fixture);
  assert.equal(result.count, 2); assert.equal(result.paidCount, 2);
  assert.deepEqual(result.references.filter(row => row.kind === 'encar-reports').map(row => row.root).sort(), [...fixture.roots].sort());
  assert.deepEqual(result.references.filter(row => row.kind === 'encar-snapshot').map(row => row.root).sort(),
    ['catalog/intake-staging/encar/400/1', 'catalog/intake-staging/encar/401/1']);
});

test('missing report complete, corrupt explicit snapshot or incomplete chunk coverage fail closed', async () => {
  for (const mode of ['missing_report', 'explicit_mismatch', 'missing_chunk', 'wrong_count']) {
    const fixture = paidFixture();
    if (mode === 'missing_report') fixture.storage.values.delete(fixture.roots[1] + '/complete.json');
    if (mode === 'explicit_mismatch') {
      const rows = await fixture.storage.readJson(fixture.keys[1], null); rows[0].operational.paidEncarReportSnapshot.run = '999'; fixture.storage.set(fixture.keys[1], rows);
    }
    if (mode === 'missing_chunk') fixture.storage.values.delete(fixture.keys[1]);
    if (mode === 'wrong_count') fixture.manifest.markets.korea.count = 3;
    await assert.rejects(collectPaidReportReferences(fixture), /raw_/);
  }
});

test('immutable generation provenance is idempotent and verified again before commit', async () => {
  const storage = new MemoryStorage(), value = manifest(0), sources = {china: intakeRawReferences(chinaIntake(0))};
  const options = {storage, manifest: value, marketSources: sources, paidReports: emptyPaid(value)};
  const verify = await stageRawGenerationProvenance(options);
  await stageRawGenerationProvenance(options);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(storage.writes[0].condition, {ifNoneMatch: '*'});
  assertRawGenerationProvenance(await storage.readJson(rawGenerationKey(value.generationId), null), value);
  storage.set(rawGenerationKey(value.generationId), {...provenance(0), complete: false});
  await assert.rejects(verify(), /immutable_provenance_changed/);
  await assert.rejects(stageRawGenerationProvenance(options), /immutable_provenance_changed/);
});

test('unknown historic provenance is recorded honestly and cannot authorize cleanup', () => {
  const value = buildRawGenerationProvenance({manifest: manifest(0), paidReports: emptyPaid(manifest(0))});
  assert.equal(value.complete, false);
  assert.deepEqual(value.markets.china.unknownSources, ['historic_provenance_missing']);
  assert.throws(() => assertRawGenerationProvenance(value, manifest(0)), /missing_or_unknown/);
  assert.throws(() => assertRawGenerationProvenance(provenance(0), manifest(1)), /missing_or_unknown/);
  const legacy = intakeRawReferences({market: 'china', completed: true, completedAt: new Date(now).toISOString(),
    sources: [{sourceId: 'autohome_new_china_open', provider: 'auto_api_che168', stopReason: 'source_finished'}]});
  assert.equal(legacy.complete, false);
  assert.deepEqual(legacy.unknownSources, ['autohome_new_china_open:legacy']);
});

test('producer identities derive required roots even if caller omits references; stored truncation is rejected', () => {
  const source = intakeRawReferences(chinaIntake(0)); source.references = [];
  const value = buildRawGenerationProvenance({manifest: manifest(0), marketSources: {china: source}, paidReports: emptyPaid(manifest(0))});
  assert.equal(assertRawGenerationProvenance(value, manifest(0)).length, 3);
  value.markets.china.references = [];
  assert.throws(() => assertRawGenerationProvenance(value, manifest(0)), /inconsistent/);
  source.producers = [{}];
  assert.throws(() => buildRawGenerationProvenance({manifest: manifest(0), marketSources: {china: source}, paidReports: emptyPaid(manifest(0))}), /raw_source_identity/);
});

test('paid proof derives roots from complete per-chunk observation coverage and rejects omitted observations', async () => {
  const fixture = paidFixture(), paidReports = await collectPaidReportReferences(fixture);
  paidReports.references = [];
  const value = buildRawGenerationProvenance({manifest: fixture.manifest, paidReports});
  assert.equal(value.markets.korea.references.filter(row => row.kind === 'encar-reports').length, 2);
  paidReports.observations.pop();
  assert.throws(() => buildRawGenerationProvenance({manifest: fixture.manifest, paidReports}), /observation_coverage/);
});

const owner = {runId: '43800000001', attempt: '1', revision: 'a'.repeat(40)};
const pinOptions = storage => ({storage, operationId: 'china-43800000001-1', owner, clock: () => now,
  references: [{kind: 'che168-replica', root: replicaRoot(0), sha256: rawDigest(replicaReceipt(0))}]});

test('loading pins append references with CAS and refuse another producer or conflicting resume', async () => {
  const storage = new MemoryStorage(), options = pinOptions(storage);
  const pin = await openRawFeedPin(options);
  await pin.add([{kind: 'che168-journal', root: journalRoot(0)}]);
  const saved = await storage.readJson(pin.key, null);
  assert.equal(saved.references.length, 2);
  assert.deepEqual(storage.writes.map(row => Object.keys(row.condition)), [['ifNoneMatch'], ['ifMatch']]);
  await assert.rejects(openRawFeedPin({...options, owner: {...owner, attempt: '2'}}), /not_owned/);
  await assert.rejects(openRawFeedPin({...options, references: [{...options.references[0], sha256: sha(999)}]}), /conflict/);
});

test('lost CAS ownership blocks pin writes, and terminal pins cannot resume loading', async () => {
  const storage = new MemoryStorage(), options = pinOptions(storage), pin = await openRawFeedPin(options);
  storage.set(pin.key, await storage.readJson(pin.key, null));
  await assert.rejects(pin.add([]), /ownership_lost/);
  const resumed = await openRawFeedPin(options);
  await resumed.abandoned('collection_failed');
  await assert.rejects(resumed.add([]), /already_terminal/);
  await assert.rejects(openRawFeedPin(options), /not_owned/);
});

test('a loading pin closes only after its exact references reach a published immutable generation', async () => {
  const storage = new MemoryStorage(), pin = await openRawFeedPin(pinOptions(storage));
  storage.set('catalog/manifest.json', manifest(0));
  storage.set(rawGenerationKey(manifest(0).generationId), provenance(0));
  await pin.published(manifest(0).generationId);
  const saved = await storage.readJson(pin.key, null);
  assert.equal(saved.state, 'published'); assert.equal(saved.generationId, manifest(0).generationId);
  const other = await openRawFeedPin({...pinOptions(storage), operationId: 'unreferenced-loading', references: [{kind: 'che168-replica', root: replicaRoot(9)}]});
  await assert.rejects(other.published(manifest(0).generationId), /refs_missing/);
  assert.equal((await storage.readJson(other.key, null)).state, 'loading');
  const mismatch = await openRawFeedPin({...pinOptions(storage), operationId: 'checksum-mismatch-loading',
    references: [{kind: 'che168-replica', root: replicaRoot(0), sha256: sha(999)}]});
  await assert.rejects(mismatch.published(manifest(0).generationId), /refs_missing/);
  assert.equal((await storage.readJson(mismatch.key, null)).state, 'loading');
});

test('ready handoff authorizes only the bound publication transition and mapping is immutable', async () => {
  const storage = new MemoryStorage(), pin = await openRawFeedPin(pinOptions(storage)), handoff = await pin.handoff();
  await assert.rejects(pin.add([]), /already_terminal/);
  await writeRawRootHandoff(storage, replicaRoot(0), replicaReceipt(0), handoff);
  assert.deepEqual(await readRawRootHandoff(storage, replicaRoot(0), replicaReceipt(0)), handoff);
  await assert.rejects(readRawRootHandoff(storage, replicaRoot(0), replicaReceipt(1)), /receipt_changed/);
  storage.set('catalog/manifest.json', manifest(0)); storage.set(rawGenerationKey(manifest(0).generationId), provenance(0));
  await releaseRawHandoff({storage, handoff, manifest: manifest(0), clock: () => now});
  await releaseRawHandoff({storage, handoff, manifest: manifest(0), clock: () => now});
  assert.equal((await storage.readJson(pin.key, null)).state, 'published');
  const wrong = await openRawFeedPin({...pinOptions(storage), operationId: 'wrong-checksum',
    references: [{kind: 'che168-replica', root: replicaRoot(0), sha256: sha(999)}]});
  await assert.rejects(releaseRawHandoff({storage, handoff: await wrong.handoff(), manifest: manifest(0), clock: () => now}), /refs_missing/);
  assert.equal((await storage.readJson(wrong.key, null)).state, 'ready');
});

test('publication stages raw proof before cutover and pin-release failure reports cleanup_pending without changing the catalogue', async () => {
  const storage = new MemoryStorage(), intake = chinaIntake(0);
  const pin = await openRawFeedPin({...pinOptions(storage), references: intakeRawReferences(intake).references});
  intake.rawStoragePins = [await pin.handoff()];
  storage.set('catalog/manifest.json', manifest(1)); storage.set(rawGenerationKey(manifest(1).generationId), provenance(1));
  const staged = await prepareRawPublication({storage, manifest: manifest(0), expectedBaseGenerationId: manifest(1).generationId, market: 'china', intake, clock: () => now});
  await staged.verify();
  assert.equal((await staged.releasePins()).status, 'cleanup_pending');
  assert.equal((await storage.readJson(pin.key, null)).state, 'ready');
  storage.set('catalog/manifest.json', manifest(0));
  await assert.rejects(staged.verify(), /base_changed/);
  const originalWrite = storage.writeJson.bind(storage);
  storage.writeJson = async (key, value, condition) => {
    if (key === pin.key) { const error = Error('race'); error.name = 'StorageConflictError'; throw error; }
    return originalWrite(key, value, condition);
  };
  assert.equal((await staged.releasePins()).status, 'cleanup_pending');
  assert.equal((await storage.readJson('catalog/manifest.json', null)).generationId, manifest(0).generationId);
  assert.equal((await storage.readJson(pin.key, null)).state, 'ready');
  storage.writeJson = originalWrite;
  assert.equal((await staged.releasePins()).status, 'pins_released');
});

test('replica cannot write a raw byte until its root pin callback succeeds', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'raw-replica-pin-'));
  const filename = path.join(directory, 'inventory.sqlite'); await fs.writeFile(filename, 'fixture');
  const writes = [], storage = {putBinary: async key => writes.push(key), writeJson: async key => writes.push(key)};
  try {
    await assert.rejects(saveChe168Replica({storage, filename, binding, cursor: 1, beforeWrite: async () => { throw Error('pin_lost'); }}), /pin_lost/);
    assert.deepEqual(writes, []);
    let protectedRoot;
    const value = await saveChe168Replica({storage, filename, binding, cursor: 1, beforeWrite: async root => { protectedRoot = root; }});
    assert.equal(value.key, protectedRoot); assert.ok(writes.every(key => key.startsWith(protectedRoot + '/')));
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('published checkpoint retains exact paid producer and handoff while legacy cursor behavior remains', async () => {
  const storage = new MemoryStorage(), pin = await openRawFeedPin(pinOptions(storage));
  const intake = {market: 'korea', provider: 'auto_api_encar', completed: true, completedAt: new Date(now).toISOString(),
    snapshotRun: '43800000001', snapshotAttempt: '2', rawStoragePins: [await pin.handoff()],
    sources: [{sourceId: 'encar_direct', provider: 'auto_api_encar', stopReason: 'source_finished'}]};
  const result = publishedIntakeCheckpoint(intake, {market: 'korea', published: true, generationId: manifest(0).generationId});
  assert.equal(result.snapshotRun, intake.snapshotRun); assert.equal(result.snapshotAttempt, '2');
  assert.equal(result.sources[0].provider, 'auto_api_encar'); assert.deepEqual(result.rawStoragePins, intake.rawStoragePins);
  assert.throws(() => publishedIntakeCheckpoint({...intake, snapshotRun: ''}, {market: 'korea', published: true, generationId: 'generation'}), /cursor_identity/);
});

function retentionFixture() {
  const objects = [], receipts = {};
  function add(root, receipt, leaves, daysOld) {
    receipts[root] = receipt;
    for (const leaf of leaves) objects.push({key: root + '/' + leaf, size: 100, lastModified: new Date(now - daysOld * day).toISOString()});
  }
  for (let n = 0; n < 7; n++) add(replicaRoot(n), replicaReceipt(n), ['manifest.json', '0.gz'], n + 2);
  add(RAW_PREFIXES['che168-snapshot'] + binding, {version: 1, complete: true, binding, config: snapshotConfig, parts: [{index: 0, bytes: 1024, sha256: sha(7)}]}, ['manifest.json', '00000.json', '00000.csv.gz'], 20);
  for (const n of [0, 1]) add(journalRoot(n), {version: 2, binding: sha(20 + n), initialCursor: 100, cursor: 100 + n, chunks: []}, ['head.json'], 2 + n);
  return {now, producerProtocolComplete: true,
    inventory: {complete: true, prefixes: Object.values(RAW_PREFIXES), objects, receipts},
    pinInventory: {complete: true, pins: []}, cursorInventory: {complete: true, references: []},
    currentManifest: manifest(0), previousManifest: manifest(1), currentProvenance: provenance(0), previousProvenance: provenance(1)};
}

function oldPin(root, state = 'loading') {
  return {version: 1, operationId: 'old-loading', owner, state, createdAt: new Date(now - 50 * day).toISOString(),
    updatedAt: new Date(now - 40 * day).toISOString(), references: [{kind: 'che168-replica', root}],
    ...(state === 'abandoned' ? {terminalAt: new Date(now - 40 * day).toISOString(), reason: 'collection_failed'} : {})};
}

test('planner keeps current previous, bounds whole groups, and exposes no partial selection', () => {
  const fixture = retentionFixture(), plan = planRawFeedRetention(fixture);
  assert.deepEqual(plan.summary.selectedGroups, [replicaRoot(6), replicaRoot(5)]);
  assert.equal(plan.summary.selectedObjects, 4); assert.equal(plan.summary.selectedBytes, 400);
  assert.equal(plan.summary.candidateGroups, 5);
  for (const root of [replicaRoot(0), replicaRoot(1), journalRoot(0), journalRoot(1)]) assert.ok(plan.summary.protectedRoots.includes(root));
  const bounded = planRawFeedRetention({...fixture, maxObjects: 3});
  assert.deepEqual(bounded.summary.selectedGroups, [replicaRoot(6)]);
  assert.equal(bounded.selected.length, 2);
  assert.equal(planRawFeedRetention({...fixture, maxBytes: 199}).selected.length, 0);
});

test('expired loading pins and still-current cursor replicas remain protected', () => {
  const fixture = retentionFixture();
  fixture.pinInventory.pins = [oldPin(replicaRoot(6))];
  fixture.cursorInventory.references = [{kind: 'che168-replica', root: replicaRoot(5), sha256: rawDigest(replicaReceipt(5))}];
  assert.deepEqual(planRawFeedRetention(fixture).summary.selectedGroups, [replicaRoot(4), replicaRoot(3)]);
});
test('every Encar report remains protected after unreference regardless of age or terminal producer state', () => {
  const fixture=retentionFixture(),reportRoots=[];
  for(let index=0;index<4;index++) {
    const at=now-(100+index)*day,root=RAW_PREFIXES['encar-reports']+at;reportRoots.push(root);
    fixture.inventory.receipts[root]={version:1,provider:'auto_api_encar',observedAtMs:at,observedAt:new Date(at).toISOString(),
      bucketPrefixLength:2,sourceRunId:'43800000001',sourceRunAttempt:'2',rowCount:1,
      history:{aa:{count:1,sha256:sha(1)}},inspection:{aa:{count:1,sha256:sha(2)}}};
    for(const leaf of ['complete.json','history/aa.json','inspection/aa.json'])fixture.inventory.objects.push({key:root+'/'+leaf,size:100,
      lastModified:new Date(at).toISOString()});
  }
  const pin=oldPin(replicaRoot(6),'abandoned');pin.references=[{kind:'encar-reports',root:reportRoots[3]}];
  fixture.pinInventory.pins=[pin];
  const planned=planRawFeedRetention(fixture);
  for(const root of reportRoots) {
    assert.ok(planned.summary.protectedRoots.includes(root));
    assert.ok(!planned.summary.selectedGroups.includes(root));
    assert.ok(planned.summary.readerProtected.some(row=>row.root===root&&row.status==='protected_unknown'
      &&row.reason==='vm_report_reader_unfenced'));
  }
  assert.deepEqual(planned.summary.selectedGroups,[replicaRoot(6),replicaRoot(5)]);
});

test('missing provenance, incomplete listing or unknown producer coverage cannot make a deletion plan', () => {
  for (const mode of ['protocol', 'inventory', 'pins', 'cursors', 'provenance', 'missing_root', 'changed_receipt']) {
    const fixture = retentionFixture();
    if (mode === 'protocol') fixture.producerProtocolComplete = false;
    if (mode === 'inventory') fixture.inventory.complete = false;
    if (mode === 'pins') fixture.pinInventory.complete = false;
    if (mode === 'cursors') fixture.cursorInventory.complete = false;
    if (mode === 'provenance') fixture.previousProvenance.complete = false;
    if (mode === 'missing_root') fixture.inventory.objects = fixture.inventory.objects.filter(row => !row.key.startsWith(replicaRoot(0)));
    if (mode === 'changed_receipt') fixture.inventory.receipts[replicaRoot(0)].cursor++;
    if (['protocol', 'provenance'].includes(mode)) {
      const plan = planRawFeedRetention(fixture);
      assert.equal(plan.summary.status, 'protected_unknown'); assert.deepEqual(plan.selected, []);
    } else assert.throws(() => planRawFeedRetention(fixture), /raw_/);
  }
});

test('unknown partial groups are kept regardless of age; an explicit terminal owner can release them', () => {
  const fixture = retentionFixture();
  delete fixture.inventory.receipts[replicaRoot(6)];
  let plan = planRawFeedRetention(fixture);
  assert.ok(plan.summary.unprovenRoots.includes(replicaRoot(6)));
  assert.ok(!plan.summary.selectedGroups.includes(replicaRoot(6)));
  fixture.pinInventory.pins = [oldPin(replicaRoot(6), 'abandoned')];
  plan = planRawFeedRetention(fixture);
  assert.ok(plan.summary.selectedGroups.includes(replicaRoot(6)));
});

test('new object, invalid age, unsafe keys and changed reference fences cannot silently pass', () => {
  const fixture = retentionFixture(), before = planRawFeedRetention(fixture);
  fixture.inventory.objects.find(row => row.key === replicaRoot(6) + '/0.gz').lastModified = new Date(now - 1000).toISOString();
  const after = planRawFeedRetention(fixture);
  assert.ok(!after.summary.selectedGroups.includes(replicaRoot(6)));
  assert.notEqual(after.summary.fenceDigest, before.summary.fenceDigest);
  for (const key of ['crm/customer.json', replicaRoot(6) + '/../private.json', replicaRoot(6) + '/unreviewed.txt']) {
    const unsafe = retentionFixture(); unsafe.inventory.objects.push({key, size: 1, lastModified: new Date(now - 99 * day).toISOString()});
    assert.throws(() => planRawFeedRetention(unsafe), /raw_inventory/);
  }
});
