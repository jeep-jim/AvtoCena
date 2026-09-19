import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena';
import {activeMarketCosts} from '../packages/engine/src/calculation/market-cost-policy';
import {withoutRetiredExportCharge} from '../apps/web/lib/catalog/retired-export-charge';
import {resolveEffectiveMarketVersion} from '../apps/web/lib/effective-market-settings';
import {validateMarketVersion} from '../apps/web/lib/settings-validation';
import {applyJapanServiceCosts,japanServiceCostBasis} from '../apps/web/lib/catalog/japan-service-pricing';

test('retired CRM values cannot enter a new price, percent base, or saved settings',()=>{
 const config:any={currency:'JPY',securityDepositRub:31000,topAvtoCommissionRub:39000,exportExpensesRub:100000,percentExpenses:[{id:'handling',title:'Услуга',percent:10}]};
 const q=calculateAvtocenaFromBusinessConfig({marketId:'japan',sourcePriceRub:1000000,marketConfig:config});
 assert.equal(q.totalRub,1039000*1.1);
 assert.equal(q.breakdown.some(l=>l.id==='export'),false);
 assert.equal('exportExpensesRub' in q.snapshot.marketConfig,false);
 assert.equal(q.paymentPlan.contractInitialPaymentRub,70000);
 assert.equal('exportExpensesRub' in resolveEffectiveMarketVersion('japan',config),false);
 assert.equal('exportExpensesRub' in validateMarketVersion(config).value,false);
 assert.deepEqual(activeMarketCosts(activeMarketCosts(config)),activeMarketCosts(config));
});
test('historical ledger removes exactly the charged cost and its percentage once',()=>{
 const input:any={market:'japan',sourcePrice:1000000,totalRub:1210000,publicVisibleRub:1210000,calculationSnapshot:{marketConfig:{exportExpensesRub:100000,securityDepositRub:31000,topAvtoCommissionRub:39000,percentExpenses:[{id:'fee',percent:10}]},customs:{amount:123},breakdown:[{id:'car',amountRub:1000000},{id:'export',amountRub:100000},{id:'fee',amountRub:110000,amountType:'percent'}]}};
 const before=JSON.stringify(input),out=withoutRetiredExportCharge(input);
 assert.equal(out.totalRub,1100000); assert.equal(out.publicVisibleRub,1100000);
 assert.equal(out.calculationSnapshot.breakdown.reduce((s:number,l:any)=>s+l.amountRub,0),out.totalRub);
 assert.equal(out.calculationSnapshot.paymentPlan.remainingAfterInitialRub,1030000);
 assert.deepEqual(out.calculationSnapshot.customs,input.calculationSnapshot.customs);
 assert.equal(out.sourcePrice,input.sourcePrice);assert.deepEqual(withoutRetiredExportCharge(out),out);assert.equal(JSON.stringify(input),before);
});
test('historical Japan compact and full quote remove the same saved expense',()=>{
 const config={serviceBundleVersion:1,laboratoryRub:50000,topAvtoCommissionRub:39000};
 const snapshot={breakdown:[{id:'car',amountRub:1000000},{id:'laboratory',amountRub:50000},{id:'topavto-commission',amountRub:39000},{id:'export',amountRub:100000}]};
 const full:any={market:'japan',totalRub:1189000,calculationSnapshot:snapshot};
 const compact:any={...full,cardProjectionVersion:3,publicVisibleRub:1189000,calculationSnapshot:{serviceCostBasis:japanServiceCostBasis(snapshot)}};
 for(const input of [full,compact]){const out=applyJapanServiceCosts(input,config);assert.equal(out.totalRub,1089000);assert.equal(applyJapanServiceCosts(out,config).totalRub,out.totalRub);}
});
