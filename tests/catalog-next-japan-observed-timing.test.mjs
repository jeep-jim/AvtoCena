import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {JAPAN_OBSERVED_TIMING_POLICY, japanTimingPolicy, collectJapanObservedTimings,
  navigateJapanOverview, runJapanBrowserAcceptance, verifyJapanPage, verifyJapanFullPage}
  from '../scripts/catalog-next/japan-browser-acceptance.mjs';

test('Japan observed timings retain slow or unavailable measurements without changing the functional verdict', () => {
  for (const passed of [true, false]) {
    const report = {timingPolicy: JAPAN_OBSERVED_TIMING_POLICY, passed,
      checks: {health: [{stage: 'before', durationMs: 150_000}],
        responses: [{stage: 'plain_first', durationMs: 90_001}, {stage: 'power_api', durationMs: null}],
        ui: {durationMs: 180_000}, petrolPowerUi: {durationMs: -1},
        visibility: [{path: '/', durationMs: 100_000}, {path: '/cars', durationMs: Infinity}]}};
    assert.equal(collectJapanObservedTimings(report), report);
    assert.equal(report.passed, passed);
    assert.equal(report.speedGateRequired, false); assert.equal(report.speedPassed, null);
    assert.equal(report.timingObserved, true); assert.equal(report.timings.latencyThresholdApplied, false);
    assert.deepEqual(report.timings.samples, [
      {phase: 'health_before', durationMs: 150_000, measurement: 'observed'},
      {phase: 'plain_first', durationMs: 90_001, measurement: 'observed'},
      {phase: 'power_api', durationMs: null, measurement: 'unavailable'},
      {phase: 'ui', durationMs: 180_000, measurement: 'observed'},
      {phase: 'petrolPowerUi', durationMs: null, measurement: 'unavailable'},
      {phase: 'home_visibility', durationMs: 100_000, measurement: 'observed'},
      {phase: 'catalog_visibility', durationMs: null, measurement: 'unavailable'},
    ]);
  }
  const unavailable = collectJapanObservedTimings({timingPolicy: JAPAN_OBSERVED_TIMING_POLICY,
    passed: true, checks: {health: [{stage: 'before'}]}});
  assert.equal(unavailable.timingObserved, true);
  assert.deepEqual(unavailable.timings.samples[0], {phase: 'health_before', durationMs: null, measurement: 'unavailable'});
  const unattempted = collectJapanObservedTimings({timingPolicy: JAPAN_OBSERVED_TIMING_POLICY, passed: false, checks: {}});
  assert.equal(unattempted.timingObserved, false); assert.deepEqual(unattempted.timings.samples, []);
});

test('older reports and real freshness/fullness failures retain their original meaning', () => {
  const legacy = {passed: true, checks: {health: [{stage: 'before', durationMs: 123}]}};
  const before = structuredClone(legacy);
  collectJapanObservedTimings(legacy); assert.deepEqual(legacy, before);
  const now = Date.now(), page = {ok: true, stale: false, observedAt: new Date(now - 1000).toISOString(),
    items: Array.from({length: 24}, (_, i) => ({id: 'ajes-stats-A' + i, market: 'japan'})), hasMore: true};
  assert.doesNotThrow(() => verifyJapanPage(page, 200, now));
  assert.doesNotThrow(() => verifyJapanFullPage(page));
  for (const patch of [{stale: true}, {partial: true}, {interrupted: true},
    {observedAt: new Date(now - 30 * 60_000).toISOString()}, {items: []}])
    assert.throws(() => verifyJapanPage({...page, ...patch}, 200, now));
  assert.throws(() => verifyJapanFullPage({...page, items: page.items.slice(1)}), /short_page_with_more/);
});

test('Japan overview navigation waits for its committed response without waiting for unrelated document completion', async () => {
  const calls = [], response = {status: () => 200};
  const view = {goto: async (url, options) => { calls.push({url, options});
    if (options.waitUntil !== 'commit') throw Error('unrelated overview stream not complete');
    return response; }};
  for (const pathname of ['/', '/cars'])
    assert.equal(await navigateJapanOverview(view, pathname, JAPAN_OBSERVED_TIMING_POLICY), response);
  assert.deepEqual(calls, ['/', '/cars'].map(pathname => ({url: 'https://avtocena.com' + pathname + '?'
    + new URLSearchParams({city: 'Новокузнецк'}), options: {waitUntil: 'commit', timeout: 90_000}})));
  const legacy = [];
  await navigateJapanOverview({goto: async (...args) => legacy.push(args)}, '/');
  assert.equal(legacy[0][1].waitUntil, 'domcontentloaded');
  for (const pathname of ['/cars/china', '/api/health', '/crm', 'https://other.example/'])
    await assert.rejects(navigateJapanOverview(view, pathname, JAPAN_OBSERVED_TIMING_POLICY), /overview_path/);
  assert.equal(calls.length, 2);
});

test('the owner timing policy is exact and requires all stronger Japan functional gates before any I/O', async t => {
  assert.equal(japanTimingPolicy(undefined), undefined);
  assert.equal(japanTimingPolicy(JAPAN_OBSERVED_TIMING_POLICY), JAPAN_OBSERVED_TIMING_POLICY);
  for (const value of ['', null, true, false, '0', '1', 'observational', JAPAN_OBSERVED_TIMING_POLICY + ' '])
    assert.throws(() => japanTimingPolicy(value), /timing_policy/);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-observed-policy-'));
  t.after(() => fs.rm(temp, {recursive: true, force: true}));
  for (const [i, options] of [{requirePowerOrder: false, requireBrandDirectory: true},
    {requirePowerOrder: true, requireBrandDirectory: false},
    {codeScope: 'catalog-japan-recovery-v1', requirePowerOrder: false, requireBrandDirectory: false}].entries()) {
    const report = await runJapanBrowserAcceptance({oraclePath: path.join(temp, 'not-read.json'),
      releaseSha: 'a'.repeat(40), nonce: 'b'.repeat(32), outputFile: path.join(temp, 'bad-' + i + '.json'),
      codeScope: 'catalog-japan-stability-v1', timingPolicy: JAPAN_OBSERVED_TIMING_POLICY, ...options});
    assert.equal(report.passed, false); assert.equal(report.error.code, 'japan_browser_timing_policy_scope');
    assert.equal(report.explicitJapanApiRequests, 0); assert.equal(report.timingObserved, false);
    assert.equal(report.speedPassed, null);
  }
  const output = path.join(temp, 'cli.json');
  const rejected = spawnSync(process.execPath, ['scripts/catalog-next/japan-browser-acceptance.mjs'], {
    cwd: new URL('../', import.meta.url), env: {PATH: process.env.PATH, OUTPUT: output, CATALOG_JAPAN_TIMING_POLICY: 'true'},
    encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024});
  assert.equal(rejected.status, 1); assert.equal(rejected.stderr.trim(), 'japan_browser_report_failed');
  await assert.rejects(() => fs.access(output), {code: 'ENOENT'});
});
