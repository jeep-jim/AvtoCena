import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePaidKoreaReport, validPaidKoreaReport} from '../apps/web/components/catalog/paid-korea-report-contract';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/paid-korea-report.json', import.meta.url), 'utf8'));
const context = {offerId: '0123456789abcdef01234567', lot: '42196907', kind: 'history' as const, observedAt: '2026-11-13T10:20:30.000Z'};
const normalize = (row: unknown, kind: 'history' | 'inspection' = 'history') => normalizePaidKoreaReport(row, {...context, kind});

test('preserves explicit zero, positive KRW amounts, dates and Russian claim parties', () => {
  const report = normalize(fixture);
  assert.equal(report.kind, 'history');
  if (report.kind !== 'history') throw Error('wrong kind');
  assert.equal(report.history?.own_damage_count, 4);
  assert.equal(report.history?.own_damage_cost_won, 3085736);
  assert.equal(report.history?.other_damage_count, 2);
  assert.equal(report.history?.total_loss_count, 0);
  assert.equal(report.history?.flood_partial_loss_count, null);
  assert.equal(report.history?.rental_history, false);
  assert.equal(report.history?.commercial_history, true);
  assert.equal(report.history?.accidents?.[0].paid_by, 'Страховая компания владельца');
  assert.equal(report.history?.accidents?.[1].insurance_benefit_won, 0);
  assert.equal(report.history?.accidents?.[1].labor_won, null);
  assert.equal(report.history?.owner_change_dates?.[0], '2023-07-12');
  assert.deepEqual(report.history?.uninsured_periods, [{from: '2025-01', to: '2025-02'}]);
  assert.ok(validPaidKoreaReport(JSON.parse(JSON.stringify(report)), context.offerId, context.lot, 'history'));
});

test('absent, null, empty, wrong-shaped or unknown-only sections never become zero reports', () => {
  for (const history of [undefined, null, {}, [], 'not-a-report', {vehicle: {vin: 'PRIVATE'}}]) {
    const report = normalize({history});
    assert.equal(report.kind === 'history' && report.history, null);
  }
  const zero = normalize({history: {own_damage_count: 0, own_damage_cost_won: 0}});
  assert.equal(zero.kind === 'history' && zero.history?.own_damage_count, 0);
  assert.equal(zero.kind === 'history' && zero.history?.other_damage_count, null);
  const missing = normalize({inspection: null, diagnosis: null}, 'inspection');
  assert.equal(missing.kind === 'inspection' && missing.inspection, null);
  assert.equal(missing.kind === 'inspection' && missing.diagnosis, null);
});

test('rejects coercion, negatives, unsafe/fractional counts and money without hiding valid facts', () => {
  for (const invalid of ['0', '', false, true, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}]) {
    const report = normalize({history: {report_date: '2026-11-12', own_damage_count: invalid, own_damage_cost_won: invalid, rental_history: 'false'}});
    if (report.kind !== 'history') throw Error('wrong kind');
    assert.equal(report.history?.own_damage_count, null);
    assert.equal(report.history?.own_damage_cost_won, null);
    assert.equal(report.history?.rental_history, null);
    assert.equal(report.history?.report_date, '2026-11-12');
  }
});

test('bounds arrays, dates and text; does not silently omit invalid claims from an accepted list', () => {
  const report = normalize({history: {
    own_damage_count: 4, report_date: '2026-02-30', use: 'x'.repeat(181),
    accidents: [{date: '2024-01-01', insurance_benefit_won: 100}, 'malformed'],
    owner_change_dates: Array(101).fill('2025-01-01'),
    uninsured_periods: [{from: '2025-13', to: '2025-14'}],
  }});
  if (report.kind !== 'history') throw Error('wrong kind');
  assert.equal(report.history?.own_damage_count, 4);
  for (const key of ['report_date', 'use', 'accidents', 'owner_change_dates', 'uninsured_periods']) assert.equal(report.history?.[key], null);
});

test('projects known structured inspection and diagnosis without personal records, free text or URLs', () => {
  const history = normalize(fixture), report = normalize(fixture, 'inspection');
  if (report.kind !== 'inspection') throw Error('wrong kind');
  assert.equal(report.inspection?.mileage, 83045);
  assert.equal(report.inspection?.record_number, '3035008743');
  assert.deepEqual(report.inspection?.special_history, ['Изменение конструкции']);
  assert.deepEqual(report.inspection?.usage_changes, []);
  assert.equal(report.inspection?.accident, false);
  assert.equal(report.inspection?.simple_repair, true);
  assert.equal(report.inspection?.co_percent, 0.03);
  assert.equal(report.inspection?.panels?.['Наружные панели']['Переднее левое крыло'], 'Замена');
  assert.deepEqual(report.inspection?.panel_codes?.P011, ['X']);
  assert.equal(report.inspection?.systems?.['Двигатель']['Головка блока'], 'Следы масла');
  assert.equal(report.diagnosis?.panel_codes?.P011, 'Замена');
  const publicJson = JSON.stringify([history, report]);
  for (const privateValue of ['PRIVATE-', 'KMHAA81KBU1234567', '+79991234567', 'https://', 'seller', 'photos', 'scans', 'comment', '"vehicle"', '"plate"']) assert.ok(!publicJson.includes(privateValue), privateValue);
  assert.ok(validPaidKoreaReport(report, context.offerId, context.lot, 'inspection'));
});

test('malformed inspection maps and unverified labels remain unavailable rather than negative findings', () => {
  const report = normalize({inspection: {
    accident: 'false', flood: 0, mileage: '83045', issue_date: '2026-10-20',
    record_number: '<invalid>', special_history: false, usage_changes: 'none',
    panels: {'Кузов': ['clean']}, systems: {'Двигатель': {VIN: 'KMHAA81KBU1234567'}},
    panel_codes: {P011: 'X'},
  }, diagnosis: {date: '2026-10-21', panels: {'Крыло': ['Замена']}, panel_codes: {'invalid': 'Замена'}}}, 'inspection');
  if (report.kind !== 'inspection') throw Error('wrong kind');
  for (const key of ['accident', 'flood', 'mileage', 'record_number', 'special_history', 'usage_changes', 'panels', 'systems', 'panel_codes']) assert.equal(report.inspection?.[key], null);
  assert.equal(report.diagnosis?.panels, null);
  assert.equal(report.diagnosis?.panel_codes, null);
});

test('browser validation rejects foreign identity, malformed scalars and any extra fields', () => {
  const report = normalize(fixture);
  for (const changed of [
    {...report, version: 2}, {...report, provider: 'ajes_korea_feed'}, {...report, offerId: '111111111111111111111111'},
    {...report, lot: '43015054'}, {...report, kind: 'inspection'}, {...report, observedAt: 'invalid'},
    {...report, sourceUrl: 'https://private.invalid/'},
    {...report, history: {...(report.kind === 'history' ? report.history : {}), own_damage_count: '0'}},
    {...report, history: {...(report.kind === 'history' ? report.history : {}), seller: 'PRIVATE'}},
  ]) assert.equal(validPaidKoreaReport(changed, context.offerId, context.lot, 'history'), false);
  const empty = normalize({history: null});
  assert.ok(validPaidKoreaReport(empty, context.offerId, context.lot, 'history'));
});

test('normalizer requires a valid exact display context', () => {
  for (const changed of [{offerId: 'ajes-korea-123'}, {lot: '123'}, {lot: 42196907}, {kind: 'other'}, {observedAt: '2026-02-30T12:00:00Z'}, {observedAt: ''}]) {
    assert.throws(() => normalizePaidKoreaReport(fixture, {...context, ...changed} as any), /invalid_paid_korea_report_context/);
  }
});
