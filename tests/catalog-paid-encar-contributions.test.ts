import {createSourceContributionProtocol} from '../scripts/lib/catalog-source-contributions.mjs';
import assert from 'node:assert/strict';
import test, {mock} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {rawDigest, rawGenerationKey, buildRawGenerationProvenance, assertRawGenerationProvenance,
  rawContributionReferences} from '../scripts/lib/catalog-raw-provenance.mjs';
import {archiveIntakeDirectory, attachIntakeArchiveReceipt} from '../scripts/lib/nonjp-intake-archive.mjs';
import {createIndependentPaidInput, assertPaidInputWitness, paidInputRowsProof, verifiedPaidInputReport,
  createPaidPublicationContributions, preparePaidInternalContribution, preparePaidPublicContribution,
  paidContributionKey, paidContributionWorkerSource} from '../scripts/lib/catalog-paid-encar-contributions.mjs';
import {convertMarketOnDisk} from '../scripts/lib/catalog-disk-conversion.mjs';
import {readCatalogProjectionBatches} from '../apps/web/lib/catalog-projection-parts.ts';
import {prepareRawPublication} from '../scripts/lib/catalog-raw-publication.mjs';
import {prepareRawInternalPublication} from '../scripts/lib/catalog-raw-internal-publication.mjs';
import {verifySourceContribution} from '../apps/web/lib/catalog/source-contribution-reader.mjs';
import {verifiedRawInternalPointerDescriptor,buildRawInternalProvenance,rawInternalProvenanceKey} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';
import {normalizePaidEncarOffer} from '../scripts/lib/paid-encar-offer.mjs';
import {EncarDirectAdapter} from '../apps/web/lib/catalog/adapters';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {enrichOfferWithKnowledgeCore} from '../apps/web/lib/catalog/knowledge-core';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {selectCatalogV2MarketOffers} from '../apps/web/lib/catalog/catalog-v2-policy';
import {compactPublicStorageOffer, previewCanonicalPublicCatalogOffers, searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';

const at = '2026-11-16T12:00:00.000Z', generationId = 'gen_1794830400000_contribution';
const owner = {runId: '43800000001', attempt: '1', revision: 'a'.repeat(40)};
const run = '43570782014', attempt = '1', root = `catalog/intake-staging/encar/${run}/${attempt}`;
const row = id => ({id: `encar_${id}`, sourceOfferId: String(id), sourceId: 'encar_direct', market: 'korea',
  make: 'Kia', model: 'Morning', year: 2024, status: 'active', sourcePrice: 10000000, sourceCurrency: 'KRW',
  images: [{url: `https://ci.encar.com/${id}_1.jpg`}], firstSeenAt: at, updatedAt: at,
  operational: {provider: 'auto_api_encar', lastSeenAt: at}});

class MemoryStorage {
  driver = 'object'; values = new Map(); writes = []; reads = []; revision = 0;
  set(key, value) {this.values.set(key, {value: structuredClone(value), etag: String(++this.revision)});}
  async readJson(key, fallback) {this.reads.push(key); return structuredClone(this.values.get(key)?.value ?? fallback);}
  async readJsonBounded(key, maximum) {
    const value=await this.readJson(key,null),bytes=value===null?0:Buffer.byteLength(JSON.stringify(value));
    assert.ok(bytes<=maximum,'fixture_read_bound');return {found:value!==null,value,bytes};
  }
  async readJsonWithMeta(key, fallback) {
    const row = this.values.get(key);
    return row ? {found: true, value: structuredClone(row.value), etag: row.etag} : {found: false, value: fallback};
  }
  async getBinary(key) {const value = await this.readJson(key, null); if (!value) throw Error('missing_projection'); return {data: Buffer.from(JSON.stringify(value))};}
  async listBucketObjects() {return [...this.values].map(([key, row]) => ({key, size: Buffer.byteLength(JSON.stringify(row.value))}));}
  async writeJson(key, value, condition) {
    const old = this.values.get(key);
    if (condition?.ifNoneMatch === '*' && old || condition?.ifMatch && old?.etag !== condition.ifMatch) {
      const error = Error('storage_conflict'); error.name = 'StorageConflictError'; throw error;
    }
    this.writes.push({key, condition: structuredClone(condition)}); this.set(key, value);
  }
}

async function inputFixture(rows = [row(1001), row(1002)]) {
  const storage = new MemoryStorage(), raw = rows.map(value => ({inner_id: value.sourceOfferId, data: {inner_id: value.sourceOfferId}}));
  const snapshot = {pages: 2, count: raw.length, completedAt: at};
  storage.set(root + '/complete.json', snapshot);
  storage.set(root + '/pages/1.json', raw.slice(0, 1)); storage.set(root + '/pages/2.json', raw.slice(1));
  const input = createIndependentPaidInput({storage, run, attempt, snapshot, owner});
  let index = 0;
  for (let page = 1; page <= 2; page++) for (const source of await input.readPage(page)) input.recordOffer(source, rows[index++]);
  const witness = await input.finish({observations: rows.length, excluded: 0});
  assertPaidInputWitness(witness);
  return {storage, rows, snapshot, witness};
}

async function fixture(rows = [row(1001), row(1002)]) {
  const f = await inputFixture(rows), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paid-contribution-'));
  let intake;
  try {
    const report = {version: 1, market: 'korea', provider: 'auto_api_encar', completed: true, completedAt: at,
      snapshotRun: run, snapshotAttempt: attempt, confirmedWithdrawals: [], paidInputWitness: f.witness,
      sources: [{sourceId: 'encar_direct', provider: 'auto_api_encar', syncMode: 'snapshot', stopReason: 'source_finished',
        observations: f.rows.length, uniqueOffers: f.rows.length, pages: 2, excluded: 0}]};
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report));
    await fs.writeFile(path.join(directory, 'encar_direct-000001.jsonl'), f.rows.map(offer => JSON.stringify({offer})).join('\n') + '\n');
    intake = attachIntakeArchiveReceipt(report, await archiveIntakeDirectory({storage: f.storage, directory, market: 'korea', owner}));
  } finally {await fs.rm(directory, {recursive: true, force: true});}
  f.storage.set(`catalog/paid-encar-reports/v1/${Date.parse(at)}/complete.json`, {
    version: 1, provider: 'auto_api_encar', observedAtMs: Date.parse(at), observedAt: at, sourceRunId: run, sourceRunAttempt: attempt});
  const internalKey = `catalog/internal/offers/encar_direct/${generationId}-chunk-00001.json`;
  const publicKey = `catalog/generations/${generationId}/offers/korea/chunk-00001.json`;
  const internalManifest = {generationId, updatedAt: at, sources: {encar_direct: {count: 2, chunks: [internalKey], updatedAt: at}}};
  const manifest = {version: 2, generationId, updatedAt: at, markets: {korea: {count: 2, chunks: ['chunk-00001']}}};
  f.storage.set(internalKey, f.rows); f.storage.set(publicKey, f.rows);
  f.storage.set('catalog/internal/manifest.json', internalManifest);
  f.storage.set(`catalog/generations/${generationId}/indexes/projection/korea.json`, {generationId, items: f.rows.map(({id}) => ({id}))});
  return {...f, intake, internalKey, publicKey, internalManifest, manifest};
}

function tracking(f) {
  const track = createPaidPublicationContributions({intake: f.intake, freshOffers: f.rows, sellerInventory: true,
    compactPublic: value => value, sourceSha: owner.revision, calculationVersion: 'b'.repeat(64)});
  assert.ok(track);
  for (const row of f.rows) {track.observeMerge(row, undefined, row); track.recordAudited(row, row);}
  track.captureSelected(f.rows); track.captureNormalized(f.rows); track.captureFinal(f.rows);
  assert.equal(track.reason, null);
  return track;
}

test('independent saved-page input binds actual raw bytes, order and full normalized values', async () => {
  const f = await inputFixture();
  assert.deepEqual(f.witness.normalized, paidInputRowsProof(f.rows));
  assert.equal(f.witness.snapshot.pagesSha256, rawDigest([
    [1, rawDigest(await f.storage.readJson(root + '/pages/1.json', null)), 1],
    [2, rawDigest(await f.storage.readJson(root + '/pages/2.json', null)), 1],
  ]));
  assert.ok(f.storage.reads.every(key => key.startsWith(root + '/')));
  const input = createIndependentPaidInput({...f, run, attempt, owner});
  await assert.rejects(input.readPage(2), /page_order/);
  const altered = structuredClone(f.rows); altered[0].powerHp = 999;
  assert.notDeepEqual(paidInputRowsProof(altered), f.witness.normalized, 'same IDs do not prove the same input');
});

test('worker source identity uses actual clean tracked checkout rather than workflow owner identity', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paid-source-'));
  const files = ['scripts/lib/catalog-paid-encar-contributions.mjs', 'scripts/lib/paid-encar-offer.mjs',
    'scripts/lib/catalog-source-contributions.mjs', 'scripts/lib/catalog-source-contribution-authority.mjs',
    'scripts/catalog-restore-encar-snapshot.mjs', 'scripts/catalog-publish-market.mjs', 'apps/web/lib/catalog/adapters.ts'];
  const git = args => execFileSync('git', args, {cwd: directory, encoding: 'utf8', stdio: ['ignore','pipe','pipe']});
  try {
    git(['init', '--quiet']); git(['config', 'user.name', 'Offline fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
    for (const file of files) {await fs.mkdir(path.dirname(path.join(directory, file)), {recursive: true}); await fs.writeFile(path.join(directory,file), '// fixture\n');}
    assert.equal(paidContributionWorkerSource(directory), null, 'untracked normalization code is not proof');
    git(['add', '--', ...files]); git(['commit', '--quiet', '-m', 'offline contribution fixture']);
    const sha = git(['rev-parse', 'HEAD']).trim(); assert.equal(paidContributionWorkerSource(directory), sha);
    await fs.appendFile(path.join(directory, files[1]), '// changed mapper\n');
    assert.equal(paidContributionWorkerSource(directory), null, 'modified mapper cannot claim the committed source');
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test('changed complete document or a borrowed row object cannot produce an input witness', async () => {
  for (const mode of ['complete_changed', 'foreign_row']) {
    const f = await inputFixture(), input = createIndependentPaidInput({...f, run, attempt, owner});
    let index = 0;
    for (let page = 1; page <= 2; page++) for (const source of await input.readPage(page)) {
      input.recordOffer(mode === 'foreign_row' ? structuredClone(source) : source, f.rows[index++]);
    }
    if (mode === 'complete_changed') f.storage.set(root + '/complete.json', {...f.snapshot, completedAt: '2026-11-16T13:00:00Z'});
    assert.equal(await input.finish({observations: 2, excluded: 0}), null);
  }
});

test('actual SQLite conversion keeps proof only for exact final deduplicated payloads', async () => {
  const f = await fixture(), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'paid-conversion-'));
  try {
    const directory = path.join(temporary, 'in'), out = path.join(temporary, 'out');
    await fs.mkdir(directory); await fs.mkdir(out);
    const file = 'encar_direct-000001.jsonl';
    await fs.writeFile(path.join(directory, file), f.rows.map(offer => JSON.stringify({offer})).join('\n') + '\n');
    await convertMarketOnDisk({market: 'korea', directory, files: [file], out, report: f.intake});
    let saved = JSON.parse(await fs.readFile(path.join(out, 'catalog-rebuild-korea-0001.json'), 'utf8'));
    assert.deepEqual(saved.report.paidInputWitness, f.witness);
    await fs.appendFile(path.join(directory, file), JSON.stringify({offer: {...f.rows[0], sourcePrice: 999}}) + '\n');
    await convertMarketOnDisk({market: 'korea', directory, files: [file], out, report: f.intake});
    saved = JSON.parse(await fs.readFile(path.join(out, 'catalog-rebuild-korea-0001.json'), 'utf8'));
    assert.equal(saved.report.paidInputWitness, undefined);
    assert.equal(saved.offers[0].sourcePrice, 999, 'proof cannot change converter output');
  } finally {await fs.rm(temporary, {recursive: true, force: true});}
});

test('clean input passes both actual immutable outputs and carries all source/report roots', async () => {
  const f = await fixture(), contributions = tracking(f), before = rawDigest(f.rows);
  const internal = await preparePaidInternalContribution({storage: f.storage, manifest: f.internalManifest, contributions});
  assert.ok(internal);
  const publicProof = await preparePaidPublicContribution({...f, contributions, internal, readProjectionBatches: readCatalogProjectionBatches});
  assert.ok(publicProof); await internal.verify(); await publicProof.verify();
  assert.equal(publicProof.proof.internalReceipt.sha256, internal.reference.sha256);
  assert.deepEqual(publicProof.proof.references.map(row => row.kind).sort(), ['encar-reports', 'encar-snapshot', 'nonjp-intake']);
  assert.equal(rawDigest(f.rows), before, 'proof observes and never edits price, manual or source data');
  const writes = f.storage.writes.filter(row => row.key.includes('/contributions/'));
  assert.equal(writes.length, 3); assert.ok(writes.every(row => row.condition.ifNoneMatch === '*'));
  assert.equal(publicProof.proof.materialization.rows, 2);
  assert.equal(publicProof.proof.output.internal.count, 2);
});

test('repair, delta, partial, retained unknown and same-ID altered source do not qualify', async () => {
  const f = await fixture();
  for (const mutate of [
    report => {report.mode = 'saved_snapshot_technical_repair';},
    report => {report.technicalRepair = {};},
    report => {report.sources[0].syncMode = 'delta';},
    report => {report.sources[0].partial = true;},
    report => {report.rawArchiveDependencies = [{}];},
    report => {delete report.paidInputWitness;},
    report => {report.sources.push({...report.sources[0], sourceId: 'kcar_korea_open'});},
  ]) {
    const intake = structuredClone(f.intake); mutate(intake);
    assert.equal(createPaidPublicationContributions({intake, freshOffers: f.rows, sellerInventory: true,
      sourceSha: owner.revision, calculationVersion: 'b'.repeat(64), compactPublic: value => value}), null);
  }
  const rows = structuredClone(f.rows); rows[0].sourcePrice++;
  assert.equal(createPaidPublicationContributions({intake: f.intake, freshOffers: rows, sellerInventory: true,
    sourceSha: owner.revision, calculationVersion: 'b'.repeat(64), compactPublic: value => value}), null);
});

test('any observed borrowed field disables the proof even for identical IDs and otherwise equal bytes', async () => {
  const f = await fixture();
  for (const retained of [f.rows[0], {...f.rows[0], powerDataSource: 'manual'}, {...f.rows[0], power30MinKw: 80}]) {
    const track = createPaidPublicationContributions({intake: f.intake, freshOffers: f.rows, sellerInventory: true,
      sourceSha: owner.revision, calculationVersion: 'b'.repeat(64), compactPublic: value => value});
    track.observeMerge(f.rows[0], retained, f.rows[0]);
    assert.equal(track.reason, 'paid_contribution_borrowed_merge'); assert.equal(track.snapshot(), null);
  }
});

test('extra internal-only old row, same-ID different bytes and missing chunks retain safe unknown', async () => {
  for (const mode of ['extra', 'same_id_bytes', 'missing', 'other_korea']) {
    const f = await fixture(), contributions = tracking(f), writesBefore = f.storage.writes.length;
    if (mode === 'extra') {
      f.storage.set(f.internalKey, [...f.rows, {...row(9999), updatedAt: '2026-10-01T00:00:00Z'}]);
      f.internalManifest.sources.encar_direct.count++;
    }
    if (mode === 'same_id_bytes') f.storage.set(f.internalKey, [{...f.rows[0], powerHp: 210, powerDataSource: 'manual'}, f.rows[1]]);
    if (mode === 'missing') f.storage.values.delete(f.internalKey);
    if (mode === 'other_korea') f.internalManifest.sources.kcar_korea_open = {count: 1, chunks: ['old-kcar.json'], updatedAt: at};
    assert.equal(await preparePaidInternalContribution({storage: f.storage, manifest: f.internalManifest, contributions}), null, mode);
    assert.equal(f.storage.writes.length, writesBefore, 'no speculative proof is written for incomplete coverage');
  }
});

test('missing or incomplete immutable projection never qualifies as a public replacement', async () => {
  for (const mode of ['missing', 'truncated']) {
    const f = await fixture(), contributions = tracking(f);
    const internal = await preparePaidInternalContribution({storage: f.storage, manifest: f.internalManifest, contributions});
    const key = `catalog/generations/${generationId}/indexes/projection/korea.json`;
    if (mode === 'missing') f.storage.values.delete(key);
    else f.storage.set(key, {generationId, items: [{id: f.rows[0].id}]});
    assert.equal(await preparePaidPublicContribution({...f, contributions, internal, readProjectionBatches: readCatalogProjectionBatches}), null);
    assert.equal(f.storage.values.has(paidContributionKey(generationId)), false);
  }
});

test('changed archived witness, input complete or final proof fails fresh verification', async () => {
  for (const mode of ['archive', 'source', 'internal', 'public', 'proof']) {
    const f = await fixture(), contributions = tracking(f);
    const internal = await preparePaidInternalContribution({storage: f.storage, manifest: f.internalManifest, contributions});
    const proof = await preparePaidPublicContribution({...f, contributions, internal, readProjectionBatches: readCatalogProjectionBatches});
    assert.ok(proof);
    if (mode === 'archive') f.storage.set(f.intake.durableIntakeArchive.root + '/complete.json', {});
    if (mode === 'source') f.storage.set(root + '/complete.json', {...f.snapshot, count: 10});
    if (mode === 'internal') f.storage.set(f.internalKey, [f.rows[0], {...f.rows[1], sourcePrice: 1}]);
    if (mode === 'public') f.storage.set(f.publicKey, [f.rows[0], {...f.rows[1], power30MinKw: 88}]);
    if (mode === 'proof') f.storage.set(proof.reference.key, {...proof.proof, references: []});
    await assert.rejects(proof.verify());
  }
});

function historicBaseline(f) {
  const generationId = 'gen_1794744000000_historic', oldRoot = 'catalog/intake-staging/encar/43000000000/1';
  const baseline = {version: 2, generationId, updatedAt: '2026-11-15T12:00:00Z',
    markets: {korea: {count: 2, chunks: ['chunk-00001']}, china: {count: 1, chunks: ['china-old']}}};
  f.manifest.markets.china = {...baseline.markets.china};
  const china = {complete: false, producers: [], unknownSources: ['historic_provenance_missing'],
    references: [{kind: 'che168-snapshot', root: 'catalog/provider-snapshots/che168/' + 'c'.repeat(64)}]};
  const korea = {complete: false, producers: [], unknownSources: ['historic_provenance_missing'],
    references: [{kind: 'encar-snapshot', root: oldRoot}]};
  const paidReports = {generationId, manifestSha256: rawDigest(baseline), market: 'korea', count: 2, paidCount: 0,
    chunkProofs: [{key: `catalog/generations/${generationId}/offers/korea/chunk-00001.json`, count: 2, paidCount: 0, sha256: 'd'.repeat(64)}],
    observations: [], references: []};
  const prior = buildRawGenerationProvenance({manifest: baseline, marketSources: {china, korea}, paidReports});
  f.storage.set('catalog/manifest.json', baseline); f.storage.set(rawGenerationKey(generationId), prior);
  return {baseline, prior, oldRoot};
}

test('only actual complete contribution replaces historic target roots; other markets stay exact', async () => {
  const f = await fixture(), old = historicBaseline(f), contributions = tracking(f);
  const internal = await preparePaidInternalContribution({storage: f.storage, manifest: f.internalManifest, contributions});
  const proof = await preparePaidPublicContribution({...f, contributions, internal, readProjectionBatches: readCatalogProjectionBatches});
  assert.ok(proof);
  const publication = await prepareRawPublication({storage: f.storage, manifest: f.manifest,
    expectedBaseGenerationId: old.baseline.generationId, market: 'korea', intake: f.intake, contributions: proof});
  await publication.verify();
  const saved = await f.storage.readJson(rawGenerationKey(generationId), null);
  assertRawGenerationProvenance(saved, f.manifest, {requireComplete: false});
  assert.equal(saved.markets.korea.complete, true); assert.deepEqual(saved.markets.korea.unknownSources, []);
  assert.ok(!saved.markets.korea.references.some(row => row.root === old.oldRoot));
  assert.deepEqual(saved.markets.korea.contributionReferences, [proof.reference]);
  assert.deepEqual(saved.markets.china, old.prior.markets.china);
  assert.ok(!f.storage.reads.some(key => key.includes('/japan/') || key.startsWith('catalog/provider-snapshots/che168/')));
});

test('partial/repair/no-proof publication retains old unknown and roots even with identical current IDs', async () => {
  const f = await fixture(), old = historicBaseline(f);
  const publication = await prepareRawPublication({storage: f.storage, manifest: f.manifest,
    expectedBaseGenerationId: old.baseline.generationId, market: 'korea', intake: f.intake});
  await publication.verify();
  const saved = await f.storage.readJson(rawGenerationKey(generationId), null);
  assert.equal(saved.markets.korea.complete, false);
  assert.deepEqual(saved.markets.korea.unknownSources, ['historic_provenance_missing']);
  assert.ok(saved.markets.korea.references.some(row => row.root === old.oldRoot));
  assert.deepEqual(saved.markets.china, old.prior.markets.china);
});

test('invented contribution capability or changed public bytes cannot authorize root replacement', async () => {
  const f = await fixture(), old = historicBaseline(f);
  await assert.rejects(prepareRawPublication({storage: f.storage, manifest: f.manifest,
    expectedBaseGenerationId: old.baseline.generationId, market: 'korea', intake: f.intake,
    contributions: {proof: {complete: true, references: []}, verify: async () => {}}}), /public_authority/);
  assert.equal(f.storage.values.has(rawGenerationKey(generationId)), false);
  const contributions = tracking(f), internal = await preparePaidInternalContribution({storage: f.storage, manifest: f.internalManifest, contributions});
  const proof = await preparePaidPublicContribution({...f, contributions, internal, readProjectionBatches: readCatalogProjectionBatches});
  f.storage.set(f.publicKey, [{...f.rows[0], sourcePrice: 1}, f.rows[1]]);
  await assert.rejects(prepareRawPublication({storage: f.storage, manifest: f.manifest,
    expectedBaseGenerationId: old.baseline.generationId, market: 'korea', intake: f.intake, contributions: proof}), /row_bytes/);
  assert.equal(f.storage.values.has(rawGenerationKey(generationId)), false);
});
test('invented snapshots and a replaced public snapshot cannot mint internal materialization authority',async()=>{
  for(const mode of ['invented','overridden']) {
    const f=await fixture(),tracker=tracking(f),state=tracker.snapshot();
    const changed=f.rows.map((row,index)=>index===0?{...row,powerHp:210,powerDataSource:'manual',power30MinKw:88}:row);
    for(const row of state.rows) {
      const actual=changed.find(value=>value.id===row.id);row.normalizedSha256=rawDigest(actual);row.publicSha256=rawDigest(actual);
    }
    f.storage.set(f.internalKey,changed);f.storage.set(f.publicKey,changed);
    const contributions=mode==='invented'?{snapshot:()=>state}:Object.assign(tracker,{snapshot:()=>state});
    assert.equal(await preparePaidInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions}),null,mode);
    assert.ok(!f.storage.writes.some(row=>row.key.includes('/contributions/')));
  }
});
test('both stages require the same factory tracker even when public snapshot objects or identical states are supplied',async()=>{
  const f=await fixture(),first=tracking(f),second=tracking(f);
  const internal=await preparePaidInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions:first});
  assert.ok(internal);second.snapshot=first.snapshot;
  assert.equal(await preparePaidPublicContribution({...f,contributions:second,internal,readProjectionBatches:readCatalogProjectionBatches}),null);
  const originalState=first.snapshot();first.captureFinal(f.rows);
  first.snapshot=()=>originalState;
  assert.equal(await preparePaidPublicContribution({...f,contributions:first,internal,readProjectionBatches:readCatalogProjectionBatches}),null);
});
test('overridden internal and public verify methods never bypass the closed fresh byte verifiers',async()=>{
  for(const stage of ['internal','public']) {
    const f=await fixture(),old=historicBaseline(f),contributions=tracking(f);
    const internal=await preparePaidInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions});
    assert.ok(internal);internal.verify=async()=>{};
    if(stage==='internal') {
      f.storage.set(f.internalKey,[{...f.rows[0],powerHp:210,power30MinKw:88},f.rows[1]]);
      assert.equal(await preparePaidPublicContribution({...f,contributions,internal,readProjectionBatches:readCatalogProjectionBatches}),null);
    } else {
      const proof=await preparePaidPublicContribution({...f,contributions,internal,readProjectionBatches:readCatalogProjectionBatches});
      assert.ok(proof);proof.verify=async()=>{};
      f.storage.set(f.publicKey,[{...f.rows[0],powerHp:210,power30MinKw:88},f.rows[1]]);
      await assert.rejects(prepareRawPublication({storage:f.storage,manifest:f.manifest,
        expectedBaseGenerationId:old.baseline.generationId,market:'korea',intake:f.intake,contributions:proof}),/row_bytes/);
    }
    assert.equal(f.storage.values.has(rawGenerationKey(generationId)),false);
  }
});

test('public contribution references stay bounded, immutable and outside generation cleanup', () => {
  const value = {key: paidContributionKey(generationId), sha256: 'a'.repeat(64)};
  assert.deepEqual(rawContributionReferences([value, value]), [value]);
  assert.ok(value.key.startsWith('catalog/raw-feed-coordination/v1/contributions/'));
  assert.throws(() => rawContributionReferences([{...value, key: 'catalog/generations/' + generationId + '/manifest.json'}]), /scope/);
  assert.throws(() => rawContributionReferences([value, {...value, sha256: 'b'.repeat(64)}]), /conflict/);
  assert.throws(() => rawContributionReferences(Array(4097).fill(value)), /limit/);
});
test('actual paid producer proofs verify through the shared internal lifecycle and both generic reader phases',async()=>{
  const f=await fixture(),contributions=tracking(f);
  const internal=await preparePaidInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions});
  assert.ok(internal);
  const raw=await prepareRawInternalPublication({storage:f.storage,manifest:f.internalManifest,baseManifest:null,
    intake:f.intake,operationId:'combined_paid_fixture',contributionCapabilities:[internal]});
  assert.equal(raw.provenance.complete,true);assert.deepEqual(raw.contributionUnavailable,[]);
  const descriptor=await verifiedRawInternalPointerDescriptor({storage:f.storage,manifest:f.internalManifest,provenance:raw.provenance});
  assert.equal(descriptor.complete,true);
  const publicProof=await preparePaidPublicContribution({...f,contributions,internal,readProjectionBatches:readCatalogProjectionBatches});
  assert.ok(publicProof);
  const first=await verifySourceContribution({storage:f.storage,...internal.reference,internalManifest:f.internalManifest});
  const second=await verifySourceContribution({storage:f.storage,...publicProof.reference,internalManifest:f.internalManifest,
    publicManifest:f.manifest,stage:'public'});
  assert.equal(first.sourceId,'encar_direct');assert.equal(first.count,2);assert.equal(second.count,2);
  const carried={...f.internalManifest,generationId:'gen_1794916800000_carried',updatedAt:'2026-11-17T12:00:00Z'};
  assert.equal((await verifySourceContribution({storage:f.storage,...internal.reference,internalManifest:carried})).count,2);
  carried.sources={...carried.sources,encar_direct:{...carried.sources.encar_direct,updatedAt:'2026-11-17T12:00:00Z'}};
  await assert.rejects(verifySourceContribution({storage:f.storage,...internal.reference,internalManifest:carried}),/internal_source_changed/);
});

test('actual seller normalization and canonical public rows produce complete byte witnesses without changing technical or commercial facts', async () => {
  const previous = process.env.CATALOG_LIVE_RATE_DISABLED;
  process.env.CATALOG_LIVE_RATE_DISABLED = 'true'; resetCatalogRateCache();
  mock.timers.enable({apis: ['Date'], now: new Date(at)});
  const rates = {updatedAt: at, KRW: {cbrRate: 6, nominal: 100, rateDate: at, rateSource: 'cbr'},
    EUR: {cbrRate: 100, nominal: 1, rateDate: at, rateSource: 'cbr'}, USD: {cbrRate: 90, nominal: 1, rateDate: at, rateSource: 'cbr'}};
  const read = mock.method(LocalJsonStorage.prototype, 'readJsonWithMeta', async (key: string) =>
    ({found: true, value: key === 'fees/exchange-rates.json' ? rates : []}));
  const write = mock.method(LocalJsonStorage.prototype, 'writeJson', async () => {throw Error('unexpected_runtime_write');});
  try {
    const adapter = new EncarDirectAdapter();
    // Known reported technical examples; price/date/photos are explicit synthetic fixtures.
    const sourceData = [
      {inner_id: '42799484', model: 'Morning', configuration: 'GT Line', displacement_cc: 998, power: 76},
      {inner_id: '42760061', model: 'Seltos', configuration: '1.6T 2WD', displacement_cc: 1598, power: 193, drive_type: '2WD'},
    ].map(value => ({mark: 'Kia', year: 2024, engine_type: 'Бензин', price: 12000000, currency: 'KRW',
      km_age: 12000, transmission_type: 'Автомат', ...value}));
    const rows = sourceData.map(d => {
      const offer = normalizePaidEncarOffer(d, {id: d.inner_id, observedAt: at, adapter});
      offer.sourcePrice = d.price;
      offer.images = Array.from({length: 5}, (_, i) => ({id: '', url: `https://ci.encar.com/car/${d.inner_id}_${i + 1}.jpg`,
        objectKey: '', checksum: '', size: 0, mimeType: 'image/jpeg'}));
      Object.assign(offer.operational, {provider: 'auto_api_encar', exactDetail: true, detailIdentityVerified: true,
        exactPhotos: true, photoIdentityVerified: true, galleryImageCount: 5});
      return offer;
    });
    const f = await fixture(rows), contributions = createPaidPublicationContributions({intake: f.intake, freshOffers: rows,
      sellerInventory: true, compactPublic: compactPublicStorageOffer, sourceSha: owner.revision, calculationVersion: 'b'.repeat(64)});
    assert.ok(contributions);
    const audited = [];
    for (const source of rows) {
      contributions.observeMerge(source, undefined, source);
      const prepared = await prepareSellerInventory(source, {preservePublishedPrice: false}); assert.ok(prepared);
      const compact = compactPublicStorageOffer(prepared); contributions.recordAudited(source, compact); audited.push(compact);
    }
    const selected = selectCatalogV2MarketOffers(audited).selected;
    contributions.captureSelected(selected);
    const normalized = await Promise.all(selected.map(async row => normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(row))));
    contributions.captureNormalized(normalized);
    const final = (await previewCanonicalPublicCatalogOffers(normalized)).offers;
    contributions.captureFinal(final); assert.equal(contributions.reason, null); assert.ok(contributions.snapshot());
    assert.equal(normalized.length, 2); assert.equal(final.length, 2);
    f.storage.set(f.internalKey, normalized); f.storage.set(f.publicKey, final.map(compactPublicStorageOffer));
    f.storage.set(`catalog/generations/${generationId}/indexes/projection/korea.json`, {generationId, items: final.map(searchProjectionFromOffer)});
    const internal = await preparePaidInternalContribution({storage: f.storage, manifest: f.internalManifest, contributions});
    assert.ok(internal);
    const publicProof = await preparePaidPublicContribution({...f, contributions, internal, readProjectionBatches: readCatalogProjectionBatches});
    assert.ok(publicProof); await publicProof.verify();
    for (const value of final) {
      const expected = sourceData.find(d => d.inner_id === value.sourceOfferId);
      assert.equal(value.engineCc, expected.displacement_cc); assert.equal(value.powerHp, expected.power);
      assert.equal(value.drive || undefined, undefined); assert.equal(value.sourcePrice, expected.price);
      assert.equal(value.power30MinKw, undefined);
      assert.equal(value.operational.lastSeenAt || value.updatedAt || value.operational.sourcePublishedAt || value.firstSeenAt, at);
    }
  } finally {
    read.mock.restore(); write.mock.restore(); mock.timers.reset(); resetCatalogRateCache();
    if (previous === undefined) delete process.env.CATALOG_LIVE_RATE_DISABLED; else process.env.CATALOG_LIVE_RATE_DISABLED = previous;
  }
});


test('an arbitrary source factory cannot mint authority for the trusted paid instance',async()=>{
  const f=await fixture(),old=historicBaseline(f);
  const changed=f.rows.map((row,index)=>index===0?{...row,powerHp:210,powerDataSource:'manual',power30MinKw:88}:row);
  const retained={...changed[0],updatedAt:'2026-10-01T00:00:00Z'};
  const legitimate=createPaidPublicationContributions({intake:f.intake,freshOffers:f.rows,sellerInventory:true,
    compactPublic:value=>value,sourceSha:owner.revision,calculationVersion:'b'.repeat(64)});
  legitimate.observeMerge(f.rows[0],retained,changed[0]);assert.equal(legitimate.reason,'paid_contribution_borrowed_merge');
  const rogue=createSourceContributionProtocol({sourceId:'encar_direct',market:'korea',producerKind:'independent_paid_encar_snapshot_v1',
    witnessField:'paidInputWitness',snapshotKind:'encar-snapshot',snapshotReceiptLeaf:'complete.json',sourceRow:()=>true,
    assertWitness:value=>value,validateInput:()=>f.witness,defaultReusableSourceIds:['encar_direct','kcar_korea_open'],
    allowIndependentRetained:true,freshOnlyMerge:value=>changed.find(row=>row.id===value.id),errorPrefix:'rogue'});
  const track=rogue.createPublicationContributions({intake:f.intake,freshOffers:f.rows,sellerInventory:true,compactPublic:value=>value,
    sourceSha:owner.revision,calculationVersion:'b'.repeat(64)});
  for(let index=0;index<f.rows.length;index++) {track.observeMerge(f.rows[index],index===0?retained:undefined,changed[index]);track.recordAudited(changed[index],changed[index]);}
  track.captureSelected(changed);track.captureNormalized(changed);track.captureFinal(changed);assert.equal(track.reason,null);
  f.storage.set(f.internalKey,changed);f.storage.set(f.publicKey,changed);
  const internal=await rogue.prepareInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions:track});assert.ok(internal);
  const proof=await rogue.preparePublicContribution({...f,contributions:track,internal,readProjectionBatches:readCatalogProjectionBatches});assert.ok(proof);
  assert.equal((await verifySourceContribution({storage:f.storage,...proof.reference,internalManifest:f.internalManifest,publicManifest:f.manifest,stage:'public'})).count,2);
  await assert.rejects(prepareRawPublication({storage:f.storage,manifest:f.manifest,expectedBaseGenerationId:old.baseline.generationId,
    market:'korea',intake:f.intake,contributions:proof}),/source_contribution_public_authority/);
  assert.equal(await f.storage.readJson(rawGenerationKey(generationId),null),null,'untrusted capability cannot write target provenance');
});

test('new plain references and rogue internal capabilities cannot retire internal-only roots',async()=>{
 const f=await fixture();
 const changed=f.rows.map((row,index)=>index===0?{...row,powerHp:210,powerDataSource:'manual',power30MinKw:88}:row);
 const actualRetained={...changed[0],updatedAt:'2026-10-01T00:00:00Z'};
 const oldRoot='catalog/intake-staging/encar/43000000000/1';
 const oldGeneration='gen_1794744000000_internal-old';
 const oldChunk=`catalog/internal/offers/encar_direct/${oldGeneration}-chunk-00001.json`;
 const baseManifest={generationId:oldGeneration,updatedAt:'2026-11-15T12:00:00Z',sources:{encar_direct:{count:2,chunks:[oldChunk],updatedAt:'2026-11-15T12:00:00Z'}}};
 f.storage.set(oldChunk,[actualRetained,f.rows[1]]);
 const baseProof=buildRawInternalProvenance({manifest:baseManifest,references:[{kind:'encar-snapshot',root:oldRoot}]});
 f.storage.set(rawInternalProvenanceKey(oldGeneration),baseProof);f.storage.set('catalog/internal/manifest.json',baseManifest);
 const rogue=createSourceContributionProtocol({sourceId:'encar_direct',market:'korea',producerKind:'independent_paid_encar_snapshot_v1',witnessField:'paidInputWitness',snapshotKind:'encar-snapshot',snapshotReceiptLeaf:'complete.json',sourceRow:()=>true,assertWitness:value=>value,validateInput:()=>f.witness,defaultReusableSourceIds:['encar_direct','kcar_korea_open'],allowIndependentRetained:true,freshOnlyMerge:value=>changed.find(row=>row.id===value.id),errorPrefix:'rogue'});
 const track=rogue.createPublicationContributions({intake:f.intake,freshOffers:f.rows,sellerInventory:true,compactPublic:value=>value,freshOnlyMerge:value=>changed.find(row=>row.id===value.id),sourceSha:owner.revision,calculationVersion:'b'.repeat(64)});
 for(let index=0;index<f.rows.length;index++){
   track.observeMerge(f.rows[index],index===0?actualRetained:undefined,changed[index]);track.recordAudited(changed[index],changed[index]);
 }
 track.captureSelected(changed);track.captureNormalized(changed);track.captureFinal(changed);assert.equal(track.reason,null);
 f.storage.set(f.internalKey,changed);
 const internal=await rogue.prepareInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions:track});assert.ok(internal);
 for(const input of [{contributionReferences:[internal.reference]},{contributionCapabilities:[internal]}]) {
   await assert.rejects(prepareRawInternalPublication({storage:f.storage,manifest:f.internalManifest,baseManifest,intake:f.intake,operationId:'rogue_internal_fixture',...input}),/source_contribution_internal_authority/);
   assert.equal(await f.storage.readJson(rawInternalProvenanceKey(generationId),null),null,'untrusted internal contribution wrote provenance');
 }
 const retained=await f.storage.readJson(rawInternalProvenanceKey(oldGeneration),null);
 assert.ok(retained.references.some(row=>row.root===oldRoot));
});


test('internal lifecycle owns its verifier array and ignores replaced public capability fields',async()=>{
  const f=await fixture(),contributions=tracking(f);
  const internal=await preparePaidInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions});assert.ok(internal);
  const array=[internal];
  const raw=await prepareRawInternalPublication({storage:f.storage,manifest:f.internalManifest,baseManifest:null,
    intake:f.intake,operationId:'owned_internal_verifiers',contributionCapabilities:array});
  array.length=0;internal.verify=async()=>{};internal.reference={key:'wrong',sha256:'f'.repeat(64)};
  f.storage.set(f.internalKey,[{...f.rows[0],powerHp:210},f.rows[1]]);
  await assert.rejects(raw.verifyBeforeCommit(),/row_bytes/);
});

test('persisted verified source contributions carry forward only with the same internal source entry',async()=>{
  const f=await fixture(),contributions=tracking(f);
  const internal=await preparePaidInternalContribution({storage:f.storage,manifest:f.internalManifest,contributions});assert.ok(internal);
  const first=await prepareRawInternalPublication({storage:f.storage,manifest:f.internalManifest,baseManifest:null,
    intake:f.intake,operationId:'original_internal_verified',contributionCapabilities:[internal]});
  assert.equal(first.provenance.complete,true);
  const carried={...f.internalManifest,generationId:'gen_1794916800000_carried-source',updatedAt:'2026-11-17T12:00:00Z'};
  const next=await prepareRawInternalPublication({storage:f.storage,manifest:carried,baseManifest:f.internalManifest,
    intake:null,operationId:'carried_internal_verified'});
  assert.equal(next.provenance.complete,true);assert.deepEqual(next.contributionUnavailable,[]);
  const changed={...carried,generationId:'gen_1795003200000_changed-source',sources:{encar_direct:{...carried.sources.encar_direct,updatedAt:'2026-11-18T12:00:00Z'}}};
  const unknown=await prepareRawInternalPublication({storage:f.storage,manifest:changed,baseManifest:carried,
    intake:null,operationId:'changed_internal_unknown'});
  assert.equal(unknown.provenance.complete,false);
  assert.ok(unknown.provenance.references.some(row=>row.root===root));
});
