import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryDirectoryScopes, modelDirectoryMarkets} from '../apps/web/lib/catalog/market-selection';
test('only Japan asks a supplier for model names, even in a mixed search', () => {
 for (const market of ['china', 'korea', 'china|korea', 'europe', 'uae', 'georgia', 'green'])
  assert.deepEqual(modelDirectoryMarkets(market, 'Toyota'), []);
 for (const market of ['japan', 'korea|japan', ''])
  assert.deepEqual(modelDirectoryMarkets(market, 'Toyota'), ['japan']);
 assert.deepEqual(modelDirectoryMarkets('', ''), []);
});

test('a delayed China directory never holds Korea or the rest of the local picker', () => {
 assert.deepEqual(inventoryDirectoryScopes('china|korea|uae'), ['korea|uae', 'china']);
 assert.deepEqual(inventoryDirectoryScopes('korea'), ['korea']);
 assert.deepEqual(inventoryDirectoryScopes('china'), ['china']);
 assert.deepEqual(inventoryDirectoryScopes('green'), []);
 assert.deepEqual(inventoryDirectoryScopes(''), ['japan|korea|uae|europe|georgia', 'china']);
});
