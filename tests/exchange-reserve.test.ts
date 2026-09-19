import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena';
import {applyJapanServiceCosts} from '../apps/web/lib/catalog/japan-service-pricing';
import {compactPricingSnapshot} from '../apps/web/lib/catalog/compact-pricing-snapshot';
import {resolveEffectiveMarketVersion} from '../apps/web/lib/effective-market-settings';
import {validateMarketVersion} from '../apps/web/lib/settings-validation';

test('all markets restore 2 percent reserve separately from exact seller conversion',()=>{
 for(const marketId of ['japan','china','korea','uae','europe','georgia'] as const){
  const config={exchangeRateReservePercent:2,topAvtoCommissionRub:90000,securityDepositRub:160000,logisticsRub:250000};
  const q=calculateAvtocenaFromBusinessConfig({marketId,marketConfig:config,sourcePriceRub:1001396});
  assert.equal(q.breakdown[0].amountRub,1001396);
  assert.equal(q.totalRub,1361424);
  assert.equal(q.snapshot.marketConfig.exchangeRateReservePercent,2);
  assert.equal(q.breakdown.at(-1)?.amountRub,20028);
  assert.equal(resolveEffectiveMarketVersion(marketId,config).exchangeRateReservePercent,2);
 }
 assert.equal(validateMarketVersion({currency:'KRW',exchangeRateReservePercent:2}).value.exchangeRateReservePercent,2);
});

test('Japanese historical reserve is removed exactly once in detail and compact cards',()=>{
 const config={serviceBundleVersion:1,topAvtoCommissionRub:39000,laboratoryRub:50000,securityDepositRub:31000};
 const full:any={id:'japan',market:'japan',totalRub:1129028,calculationSnapshot:{currencyRate:{effectiveRate:0.5},breakdown:[
  {id:'car',amountRub:1000000},{id:'topavto-commission',amountRub:39000},{id:'laboratory',amountRub:50000},{id:'customs',amountRub:20000},{id:'exchange-reserve',amountRub:20028}
 ]}};
 const before=JSON.stringify(full);
 const compact:any={...full,cardProjectionVersion:3,publicVisibleRub:full.totalRub,calculationSnapshot:compactPricingSnapshot(full)};
 for(const input of [full,compact]){
  const result=applyJapanServiceCosts(input,config);
  assert.equal(result.totalRub,1109000);
  assert.equal(applyJapanServiceCosts(result,config).totalRub,1109000);
  if(result.cardProjectionVersion) assert.equal(result.publicVisibleRub,1109000);
 }
 const result=applyJapanServiceCosts(full,config);
 assert.equal(result.calculationSnapshot.breakdown.reduce((s:number,l:any)=>s+l.amountRub,0),result.totalRub);
 assert.deepEqual(result.calculationSnapshot.currencyRate,full.calculationSnapshot.currencyRate);
 assert.equal(JSON.stringify(full),before);
});

test('owner Casper restores reserve while retired export remains excluded',()=>{
 const q=calculateAvtocenaFromBusinessConfig({marketId:'korea',sourcePriceRub:1001396,
 customsRub:4924+145400,utilizationFeeRub:5200,marketConfig:{exchangeRateReservePercent:2,
 securityDepositRub:160000,topAvtoCommissionRub:90000,exportExpensesRub:70000,logisticsRub:250000,
 brokerRub:35000,svhRub:35000,laboratoryRub:50000,rfDeliveryRub:120000}});
 assert.equal(q.totalRub,1826948-70000);
 assert.equal(q.paymentPlan.remainingAfterInitialRub,1506948);
});


test('Japan restores reserve once and list/detail totals agree with a frozen historical rate',()=>{
 const config={serviceBundleVersion:1,topAvtoCommissionRub:39000,laboratoryRub:50000,securityDepositRub:31000,exchangeRateReservePercent:2};
 for (const oldReserve of [0,20028]) {
  const full:any={id:'jp',market:'japan',totalRub:1109000+oldReserve,calculationSnapshot:{currencyRate:{effectiveRate:0.5},breakdown:[
   {id:'car',amountRub:1000000},{id:'topavto-commission',amountRub:39000},{id:'laboratory',amountRub:50000},{id:'customs',amountRub:20000},
   ...(oldReserve ? [{id:'exchange-reserve',amountRub:oldReserve}] : [])
  ]}};
  const compact:any={...full,cardProjectionVersion:3,publicVisibleRub:full.totalRub,calculationSnapshot:compactPricingSnapshot(full)};
  for(const input of [full,compact]) {
   const result=applyJapanServiceCosts(input,config);
   assert.equal(result.totalRub,1129000);
   assert.equal(applyJapanServiceCosts(result,config).totalRub,1129000);
   if(result.cardProjectionVersion) assert.equal(result.publicVisibleRub,1129000);
   else { assert.equal(result.calculationSnapshot.breakdown.at(-1).amountRub,20000); assert.equal(result.calculationSnapshot.breakdown.reduce((n:number,l:any)=>n+l.amountRub,0),result.totalRub); }
  }
 }
});
