import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPowerSanity, publicCatalogPowerHp } from '../apps/web/lib/catalog/power-sanity';
import { normalizeVehicleOfferSpecs } from '../apps/web/lib/catalog/spec-normalization';
import { catalogOfferVisibleRub } from '../apps/web/lib/catalog/public-priority';
import { kcarSpecificationEvidence } from '../apps/web/lib/catalog/kcar-exact-source';
import { restoreSavedSourceEvidence } from '../apps/web/lib/catalog/saved-source-recovery';
import { safePublicPricing } from '../apps/web/lib/catalog/safe-public-pricing';

test('large-engine low-power evidence is reviewed without inventing horsepower',()=>{
 const row:any={market:'europe',engineCc:2400,powerHp:34,fuel:'diesel',powertrainKind:'combustion',powerDataSource:'seller_exact',totalRub:2000000};
 assert.equal(catalogPowerSanity(row).reason,'large_engine_low_power_requires_review');
 const safe=safePublicPricing(row);
 assert.equal(safe.powerHp,undefined);assert.equal(safe.totalRub,null);
 assert.equal(row.powerHp,34);
 assert.equal(catalogPowerSanity({...row,engineCc:2000}).suspicious,false);
 assert.equal(catalogPowerSanity({...row,powerHp:100}).suspicious,false);
 assert.equal(catalogPowerSanity({...row,powerDataSource:'manufacturer_official'}).suspicious,false);
 assert.equal(catalogPowerSanity({...row,fuel:'hybrid',powertrainKind:'other_hybrid'}).suspicious,false);
});

for (const powerHp of [34, 100, 104, 111, 134, 144, 150, 304]) {
 test(`unverified K Car ${powerHp} hp cannot survive normalization or an attested price`, () => {
  const row:any={market:'korea',sourceId:'kcar_korea_open',sourceOfferId:'EC61398692',make:'Genesis',model:'G80',fuel:'petrol',powertrainKind:'combustion',engineCc:2497,powerHp,powerKw:powerHp*.7355,icePowerKw:powerHp*.7355,utilizationPowerKw:powerHp*.7355,powerDataSource:'kcar_exact_detail_rvo_hrspow_hp',powerDataConfidence:'source_exact',cardProjectionVersion:3,publicSpecificationVerified:true,publicVisibleRub:3920390,calculationStatus:'estimated',calculationSnapshot:{customs:{utilizationPowerKw:powerHp*.7355}}};
  assert.equal(publicCatalogPowerHp(row),undefined);
  assert.equal(catalogOfferVisibleRub(row),0);
  const normalized=normalizeVehicleOfferSpecs(row);
  for(const field of ['powerHp','powerKw','icePowerKw','utilizationPowerKw']) assert.equal(normalized[field],undefined,field);
  assert.equal(catalogOfferVisibleRub(normalized),0);
  assert.equal(catalogPowerSanity(normalized).reason,'unverified_kcar_hrspow');
  assert.equal(row.powerHp,powerHp);
 });
}
test('raw K Car power is retained as ambiguous evidence for both fuel unit codes',()=>{
 for(const [fuelName,rawFuelType] of [['가솔린','001'],['전기','009']]){
  const e=kcarSpecificationEvidence({fuelName,rawFuelType,horsepower:'304'});
  const p=rawFuelType==='009'?e.powerKw:e.powerHp;
  assert.equal(p.status,'ambiguous');assert.equal(p.value,undefined);assert.deepEqual(p.rawValues,['304']);
 }
});
test('saved-source recovery cannot upgrade old K Car power attestations',()=>{
 const row:any={market:'korea',sourceId:'kcar_korea_open',sourceOfferId:'one',fuel:'petrol',powerHp:34,engineCc:2497,powerDataSource:'kcar_exact_detail_rvo_hrspow',operational:{detailIdentityVerified:true,fieldIdentityVerified:true,sourceExactFields:['powerHp','engineCc','fuel']}};
 const recovered=restoreSavedSourceEvidence(row);assert.equal(recovered.powerHp,undefined);assert.equal(recovered.powerKw,undefined);assert.equal(recovered.totalRub,null);
});
test('independent official specifications and other sources remain eligible',()=>{
 const row:any={market:'korea',make:'Genesis',model:'G80',fuel:'petrol',powertrainKind:'combustion',engineCc:2497,powerHp:304,powerDataSource:'manufacturer_official'};
 assert.equal(publicCatalogPowerHp(row),304);
 assert.equal(publicCatalogPowerHp({...row,sourceId:'other',powerDataSource:'other_exact'}),304);
});
