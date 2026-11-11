import test from 'node:test';import assert from 'node:assert/strict';
import {catalogSearchProjectionSort} from '../apps/web/lib/catalog/storage';
import {catalogDisplayPrice,compareCatalogDisplayOrder,catalogDisplayOrderComparator} from '../apps/web/lib/catalog/display-order';
test('fresh delivered preview and compact price have identical default order despite empty legacy total',()=>{
 const older:any={id:'older',market:'korea',totalRub:2400000,powerHp:123,updatedAt:'2026-10-07T03:32:05Z'};
 const fresh:any={id:'fresh',market:'korea',totalRub:null,catalogPricingMode:'seller',sellerPriceRub:900000,deliveredCalculationPreview:{totalRub:2200000},powerHp:123,updatedAt:'2026-10-18T00:46:34Z'};
 const full=catalogSearchProjectionSort([older,fresh]).map(r=>r.id);
 const compact=catalogSearchProjectionSort([older,{...fresh,totalRub:2200000,catalogPricingMode:undefined,deliveredCalculationPreview:undefined}]).map(r=>r.id);
 assert.deepEqual(full,['fresh','older']);assert.deepEqual(compact,full);assert.equal(catalogDisplayPrice(fresh),2200000);
});
test('calculated expensive cars precede seller-only estimates; preview controls the price band',()=>{
 const seller={id:'seller',catalogPricingMode:'seller',totalRub:100000,powerHp:90};
 const expensive={id:'calculated',catalogPricingMode:'seller',totalRub:null,sellerPriceRub:9000000,deliveredCalculationPreview:{totalRub:16000000},powerHp:200};
 assert.equal(catalogDisplayPrice(expensive),16000000);
 for(const comparator of [compareCatalogDisplayOrder,catalogDisplayOrderComparator()])assert.deepEqual([seller,expensive].sort(comparator).map(r=>r.id),['calculated','seller']);
});
