import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSourceStates } from '../scripts/lib/catalog-source-intake.mjs';

test('a slow source does not prevent another source completing its pagination', async () => {
  let release!: () => void;
  const slowPage = new Promise<void>(resolve => { release = resolve; });
  const states = [{ sourceId: 'slow', done: false, pages: 0 }, { sourceId: 'fast', done: false, pages: 0 }];
  const run = collectSourceStates(states, () => ({ deadline: Date.now() + 10000 }), async state => {
    if (state.sourceId === 'slow') await slowPage;
    state.pages++;
    state.done = state.sourceId === 'slow' || state.pages === 3;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[0].pages, 0);
  assert.equal(states[1].pages, 3);
  release();
  await run;
  assert.equal(states[0].pages, 1);
});

test('completed sources and expired budgets make no new source requests', async () => {
  let calls = 0;
  await collectSourceStates([{ done: true }, { done: false }], () => ({ deadline: Date.now() - 1 }), async () => { calls++; });
  assert.equal(calls, 0);
});
