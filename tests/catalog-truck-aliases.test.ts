import test from 'node:test';
import assert from 'node:assert/strict';
import {knownHeavyVehicleFamily} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {catalogVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {readFilteredAjesPage} from '../apps/web/lib/catalog/ajes-filtered-page';
const trucks=[['NISSAN','UD SERIES'],['NISSAN','CONDOR'],['NISSAN','UD SERIES Refrigerator'],['MITSUBISHI','FUSO FIGHTER Refrigerator'],['MITSUBISHI','FUSO FIGHTER Dump'],['MITSUBISHI FUSO','FIGHTER']];
test('owner screenshot truck aliases are excluded in every market and supplier row path',()=>{
 for(const [make,model] of trucks){
  assert.equal(knownHeavyVehicleFamily(make,model),true,make+' '+model);
  for(const market of ['japan','korea','china','europe','uae','georgia'])assert.equal(catalogVehicleExcluded({market,make,model}),true,market);
  for(const table of ['stats','main','korea','china'] as const)assert.equal(ajesLot({ID:'1',MARKA_NAME:make,MODEL_NAME:model,YEAR:2020},table,false),null);
 }
 for(const [make,model] of [['NISSAN','NOTE'],['NISSAN','X-TRAIL'],['NISSAN','SERENA'],['MITSUBISHI','OUTLANDER'],['MITSUBISHI','DELICA'],['TOYOTA','HIACE']])assert.equal(knownHeavyVehicleFamily(make,model),false);
});
