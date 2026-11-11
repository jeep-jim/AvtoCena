import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyJapanDefaultFuel} from '../apps/web/lib/catalog/japan-default-fuel';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {presentCatalogOffer} from '../apps/web/lib/catalog/presentation';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {enrichJapanDrive,japanDriveSql} from '../apps/web/lib/catalog/japan-drive';
test('Japan default covers missing values and retained public cards without manufacturing source evidence',()=>{
 for(const fuel of [undefined,null,'','  ','unknown']){
  const offer={market:'japan',fuel};const filled=applyJapanDefaultFuel(offer);
  assert.equal(filled.fuel,'petrol');assert.equal((filled as any).operational.fuelDefault.source,'owner_policy');
  assert.equal((filled as any).operational.semanticEvidence,undefined);assert.equal(offer.fuel,fuel);
  assert.equal(safePublicPricing(offer).fuel,'petrol');assert.equal(presentCatalogOffer(offer).fuelLabel,'бензин');
 }
});
test('known fuel and other markets stay unchanged',()=>{
 for(const fuel of ['petrol','diesel','electric','hybrid','lpg','cng']){const o={market:'japan',fuel};assert.equal(applyJapanDefaultFuel(o),o);}
 for(const market of ['china','korea','uae','europe','georgia']){const o={market};assert.equal(applyJapanDefaultFuel(o),o);}
});
test('Japan petrol count and pages include empty supplier fuel before limit',()=>{
 for(const aggregate of [undefined,'count'] as const){const sql=ajesQuery({table:'stats',fuel:'petrol|diesel',aggregate}).sql;assert.match(sql,/time is null or time=''/);if(!aggregate)assert.ok(sql.indexOf('time is null')<sql.indexOf('limit'));}
 assert.doesNotMatch(ajesQuery({table:'korea',fuel:'petrol'}).sql,/time is null/);
});
test('source drivetrain wins over grade; mixed source lists do not assert AWD',()=>{
 const offer={market:'japan',trim:'4WD',operational:{raw:{sourceDrive:'FF'}}};
 assert.equal(enrichJapanDrive(offer).drive,'fwd');
 assert.equal(enrichJapanDrive({...offer,trim:'',operational:{raw:{sourceDrive:'FULLTIME4WD'}}}).drive,'awd');
 assert.equal(enrichJapanDrive({...offer,trim:'',operational:{raw:{sourceDrive:'FF,FULLTIME4WD'}}}).drive,undefined);
 const sql=japanDriveSql('awd');assert.match(sql,/priv in \('4WD','AWD','FULLTIME4WD'\)/);assert.match(sql,/priv not in/);
});

test('petrol candidate query never displays known diesel from a legacy alias or factory enrichment',()=>{
 const filter=ajesResultFilter({market:'japan',fuel:'petrol'});
 assert.equal(filter.active,true);assert.equal(filter.matches({fuel:'diesel'}),false);
 assert.equal(filter.matches(applyJapanDefaultFuel({market:'japan'})),true);
 assert.equal(ajesResultFilter({market:'japan',fuel:'electrified'}).matches({fuel:'hybrid'}),true);
});
