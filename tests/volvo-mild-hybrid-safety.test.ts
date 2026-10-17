import test from 'node:test';
import assert from 'node:assert/strict';
import {namedElectrifiedPowertrainKind} from '../apps/web/lib/catalog/powertrain-safety';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
const car:any={make:'Volvo',model:'XC40',trim:'B4 울트라 브라이트',year:2025,fuel:'petrol',powertrainKind:'combustion',engineCc:1969,powerHp:197,powerKw:144.89,icePowerKw:144.89,utilizationPowerKw:144.89,powerDataSource:'kcar_bound_registry_and_detail_hp',cardProjectionVersion:3,totalRub:5000000,sourcePrice:40000000,sourceCurrency:'KRW',calculationSnapshot:{currencyRate:{rateSource:'cbr',currency:'KRW',sourcePrice:40000000,effectiveRate:.06,rateDate:'2026-09-19'}}};
test('XC40 B4 cannot reuse an old petrol customs quote in compact public cards',()=>{
 assert.equal(namedElectrifiedPowertrainKind(car),'other_hybrid');
 const clean=safePublicPricing(car);
 assert.equal(clean.totalRub,null);assert.equal(clean.sellerPriceRub,2400000);
 assert.equal(clean.fuel,'hybrid');assert.equal(clean.powertrainKind,'other_hybrid');
 assert.equal(clean.utilizationPowerKw,undefined);assert.equal(clean.power30MinKw,undefined);
 assert.equal(clean.powerHp,undefined);assert.equal(clean.icePowerKw,undefined);
 assert.equal(car.totalRub,5000000);assert.equal(car.powertrainKind,'combustion');
 assert.deepEqual(safePublicPricing(clean),clean);
});
test('a broad brand, nearby badge or unrelated raw content cannot imply hybrid',()=>{
 for(const patch of [{make:'BMW'},{model:'XC90'},{trim:'T4 Momentum'},{year:2018},{trim:'T4',operational:{raw:{recommendation:'XC40 B4'}}}])assert.equal(namedElectrifiedPowertrainKind({...car,...patch}),undefined);
});
