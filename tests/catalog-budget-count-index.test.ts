import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBudgetCountIndex,countBudgetIndex,matchingBudgetIndex,isBudgetCountQuery} from '../apps/web/lib/catalog/budget-count-index';
import {publicProductionYears} from '../apps/web/lib/catalog/public-year-range';
import {splitAutoCalcIdentity} from '../apps/web/lib/autocalc/identity';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
test('public identity keeps numeric models and never offers pre-2010 years',()=>{
 assert.deepEqual(splitAutoCalcIdentity('Peugeot 2008'),{make:'Peugeot',model:'2008'});
 assert.deepEqual(splitAutoCalcIdentity('Vito'),{make:'',model:'Vito'});
 assert.equal(Math.min(...publicProductionYears(new Date('2026-09-27'))),2010);
});
test('compact budget index preserves city delivery rounding, source data and missing price semantics',()=>{
 const row:any={id:'a',market:'korea',make:'Hyundai',model:'Tucson',year:2021,totalRub:2000000,cardImageUrl:'not-copied',calculationSnapshot:{deliveryPricingBasis:{subtotalRub:1800000,deliveryRub:100000,percents:[3,2]}}};
 const index=buildBudgetCountIndex('g',[row,{...row,id:'unpriced',totalRub:0}],new Map([['a',7]]));
 const price=priceCardForCity(row,'Новокузнецк').offer.totalRub;
 assert.equal(countBudgetIndex(index,{city:'Новокузнецк',budgetTo:price}),1);
 assert.equal(countBudgetIndex(index,{city:'Новокузнецк',budgetTo:price-1}),0);
 assert.equal(matchingBudgetIndex(index,{budgetTo:3000000})[0][5].block,7);
 assert.ok(!JSON.stringify(index).includes('not-copied'));
 assert.equal(countBudgetIndex(index,{market:'japan',budgetTo:3000000}),0);
 assert.equal(isBudgetCountQuery({budgetTo:2000000,model:'Vito'}),false);
});
test('Japanese quote is bound to the exact source revision and price',()=>{
 const row:any={id:'j',market:'japan',make:'Toyota',model:'Corolla',year:2022,totalRub:0,updatedAt:'now',sourcePrice:123,sourceCurrency:'JPY'};
 const index=buildBudgetCountIndex('g',[row]);
 const quote={updatedAt:'now',sourcePrice:123,sourceCurrency:'JPY',totalRub:1800000};
 assert.equal(countBudgetIndex(index,{budgetTo:2000000},{j:quote}),1);
 assert.equal(countBudgetIndex(index,{budgetTo:2000000},{j:{...quote,sourcePrice:124}}),0);
});
