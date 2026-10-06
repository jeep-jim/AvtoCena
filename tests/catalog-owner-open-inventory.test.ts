import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogInventoryAgeDecision as age,catalogHeavyVehicleExcluded as heavy} from '../apps/web/lib/catalog/inventory-admission';
import {selectCatalogPowerMix,catalogPowerBand} from '../apps/web/lib/catalog/power-mix';
import {compareCatalogDisplayOrder} from '../apps/web/lib/catalog/display-order';
import {catalogHardPriceCap} from '../apps/web/lib/catalog/china-owner-policy';
import {selectCatalogShowcaseDiversity} from '../apps/web/lib/catalog/inventory-quota';
const now=new Date('2026-10-06T07:00:00Z');
test('all non-Japan markets expire by exact day, source month or year without invented days',()=>{
 for(const market of ['china','korea','uae','europe','georgia']){
 const row={market,year:2020};
 assert.equal(age({...row,productionDate:'2020-10-06'},now).eligible,true);
 assert.equal(age({...row,productionDate:'2020-10-06'},new Date('2026-10-07T07:00:00Z')).eligible,false);
 assert.equal(age({...row,productionDate:'2020-09'},now).eligible,false);
 assert.equal(age({...row,productionDate:'2020-10'},now).eligible,true);
 assert.equal(age({...row,productionDate:'2020-10'},new Date('2026-11-01T00:00:00Z')).eligible,false);
 assert.equal(age(row,now).eligible,true);
 assert.equal(age(row,new Date('2026-12-31T17:00:00Z')).eligible,false);
 }
 assert.equal(age({market:'japan',year:2010},now).eligible,true);
 assert.equal(age({market:'japan',year:2009},now).eligible,false);
});
test('heavy commercial scope uses gross mass, keeps light trucks and missing editable mass',()=>{
 assert.equal(heavy({bodyType:'truck',grossVehicleWeightKg:3500}),false);
 assert.equal(heavy({bodyType:'bus',grossVehicleWeightKg:3501}),true);
 assert.equal(heavy({vehicleCategory:'N2'}),true);
 assert.equal(heavy({bodyType:'truck',curbWeightKg:3600}),false);
 assert.equal(heavy({make:'Rolls Royce',bodyType:'SUV',grossVehicleWeightKg:3700}),false);
 assert.equal(heavy({model:'Excavator'}),true);
});
test('every market retains every high/low/unknown power row and does not mutate data',()=>{
 for(const market of ['china','korea','uae','europe','georgia','japan']){
 const rows=[{id:'high',market,powerHp:600},{id:'low',market,powerHp:100},{id:'unknown',market}];
 const result=selectCatalogPowerMix(rows as any,{minimumCountByMarket:{[market]:1}});
 assert.deepEqual(result.rows,rows);assert.equal(result.removed.length,0);
 assert.equal(selectCatalogPowerMix([rows[0]] as any).rows.length,1);
 assert.equal(catalogPowerBand(rows[2] as any),'unknown');
 assert.equal(catalogHardPriceCap({market} as any),Infinity);
 }
});
test('display prefers all affordable stock before luxury, then low power; luxury cheapest first',()=>{
 const rows=[{id:'lux2',totalRub:40000000,powerHp:100},{id:'unknown'},{id:'high',totalRub:8000000,powerHp:500},{id:'lux1',totalRub:16000000,powerHp:600},{id:'low',sellerPriceRub:15000000,powerHp:150}];
 assert.deepEqual(rows.sort(compareCatalogDisplayOrder).map(x=>x.id),['low','high','unknown','lux1','lux2']);
 const showcase=selectCatalogShowcaseDiversity(rows.map(x=>({...x,make:x.id,model:x.id,fuel:'petrol'})),5);
 assert.deepEqual(showcase.map(x=>x.id),['low','high','unknown','lux1','lux2']);
});
