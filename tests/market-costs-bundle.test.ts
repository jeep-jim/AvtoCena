import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {migrateMarketCosts} from '../apps/web/lib/market-costs-migration';
import {selectActiveMarketVersion} from '../apps/web/lib/business-settings';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena';
import {customerPriceBreakdown} from '../apps/web/lib/catalog/customer-price-breakdown';
import {repriceOfferWithBusinessConfig} from '../apps/web/lib/catalog/live-business-pricing';
import {compactPricingSnapshot} from '../apps/web/lib/catalog/compact-pricing-snapshot';

const seeds = JSON.parse(fs.readFileSync(new URL('../data/markets/markets.json',import.meta.url),'utf8'));
const legacy = seeds.map((m:any)=>({...m, versions:m.versions.filter((v:any)=>!v.serviceBundleVersion).map((v:any)=>({...v,status:'active'}))}));
const at = '2026-09-16T01:00:00Z';
test('six-market migration changes only requested costs, preserves history, is idempotent and honors later CRM edits',()=>{
 const before = JSON.stringify(legacy); const result=migrateMarketCosts(legacy,at);
 assert.equal(result.changed.length,6);
 assert.equal(JSON.stringify(legacy),before);
 for(const m of result.markets){
  const v=selectActiveMarketVersion(m,new Date(at));const old=result.changed.find(c=>c.marketId===m.id)!.oldValue;
  assert.equal(v.laboratoryRub,50000);assert.equal(v.sbktsRub,0);assert.equal(v.eptsRub,0);
  assert.equal(v.contractInitialPaymentRub,m.id==='japan'?70000:250000);
  assert.equal(v.topAvtoCommissionRub,m.id==='japan'?39000:90000);
  assert.equal(v.securityDepositRub+v.topAvtoCommissionRub,v.contractInitialPaymentRub);
  for(const key of ['logisticsRub','exportExpensesRub','brokerRub','svhRub','rfDeliveryRub','exchangeRateReservePercent']) assert.equal(v[key],old[key],`${m.id}:${key}`);
  const archived=m.versions.find((x:any)=>x.id===old.id);assert.deepEqual({...archived,status:old.status},old);
  v.laboratoryRub=62000; // future country-specific amendment must survive deploy
 }
 assert.deepEqual(migrateMarketCosts(result.markets,at).markets,result.markets);
 assert.equal(migrateMarketCosts(result.markets,at).changed.length,0);
});
test('every active market quote keeps the full car price, keeping total, commission and 50k bundle',()=>{
 for(const m of seeds){
  const config=selectActiveMarketVersion(m,new Date(at));
  const quote=calculateAvtocenaFromBusinessConfig({marketId:m.id,marketConfig:config,sourcePriceRub:1000000,customsRub:400000,utilizationFeeRub:5200});
  const car=quote.breakdown.find(l=>l.id==='car')!; assert.equal(car.amountRub,1000000);assert.equal(car.note,undefined);
  assert.equal(quote.breakdown.find(l=>l.id==='security-deposit')?.amountRub,undefined);
  assert.ok(!quote.breakdown.some(l=>['sbkts','epts'].includes(l.id)));
  const bundle=quote.breakdown.find(l=>l.id==='laboratory')!;assert.equal(bundle.amountRub,50000);assert.equal(bundle.title,'Лаборатория, СБКТС, ЭПТС');
  assert.deepEqual(bundle.includedServices,['laboratory','sbkts','epts']);
  const fixed=['topAvtoCommissionRub','exportExpensesRub','logisticsRub','brokerRub','svhRub','rfDeliveryRub','otherFixedExpensesRub'].reduce((s,k)=>s+Number(config[k]||0),0);
  assert.equal(quote.totalRub,1000000+400000+5200+fixed+50000+20000);
  assert.equal(quote.breakdown.reduce((s,l)=>s+l.amountRub,0),quote.totalRub);
 }
});
test('legacy display merges without rewriting its total and removes deposit explanations',()=>{
 const lines=[{id:'car',amountRub:840000,note:'old deposit explanation'},{id:'security-deposit',amountRub:160000},{id:'laboratory',amountRub:15000},{id:'sbkts',amountRub:35000},{id:'epts',amountRub:35000}];
 const out=customerPriceBreakdown(lines);assert.equal(out.length,2);assert.equal(out[0].amountRub,1000000);assert.equal(out[0].note,undefined);assert.equal(out[1].amountRub,85000);
 assert.deepEqual(customerPriceBreakdown(out),out);assert.equal(lines[0].amountRub,840000);
});
test('Japan list/detail apply the same service-only delta once, keeping auction, FX and customs frozen',()=>{
 const config=selectActiveMarketVersion(seeds.find((m:any)=>m.id==='japan'),new Date(at));
 const oldQuote=calculateAvtocenaFromBusinessConfig({marketId:'japan',marketConfig:{...config,laboratoryRub:15000,sbktsRub:35000,eptsRub:35000},sourcePriceRub:1000000,customsRub:400000});
 const full:any={id:'jp',market:'japan',totalRub:oldQuote.totalRub,calculationStatus:'ready',calculationSnapshot:{...oldQuote.snapshot,currencyRate:{effectiveRate:0.54,rateDate:'2026-08-01',sourcePriceRub:1000000},customs:{status:'ready',totalCustomsRub:400000}}};
 const compact:any={...full,cardProjectionVersion:3,publicVisibleRub:full.totalRub,calculationSnapshot:{currencyRate:full.calculationSnapshot.currencyRate,...compactPricingSnapshot(full)}};
 const a=repriceOfferWithBusinessConfig(full,config),b=repriceOfferWithBusinessConfig(compact,config);
 assert.equal(a.totalRub,full.totalRub-35000);assert.equal(b.totalRub,a.totalRub);assert.equal(b.publicVisibleRub,a.totalRub);
 assert.deepEqual(a.calculationSnapshot.customs,full.calculationSnapshot.customs);assert.deepEqual(a.calculationSnapshot.currencyRate,full.calculationSnapshot.currencyRate);
 assert.equal(a.calculationSnapshot.breakdown.reduce((s:number,l:any)=>s+l.amountRub,0),a.totalRub);
 assert.equal(repriceOfferWithBusinessConfig(a,config).totalRub,a.totalRub);
 assert.equal(repriceOfferWithBusinessConfig(b,config).totalRub,b.totalRub);
 const unknown={...full,calculationSnapshot:{}};assert.equal(repriceOfferWithBusinessConfig(unknown,config).totalRub,full.totalRub);
});
