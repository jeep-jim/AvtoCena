import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {readCollectionControls} from '../apps/web/lib/catalog/collection-controls.ts';
import {autoApiChe168Client, autoApiChe168Detail} from './lib/auto-api-che168-client.mjs';

// One owner-requested comparison. No storage writes, publication, customer data,
// full supplier collection, or credentials are included in its output.
const ids = ['42799484', '42760061'];
const snapshotPrefix = 'catalog/intake-staging/encar/43570782014/1';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const storage = getJsonStorage();
assert.equal(storage.driver, 'object', 'object_storage_required');
for (const name of ['writeJson', 'deleteJson', 'deleteObject', 'writeObject', 'deleteObjects']) {
  if (typeof storage[name] === 'function') storage[name] = async () => {throw Error('spec_audit_read_only');};
}
const assertEnabled = async () => {
  const controls = await readCollectionControls(storage);
  assert.equal(controls.markets.korea.enabled, true, 'korea_disabled');
  assert.equal(controls.sources.encar_feed.enabled, true, 'paid_encar_disabled');
  return controls;
};
const controls = await assertEnabled();
const manifest = await storage.readJson('catalog/manifest.json', null);
assert.match(manifest?.generationId || '', /^gen_[A-Za-z0-9_]+$/, 'manifest_identity_invalid');
assert.equal(manifest.markets?.korea?.provider, 'auto_api_encar', 'paid_korea_not_published');
const snapshot = await storage.readJson(snapshotPrefix + '/complete.json', null);
console.log(JSON.stringify({stage: 'saved_snapshot_metadata', pages: snapshot?.pages ?? null,
  count: snapshot?.count ?? null, completedAt: snapshot?.completedAt ?? null}));
assert.ok(Number.isSafeInteger(snapshot?.pages) && snapshot.pages > 0 && snapshot.pages <= 100000,
  'snapshot_page_bound');
assert.ok(Number.isSafeInteger(snapshot.count) && snapshot.count > 0, 'snapshot_count_invalid');
const fields = ['inner_id', 'mark', 'model', 'configuration', 'engine_type', 'displacement',
  'displacement_cc', 'power', 'power_ice_hp', 'power_electro_kw', 'drive_type'];
const pick = (data, names = fields) => Object.fromEntries(names.map(name => [name, data?.[name] ?? null]));
const saved = new Map();
let next = 1, pagesRead = 0;
const deadline = Date.now() + 6 * 60 * 1000;
await Promise.all(Array.from({length: 4}, async () => {
  while (saved.size < ids.length && next <= snapshot.pages && Date.now() < deadline) {
    const page = next++;
    const rows = await storage.readJson(snapshotPrefix + '/pages/' + page + '.json', null);
    assert.ok(Array.isArray(rows), 'saved_snapshot_page_missing');
    pagesRead++;
    for (const row of rows) {
      if (!ids.includes(String(row?.inner_id))) continue;
      assert.equal(String(row.data?.inner_id), String(row.inner_id), 'saved_identity_mismatch');
      assert.ok(!saved.has(String(row.inner_id)), 'saved_duplicate_identity');
      saved.set(String(row.inner_id), {page, data: pick(row.data)});
    }
    if (pagesRead % 500 === 0) console.log(JSON.stringify({stage: 'saved_page_progress', pagesRead, found: saved.size}));
  }
}));
assert.equal(digest(await storage.readJson(snapshotPrefix + '/complete.json', null)), digest(snapshot),
  'snapshot_changed_during_audit');

const index = await storage.readJson(`catalog/generations/${manifest.generationId}/indexes/offers-by-id.json`, null);
assert.ok(index && typeof index.byId === 'object', 'published_index_missing');
const request = autoApiChe168Client({platform: 'encar', apiKey: process.env.ACCOUNT_KEY,
  requestDelayMs: 200, deadline: Date.now() + 90000,
  fetchImpl: async (url, options) => {await assertEnabled(); return fetch(url, options);}});
const result = [];
for (const innerId of ids) {
  const id = createHash('sha256').update('encar_direct:' + innerId).digest('hex').slice(0, 24);
  const loc = index.byId[id];
  let published = null;
  if (loc) {
    assert.equal(loc.market, 'korea', 'published_market_mismatch');
    const key = String(loc.chunk).startsWith('catalog/') ? loc.chunk
      : `catalog/generations/${manifest.generationId}/offers/korea/${loc.chunk}.json`;
    const rows = await storage.readJson(key, null);
    assert.ok(Array.isArray(rows), 'published_offer_chunk_missing');
    const offer = rows.find(row => row.id === id);
    assert.ok(offer, 'published_offer_not_in_chunk');
    assert.equal(String(offer.sourceOfferId), innerId, 'published_source_identity_mismatch');
    published = {...pick(offer, ['id', 'sourceOfferId', 'make', 'model', 'trim', 'year', 'fuel',
      'engineCc', 'powerHp', 'icePowerKw', 'power30MinKw', 'utilizationPowerKw', 'drive']),
      provider: offer.operational?.provider ?? null};
  }
  let live = null, liveError = null;
  try {live = pick(autoApiChe168Detail(await request('offer', {inner_id: innerId}), innerId).data);}
  catch (error) {
    const message = String(error?.message || '');
    liveError = /^auto_api_[a-z_0-9]+$/.test(message) ? message : 'supplier_read_failed';
  }
  result.push({innerId, saved: saved.get(innerId) ?? null, published, live, liveError});
}
let health;
const started = Date.now();
try {
  const response = await fetch('https://avtocena.com/api/health', {signal: AbortSignal.timeout(30000), redirect: 'error'});
  const body = await response.json();
  health = {status: response.status, milliseconds: Date.now() - started,
    releaseSha: body.releaseSha ?? null, calculationVersion: body.calculationVersion ?? null};
} catch {health = {error: 'public_health_unavailable', milliseconds: Date.now() - started};}
const currentManifest = await storage.readJson('catalog/manifest.json', null);
console.log('PAID_KOREA_SPEC_COMPARISON ' + JSON.stringify({version: 1, checkedAt: new Date().toISOString(),
  generation: manifest.generationId, manifestUnchanged: digest(manifest) === digest(currentManifest),
  controlRevision: controls.revision, paidEnabled: controls.sources.encar_feed.enabled,
  oldEnabled: controls.sources.ajes_korea_feed.enabled, publishedCount: manifest.markets.korea.count,
  snapshotCompletedAt: snapshot.completedAt, snapshotPages: snapshot.pages, snapshotCount: snapshot.count,
  pagesRead, savedScanComplete: saved.size === ids.length || pagesRead === snapshot.pages,
  result, health, storageWrites: 0}));
