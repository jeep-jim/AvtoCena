import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {getSavedOfferCalculation,savedOfferIdentity} from '../apps/web/lib/catalog/saved-offer-calculation';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';

test('ordinary saved Korea quote uses current 3% reserve; city adds only delivery; issued version retains inputs but refreshes costs',async()=>{
 const offer:any={id:'saved-trax-refresh',sourceId:'kcar_korea_open',sourceOfferId:'lot',market:'korea',make:'Chevrolet',model:'Trax',sourcePrice:14900000,sourceCurrency:'KRW'};
 const draft={year:'2024',productionMonth:'3',productionDay:'12',engineCc:'1199',fuel:'petrol',powerHp:'139',powerKw:'102.23',vehicleCategory:'M1',deliveryCity:''};
 const hash=createHash('sha256').update(offer.id).digest('hex'),version=randomUUID();
 const historical:any={offerId:offer.id,identity:savedOfferIdentity(offer),version,draft,savedAt:'2026-09-21T00:00:00Z',savedBy:'manager',calculation:{totalRub:1645868,breakdown:[{id:'car',amountRub:914909},{id:'exchange-reserve',amountRub:18298,note:'2% от стоимости авто'}]}};
 const today=new Date().toISOString();
 const market={status:'active',active:true,effectiveFrom:'2026-01-01',currency:'KRW',securityDepositRub:110000,topAvtoCommissionRub:90000,logisticsRub:100181,brokerRub:35000,svhRub:15000,laboratoryRub:25000,sbktsRub:0,eptsRub:0,rfDeliveryRub:0,otherFixedExpensesRub:0,exchangeRateReservePercent:2};
 const original=LocalJsonStorage.prototype.readJsonWithMeta;
 const spy=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async function(this:LocalJsonStorage,key:string,fallback:any){
  const values:any={
   ['offer-calculations/'+hash+'.json']:historical,
   ['offer-calculation-scenarios/'+hash+'/'+version+'.json']:historical,
   'markets/markets.json':[{id:'korea',versions:[market]}],
   'fees/exchange-rates.json':{updatedAt:today,KRW:{cbrRate:61.4033,nominal:1000,rateDate:today},USD:{cbrRate:83.4839,nominal:1,rateDate:today},EUR:{cbrRate:94.3201,nominal:1,rateDate:today}}
  };
  return key in values?{found:true,value:values[key]}:original.call(this,key,fallback);
 });
 resetCatalogRateCache();invalidateEffectiveMarketsCache();
 try{
  const current=await getSavedOfferCalculation(offer);assert.ok(current);
  assert.equal(current.calculation.totalRub,1813104);
  assert.equal(current.calculation.breakdown.find(l=>l.id==='exchange-reserve')?.amountRub,27447);
  assert.equal(current.calculation.breakdown.find(l=>l.id==='exchange-reserve')?.note,'3% от стоимости авто');
  assert.equal(current.calculation.breakdown.reduce((sum,l)=>sum+l.amountRub,0),1813104);
  const city=await calculateOfferWithCustomerParametersDetailed(offer,validateCustomerParameters({...draft,deliveryCity:'Новокузнецк'}));assert.ok(city.ok);
  assert.equal(city.calculation.totalRub-current.calculation.totalRub,120000);
  assert.equal(city.calculation.totalRub,1933104);
  const linked=await getSavedOfferCalculation(offer,version);assert.equal(linked?.calculation.totalRub,current.calculation.totalRub);assert.deepEqual(linked?.draft,historical.draft);assert.equal(linked?.version,historical.version);
  assert.equal(historical.calculation.totalRub,1645868);
  const china=await calculateOfferWithCustomerParametersDetailed({...offer,id:'china-refresh',market:'china',sourceCurrency:'KRW'},validateCustomerParameters(draft));assert.ok(china.ok);
  assert.equal(china.calculation.breakdown.find(l=>l.id==='exchange-reserve')?.note,'2.2% от стоимости авто');
 }finally{spy.mock.restore();resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});
