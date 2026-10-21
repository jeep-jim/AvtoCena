import test from 'node:test';
import assert from 'node:assert/strict';
import { safePublicPricing } from '../apps/web/lib/catalog/safe-public-pricing';
import { isSellerPricedOffer } from '../apps/web/lib/catalog/seller-price-contract';
import { offerSpecificationGroups } from '../apps/web/lib/catalog/offer-specification-groups';
import { catalogOfferVisibleRub } from '../apps/web/lib/catalog/public-priority';
import { searchProjectionFromOffer, projectionCanRenderCard } from '../apps/web/lib/catalog/storage';
import { applyActiveBusinessPricing, repriceOfferWithBusinessConfig } from '../apps/web/lib/catalog/live-business-pricing';

function fixture(): any {
 return {market:'korea',sourceId:'kcar_korea_open',sourceOfferId:'one',make:'Genesis',model:'G80',year:2023,
  fuel:'petrol',powertrainKind:'combustion',engineCc:2497,powerHp:34,powerKw:25,icePowerKw:25,utilizationPowerKw:25,
  powerDataSource:'kcar_exact_detail_rvo_hrspow_hp',sourcePrice:30000000,sourceCurrency:'KRW',totalRub:3900000,
  calculationStatus:'estimated',publicVisibleRub:3900000,publicSpecificationVerified:true,
  calculationSnapshot:{currencyRate:{rateSource:'cbr',currency:'KRW',sourcePrice:30000000,effectiveRate:.06,rateDate:new Date().toISOString()},customs:{utilizationPowerKw:25}},
  operational:{semanticEvidence:{engineCc:{status:'exact',value:2497},fuel:{status:'exact',value:'petrol'},powertrainKind:{status:'exact',value:'combustion'}},sourceSpecifications:{sourceId:'kcar_korea_open',sourceOfferId:'one',groups:[{name:'Source',items:[{name:'Horsepower',value:'34'},{name:'hrspow',value:'34'},{name:'Colour',value:'White'}]}]}}};
}
test('unsafe delivered quote becomes a bound seller quote without changing saved data',()=>{
 const original=fixture();const clean=safePublicPricing(original);
 assert.equal(isSellerPricedOffer(clean),true);assert.equal(clean.sellerPriceRub,1800000);
 assert.equal(clean.totalRub,null);assert.equal(clean.powerHp,undefined);assert.equal(clean.utilizationPowerKw,undefined);
 assert.equal(clean.calculationSnapshot.customs,undefined);assert.equal(clean.publicSpecificationVerified,false);
 assert.equal(catalogOfferVisibleRub(clean),0);assert.equal(original.powerHp,34);assert.equal(original.totalRub,3900000);
 assert.deepEqual(safePublicPricing(clean),clean);
});
test('mismatched, invalid or future conversion never manufactures a seller quote',()=>{
 for(const patch of [{sourcePrice:1},{currency:'USD'},{rateSource:'fallback_env'},{rateDate:'invalid'},{rateDate:'2100-01-01'},{effectiveRate:0}]){
  const row=fixture();Object.assign(row.calculationSnapshot.currencyRate,patch);
  const clean=safePublicPricing(row);assert.equal(isSellerPricedOffer(clean),false);assert.equal(catalogOfferVisibleRub(clean),0);
 }
});
test('historical bound conversion retains its date so display repricing can refresh it',()=>{
 const row=fixture();row.calculationSnapshot.currencyRate.rateDate='2026-09-11';
 const clean=safePublicPricing(row);assert.equal(isSellerPricedOffer(clean),true);
 assert.equal(clean.calculationSnapshot.currencyRate.rateDate,'2026-09-11');
});
test('rejected horsepower cannot leak through raw source specification groups',()=>{
 for(const row of [fixture(),safePublicPricing(fixture())]){
  const groups=offerSpecificationGroups(row);const items=groups.flatMap(g=>g.items);
  assert.equal(items.some(i=>i.value==='34'),false);assert.equal(items.some(i=>i.value==='Белый'),true);
 }
});
test('verified independent power and prices are untouched',()=>{
 const row=fixture();row.powerDataSource='manufacturer_official';row.powerHp=304;
 row.powerKw=row.icePowerKw=row.utilizationPowerKw=304*0.735499;
 assert.equal(safePublicPricing(row),row);
});
test('all markets quarantine explicit conflicting specifications without guessing replacement values',()=>{
 for(const market of ['korea','china','uae','europe','georgia','japan']) {
  const row=fixture();row.market=market;row.powerDataSource='manufacturer_official';row.powerHp=304;
  row.powerKw=row.icePowerKw=row.utilizationPowerKw=304*0.735499;
  row.operational.semanticEvidence.engineCc={status:'conflict',rawValues:['1998','2497']};
  const clean=safePublicPricing(row);
  assert.equal(clean.engineCc,undefined,market);assert.equal(clean.totalRub,null,market);
  assert.equal(clean.powerHp,304,market);assert.equal(isSellerPricedOffer(clean),true,market);
 }
});
test('search cards retain seller price but never old horsepower or delivered-price attestation',()=>{
 const row=fixture();Object.assign(row,{id:'sample',images:[{url:'https://example.test/car.jpg'}]});
 const projection=searchProjectionFromOffer(row);
 assert.equal(projection.powerHp,undefined);assert.equal(projection.totalRub,null);
 assert.equal(projection.publicSpecificationVerified,false);assert.equal(projection.sellerPriceRub,1800000);
 assert.equal(projectionCanRenderCard(projection),true);
});
test('seller rate refresh updates the currency conversion without resurrecting customs or rejected power',async()=>{
 for(const market of ['korea','japan']) {
  const input=fixture();input.market=market;input.sourceCurrency='RUB';input.sourcePrice=1000000;
  input.calculationSnapshot.currencyRate={currency:'RUB',sourcePrice:1000000,effectiveRate:1,rateSource:'cbr',rateDate:'2026-09-11'};
  const clean=safePublicPricing(input);const result=await applyActiveBusinessPricing(clean);
  assert.equal(result.sellerPriceRub,1000000);assert.equal(result.totalRub,null);
  assert.equal(result.powerHp,undefined);assert.equal(result.calculationSnapshot.customs,undefined);
  assert.equal(result.calculationSnapshot.currencyRate.rateDate,new Date().toISOString().slice(0,10));
  assert.equal(input.powerHp,34);
 }
});
test('business replay itself cannot revive an unsafe saved customs total',()=>{
 const clean=repriceOfferWithBusinessConfig(fixture(),{});
 assert.equal(clean.totalRub,null);assert.equal(isSellerPricedOffer(clean),true);
});
test('old attested compact quotes retain the full audit rejection even after raw evidence was dropped',()=>{
 const row=fixture();Object.assign(row,{id:'b923ba40a0055a4bb5665398',market:'uae',updatedAt:'2026-09-01T00:00:00Z',cardProjectionVersion:3,
  powerHp:103,powerKw:75.75,icePowerKw:75.75,utilizationPowerKw:75.75,powerDataSource:'manufacturer_official'});
 delete row.operational;
 const clean=safePublicPricing(row);assert.equal(clean.totalRub,null);assert.equal(clean.engineCc,undefined);
 assert.equal(clean.fuel,undefined);assert.equal(isSellerPricedOffer(clean),true);
 const refreshed={...row,updatedAt:'2026-09-17T00:00:00Z'};
 assert.equal(safePublicPricing(refreshed),refreshed);
});

test('public projection reader returns sanitized seller rows on current and generation paths', async () => {
 const fs = await import('node:fs/promises');
 const os = await import('node:os');
 const path = await import('node:path');
 const {getJsonStorage,resetJsonStorageForTests} = await import('../apps/web/lib/data');
 const {readCurrentPublicCatalogProjection,resetCatalogReadCachesForTests} = await import('../apps/web/lib/catalog/storage');
 const cwd=process.cwd(), driver=process.env.JSON_STORAGE_DRIVER;
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'safe-public-read-'));
 await fs.mkdir(path.join(temp,'data'));process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';
 resetJsonStorageForTests();resetCatalogReadCachesForTests();
 try {
  const row={...fixture(),id:'unsafe-kcar',cardProjectionVersion:3,cardImageUrl:'https://img.kcar.com/car.jpg'};
  const storage=getJsonStorage();
  await storage.writeJson('catalog/manifest.json',{version:2,generationId:'safety-test',markets:{korea:{count:1}}});
  await storage.writeJson('catalog/generations/safety-test/indexes/projection/korea.json',{generationId:'safety-test',items:[row]});
  for(const generationId of ['safety-test','stale']) {
   await storage.writeJson('catalog/public/projection/all.json',{generationId,items:[row]});
   resetCatalogReadCachesForTests();
   const result=await readCurrentPublicCatalogProjection();
   assert.equal(result.rows.length,1);
   assert.equal(isSellerPricedOffer(result.rows[0]),true);
   assert.equal(result.rows[0].powerHp,undefined);
   assert.equal(result.rows[0].totalRub,null);
   assert.equal(result.rows[0].sellerPriceRub,1800000);
  }
 } finally {
  process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
  resetJsonStorageForTests();resetCatalogReadCachesForTests();await fs.rm(temp,{recursive:true,force:true});
 }
});
