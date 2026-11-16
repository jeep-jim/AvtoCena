// Each invocation imports the real pricing modules in a fresh process. All
// storage is in memory and every network request must match the CBR fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mock} from 'node:test';

const input=JSON.parse(fs.readFileSync(0,'utf8'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sourceRoot=input.sourceRoot||root;
const runtime=async name=>{const module=await import(pathToFileURL(path.join(sourceRoot,name)).href);return module.default||module;};
const now=input.now||'2026-11-16T10:00:00.000Z';
mock.timers.enable({apis:['Date'],now:Date.parse(now)});
process.env.JSON_STORAGE_DRIVER='local';
process.env.CATALOG_LIVE_RATE_DISABLED='';
process.env.AVTOCENA_CALCULATION_VERSION=input.calculationVersion||'a'.repeat(64);
for(const key of Object.keys(process.env))if(key.startsWith('CATALOG_FALLBACK_RATE_'))delete process.env[key];
const market=input.market||'korea';
const rateDate=input.rateDate||'2026-11-16';
const currency=market==='china'?'CNY':'KRW';
const source=input.rateSource||'cbr';
const values=[['KRW',input.krw??0.065],['CNY',12],['USD',85],['EUR',95]];
const rates={updatedAt:rateDate+'T00:00:00Z',rates:values.map(([code,value])=>({
 currency:code,cbrRate:value,nominal:code===currency?(input.nominal??1):1,
 rateDate,rateSource:source,fetchedAt:input.fetchedAt||'first-fetch',
 previousEffectiveRate:input.history??1,previousRateDate:'2026-11-13',rateDelta:input.history??1,
}))};
const settings=[{id:market,versions:[
 {id:'current',status:'active',effectiveFrom:'2026-01-01T00:00:00Z',securityDepositRub:input.deposit??110000},
 ...(input.scheduledAt?[{id:'next',status:'scheduled',effectiveFrom:input.scheduledAt,securityDepositRub:120000}]:[]),
]}];
const editorial={revision:'fixture',entries:input.sellerPrice?{
 a:{id:'a',market,sellerPrice:{amount:input.sellerPrice,currency}},
}:{}};
const models=input.encyclopediaChanged?{'kia:morning':[]}:{};
const originalRead=fs.readFileSync;
fs.readFileSync=function(file,...args){
 if(String(file).replaceAll('\\','/').endsWith('/knowledge/encyclopedia/calculation-v1.json')){
  return JSON.stringify({version:1,digest:createHash('sha256').update(JSON.stringify(models)).digest('hex'),models});
 }
 return originalRead.call(this,file,...args);
};
const saved=new Map(input.saved||[]);
let writes=0,loads=0,networkCalls=0;
const data=await runtime('apps/web/lib/data.ts');
const storage=data.getJsonStorage();
const fixture=(key,fallback)=>key==='fees/exchange-rates.json'?rates
 :key==='markets/markets.json'?settings
 :key==='catalog-editorial/current.json'?editorial
 :saved.has(key)?structuredClone(saved.get(key)):fallback;
storage.readJson=async(key,fallback)=>fixture(key,fallback);
storage.readJsonWithMeta=async(key,fallback)=>({found:true,etag:'fixture',value:fixture(key,fallback)});
storage.readObjectMetadata=async key=>{
 assert.equal(key,'catalog/china-cny-prices/current.json');
 return {found:true,etag:input.anchor||'first-anchor'};
};
storage.writeJson=async(key,value,condition)=>{
 assert.match(key,/^catalog\/runtime-(?:budget-prices-v3|budget-selections-v1)\//);
 if(condition?.ifNoneMatch==='*'&&saved.has(key))throw new data.StorageConflictError();
 writes++;saved.set(key,structuredClone(value));
};
globalThis.fetch=async request=>{
 assert.equal(String(request),'https://www.cbr.ru/scripts/XML_daily.asp');
 networkCalls++;
 if(!input.live)throw new TypeError('fixture CBR unavailable');
 const xmlDate=rateDate.slice(8,10)+'.'+rateDate.slice(5,7)+'.'+rateDate.slice(0,4);
 return new Response('<ValCurs Date="'+xmlDate+'">'+rates.rates.map(rate=>
  '<Valute><CharCode>'+rate.currency+'</CharCode><Nominal>'+rate.nominal+'</Nominal><Value>'
  +String(rate.cbrRate).replace('.',',')+'</Value></Valute>').join('')+'</ValCurs>');
};
try{
 const rateModule=await runtime('apps/web/lib/catalog/rates.ts');
 const configs=await runtime('apps/web/lib/effective-market-settings.ts');
 const pricing=await runtime('apps/web/lib/catalog/shared-budget-prices.ts');
 const indexes=await runtime('apps/web/lib/catalog/budget-count-index.ts');
 const rate=await rateModule.convertToRub(1,currency);
 const config=await configs.getEffectiveMarketVersion(market);
 const fingerprint=await pricing.budgetPricingFingerprint(market);
 const index=indexes.buildBudgetCountIndex('fixture-generation',[
  {id:'a',market,totalRub:1500000,make:'Kia',model:'Morning',year:2024,engineCc:998,powerHp:76},
  {id:'b',market,totalRub:2000000,make:'Kia',model:'Seltos',year:2024,engineCc:1598,powerHp:193},
 ],new Map(),3);
 const numeric=await pricing.readPreparedBudgetPrices(index,market,fingerprint);
 const selection=await pricing.readPreparedBudgetSelection(index.generationId,market,fingerprint);
 const rows=await pricing.sharedBudgetPrices(index,market,fingerprint,async()=>{
  loads++;
  if(input.expectHit)throw Error('unexpected_whole_market_replay');
  return index.rows;
 },async()=>fingerprint);
 if(input.prepare)await pricing.prepareBudgetSelection(index,market,fingerprint,rows,async()=>fingerprint);
 if(input.expectHit){
  assert.ok(numeric,'numeric snapshot must survive a process boundary');
  assert.ok(selection,'compact selector must survive a process boundary');
  assert.deepEqual(rows,numeric);
  // Optional undefined properties are absent from the persisted JSON selector.
  assert.deepEqual(selection.rows,JSON.parse(JSON.stringify(numeric)));
  assert.equal(loads,0);assert.equal(writes,0);
 }
 console.log(JSON.stringify({fingerprint,numericHit:numeric!==null,selectionHit:selection!==null,
  loads,writes,networkCalls,rateSource:rate.rateSource,rateDate:rate.rateDate,effectiveRate:rate.effectiveRate,
  logisticsRateSource:config.logisticsRateSource,logisticsRub:config.logisticsRub,
  inputHistory:rates.rates[0].previousEffectiveRate,
  rows:rows.map(row=>[row[5].id,row[1]]),saved:[...saved],
  japanFingerprint:await pricing.budgetPricingFingerprint('japan')}));
}finally{
 fs.readFileSync=originalRead;mock.timers.reset();
}
