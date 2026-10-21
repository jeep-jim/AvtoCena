import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {convertToRub,resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {loadPublicRateExtras} from '../apps/web/lib/catalog/public-rates';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';

test('all market conversions and public charts use the same newer publication even when stored rates are only three days old',async()=>{
 const today=new Date().toISOString().slice(0,10),old=new Date(Date.now()-3*86400000).toISOString().slice(0,10);
 const rates:Record<string,number>={CNY:12.6491,JPY:0.55,KRW:0.062,AED:23,EUR:95,GEL:32,USD:85};
 let available=true,liveReads=0;
 const original=LocalJsonStorage.prototype.readJsonWithMeta;
 const storage=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async function(this:LocalJsonStorage,key:string,fallback:any){
  if(key==='fees/exchange-rates.json')return {found:true,value:{updatedAt:old,...Object.fromEntries(Object.entries(rates).map(([currency,value])=>[currency,{currency,cbrRate:currency==='CNY'?12.4328:value*.98,nominal:1,rateDate:old,rateSource:'cbr'}]))}};
  return original.call(this,key,fallback);
 });
 const fetcher=mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  const url=new URL(String(input));assert.equal(url.hostname,'www.cbr.ru');assert.equal(init.cache,'no-store');
  if(!url.searchParams.has('date_req'))liveReads++;
  if(!available)throw Error('official source offline');
  return new Response(`<ValCurs Date="${today.split('-').reverse().join('.')}">${Object.entries(rates).map(([currency,value])=>`<Valute><CharCode>${currency}</CharCode><Nominal>1</Nominal><Value>${value}</Value></Valute>`).join('')}</ValCurs>`);
 });
 resetCatalogRateCache();invalidateEffectiveMarketsCache();
 try{
  const conversions=await Promise.all(Object.keys(rates).map(currency=>convertToRub(98800,currency)));
  assert.equal(liveReads,1,'one request serves concurrent six-market repricing and logistics');
  for(const rate of conversions){assert.equal(rate?.effectiveRate,rates[rate!.currency]);assert.equal(rate?.rateDate,today);}
  assert.equal(conversions[0]?.sourcePriceRub,1249731);
  const pub=await loadPublicRateExtras();
  for(const rate of conversions){const chart=pub.rates.find(r=>r.currency===rate?.currency);assert.equal(chart?.effectiveRate,rate?.effectiveRate);assert.equal(chart?.rateDate,rate?.rateDate);}
  const offer:any={id:'wuling-rate-regression',market:'china',sourceId:'fixture',sourceOfferId:'560',make:'Wuling',model:'560',sourcePrice:98800,sourceCurrency:'CNY'};
  const draft=validateCustomerParameters({year:'2026',fuel:'electric',powerHp:'136',powerKw:'100.02783',power30MinKw:'50',deliveryCity:'Новокузнецк'});
  const result=await calculateOfferWithCustomerParametersDetailed(offer,draft);assert.ok(result.ok);
  assert.equal(result.calculation.currencyRate?.effectiveRate,rates.CNY);
  assert.equal(result.calculation.breakdown.reduce((sum,line)=>sum+line.amountRub,0),result.calculation.totalRub,'full calculation and line items agree');
  assert.equal(liveReads,1,'reuse current rates across the full calculation');
  available=false;resetCatalogRateCache();
  const fallback=await convertToRub(98800,'CNY');assert.equal(fallback?.effectiveRate,12.4328);assert.equal(fallback?.rateDate,old,'fallback keeps the real date');
 }finally{storage.mock.restore();fetcher.mock.restore();resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});
