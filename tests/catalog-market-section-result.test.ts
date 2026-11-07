import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readMarketSection} from '../apps/web/lib/catalog/market-section-result';
test('one failed market cannot remove ready cards or masquerade as an empty result',async()=>{
 const errors:unknown[]=[];
 const [china,korea]=await Promise.all([
  readMarketSection(async()=>({id:'china',total:12,items:[{id:'real-car'}]}),{id:'china',total:0,items:[]},e=>errors.push(e)),
  readMarketSection(async()=>{throw Error('storage_timeout');},{id:'korea',total:0,items:[]},e=>errors.push(e)),
 ]);
 assert.equal(china.total,12);assert.equal(china.items[0].id,'real-car');assert.equal(china.unavailable,undefined);
 assert.equal(korea.unavailable,true);assert.equal(errors.length,1);
 const empty=await readMarketSection(async()=>({items:[],total:0}),{items:[],total:0},()=>assert.fail());
 assert.equal(empty.unavailable,undefined);assert.equal(empty.total,0);
});
test('framework redirects and not-found signals are not swallowed by section recovery',async()=>{
 for(const digest of ['NEXT_REDIRECT;replace;/cars;307;','NEXT_HTTP_ERROR_FALLBACK;404']){
  const error=Object.assign(Error('navigation'),{digest});
  await assert.rejects(readMarketSection(async()=>{throw error;},{items:[]},()=>assert.fail()),e=>e===error);
 }
});
test('unavailable groups stay visible, aggregate counts stay incomplete and empty-state is suppressed',()=>{
 const source=fs.readFileSync('apps/web/components/catalog/CatalogContent.tsx','utf8');
 assert.match(source,/market.unavailable \|\| market.total > 0/);
 assert.match(source,/countIncomplete:localIncomplete/);
 assert.match(source,/!selectedMarket&&!localIncomplete/);
 assert.match(source,/market.unavailable\?undefined:market.total/);
 assert.match(source,/Не удалось загрузить автомобили этого направления/);
});
