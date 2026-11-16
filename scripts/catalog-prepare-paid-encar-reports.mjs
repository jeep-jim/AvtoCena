import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPORT_MAX_BYTES = 4 * 1024 * 1024;
export const REPORT_MAX_ROWS = 2048;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const reportOfferId = id => createHash('sha256').update('encar_direct:' + id).digest('hex').slice(0, 24);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const block = value => {
  if (value == null) return null;
  assert.ok(plainObject(value), 'paid_report_invalid_block');
  return value;
};

export function reportSnapshotIdentity(snapshot, run, attempt) {
  assert.match(String(run || ''), /^\d+$/, 'paid_report_invalid_run');
  assert.match(String(attempt || ''), /^[1-9]\d*$/, 'paid_report_invalid_attempt');
  assert.ok(Number.isSafeInteger(snapshot?.pages) && snapshot.pages > 0 && snapshot.pages <= 100_000,
    'paid_report_invalid_page_count');
  assert.ok(Number.isSafeInteger(snapshot?.count) && snapshot.count > 0, 'paid_report_invalid_row_count');
  const observedAtMs = Date.parse(snapshot.completedAt);
  assert.ok(Number.isSafeInteger(observedAtMs) && observedAtMs > 0, 'paid_report_invalid_observation');
  const observedAt = new Date(observedAtMs).toISOString();
  return {version: 1, provider: 'auto_api_encar', observedAt, observedAtMs,
    sourceRunId: String(run), sourceRunAttempt: String(attempt)};
}

export function addReportRow(rows, raw) {
  const id = String(raw?.inner_id || '');
  assert.match(id, /^\d{6,10}$/, 'paid_report_invalid_listing_id');
  assert.equal(String(raw?.data?.inner_id), id, 'paid_report_listing_identity_mismatch');
  const record = {offerId: reportOfferId(id), sourceOfferId: id,
    history: block(raw.data.history), inspection: block(raw.data.inspection), diagnosis: block(raw.data.diagnosis)};
  const previous = rows.get(record.offerId);
  if (previous) {
    assert.equal(digest(previous), digest(record), 'paid_report_conflicting_duplicate');
    return false;
  }
  rows.set(record.offerId, record);
  return true;
}

export function buildReportBuckets(records, identity, limits = {}) {
  const maxBytes = limits.maxBytes || REPORT_MAX_BYTES;
  const maxRows = limits.maxRows || REPORT_MAX_ROWS;
  const ordered = [...records.values()].sort((a, b) => a.offerId.localeCompare(b.offerId));
  assert.ok(ordered.length, 'paid_report_empty_snapshot');
  for (const depth of [2, 3]) {
    const grouped = new Map();
    for (const row of ordered) {
      const prefix = row.offerId.slice(0, depth);
      if (!grouped.has(prefix)) grouped.set(prefix, []);
      grouped.get(prefix).push(row);
    }
    const complete = {...identity, bucketPrefixLength: depth, rowCount: ordered.length, history: {}, inspection: {}};
    const buckets = [];
    let oversized = false;
    for (const [prefix, rows] of grouped) {
      for (const kind of ['history', 'inspection']) {
        const selected = rows.map(({offerId, sourceOfferId, history, inspection, diagnosis}) =>
          kind === 'history' ? {offerId, sourceOfferId, history} : {offerId, sourceOfferId, inspection, diagnosis});
        const body = {version: 1, provider: 'auto_api_encar', observedAt: identity.observedAt,
          observedAtMs: identity.observedAtMs, kind, prefix, rows: selected};
        const bytes = Buffer.byteLength(JSON.stringify(body));
        if (bytes > maxBytes || selected.length > maxRows) oversized = true;
        complete[kind][prefix] = {count: selected.length, sha256: digest(selected)};
        buckets.push({key: `${kind}/${prefix}.json`, body, bytes});
      }
    }
    if (!oversized) return {complete, buckets};
  }
  throw Error('paid_report_bucket_exceeds_bound');
}

export async function createAndVerify(storage, key, value) {
  let saved = await storage.readJson(key, null);
  if (saved === null) {
    try { await storage.writeJson(key, value, {ifNoneMatch: '*'}); }
    catch (error) { if (error?.name !== 'StorageConflictError') throw error; }
    saved = await storage.readJson(key, null);
  }
  assert.equal(digest(saved), digest(value), 'paid_report_immutable_readback_mismatch:' + key);
}

export async function mapBounded(values, concurrency, callback) {
  let cursor = 0, failure = null;
  await Promise.all(Array.from({length: Math.min(concurrency, values.length)}, async () => {
    while (!failure && cursor < values.length) {
      const index = cursor++;
      try { await callback(values[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
}

export async function publishReportBuckets({storage, complete, buckets, assertEnabled, assertSnapshotUnchanged}) {
  const root = `catalog/paid-encar-reports/v1/${complete.observedAtMs}/`;
  await assertEnabled();
  await mapBounded(buckets, 4, async bucket => {
    await assertEnabled();
    await createAndVerify(storage, root + bucket.key, bucket.body);
  });
  await assertSnapshotUnchanged();
  await assertEnabled();
  // Readers never accept a partial preparation. This immutable receipt is written last.
  await createAndVerify(storage, root + 'complete.json', complete);
  return root;
}

export function verifyCurrentReportCoverage(offers, records, identity, expectedCount) {
  assert.equal(offers.length, expectedCount, 'paid_report_current_inventory_count');
  const ids = new Set();
  const samples = {claims: null, zero: null, missing: null};
  let historyPresent = 0, historyMissing = 0, inspectionPresent = 0, diagnosisPresent = 0;
  for (const offer of offers) {
    assert.equal(offer.market, 'korea');
    assert.equal(offer.sourceId, 'encar_direct');
    assert.equal(offer.operational?.provider, 'auto_api_encar');
    assert.equal(reportOfferId(String(offer.sourceOfferId)), offer.id, 'paid_report_current_identity');
    assert.ok(!ids.has(offer.id), 'paid_report_duplicate_current_offer');
    ids.add(offer.id);
    assert.equal(Date.parse(offer.operational?.lastSeenAt || offer.updatedAt || offer.operational?.sourcePublishedAt || offer.firstSeenAt),
      identity.observedAtMs, 'paid_report_current_observation_mismatch');
    const report = records.get(offer.id);
    assert.ok(report && report.sourceOfferId === String(offer.sourceOfferId), 'paid_report_current_offer_missing');
    if (report.history) historyPresent++; else historyMissing++;
    if (report.inspection) inspectionPresent++;
    if (report.diagnosis) diagnosisPresent++;
    const h = report.history;
    const category = !h ? 'missing' : Number(h.own_damage_count) > 0 || Number(h.other_damage_count) > 0 ? 'claims'
      : h.own_damage_count === 0 && h.other_damage_count === 0 ? 'zero' : null;
    if (category && !samples[category]) samples[category] = {offerId: offer.id, sourceOfferId: report.sourceOfferId,
      make: offer.make, model: offer.model, year: offer.year,
      history: h ? {report_date: h.report_date, own_damage_count: h.own_damage_count,
        own_damage_cost_won: h.own_damage_cost_won, other_damage_count: h.other_damage_count,
        other_damage_cost_won: h.other_damage_cost_won, accidentCount: Array.isArray(h.accidents) ? h.accidents.length : null} : null,
      inspection: report.inspection ? Object.fromEntries(['issue_date', 'accident', 'simple_repair', 'flood',
        'special_history', 'recall', 'recall_completed', 'tuning', 'tuning_types', 'usage_changes',
        'panels', 'panel_codes', 'systems'].map(key => [key, report.inspection[key] ?? null])) : null};
  }
  return {currentCount: offers.length, covered: ids.size, historyPresent, historyMissing, inspectionPresent, diagnosisPresent, samples};
}

async function main() {
  const {getJsonStorage} = await import('../apps/web/lib/data.ts');
  const {readCollectionControls} = await import('../apps/web/lib/catalog/collection-controls.ts');
  const {collectionEnabled} = await import('../apps/web/lib/catalog/collection-controls-schema.ts');
  const storage = getJsonStorage();
  assert.equal(storage.driver, 'object', 'paid_report_requires_object_storage');
  const run = process.env.ENCAR_SNAPSHOT_RUN, attempt = process.env.ENCAR_SNAPSHOT_ATTEMPT;
  assert.match(String(run || ''), /^\d+$/);
  assert.match(String(attempt || ''), /^[1-9]\d*$/);
  const prefix = `catalog/intake-staging/encar/${run}/${attempt}`;
  const snapshot = await storage.readJson(prefix + '/complete.json', null);
  const identity = reportSnapshotIdentity(snapshot, run, attempt);
  const snapshotDigest = digest(snapshot);
  const assertEnabled = async () => assert.ok(collectionEnabled(await readCollectionControls(storage), 'encar_feed'),
    'paid_report_disabled_by_owner');
  const assertSnapshotUnchanged = async () => assert.equal(digest(await storage.readJson(prefix + '/complete.json', null)),
    snapshotDigest, 'paid_report_source_snapshot_changed');
  await assertEnabled();
  const records = new Map();
  let total = 0, duplicates = 0, pagesRead = 0;
  await mapBounded(Array.from({length: snapshot.pages}, (_, i) => i + 1), 4, async page => {
    await assertEnabled();
    const rows = await storage.readJson(`${prefix}/pages/${page}.json`, null);
    assert.ok(Array.isArray(rows) && (rows.length > 0 || page === snapshot.pages), 'paid_report_missing_page:' + page);
    for (const row of rows) { total++; if (!addReportRow(records, row)) duplicates++; }
    pagesRead++;
    if (pagesRead % 250 === 0) console.log(JSON.stringify({stage: 'saved_report_pages', pagesRead, total, unique: records.size}));
  });
  assert.equal(total, snapshot.count, 'paid_report_snapshot_count_mismatch');
  assert.equal(total - duplicates, records.size);
  await assertSnapshotUnchanged();
  const prepared = buildReportBuckets(records, identity);
  console.log(JSON.stringify({stage: 'paid_report_buckets_prepared', ...identity, total, duplicates,
    rowCount: records.size, bucketCount: prepared.buckets.length, bucketPrefixLength: prepared.complete.bucketPrefixLength,
    maximumBucketBytes: Math.max(...prepared.buckets.map(row => row.bytes))}));
  let coverage = null, koreaBefore = null;
  const expectedCount = Number(process.env.PAID_REPORT_CURRENT_KOREA_COUNT || 0);
  if (expectedCount) {
    const before = await storage.readJson('catalog/manifest.json', null);
    koreaBefore = before?.markets?.korea;
    assert.equal(koreaBefore?.provider, 'auto_api_encar');
    assert.equal(koreaBefore.count, expectedCount);
    assert.ok(Array.isArray(koreaBefore.chunks) && koreaBefore.chunks.length > 0);
    const offers = [];
    await mapBounded(koreaBefore.chunks, 4, async chunk => {
      const key = String(chunk).startsWith('catalog/') ? String(chunk)
        : `catalog/generations/${before.generationId}/offers/korea/${chunk}.json`;
      assert.ok(/^catalog\/[A-Za-z0-9_./-]+\.json$/.test(key) && !key.includes('..'), 'paid_report_invalid_current_chunk');
      const rows = await storage.readJson(key, null);
      assert.ok(Array.isArray(rows), 'paid_report_current_chunk_missing');
      offers.push(...rows);
    });
    coverage = verifyCurrentReportCoverage(offers, records, identity, expectedCount);
    assert.equal(digest((await storage.readJson('catalog/manifest.json', null))?.markets?.korea), digest(koreaBefore),
      'paid_report_current_korea_changed');
    console.log(JSON.stringify({stage: 'paid_report_current_coverage', ...coverage}));
  }
  const root = await publishReportBuckets({storage, ...prepared, assertEnabled, assertSnapshotUnchanged});
  if (koreaBefore) assert.equal(digest((await storage.readJson('catalog/manifest.json', null))?.markets?.korea), digest(koreaBefore),
    'paid_report_current_korea_changed_after_preparation');
  const report = {version: 1, completed: true, completedAt: new Date().toISOString(), ...identity, root,
    snapshotDigest, total, duplicates, rowCount: records.size, bucketCount: prepared.buckets.length,
    bucketPrefixLength: prepared.complete.bucketPrefixLength, completeDigest: digest(prepared.complete),
    maximumBucketBytes: Math.max(...prepared.buckets.map(row => row.bytes)), coverage,
    supplierRequests: 0, catalogManifestWrites: 0, offerWrites: 0, priceWrites: 0};
  const reportFile = process.env.PAID_REPORT_OUTPUT || 'paid-encar-report-preparation.json';
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
