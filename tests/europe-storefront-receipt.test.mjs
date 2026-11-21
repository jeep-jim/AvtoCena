import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEuropeStorefront} from '../scripts/catalog-check-europe-storefront.mjs';
const receipt={market:'europe',published:true,publishedMarketCount:3,generationId:'eu-write',byMarketAndSource:{europe:{autoscout_europe_open:3}}};
function storefront({source='autoscout_europe_open',power=120,total=3}={}){
 return async url=>{
  const row={id:'1',market:'europe',year:2023,sourceId:source,powerHp:power};
  const result=url.endsWith('market-counts')?{markets:{europe:total}}:
   url.includes('powerTo')?{total:1,items:[row]}:{total,items:[row,{...row,id:'2'},{...row,id:'3'}]};
  return Response.json({ok:true,generationId:'shared-generation-after-uae',...result});
 };
}
test('published Europe volume and a real filtered page survive another market refreshing',async()=>{
 const result=await checkEuropeStorefront(receipt,storefront());assert.equal(result.filter160Count,1);
});
test('stale volume, retired sources and incorrect horsepower fail public confirmation',async()=>{
 await assert.rejects(checkEuropeStorefront(receipt,storefront({total:38964})),/public_europe_count/);
 await assert.rejects(checkEuropeStorefront(receipt,storefront({source:'mobile_de_open'})),/retired_source/);
 await assert.rejects(checkEuropeStorefront(receipt,storefront({power:180})),/filter_power/);
});
