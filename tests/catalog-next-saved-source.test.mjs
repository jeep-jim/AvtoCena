import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildSavedChinaSource} from '../scripts/catalog-next/saved-china-source.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const sourceId = 'autohome_used_china_open';

async function fixture(t, years = [2013, 2014, undefined, 2020]) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'china-saved-source-test-'));
  t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const inputDirectory = path.join(temp, 'input'), outputDirectory = path.join(temp, 'prepared');
  await fs.mkdir(inputDirectory);
  const completedAt = '2026-11-24T07:00:00.000Z';
  const binding = 'b'.repeat(64), replicaSha = 'c'.repeat(64);
  const replica = {key: 'catalog/provider-replicas/che168/01234567-89ab-cdef-0123-456789abcdef',
    sha256: replicaSha, binding, cursor: 200};
  const owner = {runId: '12345', attempt: '1', revision: 'a'.repeat(40)};
  const root = `catalog/nonjp-intake/v1/china/${owner.runId}/${owner.attempt}`;
  const offers = years.map((year, i) => ({id: sha(sourceId + ':' + (i + 1)).slice(0, 24), sourceOfferId: String(i + 1),
    sourceId, market: 'china', status: 'active', make: 'Example', model: 'One', ...(year === undefined ? {} : {year}),
    sourcePrice: 10000 + i, sourceCurrency: 'CNY', totalRub: null, ...(i ? {} : {powerHp: 150}),
    operational: {provider: 'auto-api.com', detailIdentityVerified: true,
      che168ActiveVerification: {method: 'snapshot_and_complete_change_stream', snapshotBinding: binding,
        cursor: 200, verifiedAt: completedAt}}}));
  const source = {sourceId, provider: 'auto_api_che168', ownedFeedRun: '12340', completeInventory: true,
    stopReason: 'source_finished', rejectedIdentity: 0, initialCursor: 100, cursor: 200,
    observations: offers.length, uniqueOffers: offers.length, changes: 10, snapshotBinding: binding, replica, quarantined: 2};
  const report = {version: 1, market: 'china', provider: 'auto_api_che168', completed: true, startedAt: '2026-11-24T06:00:00.000Z',
    completedAt, sources: [source]};
  const pairs = offers.map(offer => [offer.id, hash(offer)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const witness = {version: 1, kind: 'independent_che168_replica_v1', sourceId,
    producer: {runId: owner.runId, attempt: owner.attempt, sourceSha: owner.revision},
    snapshot: {root: replica.key, completeSha256: replicaSha, rows: offers.length, completedAt},
    normalized: {rows: offers.length, idsSha256: hash(pairs.map(([id]) => id)), rowsSha256: hash(pairs)},
    replicaReadback: {version: 1, method: 'closed_sqlite_restore_and_full_output_comparison', integrity: 'ok', binding,
      cursor: 200, replayInitialCursor: 100, completion: {authority: 'saved_completed_producer_report',
        cursor: 200, changes: 10, reportSha256: hash(report)}}};
  report.sourceInputWitness = {...witness, checksum: hash(witness)};
  const head = {version: 1, market: 'china', runId: '12340', rateRun: '12340', cursor: 200,
    observations: offers.length, archiveRoot: root};
  const downloadCut = {version: 1, market: 'china', status: 'complete', runId: '12340', startCursor: 100,
    cursor: 200, rows: 10, completedAt: '2026-11-23T22:00:00.000Z'};
  const manifest = {version: 1, kind: 'nonjp-intake', market: 'china', owner,
    collection: {complete: true}, files: [], totalBytes: 0};
  const archive = {version: 1, market: 'china', root, owner};
  async function write({rows = offers, reportValue = report} = {}) {
    const documents = [['report.json', JSON.stringify(reportValue)],
      [sourceId + '-000001.jsonl', rows.map(offer => JSON.stringify({stage: 'detail', observedAt: completedAt, offer}) + '\n').join('')]];
    manifest.files = [];
    for (const [name, text] of documents) {
      await fs.writeFile(path.join(inputDirectory, name), text);
      manifest.files.push({name, bytes: Buffer.byteLength(text), sha256: sha(text), parts: []});
    }
    manifest.reportDigest = manifest.files[0].sha256;
    manifest.totalBytes = manifest.files.reduce((n, file) => n + file.bytes, 0);
    archive.reportDigest = manifest.reportDigest;
    archive.manifestSha256 = head.archiveSha256 = hash(manifest);
  }
  await write();
  const args = {inputDirectory, outputDirectory, head, archive, manifest, downloadCut, minimumYear: 2014};
  return {args, offers, report, write, outputDirectory, inputDirectory};
}

test('full saved source is accounted for; 2014 inclusive, unknown year held, missing power retained', async t => {
  const f = await fixture(t);
  const result = await buildSavedChinaSource(f.args);
  assert.deepEqual(Object.fromEntries(['sourceRows', 'eligible', 'yearBeforeMinimum', 'yearUnknown', 'missingPower'].map(k => [k, result.reconciliation[k]])),
    {sourceRows: 4, eligible: 2, yearBeforeMinimum: 1, yearUnknown: 1, missingPower: 3});
  const eligible = []; for await (const offer of result.offers()) eligible.push(offer);
  assert.deepEqual(eligible.map(offer => offer.year).sort(), [2014, 2020]);
  assert(eligible.every(offer => offer.powerHp === undefined && offer.totalRub === null));
  const all = []; for await (const offer of result.offers({eligibleOnly: false})) all.push(offer);
  assert.equal(all.length, 4);
  assert.equal(result.manifest.sourceObservedAt, f.args.downloadCut.completedAt);
  assert.notEqual(result.manifest.sourceObservedAt, f.report.completedAt);
  assert.equal(result.manifest.publicationReady, false);
  assert.equal(result.manifest.supplierLatestVerified, false);
  assert.equal(result.reconciliation.sourceReportedQuarantined, 2);
  for (const file of Object.values(result.paths)) assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('a changed complete input cannot replace the independent replica row witness', async t => {
  const f = await fixture(t);
  f.offers[0].sourcePrice = 99999;
  await f.write();
  await assert.rejects(buildSavedChinaSource(f.args), /china_saved_full_replica_comparison/);
  await assert.rejects(fs.stat(path.join(f.outputDirectory, 'source-manifest.json')), /ENOENT/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.outputDirectory, 'incomplete.json'))).complete, false);
});

test('a duplicate listing fails rather than silently reducing the published count', async t => {
  const f = await fixture(t);
  await f.write({rows: [f.offers[0], f.offers[0], ...f.offers.slice(2)]});
  await assert.rejects(buildSavedChinaSource(f.args), /china_saved_duplicate_or_invalid_id/);
});

test('missing source witness and incomplete archives cannot be promoted', async t => {
  const f = await fixture(t);
  delete f.report.sourceInputWitness;
  await f.write();
  await assert.rejects(buildSavedChinaSource(f.args), /china_saved_replica_witness/);
  f.args.manifest.collection.complete = false;
  f.args.head.archiveSha256 = f.args.archive.manifestSha256 = hash(f.args.manifest);
  await assert.rejects(buildSavedChinaSource(f.args), /china_saved_archive_identity/);
});

test('changed archive bytes fail despite a valid stored manifest', async t => {
  const f = await fixture(t);
  const shard = path.join(f.inputDirectory, sourceId + '-000001.jsonl');
  await fs.appendFile(shard, ' ');
  await assert.rejects(buildSavedChinaSource(f.args), /china_saved_input_file/);
});

test('another market, modified year rule and wrong download lineage are refused', async t => {
  const f = await fixture(t);
  await assert.rejects(buildSavedChinaSource({...f.args, minimumYear: 2012}), /china_saved_year_policy/);
  await assert.rejects(buildSavedChinaSource({...f.args, head: {...f.args.head, market: 'korea'}}), /china_saved_head_identity/);
  await assert.rejects(buildSavedChinaSource({...f.args, downloadCut: {...f.args.downloadCut, cursor: 201}}), /china_saved_download_cut/);
});

test('a changing source head and existing output leave no accepted replacement', async t => {
  const f = await fixture(t); let checks = 0;
  await assert.rejects(buildSavedChinaSource({...f.args, assertCurrent: async () => { if (++checks > 1) throw Error('changed_head'); }}), /changed_head/);
  await assert.rejects(fs.stat(path.join(f.outputDirectory, 'source-manifest.json')), /ENOENT/);
  await assert.rejects(buildSavedChinaSource(f.args), /EEXIST/);
});

test('prepared source cannot be read after its database is modified', async t => {
  const f = await fixture(t);
  const result = await buildSavedChinaSource(f.args);
  await fs.appendFile(result.paths.database, 'broken');
  await assert.rejects(async () => { for await (const offer of result.offers()) void offer; }, /china_saved_prepared_source_changed/);
});

test('valid outer checksums cannot hide an incomplete or mismatched event-count witness', async t => {
  for (const missing of [false, true]) {
    const f = await fixture(t);
    const {checksum, ...witness} = f.report.sourceInputWitness;
    if (missing) {
      delete f.report.sources[0].changes;
      delete f.args.downloadCut.rows;
      delete witness.replicaReadback.completion.changes;
      const {sourceInputWitness, ...body} = f.report;
      witness.replicaReadback.completion.reportSha256 = hash(body);
    } else witness.replicaReadback.completion.changes++;
    f.report.sourceInputWitness = {...witness, checksum: hash(witness)};
    await f.write();
    await assert.rejects(buildSavedChinaSource(f.args), /china_saved_(source_lineage|replica_witness)/);
    await assert.rejects(fs.stat(path.join(f.outputDirectory, 'source-manifest.json')), /ENOENT/);
  }
});
