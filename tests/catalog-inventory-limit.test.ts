import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogInventoryLimit,catalogMarketInventoryLimit} from '../scripts/lib/catalog-inventory-limit.mjs';
test('zero removes publication quotas without altering explicit bounded runs',()=>{
 assert.ok(catalogInventoryLimit('0')>100_000);
 assert.equal(catalogInventoryLimit('150000'),150000);
 assert.equal(catalogInventoryLimit(undefined),100000);
 for(const bad of ['no','-1','1.5','Infinity','9007199254740992'])assert.throws(()=>catalogInventoryLimit(bad));
});

test('Europe honors unlimited and explicit import sizes like the other markets',()=>{
 assert.equal(catalogMarketInventoryLimit('europe',catalogInventoryLimit('0')),Number.MAX_SAFE_INTEGER);
 assert.equal(catalogMarketInventoryLimit('europe',150000),150000);
 assert.equal(catalogMarketInventoryLimit('europe',20000),20000);
 for(const market of ['china','korea','uae','georgia','japan'])assert.equal(catalogMarketInventoryLimit(market,150000),150000);
});
