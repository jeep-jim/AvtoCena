import test from 'node:test';
import assert from 'node:assert/strict';
import {reportSnapshotIdentity, addReportRow, buildReportBuckets, createAndVerify,
  publishReportBuckets, verifyCurrentReportCoverage} from '../scripts/catalog-prepare-paid-encar-reports.mjs';

const identity = reportSnapshotIdentity({pages: 1, count: 1, completedAt: '2026-11-14T00:00:00Z'}, '43570782014', '1');
const raw = (id = '42196907', history = {own_damage_count: 0, other_damage_count: null, accidents: []}) =>
  ({inner_id: id, data: {inner_id: id, history, inspection: null, diagnosis: null}});
const prepare = input => { const rows = new Map(); for (const row of input) addReportRow(rows, row); return {rows, ...buildReportBuckets(rows, identity)}; };
function storageFixture(failKey = '') {
  const saved = new Map(), writes = [];
  return {saved, writes,
    async readJson(key, fallback) { return saved.has(key) ? structuredClone(saved.get(key)) : fallback; },
    async writeJson(key, value, condition) {
      assert.deepEqual(condition, {ifNoneMatch: '*'});
      if (key === failKey) throw Error('write_failed');
      if (saved.has(key)) { const error = Error('conflict'); error.name = 'StorageConflictError'; throw error; }
      saved.set(key, structuredClone(value)); writes.push(key);
    }};
}
test('saved source identity is canonical and cannot accept missing snapshots or mismatched listing IDs', () => {
  assert.equal(identity.observedAt, '2026-11-14T00:00:00.000Z');
  assert.throws(() => reportSnapshotIdentity(null, '1', '1'));
  assert.throws(() => reportSnapshotIdentity({pages: 1, count: 1, completedAt: 'invalid'}, '1', '1'));
  const rows = new Map(); const bad = raw(); bad.data.inner_id = '12345678';
  assert.throws(() => addReportRow(rows, bad), /identity_mismatch/);
  assert.throws(() => addReportRow(rows, {...raw(), inner_id: '../manifest'}));
});
test('null, explicit zero and exact raw insurance amounts survive without conversion', () => {
  const prepared = prepare([raw(), raw('42546504', null), raw('42536582', {own_damage_count: 2,
    own_damage_cost_won: 38574280, accidents: [{insurance_benefit_won: 38834460, parts_won: 29212740}]})]);
  const rows = prepared.buckets.filter(bucket => bucket.body.kind === 'history').flatMap(bucket => bucket.body.rows);
  assert.deepEqual(rows.find(row => row.sourceOfferId === '42196907').history,
    {own_damage_count: 0, other_damage_count: null, accidents: []});
  assert.equal(rows.find(row => row.sourceOfferId === '42546504').history, null);
  assert.equal(rows.find(row => row.sourceOfferId === '42536582').history.own_damage_cost_won, 38574280);
  assert.equal(rows.find(row => row.sourceOfferId === '42536582').history.accidents[0].insurance_benefit_won, 38834460);
});
test('identical duplicates are harmless but conflicting report history is rejected', () => {
  const rows = new Map(); assert.equal(addReportRow(rows, raw()), true);
  assert.equal(addReportRow(rows, raw()), false);
  assert.throws(() => addReportRow(rows, raw('42196907', {own_damage_count: 2})), /conflicting_duplicate/);
});
test('premeasured oversized buckets split once; individually oversized reports stop preparation', () => {
  const rows = new Map(); for (let id = 10000000; id < 10000200; id++) addReportRow(rows, raw(String(id)));
  const prepared = buildReportBuckets(rows, identity, {maxRows: 3});
  assert.equal(prepared.complete.bucketPrefixLength, 3);
  assert.throws(() => buildReportBuckets(rows, identity, {maxBytes: 10}), /exceeds_bound/);
});
test('partial write failure leaves complete absent; retry resumes immutable verified chunks', async () => {
  const prepared = prepare([raw()]);
  const root = `catalog/paid-encar-reports/v1/${identity.observedAtMs}/`;
  const storage = storageFixture(root + prepared.buckets[1].key);
  const options = {storage, ...prepared, assertEnabled: async () => {}, assertSnapshotUnchanged: async () => {}};
  await assert.rejects(publishReportBuckets(options), /write_failed/);
  assert.equal(storage.saved.has(root + 'complete.json'), false);
  const resume = {...storage, async writeJson(key, value, condition) {
    assert.deepEqual(condition, {ifNoneMatch: '*'}); assert.equal(storage.saved.has(key), false);
    storage.saved.set(key, structuredClone(value)); storage.writes.push(key);
  }};
  await publishReportBuckets({...options, storage: resume});
  assert.equal(storage.writes.at(-1), root + 'complete.json');
  const writes = storage.writes.length;
  await publishReportBuckets({...options, storage: resume});
  assert.equal(storage.writes.length, writes);
});
test('an existing immutable conflict is never overwritten or accepted', async () => {
  const storage = storageFixture(); storage.saved.set('report', {history: {own_damage_count: 0}});
  await assert.rejects(createAndVerify(storage, 'report', {history: {own_damage_count: 1}}), /readback_mismatch/);
  assert.equal(storage.writes.length, 0);
});
test('a completed report is read-only on retry and a missing bucket is not silently recreated', async () => {
  const prepared = prepare([raw()]), storage = storageFixture();
  const options = {storage, ...prepared, assertEnabled: async () => {}, assertSnapshotUnchanged: async () => {}};
  const root = await publishReportBuckets(options), writes = storage.writes.length;
  storage.saved.delete(root + prepared.buckets[0].key);
  await assert.rejects(publishReportBuckets(options), /completed_bucket_missing_or_changed/);
  assert.equal(storage.writes.length, writes);
});
test('changed source before final receipt prevents activation', async () => {
  const prepared = prepare([raw()]); const storage = storageFixture();
  await assert.rejects(publishReportBuckets({storage, ...prepared, assertEnabled: async () => {},
    assertSnapshotUnchanged: async () => { throw Error('source_changed'); }}), /source_changed/);
  assert.ok(![...storage.saved.keys()].some(key => key.endsWith('complete.json')));
});
test('owner disable is rechecked after writes and prevents the complete receipt', async () => {
  const prepared = prepare([raw()]); const storage = storageFixture();
  await assert.rejects(publishReportBuckets({storage, ...prepared,
    assertEnabled: async () => { if (storage.writes.length) throw Error('disabled_by_owner'); },
    assertSnapshotUnchanged: async () => {}}), /disabled_by_owner/);
  assert.ok(![...storage.saved.keys()].some(key => key.endsWith('complete.json')));
});
test('every current paid car must have exact identity and observation coverage', () => {
  const prepared = prepare([raw()]); const row = [...prepared.rows.values()][0];
  const offer = {id: row.offerId, sourceOfferId: row.sourceOfferId, sourceId: 'encar_direct', market: 'korea',
    operational: {provider: 'auto_api_encar', lastSeenAt: identity.observedAt}};
  assert.equal(verifyCurrentReportCoverage([offer], prepared.rows, identity, 1).covered, 1);
  assert.throws(() => verifyCurrentReportCoverage([{...offer, operational: {...offer.operational,
    lastSeenAt: '2026-11-15T00:00:00Z'}}], prepared.rows, identity, 1), /observation_mismatch/);
  assert.throws(() => verifyCurrentReportCoverage([{...offer, sourceId: 'ajes_korea_feed'}], prepared.rows, identity, 1));
});
