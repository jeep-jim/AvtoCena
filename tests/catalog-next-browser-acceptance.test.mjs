import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {browserOracleCases, verifyRenderedChinaCards, verifyHomeChinaCards, verifyHomeChinaApi, runChinaBrowserAcceptance} from '../scripts/catalog-next/browser-acceptance.mjs';

const release = 'a'.repeat(40), generation = 'gen_china_45349439965_1', id = '1'.repeat(24);
const sample = (name, filters) => ({name, path: '/api/catalog/search?' + new URLSearchParams({market: 'china', marketPage: '1', preparedCut: generation, ...filters}),
  total: 1, ids: [id], totalRub: [1500000]});
const power = {...sample('china-power-to-160', {powerTo: '160'}), power: [{displayHp: 204, displayKw: 150, utilizationKw: 110, filterPowerHp: 149.5582}]};
const model = sample('popular-model-2014-novokuznetsk', {make: 'Audi', model: 'A6', yearFrom: '2014', city: 'Новокузнецк'});
const home = sample('china-first-page', {});
const oracle = {version: 1, runtimeSha: release, pricingRuntimeSha: 'f'.repeat(40), generationManifestSha256: 'b'.repeat(64), expectedGeneration: generation, cases: [home, power, model]};
const speed = {release, passed: true, browserPassed: true, speedGuard: {passed: true}};
const rendered = [{id, href: `https://avtocena.com/cars/offer/${id}/car?market=china&preparedCut=${generation}`, price: 1500000, hp: [204], kw: [150, 110]}];

test('additional browser evidence requires the exact already-passed speed gate and bound oracle', () => {
  assert.equal(browserOracleCases(oracle, release, speed).power, power);
  assert.throws(() => browserOracleCases(oracle, release, {...speed, passed: false}), /preceding_speed_gate/);
  assert.throws(() => browserOracleCases(oracle, release, {...speed, release: 'c'.repeat(40)}), /preceding_speed_gate/);
  assert.throws(() => browserOracleCases({...oracle, runtimeSha: 'c'.repeat(40)}, release, speed), /oracle_binding/);
  const wrongCut = {...power, path: power.path.replace(generation, 'gen_china_7_1')};
  assert.throws(() => browserOracleCases({...oracle, cases: [home, wrongCut, model]}, release, speed), /case_shape/);
});

test('visible peak power is checked against the saved display while the 160 filter uses certified calculation power', () => {
  const result = verifyRenderedChinaCards(rendered, 1, power, generation, {limit: 6, power: true});
  assert.equal(result.visiblePowerMatched, true); assert(result.maxFilterPowerHp < 160);
  assert.throws(() => verifyRenderedChinaCards([{...rendered[0], hp: [150]}], 1, power, generation, {limit: 6, power: true}), /visible_power_hp/);
  assert.throws(() => verifyRenderedChinaCards(rendered, 1, {...power, power: [{...power.power[0], filterPowerHp: 170}]}, generation, {power: true}), /filtered_power/);
});

test('counts, exact first IDs, prepared links and city prices must all match the same generation', () => {
  assert.equal(verifyRenderedChinaCards(rendered, 1, model, generation, {prices: true}).pricesMatched, true);
  assert.throws(() => verifyRenderedChinaCards(rendered, 2, model, generation), /section_count/);
  assert.throws(() => verifyRenderedChinaCards([{...rendered[0], id: '2'.repeat(24)}], 1, model, generation), /section_ids/);
  assert.throws(() => verifyRenderedChinaCards([{...rendered[0], href: rendered[0].href.replace(generation, 'gen_china_7_1')}], 1, model, generation), /card_context/);
  assert.throws(() => verifyRenderedChinaCards([{...rendered[0], price: 1600000}], 1, model, generation, {prices: true}), /card_price/);
});

test('homepage balanced cards and independent home API preserve the exact native set, count, generation and prices', () => {
  const second = '2'.repeat(24), expected = {...home, total: 2, ids: [id, second], totalRub: [1500000, 1700000]};
  const cards = [{...rendered[0], id: second, price: 1700000, href: rendered[0].href.replace(id, second)}, rendered[0]];
  assert.equal(verifyHomeChinaCards(cards, 2, expected, generation).balancedOrderAllowed, true);
  assert.throws(() => verifyHomeChinaCards([rendered[0], rendered[0]], 2, expected, generation), /home_duplicate_id/);
  assert.throws(() => verifyHomeChinaCards([{...cards[0], price: 1500000}, cards[1]], 2, expected, generation), /card_price/);
  const payload = {independentChina: true, marketCounts: {china: 2}, countIncomplete: true,
    items: cards.map(card => ({id: card.id, market: 'china', totalRub: card.price, preparedChinaSelection: {generationId: generation}}))};
  assert.equal(verifyHomeChinaApi(payload, expected, generation).incompleteOtherMarkets, true);
  assert.throws(() => verifyHomeChinaApi({...payload, independentChina: false}, expected, generation), /home_api_authority/);
  assert.throws(() => verifyHomeChinaApi({...payload, marketCounts: {china: 999}}, expected, generation), /home_api_authority/);
  const bad = structuredClone(payload); bad.items[0].preparedChinaSelection.generationId = 'old';
  assert.throws(() => verifyHomeChinaApi(bad, expected, generation), /home_api_generation/);
  const wrongPrice = structuredClone(payload); wrongPrice.items[0].totalRub = null;
  assert.throws(() => verifyHomeChinaApi(wrongPrice, expected, generation), /home_api_price/);
});

test('a failed preceding gate writes sanitized failure without loading Chromium or warming any URL', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-browser-precondition-')); t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const oraclePath = path.join(directory, 'oracle.json'), gatePath = path.join(directory, 'gate.json'), outputFile = path.join(directory, 'report.json');
  await fs.writeFile(oraclePath, JSON.stringify(oracle)); await fs.writeFile(gatePath, JSON.stringify({...speed, passed: false}));
  const result = await runChinaBrowserAcceptance({oraclePath, releaseSha: release, nonce: 'd'.repeat(32), outputFile,
    precedingSpeedReportPath: gatePath, playwrightModule: 'THIS_MODULE_MUST_NOT_BE_IMPORTED'});
  assert.equal(result.passed, false); assert.equal(result.error.code, 'china_browser_preceding_speed_gate');
  assert.deepEqual(result.checks, []); assert.equal((await fs.stat(outputFile)).mode & 0o777, 0o600);
  const text = await fs.readFile(outputFile, 'utf8'); assert(!text.includes(id)); assert(!text.includes('THIS_MODULE_MUST_NOT_BE_IMPORTED'));
});
