import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeChe168Row, chinaOfferId} from '../scripts/catalog-next/normalize-che168.mjs';
import {prepareChinaSource} from '../scripts/catalog-next/che168-source.mjs';
import {openSavedChe168Snapshot} from '../scripts/catalog-next/saved-che168-snapshot.mjs';

const hash = x => createHash('sha256').update(Buffer.isBuffer(x) || typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const at = '2026-11-01T00:00:00.000Z', later = '2026-11-02T00:00:00.000Z';
const schema = 'auto-api-che168-v2';
// Synthetic examples exercise contracts; they are not live-source acceptance evidence.
const raw = (id, patch = {}) => ({inner_id: String(id), data: {inner_id: String(id), url: `https://www.che168.com/dealer/42/${id}.html`,
  mark: 'TestMake', model: 'TestModel', year: '2020', price: '98000', engine_type: 'Бензиновый', power: '150',
  km_age: '0', images: [], extra: {}, ...patch}});
const origin = label => ({key: 'private-fixture/' + label, sha256: hash(label)});
async function* iterable(values) { yield* values; }
async function setup(t, values, target = 10) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-next-source-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const source = {provider: 'auto_api_che168', schema, snapshotBinding: hash('binding'), snapshotManifestSha256: hash('manifest'),
    initialCursor: 10, expectedTerminalCursor: target, observedAt: at};
  return {source, snapshotRows: iterable(values.map((row, i) => ({row, origin: origin('snapshot-' + i)}))),
    assertSnapshotComplete: async () => ({rows: values.length, binding: source.snapshotBinding, manifestSha256: source.snapshotManifestSha256}),
    outputDir: path.join(dir, 'result')};
}
const page = (cursor, next, result, runId = '1') => ({runId, cursor, receivedAt: later,
  payload: {meta: {cur_change_id: cursor, next_change_id: next}, result}, origin: origin('page-' + runId + '-' + cursor)});
const event = (id, inner_id, change_type, data = {}) => ({id, inner_id: String(inner_id), change_type, data, created_at: later});
const collect = async stream => { const values = []; for await (const row of stream) values.push(row); return values; };

test('source mapping preserves unknowns, old years and high power; schema and identity are explicit', () => {
  const row = raw(1, {year: '2010', power: '650', price: '', model: '', engine_type: 'Электрический',
    first_registration: '2010-06', displacement: '2.0', seller_phone: 'PRIVATE-PHONE', vin: 'PRIVATE-VIN'});
  const mapped = normalizeChe168Row(row, {schema, observedAt: at});
  assert.equal(mapped.kind, 'offer'); assert.equal(mapped.offer.year, 2010); assert.equal(mapped.offer.powerHp, 650);
  assert.equal(mapped.offer.sourcePrice, undefined); assert.equal(mapped.offer.model, undefined);
  assert.equal(mapped.offer.sourceCurrency, 'CNY'); assert.equal(mapped.offer.power30MinKw, undefined);
  assert.equal(mapped.offer.engineCc, undefined); assert.equal(mapped.offer.productionDate, undefined);
  assert.equal(mapped.offer.id, chinaOfferId('1')); assert.ok(!JSON.stringify(mapped).includes('PRIVATE'));
  assert.deepEqual(mapped.warnings, ['missing_or_invalid_model', 'missing_or_invalid_price']);
  assert.throws(() => normalizeChe168Row(row, {schema: 'auto-api-che168-v3', observedAt: at}), /unsupported_schema/);
  assert.equal(normalizeChe168Row({...row, inner_id: '2'}, {schema, observedAt: at}).reason, 'identity_mismatch');
  const conflict = normalizeChe168Row(raw(2, {ice_power_ps: '150', ice_power_kw: '300'}), {schema, observedAt: at});
  assert.equal(conflict.offer.powerHp, undefined); assert.ok(conflict.warnings.includes('power_ps_kw_conflict'));
});

test('reconciliation accounts for duplicates, prices, full details, explicit removals and resolved missing detail', async t => {
  const rows = [raw(1), raw(2), raw(3), raw(1)], opts = await setup(t, rows, 17);
  const result = await prepareChinaSource({...opts, changePages: iterable([
    page(10, 15, [event(10, 1, 'changed', {new_price: '100000'}), event(11, 2, 'removed'),
      event(12, 4, 'added', raw(4).data), event(13, 5, 'changed')]),
    page(15, 17, [event(15, 5, 'removed'), event(16, 3, 'changed')]), page(17, null, [])]),
    resolveSavedDetail: async ({innerId}) => innerId === '3' ? {row: raw(3, {year: '2012'}), origin: origin('detail-3')} : null});
  const report = result.reconciliation, offers = await collect(result.offers());
  assert.deepEqual(report.snapshot, {rows: 4, uniqueIds: 3, identicalDuplicates: 1});
  assert.equal(report.changes.records, 6); assert.equal(report.changes.uniqueEvents, 6);
  assert.equal(report.final.uniqueIds, 5); assert.equal(report.final.active, 3); assert.equal(report.final.normalized, 3);
  assert.equal(report.final.removed, 2); assert.equal(report.final.unresolved, 0);
  assert.deepEqual(offers.map(x => x.offer.sourceOfferId), ['1', '3', '4']);
  assert.equal(offers[0].offer.sourcePrice, 100000); assert.equal(offers[1].offer.year, 2012);
  assert.equal(offers[0].offer.firstSeenAt, at); assert.equal(offers[0].source.terminalCursor, 17);
  assert.equal(report.sourceComplete, true); assert.equal(report.exactCursorClosure, true); assert.equal(report.publicationReady, false);
  const db = new DatabaseSync(result.paths.database, {readOnly: true});
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_state').get().n, 5); }
  finally { db.close(); }
  const manifest = JSON.parse(await fs.readFile(result.paths.manifest, 'utf8'));
  for (const name of ['offers', 'dispositions', 'reconciliation']) assert.equal(hash(await fs.readFile(result.paths[name])), manifest.files[name].sha256);
  assert.equal((await fs.stat(result.paths.database)).mode & 0o777, 0o600);
});

test('a pending changed detail is not silently retained or labelled sold', async t => {
  const opts = await setup(t, [raw(1)], 11);
  await assert.rejects(prepareChinaSource({...opts, changePages: iterable([page(10, 11, [event(10, 1, 'changed')]), page(11, null, [])])}), /unresolved_details/);
  await assert.rejects(fs.access(path.join(opts.outputDir, 'source-manifest.json')));
  const incomplete = JSON.parse(await fs.readFile(path.join(opts.outputDir, 'incomplete.json'), 'utf8'));
  assert.equal(incomplete.final.unresolved, 1); assert.equal(incomplete.final.removed, 0); assert.equal(incomplete.sourceComplete, false);
});

test('no terminal page, a cursor gap, a conflicting source duplicate and incomplete CSV all fail closed', async t => {
  for (const scenario of ['no_terminal', 'gap', 'duplicate', 'csv']) {
    const opts = await setup(t, scenario === 'duplicate' ? [raw(1), raw(1, {price: '2'})] : [raw(1)], 11);
    const pages = scenario === 'no_terminal' ? [page(10, 11, [event(10, 1, 'changed', {new_price: 1})])]
      : scenario === 'gap' ? [page(11, null, [])] : [page(10, 11, [event(10, 1, 'changed', {new_price: 1})]), page(11, null, [])];
    await assert.rejects(prepareChinaSource({...opts, changePages: iterable(pages),
      ...(scenario === 'csv' ? {assertSnapshotComplete: async () => ({rows: 0})} : {})}), /catalog_next_source_/);
    await assert.rejects(fs.access(path.join(opts.outputDir, 'source-manifest.json')));
  }
});

test('overlapping identical events count once; conflicting same-event payloads never choose a winner', async t => {
  const add = event(11, 2, 'added', raw(2).data);
  for (const conflict of [false, true]) {
    const opts = await setup(t, [raw(1)], 12);
    const execute = prepareChinaSource({...opts, changePages: iterable([
      page(10, 11, [add]), page(11, 12, [conflict ? {...add, data: raw(2, {price: '1'}).data} : add]), page(12, null, [])])});
    if (conflict) await assert.rejects(execute, /event_conflict/);
    else { const r = (await execute).reconciliation; assert.equal(r.changes.records, 2); assert.equal(r.changes.uniqueEvents, 1); assert.equal(r.changes.duplicateEvents, 1); assert.equal(r.final.normalized, 2); }
  }
});

test('saved independent run boundaries allow late events at the same cursor, never another page after its own terminal', async t => {
  const opts = await setup(t, [raw(1)], 11);
  const result = await prepareChinaSource({...opts, changePages: iterable([
    page(10, null, [], 'old'), page(10, 11, [event(10, 1, 'changed', {new_price: 10})], 'new'), page(11, null, [], 'new')])});
  assert.equal((await collect(result.offers()))[0].offer.sourcePrice, 10);
  const bad = await setup(t, [raw(1)], 11);
  await assert.rejects(prepareChinaSource({...bad, changePages: iterable([
    page(10, null, []), page(10, 11, [event(10, 1, 'changed', {new_price: 10})]), page(11, null, [])])}), /page_after_terminal/);
});

function csvArchive(rows) {
  const columns = ['inner_id', 'url', 'mark', 'model', 'year', 'price', 'images', 'extra', 'description'];
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const wire = Buffer.from(columns.join('|') + '\n' + rows.map(row => columns.map(key => cell(['images', 'extra'].includes(key) ? JSON.stringify(row.data[key]) : row.data[key])).join('|')).join('\n') + '\n');
  const config = {version: 1, host: 'https://autobase-barrett.auto-api.com', date: '2026-11-01', filename: 'active_offer.csv',
    delimiter: '|', initialCursor: 10, bytes: wire.length, etag: '"synthetic"', modifiedAt: at};
  const binding = hash(config), key = `catalog/provider-snapshots/che168/${binding}/manifest.json`;
  const manifest = Buffer.from(JSON.stringify({version: 1, binding, config, complete: true, parts: [{index: 0, bytes: wire.length, sha256: hash(wire)}]}));
  const objects = new Map([[key, manifest], [key.replace('manifest.json', '00000.csv.gz'), gzipSync(wire)]]);
  return {objects, manifestKey: key, manifestSha256: hash(manifest), expectedTerminalCursor: 10, schema,
    readObject: async key => { assert.ok(objects.has(key), 'exact saved key only'); return objects.get(key); }};
}

test('strict saved CSV adapter includes pre-2014 and unknown records, parses quoted pipes/newlines and attests exhaustion', async t => {
  const archive = csvArchive([raw(1, {year: '2010', model: 'Name|with\nnewline', description: 'PRIVATE-CONTACT'}), raw(2, {year: '', price: ''})]);
  const snapshot = await openSavedChe168Snapshot(archive);
  await assert.rejects(snapshot.assertComplete(), /snapshot_not_exhausted/);
  const opts = await setup(t, [], 10);
  const result = await prepareChinaSource({...opts, source: snapshot.source, snapshotRows: snapshot.rows,
    assertSnapshotComplete: snapshot.assertComplete, changePages: iterable([page(10, null, [])])});
  const rows = await collect(result.offers());
  assert.equal(rows.length, 2); assert.equal(rows[0].offer.year, 2010); assert.equal(rows[0].offer.model, 'Name|with\nnewline');
  assert.equal(rows[1].offer.year, undefined); assert.equal(rows[1].offer.sourcePrice, undefined);
  assert.ok(!JSON.stringify(rows).includes('PRIVATE-CONTACT'));
  assert.equal((await snapshot.assertComplete()).rows, 2);
  assert.equal(result.reconciliation.final.fieldWarnings.missing_or_invalid_year, 1);
});

test('saved part and normalized output corruption are detected, without provider fallback', async t => {
  const archive = csvArchive([raw(1)]), key = archive.manifestKey.replace('manifest.json', '00000.csv.gz');
  archive.objects.set(key, gzipSync(Buffer.from('different')));
  const snapshot = await openSavedChe168Snapshot(archive);
  await assert.rejects(collect(snapshot.rows), /snapshot_part_checksum/);
  await assert.rejects(snapshot.assertComplete(), /snapshot_not_exhausted/);
  const opts = await setup(t, [raw(1)], 10), result = await prepareChinaSource({...opts, changePages: iterable([page(10, null, [])])});
  await fs.appendFile(result.paths.offers, '{}\n');
  await assert.rejects(collect(result.offers()), /normalized_file_changed/);
});

test('invalid saved JSON and transport errors never expose source content or credentials', async () => {
  const archive = csvArchive([raw(1)]), secret = Buffer.from('PRIVATE-CREDENTIAL-NOT-JSON');
  archive.objects.set(archive.manifestKey, secret);
  await assert.rejects(openSavedChe168Snapshot({...archive, manifestSha256: hash(secret)}), {message: 'catalog_next_source_invalid_json'});
  await assert.rejects(openSavedChe168Snapshot({...archive, readObject: async () => { throw Error('PRIVATE-CREDENTIAL'); }}),
    {message: 'catalog_next_source_snapshot_read_failed'});
});
