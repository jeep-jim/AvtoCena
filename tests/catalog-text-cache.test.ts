import test from 'node:test';
import assert from 'node:assert/strict';
import {translateCatalogText} from '../apps/web/lib/catalog/presentation';

function measured(value: unknown) {
  const original = RegExp.prototype[Symbol.replace];
  let replacements = 0;
  RegExp.prototype[Symbol.replace] = function (...args: any[]) {
    replacements++;
    return (original as any).apply(this, args);
  } as typeof original;
  try { return {text: translateCatalogText(value), replacements}; }
  finally { RegExp.prototype[Symbol.replace] = original; }
}

test('repeated catalog labels skip phrase processing without retaining mutable objects', () => {
  const input = {name: '丰田 Corolla cache-parity-unique'};
  const cold = measured(input), warm = measured(input);
  assert.equal(cold.text, 'Toyota Corolla cache-parity-unique');
  assert.equal(warm.text, cold.text);
  assert.ok(cold.replacements > 200);
  assert.ok(warm.replacements < 10);
  input.name = '本田 Civic cache-parity-unique';
  assert.equal(translateCatalogText(input), 'Honda Civic cache-parity-unique');
  assert.equal(translateCatalogText(['丰田', 'Corolla cache-parity-unique']), cold.text);
});

test('unique and oversized labels do not accumulate an unbounded translation cache', () => {
  const first = '丰田 cache-eviction-first';
  const expected = translateCatalogText(first);
  for (let i = 0; i < 600; i++) translateCatalogText(`本田 cache-churn-${i}`);
  const evicted = measured(first);
  assert.equal(evicted.text, expected);
  assert.ok(evicted.replacements > 200);
  const long = '丰田 ' + 'x'.repeat(600);
  assert.equal(measured(long).text, 'Toyota ' + 'x'.repeat(600));
  assert.ok(measured(long).replacements > 200);
});
