import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSourcePage, intakeState } from '../scripts/lib/catalog-source-intake.mjs';

test('a source repeating the same inventory under new cursors stops as partial, not complete', async () => {
  let calls = 0;
  const rows: any[] = [];
  const offer = { id: 'one', sourceId: 'test', market: 'georgia', year: 2024, status: 'active' };
  const source = { fetchPage: async () => ({ items: [offer], nextCursor: String(++calls) }), normalizeOffer: (row: any) => row, fetchImages: async () => [] };
  const state = intakeState(source, { sourceId: 'test' });
  const options = { market: 'georgia', deadline: Date.now() + 10000, maxRows: 1000, maxPages: 2000, minYear: 2020,
    snapshot: (row: any) => row, writeObservation: async (row: any) => { rows.push(row); }, checkpoint: async () => {} };
  for (let i = 0; i < 6; i++) await collectSourcePage(state, options);
  assert.equal(calls, 3);
  assert.equal(state.stopReason, 'repeated_page');
  assert.equal(state.seen.size, 1);
  assert.equal(rows.length, 2);
});

test('changing pages containing old vehicles are not mistaken for a repeated route', async () => {
  let calls = 0;
  const source = { fetchPage: async () => ({ items: [{ id: String(++calls), sourceId: 'test', market: 'georgia', year: 2010 }], nextCursor: String(calls) }), normalizeOffer: (row: any) => row, fetchImages: async () => [] };
  const state = intakeState(source, { sourceId: 'test' });
  const options = { market: 'georgia', deadline: Date.now() + 10000, maxRows: 1000, maxPages: 2000, minYear: 2020,
    snapshot: (row: any) => row, writeObservation: async () => {}, checkpoint: async () => {} };
  for (let i = 0; i < 5; i++) await collectSourcePage(state, options);
  assert.equal(calls, 5);
  assert.equal(state.done, false);
  assert.equal(state.outsideAge, 5);
});
