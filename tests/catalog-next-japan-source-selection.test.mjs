import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as scope from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {japanCrossoverRequirement, japanCrossoverSelection, verifyJapanCrossoverRows, verifyJapanCrossoverAppend,
  japanCrossoverAcceptancePassed, JAPAN_CROSSOVER_PAGE} from '../scripts/catalog-next/japan-crossover-browser.mjs';
import {sourcePriceOrderReport} from './helpers/japan-source-price-order-report-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const cursor = 'j2.k.2.0.2.' + hash('crossover') + '.' + hash('epoch') + '.-';
const rows = Array.from({length: 48}, (_, index) => ({id: 'ajes-stats-crossover-' + index, bodyType: 'suv', powerHp: index < 30 ? 150 : null}));
const items = rows.slice(24).map(row => ({id: row.id, market: 'japan', bodyType: 'suv',
  ...(row.powerHp === null ? {japanPowerUnknown: true} : {japanSupplierPower: {offerId: row.id, hp: row.powerHp, unit: 'hp', source: 'ajes_pw'}})}));
const appendHref = '/cars?' + new URLSearchParams({market: 'japan', city: 'Новокузнецк', bodyType: 'suv', powerTo: '160', page: '2', after: cursor});
function report() {
  const value = sourcePriceOrderReport();
  Object.assign(value, {japanCrossoverPower160Required: true, japanCrossoverPower160Passed: true});
  const observedAt = '2026-11-28T11:59:00.000Z';
  const page = {observedAt, sourcePages: 1, receiptsSha256: hash('receipts'), sourceReceiptsFresh: true, shown: 24};
  value.checks.crossoverPower160 = {contract: 'japan-crossover-power160-browser-v1', city: 'Новокузнецк', bodyType: 'suv', powerTo: 160,
    documentStatus: 200, ...verifyJapanCrossoverAppend({before: rows.slice(0, 24), items, after: rows}),
    firstPage: {...page, kind: 'rendered-ssr', page: 1, afterSha256: hash(''), ssrBindingMatched: true},
    nextPage: {...page, kind: 'append-api', status: 200, stale: false, partial: false, interrupted: false, total: null},
    cursor, continuationCursor: cursor, sameFilter: true, cityPreserved: true, bodyControlPreserved: true,
    powerControlPreserved: true, followedEmittedCursor: true, explicitApiReads: 0, ordinaryAppendRequests: 1,
    liveExhaustiveScan: false, pageErrors: 0, alerts: 0};
  return value;
}
function rejected() {
  return [
    value => { delete value.checks.crossoverPower160; },
    value => { value.checks = null; },
    value => { const proof = value.checks.crossoverPower160; proof.cursor = proof.continuationCursor = cursor.replace('.2.0.2.', '.1000001.0.2.'); },
    value => { const proof = value.checks.crossoverPower160; proof.cursor = proof.continuationCursor = cursor.replace('.2.0.2.', '.2.25.2.'); },
    value => { delete value.japanCrossoverPower160Required; },
    value => { value.japanCrossoverPower160Passed = false; },
    value => { value.checks.crossoverPower160.bodyType = 'hatchback'; },
    value => { value.checks.crossoverPower160.city = 'Москва'; },
    value => { value.checks.crossoverPower160.added = 0; },
    value => { value.checks.crossoverPower160.loadedAfter = 24; },
    value => { value.checks.crossoverPower160.duplicateIds = 1; },
    value => { value.checks.crossoverPower160.powerControlPreserved = false; },
    value => { value.checks.crossoverPower160.bodyControlPreserved = false; },
    value => { value.checks.crossoverPower160.oldIdsPreserved = false; },
    value => { value.checks.crossoverPower160.cursor = 'bad'; },
    value => { value.checks.crossoverPower160.nextPage.status = 409; },
    value => { value.checks.crossoverPower160.nextPage.partial = true; },
    value => { value.checks.crossoverPower160.nextPage.interrupted = true; },
    value => { value.checks.crossoverPower160.firstPage.ssrBindingMatched = false; },
    value => { value.checks.crossoverPower160.firstPage.kind = 'independent-api'; },
    value => { value.checks.crossoverPower160.firstPage.observedAt = '2026-11-28T11:00:00.000Z'; },
    value => { value.checks.crossoverPower160.explicitApiReads = 1; },
    value => { value.checks.crossoverPower160.liveExhaustiveScan = true; },
    value => { value.checks.crossoverPower160.powers[0] = 200; },
    value => { const proof = value.checks.crossoverPower160; proof.powers[47] = 150; proof.powersSha256 = hash(JSON.stringify(proof.powers)); },
  ].map(change => { const value = report(); change(value); return value; });
}

test('selection is a distinct exact profile, preserving every existing price, source and A4 gate', () => {
  const plan = {codeScope: scope.JAPAN_STABILITY_CODE_SCOPE, runtimeFiles: [...scope.JAPAN_STABILITY_SOURCE_SELECTION_CODE_PATHS],
    retainedRuntime: scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED_RUNTIME,
    acceptancePolicy: scope.JAPAN_OBSERVED_TIMING_POLICY, countAcceptance: scope.JAPAN_SOURCE_COUNT_POLICY};
  for (const name of ['isExactJapanStabilityScope', 'japanObservedTimingRequired', 'japanPowerOrderRequired',
    'japanBrandDirectoryRequired', 'japanPriceSortRequired', 'japanLiteralFamilyRequired', 'japanSourceCountRequired',
    'japanA4Power160ContinuationRequired', 'japanSourcePriceOrderRequired', 'japanSourceSelectionRequired'])
    assert.equal(scope[name](plan), true, name);
  assert.equal(scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS.length, 24);
  assert.equal(scope.JAPAN_STABILITY_SOURCE_PRICE_CANDIDATE_CODE_PATHS.length, 28);
  assert.equal(scope.JAPAN_STABILITY_SOURCE_SELECTION_CODE_PATHS.length, 41);
  assert.equal(scope.japanSourceSelectionRequired({...plan, runtimeFiles: [...scope.JAPAN_STABILITY_SOURCE_PRICE_CANDIDATE_CODE_PATHS]}), false);
  assert.equal(scope.japanSourceSelectionRequired({...plan, runtimeFiles: [...scope.JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS]}), false);
  for (const files of [plan.runtimeFiles.slice(1), [...plan.runtimeFiles, 'apps/web/lib/catalog/china-local-reader.ts'],
    [...plan.runtimeFiles, plan.runtimeFiles[0]]]) assert.equal(scope.isExactJapanStabilityScope({...plan, runtimeFiles: files}), false);
  assert.equal(scope.japanExactCountRequired(plan), false);
  assert(plan.runtimeFiles.every(file => scope.japanStabilityCompatibilityPaths(plan).includes(file)));
});

test('the screenshot selection and emitted continuation reject changed city, filters and arbitrary reads', () => {
  assert.equal(japanCrossoverRequirement('1'), true);
  for (const value of [undefined, '0']) assert.equal(japanCrossoverRequirement(value), false);
  for (const value of [true, null, 1, '']) assert.throws(() => japanCrossoverRequirement(value));
  assert.equal(japanCrossoverSelection(JAPAN_CROSSOVER_PAGE), null);
  assert.equal(japanCrossoverSelection(appendHref, {append: true, expectedCursor: cursor}), cursor);
  for (const href of [appendHref + '&bodyType=suv', appendHref + '&sort=totalRub', appendHref.replace('powerTo=160', 'powerTo=161'),
    appendHref.replace('bodyType=suv', 'bodyType=sedan'), appendHref.replace('page=2', 'page=3'), appendHref + '&countOnly=1',
    'https://supplier.example' + appendHref]) assert.throws(() => japanCrossoverSelection(href, {append: true}));
});

test('observed 24-to-48 rows must preserve body, power, identity, order and unknown lane', () => {
  assert.equal(verifyJapanCrossoverAppend({before: rows.slice(0, 24), items, after: rows}).loadedAfter, 48);
  for (const patch of [{bodyType: 'sedan'}, {powerHp: 161}, {id: rows[0].id}]) {
    const wrong = structuredClone(rows); Object.assign(wrong[24], patch);
    assert.throws(() => verifyJapanCrossoverRows(wrong));
  }
  const restarted = structuredClone(rows); restarted[47].powerHp = 150;
  assert.throws(() => verifyJapanCrossoverRows(restarted));
  const wrong = structuredClone(items); wrong[0].japanSupplierPower.offerId = 'ajes-stats-other';
  assert.throws(() => verifyJapanCrossoverAppend({before: rows.slice(0, 24), items: wrong, after: rows}));
  const swapped = structuredClone(rows); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.throws(() => verifyJapanCrossoverAppend({before: rows.slice(0, 24), items, after: swapped}));
});

test('complete source selection requires crossover plus all prior source-price proofs', () => {
  assert.equal(scope.japanSourceSelectionAcceptancePassed(report()), true);
  assert.equal(scope.japanSourceSelectionAcceptancePassed(sourcePriceOrderReport()), false);
  for (const value of rejected()) assert.equal(japanCrossoverAcceptancePassed(value), false);
  const value = report(); value.japanSourcePriceOrderPassed = false;
  assert.equal(japanCrossoverAcceptancePassed(value), true);
  assert.equal(scope.japanSourceSelectionAcceptancePassed(value), false);
});

test('Python host requires the same exact successor and independently rejects incomplete crossover evidence', () => {
  const values = [report(), ...rejected()], source = `import importlib.util,json,sys\nfrom pathlib import Path\np=Path(sys.argv[1])/'scripts/catalog-next/release-host.py'\ns=importlib.util.spec_from_file_location('host',p)\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nv=json.load(sys.stdin)\nfiles=sorted(m.checked_japan_stability_image_files(v['files'],True,m.JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED,m.JAPAN_SOURCE_COUNT_POLICY))\nprint(json.dumps({'files':files,'results':[m.japan_crossover_acceptance_passed(x) for x in v['reports']]}))`;
  const child = spawnSync('python3', ['-c', source, root], {encoding: 'utf8', input: JSON.stringify({files: scope.JAPAN_STABILITY_SOURCE_SELECTION_CODE_PATHS, reports: values})});
  assert.equal(child.status, 0, child.stderr);
  const parsed = JSON.parse(child.stdout);
  assert.deepEqual(parsed.files, [...scope.JAPAN_STABILITY_SOURCE_SELECTION_CODE_PATHS].sort());
  assert.deepEqual(parsed.results, values.map(japanCrossoverAcceptancePassed));
});

test('controller, live producer, host seal and exact-runtime fixture all retain the mandatory crossover gate', () => {
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(read('scripts/catalog-next/daily-release.mjs'), /CATALOG_JAPAN_CROSSOVER_POWER160_REQUIRED: japanSourceSelectionRequired\(servingPlan\)/);
  assert.match(read('scripts/catalog-next/daily-release.mjs'), /if \(japanSourceSelectionRequired\(servingPlan\)\) need\(japanSourceSelectionAcceptancePassed/);
  assert.match(read('scripts/catalog-next/japan-browser-acceptance.mjs'), /if\(requireCrossoverPower160\)await runJapanCrossoverBrowser/);
  assert.match(read('scripts/catalog-next/release-host.py'), /if runtime_profile == JAPAN_STABILITY_SOURCE_SELECTION_CODE_FILES:\n\s+need\(japan_crossover_acceptance_passed/);
  assert.match(read('tests/browser/japan-price-sort.mjs'), /await runJapanCrossoverBrowser/);
  assert.match(read('tests/browser/japan-price-sort.mjs'), /need\(japanCrossoverAcceptancePassed\(result\),'crossover_proof'\)/);
});
