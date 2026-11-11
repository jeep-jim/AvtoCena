import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resetJsonStorageForTests} from '../apps/web/lib/data';
import {convertToRub,resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
test('seller conversion uses exact official quote/nominal even when cached effectiveRate has a small spread',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,disabled=process.env.CATALOG_LIVE_RATE_DISABLED,fetch=globalThis.fetch;
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'official-rate-'));
 try{
  process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';delete process.env.CATALOG_LIVE_RATE_DISABLED;resetJsonStorageForTests();resetCatalogRateCache();
  const rows=[['CNY',12.495,1],['KRW',60,1000],['JPY',50,100],['USD',80,1],['EUR',90,1],['AED',22,1]] as const;
  await fs.mkdir('data/fees',{recursive:true});
  await fs.writeFile('data/fees/exchange-rates.json',JSON.stringify({updatedAt:new Date().toISOString(),rates:rows.map(([currency,cbrRate,nominal])=>({currency,cbrRate,nominal,effectiveRate:cbrRate/nominal*1.04,rateSource:'cbr',rateDate:new Date().toISOString().slice(0,10)}))}));
  globalThis.fetch=async()=>{throw Error('CBR unavailable');};
  for(const [currency,value,nominal] of rows){
   const result=await convertToRub(57800,currency);
   assert.equal(result?.effectiveRate,value/nominal,currency);
   assert.equal(result?.sourcePriceRub,Math.round(57800*value/nominal),currency);
   assert.equal(result?.sourcePrice,57800);
  }
  assert.equal((await convertToRub(57800,'CNY'))?.sourcePriceRub,722211);
  resetCatalogRateCache();
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10).split('-').reverse().join('.');
  globalThis.fetch=async()=>new Response(`<ValCurs Date="${tomorrow}"><Valute><CharCode>CNY</CharCode><Nominal>1</Nominal><Value>12,50</Value></Valute></ValCurs>`);
  const live=await convertToRub(57800,'CNY',{preferLive:true});
  assert.equal(live?.rateSource,'cbr_live');assert.equal(live?.sourcePriceRub,722500);assert.equal(live?.effectiveRate,12.5);
 }finally{
  globalThis.fetch=fetch;process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
  if(disabled===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=disabled;
  resetJsonStorageForTests();resetCatalogRateCache();await fs.rm(tmp,{recursive:true,force:true});
 }
});
