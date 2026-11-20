import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena';
import {deliveryPricingBasis,priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
import {applyFixedChinaCityLedger,eligibleChinaFixedCityQuery,fixedChinaCityForName,fixedChinaCityKey,fixedChinaCityQuote,projectFixedChinaCity}
 from '../apps/web/lib/catalog/prepared-china-fixed-city';
import type {CatalogSearchProjection} from '../apps/web/lib/catalog/storage';
import type {VehicleOffer} from '../apps/web/lib/catalog/types';

test('stored China ledger reprices only domestic delivery and subtotal percentage lines at exact ruble precision',()=>{
 const input={marketId:'china' as const,sourcePriceRub:1_512_347,sourcePriceAdjustmentRub:11_019,customsRub:186_700,utilizationFeeRub:5_200,
  marketConfig:{id:'test',rfDeliveryRub:75_007,securityDepositRub:40_765,topAvtoCommissionRub:30_001,
   exchangeRateReservePercent:1.6,bankTransferPercent:0.5,percentExpenses:[
    {id:'cost-A',title:'Cost A',percent:1.43},{id:'cost-B',title:'Cost B',percent:0.37},
   ]}};
 const base=calculateAvtocenaFromBusinessConfig(input);
 const sheet={...base.snapshot,sourcePriceAdjustment:{adjustmentRub:input.sourcePriceAdjustmentRub}};
 const native={market:'china',totalRub:base.totalRub,calculationSnapshot:sheet} as VehicleOffer;
 const projection={market:'china',totalRub:base.totalRub,calculationSnapshot:{deliveryPricingBasis:deliveryPricingBasis(sheet)}} as CatalogSearchProjection;
 for(const city of [' Новокузнецк ', ' г. КЕМЕРОВО ']){
  const accepted=fixedChinaCityForName(city)!;
  const quote=fixedChinaCityQuote(accepted);
  assert.equal(quote.amountRub,120_000);assert.equal(quote.origin,'Уссурийск');
  assert.equal(quote.distanceKm,accepted.id.startsWith('novokuz')?5800:5600);
  const adjusted=applyFixedChinaCityLedger(native,projection,accepted);
  const engine=calculateAvtocenaFromBusinessConfig({...input,cityDeliveryRub:quote.amountRub,deliveryCity:quote.city});
  assert.equal(adjusted.totalRub,engine.totalRub);
  assert.deepEqual(adjusted.calculationSnapshot.breakdown,engine.breakdown);
  assert.deepEqual(adjusted.calculationSnapshot.paymentPlan,engine.paymentPlan);
  const projected=projectFixedChinaCity(projection,accepted);
  assert.equal(projected.publicVisibleRub,engine.totalRub);
  assert.equal(priceCardForCity(projected,city).offer.totalRub,engine.totalRub,'no double delivery on a same-city display');
  for(const id of ['car','bank-transfer','exchange-reserve','contract-services','customs','utilization-fee'])
   assert.equal(engine.breakdown.find(line=>line.id===id)?.amountRub,base.breakdown.find(line=>line.id===id)?.amountRub,id);
  const bad={...native,calculationSnapshot:{...sheet,sourcePriceAdjustment:{adjustmentRub:0}}};
  assert.throws(()=>applyFixedChinaCityLedger(bad,projection,accepted),/ledger_basis/);
 }
});

test('city scope uses existing normalized city and brand keys and never widens the archived selection',()=>{
 const q={market:'china' as const,city:' г. КЕМЕРОВО ',make:'bmw,Mercedes-Benz, BMW',yearFrom:2019,yearTo:2023,budgetTo:2550000,sort:'totalRub'};
 const matched=eligibleChinaFixedCityQuery(q);
 assert.equal(matched?.id,'kemerovo-v1');
 assert.equal(fixedChinaCityKey(matched!),fixedChinaCityKey(eligibleChinaFixedCityQuery({...q,city:'Кемерово',make:'Mercedes-Benz,BMW'})!));
 for(const modified of [{...q,budgetTo:2550001},{...q,sort:'totalRubDesc'},{...q,yearFrom:2020},{...q,model:'X5'},{...q,make:'BMW'},{...q,city:'Омск'}])
  assert.equal(eligibleChinaFixedCityQuery(modified),null);
});
