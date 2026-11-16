import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {normalizePaidEncarOffer} from '../scripts/lib/paid-encar-offer.mjs';
import {paidEncarRequest, paidEncarRefreshDecision, collectPaidEncarSnapshot,
  assertPaidEncarSnapshotReceipt, paidEncarSnapshotScope, paidEncarSavedPageVerifier,
  PAID_ENCAR_PAUSE_MARGIN_MS} from '../scripts/catalog-paid-encar-intake.mjs';
import {openRawFeedPin,rawProducerOwner,readRawRootHandoff,RAW_PIN_PREFIX} from '../scripts/lib/catalog-raw-provenance.mjs';

const identity = {runId: '43812759975', attempt: '1', headSha: '1bb70becbf556359697ebc93cd1e8efa2a8120ed'};
const completedAt = '2026-11-16T17:05:00.000Z';
const controls = () => ({markets: {korea: {enabled: true}}, sources: {encar_feed: {enabled: true}}});
const page = (number, rows, next) => ({result: rows, meta: {page: number, next_page: next}});
const offer = id => ({inner_id: id, data: {inner_id: id, price: 10000000}});
const prefix = (value = identity) => `catalog/intake-staging/encar/${value.runId}/${value.attempt}`;

function fixture() {
  const values = new Map(), events = [];
  const storage = {
    driver: 'object',
    async readJson(key, fallback) {
      events.push({kind: 'read', key});
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async listObjects(directory) {
      events.push({kind: 'list', directory});
      return [...values.keys()].filter(key => key.startsWith(directory)).map(key => ({key}));
    },
    async readJsonWithMeta(key, fallback) {
      const value=await this.readJson(key,fallback);
      return values.has(key)?{found:true,value,etag:createHash('sha256').update(JSON.stringify(value)).digest('hex')}:{found:false,value};
    },
    async writeJson(key, value, condition) {
      events.push({kind: 'write', key, condition});
      if(key.startsWith(RAW_PIN_PREFIX)){
        const previous=values.get(key),etag=previous&&createHash('sha256').update(JSON.stringify(previous)).digest('hex');
        if(condition?.ifNoneMatch==='*'&&previous||condition?.ifMatch&&condition.ifMatch!==etag){const error=Error('conflict');error.name='StorageConflictError';throw error;}
        assert.ok(condition?.ifNoneMatch==='*'||condition?.ifMatch);
        values.set(key,structuredClone(value));return;
      }
      assert.deepEqual(condition, {ifNoneMatch: '*'}, 'saved intake must always use create-only writes');
      if (values.has(key)) throw Error('fixture_create_conflict');
      values.set(key, structuredClone(value));
    },
  };
  return {values, events, storage};
}

function options(f, overrides = {}) {
  return {storage: f.storage, ...identity, now: () => completedAt, clock: () => Date.parse(completedAt),
    assertEnabled: async () => {f.events.push({kind: 'crm'});},
    request: async (endpoint, params) => {
      f.events.push({kind: 'api', endpoint, params});
      return page(1, [offer('1001')], null);
    }, ...overrides};
}

// Execute the actual restorer with offline storage and normalization spies. Its
// paid report preparation and report.json ordering remain part of this fixture.
const restorerBody = readFileSync(new URL('../scripts/catalog-restore-encar-snapshot.mjs', import.meta.url), 'utf8')
  .split('\n').filter(line => !line.startsWith('import ')).join('\n');
const AsyncRestorer = Object.getPrototypeOf(async function () {}).constructor;
const restorer = new AsyncRestorer('fs', 'path', 'getJsonStorage', 'EncarDirectAdapter',
  'isEncarNonCashContract', 'observationShardWriter', 'preparePaidEncarReports',
  'paidEncarSavedPageVerifier', 'openRawFeedPin','rawProducerOwner','readRawRootHandoff',
  'normalizePaidEncarOffer', 'process', 'console', restorerBody);

async function restoreFixture(f) {
  const env={ENCAR_SNAPSHOT_RUN:identity.runId,ENCAR_SNAPSHOT_ATTEMPT:identity.attempt,GITHUB_SHA:identity.headSha,
    GITHUB_RUN_ID:identity.runId,GITHUB_RUN_ATTEMPT:String(f.restoreAttempt=(f.restoreAttempt||0)+1)};
  const fs = {mkdir: async () => {}, readdir: async () => [], writeFile: async (_file, text) => {
    f.events.push({kind: 'intake-report', report: JSON.parse(text)});
  }};
  class Adapter {
    sourceId = 'encar_feed_fixture';
    normalizeOffer(input) {f.events.push({kind: 'normalize', id: input.Id}); return {id: input.Id, operational: {}};}
  }
  return restorer(fs, path, () => f.storage, Adapter, () => false,
    () => async row => {f.events.push({kind: 'observation', row});},
    async () => {f.events.push({kind: 'prepare-reports'});return {rawStoragePins:[]};},
    (snapshot, context) => paidEncarSavedPageVerifier(snapshot, {...context, now: Date.parse(completedAt)}),
    openRawFeedPin,()=>rawProducerOwner(env),readRawRootHandoff,normalizePaidEncarOffer,{env},
    {log() {}});
}

async function restorableSnapshot() {
  const f = fixture();
  await collectPaidEncarSnapshot(options(f, {request: async (_endpoint, params) => {
    const row = offer(String(1000 + params.page));
    Object.assign(row.data, {advertisement_type: 'Продажа', sales_status: 'Доступно', currency: 'KRW', year: 2024});
    return page(params.page, [row], params.page === 1 ? 2 : null);
  }}));
  f.events.length = 0;
  return f;
}

test('paid scheduler preserves the existing November 16/19 three-day calendar', () => {
  for (const [day, due] of [[16, true], [17, false], [18, false], [19, true]]) {
    const decision = paidEncarRefreshDecision({eventName: 'schedule', controls: controls(),
      policy: {pausedMarkets: {}}, now: new Date(`2026-11-${day}T17:00:00Z`)});
    assert.deepEqual(decision, {run: due, reason: due ? 'paid_source_due' : 'cadence_not_due'});
  }
});

test('manual and marker runs bypass cadence but never market, paid-source or policy switches', () => {
  const now = new Date('2026-11-17T17:00:00Z');
  for (const eventName of ['workflow_dispatch', 'push']) {
    assert.deepEqual(paidEncarRefreshDecision({eventName, controls: controls(), policy: {}, now}),
      {run: true, reason: 'paid_source_due'});
  }
  for (const eventName of ['schedule', 'workflow_dispatch', 'push']) {
    const marketOff = controls(); marketOff.markets.korea.enabled = false;
    const sourceOff = controls(); sourceOff.sources.encar_feed.enabled = false;
    for (const [current, policy, reason] of [
      [marketOff, {}, 'market_disabled'], [sourceOff, {}, 'paid_source_disabled'],
      [controls(), {pausedMarkets: {korea: 'owner pause'}}, 'market_paused'],
    ]) {
      assert.deepEqual(paidEncarRefreshDecision({eventName, controls: current, policy, now}), {run: false, reason});
    }
  }
});

test('marker requests cannot reuse legacy intake or publish another market', () => {
  for (const marker of [{reuseRunId: '43600759493'}, {autohomeReuseRunId: '37907216966'},
    {recoverPaidSnapshot: true}, {refreshMarkets: ['korea']}, {market: 'china'},
    {publishMarkets: ['china']}, {publishMarkets: ['korea', 'china']}]) {
    assert.throws(() => paidEncarRefreshDecision({eventName: 'push', controls: controls(), policy: {}, marker}),
      /paid_encar_refresh_(legacy_reuse_forbidden|market_invalid)/);
  }
  assert.equal(paidEncarRefreshDecision({eventName: 'push', controls: controls(), policy: {},
    marker: {market: 'korea', publishMarkets: ['korea']}}).run, true);
});

test('collection requests only ordered offers pages and commits completion last with readback', async () => {
  const f = fixture(), responses = [page(1, [offer('1001'), offer('1002')], 2), page(2, [offer('1003')], null)];
  const receipt = await collectPaidEncarSnapshot(options(f, {
    request: async (endpoint, params) => {
      f.events.push({kind: 'api', endpoint, params});
      assert.equal(endpoint, 'offers'); assert.deepEqual(params, {page: f.events.filter(e => e.kind === 'api').length});
      return responses[params.page - 1];
    },
  }));
  assert.deepEqual(receipt, {version: 1, market: 'korea', provider: 'auto_api_encar',
    runId: identity.runId, attempt: identity.attempt, producerSha: identity.headSha,
    pages: 2, count: 3, completedAt});
  assert.deepEqual([...f.values.keys()], [`${prefix()}/start.json`, `${prefix()}/pages/1.json`, `${prefix()}/page-receipts/1.json`,
    `${prefix()}/pages/2.json`, `${prefix()}/page-receipts/2.json`, `${prefix()}/complete.json`]);
  const first = f.values.get(`${prefix()}/page-receipts/1.json`), last = f.values.get(`${prefix()}/page-receipts/2.json`);
  assert.equal(first.next, 2); assert.equal(last.next, null); assert.equal(last.totalCount, 3);
  assert.equal(last.previousSha256, createHash('sha256').update(JSON.stringify(first)).digest('hex'));
  for (const [index, event] of f.events.entries()) {
    if (event.kind === 'api') assert.equal(f.events[index - 1].kind, 'crm', 'each provider request follows a CRM check');
  }
  const finalWrite = f.events.findLastIndex(event => event.kind === 'write');
  assert.equal(f.events[finalWrite - 1].kind, 'crm', 'completion gets another source-switch check');
  assert.deepEqual(f.events.at(-1), {kind: 'read', key: `${prefix()}/complete.json`});
  assert.deepEqual(f.values.get(`${prefix()}/complete.json`), receipt);
});

test('run and attempt namespaces are distinct; completed retries reuse proof without provider calls or overwrites', async () => {
  const f = fixture();
  for (const scope of [identity, {...identity, attempt: '2'}, {...identity, runId: '43812759976'}]) {
    await collectPaidEncarSnapshot(options(f, scope));
    assert.equal(f.values.has(`${prefix(scope)}/complete.json`), true);
  }
  assert.equal(f.values.size, 12);
  const before = structuredClone([...f.values]), calls = f.events.filter(event => event.kind === 'api').length;
  assert.deepEqual(await collectPaidEncarSnapshot(options(f)), f.values.get(`${prefix()}/complete.json`));
  assert.equal(f.events.filter(event => event.kind === 'api').length, calls);
  assert.deepEqual([...f.values], before);
  const partial = {...identity, attempt: '3'}, key = `${prefix(partial)}/pages/1.json`;
  f.values.set(key, [offer('old')]);
  await assert.rejects(collectPaidEncarSnapshot(options(f, partial)), /paid_encar_snapshot_partial_pair/);
  assert.equal(f.events.filter(event => event.kind === 'api').length, calls);
  assert.deepEqual(f.values.get(key), [offer('old')]);
  assert.equal(f.values.has(`${prefix(partial)}/complete.json`), false);
});

test('a mid-snapshot API failure keeps saved pages without a completion marker', async () => {
  const f = fixture(), failure = Error('fixture_api_unavailable');
  await assert.rejects(collectPaidEncarSnapshot(options(f, {request: async (endpoint, params) => {
    f.events.push({kind: 'api', endpoint, params});
    if (params.page === 2) throw failure;
    return page(1, [offer('1001')], 2);
  }})), error => error === failure);
  assert.deepEqual([...f.values.keys()], [`${prefix()}/start.json`, `${prefix()}/pages/1.json`, `${prefix()}/page-receipts/1.json`]);
  const resumed = [];
  const receipt = await collectPaidEncarSnapshot(options(f, {request: async (_endpoint, params) => {
    resumed.push(params.page); return page(params.page, [offer('1002')], null);
  }}));
  assert.deepEqual(resumed, [2], 'a failed job resumes after the fully committed page');
  assert.equal(receipt.pages, 2); assert.equal(receipt.count, 2);
});

test('two bounded jobs resume the same immutable snapshot without fetching a saved page again', async () => {
  const f = fixture(), requested = [], start = Date.parse(completedAt); let clock = start;
  const request = async (endpoint, params) => {
    assert.equal(endpoint, 'offers'); requested.push(params.page);
    clock++;
    return page(params.page, [offer(String(1000 + params.page))], params.page === 1 ? 2 : null);
  };
  const partial = await collectPaidEncarSnapshot(options(f, {request, clock: () => clock,
    deadline: start + PAID_ENCAR_PAUSE_MARGIN_MS + 1, allowPartial: true}));
  assert.equal(partial.completed, false); assert.equal(partial.pages, 1);
  assert.equal(partial.count, 1); assert.equal(partial.nextPage, 2);
  assert.equal(f.values.has(`${prefix()}/complete.json`), false);
  const savedPage = structuredClone(f.values.get(`${prefix()}/pages/1.json`));
  const complete = await collectPaidEncarSnapshot(options(f, {request, clock: () => clock, allowPartial: false}));
  assert.deepEqual(requested, [1, 2]);
  assert.equal(complete.pages, 2); assert.equal(complete.count, 2);
  assert.deepEqual(f.values.get(`${prefix()}/pages/1.json`), savedPage);
  assert.deepEqual(f.values.get(`${prefix()}/complete.json`), complete);
  assert.equal(f.events.filter(e => e.kind === 'write' && e.key.endsWith('/pages/1.json')).length, 1);
});

test('the budget boundary is checked after CRM and only an intermediate job may pause successfully', async () => {
  const f = fixture(), start = Date.parse(completedAt); let clock = start, checks = 0, requests = 0;
  const partial = await collectPaidEncarSnapshot(options(f, {clock: () => clock,
    deadline: start + PAID_ENCAR_PAUSE_MARGIN_MS + 1, allowPartial: true,
    assertEnabled: async () => {if (++checks === 2) clock++;},
    request: async () => {requests++; throw Error('unexpected_provider_request');},
  }));
  assert.equal(partial.completed, false); assert.equal(partial.nextPage, 1); assert.equal(partial.pages, 0);
  assert.equal(requests, 0, 'a slow CRM read cannot push a new provider request beyond the pause boundary');
  await assert.rejects(collectPaidEncarSnapshot(options(f, {clock: () => clock,
    deadline: clock + PAID_ENCAR_PAUSE_MARGIN_MS, allowPartial: false,
    request: async () => {requests++; throw Error('unexpected_provider_request');},
  })), /paid_encar_snapshot_incomplete_time_budget/);
  assert.equal(requests, 0);
  assert.equal(f.values.has(`${prefix()}/complete.json`), false);
});

test('provider time-budget, quota and transport failures are never converted into successful pauses', async () => {
  for (const reason of ['auto_api_time_budget', 'fixture_quota_refused', 'fixture_transport_failed']) {
    const f = fixture(), failure = Error(reason);
    await assert.rejects(collectPaidEncarSnapshot(options(f, {allowPartial: true,
      request: async () => {throw failure;},
    })), error => error === failure);
    assert.equal(f.values.has(`${prefix()}/complete.json`), false);
    assert.equal([...f.values.keys()].some(key => key.includes('/pages/')), false);
  }
});

test('a crash between the raw page and its cursor receipt fails closed on retry without refetching', async () => {
  const f = fixture(), write = f.storage.writeJson, failure = Error('fixture_receipt_write_failed');
  let requests = 0;
  f.storage.writeJson = async (key, value, condition) => {
    if (key.endsWith('/page-receipts/1.json')) throw failure;
    return write(key, value, condition);
  };
  const request = async () => {requests++; return page(1, [offer('1001')], 2);};
  await assert.rejects(collectPaidEncarSnapshot(options(f, {request, allowPartial: true})), error => error === failure);
  assert.equal(f.values.has(`${prefix()}/pages/1.json`), true);
  assert.equal(f.values.has(`${prefix()}/page-receipts/1.json`), false);
  f.storage.writeJson = write;
  await assert.rejects(collectPaidEncarSnapshot(options(f, {request, allowPartial: true})), /paid_encar_snapshot_partial_pair/);
  assert.equal(requests, 1, 'an orphan raw page cannot be fetched again or assigned a guessed next cursor');
  assert.equal(f.values.has(`${prefix()}/complete.json`), false);
});

test('a saved terminal page completes after a failed final write without another provider request', async () => {
  const f = fixture(), write = f.storage.writeJson, failure = Error('fixture_complete_write_failed');
  f.storage.writeJson = async (key, value, condition) => {
    if (key.endsWith('/complete.json')) throw failure;
    return write(key, value, condition);
  };
  await assert.rejects(collectPaidEncarSnapshot(options(f)), error => error === failure);
  assert.equal(f.values.get(`${prefix()}/page-receipts/1.json`).next, null);
  assert.equal(f.values.has(`${prefix()}/complete.json`), false);
  f.storage.writeJson = write;
  const complete = await collectPaidEncarSnapshot(options(f, {
    request: async () => {throw Error('terminal_page_must_not_be_refetched');},
  }));
  assert.equal(complete.pages, 1); assert.equal(complete.count, 1);
  assert.deepEqual(f.values.get(`${prefix()}/complete.json`), complete);
});

test('saved page gaps, missing pairs, altered cursor proof and changed source are rejected before HTTP', async () => {
  const source = fixture();
  await collectPaidEncarSnapshot(options(source, {request: async (_endpoint, params) =>
    page(params.page, [offer(String(params.page))], params.page === 1 ? 2 : null)}));
  source.values.delete(`${prefix()}/complete.json`);
  const cases = [
    [f => f.values.delete(`${prefix()}/pages/1.json`), /paid_encar_snapshot_partial_pair/],
    [f => {f.values.delete(`${prefix()}/pages/1.json`); f.values.delete(`${prefix()}/page-receipts/1.json`);}, /paid_encar_snapshot_partial_pair/],
    [f => {f.values.get(`${prefix()}/page-receipts/1.json`).next = 3;}, /paid_encar_snapshot_saved_next/],
    [f => {f.values.get(`${prefix()}/page-receipts/2.json`).previousSha256 = 'f'.repeat(64);}, /paid_encar_snapshot_receipt_chain/],
    [f => {f.values.get(`${prefix()}/page-receipts/1.json`).totalCount++;}, /paid_encar_snapshot_saved_total/],
    [f => {f.values.get(`${prefix()}/page-receipts/1.json`).producerSha = 'f'.repeat(40);}, /paid_encar_snapshot_saved_identity/],
    [f => {f.values.get(`${prefix()}/pages/2.json`)[0].data.price++;}, /paid_encar_snapshot_saved_page_digest/],
    [f => {f.values.get(`${prefix()}/start.json`).startedAt = '2026-11-13T17:04:59.999Z';}, /paid_encar_snapshot_started_stale/],
    [f => {f.values.get(`${prefix()}/start.json`).startedAt = '2026-11-16T17:05:00.001Z';}, /paid_encar_snapshot_started_stale/],
  ];
  for (const [mutate, expected] of cases) {
    const f = fixture();
    for (const [key, value] of source.values) f.values.set(key, structuredClone(value));
    mutate(f);
    await assert.rejects(collectPaidEncarSnapshot(options(f, {
      request: async () => {throw Error('invalid_snapshot_must_not_reach_provider');},
    })), expected);
    assert.equal(f.values.has(`${prefix()}/complete.json`), false);
    assert.equal(f.events.some(e => e.kind === 'write'), false);
  }
});

test('a lost acknowledgement may reuse an identical create-only write without repeating the provider request', async () => {
  const f = fixture(), write = f.storage.writeJson, attempted = new Set();
  f.storage.writeJson = async (key, value, condition) => {
    await write(key, value, condition);
    if (!attempted.has(key)) {attempted.add(key); throw Error('fixture_write_response_lost');}
  };
  const complete = await collectPaidEncarSnapshot(options(f));
  assert.equal(complete.count, 1); assert.equal(complete.pages, 1);
  assert.equal(f.events.filter(e => e.kind === 'api').length, 1);
  assert.equal(f.events.filter(e => e.kind === 'write').length, 4);
  assert.deepEqual(f.values.get(`${prefix()}/complete.json`), complete);
});

test('a downstream retry may reuse the planned attempt only within the same run and source revision', () => {
  const scope = {runId: identity.runId, runAttempt: '2', snapshotRun: identity.runId,
    snapshotAttempt: '1', headSha: identity.headSha};
  assert.deepEqual(paidEncarSnapshotScope(scope), identity);
  assert.deepEqual(paidEncarSnapshotScope({...scope, snapshotAttempt: '2'}), {...identity, attempt: '2'});
  for (const change of [{snapshotRun: '43812759976'}, {snapshotAttempt: '3'}, {snapshotAttempt: '01'},
    {runAttempt: '0'}, {runId: '9007199254740993'}, {headSha: '1bb70be'}]) {
    assert.throws(() => paidEncarSnapshotScope({...scope, ...change}), /paid_encar_snapshot_/);
  }
});

test('the actual restorer verifies each new saved page before normalization and prepares reports before intake completion', async () => {
  const f = await restorableSnapshot();
  await restoreFixture(f);
  assert.equal(f.events.filter(e => e.kind === 'normalize').length, 2);
  assert.equal(f.events.filter(e => e.kind === 'observation').length, 2);
  assert.deepEqual(f.events.filter(e => e.kind === 'read' && e.key.includes('/page-receipts/')).map(e => e.key),
    [`${prefix()}/page-receipts/1.json`, `${prefix()}/page-receipts/2.json`]);
  const report = f.events.findIndex(e => e.kind === 'intake-report');
  assert.ok(report > f.events.findIndex(e => e.kind === 'prepare-reports'));
  assert.equal(f.events[report].report.completed, true);
  assert.equal(f.events[report].report.snapshotAttempt, identity.attempt);
});

test('completed retries still reject a changed early raw page in the actual restore pass without HTTP', async () => {
  const f = await restorableSnapshot();
  f.values.get(`${prefix()}/pages/1.json`)[0].data.price++;
  await collectPaidEncarSnapshot(options(f, {request: async () => {throw Error('completed_retry_must_not_request_provider');}}));
  await assert.rejects(restoreFixture(f), /paid_encar_snapshot_saved_page_digest/);
  assert.equal(f.events.some(e => ['normalize', 'observation', 'prepare-reports', 'intake-report'].includes(e.kind)), false);
});

test('restoration rejects missing receipts, count, source, cursor and chain mismatches before writing an intake report', async () => {
  const cases = [
    [f => {f.values.delete(`${prefix()}/page-receipts/1.json`);}, /paid_encar_snapshot_saved_identity/],
    [f => {f.values.get(`${prefix()}/page-receipts/1.json`).count++;}, /paid_encar_snapshot_saved_count/],
    [f => {f.values.get(`${prefix()}/page-receipts/1.json`).producerSha = 'f'.repeat(40);}, /paid_encar_snapshot_saved_identity/],
    [f => {f.values.get(`${prefix()}/page-receipts/1.json`).next = null;}, /paid_encar_snapshot_saved_next/],
    [f => {f.values.get(`${prefix()}/page-receipts/2.json`).previousSha256 = 'f'.repeat(64);}, /paid_encar_snapshot_receipt_chain/],
    [f => {f.values.get(`${prefix()}/complete.json`).producerSha = 'f'.repeat(40);}, /paid_encar_snapshot_receipt_source/],
    [f => {f.values.get(`${prefix()}/complete.json`).provider = 'parser';}, /paid_encar_snapshot_receipt_provider/],
  ];
  for (const [mutate, expected] of cases) {
    const f = await restorableSnapshot(); mutate(f);
    await assert.rejects(restoreFixture(f), expected);
    assert.equal(f.events.some(e => ['prepare-reports', 'intake-report'].includes(e.kind)), false);
  }
});

test('the original legacy snapshot remains restorable without receipts; malformed new envelopes cannot downgrade', async () => {
  const f = await restorableSnapshot(), complete = f.values.get(`${prefix()}/complete.json`);
  f.values.set(`${prefix()}/complete.json`, {pages: complete.pages, count: complete.count, completedAt});
  for (const key of [...f.values.keys()]) if (key.includes('/page-receipts/') || key.endsWith('/start.json')) f.values.delete(key);
  await restoreFixture(f);
  assert.equal(f.events.filter(e => e.kind === 'normalize').length, 2);
  assert.equal(f.events.some(e => e.kind === 'read' && e.key.includes('/page-receipts/')), false);
  assert.equal(f.events.some(e => e.kind === 'intake-report'), true);
  for (const extra of [{version: 1}, {provider: 'auto_api_encar'}, {producerSha: identity.headSha}]) {
    assert.throws(() => paidEncarSavedPageVerifier({pages: 2, count: 2, completedAt, ...extra},
      {...identity, now: Date.parse(completedAt)}), /paid_encar_snapshot_receipt_/);
  }
});

test('the workflow pins the producer scope and serializes two collectors before completed-only preparation', async () => {
  const workflow = readFileSync(new URL('../.github/workflows/catalog-paid-encar-refresh.yml', import.meta.url), 'utf8');
  const blocks = workflow.split(/^  ([a-z_]+):\n/gm), jobs = {};
  for (let index = 1; index < blocks.length; index += 2) jobs[blocks[index]] = blocks[index + 1];
  const {plan, collect_initial: first, collect: last, prepare, publish} = jobs;
  assert.match(plan, /snapshot_run: \$\{\{ steps\.policy\.outputs\.snapshot_run \}\}/);
  assert.match(plan, /snapshot_attempt: \$\{\{ steps\.policy\.outputs\.snapshot_attempt \}\}/);
  assert.match(first, /^    needs: plan$/m);
  assert.match(last, /^    needs: \[plan, collect_initial\]$/m);
  assert.match(last, /needs\.collect_initial\.result == 'success'/);
  for (const job of [first, last]) {
    assert.match(job, /^    timeout-minutes: 330$/m);
    assert.match(job, /CATALOG_INTAKE_TIME_MS: '18000000'/);
    assert.match(job, /ENCAR_SNAPSHOT_RUN: \$\{\{ needs\.plan\.outputs\.snapshot_run \}\}/);
    assert.match(job, /ENCAR_SNAPSHOT_ATTEMPT: \$\{\{ needs\.plan\.outputs\.snapshot_attempt \}\}/);
    assert.match(job, /ACCOUNT_KEY: \$\{\{ secrets\.AUTO_API_DUBICARS_KEY \|\| secrets\.AUTO_API_CHE168_KEY \}\}/);
    assert.match(job, /run: node --import tsx scripts\/catalog-paid-encar-intake\.mjs/);
  }
  assert.match(first, /ENCAR_ALLOW_PARTIAL: 'true'/); assert.match(last, /ENCAR_ALLOW_PARTIAL: 'false'/);
  assert.match(prepare, /^    needs: collect$/m);
  assert.match(prepare, /needs\.collect\.outputs\.snapshot_complete == 'true'/);
  assert.match(prepare, /ENCAR_SNAPSHOT_ATTEMPT: \$\{\{ needs\.collect\.outputs\.snapshot_attempt \}\}/);
  assert.match(publish, /^    needs: prepare$/m);
  const body = plan.match(/<<'PAID_PLAN'\n([\s\S]*?)\n          PAID_PLAN/)[1]
    .split('\n').map(line => line.slice(10)).filter(line => !line.startsWith('import ')).join('\n');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const planner = new AsyncFunction('fs', 'paidEncarRefreshDecision', 'readCollectionControls', 'process', 'console', body);
  for (const attempt of ['1', '2']) {
    let output = '';
    await planner({readFileSync: () => '{}', appendFileSync: (_path, text) => {output += text;}},
      paidEncarRefreshDecision, async () => controls(),
      {env: {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: identity.runId, GITHUB_RUN_ATTEMPT: attempt, GITHUB_OUTPUT: 'fixture'}},
      {log() {}});
    assert.equal(output, `run=true\nsnapshot_run=${identity.runId}\nsnapshot_attempt=${attempt}\n`);
  }
});

test('CRM disablement blocks initial access, the next page and final completion', async () => {
  for (const stage of ['initial', 'next_page', 'completion']) {
    const f = fixture(), failure = Error('fixture_owner_disabled'); let apiCalls = 0;
    await assert.rejects(collectPaidEncarSnapshot(options(f, {
      assertEnabled: async () => {
        f.events.push({kind: 'crm'});
        if (stage === 'initial' || apiCalls > 0) throw failure;
      },
      request: async () => {apiCalls++; return page(1, [offer('1001')], stage === 'next_page' ? 2 : null);},
    })), error => error === failure);
    assert.equal(apiCalls, stage === 'initial' ? 0 : 1);
    assert.equal(f.values.has(`${prefix()}/complete.json`), false);
  }
});

test('the fixed Encar offers client rechecks CRM after backoff before another HTTP attempt', async () => {
  let enabled = true, requests = 0, checks = 0;
  const request = paidEncarRequest({apiKey: 'fixture-only', requestDelayMs: 0,
    assertEnabled: async () => {checks++; if (!enabled) throw Error('fixture_owner_disabled');},
    sleep: async () => {if (requests) enabled = false;},
    fetchImpl: async (input, options) => {
      requests++;
      const url = new URL(input);
      assert.equal(url.origin, 'https://api1.auto-api.com');
      assert.equal(url.pathname, '/api/v3/encar/offers');
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(options.redirect, 'error');
      return new Response('', {status: 503});
    },
  });
  await assert.rejects(request('changes', {page: 1}), /paid_encar_request_endpoint_invalid/);
  assert.equal(requests, 0); assert.equal(checks, 0);
  await assert.rejects(request('offers', {page: 1}), /auto_api_transport_failed/);
  assert.equal(requests, 1, 'owner disablement during backoff forbids a second provider request');
  assert.ok(checks > 1, 'the internal retry must recheck the owner switch');
});

test('malformed, skipped or empty provider pages never produce a completion marker', async () => {
  for (const [payload, expected] of [
    [page(1, [{inner_id: '1001'}], null), /paid_encar_offer_envelope_invalid/],
    [page(1, [offer('1001')], 3), /paid_encar_snapshot_page_sequence_invalid/],
    [page(2, [offer('1001')], null), /auto_api_invalid_page/],
    [page(1, [], null), /paid_encar_snapshot_empty/],
  ]) {
    const f = fixture();
    await assert.rejects(collectPaidEncarSnapshot(options(f, {request: async () => payload})), expected);
    assert.equal(f.values.has(`${prefix()}/complete.json`), false);
  }
});

test('completion readback must match before collection returns a verified receipt', async () => {
  const f = fixture(), read = f.storage.readJson;
  f.storage.readJson = async (key, fallback) => {
    const value = await read(key, fallback);
    return key.endsWith('/complete.json') && value ? {...value, count: value.count + 1} : value;
  };
  await assert.rejects(collectPaidEncarSnapshot(options(f)), /paid_encar_snapshot_readback_mismatch/);
  assert.equal(f.events.at(-1).key, `${prefix()}/complete.json`);
});

test('receipt validation binds run, attempt, source and paid provider with an inclusive three-day lifetime', () => {
  const receipt = {version: 1, market: 'korea', provider: 'auto_api_encar', runId: identity.runId,
    attempt: identity.attempt, producerSha: identity.headSha, pages: 2, count: 3, completedAt};
  const now = Date.parse(completedAt), lifetime = 3 * 86400000;
  for (const time of [now, now + lifetime]) assert.equal(assertPaidEncarSnapshotReceipt(receipt, {...identity, now: time}), receipt);
  for (const time of [now - 1, now + lifetime + 1]) {
    assert.throws(() => assertPaidEncarSnapshotReceipt(receipt, {...identity, now: time}), /paid_encar_snapshot_receipt_stale/);
  }
  for (const change of [{runId: '43812759976'}, {attempt: '2'}, {producerSha: 'f'.repeat(40)},
    {provider: 'parser'}, {market: 'china'}, {version: 2}, {pages: 0}, {count: 0}, {completedAt: 'invalid'}]) {
    assert.throws(() => assertPaidEncarSnapshotReceipt({...receipt, ...change}, {...identity, now}), /paid_encar_snapshot_receipt_/);
  }
});
