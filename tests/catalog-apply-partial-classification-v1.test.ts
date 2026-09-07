import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { applyDecisions } from '../scripts/catalog-apply-partial-classification-v1.mjs';

const ledger = JSON.parse(fs.readFileSync('data/catalog/source-qualification-v1.json', 'utf8'));
const decisions = JSON.parse(fs.readFileSync('data/catalog/source-partial-classification-v1.json', 'utf8'));

test('partial classification applies current decisions without publishing or changing paused markets', () => {
  const next = applyDecisions(ledger, decisions);
  const byId = new Map(next.candidates.map((row: any) => [row.sourceId, row]));
  assert.equal(byId.get('chngoodcar_china_candidate')?.class, 'lead_only');
  assert.equal(byId.get('iautos_china_candidate')?.class, 'lead_only');
  assert.equal(byId.get('carvector_japan_stat_open')?.class, 'lead_only');
  assert.equal(byId.get('exportcar_japan_candidate')?.class, 'rejected');
  for (const id of ['chngoodcar_china_candidate','iautos_china_candidate','carvector_japan_stat_open','exportcar_japan_candidate']) {
    assert.equal(byId.get(id)?.publishAllowed, false);
  }
  for (const row of ledger.candidates.filter((x: any) => x.market === 'japan')) assert.deepEqual(byId.get(row.sourceId), row);
  assert.equal(next.updatedAt, ledger.updatedAt);
});

test('Good Car technical capability cannot override its commercial access blocker', () => {
  const next = applyDecisions(ledger, decisions);
  const row: any = next.candidates.find((x: any) => x.sourceId === 'chngoodcar_china_candidate');
  assert.match(row.exactScope, /ICE offers/);
  assert.ok(Array.isArray(row.blockersBeforePublication));
  assert.ok(row.blockersBeforePublication.length >= 4);
  assert.equal(row.publishAllowed, false);
  assert.equal(row.class, 'lead_only');
  assert.match(row.blockerBeforeAutomatedUse, /prior_written_approval/);
  assert.deepEqual(row.evidence, decisions.decisions.find((x: any) => x.sourceId === row.sourceId).evidence);
});

test('invalid decisions fail before changing the input registry', () => {
  const original = JSON.stringify(ledger);
  const duplicate = structuredClone(decisions);
  duplicate.decisions.push(duplicate.decisions[0]);
  assert.throws(() => applyDecisions(ledger, duplicate), /duplicate/);
  for (const change of [{ class: 'invented' }, { publishAllowed: true }, { market: 'wrong' }]) {
    const invalid = structuredClone(decisions);
    Object.assign(invalid.decisions[0], change);
    assert.throws(() => applyDecisions(ledger, invalid));
  }
  const paused = structuredClone(decisions);
  paused.pausedMarkets = [];
  paused.decisions.find((x: any) => x.market === 'japan').class = 'exact_catalog';
  assert.throws(() => applyDecisions(ledger, paused), /paused market/);
  assert.equal(JSON.stringify(ledger), original);
});

test('unrelated source classes are byte-semantically preserved', () => {
  const next = applyDecisions(ledger, decisions);
  const changed = new Set(decisions.decisions.map((x: any) => x.sourceId));
  for (const oldRow of ledger.candidates) {
    if (changed.has(oldRow.sourceId)) continue;
    const newRow = next.candidates.find((x: any) => x.sourceId === oldRow.sourceId);
    assert.deepEqual(newRow, oldRow);
  }
});
