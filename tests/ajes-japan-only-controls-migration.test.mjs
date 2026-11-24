import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTROLS_KEY, JAPAN_ACCESS_KEY, retireAjesNonJapanControls}
  from '../.github/operations/ajes-japan-only-20261124/retire-controls.mjs';

const sourceSha = 'a'.repeat(40);
const row = enabled => ({enabled, enabledAt: null, disabledAt: null, changedBy: null});
const initial = () => ({version: 1, revision: 27, updatedAt: '2026-11-23T01:00:00Z',
  markets: {china: row(true), japan: row(true), korea: row(false), uae: row(true),
    europe: row(true), georgia: row(false)},
  sources: {ajes_china_feed: row(false), ajes_korea_feed: row(true),
    ajes_japan_feed: {...row(true), customProperty: 'unchanged'}, encar_feed: row(true),
    che168_feed: row(true), dubicars_feed: row(false), future_source: row(true),
    ...Object.fromEntries(['autohome_used_china_open', 'autohome_new_china_open', 'encar_direct',
      'kcar_korea_open', 'dubizzle_uae_open', 'dubicars_uae_exact', 'carswitch_uae_open',
      'mobile_de_open', 'autoscout_europe_open', 'myauto_georgia_list', 'autopapa_georgia_open',
      'akebono_green'].map(id => [id, row(false)]))},
  history: [{revision: 27, at: '2026-11-23T01:00:00Z', actor: 'owner', scope: 'source',
    id: 'ajes_korea_feed', enabled: true}], futureField: {preserved: true}});
const conflict = () => Object.assign(new Error('conflict'), {name: 'StorageConflictError'});

function fixture(value = initial(), options = {}) {
  let controls = structuredClone(value), etag = 'controls-27', japanReads = 0;
  const copies = new Map(), calls = [];
  const storage = {
    driver: 'object',
    async readObjectMetadata(key) {
      calls.push(['head', key]);
      assert.equal(key, JAPAN_ACCESS_KEY);
      japanReads++;
      return {found: true, etag: options.japanDrift && japanReads >= options.japanDrift ? 'changed' : 'japan-access'};
    },
    async readJsonWithMeta(key) {
      calls.push(['read', key]); assert.equal(key, CONTROLS_KEY);
      return {found: !options.missing, etag: options.noEtag ? undefined : etag, value: structuredClone(controls)};
    },
    async getBinary(key) {
      calls.push(['get', key]);
      assert.notEqual(key, JAPAN_ACCESS_KEY);
      return {data: options.corruptBackup ? Buffer.from('corrupt') : copies.get(key)};
    },
    async putBinary(key, body, type, condition) {
      calls.push(['put', key, structuredClone(condition)]);
      assert.equal(type, 'application/json'); assert.notEqual(key, JAPAN_ACCESS_KEY);
      if (key !== CONTROLS_KEY) {
        assert.match(key, /^settings-backups\/ajes-japan-only\/20261124\/123\/1\/(collection-controls-before|receipt)\.json$/);
        assert.deepEqual(condition, {ifNoneMatch: '*'});
        if (options.backupFail) throw new Error('backup failed');
        if (copies.has(key)) throw conflict();
        copies.set(key, Buffer.from(body)); return;
      }
      assert.deepEqual(condition, {ifMatch: 'controls-27'});
      if (options.concurrentOwner) {
        controls.sources.encar_feed.enabled = false; controls.revision++;
        etag = 'concurrent-owner'; throw conflict();
      }
      if (options.putFails) throw new Error('write failed');
      controls = JSON.parse(body); etag = 'controls-28';
      if (options.commitThenTimeout) throw new Error('timeout after commit');
    },
  };
  return {storage, calls, copies, current: () => structuredClone(controls)};
}
const run = f => retireAjesNonJapanControls({storage: f.storage, runId: '123', attempt: '1',
  sourceSha, now: () => Date.parse('2026-11-24T02:00:00Z')});
const controlsWrites = f => f.calls.filter(c => c[0] === 'put' && c[1] === CONTROLS_KEY);

test('removes only retired source entries, preserves every other setting and private Japan access', async () => {
  const original = initial(), f = fixture(original), result = await run(f);
  const expected = structuredClone(original);
  delete expected.sources.ajes_china_feed; delete expected.sources.ajes_korea_feed;
  expected.revision++; expected.updatedAt = '2026-11-24T02:00:00.000Z';
  assert.deepEqual(f.current(), expected);
  assert.deepEqual(original, initial());
  assert.deepEqual(result.removedSources, ['ajes_china_feed', 'ajes_korea_feed']);
  assert.equal(result.japanAccessUnchanged, true); assert.equal(result.otherSettingsUnchanged, true);
  assert.equal(result.catalogWrites, 0); assert.equal(result.supplierRequests, 0);
  assert.equal(controlsWrites(f).length, 1);
  const backup = [...f.copies.entries()].find(([key]) => key.endsWith('collection-controls-before.json'))[1];
  assert.deepEqual(JSON.parse(backup), original);
  assert.ok(f.calls.filter(c => c[1] === JAPAN_ACCESS_KEY).every(c => c[0] === 'head'));
});

test('repeated invocation is a read-only no-op after retirement', async () => {
  const f = fixture(); await run(f); const callsBefore = f.calls.length;
  const result = await run(f);
  assert.equal(result.alreadyRetired, true); assert.equal(result.applied, false);
  assert.equal(f.current().revision, 28);
  assert.ok(f.calls.slice(callsBefore).every(c => c[0] !== 'put'));
});

test('CAS conflict preserves a concurrent owner change without any overwrite or retry', async () => {
  const f = fixture(initial(), {concurrentOwner: true});
  await assert.rejects(run(f), /aj_settings_conflict/);
  assert.equal(controlsWrites(f).length, 1);
  assert.equal(f.current().sources.encar_feed.enabled, false);
  assert.ok(Object.hasOwn(f.current().sources, 'ajes_korea_feed'));
});

test('commit followed by timeout is accepted only after exact readback', async () => {
  const f = fixture(initial(), {commitThenTimeout: true});
  const result = await run(f);
  assert.equal(result.applied, true); assert.equal(controlsWrites(f).length, 1);
});

test('uncommitted write failure is not reported as success', async () => {
  const f = fixture(initial(), {putFails: true});
  await assert.rejects(run(f), /aj_settings_readback_mismatch/);
  assert.deepEqual(f.current(), initial()); assert.equal(controlsWrites(f).length, 1);
});

test('backup failure or corrupt readback prevents the settings mutation', async () => {
  for (const options of [{backupFail: true}, {corruptBackup: true}]) {
    const f = fixture(initial(), options); await assert.rejects(run(f), /aj_settings_backup/);
    assert.equal(controlsWrites(f).length, 0); assert.deepEqual(f.current(), initial());
  }
});

test('concurrent Japan access change before CAS fails without writing either configuration', async () => {
  const f = fixture(initial(), {japanDrift: 2});
  await assert.rejects(run(f), /aj_japan_access_changed/);
  assert.equal(controlsWrites(f).length, 0);
});

test('missing, unversioned or invalid controls fail without seeding or mutation', async () => {
  for (const [value, options] of [[initial(), {missing: true}], [initial(), {noEtag: true}],
    [{...initial(), revision: -1}, {}], [{...initial(), sources: {unknown: 'invalid'}}, {}],
    [{...initial(), markets: {}}, {}],
    [{...initial(), sources: {ajes_china_feed: row(true)}}, {}]]) {
    const f = fixture(value, options); await assert.rejects(run(f), /aj_controls_/);
    assert.ok(f.calls.every(c => c[0] !== 'put'));
  }
});
