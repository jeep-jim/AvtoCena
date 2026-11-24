import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {normalizeAutoApiChe168} from '../apps/web/lib/catalog/auto-api-che168.ts';
import {refreshChinaSource, openLocalRefreshedChinaSource, assertChinaFeedControl}
  from '../scripts/catalog-next/refresh-china-source.mjs';

const SOURCE = 'autohome_used_china_open';
const before = '2026-11-22T21:34:55.563Z', after = '2026-11-24T09:00:00.000Z';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => sha(JSON.stringify(value));
const collect = async values => { const rows = []; for await (const row of values) rows.push(row); return rows; };
const raw = (id, data = {}) => ({inner_id: String(id), data: {inner_id: String(id),
  url: `https://www.che168.com/dealer/5/${id}.html`, mark: 'Kia', model: 'K3', year: '2020',
  price: '100000', power: '120', engine_type: 'бензин', ...data}});
const event = (id, innerId, type, data) => ({id, inner_id: String(innerId), change_type: type,
  created_at: '2026-11-23T12:00:00.000Z', ...(data === undefined ? {} : {data})});
const page = (cursor, next, rows = []) => ({meta: {cur_change_id: cursor, next_change_id: next}, result: rows});
function source(rows = [raw(1), raw(2, {year: '2010'}), raw(3)]) {
  const offers = rows.map(value => normalizeAutoApiChe168(value, before));
  assert(offers.every(Boolean));
  const manifest = {version: 1, kind: 'china-saved-source-v1', market: 'china', sourceId: SOURCE,
    sourceObservedAt: before, supplierLatestVerified: false, source: {cursor: 100, snapshotBinding: 'a'.repeat(64)}};
  return {complete: true, manifest, reconciliation: {sourceRows: offers.length, sourceReportedQuarantined: 32},
    receiptSha256: 'b'.repeat(64), receipt: {sourceManifestSha256: digest(manifest)}, originalOffers: offers,
    async *offers(options) { assert.deepEqual(options, {eligibleOnly: false}); for (const offer of offers) yield structuredClone(offer); }};
}
function client(pages, details = {}) {
  const calls = [];
  const request = async (endpoint, params) => {
    calls.push({endpoint, ...params});
    if (endpoint === 'changes') {
      assert(Object.hasOwn(pages, params.change_id), `unexpected cursor ${params.change_id}`);
      return structuredClone(pages[params.change_id]);
    }
    assert.equal(endpoint, 'offer');
    const value = details[params.inner_id];
    if (value instanceof Error) throw value;
    assert(value, `unexpected detail ${params.inner_id}`);
    return structuredClone(value);
  };
  return Object.assign(request, {calls});
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-refresh-test-'));
  t.after(() => fs.rm(directory, {force: true, recursive: true}));
  return {directory, outputDirectory: path.join(directory, 'generation')};
}
const options = (fixture, sourceValue, request, extra = {}) => ({...fixture, source: sourceValue,
  client: request, checkControl: async () => true, now: () => after, ...extra});
const validControls = () => ({version: 1, revision: 7, markets: {china: {enabled: true}}, sources: {che168_feed: {enabled: true}}});

test('complete delta reconciles inserts, updates, explicit removals and quarantine; all years remain available', async t => {
  const fixture = await setup(t), input = source(), original = JSON.stringify(input.originalOffers);
  const api = client({100: page(100, 104, [event(100, 2, 'changed', {new_price: 125000}),
    event(101, 1, 'removed'), event(102, 4, 'added', raw(4, {year: '2019'}).data),
    event(103, 3, 'changed', raw(3, {model: ''}).data)]), 104: page(104, null)});
  const progress = [];
  const output = await refreshChinaSource(options(fixture, input, api, {onProgress: value => progress.push(value)}));
  assert.equal(JSON.stringify(input.originalOffers), original);
  const rows = await collect(output.offers());
  assert.deepEqual(rows.map(row => row.sourceOfferId).sort(), ['2', '4']);
  assert.equal(rows.find(row => row.sourceOfferId === '2').sourcePrice, 125000);
  assert.equal(rows.find(row => row.sourceOfferId === '2').year, 2010);
  assert.equal((await collect(output.offers({eligibleOnly: true}))).length, 1);
  const r = output.reconciliation;
  assert.deepEqual([r.sourceRows, r.baseSourceRows, r.insertedRows, r.updatedRows, r.unchangedRows,
    r.removedRows, r.quarantinedRows, r.eligible, r.yearBeforeMinimum], [2, 3, 1, 1, 0, 1, 1, 1, 1]);
  assert.equal(r.priorReportedQuarantined, 32);
  assert.equal(r.finalAdmissionApplied, false);
  assert.equal(output.manifest.supplierLatestVerified, true);
  assert.equal(output.manifest.sourceObservedAt, after);
  assert.equal(output.manifest.source.cursor, 104);
  assert.equal(output.lineage.rawEvents, 4);
  assert.equal(output.lineage.uniqueEvents, 4);
  assert.equal(output.lineage.pages, 2);
  assert.equal(output.lineage.transportAttempts, null);
  assert.deepEqual(api.calls, [{endpoint: 'changes', change_id: 100}, {endpoint: 'changes', change_id: 104}]);
  assert.equal(progress.length, 1);
  for (const row of rows) {
    assert.equal(row.totalRub, null);
    assert.equal(row.operational.che168ActiveVerification.cursor, 104);
    assert.equal(row.operational.che168ActiveVerification.verifiedAt, after);
    assert.equal(row.operational.che168ActiveVerification.baseSourceReceiptSha256, input.receiptSha256);
  }
  const db = new DatabaseSync(output.paths.database, {readOnly: true});
  try {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM change_pages').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM change_events').get().n, 4);
    assert.equal(db.prepare("SELECT reason FROM states WHERE state='quarantine'").get().reason, 'missing_model');
  } finally { db.close(); }
});

test('empty verified head preserves complete source and portable descriptor opens in a separate location', async t => {
  const fixture = await setup(t), input = source(), api = client({100: page(100, 100)});
  const output = await refreshChinaSource(options(fixture, input, api));
  assert.equal(output.reconciliation.unchangedRows, 3);
  assert.equal(output.reconciliation.sourceRows, 3);
  assert.equal(output.reconciliation.yearBeforeMinimum, 1);
  assert.equal(output.manifest.sourceObservedAt, after);
  assert.equal(output.manifest.source.cursor, 100);
  const bytes = await fs.readFile(output.paths.descriptor);
  const descriptor = JSON.parse(bytes);
  assert.equal(descriptor.file.name, 'source.sqlite');
  assert(!bytes.toString().includes(fixture.directory));
  assert.equal((await fs.stat(output.paths.database)).mode & 0o777, 0o400);
  const moved = path.join(fixture.directory, 'moved');
  await fs.rename(output.paths.directory, moved);
  const reopened = await openLocalRefreshedChinaSource({descriptorPath: path.join(moved, 'SOURCE.json'), expectedSha256: sha(bytes)});
  assert.deepEqual((await collect(reopened.offers())).map(row => row.id).sort(), input.originalOffers.map(row => row.id).sort());
  const second = await refreshChinaSource({source: reopened, outputDirectory: path.join(fixture.directory, 'second'),
    client: client({100: page(100, null)}), checkControl: async () => true, now: () => '2026-11-25T09:00:00.000Z'});
  assert.equal(second.lineage.baseDescriptorSha256, reopened.descriptorSha256);
  assert.equal(second.lineage.inputPrivateReceiptSha256, input.receiptSha256);
  assert.equal(second.manifest.sourceObservedAt, '2026-11-25T09:00:00.000Z');
});

test('price-only unknown IDs and incomplete data require the real detail endpoint', async t => {
  const fixture = await setup(t), input = source([raw(1)]);
  const api = client({100: page(100, 102, [event(100, 2, 'changed', {new_price: 50000}),
    event(101, 1, 'changed', {model: 'changed'})]), 102: page(102, null)}, {
    1: {result: raw(1, {model: 'K5', price: '200000'})}, 2: raw(2, {price: '50000'})});
  const output = await refreshChinaSource(options(fixture, input, api));
  const rows = await collect(output.offers());
  assert.equal(output.lineage.logicalDetailRequests, 2);
  assert.equal(rows.find(row => row.sourceOfferId === '1').model, 'K5');
  assert.equal(rows.find(row => row.sourceOfferId === '1').firstSeenAt, before);
  assert.equal(rows.find(row => row.sourceOfferId === '2').sourcePrice, 50000);
  assert.equal(output.reconciliation.insertedRows, 1);
  assert.deepEqual(api.calls.map(row => row.endpoint), ['changes', 'offer', 'offer', 'changes']);
});

test('detail 404 is not a deletion and only a later explicit revision resolves the source', async t => {
  const fixture = await setup(t), input = source([raw(1)]);
  const missing = {1: new Error('auto_api_http_404')};
  const incomplete = client({100: page(100, 101, [event(100, 1, 'changed')]), 101: page(101, null)}, missing);
  await assert.rejects(refreshChinaSource(options(fixture, input, incomplete)), /china_refresh_detail_404_unresolved/);
  await assert.rejects(fs.stat(fixture.outputDirectory), {code: 'ENOENT'});
  const resolved = client({100: page(100, 101, [event(100, 1, 'changed')]),
    101: page(101, 102, [event(101, 1, 'removed')]), 102: page(102, null)}, missing);
  const output = await refreshChinaSource(options(fixture, input, resolved));
  assert.equal(output.reconciliation.sourceRows, 0);
  assert.equal(output.reconciliation.removedRows, 1);
  assert.equal(output.reconciliation.unresolvedDetails, 0);
  assert.equal(output.lineage.uniqueEvents, 2);
});

test('boundary event repeats are applied once and conflicting duplicate evidence rejects the entire output', async t => {
  const fixture = await setup(t), input = source([raw(1)]), repeated = event(102, 1, 'changed', {new_price: 110000});
  const api = client({100: page(100, 102, [event(101, 2, 'added', raw(2).data), repeated]),
    102: page(102, 104, [repeated, event(103, 2, 'removed')]), 104: page(104, null)});
  const output = await refreshChinaSource(options(fixture, input, api));
  assert.equal(output.lineage.rawEvents, 4);
  assert.equal(output.lineage.uniqueEvents, 3);
  assert.equal(output.lineage.duplicateEvents, 1);
  assert.equal(output.reconciliation.removedOutsideBase, 1);
  assert.equal(output.reconciliation.updatedRows, 1);
  assert.equal((await collect(output.offers()))[0].sourcePrice, 110000);
  const conflictDirectory = path.join(fixture.directory, 'conflict');
  const conflict = client({100: page(100, 102, [repeated]),
    102: page(102, 104, [{...repeated, data: {new_price: 120000}}]), 104: page(104, null)});
  await assert.rejects(refreshChinaSource(options({outputDirectory: conflictDirectory}, input, conflict)), /china_refresh_conflicting_event/);
  await assert.rejects(fs.stat(conflictDirectory), {code: 'ENOENT'});
});

test('price-only patch cannot resolve an earlier missing full-detail revision', async t => {
  const fixture = await setup(t), input = source([raw(1)]);
  const pages = {100: page(100, 101, [event(100, 1, 'changed')]),
    101: page(101, 102, [event(101, 1, 'changed', {new_price: 180000})]), 102: page(102, null)};
  const api = client(pages, {1: new Error('auto_api_http_404')});
  await assert.rejects(refreshChinaSource(options(fixture, input, api)), /china_refresh_detail_404_unresolved/);
  assert.equal(api.calls.filter(row => row.endpoint === 'offer').length, 2);
  await assert.rejects(fs.stat(fixture.outputDirectory), {code: 'ENOENT'});
  let details = 0;
  const base = client(pages), recovered = async (endpoint, params) => {
    if (endpoint !== 'offer') return base(endpoint, params);
    if (++details === 1) throw Error('auto_api_http_404');
    return raw(1, {model: 'K5', price: '180000'});
  };
  const output = await refreshChinaSource(options(fixture, input, recovered));
  assert.equal(details, 2);
  assert.equal(output.reconciliation.unresolvedDetails, 0);
  const [offer] = await collect(output.offers());
  assert.equal(offer.model, 'K5');
  assert.equal(offer.sourcePrice, 180000);
});

test('missing head, jumped cursors and invalid identity never produce a successful source', async t => {
  const fixture = await setup(t), input = source([raw(1)]);
  const cases = [
    {100: page(100, 101)},
    {100: page(99, 101, [event(100, 1, 'removed')])},
    {100: page(100, 101, [event(100, 1, 'changed', raw(2).data)])},
    {100: page(100, 101, [event(100, 1, 'changed', raw(1, {mark: ''}).data)])},
    {100: page(100, 101, [event(100, 1, 'changed', raw(1, {price: ''}).data)])},
  ];
  for (let i = 0; i < cases.length; i++) {
    const outputDirectory = path.join(fixture.directory, `invalid-${i}`);
    await assert.rejects(refreshChinaSource(options({outputDirectory}, input, client(cases[i]))), /china_refresh_|auto_api_detail_identity_mismatch/);
    await assert.rejects(fs.stat(outputDirectory), {code: 'ENOENT'});
  }
});

test('target owner controls fail closed without validating foreign switches and stop supplier access immediately', async t => {
  const controls = validControls(); controls.markets.japan = {enabled: 'malformed'};
  controls.sources.aj_system = null;
  assert.equal(assertChinaFeedControl(controls).revision, 7);
  for (const value of [null, {}, {...controls, revision: undefined}, {...controls, sources: {}}])
    assert.throws(() => assertChinaFeedControl(value), /china_refresh_control_invalid/);
  const disabled = validControls(); disabled.sources.che168_feed.enabled = false;
  assert.throws(() => assertChinaFeedControl(disabled), /china_refresh_control_disabled/);
  const fixture = await setup(t), input = source(), api = client({100: page(100, null)});
  await assert.rejects(refreshChinaSource(options(fixture, input, api, {checkControl: async () => assertChinaFeedControl(disabled)})), /control_disabled/);
  assert.equal(api.calls.length, 0);
  let checks = 0;
  await assert.rejects(refreshChinaSource(options(fixture, input, api, {checkControl: async () => ++checks < 2})), /control_disabled/);
  assert.equal(api.calls.length, 0);
  await assert.rejects(fs.stat(fixture.outputDirectory), {code: 'ENOENT'});
});

test('incomplete or duplicate base rows fail before supplier calls; occupied directories are preserved', async t => {
  const fixture = await setup(t), input = source(), api = client({100: page(100, null)});
  input.reconciliation.sourceRows++;
  await assert.rejects(refreshChinaSource(options(fixture, input, api)), /china_refresh_base_census/);
  assert.equal(api.calls.length, 0);
  const duplicate = source([raw(1), raw(1)]);
  await assert.rejects(refreshChinaSource(options(fixture, duplicate, api)), /china_refresh_failed/);
  assert.equal(api.calls.length, 0);
  await fs.mkdir(fixture.outputDirectory, {mode: 0o700});
  await fs.writeFile(path.join(fixture.outputDirectory, 'keep'), 'original');
  await assert.rejects(refreshChinaSource(options(fixture, source(), api)), {code: 'EEXIST'});
  assert.equal(await fs.readFile(path.join(fixture.outputDirectory, 'keep'), 'utf8'), 'original');
});

test('descriptor authority, full census, and iterator early-return verify immutable database bytes', async t => {
  const fixture = await setup(t), input = source();
  const output = await refreshChinaSource(options(fixture, input, client({100: page(100, null)})));
  await assert.rejects(openLocalRefreshedChinaSource({descriptorPath: output.paths.descriptor, expectedSha256: 'f'.repeat(64)}), /descriptor_checksum/);
  const descriptor = JSON.parse(await fs.readFile(output.paths.descriptor));
  descriptor.reconciliation.sourceRows = 1;
  descriptor.manifest.reconciliation.sourceRows = 1;
  await fs.chmod(output.paths.descriptor, 0o600);
  await fs.writeFile(output.paths.descriptor, JSON.stringify(descriptor));
  await fs.chmod(output.paths.descriptor, 0o400);
  await assert.rejects(openLocalRefreshedChinaSource({descriptorPath: output.paths.descriptor, expectedSha256: digest(descriptor)}), /descriptor_census/);
  const iterator = output.offers();
  await iterator.next();
  await fs.chmod(output.paths.database, 0o600);
  await fs.appendFile(output.paths.database, Buffer.from('changed'));
  await fs.chmod(output.paths.database, 0o400);
  await assert.rejects(iterator.return(), /database_changed|file_changed/);
});

test('supplier secrets are not reflected through thrown errors and no partial descriptor survives', async t => {
  const fixture = await setup(t);
  await assert.rejects(refreshChinaSource(options(fixture, source(), async () => {
    throw Error('request https://vendor.invalid?api_key=secret-cannot-escape failed');
  })), error => error.message === 'china_refresh_failed' && !error.stack.includes('secret-cannot-escape'));
  await assert.rejects(fs.stat(fixture.outputDirectory), {code: 'ENOENT'});
});
