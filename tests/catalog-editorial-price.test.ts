import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {applyCatalogEditorial,cleanEditorialInput,saveCatalogEditorial,resetCatalogEditorialCache,readCatalogEditorial} from '../apps/web/lib/catalog/editorial';
import {applyActiveBusinessPricing,applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing';
import {withChinaCnyPrice} from '../apps/web/lib/catalog/china-cny-price';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
const input=(patch:any={})=>cleanEditorialInput({title:'',photos:null,status:'visible',reason:'',version:null,...patch});
test('seller price accepts supported currencies and rejects malformed, zero and nonfinite amounts',()=>{
 for(const currency of ['CNY','KRW','JPY','USD','EUR','AED','GEL','RUB'])assert.deepEqual(input({sellerPrice:{amount:57800.25,currency}}).sellerPrice,{amount:57800.25,currency});
 for(const sellerPrice of [[],{},'57800',{amount:'57800',currency:'CNY'},{amount:0,currency:'CNY'},{amount:-1,currency:'CNY'},{amount:NaN,currency:'CNY'},{amount:Infinity,currency:'CNY'},{amount:1e13,currency:'CNY'},{amount:1,currency:'BTC'}])assert.throws(()=>input({sellerPrice}));
 assert.equal(input({sellerPrice:null}).sellerPrice,null);assert.equal(input().sellerPrice,undefined);
});
test('six markets share persisted seller inputs, invalidate stale quotes, survive refresh and restore source pricing',async()=>{
 const storage=getJsonStorage(),read=storage.readJsonWithMeta,write=storage.writeJson;
 let index:any={revision:'0',entries:{}};
 storage.readJsonWithMeta=async(key,fallback)=>key==='catalog-editorial/current.json'?{found:true,value:structuredClone(index),etag:'test'}:key==='fees/exchange-rates.json'?{found:true,value:Object.fromEntries(Object.entries({EUR:100,USD:90,CNY:12,KRW:0.06,JPY:0.54,AED:25}).map(([currency,rate])=>[currency,{cbrRate:rate*100,nominal:100,rateDate:new Date().toISOString()}])) as any}:read.call(storage,key,fallback);
 storage.writeJson=async(key,value,condition)=>{if(key==='catalog-editorial/current.json'){index=structuredClone(value);return;}return write.call(storage,key,value,condition);};
 try{
  resetCatalogEditorialCache();
  for(const market of ['china','korea','japan','uae','europe','georgia']){
   const source:any={id:'editorial-'+market,market,sourceId:'fixture',sourceOfferId:'one',make:'Toyota',model:'Corolla',year:2022,engineCc:1496,powerHp:110,fuel:'petrol',powertrainKind:'combustion',powerDataSource:'manufacturer_official',catalogPricingMode:'seller',sourcePrice:1000000,sourceCurrency:'RUB',images:[{url:'https://example.com/a.jpg'},{url:'https://example.com/b.jpg'}],calculationStatus:'needs_data',sellerPriceRub:1000000,totalRub:9999999,publicVisibleRub:9999999,calculationSnapshot:{sourcePriceRub:1000000},savedCalculationPreview:{totalRub:9999999},japanDeliveredPreview:{totalRub:9999999},operational:{},updatedAt:new Date().toISOString()};
   const [currency,rate]=({china:['CNY',12],korea:['KRW',0.06],japan:['JPY',0.54],uae:['AED',25],europe:['EUR',100],georgia:['USD',90]} as Record<string,[string,number]>)[market];
   let saved=await saveCatalogEditorial(source,input({sellerPrice:{amount:1200000,currency}}),{id:'owner',displayName:'Owner'},'Toyota');
   const editorial=await readCatalogEditorial();const applied:any=applyCatalogEditorial(source,editorial);
   assert.equal(applied.totalRub,null);assert.equal(applied.calculationSnapshot,undefined);assert.equal(applied.savedCalculationPreview,undefined);assert.equal(applied.japanDeliveredPreview,undefined);
   const delivered=await applyActiveBusinessPricing({...source,catalogPricingMode:undefined});
   assert.notEqual(delivered.totalRub,9999999,'old delivered total is never reused');
   assert.equal(delivered.calculationSnapshot?.currencyRate?.sourcePrice,1200000,'existing engine receives overridden input');
   assert.equal(source.sourcePrice,1000000);assert.equal(source.totalRub,9999999);
   const single=await applyActiveBusinessPricing(source),[batch]=await applyActiveBusinessPriceBatch([source]);
   for(const result of [single,batch]){assert.equal(result.sourcePrice,1200000,market);assert.equal(result.sourceCurrency,currency);assert.equal(result.sellerPriceRub,Math.round(1200000*rate),market);assert.equal(result.totalRub,null);assert.equal(result.calculationSnapshot.currencyRate.sourcePrice,1200000);assert.deepEqual(applyCatalogEditorial(result,editorial),result,'repeat overlay retains newly calculated values');}
   assert.equal(applyCatalogEditorial({...source,sourcePrice:900000},editorial).sourcePrice,1200000,'feed refresh cannot erase override');
   assert.equal(applyCatalogEditorial({...source,sourceOfferId:'different'},editorial).sourcePrice,1000000,'identity binding');
   // Existing customer calculator sees the same price without changing its chosen specifications.
   const params={year:2022,engineCc:1496,powerHp:110,fuel:'petrol',powertrainKind:'combustion'} as any;
   const quote=await calculateOfferWithCustomerParametersDetailed(source,params);
   assert.equal(quote.ok,true,market+': '+JSON.stringify(quote));
   if(!quote.ok)throw Error(quote.error);
   assert.equal(quote.calculation.currencyRate.sourcePrice,1200000);
   assert.equal(quote.calculation.currencyRate.currency,currency);
   assert.ok(quote.calculation.totalRub!>1200000*rate);
   saved=await saveCatalogEditorial(source,input({version:saved.version,title:'Edited'}),{id:'owner',displayName:'Owner'},'Toyota');
   assert.equal(saved.sellerPrice?.amount,1200000,'old clients preserve manual price');
   await saveCatalogEditorial(source,input({version:saved.version,sellerPrice:null}),{id:'owner',displayName:'Owner'},'Toyota');
   const restored=await applyActiveBusinessPricing(source);assert.equal(restored.sourcePrice,1000000);assert.equal(restored.sellerPriceRub,1000000);
  }
  const explicit:any={id:'china-manual',market:'china',sourcePrice:10000,sourceCurrency:'USD',editorialPriceKey:'manual'};
  assert.equal(await withChinaCnyPrice(explicit),explicit,'explicit selected currency is not replaced by feed USD/CNY conversion');
 }finally{storage.readJsonWithMeta=read;storage.writeJson=write;resetCatalogEditorialCache();}
});
