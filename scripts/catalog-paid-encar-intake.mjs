import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openRawFeedPin,readRawRootHandoff,writeRawRootHandoff} from './lib/catalog-raw-provenance.mjs';
import {autoApiChe168Client, autoApiPage} from './lib/auto-api-che168-client.mjs';
import {catalogRefreshDue} from './lib/catalog-refresh-schedule.mjs';

const integerText = value => typeof value === 'string' && /^[1-9]\d*$/.test(value)
  && Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
const MAX_PAGES = 100000;
const SNAPSHOT_LIFETIME_MS = 3 * 86400000;
export const PAID_ENCAR_PAUSE_MARGIN_MS = 180000;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A failed downstream job keeps the producer scope from the successful plan job. */
export function paidEncarSnapshotScope({runId, runAttempt, snapshotRun, snapshotAttempt, headSha}) {
  assert.ok(integerText(runId) && integerText(runAttempt)
    && integerText(snapshotRun) && integerText(snapshotAttempt), 'paid_encar_snapshot_identity_invalid');
  assert.equal(snapshotRun, runId, 'paid_encar_snapshot_foreign_run');
  assert.ok(Number(snapshotAttempt) <= Number(runAttempt), 'paid_encar_snapshot_future_attempt');
  assert.match(headSha || '', /^[a-f0-9]{40}$/, 'paid_encar_snapshot_source_invalid');
  return {runId: snapshotRun, attempt: snapshotAttempt, headSha};
}

/** Recheck owner switches before each HTTP attempt, including client retries. */
export function paidEncarRequest({apiKey, assertEnabled, fetchImpl = fetch, sleep,
  deadline = Infinity, requestDelayMs = 200}) {
  assert.equal(typeof assertEnabled, 'function', 'paid_encar_source_guard_required');
  const request = autoApiChe168Client({platform: 'encar', apiKey, sleep, deadline, requestDelayMs,
    fetchImpl: async (input, options) => {
      await assertEnabled();
      return fetchImpl(input, options);
    },
  });
  return async (endpoint, params) => {
    assert.equal(endpoint, 'offers', 'paid_encar_request_endpoint_invalid');
    return request('offers', params);
  };
}

export function paidEncarRefreshDecision({eventName, controls, policy, marker = {}, now = new Date()}) {
  assert.ok(['schedule', 'workflow_dispatch', 'push'].includes(eventName), 'paid_encar_refresh_event_invalid');
  if (eventName === 'push') {
    assert.ok(!marker.market || marker.market === 'korea', 'paid_encar_refresh_market_invalid');
    assert.ok(!marker.reuseRunId && !marker.autohomeReuseRunId && !marker.recoverPaidSnapshot
      && (!marker.refreshMarkets || marker.refreshMarkets.length === 0), 'paid_encar_refresh_legacy_reuse_forbidden');
    assert.ok(!marker.publishMarkets || (Array.isArray(marker.publishMarkets)
      && marker.publishMarkets.length === 1 && marker.publishMarkets[0] === 'korea'), 'paid_encar_refresh_market_invalid');
  }
  if (policy?.pausedMarkets?.korea) return {run: false, reason: 'market_paused'};
  if (controls?.markets?.korea?.enabled !== true) return {run: false, reason: 'market_disabled'};
  if (controls?.sources?.encar_feed?.enabled !== true) return {run: false, reason: 'paid_source_disabled'};
  if (eventName === 'schedule' && !catalogRefreshDue(now)) return {run: false, reason: 'cadence_not_due'};
  return {run: true, reason: 'paid_source_due'};
}

export function assertPaidEncarSnapshotReceipt(receipt, {runId, attempt, headSha, now = Date.now()}) {
  assert.ok(integerText(runId) && integerText(attempt), 'paid_encar_snapshot_identity_invalid');
  assert.match(headSha || '', /^[a-f0-9]{40}$/, 'paid_encar_snapshot_source_invalid');
  assert.equal(receipt?.version, 1, 'paid_encar_snapshot_receipt_invalid');
  assert.equal(receipt?.market, 'korea', 'paid_encar_snapshot_receipt_market');
  assert.equal(receipt?.provider, 'auto_api_encar', 'paid_encar_snapshot_receipt_provider');
  assert.equal(receipt?.runId, runId, 'paid_encar_snapshot_receipt_run');
  assert.equal(receipt?.attempt, attempt, 'paid_encar_snapshot_receipt_attempt');
  assert.equal(receipt?.producerSha, headSha, 'paid_encar_snapshot_receipt_source');
  assert.ok(Number.isSafeInteger(receipt.pages) && receipt.pages > 0 && receipt.pages <= MAX_PAGES
    && Number.isSafeInteger(receipt.count) && receipt.count > 0, 'paid_encar_snapshot_receipt_count');
  const age = now - Date.parse(receipt.completedAt);
  // A delayed retry must not republish a snapshot older than the existing cadence.
  assert.ok(Number.isFinite(age) && age >= 0 && age <= SNAPSHOT_LIFETIME_MS, 'paid_encar_snapshot_receipt_stale');
  return receipt;
}

function assertIdentity(value, identity) {
  for (const [key, expected] of Object.entries(identity)) assert.equal(value?.[key], expected, 'paid_encar_snapshot_saved_identity:' + key);
}

/** Verify new snapshots during the restorer's existing raw-page pass. */
export function paidEncarSavedPageVerifier(snapshot, context) {
  // The original saved intake has only pages/count/completedAt. A partial or
  // malformed new envelope must not silently fall back to that legacy format.
  const envelope = ['version', 'market', 'provider', 'runId', 'attempt', 'producerSha'];
  if (!envelope.some(key => Object.hasOwn(snapshot, key))) return null;
  assertPaidEncarSnapshotReceipt(snapshot, context);
  const identity = {version: 1, market: 'korea', provider: 'auto_api_encar',
    runId: context.runId, attempt: context.attempt, producerSha: context.headSha};
  let nextPage = 1, count = 0, previousSha256 = null, startedAt;
  return {
    verify(page, rows, receipt) {
      assert.equal(page, nextPage, 'paid_encar_snapshot_saved_page_sequence');
      assertIdentity(receipt, identity);
      assert.equal(receipt.page, page, 'paid_encar_snapshot_saved_page_sequence');
      assert.equal(receipt.next, page < snapshot.pages ? page + 1 : null, 'paid_encar_snapshot_saved_next');
      assert.equal(receipt.previousSha256, previousSha256, 'paid_encar_snapshot_receipt_chain');
      assert.ok(Number.isSafeInteger(receipt.count) && receipt.count >= 0
        && Array.isArray(rows) && rows.length === receipt.count
        && (page === snapshot.pages || rows.length > 0), 'paid_encar_snapshot_saved_count');
      assert.match(receipt.sha256 || '', /^[a-f0-9]{64}$/, 'paid_encar_snapshot_saved_digest');
      assert.equal(digest(rows), receipt.sha256, 'paid_encar_snapshot_saved_page_digest');
      assert.ok(Number.isFinite(Date.parse(receipt.startedAt))
        && Date.parse(receipt.startedAt) <= Date.parse(snapshot.completedAt), 'paid_encar_snapshot_started_mismatch');
      if (startedAt === undefined) startedAt = receipt.startedAt;
      assert.equal(receipt.startedAt, startedAt, 'paid_encar_snapshot_started_mismatch');
      count += rows.length;
      assert.ok(Number.isSafeInteger(count), 'paid_encar_snapshot_count_invalid');
      assert.equal(receipt.totalCount, count, 'paid_encar_snapshot_saved_total');
      if (page === snapshot.pages) assert.equal(count, snapshot.count, 'paid_encar_snapshot_saved_total');
      previousSha256 = digest(receipt);
      nextPage++;
    },
    finish() {
      assert.equal(nextPage, snapshot.pages + 1, 'paid_encar_snapshot_saved_page_sequence');
      assert.equal(count, snapshot.count, 'paid_encar_snapshot_saved_total');
    },
  };
}

function numberedKeys(objects, directory) {
  assert.ok(Array.isArray(objects) && objects.length <= MAX_PAGES, 'paid_encar_snapshot_saved_index_invalid');
  const result = new Map();
  for (const entry of objects) {
    assert.ok(typeof entry?.key === 'string' && entry.key.startsWith(directory + '/'), 'paid_encar_snapshot_saved_key_invalid');
    const name = entry.key.slice(directory.length + 1), match = /^([1-9]\d*)\.json$/.exec(name);
    assert.ok(match && integerText(match[1]) && Number(match[1]) <= MAX_PAGES, 'paid_encar_snapshot_saved_key_invalid');
    const page = Number(match[1]);
    assert.ok(!result.has(page), 'paid_encar_snapshot_saved_page_duplicate');
    result.set(page, entry.key);
  }
  return result;
}

async function readReceipts(storage, keys) {
  const result = Array(keys.length);
  let cursor = 0, failure;
  await Promise.all(Array.from({length: Math.min(4, keys.length)}, async () => {
    while (!failure) {
      const index = cursor++;
      if (index >= keys.length) return;
      try { result[index] = await storage.readJson(keys[index], null); }
      catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  return result;
}

async function createOnly(storage, key, value) {
  try { await storage.writeJson(key, value, {ifNoneMatch: '*'}); }
  catch (error) {
    // An acknowledged write can lose its response. Only identical stored JSON
    // may be reused; a conflict never authorizes overwriting a previous page.
    const saved = await storage.readJson(key, null);
    if (saved === null) throw error;
    assert.equal(digest(saved), digest(value), 'paid_encar_snapshot_create_conflict');
  }
}

export async function collectPaidEncarSnapshot({storage, request, assertEnabled, runId, attempt, headSha,
  now = () => new Date().toISOString(), clock = Date.now, deadline = Infinity,
  allowPartial = false, progress = () => {}}) {
  assert.ok(integerText(runId) && integerText(attempt), 'paid_encar_snapshot_identity_invalid');
  assert.match(headSha || '', /^[a-f0-9]{40}$/, 'paid_encar_snapshot_source_invalid');
  assert.equal(storage.driver, 'object', 'paid_encar_object_storage_required');
  assert.equal(typeof storage.listObjects, 'function', 'paid_encar_snapshot_listing_required');
  assert.ok(deadline === Infinity || Number.isSafeInteger(deadline), 'paid_encar_intake_deadline_invalid');
  assert.equal(typeof allowPartial, 'boolean', 'paid_encar_partial_mode_invalid');
  await assertEnabled();
  const prefix = `catalog/intake-staging/encar/${runId}/${attempt}`;
  const identity = {version: 1, market: 'korea', provider: 'auto_api_encar', runId, attempt, producerSha: headSha};
  const complete = await storage.readJson(`${prefix}/complete.json`, null);
  if (complete !== null) return assertPaidEncarSnapshotReceipt(complete, {runId, attempt, headSha, now: clock()});
  const [savedStart, pageObjects, receiptObjects] = await Promise.all([
    storage.readJson(`${prefix}/start.json`, null),
    storage.listObjects(`${prefix}/pages/`), storage.listObjects(`${prefix}/page-receipts/`),
  ]);
  const pageKeys = numberedKeys(pageObjects, `${prefix}/pages`);
  const receiptKeys = numberedKeys(receiptObjects, `${prefix}/page-receipts`);
  const numbers = [...receiptKeys.keys()].sort((a, b) => a - b);
  // A crash after a raw-page write but before its receipt loses the authoritative
  // next_page. Do not re-fetch that page, guess the cursor, or publish partial data.
  assert.ok(pageKeys.size === receiptKeys.size && numbers.every((page, index) => page === index + 1 && pageKeys.has(page)), 'paid_encar_snapshot_partial_pair');
  assert.ok(savedStart !== null || numbers.length === 0, 'paid_encar_snapshot_start_missing');
  const start = savedStart || {...identity, startedAt: now()};
  assertIdentity(start, identity);
  const startAge = clock() - Date.parse(start.startedAt);
  assert.ok(Number.isFinite(startAge) && startAge >= 0 && startAge <= SNAPSHOT_LIFETIME_MS, 'paid_encar_snapshot_started_stale');
  if (!savedStart) await createOnly(storage, `${prefix}/start.json`, start);
  const receipts = await readReceipts(storage, numbers.map(page => receiptKeys.get(page)));
  let page = 1, count = 0, pages = 0, previousSha256 = null;
  for (const saved of receipts) {
    assertIdentity(saved, identity);
    assert.equal(saved.startedAt, start.startedAt, 'paid_encar_snapshot_started_mismatch');
    assert.equal(saved.page, page, 'paid_encar_snapshot_saved_page_sequence');
    assert.equal(saved.previousSha256, previousSha256, 'paid_encar_snapshot_receipt_chain');
    assert.ok(Number.isSafeInteger(saved.count) && saved.count >= 0, 'paid_encar_snapshot_saved_count');
    assert.ok(saved.next === null || saved.next === page + 1 && saved.count > 0 && saved.next <= MAX_PAGES, 'paid_encar_snapshot_saved_next');
    assert.match(saved.sha256 || '', /^[a-f0-9]{64}$/, 'paid_encar_snapshot_saved_digest');
    count += saved.count; pages++;
    assert.ok(Number.isSafeInteger(count), 'paid_encar_snapshot_count_invalid');
    assert.equal(saved.totalCount, count, 'paid_encar_snapshot_saved_total');
    previousSha256 = digest(saved);
    page = saved.next;
  }
  if (pages) {
    const lastRows = await storage.readJson(pageKeys.get(pages), null);
    assert.ok(Array.isArray(lastRows) && lastRows.length === receipts.at(-1).count, 'paid_encar_snapshot_saved_page_missing');
    assert.equal(digest(lastRows), receipts.at(-1).sha256, 'paid_encar_snapshot_saved_page_digest');
    progress({stage: 'resumed', pages, count, nextPage: page});
  }
  while (page !== null) {
    // This deliberate boundary is the only successful pause. Provider quota,
    // Retry-After, transport, storage and owner-switch failures still fail the job.
    if (clock() + PAID_ENCAR_PAUSE_MARGIN_MS >= deadline) {
      assert.ok(allowPartial, 'paid_encar_snapshot_incomplete_time_budget');
      return {...identity, startedAt: start.startedAt, completed: false, pages, count, nextPage: page};
    }
    assert.ok(page <= MAX_PAGES, 'paid_encar_snapshot_page_limit');
    await assertEnabled();
    if (clock() + PAID_ENCAR_PAUSE_MARGIN_MS >= deadline) {
      assert.ok(allowPartial, 'paid_encar_snapshot_incomplete_time_budget');
      return {...identity, startedAt: start.startedAt, completed: false, pages, count, nextPage: page};
    }
    const {items, next} = autoApiPage(await request('offers', {page}), page);
    assert.ok(items.every(row => row?.inner_id && row?.data), 'paid_encar_offer_envelope_invalid');
    assert.ok(next === null || next === page + 1 && next <= MAX_PAGES, 'paid_encar_snapshot_page_sequence_invalid');
    await createOnly(storage, `${prefix}/pages/${page}.json`, items);
    count += items.length; pages++;
    assert.ok(Number.isSafeInteger(count) && Number.isSafeInteger(pages), 'paid_encar_snapshot_count_invalid');
    const receipt = {...identity, startedAt: start.startedAt, page, next, count: items.length, totalCount: count,
      sha256: digest(items), previousSha256};
    await createOnly(storage, `${prefix}/page-receipts/${page}.json`, receipt);
    previousSha256 = digest(receipt);
    page = next;
    if (pages % 100 === 0) progress({pages, count});
  }
  assert.ok(count > 0, 'paid_encar_snapshot_empty');
  await assertEnabled();
  const completedAt = now();
  assert.ok(Number.isFinite(Date.parse(completedAt)) && Date.parse(completedAt) >= Date.parse(start.startedAt), 'paid_encar_snapshot_timestamp_invalid');
  const receipt = {...identity, pages, count, completedAt};
  await createOnly(storage, `${prefix}/complete.json`, receipt);
  assert.deepEqual(await storage.readJson(`${prefix}/complete.json`, null), receipt, 'paid_encar_snapshot_readback_mismatch');
  return receipt;
}

async function main() {
  const {getJsonStorage} = await import('../apps/web/lib/data.ts');
  const {readCollectionControls} = await import('../apps/web/lib/catalog/collection-controls.ts');
  const {collectionEnabled} = await import('../apps/web/lib/catalog/collection-controls-schema.ts');
  const storage = getJsonStorage();
  const policy = JSON.parse(await fs.readFile('data/catalog/refresh-policy-v1.json', 'utf8'));
  const assertEnabled = async () => {
    assert.ok(!policy.pausedMarkets?.korea, 'paid_encar_refresh_market_paused');
    assert.ok(collectionEnabled(await readCollectionControls(storage), 'encar_feed'), 'paid_encar_refresh_disabled_by_owner');
  };
  await assertEnabled();
  const budget = Number(process.env.CATALOG_INTAKE_TIME_MS || 18000000);
  assert.ok(Number.isSafeInteger(budget) && budget > 0 && budget <= 18000000, 'paid_encar_intake_budget_invalid');
  assert.ok(['true', 'false'].includes(process.env.ENCAR_ALLOW_PARTIAL || 'false'), 'paid_encar_partial_mode_invalid');
  const scope = paidEncarSnapshotScope({runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    snapshotRun: process.env.ENCAR_SNAPSHOT_RUN || process.env.GITHUB_RUN_ID,
    snapshotAttempt: process.env.ENCAR_SNAPSHOT_ATTEMPT || process.env.GITHUB_RUN_ATTEMPT, headSha: process.env.GITHUB_SHA});
  const deadline = Date.now() + budget;
  const root=`catalog/intake-staging/encar/${scope.runId}/${scope.attempt}`;
  const saved=await storage.readJson(root+'/complete.json',null);
  const existing=saved?await readRawRootHandoff(storage,root,saved):null;
  const pin=existing?null:await openRawFeedPin({storage,operationId:`encar-source-${scope.runId}-${scope.attempt}`,
    owner:{runId:scope.runId,attempt:scope.attempt,revision:scope.headSha},references:[{kind:'encar-snapshot',root}]});
  if(!saved)await pin.add([]);
  const request = paidEncarRequest({apiKey: process.env.ACCOUNT_KEY, assertEnabled,
    requestDelayMs: 200, deadline});
  const collect = scopedStorage => collectPaidEncarSnapshot({storage:scopedStorage, request, assertEnabled, ...scope, deadline,
    allowPartial: process.env.ENCAR_ALLOW_PARTIAL === 'true',
    progress: value => console.log(JSON.stringify(value))});
  const {withRawReadProtection} = await import('./lib/catalog-raw-session.mjs');
  const receipt = existing ? await withRawReadProtection({storage,
    owner:{runId:scope.runId,attempt:scope.attempt,revision:scope.headSha},
    references:[{kind:'encar-snapshot',root}],read:collect}) : await collect(pin.storage);
  if(receipt.completed!==false){
    const handoff=existing||await writeRawRootHandoff(storage,root,receipt,await pin.handoff());
    receipt.rawStoragePins=[handoff];
  }
  await fs.writeFile('paid-encar-snapshot-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,
    `snapshot_run=${receipt.runId}\nsnapshot_attempt=${receipt.attempt}\nsnapshot_complete=${receipt.completed !== false}\n`);
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const message = String(error?.message || '');
    console.error(JSON.stringify({stage: 'paid_encar_intake_failed',
      reason: /^[a-z0-9_:]+$/.test(message) ? message : 'paid_encar_intake_failed'}));
    process.exitCode = 1;
  });
}
