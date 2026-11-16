import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PAID_ENCAR_REPAIR_SNAPSHOT, PAID_ENCAR_REPAIR_PROTECTED_KEYS, paidRepairDigest,
  paidRepairObjectRevision, paidRepairRowsProof, buildPaidEncarTechnicalRepair,
  assertPaidRepairReceipt, assertPaidRepairPublicationRows, paidRepairExampleFields} from './paid-encar-technical-repair.mjs';
import {readLiveBudgetIdentity} from './catalog-staged-budget.mjs';

const snapshotRoot = `catalog/intake-staging/encar/${PAID_ENCAR_REPAIR_SNAPSHOT.runId}/${PAID_ENCAR_REPAIR_SNAPSHOT.attempt}`;
const same = (a, b) => paidRepairDigest(a) === paidRepairDigest(b);
export function paidRepairChunkPath(manifest, market, chunk) {
  const key = String(chunk).startsWith('catalog/') ? chunk
    : `catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
  assert.match(key, new RegExp(`^catalog/generations/gen_\\d+_[a-z0-9-]+/offers/${market}/[a-z0-9-]+\\.json$`), 'paid_repair_chunk_scope');
  return key;
}
export async function readPaidRepairCurrent(storage, manifest) {
  const market = manifest?.markets?.korea;
  assert.ok(manifest?.version === 2 && market?.provider === 'auto_api_encar' && Array.isArray(market.chunks)
    && market.chunks.length > 0 && market.chunks.length <= 10000 && market.count > 0 && market.count <= 500000, 'paid_repair_current_manifest');
  const rows = [], seen = new Set();
  for (const chunk of market.chunks) {
    const key = paidRepairChunkPath(manifest, 'korea', chunk);
    assert.ok(!seen.has(key), 'paid_repair_duplicate_chunk'); seen.add(key);
    const values = await storage.readJson(key, null);
    assert.ok(Array.isArray(values) && values.length > 0 && values.length <= 5000, 'paid_repair_current_chunk_missing');
    rows.push(...values);
    assert.ok(rows.length <= market.count, 'paid_repair_current_coverage_invalid');
  }
  assert.equal(rows.length, market.count, 'paid_repair_current_coverage_incomplete');
  return rows;
}
export function assertPaidRepairProducer(value) {
  assert.ok(String(value?.id) === PAID_ENCAR_REPAIR_SNAPSHOT.runId
    && String(value?.run_attempt) === PAID_ENCAR_REPAIR_SNAPSHOT.attempt
    && value?.head_sha === PAID_ENCAR_REPAIR_SNAPSHOT.producerSha && value?.status === 'completed', 'paid_repair_producer_mismatch');
  // A downstream job may have failed after collection. The saved complete
  // receipt and every page/count are verified independently below.
  return {runId: String(value.id), attempt: String(value.run_attempt), producerSha: value.head_sha,
    status: value.status, conclusion: String(value.conclusion || '')};
}
export function assertPaidRepairLeaseFree(lock, now = Date.now()) {
  if (lock === null || lock === undefined) return;
  assert.equal(typeof lock.lockedUntil, 'string', 'paid_repair_import_lock_invalid');
  if (lock.lockedUntil === '') return;
  const until = Date.parse(lock.lockedUntil);
  assert.ok(Number.isFinite(until), 'paid_repair_import_lock_invalid');
  assert.ok(until <= now, 'paid_repair_import_lock_busy');
}
export function assertPaidRepairSavedSnapshot(snapshot, now = Date.now()) {
  // The pinned legacy source has 10,270 pages and 205,385 observations.
  // Keep a bounded reader without applying the old 10,000-page assumption.
  assert.ok(Number.isSafeInteger(snapshot?.pages) && snapshot.pages > 0 && snapshot.pages <= 20000
    && Number.isSafeInteger(snapshot?.count) && snapshot.count > 0 && snapshot.count <= 1000000
    && Number.isFinite(Date.parse(snapshot.completedAt)) && Date.parse(snapshot.completedAt) <= now, 'paid_repair_saved_snapshot_invalid');
}
async function* savedPageBatches(storage, pages, withReceipts) {
  for (let start = 1; start <= pages; start += 4) {
    const batch = await Promise.all(Array.from({length:Math.min(4,pages-start+1)}, async (_,offset) => {
      const page = start + offset;
      const values = await storage.readJson(snapshotRoot + `/pages/${page}.json`, null);
      const receipt = withReceipts ? await storage.readJson(snapshotRoot + `/page-receipts/${page}.json`, null) : null;
      return {page,values,receipt};
    }));
    // Hashing, receipt chain verification and mapping remain in page order.
    // At most four raw pages and four active GETs are retained at once.
    for (const item of batch) yield item;
  }
}

/** Read only the pinned saved snapshot. The mapper cannot add identities absent
 * from the current published set. No supplier client or collection is called. */
export async function loadPaidRepairPlan({storage, normalize, verifyPages, isNonCash, producer, liveIdentity,
  sourceSha, controllerSha, now = Date.now(), onSourceRoot = async () => {}}) {
  const execution = assertPaidRepairProducer(producer);
  const manifestMeta = await storage.readJsonWithMeta('catalog/manifest.json', null);
  const protectedObjects = Object.fromEntries(await Promise.all(PAID_ENCAR_REPAIR_PROTECTED_KEYS.map(async key =>
    [key, await storage.readJsonWithMeta(key, null)])));
  const editorial = protectedObjects['catalog-editorial/current.json'].value;
  const currentRows = await readPaidRepairCurrent(storage, manifestMeta.value);
  const wanted = new Map(currentRows.map(row => [String(row.sourceOfferId), row.id]));
  const sourceById = new Map(), rowDigests = new Map(), references = [{kind:'encar-snapshot', root:snapshotRoot}];
  await onSourceRoot(references[0]);
  const snapshotMeta = await storage.readJsonWithMeta(snapshotRoot + '/complete.json', null), snapshot = snapshotMeta.value;
  assert.ok(snapshotMeta.found, 'paid_repair_saved_snapshot_missing');
  assertPaidRepairSavedSnapshot(snapshot, now);
  const verifier = verifyPages(snapshot, {runId:PAID_ENCAR_REPAIR_SNAPSHOT.runId, attempt:PAID_ENCAR_REPAIR_SNAPSHOT.attempt,
    headSha:PAID_ENCAR_REPAIR_SNAPSHOT.producerSha, now});
  let rows = 0, matched = 0, excluded = 0;
  const pageHash = createHash('sha256');
  for await (const {page,values,receipt} of savedPageBatches(storage,snapshot.pages,Boolean(verifier))) {
    assert.ok(Array.isArray(values) && values.length <= 10000 && (values.length || page === snapshot.pages), 'paid_repair_saved_page_missing');
    if (verifier) verifier.verify(page, values, receipt);
    pageHash.update(JSON.stringify([page, paidRepairDigest(values)]));
    for (const raw of values) {
      rows++;
      const id = String(raw?.inner_id), data = raw?.data;
      assert.ok(/^\d+$/.test(id) && String(data?.inner_id) === id, 'paid_repair_saved_identity');
      if (!wanted.has(id)) continue;
      const digest = paidRepairDigest(data);
      if (rowDigests.has(id)) {assert.equal(rowDigests.get(id), digest, 'paid_repair_saved_revision_conflict'); continue;}
      rowDigests.set(id, digest);
      if (data.advertisement_type !== 'Продажа' || data.sales_status !== 'Доступно' || isNonCash(data)
        || Number(data.price) <= 0 || data.is_duplicate === true) {excluded++; continue;}
      assert.ok(data.currency === 'KRW' && Number.isSafeInteger(Number(data.price)), 'paid_repair_saved_currency_invalid');
      const offer = normalize(data, {id, observedAt:snapshot.completedAt});
      assert.ok(offer && offer.id === wanted.get(id), 'paid_repair_normalized_identity');
      sourceById.set(offer.id, offer); matched++;
    }
  }
  verifier?.finish();
  assert.equal(rows, snapshot.count, 'paid_repair_saved_count_mismatch');
  const reportRoots = new Map();
  for (const row of currentRows) {
    const observed = row.operational?.lastSeenAt || row.updatedAt || row.operational?.sourcePublishedAt || row.firstSeenAt;
    const time = Date.parse(observed);
    assert.ok(Number.isSafeInteger(time) && time > 0, 'paid_repair_report_observation_missing');
    const root = `catalog/paid-encar-reports/v1/${time}`;
    if (!reportRoots.has(root)) {
      assert.ok(reportRoots.size < 1024, 'paid_repair_report_root_limit');
      const report = await storage.readJson(root + '/complete.json', null);
      assert.ok(report?.version === 1 && report.provider === 'auto_api_encar' && report.observedAtMs === time
        && Date.parse(report.observedAt) === time && /^\d+$/.test(report.sourceRunId)
        && /^[1-9]\d*$/.test(report.sourceRunAttempt), 'paid_repair_current_report_missing');
      reportRoots.set(root, {root, sha256:paidRepairDigest(report), report});
      const refs = [{kind:'encar-reports', root},
        {kind:'encar-snapshot', root:`catalog/intake-staging/encar/${report.sourceRunId}/${report.sourceRunAttempt}`}];
      for (const ref of refs) {references.push(ref); await onSourceRoot(ref);}
    }
    const {report} = reportRoots.get(root), explicit = row.operational?.paidEncarReportSnapshot;
    if (explicit) assert.ok(explicit.run === report.sourceRunId && explicit.attempt === report.sourceRunAttempt
      && Date.parse(explicit.observedAt) === time, 'paid_repair_current_report_identity');
  }
  const sourceProof = {identity:PAID_ENCAR_REPAIR_SNAPSHOT, execution, snapshotSha256:paidRepairDigest(snapshot),
    snapshotRevision:paidRepairObjectRevision(snapshotMeta), pagesSha256:pageHash.digest('hex'), rows, pages:snapshot.pages,
    observedAt:snapshot.completedAt, matched, excluded,
    reportRoots:[...reportRoots.values()].map(({root, sha256}) => ({root, sha256})).sort((a,b) => a.root.localeCompare(b.root))};
  const result = buildPaidEncarTechnicalRepair({currentRows, sourceById, sourceProof, manifestMeta, protectedObjects,
    editorial, liveIdentity, sourceSha, controllerSha, now});
  return {...result, editorial, references};
}

export async function createPaidRepairPublicationGuard({storage, receipt, expectedSha256,
  readIdentity = readLiveBudgetIdentity, now = Date.now}) {
  const core = assertPaidRepairReceipt(receipt);
  assert.equal(receipt.sha256, expectedSha256, 'paid_repair_unapproved_plan');
  let editorial;
  async function verifyAuthority({operationId, publishedGenerationId} = {}) {
    const actual = await storage.readJsonWithMeta('catalog/manifest.json', null);
    if (publishedGenerationId) assert.equal(actual.value?.generationId, publishedGenerationId, 'paid_repair_published_generation_changed');
    else assert.ok(same(paidRepairObjectRevision(actual), core.manifest), 'paid_repair_manifest_changed');
    assert.ok(same(await readIdentity(), core.liveIdentity), 'paid_repair_live_runtime_changed');
    assert.equal(new Date(now()).toISOString().slice(0,10), core.utcDay, 'paid_repair_day_changed');
    assert.equal(new Date(now() + 7 * 3600000).toISOString().slice(0,10), core.policyDay, 'paid_repair_policy_day_changed');
    for (const key of PAID_ENCAR_REPAIR_PROTECTED_KEYS) {
      const meta = await storage.readJsonWithMeta(key, null);
      assert.ok(same(paidRepairObjectRevision(meta), core.protectedObjects[key]), 'paid_repair_protected_object_changed');
      if (key === 'catalog-editorial/current.json') editorial = meta.value;
    }
    const saved = await storage.readJsonWithMeta(snapshotRoot + '/complete.json', null);
    assert.ok(same(paidRepairObjectRevision(saved), core.sourceProof.snapshotRevision), 'paid_repair_saved_snapshot_changed');
    if (operationId) {
      const lock = await storage.readJson('catalog/import-lock.json', null);
      assert.ok(lock?.operationId === operationId && Date.parse(lock.lockedUntil) > now(), 'paid_repair_lease_lost');
    }
    return actual.value;
  }
  await verifyAuthority();
  const examples = rows => (core.examples || []).map(example => ({...example,
    after:paidRepairExampleFields(rows.find(row => row.id === example.id))}));
  return {
    verifyAuthority,
    examples,
    assertInput(rows) {return assertPaidRepairPublicationRows(receipt, rows, editorial, {input:true});},
    assertCurrent(rows) {assert.equal(paidRepairRowsProof(rows, editorial).rowsSha256, core.before.rowsSha256, 'paid_repair_current_rows_changed');},
    assertRows(rows) {return assertPaidRepairPublicationRows(receipt, rows, editorial);},
    async verifyPublished(generationId, operationId) {
      const manifest = await verifyAuthority({publishedGenerationId:generationId, operationId});
      const rows = await readPaidRepairCurrent(storage, manifest);
      const proof = assertPaidRepairPublicationRows(receipt, rows, editorial), byId = new Map(rows.map(row => [row.id,row]));
      const derivedPriceChanges = Object.fromEntries(['totalRub','sellerPriceRub'].map(field =>
        [field, core.records.filter(record => (record.beforeQuote?.[field] ?? null) !== (byId.get(record.id)?.[field] ?? null)).length]));
      return {receiptSha256:receipt.sha256, sourceIdentity:core.sourceProof.identity, generationId, before:core.before,
        after:proof, outcomes:core.outcomes, examples:examples(rows), derivedPriceChanges, verified:true, sourceCalls:0, cursorChanged:false};
    },
  };
}

/** Fail closed before imports: S3, health and official FX are the only network
 * authorities. Planning has no PUT; publication cannot mutate source/CRM/cursor. */
export function installPaidRepairNetworkFence({endpoint, bucket, prefix, allowWrites, fetchImpl = globalThis.fetch}) {
  const origin = new URL(endpoint).origin;
  const base = `/${bucket}/${String(prefix || '').replace(/^\/+|\/+$/g, '')}/`;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = String(options?.method || input?.method || 'GET').toUpperCase();
    const stored = url.origin === origin && url.pathname.startsWith(base);
    const key = stored ? decodeURIComponent(url.pathname.slice(base.length)) : '';
    const read = stored && ['GET','HEAD'].includes(method);
    const protectedWrite = /^(?:catalog-editorial\/|catalog\/intake-cursors\/|catalog\/operations\/|catalog\/intake-staging\/|catalog\/paid-encar-reports\/|integrations\/|fees\/|business-settings)/.test(key);
    const write = stored && key.startsWith('catalog/') && allowWrites && method === 'PUT' && !protectedWrite;
    // Keep the existing full-bucket reserve preflight, which reads metadata
    // only. It neither reads provider URLs nor deletes any stored object.
    const inventory = allowWrites && url.origin === origin && url.pathname === `/${bucket}` && method === 'GET'
      && url.searchParams.get('list-type') === '2' && url.searchParams.get('max-keys') === '1000';
    const health = url.origin === 'https://avtocena.com' && url.pathname === '/api/health' && !url.search && method === 'GET';
    const rate = url.origin === 'https://www.cbr.ru' && url.pathname === '/scripts/XML_daily.asp' && method === 'GET';
    assert.ok(read || write || inventory || health || rate, 'paid_repair_external_request_forbidden');
    return fetchImpl(input, {...options, redirect:'error'});
  };
}
