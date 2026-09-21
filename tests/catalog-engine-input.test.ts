import assert from 'node:assert/strict';
import test from 'node:test';
import {parseEngineCc} from '../apps/web/lib/catalog/engine-input';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {catalogSearchProjectionMatches,catalogSearchProjectionSort} from '../apps/web/lib/catalog/storage';
test('liters and exact cubic centimeters use the same units without snapping',()=>{
 for(const [input,cc] of [['1,5',1500],['1.5',1500],['1500',1500],['1498',1498],['1 498 см³',1498],['1,498 л',1498],['0.66',660],['2 l',2000]] as const) assert.equal(parseEngineCc(input),cc,input);
 for(const input of ['', 'abc','1,5,0','-1','1498.5','20000']) assert.equal(parseEngineCc(input),undefined,input);
 const base={year:2021,fuel:'petrol',powerHp:123};
 assert.equal(validateCustomerParameters({...base,engineCc:'1,5'}).engineCc,1500);
 assert.equal(validateCustomerParameters({...base,engineCc:'1498'}).engineCc,1498);
});
test('Japan budget uses the delivered preview, never the seller price',()=>{
 const row:any={id:'japan-preview',market:'japan',make:'Toyota',model:'Vitz',year:2020,cardProjectionVersion:3,catalogPricingMode:'seller',sellerPriceRub:100000,totalRub:null,japanDeliveredPreview:{totalRub:1800000,engineCc:1498,estimated:true}};
 assert.equal(catalogSearchProjectionMatches(row,{budgetTo:2000000}),true);
 assert.equal(catalogSearchProjectionMatches(row,{budgetTo:1500000}),false);
 assert.equal(catalogSearchProjectionMatches(row,{budgetFrom:1800000,budgetTo:1800000,engineTo:1498}),true);
 assert.equal(catalogSearchProjectionMatches({...row,japanDeliveredPreview:undefined},{budgetTo:2000000}),false);
 assert.deepEqual(catalogSearchProjectionSort([row,{...row,id:'cheaper',japanDeliveredPreview:{totalRub:1700000}}],'totalRub').map(r=>r.id),['cheaper','japan-preview']);
});

test('budget includes the selected city using the card delivery formula',()=>{
 const row:any={id:'city',market:'japan',make:'Toyota',model:'Vitz',year:2020,cardProjectionVersion:3,catalogPricingMode:'seller',japanDeliveredPreview:{totalRub:1950000,engineCc:1498,estimated:true,deliveryPricingBasis:{subtotalRub:1950000,deliveryRub:0,percents:[]}}};
 assert.equal(catalogSearchProjectionMatches(row,{budgetTo:2000000}),true);
 assert.equal(catalogSearchProjectionMatches(row,{budgetTo:2000000,city:'Новокузнецк'}),false);
});
