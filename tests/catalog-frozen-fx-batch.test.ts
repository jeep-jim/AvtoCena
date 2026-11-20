import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {resetChinaCnyPriceCache,withChinaCnyPrices} from '../apps/web/lib/catalog/china-cny-price';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing';
import {budgetReplayOffer,buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {captureCatalogFxBatch,captureCatalogFxBatches,convertToRub,resetCatalogRateCache,verifyCatalogFxReadback,withCatalogFxBatch} from '../apps/web/lib/catalog/rates';
import {budgetPricingFingerprint,readPreparedBudgetPrices,resetSharedBudgetPriceCache,sharedBudgetPrices} from '../apps/web/lib/catalog/shared-budget-prices';
import type {CatalogSearchProjection} from '../apps/web/lib/catalog/storage';
import type {VehicleOffer} from '../apps/web/lib/catalog/types';
import {calculateRussiaCustomsForIndividual, type RussiaCustomsV2Input} from '../packages/engine/src/calculation/russiaCustomsV2';

type FixtureProjection = CatalogSearchProjection & Partial<VehicleOffer>;
const day='2026-11-20', start=Date.parse(day+'T23:59:59Z');
function exactPowerOffer(id:string, sourcePrice:number): FixtureProjection {
 const input: RussiaCustomsV2Input={customsValueRub:Math.round(sourcePrice*.065),eurRateRub:95,
   importedAt:new Date(start),productionDate:'2022-01-01',engineCc:2998,powerHp:370,powerKw:272,icePowerKw:272,
   utilizationPowerKw:272,powertrainKind:'combustion',fuel:'petrol',vehicleCategory:'M1'};
 return {id,market:'korea',make:'Hyundai',model:'Fixture',year:2022,sourcePrice,sourceCurrency:'KRW',
   engineCc:2998,powerHp:370,powerKw:272,icePowerKw:272,utilizationPowerKw:272,powertrainKind:'combustion',fuel:'petrol',
   totalRub:1500000,publicVisibleRub:1500000,publicSpecificationVerified:true,cardProjectionVersion:3,calculationStatus:'ready',
   powerDataSource:'fixture:named_ice_kw',updatedAt:day,calculationSnapshot:{customsInput:input,customs:calculateRussiaCustomsForIndividual(input),
   sourcePriceRub:input.customsValueRub,missing:[],priceIncludesAllCustoms:true,priceIncludesUtilizationFee:true}} as FixtureProjection;
}
test('one official observation feeds batch, logistics and immutable numeric readback across midnight',async t=>{
 t.mock.timers.enable({apis:['Date'],now:start});
 const db=getJsonStorage(), prior={readJson:db.readJson,readJsonWithMeta:db.readJsonWithMeta,writeJson:db.writeJson};
 const disable=process.env.CATALOG_LIVE_RATE_DISABLED;
 const fetchBefore=globalThis.fetch;
 const objects=new Map<string,unknown>();let storedReads=0,officialReads=0,uploads=0,krw=65,eur=95,usd=85,liveDated=true;
 delete process.env.CATALOG_LIVE_RATE_DISABLED;
 globalThis.fetch=async input=>{
  assert.equal(String(input),'https://www.cbr.ru/scripts/XML_daily.asp');
  officialReads++;
  return new Response(`<ValCurs${liveDated?' Date="20.11.2026"':''}>${[['KRW',krw,1000],['EUR',eur,1],['USD',usd,1]]
   .map(([code,value,nominal])=>`<Valute><CharCode>${code}</CharCode><Nominal>${nominal}</Nominal><Value>${value}</Value></Valute>`).join('')}</ValCurs>`);
 };
 db.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  if(key==='fees/exchange-rates.json'){storedReads++;return {found:true,value:{rates:[]} as T};}
  if(key==='markets/markets.json')return {found:true,value:[{id:'korea',versions:[]}] as T};
  if(key==='catalog-editorial/current.json')return {found:false,value:fallback};
  assert.match(key,/^catalog\/runtime-budget-prices-v3\/korea\//);
  return {found:objects.has(key),etag:objects.has(key)?'fixture':undefined,value:(objects.get(key)??fallback) as T};
 };
 db.readJson=async<T>(key:string,fallback:T)=>(await db.readJsonWithMeta(key,fallback)).value;
 db.writeJson=async(key,value)=>{
  assert.match(key,/^catalog\/runtime-budget-prices-v3\/korea\//);
  objects.set(key,JSON.parse(JSON.stringify(value)));uploads++;
 };
 try {
  resetSharedBudgetPriceCache();resetCatalogRateCache();invalidateEffectiveMarketsCache();
  const a=exactPowerOffer('k1',10000000),b=exactPowerOffer('k2',15000000),index=buildBudgetCountIndex('frozen-fx-2026',[a,b],new Map(),3);
  const batch=await captureCatalogFxBatch('korea',[' krw ','KRW']);
  assert.equal(storedReads,1);assert.equal(officialReads,1);
  assert.equal(batch.receipt.rates.KRW.cbrRate,65);assert.equal(batch.receipt.rates.KRW.nominal,1000);
  assert.equal(batch.receipt.rates.KRW.effectiveRate,.065);assert.equal(batch.receipt.rates.KRW.rateSource,'cbr_live');
  assert.equal(batch.receipt.rates.KRW.rateDate,day);assert.equal(batch.receipt.rates.KRW.fetchedAt,new Date(start).toISOString());
  assert.equal(batch.receipt.observedAt,new Date(start).toISOString());
  assert.ok(Object.isFrozen(batch.receipt.rates.KRW));
  const before=await withCatalogFxBatch(batch,async()=>{
   const fingerprint=await budgetPricingFingerprint('korea');assert.ok(fingerprint);
   let verifiedTotals:number[]=[];
   const cached=await sharedBudgetPrices(index,'korea',fingerprint,async()=>{
    const [first]=await applyActiveBusinessPriceBatch([a],{readOnly:true});
    krw=75;eur=101;usd=91; // replay must not read these within the old run
    t.mock.timers.tick(2_000);
    const [second]=await applyActiveBusinessPriceBatch([b],{readOnly:true});
    for(const row of [first,second]){
     assert.equal(row.calculationSnapshot?.currencyRate?.effectiveRate,.065);
     assert.equal(row.calculationSnapshot?.eurRate?.effectiveRate,95);
     assert.equal(row.calculationSnapshot?.customsInput?.importedAt?.toISOString(),batch.receipt.pricingAsOf);
     assert.equal(row.calculationSnapshot?.customsInput?.utilizationPowerKw,272);
     assert.equal(row.calculationSnapshot?.customs?.utilizationPowerKw,272);
     assert.equal(row.calculationSnapshot?.customs?.status,'ready');
    }
    assert.equal((await convertToRub(1,'USD',{preferLive:true}))?.effectiveRate,85);
    assert.equal(await budgetPricingFingerprint('korea'),fingerprint);
    const compact=index.rows.map(row=>{
     const projection=budgetReplayOffer(row);assert.equal(projection.market,'korea');
     return projection as FixtureProjection;
    });
    const repriced=await applyActiveBusinessPriceBatch(compact,{readOnly:true});
    assert.deepEqual(repriced.map(row=>row.totalRub),[first.totalRub,second.totalRub]);
    verifiedTotals=repriced.map(row=>row.totalRub!);
    return buildBudgetCountIndex(index.generationId,repriced).rows;
   },undefined,false,{persistence:'required'});
   assert.equal(uploads,1);
   assert.deepEqual(cached.map(row=>row[1]),verifiedTotals);
   const wire=JSON.parse(JSON.stringify(batch.receipt));
   verifyCatalogFxReadback(batch,wire,batch.receiptSha256);
   wire.rates.KRW.effectiveRate=.075;
   assert.throws(()=>verifyCatalogFxReadback(batch,wire,batch.receiptSha256),/receipt_mismatch/);
   assert.throws(()=>verifyCatalogFxReadback(batch,undefined,batch.receiptSha256),/receipt_mismatch/);
   resetSharedBudgetPriceCache();
   const restored=await readPreparedBudgetPrices(index,'korea',fingerprint);
   assert.deepEqual(restored?.map(row=>row[1]),verifiedTotals);
   await assert.rejects(convertToRub(1,'GBP'),/unsealed_currency/);
   await assert.rejects(applyActiveBusinessPriceBatch([{...a,market:'japan'}]),/offer_scope/);
   return {fingerprint,verifiedTotals};
  });
  assert.equal(storedReads,1);assert.equal(officialReads,1,'no FX lookup during calculation, context checks, or readback');
  assert.equal(uploads,1,'one numeric snapshot; no writes on readback');

  // New run is within the usual resolver TTL. It must resolve new official data anyway.
  const next=await captureCatalogFxBatch('korea',['KRW']);
  assert.equal(storedReads,2);assert.equal(officialReads,2);
  assert.notEqual(next.receiptSha256,batch.receiptSha256);
  assert.throws(()=>verifyCatalogFxReadback(next,batch.receipt,batch.receiptSha256),/receipt_mismatch/);
  await withCatalogFxBatch(next,async()=>{
   const [row]=await applyActiveBusinessPriceBatch([a],{readOnly:true});
   assert.equal(row.calculationSnapshot?.currencyRate?.effectiveRate,.075);
   assert.equal(row.calculationSnapshot?.eurRate?.effectiveRate,101);
   assert.equal((await convertToRub(1,'USD',{preferLive:true}))?.effectiveRate,91);
   assert.notEqual(row.totalRub,before.verifiedTotals[0]);
   assert.notEqual(await budgetPricingFingerprint('korea'),before.fingerprint);
   assert.equal(await readPreparedBudgetPrices(index,'korea',before.fingerprint),null,'the old receipt cannot restore the numeric object in this run');
  });
  krw=77; // same official publication date and same UTC day, changed exact quote
  const intraday=await captureCatalogFxBatch('korea',['KRW']);
  const nextFingerprint=await withCatalogFxBatch(next,()=>budgetPricingFingerprint('korea'));
  assert.notEqual(await withCatalogFxBatch(intraday,()=>budgetPricingFingerprint('korea')),nextFingerprint);
  assert.equal(storedReads,3);assert.equal(officialReads,3);
  await assert.rejects(captureCatalogFxBatch('japan',['JPY']),/batch_scope/);
  await assert.rejects(captureCatalogFxBatch('korea',['XXX']),/batch_currency/);
  await assert.rejects(captureCatalogFxBatch('korea',['GBP']),/authority_unavailable:GBP/);
  liveDated=false;
  await assert.rejects(captureCatalogFxBatch('korea',['KRW']),/authority_unavailable/);
 }finally{
  Object.assign(db,prior);globalThis.fetch=fetchBefore;
  if(disable===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=disable;
  resetSharedBudgetPriceCache();resetCatalogRateCache();invalidateEffectiveMarketsCache();
 }
});

test('China anchor conversion shares the same USD and CNY observation without writing anchors',async t=>{
 t.mock.timers.enable({apis:['Date'],now:start});
 const db=getJsonStorage(),prior={readJsonWithMeta:db.readJsonWithMeta,writeJson:db.writeJson};
 const before=process.env.CATALOG_LIVE_RATE_DISABLED;
 process.env.CATALOG_LIVE_RATE_DISABLED='1';
 let reads=0,usd=85,cny=12.5;
 db.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  if(key==='catalog/china-cny-prices/current.json')return {found:false,value:fallback};
  assert.equal(key,'fees/exchange-rates.json');reads++;
  return {found:true,value:{rates:[['USD',usd],['CNY',cny],['EUR',95],['KRW',0.065]].map(([currency,cbrRate])=>({
   currency,cbrRate,nominal:1,rateDate:day,rateSource:'cbr',fetchedAt:new Date(start).toISOString(),
  }))} as T};
 };
 db.writeJson=async()=>assert.fail('shadow batch must not persist FX anchors');
 try {
  resetChinaCnyPriceCache();
  const {china:batch,korea}=await captureCatalogFxBatches({china:['USD'],korea:['KRW']}); // CNY is implicit
  assert.equal(batch.receipt.runId,korea.receipt.runId);
  assert.deepEqual(batch.receipt.rates.USD,korea.receipt.rates.USD);
  assert.notEqual(batch.receiptSha256,korea.receiptSha256);
  assert.equal(korea.receipt.rates.CNY,undefined);
  usd=95;cny=13;
  const offer:Partial<VehicleOffer>={id:'china-fixture',market:'china',sourceCurrency:'USD',sourcePrice:1000};
  const [converted]=await withCatalogFxBatch(batch,()=>withChinaCnyPrices([offer]));
  assert.equal(converted.sourceCurrency,'CNY');
  assert.equal(converted.sourcePrice,1000*85/12.5);
  assert.equal(converted.chinaPriceConversion?.rateDate,day);
  assert.equal(reads,1);
 }finally{
  Object.assign(db,prior);
  if(before===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=before;
  resetChinaCnyPriceCache();resetCatalogRateCache();
 }
});
