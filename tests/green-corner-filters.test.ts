import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGreenCorner, greenCornerBudgetPrice } from '../apps/web/lib/catalog/green-corner-search';
const rows:any[]=[{id:'1',make:'HONDA',model:'FREED',year:2020,engineCc:1500,powerHp:118,mileageKm:45000,sellerPriceRub:600000,drive:'fwd',transmission:'IAT',auctionGrade:'4'},{id:'2',make:'TOYOTA',model:'PRIUS',year:2021,engineCc:1800,powerHp:180,mileageKm:80000,sellerPriceRub:900000,auctionGrade:'4.5'},{id:'3',make:'HONDA',model:'FIT',year:2019}];
test('Green filters combine source fields and reject missing bounded values',()=>{
 assert.deepEqual(filterGreenCorner(rows,{make:'HONDA',engineTo:'1.6',powerTo:'160',mileageTo:'50000',drive:'fwd',transmission:'IAT',auctionGrade:'4'}).map(x=>x.id),['1']);
 assert.deepEqual(filterGreenCorner(rows,{fobTo:'700000'}).map(x=>x.id),['2','1','3']); // Obsolete source-price parameters no longer filter the catalogue.
 assert.deepEqual(filterGreenCorner(rows,{budget:'1000000'}),[]);
 assert.deepEqual(filterGreenCorner(rows,{make:'HONDA,TOYOTA',yearFrom:'2020',sort:'yearAsc'}).map(x=>x.id),['1','2']);
 assert.deepEqual(filterGreenCorner(rows,{fuel:'electric'}),[]);
});

const priced:any[]=[
 {...rows[0],id:'low',catalogPricingMode:'seller',sellerPriceRub:800000,japanDeliveredPreview:{totalRub:1100000}},
 {...rows[0],id:'high',catalogPricingMode:'seller',sellerPriceRub:700000,japanDeliveredPreview:{totalRub:1200000}},
 {...rows[0],id:'outside',catalogPricingMode:'seller',sellerPriceRub:1150000,japanDeliveredPreview:{totalRub:1800000}},
 {...rows[0],id:'unknown',catalogPricingMode:'seller',sellerPriceRub:1150000},
 {...rows[0],id:'saved',catalogPricingMode:'seller',japanDeliveredPreview:{totalRub:1800000},savedCalculationPreview:{totalRub:1150000}},
];
test('budget 1.1–1.2 million includes boundaries and saved price, excludes 1.8 million and unknown totals',()=>{
 const params={budgetFrom:'1100000',budget:'1200000',sort:'totalRub'};
 assert.deepEqual(filterGreenCorner(priced,params).map(x=>x.id),['low','saved','high']);
 assert.deepEqual(filterGreenCorner(priced,{...params,budget:undefined,budgetTo:'1200000'}).map(x=>x.id),['low','saved','high']);
});
test('both price sort directions use displayed totals and put unknown prices last',()=>{
 assert.deepEqual(filterGreenCorner(priced,{sort:'totalRub'}).map(x=>x.id),['low','saved','high','outside','unknown']);
 assert.deepEqual(filterGreenCorner(priced,{sort:'totalRubDesc'}).map(x=>x.id),['outside','high','saved','low','unknown']);
});
test('budget matches city-adjusted cards without adding delivery to a saved scenario',()=>{
 const row:any={...priced[0],market:'japan',japanDeliveredPreview:{totalRub:1100000,deliveryPricingBasis:{subtotalRub:1100000,deliveryRub:0,percents:[]}}};
 const price=greenCornerBudgetPrice(row,'Новокузнецк');
 assert.equal(price,1220000);
 assert.equal(filterGreenCorner([row],{city:'Новокузнецк',budget:'1200000'}).length,0);
 assert.equal(filterGreenCorner([row],{city:'Новокузнецк',budgetFrom:'1220000',budget:'1220000'}).length,1);
 assert.equal(greenCornerBudgetPrice({...row,savedCalculationPreview:{totalRub:1150000}} as any,'Новокузнецк'),1150000);
});
