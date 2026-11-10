import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseMarkets} from '../scripts/lib/release-market-scope.mjs';
test('explicit scope cannot silently turn into all markets',()=>{
 assert.equal(releaseMarkets(undefined),null);
 assert.deepEqual(releaseMarkets('korea'),['korea']);
 assert.deepEqual(releaseMarkets(['korea','japan']),['korea','japan']);
 for(const value of [[],['korea','korea'],'korea,','all','Korea',{},['china; echo bad']])assert.throws(()=>releaseMarkets(value),/scope_invalid/);
});
