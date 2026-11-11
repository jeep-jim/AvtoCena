import test from 'node:test';
import assert from 'node:assert/strict';
import {japanQuoteCacheKey} from '../apps/web/lib/catalog/japan-delivered-preview';

test('Japan reusable quotes invalidate on every independently mutable authority',()=>{
 const index:any={version:1,generationId:'gen_test',entries:{a:{parameters:{engineCc:1500},sourcePrice:100000,sourceCurrency:'JPY'}}};
 const config={deliveryRub:50000},rates=[['JPY',0.6]],version='calculator1',day='2026-10-12';
 const key=japanQuoteCacheKey(index,config,rates,version,day);
 assert.equal(japanQuoteCacheKey(structuredClone(index),config,rates,version,day),key);
 const next=structuredClone(index);next.entries.a.parameters.engineCc=1800;
 assert.notEqual(japanQuoteCacheKey(next,config,rates,version,day),key);
 assert.notEqual(japanQuoteCacheKey({...index,generationId:'gen_next'},config,rates,version,day),key);
 assert.notEqual(japanQuoteCacheKey(index,{deliveryRub:60000},rates,version,day),key);
 assert.notEqual(japanQuoteCacheKey(index,config,[['JPY',0.7]],version,day),key);
 assert.notEqual(japanQuoteCacheKey(index,config,rates,'calculator2',day),key);
 assert.notEqual(japanQuoteCacheKey(index,config,rates,version,'2026-10-13'),key);
});
