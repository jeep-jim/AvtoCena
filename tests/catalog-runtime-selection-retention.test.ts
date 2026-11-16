import test from 'node:test';
import assert from 'node:assert/strict';
import {stalePriceSnapshotObjects} from '../scripts/lib/catalog-runtime-cleanup.mjs';

test('expired derived selections are bounded by exact context prefix and seven-day age',()=>{
 const now=Date.parse('2026-11-16T10:00:00Z'),old=new Date(now-8*86400000).toISOString();
 const prefix=`catalog/runtime-budget-selections-v1/korea/${'a'.repeat(64)}/`;
 const rows=[{key:prefix+'ready.json',lastModified:old},{key:prefix+`parts/korea/${'b'.repeat(64)}.json`,lastModified:old}];
 const protectedRows=[
  {key:prefix.replace('/korea/','/japan/')+'ready.json',lastModified:old},
  {key:`catalog/runtime-budget-selections-v2/korea/${'c'.repeat(64)}/ready.json`,lastModified:old},
  {key:`catalog/runtime-budget-selections-v1/korea/arbitrary/ready.json`,lastModified:old},
  {key:'catalog/manifest.json',lastModified:old},
  {key:'catalog/previous-manifest.json',lastModified:old},
  {key:'catalog/generations/gen_1_active/indexes/budget-markets-v3/ready.json',lastModified:old},
  {key:'catalog/internal/offers/korea/current.json',lastModified:old},
  {key:'catalog-editorial/current.json',lastModified:old},
  {key:'catalog/intake-cursors/v1/korea.json',lastModified:old},
 ];
 assert.deepEqual(stalePriceSnapshotObjects([...rows,...protectedRows],now),rows);
});

test('fresh, unknown or malformed ready groups retain every older referenced part',()=>{
 const now=Date.now(),old=new Date(now-8*86400000).toISOString();
 const prefix=`catalog/runtime-budget-selections-v1/china/${'a'.repeat(64)}/`;
 const part={key:prefix+`parts/china/${'b'.repeat(64)}.json`,lastModified:old};
 for(const protectedObject of [
  {key:prefix+'ready.json',lastModified:new Date(now).toISOString()},
  {key:prefix+'ready.json',lastModified:new Date(now-7*86400000).toISOString()},
  {key:prefix+'ready.json',lastModified:'unknown'},
  {key:prefix+'unexpected.json',lastModified:old},
  {key:prefix+`parts/korea/${'b'.repeat(64)}.json`,lastModified:old},
 ])assert.deepEqual(stalePriceSnapshotObjects([part,protectedObject],now),[]);
 const ready={key:prefix+'ready.json',lastModified:old};
 assert.deepEqual(stalePriceSnapshotObjects([ready,{...part,lastModified:new Date(now).toISOString()}],now),[]);
});
