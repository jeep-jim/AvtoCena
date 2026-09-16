import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPricingSnapshot, compactRepricedProjection } from '../apps/web/lib/catalog/compact-pricing-snapshot';
import { repriceOfferWithBusinessConfig } from '../apps/web/lib/catalog/live-business-pricing';
import { calculateRussiaCustomsForIndividual as customs } from '../packages/engine/src/calculation/russiaCustomsV2';
import { CATALOG_MARKET_DEFAULTS } from '../apps/web/lib/catalog/estimated-market-config';
import { che168GlobalPriceAdjustment } from '../apps/web/lib/catalog/china-owner-policy';

function fixture(market: string, n1=false):any {
  const input:any = {customsValueRub:2000000,eurRateRub:100,productionDate:'2021-01-01',engineCc:1500,powerHp:120,powertrainKind:'combustion',fuel:'petrol',vehicleCategory:n1?'N1':'M1',...(n1?{grossVehicleWeightKg:2500}:{})};
  return {id:'sample',market,make:'Toyota',model:'Corolla',year:2021,engineCc:1500,powerHp:120,fuel:'petrol',powertrainKind:'combustion',sourcePrice:20000,sourceCurrency:'USD',sourceId:'autohome_used_china_open',operational:{sourceUrl:'https://global.che168.com/car/123'},totalRub:3000000,transportToBorderRub:n1?123456:undefined,calculationStatus:'ready',priceMode:'fixed',calculationSnapshot:{customsInput:input,customs:customs(input),sourcePriceRub:2000000,currencyRate:{effectiveRate:100,sourcePriceRub:2000000},missing:[],priceIncludesAllCustoms:true,priceIncludesUtilizationFee:true}};
}
function compact(offer:any) {
  const {operational,sourceId,...row}=offer;
  return {...row,cardProjectionVersion:3,publicVisibleRub:offer.totalRub,calculationSnapshot:{currencyRate:offer.calculationSnapshot.currencyRate,...compactPricingSnapshot(offer)}};
}
for(const market of ['china','korea','uae','georgia','europe']) test(`${market}: compact list and detail replay identical totals and deposit once`,()=>{
  const row=fixture(market);
  if(market==='china') row.calculationSnapshot.sourcePriceAdjustment=che168GlobalPriceAdjustment(row,2000000);
  const full=repriceOfferWithBusinessConfig(row,(CATALOG_MARKET_DEFAULTS as any)[market]);
  const list=repriceOfferWithBusinessConfig(compact(row),(CATALOG_MARKET_DEFAULTS as any)[market]);
  assert.ok(full.totalRub>0);
  assert.equal(list.totalRub,full.totalRub);
  assert.equal(list.publicVisibleRub,full.totalRub);
  assert.equal(full.calculationSnapshot.breakdown.reduce((s:number,l:any)=>s+l.amountRub,0),full.totalRub);
  if(market==='china') {
    assert.equal(list.calculationSnapshot.sourcePriceAdjustment.adjustmentRub,-40000);
    assert.equal(list.calculationSnapshot.customsInput.customsValueRub,2000000);
  }
});
test('N1 freight and legacy audited customs remain replayable in compact lists',()=>{
  const n1=fixture('china',true);
  assert.equal(repriceOfferWithBusinessConfig(compact(n1),CATALOG_MARKET_DEFAULTS.china).totalRub,repriceOfferWithBusinessConfig(n1,CATALOG_MARKET_DEFAULTS.china).totalRub);
  const legacy=fixture('korea');delete legacy.calculationSnapshot.customsInput;
  assert.ok(compactPricingSnapshot(legacy).customsInput);
  assert.equal(repriceOfferWithBusinessConfig(compact(legacy),CATALOG_MARKET_DEFAULTS.korea).totalRub,repriceOfferWithBusinessConfig(legacy,CATALOG_MARKET_DEFAULTS.korea).totalRub);
});
test('invalid replay inputs clear stale projected totals; Japan keeps its snapshot',()=>{
  const row=fixture('korea');row.calculationSnapshot.customsInput.productionDate='2021-02-30';
  const result=repriceOfferWithBusinessConfig(compact(row),CATALOG_MARKET_DEFAULTS.korea);
  assert.equal(result.totalRub,null);assert.equal(result.publicVisibleRub,undefined);
  const japan=fixture('japan');const resultJp=repriceOfferWithBusinessConfig(japan,CATALOG_MARKET_DEFAULTS.japan);
  assert.equal(resultJp.totalRub,japan.totalRub);
  assert.deepEqual(resultJp.calculationSnapshot,japan.calculationSnapshot);
  assert.deepEqual(compactPricingSnapshot(japan),{});
});

test('list replay does not send full calculation ledgers to every browser card',()=>{
  const quote=repriceOfferWithBusinessConfig(compact(fixture('korea')),CATALOG_MARKET_DEFAULTS.korea);
  const lean=compactRepricedProjection(quote);
  assert.equal(lean.totalRub,quote.totalRub);
  assert.equal(lean.publicVisibleRub,quote.publicVisibleRub);
  assert.equal(lean.calculationSnapshot.breakdown,undefined);
  assert.ok(lean.calculationSnapshot.customsInput);
  assert.ok(JSON.stringify(lean).length<JSON.stringify(quote).length);
});
