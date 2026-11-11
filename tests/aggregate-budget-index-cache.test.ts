import test from 'node:test';
import assert from 'node:assert/strict';
import {AggregateBudgetIndexCache} from '../apps/web/lib/catalog/aggregate-budget-index-cache';
import {BudgetSortOrderCache} from '../apps/web/lib/catalog/budget-sort-order-cache';
import type {BudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
const part=(market:string,year=2024):BudgetCountIndex=>({version:3,bodyFilterVersion:1,displayOrderVersion:1,generationId:'g',sourceRows:1,rows:[[market,100,null,null,false,{id:market,make:'M',model:'Model',year,block:0}]],otherRows:[],pricingChunks:{[market]:[market+'.json']}});

test('refreshing a directory after five minutes preserves aggregate identity and the exact cached sort',async()=>{
 let now=0,sorts=0;const aggregates=new AggregateBudgetIndexCache(()=>now),orders=new BudgetSortOrderCache(()=>now);
 const china=part('china'),europe=part('europe');
 const read=async(parts:BudgetCountIndex[])=>{const index=(await aggregates.merge(parts))!;await orders.get({generation:'g',index:orders.indexKey(index),revision:'r',day:'d',city:'',mode:'year',pricing:[]},index.rows,async()=>{sorts++;return Uint32Array.from([0,1]);});return index;};
 const first=await read([china,europe]);now=300_001;
 assert.equal(await read([china,europe]),first);assert.equal(sorts,1);
 const changed=await read([part('china',2025),europe]);assert.notEqual(changed,first);assert.equal(changed.rows[0][5].year,2025);assert.equal(sorts,2);
 assert.deepEqual(changed.pricingChunks,{china:['china.json'],europe:['europe.json']});
 assert.equal(changed.sourceRows,2);
});

test('aggregate rejects missing/mixed generations and respects byte capacity and clearing',async()=>{
 const a=part('china'),b=part('europe');const cache=new AggregateBudgetIndexCache();
 assert.equal(await cache.merge([a,null]),null);assert.equal(await cache.merge([a,{...b,generationId:'other'}]),null);
 const first=await cache.merge([a,b]);cache.clear();assert.notEqual(await cache.merge([a,b]),first);
 const tiny=new AggregateBudgetIndexCache(Date.now,1);assert.notEqual(await tiny.merge([a,b]),await tiny.merge([a,b]));
 assert.deepEqual((await cache.merge([b,a]))?.rows.map(row=>row[0]),['europe','china']);
});
