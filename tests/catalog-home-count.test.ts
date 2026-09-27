import assert from "node:assert/strict";
import test from "node:test";
import {getJsonStorage} from "../apps/web/lib/data";
import {countCatalogOffers, resetCatalogReadCachesForTests} from "../apps/web/lib/catalog/storage";

test("city-only counts use the compact summary without downloading or sorting car projections", async () => {
 const storage=getJsonStorage(), original=storage.readJsonWithMeta;
 const manifest={generationId:"count-compact",markets:{korea:{count:123}}};
 const summary={generationId:manifest.generationId,brands:{hyundai:{make:"Hyundai",count:123,marketCounts:{korea:123},models:[]}}};
 storage.readJsonWithMeta=async <T>(key:string,fallback:T)=>{
  assert.ok(["catalog/manifest.json","catalog/public/brand-summary.json"].includes(key), `unexpected expensive read: ${key}`);
  return {found:true,value:(key.endsWith("manifest.json")?manifest:summary) as T};
 };
 try {
  resetCatalogReadCachesForTests();
  for(const city of [undefined,"Новокузнецк",""]) assert.equal((await countCatalogOffers({city})).total,123);
  assert.equal((await countCatalogOffers({market:"china"})).total,0);
 } finally {storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});
