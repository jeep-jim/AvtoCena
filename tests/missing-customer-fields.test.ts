import test from 'node:test';
import assert from 'node:assert/strict';
import {missingCustomerFields} from '../apps/web/lib/catalog/missing-customer-fields';

test('missing fields highlight all required blank inputs, and clear after completion',()=>{
 const draft={year:'2022',fuel:'petrol',vehicleCategory:'M1',engineCc:'',powerHp:''};
 assert.deepEqual([...missingCustomerFields(draft)].sort(),['engineCc','powerHp']);
 assert.equal(missingCustomerFields({...draft,engineCc:'1498',powerHp:'150'}).size,0);
 assert.deepEqual([...missingCustomerFields({})].sort(),['fuel','powerHp','year']);
 assert.ok(missingCustomerFields({...draft,fuel:'unknown'}).has('fuel')); 
});
test('electric and hybrid requirements do not mark optional dates or absent combustion volume on EVs',()=>{
 const ev={year:'2023',fuel:'electric',powerHp:'200',vehicleCategory:'M1'};
 assert.deepEqual([...missingCustomerFields(ev)],['power30MinKw']);
 assert.equal(missingCustomerFields({...ev,power30MinKw:'60'}).size,0);
 const hybrid={...ev,fuel:'hybrid',engineCc:'1498'};
 assert.deepEqual([...missingCustomerFields(hybrid)].sort(),['hybridKind','icePowerKw','power30MinKw']);
});
test('commercial category and mass are highlighted without requiring optional freight or peak hp',()=>{
 const truck={year:'2022',fuel:'diesel',engineCc:'2498',vehicleCategory:'N1'};
 assert.deepEqual([...missingCustomerFields(truck,true)],['grossVehicleWeightKg']);
 assert.equal(missingCustomerFields({...truck,grossVehicleWeightKg:'3100'},true).size,0);
});
