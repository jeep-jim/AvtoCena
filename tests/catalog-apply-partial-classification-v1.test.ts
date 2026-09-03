import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { applyDecisions } from '../scripts/catalog-apply-partial-classification-v1.mjs';

const ledger = JSON.parse(fs.readFileSync('data/catalog/source-qualification-v1.json', 'utf8'));
const decisions = JSON.parse(fs.readFileSync('data/catalog/source-partial-classification-v1.json', 'utf8'));

test('partial classification assigns exactly the four evidence-backed classes and never publishes', () => {
  const next = applyDecisions(ledger, decisions);
  const byId = new Map(next.candidates.map((row: any) => [row.sourceId, row]));
  assert.equal(byId.get('chngoodcar_china_candidate')?.class, 'exact_catalog');
  assert.equal(byId.get('iautos_china_candidate')?.class, 'lead_only');
  assert.equal(byId.get('carvector_japan_stat_open')?.class, 'lead_only');
  assert.equal(byId.get('exportcar_japan_candidate')?.class, 'rejected');
  for (const id of ['chngoodcar_china_candidate','iautos_china_candidate','carvector_japan_stat_open','exportcar_japan_candidate']) {
    assert.equal(byId.get(id)?.publishAllowed, false);
  }
});

test('Good Car exact classification is explicitly gated before publication', () => {
  const next = applyDecisions(ledger, decisions);
  const row: any = next.candidates.find((x: any) => x.sourceId === 'chngoodcar_china_candidate');
  assert.match(row.exactScope, /ICE offers/);
  assert.ok(Array.isArray(row.blockersBeforePublication));
  assert.ok(row.blockersBeforePublication.length >= 4);
  assert.equal(row.publishAllowed, false);
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
