import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonicalCatalogHref} from '../apps/web/lib/catalog/catalog-routes.ts';
import {brandSelectionQuery} from '../apps/web/lib/catalog/brand-navigation.ts';
import {canonicalCatalogBrand} from '../apps/web/lib/catalog/brands.ts';
import {JAPAN_STABILITY_BRANDS_API, checkedJapanStabilityBrandDirectory,
  verifyJapanStabilityBrandOptions, verifyJapanStabilityBrandRail as verifyRail, checkJapanStabilityBrandControl,
  japanStabilityBrandDirectoryShape, verifyJapanStabilityBrandFallback, verifyJapanStabilityBrandRailFallback,
  verifyJapanStabilityBrandRequestCount}
  from '../scripts/catalog-next/japan-stability-browser.mjs';
import {japanBrandDirectoryRequirement, runJapanBrowserAcceptance} from '../scripts/catalog-next/japan-browser-acceptance.mjs';

const ORIGIN = 'https://avtocena.com', now = Date.parse('2026-11-27T13:00:00Z');
const payload = () => ({generationId: new Date(now - 1000).toISOString(), stale: false,
  counts: {BENZ: 24, MERCEDES: 11, MAZDA: 50, TOYOTA: 80, Nissan: 0}, modelCounts: {}});
const directory = () => checkedJapanStabilityBrandDirectory(payload(), 200, now);
const pageUrl = ORIGIN + '/cars/japan?' + new URLSearchParams({page: '1', pageSize: '24', city: 'Новокузнецк', powerTo: '160'});
const visibleRows = [{id: 'ajes-stats-T1', market: 'japan', make: 'TOYOTA'},
  {id: 'ajes-stats-H1', market: 'japan', make: 'HONDA'}];
const sourceValues = ['BENZ', 'MERCEDES', 'MAZDA', 'TOYOTA'];
const verifyJapanStabilityBrandRail = (...args) => verifyRail(...args, canonicalCatalogBrand);
function link(label, makes) {
  const query = new URL(pageUrl).searchParams;
  query.set('market', 'japan');
  return {title: 'Автомобили ' + label + ' под заказ',
    href: canonicalCatalogHref('/cars?' + brandSelectionQuery(query.toString(), makes))};
}
const links = () => [link('Mercedes-Benz', ['BENZ', 'MERCEDES']), link('Mazda', ['MAZDA']),
  link('Toyota', ['TOYOTA']), link('Honda', ['HONDA'])];

test('current counts metadata certifies only fresh positive source names without legacy directory markers', () => {
  const checked = directory();
  assert.deepEqual(checked.makes, sourceValues);
  assert.equal(checked.observedAt, new Date(now - 1000).toISOString());
  assert.match(checked.sourceNamesSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(payload(), 'makes'), false);
  assert.equal(Object.hasOwn(payload(), 'directoryComplete'), false);
  for (const change of [{stale: true}, {stale: undefined}, {partial: true}, {interrupted: true}, {scanLimited: true},
    {generationId: 'bad'}, {generationId: new Date(now - 30 * 60_000).toISOString()},
    {generationId: new Date(now + 60_001).toISOString()}, {counts: {}}, {counts: {TOYOTA: 0}},
    {counts: []}, {counts: null}, {counts: {TOYOTA: -1}}, {counts: {TOYOTA: 1.5}},
    {counts: {TOYOTA: '24'}}, {counts: {' TOYOTA': 24}}, {counts: {'<Toyota>': 24}}])
    assert.throws(() => checkedJapanStabilityBrandDirectory({...payload(), ...change}, 200, now), /brand_directory_/);
  for (const status of [0, 200.5, 304, 500, 503])
    assert.throws(() => checkedJapanStabilityBrandDirectory(payload(), status, now), /brand_directory_/);
});

test('dropdown must contain every raw positive source make and cannot pass on aliases or visible-card fallbacks', () => {
  const checked = directory(), proof = verifyJapanStabilityBrandOptions(checked, sourceValues, 'ready');
  assert.equal(proof.completeSourceCovered, true); assert.equal(proof.fallbackOnly, false);
  assert.equal(proof.filterMakes, 4);
  for (const values of [[], ['TOYOTA'], sourceValues.slice(1), [...sourceValues, 'Honda'],
    [...sourceValues, 'Nissan'], [...sourceValues, 'benz'], ['Mercedes-Benz', 'MAZDA', 'TOYOTA'],
    ['BENZ', 'MERCEDES', 'MAZDA', null]])
    assert.throws(() => verifyJapanStabilityBrandOptions(checked, values, 'ready'), /brand_filter_/);
  for (const state of ['loading', 'unavailable', undefined, true])
    assert.throws(() => verifyJapanStabilityBrandOptions(checked, sourceValues, state), /brand_filter_unavailable/);
  const repeatedCase = checkedJapanStabilityBrandDirectory({...payload(), counts: {...payload().counts, Toyota: 5}}, 200, now);
  assert.equal(verifyJapanStabilityBrandOptions(repeatedCase, sourceValues, 'ready').filterMakes, 4);
});

test('rail covers the whole canonical directory while retaining exact raw source aliases and verified visible fallback', () => {
  const proof = verifyJapanStabilityBrandRail(directory(), links(), visibleRows, pageUrl, 'ready');
  assert.deepEqual(proof, {railMakes: 4, completeSourceCovered: true, visibleFallbackMakes: 1, fallbackOnly: false,
    sourceLinksMatched: true, filterContextPreserved: true});
  const noFallback = visibleRows.slice(0, 1);
  assert.equal(verifyJapanStabilityBrandRail(directory(), links().slice(0, 3), noFallback, pageUrl, 'ready').visibleFallbackMakes, 0);
  const observedAlias = [...noFallback, {id: 'ajes-stats-B1', market: 'japan', make: 'Mercedes Benz'}];
  const withAlias = links().slice(0, 3); withAlias[0] = link('Mercedes-Benz', ['BENZ', 'MERCEDES', 'Mercedes Benz']);
  assert.equal(verifyJapanStabilityBrandRail(directory(), withAlias, observedAlias, pageUrl, 'ready').visibleFallbackMakes, 1);
});

test('rail rejects a page slice, invented makes, alias-only navigation, missing source aliases and altered filters', () => {
  const checked = directory();
  for (const values of [[], links().slice(1), [...links(), link('Ford', ['FORD'])],
    [links()[0], links()[0], ...links().slice(2)],
    [link('Mercedes-Benz', ['BENZ']), ...links().slice(1)],
    [link('Mercedes-Benz', ['Mercedes-Benz']), ...links().slice(1)],
    [link('Mercedes-Benz', ['BENZ', 'MERCEDES', 'MERCEDESX']), ...links().slice(1)]])
    assert.throws(() => verifyJapanStabilityBrandRail(checked, values, visibleRows, pageUrl, 'ready'), /brand_rail_/);
  const mutations = [
    href => href.replace('powerTo=160', 'powerTo=200'),
    href => href.replace('city=', 'otherCity='), href => href + '&make=MAZDA',
    href => href + '&stock=green', href => href + '&model=3', href => href + '#fragment',
    href => ORIGIN.replace('avtocena.com', 'other.example') + href,
    href => href.replace('/cars/japan', '/cars/china'),
    href => href.replace('/cars/japan', '/api/admin/japan'),
  ];
  for (const change of mutations) {
    const values = links(); values[1].href = change(values[1].href);
    assert.throws(() => verifyJapanStabilityBrandRail(checked, values, visibleRows, pageUrl, 'ready'), /brand_rail_/);
  }
  for (const rows of [[], [{...visibleRows[0], market: 'china'}], [{...visibleRows[0], id: 'unbound'}]])
    assert.throws(() => verifyJapanStabilityBrandRail(checked, links(), rows, pageUrl, 'ready'), /brand_rail_visible_source/);
  for (const state of ['loading', 'unavailable', undefined])
    assert.throws(() => verifyJapanStabilityBrandRail(checked, links(), visibleRows, pageUrl, state), /brand_rail_unavailable/);
});

function controlFixture({status = 200, stale = false, values = sourceValues, responseUrl = ORIGIN + JAPAN_STABILITY_BRANDS_API,
  state = 'ready', railState = 'ready', railLinks = links(), source = payload(), notice = false, movePage = false,
  recovery, railRecovery, hiddenChanged = false, fallbackRows = visibleRows, mobile = false} = {}) {
  let open = false, waiting, url = pageUrl, index = 0, currentRailState = railState, currentRailLinks = railLinks;
  const sequence = [{status, stale, values, state, source, notice}, recovery].filter(Boolean);
  const current = () => sequence[Math.min(index, sequence.length - 1)];
  const calls = {clicks: 0, requests: 0, observed: [], captures: 0, waits: [], dropdownRetries: 0, railRetries: 0};
  const request = () => {
    const row = current(); calls.requests++;
    const response = {url: () => responseUrl, request: () => ({method: () => 'GET'}), status: () => row.status ?? 200,
      json: async () => ({...(row.source ?? payload()), stale: row.stale ?? false, generationId: new Date(Date.now() - 1000).toISOString()}),
      headers: () => ({'content-type': 'application/json'})};
    assert(waiting, 'listen before action'); assert(waiting.predicate(response)); waiting.resolve(response);
  };
  const waitState = (actual, expected) => ({waitFor: async options => {
    calls.waits.push(options); assert(expected.includes(actual()), 'directory readiness');
  }});
  const retry = {count: async () => Number(current().state === 'unavailable'), isVisible: async () => open && current().state === 'unavailable',
    click: async () => { calls.dropdownRetries++; index++; request(); }};
  const dropdown = {waitFor: async () => assert(open),
    getAttribute: async key => { assert.equal(key, 'data-japan-source-directory-state'); return current().state; },
    locator: selector => { assert.equal(selector, 'button[data-facet-value]'); return {
      evaluateAll: async fn => fn((current().values ?? sourceValues).map(value => ({getAttribute: () => value}))) }; },
    getByText: () => ({count: async () => Number(Boolean(current().notice))}), getByRole: () => retry};
  const parent = {locator: selector => selector === '.ac-filter-dropdown' ? dropdown
    : waitState(() => current().state, [selector.includes('"unavailable"') ? 'unavailable' : 'ready'])};
  const form = {getAttribute: async key => { assert.equal(key, 'role'); return mobile ? 'dialog' : null; },
    waitFor: async () => {}, locator: selector => selector.includes('Расширенные фильтры')
    ? {waitFor: async options => assert.equal(options.state, 'attached')}
    : {evaluateAll: async fn => { assert.equal(selector, 'input[type="hidden"][name]'); return fn([
      {name: 'make', value: hiddenChanged && calls.railRetries ? 'MAZDA' : ''}, {name: 'model', value: ''}]); }}};
  const trigger = {count: async () => 1, getAttribute: async () => String(open), locator: selector => {
      assert(['..', 'xpath=ancestor::form[1]'].includes(selector)); return selector === '..' ? parent : form;
    }, click: async () => { calls.clicks++; open = !open; if (open) request(); if (movePage) url += '&make=TOYOTA'; }};
  const controls = {locator: selector => { assert.equal(selector, 'button[aria-label="Выбрать марки автомобилей"]:visible'); return trigger; }};
  const rail = {waitFor: async () => {}, getAttribute: async () => currentRailState, boundingBox: async () => ({y: 100, height: 80}),
    getByRole: () => ({count: async () => Number(currentRailState === 'unavailable' && Boolean(railRecovery)),
      isVisible: async () => currentRailState === 'unavailable', click: async () => {
        assert.equal(open, false, 'finish and close dropdown before rail remount'); calls.railRetries++;
        currentRailState = railRecovery.state; currentRailLinks = railRecovery.links;
      }}),
    locator: selector => { assert.equal(selector, 'a[title^="Автомобили "]'); return {
      evaluateAll: async fn => fn(currentRailLinks.map(row => ({getAttribute: key => row[key]}))) }; }};
  const cards = {nth: index => ({waitFor: async () => assert(index < fallbackRows.length)}),
    count: async () => fallbackRows.length, first: () => ({boundingBox: async () => ({y: 200, height: 100})}),
    filter: ({has}) => ({waitFor: async () => {}, count: async () => Number(fallbackRows.some(row => has.selector.includes(row.id)))})};
  const catalog = {locator: selector => { assert.equal(selector, 'article.ac-catalog-card,article.ac-catalog-list-row'); return cards; },
    getByText: () => ({count: async () => 0})};
  const view = {url: () => url, waitForResponse: (predicate, options) => {
    assert.equal(options.timeout, 45_000); return new Promise(resolve => { waiting = {predicate, resolve}; }); },
    locator: selector => {
      if (selector.startsWith('form.')) return form;
      if (selector.startsWith('form[role=')) return {waitFor: async options => assert.equal(options.state, 'visible')};
      if (selector.includes('section.ac-brand-rail')) return waitState(() => currentRailState,
        selector.includes('"unavailable"') ? ['ready', 'unavailable'] : ['ready']);
      if (selector.startsWith('a[href*=')) return {selector};
      assert.equal(selector, 'main.ac-ajes-catalog'); return catalog;
    }};
  const progress = {};
  return {calls, progress, run: extra => checkJapanStabilityBrandControl({view, controls, rail, visibleRows, progress,
    onResponse: value => calls.observed.push(value), capture: async page => { assert.equal(page, view); assert(open); calls.captures++; }, ...extra})};
}

test('live control check observes one real UI metadata response without changing selection or adding an explicit read', async () => {
  const fixture = controlFixture(), result = await fixture.run();
  assert.equal(fixture.calls.requests, 1); assert.equal(fixture.calls.clicks, 2);
  assert.equal(fixture.calls.observed.length, 1); assert.equal(fixture.calls.captures, 1);
  assert.equal(result.proof.completeSourceCovered, true); assert.equal(result.proof.aboveCars, true);
  assert.equal(result.proof.metadataRequests, 1); assert.equal(result.proof.selectionUnchanged, true);
  const mobile = controlFixture();
  assert.equal((await mobile.run({rail: undefined, expectedDirectory: result.directory})).proof.completeSourceCovered, true);
  assert.equal(mobile.calls.requests, 1); assert.equal(mobile.calls.clicks, 2);
});

test('live control cannot pass after filtered metadata, stale/empty source, fallback readiness or missing UI names', async () => {
  for (const options of [{responseUrl: ORIGIN + JAPAN_STABILITY_BRANDS_API + '&powerTo=160'}, {status: 503},
    {stale: true}, {source: {...payload(), counts: {}}}, {values: ['TOYOTA']}, {values: [...sourceValues, 'HONDA']},
    {state: 'unavailable'}, {railState: 'unavailable'}, {notice: true}, {movePage: true}, {railLinks: links().slice(1)}]) {
    const fixture = controlFixture(options);
    await assert.rejects(fixture.run());
    assert.equal(fixture.calls.requests, 1);
  }
  const fixture = controlFixture();
  await assert.rejects(fixture.run({rail: undefined, expectedDirectory: {...directory(), makes: ['TOYOTA']}}), /brand_directory_changed/);
});

const recovered = () => ({status: 200, stale: false, source: payload(), values: sourceValues, state: 'ready'});
const fallbackValues = ['TOYOTA', 'HONDA'];
const fallbackLinks = () => [link('Toyota', ['TOYOTA']), link('Honda', ['HONDA'])];

test('metadata shapes distinguish empty, malformed and unavailable counts without returning their values', () => {
  for (const [counts, countsType, entryCount, positiveCount, invalidCount] of [
    [undefined, 'missing', null, null, null], [null, 'null', null, null, null],
    [[], 'array', null, null, null], [{}, 'object', 0, 0, 0],
    [{TOYOTA: 24, HONDA: 0}, 'object', 2, 1, 0],
    [{private_name: 'private_value', HONDA: -1, TOYOTA: 1.5}, 'object', 3, 0, 3],
  ]) {
    const shape = japanStabilityBrandDirectoryShape({counts, stale: false}, 200);
    assert.deepEqual({...shape, countsSha256: null}, {status: 200, stale: false, countsType, entryCount,
      positiveCount, invalidCount, countsSha256: null});
    if (counts !== undefined) assert.match(shape.countsSha256, /^[a-f0-9]{64}$/);
    assert(!/private_name|private_value|TOYOTA/.test(JSON.stringify(shape)));
  }
  assert.equal(japanStabilityBrandDirectoryShape(null, 503).stale, null);
});

test('unavailable dropdown gets exactly one real retry, then requires the full fresh source', async () => {
  const f = controlFixture({source: {...payload(), counts: {}}, state: 'unavailable', values: fallbackValues,
    recovery: recovered()});
  const result = await f.run();
  assert.equal(f.calls.requests, 2); assert.equal(f.calls.dropdownRetries, 1); assert.equal(f.calls.clicks, 2);
  assert.equal(f.calls.observed.length, 2); assert.equal(f.calls.captures, 1);
  assert.equal(result.proof.completeSourceCovered, true); assert.equal(result.proof.fallbackOnly, false);
  assert.equal(result.proof.metadataRequests, 2); assert.equal(result.proof.dropdownRetryUsed, true);
  assert.equal(f.progress.dropdownFallback.completeSourceCovered, false);
  assert.equal(f.progress.dropdownFallback.fallbackOnly, true);
  assert.equal(f.progress.attempts[0].entryCount, 0); assert.equal(f.progress.attempts[0].validation, 'brand_directory_rows');
  assert.equal(f.progress.attempts[1].validation, 'fresh_complete'); assert.equal(f.progress.phase, 'complete');
});

test('desktop rail retry happens after the verified dropdown closes and never asks it for another response', async () => {
  const f = controlFixture({status: 503, state: 'unavailable', values: fallbackValues,
    recovery: recovered(), railState: 'unavailable', railLinks: fallbackLinks(),
    railRecovery: {state: 'ready', links: links()}});
  const result = await f.run();
  assert.equal(f.calls.requests, 2); assert.equal(f.calls.dropdownRetries, 1); assert.equal(f.calls.railRetries, 1);
  assert.equal(f.calls.clicks, 2); assert.equal(result.proof.railRetryUsed, true);
  assert.equal(result.proof.sourceLinksMatched, true); assert.equal(result.proof.selectionUnchanged, true);
  assert.equal(f.progress.railFallback.completeSourceCovered, false); assert.equal(f.progress.controlsKind, 'desktop');
});

test('mobile recovery stays bound to the prior complete directory and its current visible rows', async () => {
  const f = controlFixture({mobile: true, source: {...payload(), counts: {}}, state: 'unavailable',
    values: fallbackValues, recovery: recovered()});
  const result = await f.run({rail: undefined, expectedDirectory: directory()});
  assert.equal(result.proof.completeSourceCovered, true); assert.equal(result.proof.railRetryUsed, false);
  assert.equal(f.progress.controlsKind, 'mobile'); assert.equal(f.calls.requests, 2);
});

test('persistent unavailable source refuses after two observed responses and never certifies fallback', async () => {
  const f = controlFixture({source: {...payload(), counts: {}}, state: 'unavailable', values: fallbackValues});
  await assert.rejects(f.run(), /brand_directory_rows/);
  assert.equal(f.calls.requests, 2); assert.equal(f.calls.dropdownRetries, 1); assert.equal(f.calls.railRetries, 0);
  assert.equal(f.calls.captures, 0); assert.equal(f.progress.attempts.length, 2);
  assert.equal(f.progress.phase, 'metadata_retry'); assert.equal(f.progress.dropdownFallback.completeSourceCovered, false);
});

test('invented fallback names, missing visible makes or absent matching cards cannot trigger a retry', async () => {
  for (const patch of [{values: [...fallbackValues, 'FORD']}, {values: ['TOYOTA']},
    {fallbackRows: [{...visibleRows[0], id: 'ajes-stats-other'}, visibleRows[1]]}]) {
    const f = controlFixture({source: {...payload(), counts: {}}, state: 'unavailable', values: fallbackValues,
      recovery: recovered(), ...patch});
    await assert.rejects(f.run());
    assert.equal(f.calls.requests, 1); assert.equal(f.calls.dropdownRetries, 0);
  }
  assert.throws(() => verifyJapanStabilityBrandFallback(fallbackValues, [{id: 'foreign', market: 'china', make: 'TOYOTA'}], {}, 200),
    /brand_fallback_visible_source/);
});

test('a recovered response cannot replace complete UI names with fallback or alter hidden selections', async () => {
  for (const recovery of [{...recovered(), state: 'unavailable', values: fallbackValues},
    {...recovered(), values: sourceValues.slice(1)}]) {
    const f = controlFixture({source: {...payload(), counts: {}}, state: 'unavailable', values: fallbackValues, recovery});
    await assert.rejects(f.run()); assert.equal(f.calls.requests, 2); assert.equal(f.calls.dropdownRetries, 1);
  }
  const changed = controlFixture({railState: 'unavailable', railLinks: fallbackLinks(),
    railRecovery: {state: 'ready', links: links()}, hiddenChanged: true});
  await assert.rejects(changed.run(), /brand_control_changed/);
});

test('a rail may retain an actually observed stale source make until refresh, without calling it complete', async () => {
  const f = controlFixture({stale: true, source: {...payload(), counts: {SUZUKI: 2}}, state: 'unavailable',
    values: [...fallbackValues, 'SUZUKI'], recovery: recovered(), railState: 'unavailable',
    railLinks: [...fallbackLinks(), link('Suzuki', ['SUZUKI'])], railRecovery: {state: 'ready', links: links()}});
  const result = await f.run();
  assert.equal(f.progress.attempts[0].stale, true); assert.equal(f.progress.railFallback.fallbackMakes, 3);
  assert.equal(f.progress.railFallback.completeSourceCovered, false); assert.equal(result.proof.completeSourceCovered, true);
  assert(!result.directory.makes.includes('SUZUKI'));
  for (const initial of [undefined, {status: 503, data: {stale: true, counts: {SUZUKI: 2}}},
    {status: 200, data: {...payload(), stale: true, counts: {SUZUKI: '2'}}}]) {
    assert.throws(() => verifyJapanStabilityBrandRailFallback([...fallbackLinks(), link('Suzuki', ['SUZUKI'])],
      visibleRows, directory(), pageUrl, canonicalCatalogBrand, initial), /brand_rail_fallback_source_names/);
  }
});

test('request accounting accepts only one or two actual metadata responses per complete control', () => {
  const proof = requests => ({completeSourceCovered: true, fallbackOnly: false, metadataRequests: requests,
    dropdownRetryUsed: requests === 2, railRetryUsed: false});
  for (const pair of [[1, 1], [1, 2], [2, 1], [2, 2]])
    assert.equal(verifyJapanStabilityBrandRequestCount(pair[0] + pair[1], pair.map(proof)), pair[0] + pair[1]);
  for (const [actual, pair] of [[1, [proof(1), proof(1)]], [5, [proof(2), proof(3)]],
    [4, [proof(1), proof(2)]], [3, [proof(1), {...proof(2), dropdownRetryUsed: false}]],
    [2, [proof(1), {...proof(1), completeSourceCovered: false}]]])
    assert.throws(() => verifyJapanStabilityBrandRequestCount(actual, pair), /brand_directory_request_count/);
});

test('both workflows require actual directory retry fixtures on verified runtime before host contact', async () => {
  for (const name of ['verify-china-photo-code.yml', 'catalog-next-china-photo-release.yml']) {
    const raw = await fs.readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8');
    const steps = raw.split(/\n      - /), index = steps.findIndex(step => step.startsWith('name: Verify bounded Japan directory retries'));
    assert(index > 0, name); const fixture = steps[index];
    assert.match(fixture, /if: steps\.photo_scope\.outputs\.scope == 'catalog-japan-stability-v1'/);
    assert.match(fixture, /PHOTO_RUNTIME_ROOT="\$RUNNER_TEMP\/china-serving-runtime-\$DIRECTORY_SHA"/);
    assert.match(fixture, /JAPAN_BRAND_DIRECTORY_RETRY_REPORT="\$RUNNER_TEMP\/japan-brand-directory-retry-browser-report\.json" node --import tsx tests\/browser\/japan-brand-directory-retry\.mjs/);
    assert.doesNotMatch(fixture, /continue-on-error|\|\| true/);
    assert(steps.slice(0, index).some(step => step.includes('scripts/catalog-next/code-entry.mjs --verify')));
    assert(steps.slice(0, index).some(step => step.includes('playwright@1.55.0')));
    const after = name.startsWith('verify-') ? 'Test the native runtime' : 'Publish the code with existing China bytes';
    assert(steps.findIndex(step => step.startsWith('name: ' + after)) > index);
    assert(steps.slice(index + 1).some(step => step.includes('actions/upload-artifact@v4')
      && step.includes('japan-brand-directory-retry-browser-report.json')));
  }
});

test('brand requirement environment is exact and cannot be requested in an older browser scope', async t => {
  assert.equal(japanBrandDirectoryRequirement(undefined), false);
  assert.equal(japanBrandDirectoryRequirement('0'), false); assert.equal(japanBrandDirectoryRequirement('1'), true);
  for (const value of ['', true, false, 0, 1, null, 'true', 'false', '01', ' 1', '1\n'])
    assert.throws(() => japanBrandDirectoryRequirement(value), /brand_directory_option/);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-brand-gate-')); t.after(() => fs.rm(temp, {recursive: true, force: true}));
  for (const [index, requireBrandDirectory] of [true, '1', 1, null].entries()) {
    const report = await runJapanBrowserAcceptance({oraclePath: path.join(temp, 'not-read.json'), releaseSha: 'a'.repeat(40),
      nonce: 'b'.repeat(32), outputFile: path.join(temp, 'bad-' + index + '.json'), requireBrandDirectory,
      codeScope: index === 0 ? 'catalog-japan-pagination24-v1' : 'catalog-japan-stability-v1'});
    assert.equal(report.passed, false);
    assert.deepEqual(report.error, {stage: 'preconditions', code: 'japan_browser_brand_directory_option', timeout: false});
    assert.equal(report.explicitJapanApiRequests, 0); assert.notEqual(report.japanBrandDirectoryPassed, true);
  }
  const output = path.join(temp, 'cli.json');
  const rejected = spawnSync(process.execPath, ['scripts/catalog-next/japan-browser-acceptance.mjs'], {
    cwd: new URL('../', import.meta.url), env: {PATH: process.env.PATH, OUTPUT: output, CATALOG_JAPAN_BRAND_DIRECTORY_REQUIRED: 'true'},
    encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024});
  assert.equal(rejected.status, 1); assert.equal(rejected.stderr.trim(), 'japan_browser_report_failed');
  await assert.rejects(() => fs.access(output), {code: 'ENOENT'});
});
