import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {chinaCnyConversion,withChinaCnyPrices,withChinaCnyPrice} from '../apps/web/lib/catalog/china-cny-price';
import {convertToRub,resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {writeFileSync} from 'node:fs';
import {offerPdfData,renderOfferPdf} from '../apps/web/lib/catalog/offer-pdf';
import {che168GlobalPriceAdjustment} from '../apps/web/lib/catalog/china-owner-policy';

test('China locks source USD in CNY, retains ruble/customs math and then follows CNY only',async()=>{
 const today=new Date().toISOString().slice(0,10),original=LocalJsonStorage.prototype.readJsonWithMeta;
 let usd=90,cny=12.5;
 const memory=new Map<string,any>();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async function(this:LocalJsonStorage,key:string,fallback:any){
  if(key==='fees/exchange-rates.json')return {found:true,value:{updatedAt:today,...Object.fromEntries([['USD',usd],['CNY',cny],['EUR',100]].map(([currency,rate])=>[currency,{cbrRate:rate,nominal:1,rateDate:today}]))}};
  if(key.startsWith('catalog/china-cny-prices/'))return {found:memory.has(key),value:memory.get(key)||fallback};
  return original.call(this,key,fallback);
 });
 const write=mock.method(LocalJsonStorage.prototype,'writeJson',async(key:string,value:unknown)=>{assert.match(key,/china-cny-prices/);memory.set(key,value);});
 resetCatalogRateCache();
 try{
  const input:any={id:randomUUID(),market:'china',sourceId:'autohome_used_china_open',sourceOfferId:'123',sourcePrice:10000,sourceCurrency:'USD',make:'Toyota',model:'Corolla',operational:{sourceUrl:'https://global.che168.com/en/detail/123'}};
  const foreign={...input,id:randomUUID(),market:'korea'};
  const [normalized,untouched]=await withChinaCnyPrices([input,foreign]);
  assert.equal(normalized.sourceCurrency,'CNY');assert.equal(normalized.sourcePrice,72000);assert.strictEqual(untouched,foreign);assert.equal(input.sourceCurrency,'USD');
  assert.equal((await convertToRub(normalized.sourcePrice,'CNY'))?.sourcePriceRub,900000);
  const params=validateCustomerParameters({year:2021,productionMonth:11,engineCc:1498,powerHp:120,fuel:'petrol',deliveryCity:'Москва'});
  const result=await calculateOfferWithCustomerParametersDetailed(input,params);assert.ok(result.ok);
  const equivalent=await calculateOfferWithCustomerParametersDetailed(normalized,params);assert.ok(equivalent.ok);
  assert.deepEqual(result.calculation,equivalent.calculation);
  // An unpersisted USD fixture bypasses normalization and exercises the old engine inputs.
  const originalUsd=await calculateOfferWithCustomerParametersDetailed({...input,id:undefined},params);assert.ok(originalUsd.ok);
  assert.equal(result.calculation.totalRub,originalUsd.calculation.totalRub);
  assert.deepEqual(result.calculation.customsValue,originalUsd.calculation.customsValue);
  assert.equal(result.calculation.customsValue.vehiclePriceRub,900000);
  assert.equal(result.calculation.currencyRate.currency,'CNY');
  assert.equal(che168GlobalPriceAdjustment(normalized,900000)?.adjustmentRub,-18000);
  const pdf=offerPdfData(input,{year:'2021',engineCc:'1498',fuel:'petrol',powerHp:'120',deliveryCity:'Москва'},result.calculation);
  assert.match(pdf.rate,/CNY/);assert.match(pdf.sections[0].rows[0].label,/72.*000 CNY/);assert.doesNotMatch(pdf.rate,/USD/);
  const bytes=await renderOfferPdf(pdf,{photo:null});
  if(process.env.PDF_QA_OUTPUT)writeFileSync(process.env.PDF_QA_OUTPUT,bytes);
  assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1,'complete quote fits one page');
  // A projection may omit sourceOfferId; it must share the detail's price anchor.
  assert.equal((await withChinaCnyPrice({...input,sourceOfferId:undefined})).sourcePrice,72000);
  usd=110;cny=13;resetCatalogRateCache();
  const repriced=await withChinaCnyPrice(input);assert.equal(repriced.sourcePrice,72000);
  assert.equal((await convertToRub(repriced.sourcePrice,'CNY'))?.sourcePriceRub,936000);
  const changed=await withChinaCnyPrice({...input,sourcePrice:12000});assert.equal(changed.sourcePrice,12000*110/13);
  assert.equal(write.mock.calls.length,2,'one write per batch of new prices, never per card');
  const rate=await convertToRub(1,'CNY');
  assert.equal(chinaCnyConversion(10000,rate,{...rate!,rateDate:'2000-01-01'}),null);
  assert.equal(chinaCnyConversion(10000,rate,{...rate!,rateSource:'fallback_env'}),null);
 }finally{read.mock.restore();write.mock.restore();resetCatalogRateCache();}
});
