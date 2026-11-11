import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual pure compiler function without running corpus writes.
const code = fs.readFileSync('scripts/catalog-compile-knowledge-core.mjs', 'utf8');
const start = code.indexOf('function directFacts(row) {');
const end = code.indexOf('\nconst factFields', start);
assert.ok(start >= 0 && end > start);
const directFacts = vm.runInNewContext(`(${code.slice(start, end).trim()})`, {
  positive: (v: unknown) => Number(v) > 0 ? Number(v) : null,
  normalizedPowertrain: () => 'ICE', normalizedFuel: () => 'petrol',
  clean: (v: unknown) => String(v ?? '').trim(),
});

test('compiled Autohome facts never promote litre labels to exact cc', () => {
  for (const engineLiters of [1.5, 1.6, 2, 3]) {
    assert.equal(directFacts({ sourceId: 'autohome-china', engineLiters }).engineCc, null);
  }
  assert.equal(directFacts({ sourceId: 'autohome-china', engineLiters: 1.5, engineCc: 1498 }).engineCc, 1498);
});
