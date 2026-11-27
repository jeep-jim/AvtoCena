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
  verifyJapanStabilityBrandOptions, verifyJapanStabilityBrandRail as verifyRail, checkJapanStabilityBrandControl}
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
  state = 'ready', railState = 'ready', railLinks = links(), source = payload(), notice = false, movePage = false} = {}) {
  let open = false, waiting, url = pageUrl;
  const calls = {clicks: 0, requests: 0, observed: [], captures: 0, waits: []};
  const response = {url: () => responseUrl, request: () => ({method: () => 'GET'}), status: () => status,
    json: async () => ({...source, stale, generationId: new Date(Date.now() - 1000).toISOString()}), headers: () => ({'content-type': 'application/json'})};
  const ready = value => ({waitFor: async options => { calls.waits.push(options); assert.equal(value, 'ready', 'directory readiness'); }});
  const dropdown = {waitFor: async () => assert(open),
    getAttribute: async key => { assert.equal(key, 'data-japan-source-directory-state'); return state; },
    locator: selector => { assert.equal(selector, 'button[data-facet-value]'); return {
      evaluateAll: async fn => fn(values.map(value => ({getAttribute: () => value}))) }; },
    getByText: () => ({count: async () => Number(notice)}), getByRole: () => ({count: async () => Number(notice)})};
  const parent = {locator: selector => selector === '.ac-filter-dropdown' ? dropdown : ready(state)};
  const trigger = {count: async () => 1, getAttribute: async () => String(open), locator: selector => { assert.equal(selector, '..'); return parent; },
    click: async () => { calls.clicks++; open = !open; if (open) { calls.requests++; assert(waiting, 'listen before opening');
      assert(waiting.predicate(response)); waiting.resolve(response); } if (movePage) url += '&make=TOYOTA'; }};
  const controls = {locator: selector => { assert.equal(selector, 'button[aria-label="Выбрать марки автомобилей"]:visible'); return trigger; }};
  const rail = {waitFor: async () => {}, getAttribute: async () => railState, boundingBox: async () => ({y: 100, height: 80}),
    locator: selector => { assert.equal(selector, 'a[title^="Автомобили "]'); return {
      evaluateAll: async fn => fn(railLinks.map(row => ({getAttribute: key => row[key]}))) }; }};
  const view = {url: () => url, waitForResponse: (predicate, options) => {
    assert.equal(options.timeout, 45_000); return new Promise(resolve => { waiting = {predicate, resolve}; }); },
    locator: selector => selector.includes('section.ac-brand-rail') ? ready(railState) : {
      locator: () => ({first: () => ({boundingBox: async () => ({y: 200, height: 100})})}) }};
  return {calls, run: extra => checkJapanStabilityBrandControl({view, controls, rail, visibleRows,
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
