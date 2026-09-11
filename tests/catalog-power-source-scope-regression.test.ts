import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeCombustionPower,combustionPowerMismatch} from '../apps/web/lib/catalog/combustion-power-consistency';
import {calculateRussiaCustomsForIndividual} from '../packages/engine/src/calculation/russiaCustomsV2';
import {sourceInventoryInScope} from '../apps/web/lib/catalog/source-inventory-scope';
import {confirmedProductionValue,confirmedProductionMonth} from '../apps/web/lib/catalog/production-month';

test('Rush corrected 103 hp cannot retain utilization power from an old 199 hp rating',()=>{
 const offer:any={make:'Toyota',model:'Rush',bodyType:'suv',year:2023,fuel:'petrol',powertrainKind:'combustion',engineCc:1499,powerHp:103,powerKw:146.36,icePowerKw:146.36,utilizationPowerKw:146.36,powerDataSource:'encyclopedia_v2:toyota-rush'};
 const fixed=synchronizeCombustionPower(offer);
 assert.equal(combustionPowerMismatch(offer),true);assert.equal(combustionPowerMismatch(fixed),false);
 assert.equal(fixed.powerKw,75.75637);assert.equal(fixed.utilizationPowerKw,fixed.powerKw);
 const result=calculateRussiaCustomsForIndividual({...fixed,customsValueRub:739359,eurRateRub:95,importedAt:new Date('2026-09-11'),personalUseEligible:true});
 assert.equal(result.status,'ready');assert.equal(result.utilizationFeeRub,5200);
 assert.equal(offer.powerKw,146.36);
});
test('hybrid motor and certified utilization ratings are not overwritten with combined peak hp',()=>{
 const o:any={powertrainKind:'other_hybrid',powerHp:300,powerKw:220,icePowerKw:110,utilizationPowerKw:160,powerDataSource:'encyclopedia_v2:hybrid'};
 assert.equal(synchronizeCombustionPower(o),o);
});
test('Autohome excludes old and used cars while Che168 remains used inventory',()=>{
 assert.equal(sourceInventoryInScope({sourceId:'autohome_new_china_open',year:2024}),false);
 assert.equal(sourceInventoryInScope({sourceId:'autohome_new_china_open',year:2025}),true);
 assert.equal(sourceInventoryInScope({sourceId:'autohome_new_china_open',year:2025,mileageKm:10000}),false);
 assert.equal(sourceInventoryInScope({sourceId:'autohome_used_china_open',year:2021,mileageKm:10000}),true);
});
test('unknown manufacturing month stays empty; different-year and impossible dates cannot affect age',()=>{
 assert.equal(confirmedProductionMonth({year:2023,productionDate:'2023-12-01'}),'');
 assert.equal(confirmedProductionValue({year:2023,operational:{raw:{manufacturedate:'2024-12-01'}}}),'');
 assert.equal(confirmedProductionValue({year:2023,operational:{raw:{manufacturedate:'2023-02-31'}}}),'');
 const r=calculateRussiaCustomsForIndividual({year:2023,engineCc:1499,powerHp:103,powertrainKind:'combustion',fuel:'petrol',customsValueRub:739359,eurRateRub:95,importedAt:new Date('2026-09-11')});
 assert.equal(r.ageBand,'from_3_to_5_years');
});
