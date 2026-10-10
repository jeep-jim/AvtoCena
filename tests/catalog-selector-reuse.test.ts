import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {splitPackedBudgetSelectors,compressedBudgetSelectors} from '../apps/web/lib/catalog/budget-selector-codec';
import {backfillBudgetMarketSelectors,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('a valid immutable generation reuses all selectors without rereading the full index or rewriting objects',async()=>{
 const markets=['china','korea','japan','uae','europe','georgia'];
 const rows=markets.map(market=>({id:market,market,totalRub:1000000,make:'Toyota',model:'Corolla',year:2024}));
 const generationId='gen_test',index=buildBudgetCountIndex(generationId,rows as any[],new Map(),3);
 const compressed=compressedBudgetSelectors(splitPackedBudgetSelectors(index));
 const storage=getJsonStorage(),read=storage.readJsonWithMeta,write=storage.writeJson;
 let writes=0,fullReads=0,damaged=false;
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  if(key==='catalog/manifest.json')return {found:true,value:{generationId} as T};
  if(key.endsWith('budget-markets-v3/ready.json'))return {found:true,value:compressed.directory as T};
  if(key.includes('budget-markets-v3/')){const market=key.split('/').at(-1)!.replace('.json','');return {found:true,value:(damaged&&market==='china'?{encoding:'gzip-base64',payload:'broken'}:compressed.parts.get(market)) as T};}
  if(key.endsWith('budget-count-v3.json')){fullReads++;throw Error('full_rebuild_requested');}
  return {found:false,value:fallback};
 };
 storage.writeJson=async()=>{writes++;};
 try{
  resetCatalogReadCachesForTests();assert.deepEqual(await backfillBudgetMarketSelectors(),compressed.directory);
  assert.equal(writes,0);assert.equal(fullReads,0);
  resetCatalogReadCachesForTests();damaged=true;
  await assert.rejects(backfillBudgetMarketSelectors(),/full_rebuild_requested/);
  assert.equal(fullReads,1,'a corrupt selector must not be accepted as prepared');assert.equal(writes,0);
 }finally{storage.readJsonWithMeta=read;storage.writeJson=write;resetCatalogReadCachesForTests();}
});
