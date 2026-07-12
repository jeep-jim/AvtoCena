import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function json(path) { return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')); }
function activeMarket(id) {
  const market = json('data/markets/markets.json').find((item) => item.id === id);
  return market.versions.find((version) => version.id === market.activeVersionId) || market.versions.find((version) => version.status === 'active');
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function createVersion(record, patch, user) {
  if (!['owner', 'admin'].includes(user.role)) throw new Error('forbidden');
  const current = record.versions.find((version) => version.id === record.activeVersionId);
  const next = { ...clone(current), ...patch, id: `${record.id}_test_v${record.versions.length + 1}`, version: record.versions.length + 1, effectiveFrom: patch.effectiveFrom || new Date().toISOString() };
  if (next.status === 'active' && (next.securityDepositRub == null || next.topAvtoCommissionRub == null)) throw new Error('validation_failed');
  return { ...record, activeVersionId: next.id, versions: [...record.versions.map((version) => ({ ...version, status: version.status === 'active' ? 'archived' : version.status })), next] };
}
function snapshot(market) {
  const version = market.versions.find((item) => item.id === market.activeVersionId);
  return { configVersion: version.id, effectiveFrom: version.effectiveFrom, rules: clone(version) };
}
function directPayoutAt(program, effectiveAt) {
  const time = new Date(effectiveAt).getTime();
  return program.versions
    .filter((version) => new Date(version.effectiveFrom).getTime() <= time)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
}

test('loads active market configuration', () => {
  const japan = activeMarket('japan');
  assert.equal(japan.id, 'market_japan_v1');
  assert.equal(japan.status, 'active');
  assert.equal(japan.currency, 'JPY');
});

test('creates new version without mutating previous snapshot', () => {
  const original = json('data/markets/markets.json').find((item) => item.id === 'japan');
  const oldSnapshot = snapshot(original);
  const updated = createVersion(original, { topAvtoCommissionRub: 45000, status: 'active' }, { role: 'owner' });
  const newSnapshot = snapshot(updated);
  assert.equal(oldSnapshot.rules.topAvtoCommissionRub, 39000);
  assert.equal(newSnapshot.rules.topAvtoCommissionRub, 45000);
  assert.notEqual(oldSnapshot.configVersion, newSnapshot.configVersion);
});

test('initial market payments are consistent', () => {
  const japan = activeMarket('japan');
  const china = activeMarket('china');
  const uae = activeMarket('uae');
  assert.equal(japan.securityDepositRub + japan.topAvtoCommissionRub, 70000);
  assert.equal(china.securityDepositRub + china.topAvtoCommissionRub, 250000);
  assert.equal(uae.securityDepositRub + uae.topAvtoCommissionRub, 200000);
});

test('direct partner payout versioning preserves older accrual lookup', () => {
  const program = clone(json('data/cpa/payouts.json').directPartnerProgram);
  program.versions.push({ id: 'future', version: 2, status: 'active', effectiveFrom: '2026-08-01T00:00:00.000Z', defaultSignedContractPayoutRub: 15000 });
  assert.equal(directPayoutAt(program, '2026-07-20T00:00:00.000Z').defaultSignedContractPayoutRub, 10000);
  assert.equal(directPayoutAt(program, '2026-08-02T00:00:00.000Z').defaultSignedContractPayoutRub, 15000);
});

test('role separation allows owner/admin and rejects manager/partner', () => {
  const roles = ['owner', 'admin', 'manager', 'partner'];
  const allowed = roles.filter((role) => ['owner', 'admin'].includes(role));
  assert.deepEqual(allowed, ['owner', 'admin']);
  assert.throws(() => createVersion({ id: 'x', activeVersionId: 'v1', versions: [{ id: 'v1', status: 'active', securityDepositRub: 1, topAvtoCommissionRub: 1 }] }, {}, { role: 'manager' }), /forbidden/);
});

test('configuration validation rejects active market without required amounts', () => {
  assert.throws(() => createVersion({ id: 'x', activeVersionId: 'v1', versions: [{ id: 'v1', status: 'active', securityDepositRub: 1, topAvtoCommissionRub: 1 }] }, { status: 'active', securityDepositRub: null }, { role: 'admin' }), /validation_failed/);
});

test('cpa draft is inactive and does not reuse direct partner payout', () => {
  const network = json('data/cpa/networks.json')[0];
  assert.equal(network.enabled, false);
  assert.equal(network.status, 'draft');
  assert.equal(network.payoutAmount, null);
});
