import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {japanBrowserBindingFailureDiagnostic} from '../scripts/catalog-next/daily-release.mjs';
import {serializeJapanBrowserReport, recordJapanResponse} from '../scripts/catalog-next/japan-browser-acceptance.mjs';
import {readJapanCrossoverFirstPage, verifyJapanCrossoverAppend} from '../scripts/catalog-next/japan-crossover-browser.mjs';
import {japanSourceSelectionAcceptancePassed} from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {sourcePriceOrderReport} from './helpers/japan-source-price-order-report-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const at = Date.parse('2026-11-28T12:00:00.000Z');
const expected = {codeScope: 'catalog-japan-stability-v1', countAcceptance: 'japan-source-count-v1',
  release: 'a'.repeat(40), nonce: 'b'.repeat(32), generationManifestSha256: 'c'.repeat(64), oracleSha256: 'd'.repeat(64)};
const bound = () => ({version: 1, kind: 'catalog-japan-browser-v1', ...expected, checkedAt: new Date(at).toISOString()});
const diagnostic = raw => japanBrowserBindingFailureDiagnostic(raw,
  {expected, childExitCode: 1, startedAt: at - 1000, finishedAt: at + 1000, observedTiming: true});

test('unbound report metadata distinguishes size, JSON and each exact header predicate without copying contents', () => {
  const oversized = Buffer.from('PRIVATE_BODY_' + 'x'.repeat(256 * 1024));
  const size = diagnostic(oversized);
  assert.equal(size.reason, 'size'); assert.equal(size.json, 'not_checked'); assert.equal(size.reportBytes, oversized.length);
  assert.equal(size.reportSha256, null); assert(Object.values(size.headerMatches).every(value => value === null));
  const malformed = Buffer.from('{PRIVATE_BODY_'), json = diagnostic(malformed);
  assert.equal(json.reason, 'json'); assert.equal(json.json, 'invalid'); assert.equal(json.reportSha256, hash(malformed));
  for (const key of ['version', 'kind', 'codeScope', 'countAcceptance', 'release', 'nonce', 'generationManifestSha256', 'oracleSha256']) {
    const report = {...bound(), [key]: 'PRIVATE_HEADER_', body: 'PRIVATE_BODY_', error: {stage: 'PRIVATE_STAGE_'}};
    const value = diagnostic(Buffer.from(JSON.stringify(report)));
    assert.equal(value.reason, 'header'); assert.equal(value.headerMatches[key], false);
    assert(Object.entries(value.headerMatches).filter(([name]) => name !== key).every(([, match]) => match === true));
    assert.equal(JSON.stringify(value).includes('PRIVATE_'), false);
  }
  for (const [checkedAt, failed] of [['invalid PRIVATE_TIME_', 'checkedAtValid'],
    ['2026-11-28T11:59:00.000Z', 'checkedAtAfterStart'], ['2026-11-28T12:01:00.000Z', 'checkedAtNotFuture']]) {
    const value = diagnostic(Buffer.from(JSON.stringify({...bound(), checkedAt})));
    assert.equal(value.headerMatches[failed], false); assert.equal(JSON.stringify(value).includes('PRIVATE_'), false);
  }
  assert.equal(diagnostic(Buffer.from('null')).reason, 'header');
  assert.equal(size.childExitCode, 1); assert.equal(size.startedAtMs, at - 1000); assert.equal(size.finishedAtMs, at + 1000);
  assert.equal(size.elapsedMs, 2000);
  const legacy = japanBrowserBindingFailureDiagnostic(Buffer.alloc(128 * 1024 + 1, 32),
    {expected, childExitCode: 1, startedAt: at - 1000, finishedAt: at + 1000});
  assert.equal(legacy.reportLimitBytes, 128 * 1024); assert.equal(legacy.reason, 'size');
  assert.equal(legacy.reportSha256, null); assert(Object.values(legacy.headerMatches).every(value => value === null));
});

test('compact complete price/source/A4/crossover evidence preserves all fields and bounded eight-read observations', t => {
  const report = {...bound(), ...sourcePriceOrderReport(), japanCrossoverPower160Required: true, japanCrossoverPower160Passed: true};
  const rows = Array.from({length: 48}, (_, i) => ({id: 'ajes-stats-crossover-' + i, bodyType: 'suv', powerHp: i < 30 ? 150 : null}));
  const items = rows.slice(24).map(row => ({...row, market: 'japan', ...(row.powerHp === null ? {japanPowerUnknown: true} : {})}));
  const observedAt = '2026-11-28T11:59:00.000Z', cursor = 'j2.k.2.0.2.' + hash('crossover') + '.' + hash('epoch') + '.-';
  const page = {observedAt, sourcePages: 8, receiptsSha256: hash('receipts'), sourceReceiptsFresh: true, shown: 24};
  report.checks.crossoverPower160 = {contract: 'japan-crossover-power160-browser-v1', city: 'Новокузнецк', bodyType: 'suv', powerTo: 160,
    documentStatus: 200, ...verifyJapanCrossoverAppend({before: rows.slice(0, 24), items, after: rows}),
    firstPage: {...page, kind: 'rendered-ssr', page: 1, afterSha256: hash(''), ssrBindingMatched: true},
    nextPage: {...page, kind: 'append-api', status: 200, stale: false, partial: false, interrupted: false, total: null},
    cursor, continuationCursor: cursor, sameFilter: true, cityPreserved: true, bodyControlPreserved: true,
    powerControlPreserved: true, followedEmittedCursor: true, explicitApiReads: 0, ordinaryAppendRequests: 1,
    liveExhaustiveScan: false, pageErrors: 0, alerts: 0};
  // Synthetic size fixture: the allowed eight receipts are retained for every
  // one of these 21 observations. This is not evidence from a live release.
  for (let request = 0; request < 21; request++) {
    const receipts = Array.from({length: 8}, (_, page) => ({version: 1,
      requestId: '00000000-0000-4000-8000-' + String(request * 8 + page + 1).padStart(12, '0'),
      queryHash: hash(request + ':' + page), table: 'stats', kind: 'list', page: page + 1, pageSize: 24,
      startedAt: observedAt, finishedAt: observedAt, stage: 'supplier', supplierAttempted: true, outcome: 'fresh', observedAt}));
    recordJapanResponse(report, 'source_count_append', {status: 200, data: {ok: true, page: 2, pageSize: 24,
      items: [], total: null, hasMore: true, reads: 8, stale: false, observedAt, sourceReceipts: receipts},
      headers: {}, requestedAt: at - 60_000, receivedAt: at - 59_000, durationMs: 1000}, expected.release);
  }
  report.checks.priceSortProgress = {phase: 'complete', counts: report.checks.priceSort.counts, checks: report.checks.priceSort.checks};
  report.checks.a4Power160ContinuationProgress = {phase: 'complete', attempts: report.checks.a4Power160Continuation.attempts};
  assert.equal(japanSourceSelectionAcceptancePassed(report), true);
  const raw = serializeJapanBrowserReport(report), pretty = JSON.stringify(report, null, 2) + '\n';
  assert.deepEqual(JSON.parse(raw), report); assert.equal(raw, JSON.stringify(report) + '\n');
  assert(Buffer.byteLength(raw) < 256 * 1024); assert(Buffer.byteLength(raw) < Buffer.byteLength(pretty));
  assert(report.checks.responses.every(row => row.pageReadEvidence.receipts.length === 8));
  const envelope = JSON.stringify({kind: 'japan-code-browser-details-v1', japanReportBase64: Buffer.from(raw).toString('base64'), japanReportSha256: hash(raw)});
  assert(Buffer.byteLength(envelope) < 512 * 1024);
  assert.equal(japanSourceSelectionAcceptancePassed(JSON.parse(raw)), true);
  const failed = structuredClone(report); failed.japanCrossoverPower160Passed = false;
  assert.equal(japanSourceSelectionAcceptancePassed(JSON.parse(serializeJapanBrowserReport(failed))), false);
  t.diagnostic(JSON.stringify({synthetic: true, compactBytes: Buffer.byteLength(raw), prettyBytes: Buffer.byteLength(pretty), envelopeBytes: Buffer.byteLength(envelope)}));
});

test('crossover readiness retains existing page evidence and rethrows the same failure without navigation or extra requests', async () => {
  const timeout = Object.assign(Error('PRIVATE_TIMEOUT_'), {name: 'TimeoutError'}), calls = [];
  const view = {evaluate: async () => { calls.push('dom'); return {status: 'recorded', shown: 0, incompleteNotice: true}; },
    waitForFunction: async (_fn, input, options) => { calls.push('wait'); assert.equal(input.count, 24); assert.equal(options.timeout, 60_000); throw timeout; },
    goto: () => assert.fail('no navigation'), request: {get: () => assert.fail('no request')}};
  const progress = {}, evidence = {status: 'recorded', shown: 0, sourcePages: 8};
  await assert.rejects(readJapanCrossoverFirstPage(view, {progress, readSsrPageEvidence: async () => {
    calls.push('ssr'); return evidence;
  }}), error => error === timeout);
  assert.equal(progress.firstPageReadiness.beforeWait.dom.shown, 0);
  assert.equal(progress.firstPageReadiness.failure.timeout, true);
  assert.deepEqual(progress.firstPageReadiness.failure.observation.sourceReadEvidence, evidence);
  assert.equal(calls.filter(value => value === 'wait').length, 1);
  assert.equal(calls.filter(value => value === 'dom').length, 2);
  assert.equal(calls.filter(value => value === 'ssr').length, 2);
  assert.equal(JSON.stringify(progress).includes('PRIVATE_'), false);
  const broken = {evaluate: async () => { throw Error('PRIVATE_DOM_'); }, waitForFunction: view.waitForFunction};
  await assert.rejects(readJapanCrossoverFirstPage(broken, {progress: {}, readSsrPageEvidence: async () => {
    throw Error('PRIVATE_SSR_');
  }}), error => error === timeout);
});

test('the fixed failure diagnostic is included in the existing artifact upload', () => {
  const workflow = readFileSync(new URL('../.github/workflows/catalog-next-china-photo-release.yml', import.meta.url), 'utf8');
  assert(workflow.includes('            catalog-next-japan-browser-binding-failure.json\n'));
});
