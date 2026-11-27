import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {japanVehicleFamilyExcluded,japanVehicleFamilySqlExclusion} from '../apps/web/lib/catalog/japan-vehicle-policy';
import {catalogGrossVehicleWeightKg,catalogHeavyVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';

test('Japanese truck and bus families match in SQL and retained-card admission without excluding light vans',()=>{
 const rows=[
  ['MAZDA','TITAN'],['MAZDA','TITAN 2WD'],['MAZDA','TITAN-DASH'],['MAZDA','TITAN/4WD'],
  ['NISSAN','CIVILIAN'],['NISSAN','CIVILIAN BUS'],['MAZDA','TITANIUM'],['NISSAN','TITAN'],
  ['MAZDA','SCRUM VAN'],['MAZDA','BONGO VAN'],['TOYOTA','HIACE VAN'],['NISSAN','CARAVAN'],
 ];
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('create table cars(id integer,marka_name text,model_name text)');
  const insert=db.prepare('insert into cars values(?,?,?)');rows.forEach(([make,model],i)=>insert.run(i,make,model));
  const admitted=db.prepare('select id from cars where '+japanVehicleFamilySqlExclusion()+' order by id').all().map(row=>row.id);
  assert.deepEqual(admitted,[6,7,8,9,10,11]);
  assert.deepEqual(admitted,rows.flatMap(([make,model],id)=>japanVehicleFamilyExcluded(make,model)?[]:[id]));
  rows.forEach(([make,model],id)=>assert.equal(catalogHeavyVehicleExcluded({market:'japan',make,model}),!admitted.includes(id),`${make} ${model}`));
  assert.equal(japanVehicleFamilyExcluded(' Mazda ',' titan 2wd '),true);
 }finally{db.close();}
});

test('explicit Japanese buses and bus categories are excluded while passenger minivans and N1 vans remain',()=>{
 const base={market:'japan',make:'TOYOTA',model:'HIACE'};
 for(const patch of [{bodyType:'bus'},{bodyType:'microbus'},{bodyType:'coach'},{trim:'COMMUTER BUS'},{bodyType:'автобус'},{bodyType:'マイクロバス'},{vehicleCategory:'M2'},{vehicleCategory:'M3G'}]){
  assert.equal(catalogHeavyVehicleExcluded({...base,...patch}),true,JSON.stringify(patch));
 }
 for(const patch of [{bodyType:'van'},{bodyType:'minivan'},{model:'HIACE VAN'},{trim:'BUSINESS'},{trim:'COACH EDITION'},{trim:'バスター'},{vehicleCategory:'N1'},{vehicleCategory:'N1',grossVehicleWeightKg:3500}]){
  assert.equal(catalogHeavyVehicleExcluded({...base,...patch}),false,JSON.stringify(patch));
 }
 // These additions do not reinterpret another market's admitted data.
 for(const market of ['china','korea','uae','europe','georgia']){
  for(const patch of [{make:'MAZDA',model:'TITAN'},{bodyType:'bus'},{vehicleCategory:'M2'}]){
   assert.equal(catalogHeavyVehicleExcluded({...base,...patch,market}),false,`${market} ${JSON.stringify(patch)}`);
  }
 }
});

test('Japan source normalization does not discard explicit bus evidence before admission',()=>{
 const source={ID:'vehicle-policy-example',MARKA_NAME:'TOYOTA',MODEL_NAME:'HIACE VAN',YEAR:2019,AUCTION_TYPE:2,STATUS:'Sold',FINISH:200000};
 for(const patch of [{MARKA_NAME:'MAZDA',MODEL_NAME:'TITAN 2WD'},{MARKA_NAME:'NISSAN',MODEL_NAME:'CIVILIAN'},{BODY_TYPE:'bus'},{VEHICLE_CATEGORY:'M2'}]){
  assert.equal(ajesLot({...source,...patch},'stats',false),null,JSON.stringify(patch));
 }
 for(const patch of [{BODY_TYPE:'van'},{BODY_TYPE:'minivan'},{VEHICLE_CATEGORY:'N1'},{GRADE:'COACH EDITION'},{GRADE:'バスター'}]){
  assert.ok(ajesLot({...source,...patch},'stats',false),JSON.stringify(patch));
 }
});

test('Japan uses only confirmed permitted gross mass and listing-bound body evidence',()=>{
 const base={market:'japan',make:'TOYOTA',model:'HIACE',sourceId:'ajes_japan_feed',sourceOfferId:'weight-example',bodyType:'van'};
 const withSpecification=(name:string,value:string,sourceOfferId=base.sourceOfferId)=>({...base,operational:{sourceSpecifications:{sourceId:base.sourceId,sourceOfferId,groups:[{items:[{name,value}]}]}}});
 assert.equal(catalogHeavyVehicleExcluded({...base,grossVehicleWeightKg:3500}),false);
 assert.equal(catalogHeavyVehicleExcluded({...base,grossVehicleWeightKg:3501}),true);
 assert.equal(catalogHeavyVehicleExcluded(withSpecification('Разрешённая полная масса','3 501 кг')),true);
 assert.equal(catalogHeavyVehicleExcluded(withSpecification('body type','bus')),true);
 for(const row of [withSpecification('Снаряжённая масса','4000 кг'),withSpecification('Грузоподъёмность','4000 кг'),withSpecification('Разрешённая полная масса','4000 кг','other'),withSpecification('body type','bus','other')]){
  assert.equal(catalogGrossVehicleWeightKg(row),undefined);assert.equal(catalogHeavyVehicleExcluded(row),false);
 }
 assert.equal(catalogHeavyVehicleExcluded({...base,market:'china',grossVehicleWeightKg:3501}),false);
});
