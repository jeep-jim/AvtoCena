import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validatePaidKoreaLiveReceipt, assertPaidKoreaLivePayload, runPaidKoreaReportLive, paidKoreaProviderDataRequest} from './browser/paid-korea-report-live.mjs';
import {normalizePaidKoreaReport} from '../apps/web/components/catalog/paid-korea-report-contract';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/paid-korea-report.json', import.meta.url), 'utf8'));
const sample = (sourceOfferId: string, history: any) => ({
  sourceOfferId, offerId: createHash('sha256').update('encar_direct:' + sourceOfferId).digest('hex').slice(0, 24),
  history, inspection: {issue_date: fixture.inspection.issue_date, special_history: fixture.inspection.special_history, usage_changes: fixture.inspection.usage_changes, panels: fixture.inspection.panels},
});
const claims = sample('42196907', {...fixture.history, accidentCount: fixture.history.accidents.length});
const zero = sample('42196908', {own_damage_count: 0, own_damage_cost_won: 0, other_damage_count: 0, other_damage_cost_won: 0, accidentCount: 0});
const missing = {...sample('42196909', null), inspection: null};
const observedAt = '2026-11-13T10:20:30.000Z';
const receipt = {completed: true, provider: 'auto_api_encar', observedAt, coverage: {currentCount: 3, covered: 3, historyPresent: 2, historyMissing: 1, samples: {claims, zero, missing}}};

test('live supplier guard preserves baseline analytics and static galleries', () => {
  for (const url of ['https://api1.auto-api.com/api/v3/encar/offers', 'https://tru.ru/korea/report', 'https://fem.encar.com/cars/report/accident/42196907', 'http://87.242.72.57/api/', 'http://78.46.90.228/api/']) {
    assert.equal(paidKoreaProviderDataRequest(url, 'fetch'), true);
    assert.equal(paidKoreaProviderDataRequest(url, 'document'), true);
    assert.equal(paidKoreaProviderDataRequest(url, 'image'), false);
  }
  for (const url of ['https://mc.yandex.ru/watch/1', 'https://www.google-analytics.com/g/collect', 'https://avtocena.com/api/catalog/korea-report', 'https://auto-api.com.example.test/']) assert.equal(paidKoreaProviderDataRequest(url, 'fetch'), false);
});

test('live selection requires actual identity-bound categories and reports unavailable ones explicitly', () => {
  assert.deepEqual(validatePaidKoreaLiveReceipt(receipt).selected.map(row => row.category), ['claims', 'zero', 'missing']);
  const partial = validatePaidKoreaLiveReceipt({...receipt, coverage: {...receipt.coverage, samples: {claims, zero: null, missing: null}}});
  assert.equal(partial.selected.length, 1);
  assert.deepEqual(partial.unavailableCategories, ['zero', 'missing']);
  for (const samples of [
    {claims: null, zero: null, missing: null},
    {claims: {...claims, sourceOfferId: '42196908'}, zero, missing},
    {claims, zero: {...zero, history: {own_damage_count: null, other_damage_count: 0}}, missing},
    {claims, zero, missing: {...missing, history: {}}},
  ]) assert.throws(() => validatePaidKoreaLiveReceipt({...receipt, coverage: {...receipt.coverage, samples}}));
  assert.throws(() => validatePaidKoreaLiveReceipt({...receipt, completed: false}));
});

test('live API proof checks saved counts, money, observations and inspection maps rather than trusting displayed data', async () => {
  const context = {offerId: claims.offerId, lot: claims.sourceOfferId, observedAt, kind: 'history' as const};
  const body = normalizePaidKoreaReport(fixture, context);
  await assertPaidKoreaLivePayload(body, claims, 'history', observedAt);
  const history = body.kind === 'history' ? body.history : null;
  for (const wrong of [
    {...body, lot: '99999999'}, {...body, observedAt: '2026-11-14T10:20:30.000Z'},
    {...body, history: {...history, own_damage_cost_won: 0}},
    {...body, history: {...history, accidents: []}},
  ]) await assert.rejects(assertPaidKoreaLivePayload(wrong, claims, 'history', observedAt));
  const inspection = normalizePaidKoreaReport(fixture, {...context, kind: 'inspection'});
  await assertPaidKoreaLivePayload(inspection, claims, 'inspection', observedAt);
  await assert.rejects(assertPaidKoreaLivePayload({...inspection, inspection: null}, claims, 'inspection', observedAt));
  const absent = normalizePaidKoreaReport({history: null, inspection: null, diagnosis: null}, {offerId: missing.offerId, lot: missing.sourceOfferId, observedAt, kind: 'history'});
  await assertPaidKoreaLivePayload(absent, missing, 'history', observedAt);
});

test('live verifier persists failure before any network action when required identity is absent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'paid-korea-live-proof-'));
  try {
    const output = join(directory, 'report.json');
    const report = await runPaidKoreaReportLive({PAID_KOREA_REPORT_OUTPUT: output});
    assert.equal(report.passed, false);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.health.before, null);
    assert.equal(report.health.after, null);
    assert.deepEqual(report.network.violations, []);
    assert.match(report.error, /paid_report_expected_release_required/);
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), report);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
