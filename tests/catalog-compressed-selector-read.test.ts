import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {splitPackedBudgetSelectors,compressedBudgetSelectors} from '../apps/web/lib/catalog/budget-selector-codec';
import {countCatalogOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('market filtering reads compressed data and falls back to verified v2 after corruption',async()=>{
 const generationId='compressed-runtime';
 const rows=[{id:'sedan',market:'korea',make:'Hyundai',model:'Avante',year:2024,totalRub:1500000,powerHp:123,bodyType:'sedan',fuel:'petrol',updatedAt:'2026-10-10T00:00:00Z'},{id:'suv',market:'korea',make:'Kia',model:'Sportage',year:2024,totalRub:2000000,powerHp:150,bodyType:'suv',fuel:'petrol',updatedAt:'2026-10-10T00:00:00Z'}];
 const index=buildBudgetCountIndex(generationId,rows as any[],new Map(),3);
 const packed=splitPackedBudgetSelectors(index),compressed=compressedBudgetSelectors(packed);
 const storage=getJsonStorage(),original=storage.readJsonWithMeta;
 let corrupt=false,edited=false;const reads:string[]=[];
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown;
  if(key==='catalog-editorial/current.json')value={revision:edited?'edited':'0',entries:edited?{sedan:{id:'sedan',market:'korea',status:'visible',specifications:{bodyType:'wagon',drive:'awd'}}}:{}};
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:2}}};
  else if(key.endsWith('budget-markets-v3/ready.json'))value=compressed.directory;
  else if(key.endsWith('budget-markets-v3/korea.json'))value=corrupt?{encoding:'gzip-base64',payload:'broken'}:compressed.parts.get('korea');
  else if(key.endsWith('budget-markets-v2/ready.json'))value=packed.directory;
  else if(key.endsWith('budget-markets-v2/korea.json'))value=packed.parts.get('korea');
  else {assert.ok(!key.includes('budget-count-')&&!key.includes('/projection/'),'no full-market fallback: '+key);return {found:false,value:fallback};}
  return {found:true,value:value as T};
 };
 try{
  for(corrupt of [false,true]){
   resetCatalogReadCachesForTests();reads.length=0;
   const result=await countCatalogOffers({market:'korea',bodyType:'sedan'});
   assert.equal(result.total,1);
   assert.ok(reads.some(key=>key.endsWith('budget-markets-v3/korea.json')));
   assert.equal(reads.some(key=>key.endsWith('budget-markets-v2/korea.json')),corrupt);
  }
  edited=true;corrupt=false;resetCatalogReadCachesForTests();
  assert.equal((await countCatalogOffers({market:'korea',bodyType:'wagon',drive:'awd'})).total,1);
  assert.equal((await countCatalogOffers({market:'korea',bodyType:'sedan'})).total,0);
 }finally{storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});
