import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {readCurrentCatalogProjectionSnapshot,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('full snapshot fallback does not queue sibling markets behind a slow large read',async()=>{
 const storage=getJsonStorage(),read=storage.readJsonWithMeta;
 const reads:string[]=[];let firstFinished=false;
 resetCatalogReadCachesForTests();
 const value=async<T>(path:string,fallback:T):Promise<T>=>{
  if(path==='catalog/manifest.json')return {version:2,generationId:'serial-test',markets:{}} as T;
  if(path.includes('facets'))return {generationId:'staged-next-generation'} as T;
  if(path.includes('/indexes/projection/')){
   reads.push(path);
   if(reads.length===1){await new Promise(r=>setTimeout(r,5100));firstFinished=true;}
   else assert.equal(firstFinished,true,'do not submit another large read while the first is pending');
   return {generationId:'serial-test',items:[]} as T;
  }
  return fallback;
 };
 storage.readJsonWithMeta=async<T>(path:string,fallback:T)=>({found:true,value:await value(path,fallback)});
 try{
  const result=await readCurrentCatalogProjectionSnapshot();
  assert.equal(result.generationId,'serial-test');assert.deepEqual(result.items,[]);
  assert.ok(reads.length>1,'exercise a multi-market snapshot');
 }finally{storage.readJsonWithMeta=read;resetCatalogReadCachesForTests();}
});
