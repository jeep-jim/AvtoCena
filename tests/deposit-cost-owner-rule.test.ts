import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateAvtocenaFromBusinessConfig as calculate} from '../packages/engine/src/calculation/calculateAvtocena';
import {customerPriceBreakdown} from '../apps/web/lib/catalog/customer-price-breakdown';
import {applyJapanServiceCosts} from '../apps/web/lib/catalog/japan-service-pricing';
import {compactPricingSnapshot} from '../apps/web/lib/catalog/compact-pricing-snapshot';
import {offerPdfData} from '../apps/web/lib/catalog/offer-pdf';

test('owner 500000 example and six markets add configured payment and commission once',()=>{
 for(const [marketId,deposit,commission] of [['korea',110000,90000],['china',160000,90000],['uae',110000,90000],['europe',110000,90000],['georgia',110000,90000],['japan',31000,39000]] as const){
  const q=calculate({marketId,sourcePriceRub:500000,marketConfig:{securityDepositRub:deposit,topAvtoCommissionRub:commission}});
  assert.equal(q.totalRub,500000+deposit+commission);
  assert.equal(q.paymentPlan.remainingAfterInitialRub,500000);
  const lines=customerPriceBreakdown(q.breakdown);
  assert.equal(lines[0].amountRub,500000);
  assert.equal(lines.filter(l=>l.id==='contract-services').length,1);
  assert.equal(lines.reduce((s,l)=>s+l.amountRub,0),q.totalRub);
  assert.deepEqual(customerPriceBreakdown(lines),lines);
 }
});

test('Korea screenshot total is 1813104, with unchanged seller price and reserve',()=>{
 const q=calculate({marketId:'korea',sourcePriceRub:914909,customsRub:4924+487243,utilizationFeeRub:3400,
  marketConfig:{securityDepositRub:110000,topAvtoCommissionRub:90000,logisticsRub:100181,brokerRub:35000,svhRub:15000,laboratoryRub:25000,exchangeRateReservePercent:3}});
 assert.equal(q.totalRub,1813104);
 assert.equal(q.breakdown.find(l=>l.id==='exchange-reserve')?.amountRub,27447);
 assert.equal(q.paymentPlan.remainingAfterInitialRub,1613104);
});

test('Japanese full, compact and legacy split prices add 31000 once and never reduce seller price',()=>{
 const config={serviceBundleVersion:1,securityDepositRub:31000,topAvtoCommissionRub:39000,laboratoryRub:50000};
 for(const split of [false,true]){
  const full:any={market:'japan',totalRub:1089000,calculationSnapshot:{breakdown:[{id:'car',amountRub:split?969000:1000000},...(split?[{id:'security-deposit',amountRub:31000}]:[]),{id:'topavto-commission',amountRub:39000},{id:'laboratory',amountRub:50000}]}};
  const compact:any={...full,cardProjectionVersion:3,calculationSnapshot:compactPricingSnapshot(full)};
  for(const input of [full,compact]){
   const out=applyJapanServiceCosts(input,config);
   assert.equal(out.totalRub,1120000);
   assert.equal(applyJapanServiceCosts(out,config).totalRub,out.totalRub);
   if(out.calculationSnapshot.breakdown){assert.equal(out.calculationSnapshot.breakdown[0].amountRub,1000000);assert.equal(out.calculationSnapshot.breakdown.reduce((s:number,l:any)=>s+l.amountRub,0),out.totalRub);}
  }
 }
});

test('PDF section subtotals include the payment once for Japan stock and all other markets',()=>{
 for(const market of ['japan','korea','china','uae','europe','georgia'] as const){
  const q=calculate({marketId:market,sourcePriceRub:500000,marketConfig:{securityDepositRub:31000,topAvtoCommissionRub:39000,logisticsRub:100000}});
  const pdf=offerPdfData({id:'green-1',market,make:'Toyota',model:'Test',images:[]} as any,{},q as any);
  assert.equal(pdf.sections[0].rows.at(-1)?.value,'631 000 ₽');
  assert.equal(pdf.sections[1].rows.at(-1)?.value,'39 000 ₽');
  assert.equal(pdf.total,'670 000 ₽');
  assert.equal(pdf.sections.flatMap(s=>s.rows).filter(r=>r.label.includes('Обеспечительный')).length,1);
 }
});

test('derived prices migrate once and retain the percentage basis and source price',async()=>{
 const {applyDepositToProjection,includedDepositCost}=await import('../apps/web/lib/catalog/deposit-cost-projection');
 const source:any={market:'korea',totalRub:590000,publicVisibleRub:590000,calculationSnapshot:{deliveryPricingBasis:{subtotalRub:590000,deliveryRub:0,percents:[1.3]}}};
 const next=applyDepositToProjection(source,110000);
 assert.equal(next.totalRub,700000);assert.equal(next.publicVisibleRub,700000);
 assert.equal(includedDepositCost(next.calculationSnapshot),110000);
 assert.equal(applyDepositToProjection(next,110000).totalRub,700000);
 assert.equal(applyDepositToProjection(next,160000).totalRub,750000);
 assert.equal(source.totalRub,590000);
 assert.deepEqual(next.calculationSnapshot.deliveryPricingBasis,source.calculationSnapshot.deliveryPricingBasis);
 assert.equal(applyDepositToProjection({...source,catalogPricingMode:'seller'},110000).totalRub,590000);
});
