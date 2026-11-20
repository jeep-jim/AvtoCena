import './helpers/server-only-hook.mjs';
import 'next/dist/server/node-environment-baseline';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {independentMarketDigest,openIndependentMarketFixture,type IndependentCut,type IndependentMarketPaper} from '../apps/web/lib/catalog/independent-market-activation-fixture';
import {independentChinaSourceDigest,prepareIndependentChinaFixture} from '../apps/web/lib/catalog/independent-china-prepared-fixture';
import {openFreshChinaPriceReplay,type CleanChinaPriceSourceProof} from '../apps/web/lib/catalog/prepared-china-fresh-price-replay';
import {openStageChinaFiles} from '../apps/web/lib/catalog/china-stage-runtime-files';
import {CHINA_REGCLOUD_STAGE_ORIGIN,transferChinaPrivateStage,type ChinaDurableStagePermit} from '../apps/web/lib/catalog/china-durable-object-stage';
import {CHINA_PUBLIC_CONTROL,chinaObjectDigest,openChinaStageObjectFiles,openConfiguredChinaRegcloudFiles,type ChinaPublicRef,type ChinaLegacyRollback,type ChinaPublicState} from '../apps/web/lib/catalog/china-regcloud-object-reader';
import {switchChinaRegcloudCut,type ChinaOwnSwitchPermit,type VerifiedChinaRuntimeProbe} from '../apps/web/lib/catalog/china-regcloud-cut-switch';
import {withPreparedChinaRegcloudPreview,withPreparedChinaHttpFixture} from '../apps/web/lib/catalog/prepared-china-http-fixture';
import {getJsonStorage,LocalJsonStorage,ObjectJsonStorage,resetJsonStorageForTests,StorageConflictError,type JsonStorage} from '../apps/web/lib/data';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
import {captureCatalogFxBatch,resetCatalogRateCache,withCatalogFxBatch} from '../apps/web/lib/catalog/rates';
import {budgetPricingFingerprint} from '../apps/web/lib/catalog/shared-budget-prices';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing';
import {preparePriceCardBlock,preparedPriceCardDigest,preparedPriceCardMarketDigest,readShadowActivePriceCardBlock,shadowPriceCardValues,verifyPriceCardBlock}
 from '../apps/web/lib/catalog/prepared-price-card-block';
import {resetChinaCnyPriceCache} from '../apps/web/lib/catalog/china-cny-price';
import {resetCatalogEditorialCache} from '../apps/web/lib/catalog/editorial';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena';
import {quoteCityDelivery} from '../apps/web/lib/catalog/city-delivery';
import {readPreparedChinaFixtureOffer} from '../apps/web/lib/catalog/prepared-china-http-fixture';
import {calculateRussiaCustomsForIndividual,type RussiaCustomsV2Input} from '../packages/engine/src/calculation/russiaCustomsV2';
import type {VehicleOffer} from '../apps/web/lib/catalog/types';
import {activatePreparedChinaFixture,readActivePreparedChinaFixturePart} from '../apps/web/lib/catalog/prepared-china-fixture-activation';
import {createPrivateChinaPriceSink,verifyPrivateChinaPriceSeal,type PrivatePriceSealAuthority} from '../apps/web/lib/catalog/prepared-price-private-seal';
import {preparedCoverageIdsDigest,type PreparedPriceCoverageContext,type PreparedPriceExpectedBlock} from '../apps/web/lib/catalog/prepared-price-coverage';
import {compilePreparedChinaModelScope,compactPublicStorageOffer,persistCatalogOffers,prepareChinaPriceShadowBeforeWrite,prepareChinaPriceCoverageBeforeWrite,
 previewCanonicalPublicCatalogOffers,resetCatalogReadCachesForTests,type CatalogManifest} from '../apps/web/lib/catalog/storage';

const asOf=Date.parse('2026-11-20T23:59:59Z'), freshDay='2026-11-20',generationId='gen_1790001000000_abcd1234';
const fixtureManifest:CatalogManifest={version:2,generationId,updatedAt:new Date(asOf).toISOString(),
 markets:{china:{count:2,chunks:['chunk-0001'],updatedAt:new Date(asOf).toISOString()}}};
const exactChinaOffer=(id:string,sourcePrice:number)=> {
 const input:RussiaCustomsV2Input={customsValueRub:Math.round(sourcePrice*12.5),eurRateRub:95,engineCc:2998,powerHp:370,
  powerKw:272,icePowerKw:272,utilizationPowerKw:272,powertrainKind:'combustion',fuel:'petrol',vehicleCategory:'M1',
  productionDate:'2022-01-01',importedAt:new Date(asOf)};
 return {id,market:'china',sourceId:'autohome_used_china_open',sourceOfferId:id,status:'active',offerType:'fixed',
  make:'Fixture',model:'Exact-272',year:2022,productionDate:'2022-01-01',engineCc:2998,
  powerHp:370,powerKw:272,icePowerKw:272,utilizationPowerKw:272,powertrainKind:'combustion',fuel:'petrol',bodyType:'suv',
  powerDataSource:'fixture:named_ice_kw',sourcePrice,sourceCurrency:'CNY',priceMode:'fixed',
  chinaPriceConversion:{sourceCurrency:'USD',sourcePrice:sourcePrice*12.5/85,sourcePriceCny:sourcePrice,usdRub:85,cnyRub:12.5,rateDate:freshDay},
  operational:{sourceUrl:'https://global.che168.com/example',privateMarker:'DO-NOT-COPY',raw:{hidden:'DO-NOT-COPY'},
   semanticEvidence:Object.fromEntries(Object.entries({powerHp:370,powerKw:272,engineCc:2998,fuel:'petrol',powertrainKind:'combustion'})
    .map(([key,value])=>[key,{status:'exact',value,source:'fixture-exact'}]))},
  images:[{id:'photo-'+id,url:'https://assets.fixture.test/photo.jpg'}],totalRub:4_000_000,calculationStatus:'ready',
  firstSeenAt:new Date(asOf).toISOString(),updatedAt:new Date(asOf).toISOString(),
  calculationSnapshot:{customsInput:input,customs:calculateRussiaCustomsForIndividual(input),sourcePriceRub:input.customsValueRub,
   priceIncludesAllCustoms:true,priceIncludesUtilizationFee:true,missing:[]}} as unknown as VehicleOffer;
};

function cleanSourceFixture(rows:readonly VehicleOffer[],sourceExpiresAt:number,counts:{eligibleUnpricedRows:number;excludedRows:number;explicitlyWithdrawnRows:number},cursor?:{sequence:number;anchorSha256:string}){
 const source={continuitySha256:'1'.repeat(64),sourceReportSha256:'2'.repeat(64),nativeAdmissionSha256:'3'.repeat(64),
  sourceReplicaSha256:cursor?.anchorSha256??'4'.repeat(64),sourceCursor:cursor?.sequence??13123821,sourceExpiresAt};
 const digest=createHash('sha256').update('china-full-fresh-source-ordered-input-v1\n');
 const inputs=rows.map(row=>{const d={id:row.id,inputSha256:preparedPriceCardDigest(row)};digest.update(JSON.stringify(d)+'\n');return d;});
 const proof:CleanChinaPriceSourceProof={...source,version:1,kind:'china-full-fresh-source-admission-only',
  coverage:'materialized_complete_replica_after_committed_delta',oldRowsMerged:false,sourceRows:rows.length,
  ...counts,orderedInputSha256:digest.digest('hex'),priced:false,publicationAuthorized:false,cursorAdvanceAuthorized:false};
 return {source,inputs,proof,proofSha256:preparedPriceCardDigest(proof)};
}

test('China full readiness preserves exact ledger and numeric parity in one bounded shadow block',async t=>{
 t.mock.timers.enable({apis:['Date'],now:asOf});
 const old={disabled:process.env.CATALOG_LIVE_RATE_DISABLED,calc:process.env.AVTOCENA_CALCULATION_VERSION,fetch:globalThis.fetch};
 let outbound=0, rateReads=0,cny=12.5;
 globalThis.fetch=async()=>{outbound++;throw Error('fixture_network_forbidden');};
 process.env.CATALOG_LIVE_RATE_DISABLED='1';process.env.AVTOCENA_CALCULATION_VERSION='a'.repeat(64);
 const db=getJsonStorage(),prior={readJsonWithMeta:db.readJsonWithMeta,readJson:db.readJson,writeJson:db.writeJson};
 db.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  if(key==='fees/exchange-rates.json'){
   rateReads++;
   return {found:true,value:{rates:[['CNY',cny],['USD',85],['EUR',95]].map(([currency,cbrRate])=>
    ({currency,cbrRate,nominal:1,rateDate:freshDay,rateSource:'cbr'}))} as T};
  }
  assert.ok(['markets/markets.json','catalog-editorial/current.json','catalog/china-cny-prices/current.json'].includes(key),key);
  return {found:false,value:fallback};
 };
 db.readJson=async<T>(key:string,fallback:T)=>(await db.readJsonWithMeta(key,fallback)).value;
 db.writeJson=async()=>assert.fail('frozen producer fixture must write nothing');
 try{
  resetCatalogRateCache();resetChinaCnyPriceCache();resetCatalogEditorialCache();invalidateEffectiveMarketsCache();
  const fx=await captureCatalogFxBatch('china',['CNY']);
  const pricingFingerprint=await withCatalogFxBatch(fx,()=>budgetPricingFingerprint('china'));assert.ok(pricingFingerprint);
  const offers=[exactChinaOffer('zh-a',100000),exactChinaOffer('zh-b',200000)];
  const inputs={manifest:fixtureManifest,market:'china' as const,sourceChunk:'chunk-0001',part:0,offers,
   sourceInputSha256:preparedPriceCardDigest(offers),fx,pricingFingerprint};
  const native=await withCatalogFxBatch(fx,()=>applyActiveBusinessPriceBatch(offers,{readOnly:true,retainFullSnapshot:true}));
  const first=await preparePriceCardBlock(inputs);
  const sealed=verifyPriceCardBlock(first.bytes,first.descriptor);
  assert.deepEqual(sealed.details.map(row=>row.totalRub),native.map(row=>row.totalRub));
  for(const [i,row] of sealed.details.entries()){
   const same=JSON.parse(JSON.stringify(native[i].calculationSnapshot));
   assert.deepEqual(row.ledger.breakdown,same.breakdown);
   assert.deepEqual(row.ledger.customs,same.customs);
   assert.deepEqual(row.ledger.paymentPlan,same.paymentPlan);
   assert.equal(row.ledger.customs.utilizationPowerKw,272);
   assert.equal((row.ledger.sourcePriceAdjustment as any).policy,'owner_che168_global_minus_2_percent_20260913');
  }
  assert.ok(!first.bytes.toString().includes('DO-NOT-COPY'));
  assert.ok(!sealed.index.rows.some(row=>row.length>7));
  cny=18; t.mock.timers.tick(2_000);
  const repeated=await preparePriceCardBlock(inputs);assert.deepEqual(repeated.bytes,first.bytes);
  assert.equal(rateReads,1,'one quote book during preparation and byte replay');
  assert.equal(outbound,0);

  const freshPriceParent=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-price-fresh-'));
  try{
   const noPrice={...offers[0],id:'no-source-price',sourceOfferId:'np',sourcePrice:0,totalRub:null},
    policyFiltered={...offers[0],id:'policy-excluded',sourceOfferId:'pex'};
   const cleanRows=[...offers,noPrice,policyFiltered],counts={eligibleUnpricedRows:3,excludedRows:1,explicitlyWithdrawnRows:0};
   const clean=cleanSourceFixture(cleanRows,asOf+60000,counts),state={open:true};
   const job=await openFreshChinaPriceReplay({directory:path.join(freshPriceParent,'avtocena-china-fresh-prices-fixture'),
    fx,pricingFingerprint,calculationVersion:'a'.repeat(64),expectedInputRows:4,source:clean.source,
    async assertSourceAuthority(){if(!state.open)throw Error('fixture_source_lost');}});
   try{
    const priced=await job.consume({rows:cleanRows,dispositions:clean.inputs.map((x,i)=>i===3?
      {...x,state:'excluded' as const,reason:'heavy_vehicle'}:{...x,state:'eligible_unpriced' as const})});
    assert.deepEqual(priced.map(x=>x.state),['admitted','admitted','excluded','excluded']);
    assert.equal((priced[2] as any).reason,'pricing:source_price_unusable');
    const broken={...clean.proof,orderedInputSha256:'0'.repeat(64)};
    await assert.rejects(job.seal({proof:broken,proofSha256:preparedPriceCardDigest(broken)}),/source_ordered_digest/);
    const {replay,counts:sealedCounts}=await job.seal(clean);
    assert.deepEqual(sealedCounts,{inputRows:4,admitted:2,excluded:2,withdrawn:0,reasons:{'pricing:source_price_unusable':1,heavy_vehicle:1}});
    const replayed=await preparePriceCardBlock({...inputs,priceReplay:replay});
    assert.deepEqual(replayed.bytes,first.bytes,'the closed capsule serializes the exact existing engine result');
    const modified=[{...offers[0],sourcePrice:offers[0].sourcePrice!+100},offers[1]];
    await assert.rejects(preparePriceCardBlock({...inputs,offers:modified,sourceInputSha256:preparedPriceCardDigest(modified),priceReplay:replay}),/replay_row_binding/);
    await assert.rejects(preparePriceCardBlock({...inputs,priceReplay:{} as typeof replay}),/untrusted_replay/);
    state.open=false;
    await assert.rejects(preparePriceCardBlock({...inputs,priceReplay:replay}),/fixture_source_lost/);
   }finally{job.close();}
  }finally{await fs.rm(freshPriceParent,{recursive:true,force:true});}

  const refs:string[]=[], reads:string[]=[];
  let active=structuredClone(fixtureManifest),rev='"active"',flipAtObject=false;
  const shadow={
   readJsonWithMeta:async(key:string)=>{reads.push(key);return {found:true,value:active,etag:rev};},
   getBinary:async(key:string)=>{refs.push(key);assert.equal(key,first.path);if(flipAtObject)rev='"changed"';return {data:first.bytes};},
  } as unknown as JsonStorage;
  const block=await readShadowActivePriceCardBlock(shadow,first.descriptor);assert.ok(block);
  const threshold=sealed.details[0].totalRub;
  const view=shadowPriceCardValues(block,{budgetTo:threshold},'zh-a');
  assert.deepEqual(view.items,[{id:'zh-a',totalRub:threshold}]);assert.equal(view.blockCount,1);
  assert.equal(view.detail?.totalRub,threshold);assert.equal(view.detail?.ledger.customs.utilizationPowerKw,272);
  assert.equal(shadowPriceCardValues(block,{budgetTo:threshold-1},'zh-a').blockCount,0);
  assert.equal(shadowPriceCardValues(block,{},'no-such-id').detail,null);
  assert.deepEqual(reads,['catalog/manifest.json','catalog/manifest.json']);assert.deepEqual(refs,[first.path]);assert.equal(rateReads,1);
  flipAtObject=true;assert.equal(await readShadowActivePriceCardBlock(shadow,first.descriptor),null);flipAtObject=false;
  assert.equal(await readShadowActivePriceCardBlock(shadow,first.descriptor,first.descriptor.tariffValidUntil),null);
  active={...active,generationId:'gen_1_replaced'};
  assert.equal(await readShadowActivePriceCardBlock(shadow,first.descriptor),null);
  assert.ok(refs.every(key=>key===first.path),'one exact object key only; no market scan or fallback');

  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-price-card-object-')), cwd=process.cwd();
  try{
   process.chdir(temp);await fs.mkdir('data');
   const local=new LocalJsonStorage();
   await local.writeJson('catalog/manifest.json',fixtureManifest);
   const written=await local.putBinary(first.path,first.bytes,'application/json',{ifNoneMatch:'*'});
   assert.equal(written.checksum,first.descriptor.contentSha256);
   await assert.rejects(local.putBinary(first.path,first.bytes,'application/json',{ifNoneMatch:'*'}),StorageConflictError);
   const reread=await readShadowActivePriceCardBlock(local,first.descriptor);assert.ok(reread);
   assert.deepEqual(shadowPriceCardValues(reread,{budgetTo:threshold},'zh-a'),view);
   assert.deepEqual(await local.readJson('catalog/manifest.json',null),fixtureManifest);
  }finally{process.chdir(cwd);await fs.rm(temp,{recursive:true,force:true});}


  const tamper=Buffer.from(first.bytes);tamper[tamper.length-5]^=1;
  assert.throws(()=>verifyPriceCardBlock(tamper,first.descriptor),/artifact_identity/);
  const damaged=structuredClone(sealed);damaged.details[0].ledger.breakdown[0].amountRub++;
  const damagedBytes=Buffer.from(JSON.stringify(damaged));
  assert.throws(()=>verifyPriceCardBlock(damagedBytes,{...first.descriptor,bytes:damagedBytes.length,contentSha256:preparedPriceCardDigest(damaged)}),/ledger|price_parity/);
  await assert.rejects(preparePriceCardBlock({...inputs,pricingFingerprint:'b'.repeat(64)}),/price_context/);
  await assert.rejects(preparePriceCardBlock({...inputs,offers:[offers[0],offers[0]],sourceInputSha256:preparedPriceCardDigest([offers[0],offers[0]])}),/source_input/);
  const unanchored=[{...offers[0],sourceCurrency:'USD'}];
  await assert.rejects(preparePriceCardBlock({...inputs,offers:unanchored,sourceInputSha256:preparedPriceCardDigest(unanchored)}),/source_not_anchored/);
  const missing=[{...offers[0],calculationSnapshot:{}}];
  await assert.rejects(preparePriceCardBlock({...inputs,offers:missing,sourceInputSha256:preparedPriceCardDigest(missing)}),/calculation_incomplete/);
  await assert.rejects(applyActiveBusinessPriceBatch(offers,{readOnly:true,retainFullSnapshot:true}),/full_snapshot_scope/);
  const {compareFreshChinaGolden}=await import('../apps/web/lib/catalog/china-fresh-golden-parity');
  const freshSourceValidUntil=asOf+30*3600000;
  const fresh=await preparePriceCardBlock({...inputs,freshSourceValidUntil});
  const golden=compareFreshChinaGolden({descriptor:fresh.descriptor,bytes:fresh.bytes,projections:fresh.projection.items,fx,ids:['zh-a','zh-b']});
  assert.equal(golden.proof.checked,2);
  assert.throws(()=>compareFreshChinaGolden({descriptor:fresh.descriptor,bytes:fresh.bytes,
   projections:[{...fresh.projection.items[0],totalRub:1},fresh.projection.items[1]],fx,ids:['zh-a']}),/identity/);
  t.mock.timers.tick(17*3600000); // move beyond both UTC and UTC+7 calendar boundaries
  assert.deepEqual((await preparePriceCardBlock({...inputs,freshSourceValidUntil})).bytes,fresh.bytes);
  await assert.rejects(preparePriceCardBlock(inputs),/tariff_or_inventory_horizon/);
  assert.equal(fresh.descriptor.tariffValidUntil,freshSourceValidUntil);
  const freshReader={readJsonWithMeta:async()=>({found:true,etag:'"same"',value:fixtureManifest}),getBinary:async()=>({data:fresh.bytes})} as unknown as JsonStorage;
  assert.ok(await readShadowActivePriceCardBlock(freshReader,fresh.descriptor));
  assert.equal(await readShadowActivePriceCardBlock(freshReader,fresh.descriptor,freshSourceValidUntil),null);
  assert.equal(outbound,0);assert.equal(rateReads,1);
 }finally{
  if(old.disabled===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=old.disabled;
  if(old.calc===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=old.calc;
  globalThis.fetch=old.fetch;Object.assign(db,prior);
  resetCatalogRateCache();resetChinaCnyPriceCache();resetCatalogEditorialCache();invalidateEffectiveMarketsCache();
 }
});

test('real writer pre-immutable coverage, private seal and mock CAS retain exact China projection and Korea',async t=>{
 t.mock.timers.enable({apis:['Date'],now:asOf});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'preimmutable-china-price-'));
 const cwd=process.cwd(), envKeys=['JSON_STORAGE_DRIVER','CATALOG_LIVE_RATE_DISABLED','AVTOCENA_CALCULATION_VERSION','CATALOG_GROW_ONLY_MARKETS','CATALOG_SELLER_INVENTORY'];
 const oldEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
 const oldFetch=globalThis.fetch;let outbound=0;
 globalThis.fetch=async()=>{outbound++;throw Error('fixture_network_forbidden');};
 const baseGenerationId='gen_1790000000000_prior1111';
 try{
  process.chdir(directory);await fs.mkdir('data');
  process.env.JSON_STORAGE_DRIVER='local';process.env.CATALOG_LIVE_RATE_DISABLED='1';process.env.AVTOCENA_CALCULATION_VERSION='a'.repeat(64);
  delete process.env.CATALOG_GROW_ONLY_MARKETS;delete process.env.CATALOG_SELLER_INVENTORY;
  resetJsonStorageForTests();resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();
  const storage=getJsonStorage(),active={...fixtureManifest,generationId:baseGenerationId,markets:{
   korea:{count:1,chunks:['chunk-0001'],updatedAt:new Date(asOf-3600000).toISOString()}}};
  const seed={
   'catalog/manifest.json':active,
   'catalog/previous-manifest.json':{...active,generationId:'gen_1789999999999_older1111'},
   [`catalog/generations/${baseGenerationId}/offers/korea/chunk-0001.json`]:[{id:'exact-korea-neighbor',market:'korea'}],
   'catalog/internal/manifest.json':{version:2,generationId:baseGenerationId,sources:{}},
   'catalog/public/projection/china.json':{generationId:baseGenerationId,items:[]},
   'catalog/public/facets.json':{generationId:baseGenerationId,makes:[],models:[],markets:['china','korea'],
    bodyTypes:[],fuels:[],transmissions:[],drives:[]},
   'catalog/public/brand-summary.json':{generationId:baseGenerationId,brands:{}},
  };
  for(const [key,value] of Object.entries(seed))await storage.writeJson(key,value);
  await storage.writeJson('fees/exchange-rates.json',{rates:[['CNY',12.5],['USD',85],['EUR',95]].map(([currency,cbrRate])=>
   ({currency,cbrRate,nominal:1,rateDate:freshDay,rateSource:'cbr'}))});
  const fx=await captureCatalogFxBatch('china',['CNY']);
  const pricingFingerprint=await withCatalogFxBatch(fx,()=>budgetPricingFingerprint('china'));assert.ok(pricingFingerprint);
  const raw={...exactChinaOffer('fixture-china-10001',450000),sourceOfferId:'10001',make:'BMW',model:'X5',
   sourceTitle:'BMW X5 2022 xDrive',mileageKm:35000,powerDataSource:'fixture:source_named_ice_kw',powerDataConfidence:'source_exact',
   operational:{...exactChinaOffer('fixture-china-10001',450000).operational,
    sourceUrl:'https://global.che168.com/en/detail/10001',photoIdentityVerified:true},
   images:Array.from({length:4},(_,i)=>({id:'cn-photo-'+i,url:'https://autoimg.cn/car/fixture-'+i+'.jpg',
    objectKey:'catalog/images/china/fixture-'+i+'.jpg',size:120000,checksum:'fixture-'+i,mimeType:'image/jpeg',width:1200,height:800})),
  } as VehicleOffer;
  // The native publisher admits already documented ready offers. Seed this
  // prior candidate ledger with real output, never invented line amounts.
  const admittedSeed=await withCatalogFxBatch(fx,()=>applyActiveBusinessPriceBatch([raw],{readOnly:true,retainFullSnapshot:true}));
  const preview=await previewCanonicalPublicCatalogOffers(admittedSeed);
  assert.equal(preview.offers.length,1);
  const inputDigest=preparedPriceCardDigest(preview.offers.map(compactPublicStorageOffer));
  const context={expectedBaseGenerationId:baseGenerationId,expectedCanonicalInputSha256:inputDigest,fx,pricingFingerprint};
  const filesBefore=(await fs.readdir('data',{recursive:true})).sort();
  const writes:string[]=[], original=storage.writeJson.bind(storage);
  storage.writeJson=async(key,value,condition)=>{writes.push(key);return original(key,value,condition);};

  const shadow=await prepareChinaPriceShadowBeforeWrite(admittedSeed,context);
  assert.equal(shadow.mode,'shadow_only');assert.equal(shadow.published,false);
  assert.equal(shadow.expectedBaseGenerationId,baseGenerationId);
  assert.notEqual(shadow.candidateGenerationId,baseGenerationId);
  assert.equal(shadow.block.descriptor.generationId,shadow.candidateGenerationId);
  assert.equal(shadow.block.descriptor.sourceInputSha256,inputDigest);
  assert.equal(shadow.block.descriptor.fxReceiptSha256,fx.receiptSha256);
  const sealed=verifyPriceCardBlock(shadow.block.bytes,shadow.block.descriptor);
  assert.equal(sealed.details[0].ledger.customs.utilizationPowerKw,272);
  assert.equal(sealed.details[0].totalRub,sealed.index.rows[0][1]);
  assert.equal(shadow.block.projection.generationId,shadow.candidateGenerationId);
  assert.equal(shadow.block.projection.items[0].totalRub,sealed.details[0].totalRub);
  assert.equal(shadow.block.projectionSha256,preparedPriceCardDigest(shadow.block.projection));
  assert.equal(sealed.projectionSha256,shadow.block.projectionSha256);
  assert.throws(()=>verifyPriceCardBlock(shadow.block.bytes,{...shadow.block.descriptor,projectionSha256:'b'.repeat(64)}),/scope_coverage/);
  assert.equal(shadow.block.projection.items[0].calculationSnapshot.breakdown,undefined);
  assert.equal(writes.length,0,'shadow returns before any native storage writer');
  assert.equal(await storage.exists!(shadow.block.path),false,'artifact is unauthorised to publish itself');

  await assert.rejects(prepareChinaPriceShadowBeforeWrite(admittedSeed,{...context,expectedCanonicalInputSha256:'b'.repeat(64)}),/source_input/);
  await assert.rejects(prepareChinaPriceShadowBeforeWrite(admittedSeed,{...context,pricingFingerprint:'b'.repeat(64)}),/price_context/);
  await assert.rejects(prepareChinaPriceShadowBeforeWrite(admittedSeed,{...context,expectedBaseGenerationId:'gen_1_other'}),/publish_base_changed/);
  await assert.rejects(prepareChinaPriceShadowBeforeWrite(Array.from({length:129},()=>admittedSeed[0]),context),/shadow_scope/);
  const read=storage.readJsonWithMeta.bind(storage);
  let manifestReads=0;
  storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
   const meta=await read(key,fallback);
   if(key==='catalog/manifest.json'&&++manifestReads===2)return {...meta,etag:'"competing-writer"'};
   return meta;
  };
  try{await assert.rejects(prepareChinaPriceShadowBeforeWrite(admittedSeed,context),/shadow_publication_changed/);}
  finally{storage.readJsonWithMeta=read;}
  assert.equal(writes.length,0,'scope or evidence rejection is also before all native writes');
  assert.deepEqual((await fs.readdir('data',{recursive:true})).sort(),filesBefore,'no files or binary objects added on success or refusal');
  for(const [key,value] of Object.entries(seed))assert.deepEqual(await storage.readJson(key,null),value,key);
  assert.equal(await storage.exists!(`catalog/generations/${shadow.candidateGenerationId}/offers/china/chunk-0001.json`),false);
  assert.equal(await storage.exists!(`catalog/generations/${shadow.candidateGenerationId}/indexes/budget-count-v3.json`),false);

  const rawMany=Array.from({length:4},(_,i)=>{
   const id=String(20001+i), sourcePrice=450000+i*50000;
   return {...raw,id:'fixture-china-'+id,sourceOfferId:id,mileageKm:34000+i*3000,sourcePrice,
    chinaPriceConversion:exactChinaOffer(id,sourcePrice).chinaPriceConversion,
    operational:{...raw.operational,sourceUrl:`https://global.che168.com/en/detail/${id}`},
    images:raw.images.map(image=>({...image,id:image.id+'-'+id,url:image.url.replace('.jpg','-'+id+'.jpg'),
     objectKey:image.objectKey.replace('.jpg','-'+id+'.jpg'),checksum:image.checksum+'-'+id})),
   };
  });
  const many=await withCatalogFxBatch(fx,()=>applyActiveBusinessPriceBatch(rawMany,{readOnly:true,retainFullSnapshot:true}));
  const canonical=(await previewCanonicalPublicCatalogOffers(many)).offers.map(compactPublicStorageOffer);
  assert.equal(canonical.length,4);
  const plan:PreparedPriceExpectedBlock[]=canonical.map((row,part)=>({sourceChunk:'chunk-0001',part,rows:1,
   sourceIdsSha256:preparedPriceCardDigest([row.id]),sourceInputSha256:preparedPriceCardDigest([row])}));
  const stream=(entries=plan)=>async function*(){yield* entries;};
  const records:Array<Parameters<PreparedPriceCoverageContext['emit']>[0]['record']>=[];
  let inFlight=0,peakFlight=0;
  const cover:PreparedPriceCoverageContext={
   candidateGenerationId:`gen_${asOf}_covexact`,expectedBaseGenerationId:baseGenerationId,expectedAdmittedRows:canonical.length,
   expectedAdmittedIdsSha256:preparedCoverageIdsDigest(canonical.map(row=>row.id)),blockRows:1,fx,pricingFingerprint,
   expectedBlocks:stream(),
   emit:async({record,block})=>{
    inFlight++;peakFlight=Math.max(peakFlight,inFlight);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(record.rows,1);assert.equal(record.key,block.path);
    assert.equal(record.artifactSha256,block.descriptor.contentSha256);
    assert.equal(record.projectionSha256,preparedPriceCardDigest(block.projection));
    assert.equal(verifyPriceCardBlock(block.bytes,block.descriptor).details[0].id,canonical[record.part].id);
    records.push(record);inFlight--; // only tiny receipt evidence, not price rows or buffers
   },
  };
  const covered=await prepareChinaPriceCoverageBeforeWrite(many,cover), firstRecords=records.splice(0);
  assert.equal(covered.mode,'shadow_coverage_only');assert.equal(covered.published,false);
  assert.equal(covered.admittedRows,4);assert.equal(covered.blockCount,4);assert.equal(covered.peakBlockRows,1);assert.equal(peakFlight,1);
  assert.equal(covered.artifactBytes,firstRecords.reduce((sum,row)=>sum+row.bytes,0));
  assert.equal(covered.orderedBlockRecordsSha256,createHash('sha256').update('prepared-ordered-block-records-v1\n')
   .update(firstRecords.map(record=>JSON.stringify(record)+'\n').join('')).digest('hex'));
  assert.equal(covered.orderedAdmittedIdsSha256,cover.expectedAdmittedIdsSha256);
  t.mock.timers.tick(2000); // stable pinned candidate + FX and same UTC+7 business day
  assert.deepEqual(await prepareChinaPriceCoverageBeforeWrite(many,cover),covered);
  assert.deepEqual(records.splice(0),firstRecords);

  const discard=async()=>{};
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many.slice(0,3),{...cover,emit:discard}),/coverage:scope/);
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,expectedAdmittedRows:3,emit:discard}),/coverage:scope/);
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite([many[0],many[0],...many.slice(2)],{...cover,emit:discard}),/public_offer_id_duplicate/);
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,expectedBlocks:stream(plan.slice(0,3)),emit:discard}),/coverage:missing_block/);
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,expectedBlocks:stream([...plan,plan[0]]),emit:discard}),/coverage:extra_block/);
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,expectedBlocks:stream([plan[0],plan[0],...plan.slice(2)]),emit:discard}),/coverage:block_identity/);
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,expectedAdmittedIdsSha256:'f'.repeat(64),emit:discard}),/coverage:admitted_ids/);
  await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,expectedBlocks:stream(
    [plan[0],{...plan[1],sourceIdsSha256:preparedPriceCardDigest(['unexpected-same-count-id'])},...plan.slice(2)]),emit:discard}),/coverage:block_identity/);
  let manifestChanged=false, consumed=0;
  storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
   const original=await read(key,fallback);
   return manifestChanged&&key==='catalog/manifest.json'?{...original,etag:'"other-valid-writer"'}:original;
  };
  try{await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,emit:async()=>{consumed++;manifestChanged=true;}}),/shadow_publication_changed/);}
  finally{storage.readJsonWithMeta=read;}
  assert.equal(consumed,1,'no later block after the base change');
  const dayBeforeExpiry=Date.now();
  try{
   await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,emit:async({record})=>{
    if(record.part===3)t.mock.timers.setTime(covered.validUntil);
   }}),/coverage:horizon/);
  }finally{t.mock.timers.setTime(dayBeforeExpiry);}

  assert.equal(writes.length,0);
  assert.deepEqual((await fs.readdir('data',{recursive:true})).sort(),filesBefore);
  for(const [key,value] of Object.entries(seed))assert.deepEqual(await storage.readJson(key,null),value,key);


  // Real S3 interface/signature and conditional PUT semantics; no network.
  // The mock receives only exact loopback-origin Requests.
  const s3Keys=['YC_OBJECT_STORAGE_ENDPOINT','YC_OBJECT_STORAGE_BUCKET','YC_OBJECT_STORAGE_PREFIX','YC_OBJECT_STORAGE_REGION',
   'YC_OBJECT_STORAGE_ACCESS_KEY_ID','YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'];
  const s3Env=Object.fromEntries(s3Keys.map(name=>[name,process.env[name]]));
  const noNetwork=globalThis.fetch, endpoint='http://127.0.0.1:43123', bucket='fixture-prices',prefix='fixture-shadow';
  const requests:Array<{method:string;key:string;status:number}>=[];
  const s3=new Map<string,{body:Buffer;etag:string}>(Object.entries(seed).map(([key,value])=>
   [key,{body:Buffer.from(JSON.stringify(value)),etag:'"base-rev"'}]));
  const baseSnapshot=structuredClone(s3);
  let stageAllowed=false, forceCasConflict=false, flipOnProjection=false, raceOwnControl=0;
  const fixtureFetch:typeof fetch=async(input,init)=>{
   const url=new URL(String(input));
   assert.equal(url.origin,endpoint);
   assert.ok(url.pathname.startsWith(`/${bucket}/${prefix}/`));
   const key=decodeURIComponent(url.pathname.slice(`/${bucket}/${prefix}/`.length));
   const method=String(init?.method||'GET'),headers=new Headers(init?.headers);
   assert.match(headers.get('authorization')||'',/^AWS4-HMAC-SHA256 Credential=fixture\//);
   let prior=s3.get(key);
   if(method==='GET'&&key==='catalog/market-activation-fixture-v1/china/control.json'&&raceOwnControl>0&&--raceOwnControl===0&&prior){
    const updated=JSON.parse(prior.body.toString('utf8'));
    updated.revision++;
    updated.active.activateRevision=updated.revision;
    prior={body:Buffer.from(JSON.stringify(updated)),etag:'"cut-raced"'};
    s3.set(key,prior);
   }
   if(method==='GET'){
    requests.push({method,key,status:prior?200:404});
    if(flipOnProjection&&key.includes('/prepared-china-read-v1/projections/')){
     const snapshot=s3.get('catalog/manifest.json')!;
     s3.set('catalog/manifest.json',{...snapshot,etag:'"raced-reader"'});
    }
    return prior?new Response(new Uint8Array(prior.body),{status:200,headers:{etag:prior.etag}}):new Response(null,{status:404});
   }
   assert.equal(method,'PUT');
   if(key.startsWith('catalog/market-activation-fixture-v1/')){
    assert.match(key,/^catalog\/market-activation-fixture-v1\/(china|korea)\//);
    const match=headers.get('if-match'),none=headers.get('if-none-match');
    assert.ok((match&&key.endsWith('/control.json')&&!none)||(!match&&none==='*'));
    const conflict=match?match!==prior?.etag:Boolean(prior);
    requests.push({method,key,status:conflict?412:200});
    if(conflict)return new Response(null,{status:412});
    const body=Buffer.from(init!.body as Buffer);
    s3.set(key,{body,etag:'"'+createHash('sha256').update(body).digest('hex')+'"'});
    return new Response(null,{status:200});
   }
   if(key==='catalog/manifest.json'){
    assert.ok(stageAllowed);
    assert.equal(headers.get('if-match'),'"base-rev"');
    assert.equal(headers.has('if-none-match'),false);
    const status=forceCasConflict||headers.get('if-match')!==prior?.etag?412:200;
    requests.push({method,key,status});
    if(status===200)s3.set(key,{body:Buffer.from(String(init!.body)),etag:'"activated-rev"'});
    return new Response(null,{status});
   }
   assert.equal(headers.get('if-none-match'),'*');
   if(!stageAllowed)assert.match(key,/^catalog\/private-prepared-prices-v1\/china\//);
   else assert.ok(key.startsWith(`catalog/generations/${cover.candidateGenerationId}/indexes/`));
   requests.push({method,key,status:prior?412:200});
   if(prior)return new Response(null,{status:412});
   const data=Buffer.from(init!.body as Buffer);
   s3.set(key,{body:data,etag:'"private-'+data.length+'"'});
   return new Response(null,{status:200});
  };
  Object.assign(process.env,{
   YC_OBJECT_STORAGE_ENDPOINT:endpoint,YC_OBJECT_STORAGE_BUCKET:bucket,YC_OBJECT_STORAGE_PREFIX:prefix,YC_OBJECT_STORAGE_REGION:'fixture',
   YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture',
  });
  globalThis.fetch=fixtureFetch;
  try{
   const mockS3=new ObjectJsonStorage();
   const candidateManifest:CatalogManifest={version:2,generationId:cover.candidateGenerationId,updatedAt:new Date(asOf).toISOString(),
    markets:{china:{count:many.length,chunks:['chunk-0001'],updatedAt:new Date(asOf).toISOString()}}};
   let permit=true, authorityChecks=0;
   const authority:PrivatePriceSealAuthority={
    purpose:'local-private-price-seal-v1',runId:'fixture-private',candidateGenerationId:cover.candidateGenerationId,
    expectedBaseGenerationId:baseGenerationId,baseEtag:'"base-rev"',baseManifestSha256:covered.activeManifestSha256,
    candidateMarketDigest:preparedPriceCardMarketDigest(candidateManifest,'china'),fxReceiptSha256:covered.fxReceiptSha256,
    pricingFingerprint,calculationVersion:'a'.repeat(64),pricingAsOf:fx.receipt.pricingAsOf,expectedAdmittedRows:4,
    expectedAdmittedIdsSha256:covered.orderedAdmittedIdsSha256,blockRows:1,expiresAt:covered.validUntil,
    backend:{kind:'mock-s3',origin:endpoint,bucket,prefix,fixtureFetch},
    assertAuthorized:async()=>{authorityChecks++;if(!permit)throw Error('fixture_authority_revoked');},
   };
   assert.throws(()=>createPrivateChinaPriceSink(mockS3),/authority_required/);
   assert.throws(()=>createPrivateChinaPriceSink(mockS3,{...authority,backend:{...authority.backend,origin:'https://not-local.invalid'} as any}),/backend/);
   assert.equal(requests.length,0);
   const publish=async(a:PrivatePriceSealAuthority)=>{
    const sink=createPrivateChinaPriceSink(mockS3,a);
    const report=await prepareChinaPriceCoverageBeforeWrite(many,{...cover,emit:sink.emit});
    return sink.complete(report);
   };
   const sealed=await publish(authority);
   assert.equal(requests.filter(req=>req.method==='PUT').length,13,'four parts × three verified objects then one seal');
   assert.equal(requests.filter(req=>req.method==='PUT').at(-1)?.key,sealed.key);
   assert.ok(authorityChecks>=13);
   const putCount=requests.filter(req=>req.method==='PUT').length;
   const receipt=await verifyPrivateChinaPriceSeal(new ObjectJsonStorage(),authority,sealed.sha256);
   assert.deepEqual(receipt.report,covered);
   assert.equal(requests.filter(req=>req.method==='PUT').length,putCount,'fresh verifier is read-only');
   assert.deepEqual(await publish(authority),sealed,'identical restart rereads conditional-conflict winners');
   assert.equal(requests.filter(req=>req.status===412).length,13);

   const corruptProjection=[...s3.keys()].find(key=>key.includes('/projections/'))!;
   const correct=s3.get(corruptProjection)!;
   s3.set(corruptProjection,{...correct,body:Buffer.from('{}')});
   await assert.rejects(verifyPrivateChinaPriceSeal(mockS3,authority,sealed.sha256),/block_identity/);
   await assert.rejects(publish(authority),/object_size|object_readback/);
   s3.delete(corruptProjection);
   await assert.rejects(verifyPrivateChinaPriceSeal(mockS3,authority,sealed.sha256),/binary_read_404/);
   s3.set(corruptProjection,correct);
   await assert.rejects(verifyPrivateChinaPriceSeal(mockS3,authority,'b'.repeat(64)),/seal_identity/);

   const incomplete={...authority,runId:'fixture-partial'};
   const rejected=createPrivateChinaPriceSink(mockS3,incomplete);
   await assert.rejects(prepareChinaPriceCoverageBeforeWrite(many,{...cover,expectedBlocks:stream(plan.slice(0,3)),emit:rejected.emit}),/missing_block/);
   await assert.rejects(rejected.complete(covered),/coverage/);
   assert.ok(![...s3.keys()].some(key=>key.endsWith('/fixture-partial/seal.json')));
   const revoke={...authority,runId:'fixture-revoked'};
   permit=false;
   await assert.rejects(publish(revoke),/authority_revoked/);
   permit=true;
   assert.ok(![...s3.keys()].some(key=>key.includes('/fixture-revoked/')));
   const oldActive=s3.get('catalog/manifest.json')!;
   s3.set('catalog/manifest.json',{...oldActive,etag:'"new-live-rev"'});
   await assert.rejects(verifyPrivateChinaPriceSeal(mockS3,authority,sealed.sha256),/active_manifest/);
   s3.set('catalog/manifest.json',oldActive);
   for(const [key,before] of baseSnapshot){
    const unchanged=s3.get(key)!;
    assert.deepEqual(unchanged.body,Buffer.from(before.body));assert.equal(unchanged.etag,before.etag);
   }
   assert.ok(requests.every(req=>req.method==='GET'||req.key.startsWith(`catalog/private-prepared-prices-v1/china/${cover.candidateGenerationId}/`)));

   // Candidate native chunks stand in for the prior immutable writer stage.
   // The actual writer's unmarked default and ordering are tested below.
   stageAllowed=true;
   const chinaNative=`catalog/generations/${cover.candidateGenerationId}/offers/china/chunk-0001.json`;
   const koreaOld=`catalog/generations/${baseGenerationId}/offers/korea/chunk-0001.json`;
   const koreaNew=`catalog/generations/${cover.candidateGenerationId}/offers/korea/chunk-0001.json`;
   const koreaBytes=s3.get(koreaOld)!.body;
   s3.set(koreaNew,{body:Buffer.from('[]'),etag:'"candidate-korea"'});
   const staged={...candidateManifest,markets:{...candidateManifest.markets,korea:structuredClone(active.markets.korea)}};
   const activate={storage:mockS3,authority,sealSha256:sealed.sha256,unmarkedCandidate:staged,
    candidateManifestSha256:preparedPriceCardDigest(staged),modelScope:{make:'BMW',model:'X5'},
    verifyLegacyCandidate:async(m:Parameters<Parameters<typeof activatePreparedChinaFixture>[0]['verifyLegacyCandidate']>[0])=>{
     assert.deepEqual(m.markets.korea,active.markets.korea);
     assert.equal(m.generationId,candidateManifest.generationId);
     assert.ok(m.markets.china.preparedChinaPriceReadV1);
    }};
   assert.equal(await readActivePreparedChinaFixturePart(mockS3,'chunk-0001',0),null);
   await assert.rejects(activatePreparedChinaFixture({...activate,authority:{...authority,backend:{kind:'local',dataRoot:directory}}}),/mock_only/);
   await assert.rejects(activatePreparedChinaFixture({...activate,candidateManifestSha256:'c'.repeat(64)}),/candidate/);
   const generationBoundKorea={...active,markets:{korea:{...active.markets.korea,preparedPriceReadV1:{receiptSha256:'e'.repeat(64)}}}};
   const boundBase={...oldActive,body:Buffer.from(JSON.stringify(generationBoundKorea))};
   const boundCandidate={...staged,markets:{...staged.markets,korea:generationBoundKorea.markets.korea}};
   s3.set('catalog/manifest.json',boundBase);
   await assert.rejects(activatePreparedChinaFixture({...activate,unmarkedCandidate:boundCandidate,
    candidateManifestSha256:preparedPriceCardDigest(boundCandidate),authority:{...authority,baseManifestSha256:preparedPriceCardDigest(generationBoundKorea)}}),/neighbor_generation_bound/);
   s3.set('catalog/manifest.json',oldActive);
   const changedKorea=structuredClone(staged);changedKorea.markets.korea.count++;
   await assert.rejects(activatePreparedChinaFixture({...activate,unmarkedCandidate:changedKorea,
    candidateManifestSha256:preparedPriceCardDigest(changedKorea)}),/neighbor_manifest/);
   await assert.rejects(activatePreparedChinaFixture(activate),/read_integrity/);
   s3.set(koreaNew,{body:koreaBytes,etag:'"candidate-korea"'});
   s3.set(chinaNative,{body:Buffer.from(JSON.stringify([...canonical].reverse())),etag:'"candidate-china"'});
   await assert.rejects(activatePreparedChinaFixture(activate),/candidate_rows/);
   s3.set(chinaNative,{body:Buffer.from(JSON.stringify(canonical)),etag:'"candidate-china"'});
   await assert.rejects(activatePreparedChinaFixture({...activate,sealSha256:'b'.repeat(64)}),/seal_identity/);
   await assert.rejects(activatePreparedChinaFixture({...activate,verifyLegacyCandidate:async()=>{throw Error('native_verification_refused');}}),/native_verification_refused/);
   await assert.rejects(activatePreparedChinaFixture({...activate,verifyLegacyCandidate:async()=>{
    s3.set('catalog/manifest.json',{...oldActive,etag:'"stale-cutover"'});
   }}),/base_changed/);
   s3.set('catalog/manifest.json',oldActive);
   assert.equal(requests.filter(r=>r.method==='PUT'&&r.key==='catalog/manifest.json').length,0);
   assert.deepEqual(s3.get('catalog/manifest.json'),oldActive);
   assert.equal(await readActivePreparedChinaFixturePart(mockS3,'chunk-0001',0),null,'staged handles are not active');

   forceCasConflict=true;
   await assert.rejects(activatePreparedChinaFixture(activate),/storage_conflict/);
   assert.deepEqual(s3.get('catalog/manifest.json'),oldActive);
   assert.equal(await readActivePreparedChinaFixturePart(mockS3,'chunk-0001',2),null);
   assert.deepEqual(requests.filter(r=>r.method==='PUT'&&r.key==='catalog/manifest.json').map(r=>r.status),[412]);
   forceCasConflict=false;

   const marked=await activatePreparedChinaFixture(activate);
   assert.ok(!JSON.stringify(marked).includes('private-prepared-prices'));
   assert.deepEqual(requests.filter(r=>r.method==='PUT'&&r.key==='catalog/manifest.json').map(r=>r.status),[412,200]);
   assert.equal(requests.at(-1)?.key,'catalog/manifest.json');
   assert.equal(await readActivePreparedChinaFixturePart(mockS3,'chunk-0002',0).then(()=>false,()=>true),true);
   const readStart=requests.length;
   const chosen=await readActivePreparedChinaFixturePart(new ObjectJsonStorage(),'chunk-0001',2);
   assert.equal(chosen?.generationId,candidateManifest.generationId);
   assert.equal(chosen?.projection.items[0].id,canonical[2].id);
   assert.equal(chosen?.block.details[0].totalRub,chosen?.projection.items[0].totalRub);
   assert.equal(chosen?.block.details[0].ledger.customs.utilizationPowerKw,272);
   const readerRequests=requests.slice(readStart);
   assert.equal(readerRequests.length,6,'two active checks plus exact directory, chunk, card, projection');
   assert.ok(readerRequests.every(r=>r.method==='GET'&&!r.key.includes('private-prepared-prices')&&!r.key.startsWith('fees/')));
   const projected=readerRequests.find(r=>r.key.includes('/prepared-china-read-v1/projections/'))!.key;
   const original=s3.get(projected)!;
   const altered=JSON.parse(original.body.toString('utf8'));
   altered.items[0].model='wrong model with identical ID and price';
   s3.set(projected,{...original,body:Buffer.from(JSON.stringify(altered))});
   await assert.rejects(readActivePreparedChinaFixturePart(mockS3,'chunk-0001',2),/read_integrity/);
   s3.set(projected,original);
   const live=s3.get('catalog/manifest.json')!;
   flipOnProjection=true;
   await assert.rejects(readActivePreparedChinaFixturePart(mockS3,'chunk-0001',2),/active_changed/);
   flipOnProjection=false;
   s3.set('catalog/manifest.json',live);
   const beforeExpiry=Date.now();
   t.mock.timers.setTime(covered.validUntil);
   try{await assert.rejects(readActivePreparedChinaFixturePart(mockS3,'chunk-0001',2),/directory_scope/);}
   finally{t.mock.timers.setTime(beforeExpiry);}
   for(const [key,before] of baseSnapshot){
    if(key==='catalog/manifest.json')continue;
    const unchanged=s3.get(key)!;
    assert.deepEqual(unchanged.body,Buffer.from(before.body));assert.equal(unchanged.etag,before.etag);
   }
   assert.deepEqual(s3.get(koreaNew),{body:koreaBytes,etag:'"candidate-korea"'});

   // Exercise the real HTTP list/count handler and both direct-card consumers:
   // the actual route metadata export and the exact shared page data/display.

   const marketPermit={origin:endpoint,bucket,prefix,fixtureFetch,assertAuthorized:async(market:string)=>{assert.ok(['china','korea'].includes(market));}};
   const marketChina=openIndependentMarketFixture(mockS3,'china',marketPermit),marketKorea=openIndependentMarketFixture(mockS3,'korea',marketPermit);
   const oldK=await marketKorea.observe(),kg='gen_'+(asOf+501)+'_separatekorea',koreanSource='c'.repeat(64),koreanFx='d'.repeat(64),koreanIds='e'.repeat(64);
   const kPaper=(role:IndependentMarketPaper['role']):IndependentMarketPaper=>({version:1,role,market:'korea',generationId:kg,
    sourceReceiptSha256:koreanSource,pricingReceiptSha256:koreanFx,orderedIdsSha256:koreanIds,count:1,payload:{fixture:'Korea untouched'}});
   const kCut:IndependentCut={version:1,market:'korea',generationId:kg,expectedBaseSha256:oldK.baseSha256,previousCursorSha256:independentMarketDigest(null),
    source:{complete:true,receiptSha256:koreanSource,observedAt:asOf,validUntil:covered.validUntil,cursor:{stream:'korean-fixture',sequence:1,anchorSha256:'d'.repeat(64)}},
    pricing:{receiptSha256:koreanFx,inputFingerprint:'a'.repeat(64),calculationVersion:'a'.repeat(64),pricedAt:asOf,validUntil:covered.validUntil},
    admitted:{count:1,orderedIdsSha256:koreanIds},papers:{inventory:independentMarketDigest(kPaper('inventory')),
     prices:independentMarketDigest(kPaper('prices')),search:independentMarketDigest(kPaper('search'))}};
   const kl=await marketKorea.acquire({action:'publish',generationId:kg,expectedBaseSha256:oldK.baseSha256},60000);
   const kr=await marketKorea.prepare(kl,kCut,independentMarketDigest(kCut),async role=>kPaper(role));
   await marketKorea.activate(kl,kr);
   const koreaRoot='catalog/market-activation-fixture-v1/korea/',chinaRoot='catalog/market-activation-fixture-v1/china/';
   const koreanBefore=new Map([...s3].filter(([key])=>key.startsWith(koreaRoot)));
   const independentStart=requests.length;
   const mixedRaw=Array.from({length:9},(_,i)=>{
    const id=String(31001+i),make=i===1?'Mercedes-Benz':'BMW',variant=i===0?'X1':i===1?'C-Class':i%2?'X3':'X5',
     sourcePrice=i===0?100000:i===1?106000:480000+i*21000;
    const exact=i<2?{engineCc:1498,powerHp:113,powerKw:83,icePowerKw:83,utilizationPowerKw:83}:{};
    const customsInput={...raw.calculationSnapshot.customsInput,...exact,customsValueRub:sourcePrice*12.5};
    return {...raw,...exact,id:'fixture-mixed-cn-'+id,sourceOfferId:id,sourcePrice,make,model:variant,sourceTitle:make+' '+variant+' 2022',
     ...(i<2?{calculationSnapshot:{...raw.calculationSnapshot,customsInput,customs:calculateRussiaCustomsForIndividual(customsInput)}}:{}),
     mileageKm:20301+i*6500,chinaPriceConversion:exactChinaOffer(id,sourcePrice).chinaPriceConversion,
     operational:{...raw.operational,sourceUrl:`https://global.che168.com/en/detail/${id}`,
      semanticEvidence:{...(raw.operational.semanticEvidence as Record<string,unknown>),...Object.fromEntries(Object.entries(exact).map(([key,value])=>[key,{status:'exact',value,source:'fixture-city'}]))}},
     images:raw.images.map(img=>({...img,id:img.id+'-'+id,url:img.url.replace('.jpg','-'+id+'.jpg'),
      objectKey:img.objectKey.replace('.jpg','-'+id+'.jpg'),checksum:img.checksum+'-'+id})),
    };
   });
   const mixedPrice=await withCatalogFxBatch(fx,()=>applyActiveBusinessPriceBatch(mixedRaw,{readOnly:true,retainFullSnapshot:true}));
   const mixed=(await previewCanonicalPublicCatalogOffers(mixedPrice)).offers.map(compactPublicStorageOffer);
   assert.equal(mixed.length,9);assert.deepEqual(new Set(mixed.map(row=>row.model)),new Set(['X5','X3','X1','C-Class']));
   const withdrawn={id:'fixture-withdrawn-cn-1',state:'withdrawn' as const,market:'china' as const,make:'BMW',model:'X5',reason:'removed' as const,
    removedAt:new Date(asOf).toISOString()};
   const capture={observedAt:Date.now(),validUntil:covered.validUntil,cursor:{stream:'china-fixture',sequence:31,anchorSha256:'1'.repeat(64)},
    statuses:[...mixed.map(row=>({id:row.id,state:'available' as const})),withdrawn]};
   const blocks=Array.from({length:3},(_,part)=>{
    const rows=mixed.slice(part*3,(part+1)*3);
    return {sourceChunk:'chunk-0001',part,rows:rows.length,sourceIdsSha256:preparedPriceCardDigest(rows.map(row=>row.id)),sourceInputSha256:preparedPriceCardDigest(rows)};
   });
   const baseChina=await marketChina.observe(),ig='gen_'+(asOf+500)+'_independentchina';
   const lease=await marketChina.acquire({action:'publish',generationId:ig,expectedBaseSha256:baseChina.baseSha256},60000);
   const input={publication:marketChina,lease,canonical:mixed,capture:{...capture,expectedReceiptSha256:independentChinaSourceDigest(capture)},
    expectedAdmittedIdsSha256:preparedCoverageIdsDigest(mixed.map(row=>row.id)),expectedBlocks:async function*(){yield* blocks;},
    blockRows:3,fx,pricingFingerprint,calculationVersion:'a'.repeat(64),modelScope:{make:'BMW',model:'X5'},withFixedCities:true as const,
    backend:{kind:'mock-s3' as const,origin:endpoint,bucket,prefix,fixtureFetch}};
   await assert.rejects(prepareIndependentChinaFixture({...input,capture:{...input.capture,cursor:{...capture.cursor,sequence:32}}}),/source_receipt/);
   const sameJob=cleanSourceFixture(mixed,covered.validUntil,{eligibleUnpricedRows:mixed.length,excludedRows:0,explicitlyWithdrawnRows:0},capture.cursor);
   const prepriced=await openFreshChinaPriceReplay({directory:path.join(directory,'avtocena-china-fresh-prices-samejob'),
    fx,pricingFingerprint,calculationVersion:'a'.repeat(64),expectedInputRows:mixed.length,source:sameJob.source,
    assertSourceAuthority:async()=>{assert.equal((await marketChina.observe()).baseSha256,baseChina.baseSha256);}});
   await prepriced.consume({rows:mixed,dispositions:sameJob.inputs.map(x=>({...x,state:'eligible_unpriced'}))});
   const closedInput=await prepriced.seal(sameJob);
   assert.equal(closedInput.counts.admitted,mixed.length);
   const independent=await prepriced.stageCanonical({publication:marketChina,lease,source:{...capture,receiptSha256:input.capture.expectedReceiptSha256,
     cursor:{...capture.cursor,sequence:sameJob.source.sourceCursor,anchorSha256:sameJob.source.sourceReplicaSha256}},
    withdrawn:[withdrawn],blockRows:3,modelScope:input.modelScope,withFixedCities:true,backend:input.backend,
    selection:{admittedRows:mixed.length,orderedAdmittedIdsSha256:input.expectedAdmittedIdsSha256,
     assertCurrent:async()=>{assert.deepEqual(await marketChina.observe(),baseChina);},
     picks:async function*(){for(const x of sameJob.inputs)yield {id:x.id,canonicalSha256:x.inputSha256};}}});
   prepriced.close();
   assert.equal(independent.report.blockCount,3);assert.equal(independent.report.admittedRows,9);
   assert.deepEqual(await marketChina.observe(),baseChina);
   const brokenKey=[...s3.keys()].find(key=>key.startsWith(chinaRoot)&&key.includes('/projections/')&&!key.includes('/private/'))!;
   const savedObject=s3.get(brokenKey)!;
   assert.ok(savedObject);
   s3.set(brokenKey,{...savedObject,body:Buffer.from('{}')});
   try{
    await assert.rejects(marketChina.activate(lease,independent.ready),/immutable_readback/);
    assert.deepEqual(await marketChina.observe(),baseChina,'a bad price projection cannot advance the applied cursor');
   }finally{s3.set(brokenKey,savedObject);}
   await marketChina.activate(lease,independent.ready);
   const applied=await marketChina.observe();
   assert.equal(applied.cursor?.sequence,31);
   const regressedCapture={...capture,cursor:{...capture.cursor,sequence:30}};
   const olderLease=await marketChina.acquire({action:'publish',generationId:'gen_'+(asOf+502)+'_independentchina',expectedBaseSha256:applied.baseSha256},60000);
   await assert.rejects(prepareIndependentChinaFixture({...input,lease:olderLease,
    capture:{...regressedCapture,expectedReceiptSha256:independentChinaSourceDigest(regressedCapture)}}),/cursor_regression/);
   await marketChina.release(olderLease);
   assert.deepEqual(await marketChina.observe(),applied);
   assert.ok(requests.slice(independentStart).every(r=>r.key.startsWith(chinaRoot)),'actual prepared generation does not touch global or neighbor storage');
   for(const [key,value] of koreanBefore)assert.deepEqual(s3.get(key),value);

   // Actual CLI: separate child process and private on-disk namespace; no
   // socket. The clock preload is test-only and never part of the runner.
   const archive=path.join(directory,'run-canonical-archive'),shadow=path.join(directory,'avtocena-china-shadow-test');
   const descriptor=async(rel:string,value:unknown)=>{
    const data=Buffer.from(JSON.stringify(value)),file=path.join(archive,rel);
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);
    return {path:rel,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
   };
   const desc=await descriptor('canonical/chunk-0001.json',mixed);
   const runtime=await descriptor('context/data/fixture.json',{purpose:'no supplemental inputs; use built-in fixture config'});
   const rawEvidence=await descriptor('evidence/archive-receipt.json',{synthetic:true,source:capture.cursor});
   const legacyOracle=await descriptor('evidence/legacy-oracle.json',{synthetic:true,expectedIds:mixed.filter(row=>row.model==='X5').map(row=>row.id)});
   const manifest=await descriptor('shadow-package.json',{
    version:1,market:'china',stage:'canonical-admitted-v1',generationId:ig,count:mixed.length,
    chunks:[{...desc,rows:mixed.length}],plan:blocks,runtimeFiles:[runtime],evidence:{archive:rawEvidence,oracle:legacyOracle},
    archiveReceiptSha256:rawEvidence.sha256,legacyOracleSha256:legacyOracle.sha256,
    withdrawn:[withdrawn],modelScope:input.modelScope,withFixedCities:true,withStreamingSearch:true,source:{observedAt:capture.observedAt,validUntil:capture.validUntil,
     cursor:capture.cursor,receiptSha256:input.capture.expectedReceiptSha256},
    fx,pricingFingerprint,calculationVersion:'a'.repeat(64),expectedAdmittedIdsSha256:input.expectedAdmittedIdsSha256,blockRows:3,
   });
   const freeze=path.join(directory,'test-clock.mjs');
   await fs.writeFile(freeze,`const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:[${Date.now()}]))}static now(){return ${Date.now()}}};`);
   const command=(action:string,...extra:string[])=>promisify(execFile)(process.execPath,['--import','tsx','--import',freeze,
    'scripts/catalog-china-archive-shadow.mjs',action,'--archive',archive,'--expect-sha',manifest.sha256,...extra],{cwd,timeout:60000});
   const preflight=JSON.parse((await command('preflight')).stdout);
   assert.equal(preflight.status,'canonical_input_verified_only');assert.equal(preflight.rows,9);
   const stagedDisk=JSON.parse((await command('prepare','--shadow',shadow)).stdout);
   assert.equal(stagedDisk.status,'offline_shadow_activated');assert.equal(stagedDisk.privateBlocks,3);assert.ok(stagedDisk.disk.minObservedFreeBytes>0);
   const modelDisk=JSON.parse((await command('probe','--shadow',shadow,'--repeat','3','--concurrency','2','--page','2','--page-size','2')).stdout);
   assert.equal(modelDisk.caseResults.total,4);assert.equal(modelDisk.caseResults.page,2);
   assert.deepEqual(modelDisk.caseResults.items.map((row:any)=>row.id),mixed.filter(row=>row.model==='X5').slice(2,4).map(row=>row.id));
   assert.equal(modelDisk.io.writeCount,0);assert.equal(modelDisk.io.blockedRequests,0);
   const edge=String(modelDisk.caseResults.items[0].rub);
   const exactDisk=JSON.parse((await command('probe','--shadow',shadow,'--budget-from',edge,'--budget-to',edge)).stdout);
   assert.equal(exactDisk.caseResults.total,1);
   assert.equal(exactDisk.caseResults.items[0].id,modelDisk.caseResults.items[0].id);
   await assert.rejects(command('prepare','--shadow',shadow),(error:any)=>error.stderr.includes('EEXIST'));

   const removedDisk=JSON.parse((await command('probe','--shadow',shadow,'--id',withdrawn.id)).stdout);
   assert.deepEqual(removedDisk.caseResults.card,{id:withdrawn.id,state:'removed'});
   await assert.rejects(command('probe','--case','novokuznetsk-cold'),(error:any)=>error.code===3&&error.stdout.includes('blocked_not_in_prepared_scope'));
   const cityDisk=JSON.parse((await command('probe','--case','kemerovo-rpm','--shadow',shadow,'--repeat','2','--concurrency','2')).stdout);
   assert.equal(cityDisk.caseResults.total,2);assert.equal(cityDisk.caseResults.card.rub,cityDisk.caseResults.items[0].rub);
   assert.equal(cityDisk.io.writeCount,0);assert.equal(cityDisk.io.blockedRequests,0);
   // Real native storage client signing, no actual network: durable Regcloud
   // transfer consumes exactly the privately staged cut, without a public CAS.
   const ready=await openStageChinaFiles({allowedParent:directory,root:shadow,readySha256:stagedDisk.runtimeReadySha256,
    archiveSha256:manifest.sha256,expectedGenerationId:ig,expectedFxSha256:fx.receiptSha256,expectedAdmittedRows:9,sourceValidUntil:capture.validUntil});
   const stageEnv=Object.fromEntries(s3Keys.map(name=>[name,process.env[name]]));
   const localFetch=globalThis.fetch;const remote=new Map<string,Buffer>(),requestsDurable:{key:string;method:string;query:string}[]=[];
   const rootRemote='catalog/private-market-stage-v1/china/';
   let baselineRef:ChinaPublicRef|undefined;
   try{
    Object.assign(process.env,{YC_OBJECT_STORAGE_ENDPOINT:CHINA_REGCLOUD_STAGE_ORIGIN,YC_OBJECT_STORAGE_BUCKET:'fixture-owned-stage',
     YC_OBJECT_STORAGE_PREFIX:'fixture/active',YC_OBJECT_STORAGE_REGION:'ru-central1',
     YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-stage',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture-stage-secret'});
    let overflowKey='',wrongOwnerKey='',bucketPolicyStatus=404,bucketAclStatus=200,policyDrift=false,policyReads=0;
    const absentPolicy='<Error><Code>NoSuchBucketPolicy</Code><Message>No such policy</Message></Error>';
    const acl=(owner:string)=>`<?xml version="1.0" encoding="UTF-8"?><AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>${owner}</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>${owner}</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>`;
    globalThis.fetch=async(u,init)=>{
     const target=new URL(String(u)),headers=new Headers(init?.headers),method=init?.method??'GET';
     assert.equal(target.origin,CHINA_REGCLOUD_STAGE_ORIGIN);assert.equal(init?.redirect,'error');
     assert.match(headers.get('authorization')||'',/^AWS4-HMAC-SHA256 Credential=fixture-stage\//);
     if(target.pathname==='/fixture-owned-stage'){
      assert.equal(method,'GET');assert.match(target.search,/^\?(acl|policy)=$/);
      requestsDurable.push({key:'',method,query:target.search});
      if(target.search==='?acl=')return new Response(acl('fixture-owner'),{status:bucketAclStatus});
      policyReads++;
      return bucketPolicyStatus===200?new Response(JSON.stringify({Version:'2012-10-17',Statement:{Effect:'Allow',Principal:'*',Action:'s3:GetObject',Resource:'*'}})):
       policyDrift&&policyReads>1?new Response(JSON.stringify({Version:'2012-10-17',Statement:{Effect:'Deny',Principal:'*',Action:'s3:GetObject',Resource:'*'}})):
       new Response(absentPolicy,{status:bucketPolicyStatus});
     }
     const key=decodeURIComponent(target.pathname.split('/fixture-owned-stage/fixture/active/')[1]??'');
     assert.ok(key.startsWith(rootRemote),key);requestsDurable.push({key,method,query:target.search});
     if(method==='PUT'){
      assert.equal(target.search,'');
      assert.equal(headers.get('x-amz-acl'),'private');
      assert.match(headers.get('authorization')||'',/SignedHeaders=[^,]+x-amz-acl/);
      assert.equal(headers.get('if-none-match'),'*');
      assert.match(headers.get('authorization')||'',/SignedHeaders=[^,]+if-none-match/);
      assert.equal(headers.has('if-match'),false);
      if(remote.has(key))return new Response(null,{status:412});
      remote.set(key,Buffer.from(init!.body as Buffer));return new Response(null,{status:200});
     }
     assert.equal(method,'GET');
     const body=remote.get(key);
     if(!body)return new Response(null,{status:404});
     if(target.search==='?acl=')return new Response(acl(wrongOwnerKey===key?'fixture-other-owner':'fixture-owner'));
     assert.equal(target.search,'');
     return new Response(new Uint8Array(overflowKey===key?Buffer.concat([body,Buffer.from('x')]):body));
    };
    const permit:ChinaDurableStagePermit={version:1,kind:'china-own-regcloud-private-stage-v1',market:'china',runId:'qualifier-one',
     storage:{endpoint:CHINA_REGCLOUD_STAGE_ORIGIN,bucket:'fixture-owned-stage',prefix:'fixture/active',region:'ru-central1'},
     generationId:ig,archiveSha256:manifest.sha256,runtimeReadySha256:stagedDisk.runtimeReadySha256,
     expectedChinaPublicBaseSha256:'a'.repeat(64),minAdmittedRows:9,maxArtifactBytes:32*1024*1024,
     validUntil:ready.ready.validUntil,expectedOwnerApprovalSha256:'b'.repeat(64),publicationAuthorized:false,cursorAdvanceAuthorized:false};
    let grant=true;
    const upload=(p:ChinaDurableStagePermit=permit)=>transferChinaPrivateStage({storage:new ObjectJsonStorage(),files:ready,permit:p,
     expectedPermitSha256:preparedPriceCardDigest(p),async assertApprovedRunner(actual,pin){
      assert.ok(Object.isFrozen(actual)&&Object.isFrozen(actual.storage));assert.equal(pin,preparedPriceCardDigest(actual));
      if(!grant)throw Error('fixture_no_durable_grant');
     }});
    grant=false;await assert.rejects(upload(),/fixture_no_durable_grant/);assert.equal(requestsDurable.length,0);grant=true;
    await assert.rejects(upload({...permit,storage:{...permit.storage,bucket:'wrong-bucket'}}),/storage_scope/);
    assert.equal(requestsDurable.length,0);
    bucketAclStatus=403;await assert.rejects(upload(),/bucket_acl_unverified:403/);bucketAclStatus=200;
    bucketPolicyStatus=403;await assert.rejects(upload(),/bucket_policy_unverified:403/);
    bucketPolicyStatus=200;await assert.rejects(upload(),/bucket_policy_grant_not_supported/);bucketPolicyStatus=404;
    assert.equal(requestsDurable.filter(x=>x.method==='PUT').length,0);
    policyDrift=true;policyReads=0;
    await assert.rejects(upload({...permit,runId:'qualifier-drift'}),/bucket_privacy_changed/);
    assert.equal(remote.has(rootRemote+'qualifier-drift/READY.json'),false);policyDrift=false;
    const beginProof=requestsDurable.length;
    const uploaded=await upload(),run=uploaded.ready.stageRoot;
    const proofTranscript=requestsDurable.slice(beginProof);
    assert.deepEqual(proofTranscript.slice(0,2).map(x=>[x.method,x.query]),[['GET','?acl='],['GET','?policy=']]);
    assert.equal(proofTranscript.filter(x=>x.method==='PUT').length,proofTranscript.filter(x=>x.key&&x.query==='?acl=').length);
    baselineRef={runId:uploaded.ready.runId,generationId:uploaded.ready.generationId,readySha256:uploaded.readySha256};
    assert.equal(uploaded.ready.publicationAuthorized,false);assert.equal(uploaded.ready.cursorAdvanceAuthorized,false);
    assert.deepEqual([uploaded.ready.artifacts.nativeParts,uploaded.ready.artifacts.projectionParts,uploaded.ready.artifacts.priceBlocks],[3,3,3]);
    assert.equal(preparedPriceCardDigest(JSON.parse(remote.get(run+'READY.json')!.toString())),uploaded.readySha256);
    assert.equal(requestsDurable.filter(x=>x.method==='PUT').at(-1)?.key,run+'READY.json');
    const size=remote.size,resumed=await upload();assert.equal(remote.size,size);assert.equal(resumed.readySha256,uploaded.readySha256);
    assert.equal(resumed.resumedObjects,uploaded.ready.artifacts.count+1);
    const key=run+'objects/catalog/market-activation-fixture-v1/china/generations/'+ig+'/binding.json';
    wrongOwnerKey=key;
    await assert.rejects(upload(),/object_owner_unverified/);
    wrongOwnerKey='';
    const corrupted=remote.get(key)!;remote.set(key,Buffer.alloc(corrupted.length,0x72));
    const brokenRun={...permit,runId:'qualifier-two'};
    const brokenKey=key.replace('qualifier-one','qualifier-two');
    remote.set(brokenKey,Buffer.alloc(corrupted.length,0x73));
    await assert.rejects(upload(brokenRun),/immutable_conflict/);
    assert.ok(!remote.has(rootRemote+'qualifier-two/READY.json'));
    remote.set(key,corrupted);overflowKey=key;
    const start=requestsDurable.length;
    await assert.rejects(upload(),/object_storage_response_limit/);
    assert.equal(requestsDurable.slice(start).filter(x=>x.method==='GET'&&x.key===key&&x.query==='').length,1);
    overflowKey='';
    assert.ok(requestsDurable.every(x=>['GET','PUT'].includes(x.method)&&(x.key.startsWith(rootRemote)||(!x.key&&x.method==='GET'))));
   }finally{
    globalThis.fetch=localFetch;
    for(const [key,value]of Object.entries(stageEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
   }
   const beforeNative=await fs.readFile(path.join(archive,desc.path));
   await fs.writeFile(path.join(archive,desc.path),Buffer.concat([beforeNative.subarray(0,-1),Buffer.from(' ')]));
   await assert.rejects(command('preflight'),(error:any)=>error.stderr.includes('file_sha256'));
   await fs.writeFile(path.join(archive,desc.path),beforeNative);

   // Fresh-process staged CLI: the writer still stages privately. Serving
   // uses the native read-only file backend, not the S3-shaped fetch adapter.
   const bigArchive=path.join(directory,'large-canonical-archive'),bigShadow=path.join(directory,'avtocena-china-shadow-native-large');
   const bigRows:VehicleOffer[]=Array.from({length:3000},(_,i)=>{
    const seed=i<2300?mixed[2]:mixed[1],serial=String(203_001+i);
    return {...seed,id:'fixture-native-fs-'+serial,sourceOfferId:serial,
     operational:{...seed.operational,sourceUrl:'https://global.che168.com/en/detail/'+serial}};
   });
   const putArchive=async(rel:string,value:unknown)=>{
    const body=Buffer.from(JSON.stringify(value)),file=path.join(bigArchive,rel);
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,body);
    return {path:rel,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};
   };
   const bigChunks=[],bigPlan=[];
   for(let begin=0;begin<bigRows.length;begin+=500){
    const chunk='chunk-'+String(begin/500+1).padStart(4,'0'),rows=bigRows.slice(begin,begin+500);
    bigChunks.push({...await putArchive('canonical/'+chunk+'.json',rows),rows:rows.length});
    for(let first=0;first<rows.length;first+=50){
     const part=rows.slice(first,first+50);
     bigPlan.push({sourceChunk:chunk,part:first/50,rows:part.length,sourceIdsSha256:preparedPriceCardDigest(part.map(row=>row.id)),
      sourceInputSha256:preparedPriceCardDigest(part)});
    }
   }
   const bigRuntime=await putArchive('context/data/fixture.json',{fixture:true});
   const bigEvidence=await putArchive('evidence/archive-receipt.json',{fixture:true,source:capture.cursor});
   const bigOracle=await putArchive('evidence/legacy-oracle.json',{fixture:true,expectedTotal:700});
   const bigSpec=await putArchive('shadow-package.json',{
    version:1,market:'china',stage:'canonical-admitted-v1',generationId:'gen_'+(asOf+700)+'_nativefilesystem',count:bigRows.length,
    chunks:bigChunks,plan:bigPlan,runtimeFiles:[bigRuntime],evidence:{archive:bigEvidence,oracle:bigOracle},
    archiveReceiptSha256:bigEvidence.sha256,legacyOracleSha256:bigOracle.sha256,withdrawn:[],
    conversion:{mode:'complete-fresh-replacement',replacementProofSha256:'c'.repeat(64),previousServingGeneration:'rollback-only'},
    modelScope:{make:'Mercedes-Benz',model:'C-Class'},withStreamingSearch:true,
    source:{observedAt:capture.observedAt,validUntil:capture.validUntil,cursor:capture.cursor,receiptSha256:input.capture.expectedReceiptSha256},
    fx,pricingFingerprint,calculationVersion:'a'.repeat(64),expectedAdmittedIdsSha256:preparedCoverageIdsDigest(bigRows.map(row=>row.id)),blockRows:50,
   });
   const bigCommand=(action:string,...extra:string[])=>promisify(execFile)(process.execPath,['--import','tsx','--import',freeze,
    'scripts/catalog-china-archive-shadow.mjs',action,'--archive',bigArchive,'--expect-sha',bigSpec.sha256,'--shadow',bigShadow,...extra],
    {cwd,timeout:120000});
   const bigPrepare=JSON.parse((await bigCommand('prepare')).stdout);
   assert.equal(bigPrepare.rows,3000);assert.equal(bigPrepare.privateBlocks,60);
   assert.match(bigPrepare.runtimeReadySha256,/^[a-f0-9]{64}$/);
   const nativePins=['--allowed-stage-parent',directory,'--expect-ready',bigPrepare.runtimeReadySha256];
   const probeFiles=async(...extra:string[])=>JSON.parse((await bigCommand('probe-fs',...nativePins,...extra)).stdout);
   const filesystem=await probeFiles('--case','compatibility','--page','28','--page-size','24');
   assert.equal(filesystem.status,'isolated_native_filesystem_probe');assert.equal(filesystem.caseResults.total,700);
   assert.equal(filesystem.caseResults.page,28);assert.equal(filesystem.caseResults.items.length,24);
   assert.deepEqual(filesystem.caseResults.items.map((row:any)=>row.id),bigRows.slice(2948,2972).map(row=>row.id));
   assert.equal(filesystem.caseResults.card.rub,filesystem.caseResults.items[0].rub);
   assert.equal(filesystem.io.nativeParts,1);assert.equal(filesystem.io.priceBlocks,1);
   assert.ok(filesystem.io.projections<60&&filesystem.io.projections>2);
   // The unmodified small legacy fixture above still tests explicit withdrawals.
   await assert.rejects(bigCommand('probe-fs','--allowed-stage-parent',bigArchive,'--expect-ready',bigPrepare.runtimeReadySha256),
    (error:any)=>error.stderr.includes('allowlist'));
   await assert.rejects(bigCommand('probe-fs','--allowed-stage-parent',directory,'--expect-ready','0'.repeat(64)),
    (error:any)=>error.stderr.includes('readiness_sha'));
   const nativeControl=path.join(bigShadow,'objects/catalog/market-activation-fixture-v1/china/control.json');
   const exactControl=await fs.readFile(nativeControl);
   try{
    const changed=JSON.parse(exactControl.toString('utf8'));changed.revision++;changed.active.activateRevision++;
    await fs.writeFile(nativeControl,JSON.stringify(changed));
    await assert.rejects(bigCommand('probe-fs',...nativePins),(error:any)=>error.stderr.includes('active_changed'));
   }finally{await fs.writeFile(nativeControl,exactControl);}

   const require=createRequire(import.meta.url),react=require('react'),previousCache=react.cache;
   const globals=globalThis as typeof globalThis & {React?:typeof react},previousReact=globals.React;
   const aliases=require('node:module').registerHooks({load(url:string,context:any,next:any){
    if(url.endsWith('.css'))return {format:'commonjs',source:'module.exports = {};',shortCircuit:true};
    return next(url,context);
   },resolve(specifier:string,context:any,next:any){
    if(specifier.startsWith('@/')){
     const file=path.join(cwd,'apps/web',specifier.slice(2));
     const match=['.ts','.tsx','/index.ts','/index.tsx'].map(ext=>file+ext).find(existsSync);
     if(match)return next(match,context);
    }
    return next(specifier,context);
   }});
   const mutableReads:string[]=[];
   const localRead=storage.readJsonWithMeta.bind(storage);
   storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
    mutableReads.push(key);
    assert.ok(!/exchange-rates|anchor|china-cny|collection-control|saved-calculation|management-knowledge|shared-budget/i.test(key),key);
    return localRead(key,fallback);
   };
   try{
    react.cache??=require('next/dist/compiled/react').cache;
    globals.React=react;
    const {GET}=require('../apps/web/app/(public)/api/catalog/search/route.ts') as typeof import('../apps/web/app/(public)/api/catalog/search/route');
    const {readOfferDetailForPage}=require('../apps/web/lib/catalog/offer-page-data') as typeof import('../apps/web/lib/catalog/offer-page-data');
    const {resolveOfferDisplay}=require('../apps/web/lib/catalog/offer-display-data') as typeof import('../apps/web/lib/catalog/offer-display-data');
    const {default:offerPage,generateMetadata}=require('../apps/web/app/(public)/cars/offer/[id]/page.tsx') as typeof import('../apps/web/app/(public)/cars/offer/[id]/page');
    const {workAsyncStorage}=require('next/dist/server/app-render/work-async-storage.external');
    const {workUnitAsyncStorage}=require('next/dist/server/app-render/work-unit-async-storage.external');
    const {RequestCookies}=require('next/dist/server/web/spec-extension/cookies');
    const {offerPath,offerCardPath}=require('../apps/web/lib/catalog/offer-url') as typeof import('../apps/web/lib/catalog/offer-url');
    const renderOffer=async(id:string,slug?:string,query?:{market:string;city:string;preparedCut?:string})=>workAsyncStorage.run({route:'/cars/offer/[id]/[slug]'},()=>workUnitAsyncStorage.run(
     {type:'request',phase:'render',cookies:new RequestCookies(new Headers())},async()=>{
      const route=await offerPage({params:Promise.resolve({id,slug}),...(query?{searchParams:Promise.resolve(query)}:{})});
      return route.props.children.type(route.props.children.props);
     }));
    const {default:catalogPage}=require('../apps/web/app/(public)/cars/[market]/page.tsx') as typeof import('../apps/web/app/(public)/cars/[market]/page');
    const renderChinaList=async(query:Record<string,string>)=>workAsyncStorage.run({route:'/cars/[market]'},()=>workUnitAsyncStorage.run(
     {type:'request',phase:'render',cookies:new RequestCookies(new Headers())},async()=>{
      const route=await catalogPage({params:Promise.resolve({market:'china'}),searchParams:Promise.resolve(query)});
      return route.props.children.type(route.props.children.props);
     }));
    const findProps=(value:any,wanted:string,seen=new WeakSet()):any=>{
     if(!value||typeof value!=='object'||seen.has(value))return undefined;
     seen.add(value);
     if(value.props&&Object.hasOwn(value.props,wanted))return value.props;
     for(const entry of Object.values(value)){
      const found=findProps(entry,wanted,seen);if(found)return found;
     }
    };
    const request=(params:string):Promise<Response>=>GET(new Request('https://fixture.test/api/catalog/search?market=china&'+params));
    const fixture={storage:mockS3,fetchMock:fixtureFetch,origin:endpoint,bucket,prefix};
    resetCatalogRateCache();resetChinaCnyPriceCache();
    const httpReadStart=requests.length;
    await withPreparedChinaHttpFixture(fixture,async()=>{
     const rowId=canonical[2].id, rub=chosen!.projection.items[0].totalRub!;
     const q=`make=BMW&model=X5&budgetFrom=${rub}&budgetTo=${rub}&powerFrom=365&powerTo=375&sort=price_asc`;
     const list=await request(q);
     assert.equal(list.status,200);
     assert.equal(list.headers.get('cache-control'),'no-store');
     const items=await list.json();
     assert.equal(items.generationId,marked.generationId);assert.equal(items.total,1);
     assert.equal(items.items[0].totalRub,rub);assert.equal(items.items[0].id,rowId);
     const count=await (await request(q+'&countOnly=1')).json();
     assert.equal(count.total,items.total);assert.equal(count.generationId,items.generationId);
     assert.deepEqual(count.items,[]);
     const empty=await (await request(`budgetTo=${rub-1}&budgetFrom=${rub-1}&countOnly=1`)).json();
     assert.equal(empty.total,0);
     const second=await (await request('page=2&pageSize=1')).json();
     assert.equal(second.items.length,1);assert.equal(second.total,4);
     const pointStart=requests.length;
     const direct=await readOfferDetailForPage(rowId);
     const pointReads=requests.slice(pointStart);
     const prefix=`catalog/generations/${marked.generationId}/indexes/prepared-china-read-v1/`;
     const locatorKey=pointReads.find(req=>req.key.startsWith(prefix+'ids/'))?.key;
     assert.ok(locatorKey);
     assert.equal(pointReads.filter(req=>req.key.startsWith(prefix+'ids/')).length,1);
     assert.deepEqual(pointReads.filter(req=>req.key.startsWith(prefix+'projections/')).map(req=>req.key),[projected]);
     assert.equal(pointReads.filter(req=>req.key.includes('/prepared-price-cards-v1/')).length,1);
     assert.equal(pointReads.filter(req=>req.key.includes('/offers/china/')).length,1);
     assert.ok(!pointReads.some(req=>req.key.includes('offers-by-id')||req.key.startsWith('catalog/public/')));
     const unrelated=[...s3.keys()].find(key=>key.startsWith(prefix+'projections/')&&key!==projected)!;
     assert.ok(unrelated);
     const unrelatedObject=s3.get(unrelated)!;
     s3.set(unrelated,{...unrelatedObject,body:Buffer.from('{}')});
     try{
      assert.equal((await request(q)).status,503);
      assert.equal((await readOfferDetailForPage(rowId)).offer?.id,rowId,'one detail read does not visit another part');
     }finally{s3.set(unrelated,unrelatedObject);}
     const locatorObject=s3.get(locatorKey)!;
     s3.set(locatorKey,{...locatorObject,body:Buffer.from('{}')});
     try{
      assert.equal((await readOfferDetailForPage(rowId)).unavailable,true);
      assert.equal((await request(q)).status,200,'only direct lookup depends on its locator');
     }finally{s3.set(locatorKey,locatorObject);}

     assert.ok(direct.prepared&&direct.offer);
     const display=await resolveOfferDisplay(direct.offer);
     assert.equal(display.visibleRub,rub);
     assert.equal(display.raw.calculationSnapshot.customs.utilizationPowerKw,272);
     assert.deepEqual(display.raw.calculationSnapshot.breakdown,chosen!.block.details[0].ledger.breakdown);
     const meta=await generateMetadata({params:Promise.resolve({id:rowId})});
     assert.ok(typeof meta.title==='string'&&meta.title.replace(/\s|₽/g,'').includes(String(rub)),String(meta.title));
     const slug=offerPath(direct.offer).split('/').at(-1)!;
     const renderRoute=()=>renderOffer(rowId,slug);
     const rendered=await renderRoute();
     assert.equal(rendered.props['data-offer-id'],rowId);
     assert.equal(rendered.props['data-offer-price-rub'],rub);
     assert.equal((await request('city=novokuznetsk')).status,503);
     assert.equal((await request('includeRates=1')).status,503);
     s3.set(projected,{...original,body:Buffer.from('{}')});
     try{
      assert.equal((await request(q)).status,503);
      assert.equal((await request(q+'&countOnly=1')).status,503);
      const refused=await readOfferDetailForPage(rowId);
      assert.equal(refused.unavailable,true);assert.equal(refused.offer,null);
      assert.equal((await renderRoute()).type.name,'SupplierUnavailableOffer');
      const unavailable=await generateMetadata({params:Promise.resolve({id:rowId})});
      assert.equal(typeof unavailable.robots==='object'&&unavailable.robots?.index,false);
     }finally{s3.set(projected,original);}
     flipOnProjection=true;
     try{assert.equal((await request(q)).status,503);}
     finally{flipOnProjection=false;s3.set('catalog/manifest.json',live);}
     const invalid={...marked,markets:{...marked.markets,china:{...marked.markets.china,preparedChinaPriceReadV1:null}}};
     s3.set('catalog/manifest.json',{...live,body:Buffer.from(JSON.stringify(invalid))});
     try{
      assert.equal((await request(q)).status,503);
      assert.equal((await readOfferDetailForPage(rowId)).unavailable,true);
     }finally{s3.set('catalog/manifest.json',live);}
    });
    const indexed={...fixture,indexedModelOnly:true as const};
    await withPreparedChinaHttpFixture(indexed,async()=>{
     const q='make=%20BMW%20&model=x5&sort=totalRub';
     const scope=await compilePreparedChinaModelScope('BMW','X5');
     assert.ok(scope?.matches({...chosen!.projection.items[0],model:'X5 M'}));
     assert.equal(scope?.matches({...chosen!.projection.items[0],model:'X50'}),false);
     assert.equal((await compilePreparedChinaModelScope('  bmw  ','x5'))?.keySha256,scope?.keySha256);
     assert.equal(await compilePreparedChinaModelScope('BMW','X5|X3'),null);
     const begin=requests.length;
     const count=await (await request('make=bmw&model=X5&sort=totalRub&countOnly=1')).json();
     assert.equal(count.total,4);assert.equal(count.generationId,marked.generationId);
     const counted=requests.slice(begin);
     assert.equal(counted.filter(req=>req.key.includes('/models/')&&req.key.includes('/ready-')).length,1);
     assert.ok(!counted.some(req=>req.key.includes('/projections/')||req.key.includes('/parts/')),'unfiltered model count opens only header');
     const second=await (await request(q+'&page=2&pageSize=1')).json();
     assert.equal(second.total,count.total);assert.equal(second.items[0].id,canonical[1].id);
     const all=await (await request(q)).json();
     assert.deepEqual(all.items.map((row:VehicleOffer)=>row.id),canonical.map(row=>row.id));
     const rub=second.items[0].totalRub;
     const ranged=await (await request(q+`&budgetFrom=${rub}&budgetTo=${rub}`)).json();
     assert.deepEqual(ranged.items.map((row:VehicleOffer)=>row.id),[second.items[0].id]);
     assert.equal((await (await request(q+`&budgetFrom=${rub}&budgetTo=${rub}&countOnly=1`)).json()).total,1);
     assert.deepEqual((await (await request(q+'&page=5&pageSize=1')).json()).items,[]);
     const skipped=[...s3.keys()].find(key=>key.includes('/prepared-china-read-v1/projections/')&&key!==projected)!;
     const prior=s3.get(skipped)!;
     s3.set(skipped,{...prior,body:Buffer.from('{}')});
     const readStart=requests.length;
     try{
      const third=await request(q+'&page=3&pageSize=1');
      assert.equal(third.status,200);
      assert.equal((await third.json()).items[0].id,canonical[2].id);
      assert.ok(!requests.slice(readStart).some(req=>req.key===skipped));
      assert.deepEqual(requests.slice(readStart).filter(req=>req.key.includes('/projections/')).map(req=>req.key),[projected]);
     }finally{s3.set(skipped,prior);}
     s3.set(projected,{...original,body:Buffer.from('{}')});
     try{
      assert.equal((await request(q+'&page=3&pageSize=1')).status,503);
      assert.equal((await (await request(q+'&countOnly=1')).json()).total,4);
     }finally{s3.set(projected,original);}
    });
    // Actual normal App Router handlers use the authenticated China pointer
    // without a fixture scope. Signed transport is mocked; no remote mutation.
    assert.ok(baselineRef);
    const knownBase=baselineRef;
    const observedEnv=Object.fromEntries([...s3Keys,'AVTOCENA_CHINA_REGCLOUD_RUNTIME'].map(k=>[k,process.env[k]]));
    const beforeFetch=globalThis.fetch;
    const calls:{key:string;method:string}[]=[];
    let rejectCas=false,allowWrites=false;
    try{
     Object.assign(process.env,{YC_OBJECT_STORAGE_ENDPOINT:CHINA_REGCLOUD_STAGE_ORIGIN,YC_OBJECT_STORAGE_BUCKET:'fixture-owned-stage',
      YC_OBJECT_STORAGE_PREFIX:'fixture/active',YC_OBJECT_STORAGE_REGION:'ru-central1',
      YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-stage',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture-stage-secret'});
     delete process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME;
     globalThis.fetch=async(u,init)=>{
      const url=new URL(String(u)),h=new Headers(init?.headers),method=init?.method??'GET';
      assert.equal(url.origin,CHINA_REGCLOUD_STAGE_ORIGIN);
      assert.equal(init?.redirect,'error');
      assert.match(h.get('authorization')||'',/^AWS4-HMAC-SHA256 Credential=fixture-stage\//);
      const acl='<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>fixture-owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>fixture-owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
      if(url.pathname==='/fixture-owned-stage'){
       assert.equal(method,'GET');
       if(url.search==='?acl=')return new Response(acl);
       assert.equal(url.search,'?policy=');
       return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>',{status:404});
      }
      const key=decodeURIComponent(url.pathname.split('/fixture-owned-stage/fixture/active/')[1]??'');
      assert.ok(key===CHINA_PUBLIC_CONTROL||key==='catalog/manifest.json'||key.startsWith(rootRemote),key);calls.push({key,method});
      const data=remote.get(key),etag=data?createHash('sha256').update(data).digest('hex'):null;
      if(method==='GET'&&url.search==='?acl=')return data?new Response(acl):new Response(null,{status:404});
      if(method==='GET')return data?new Response(new Uint8Array(data),{headers:{etag:'"'+etag+'"'}}):new Response(null,{status:404});
      assert.equal(method,'PUT');assert.ok(allowWrites);
      if(key===CHINA_PUBLIC_CONTROL){
       if(rejectCas)return new Response(null,{status:412});
       if(etag)assert.equal(h.get('if-match'),etag,'Regcloud adapter signs a bare ETag');
       else assert.equal(h.get('if-none-match'),'*');
      }else{
       assert.equal(h.get('if-none-match'),'*');
       assert.equal(h.get('x-amz-acl'),'private');
       if(data)return new Response(null,{status:412});
      }
      remote.set(key,Buffer.from(init!.body as Buffer));return new Response(null,{status:200});
     };
     const phase=await openStageChinaFiles({allowedParent:directory,root:bigShadow,readySha256:bigPrepare.runtimeReadySha256,
      archiveSha256:bigSpec.sha256,expectedGenerationId:'gen_'+(asOf+700)+'_nativefilesystem',
      expectedFxSha256:fx.receiptSha256,expectedAdmittedRows:3000,sourceValidUntil:capture.validUntil});
     const scopeConfig={endpoint:CHINA_REGCLOUD_STAGE_ORIGIN,bucket:'fixture-owned-stage',prefix:'fixture/active',region:'ru-central1'};
     const stagePermit:ChinaDurableStagePermit={version:1,kind:'china-own-regcloud-private-stage-v1',market:'china',runId:'qualifier-runtime',
      storage:scopeConfig,generationId:phase.ready.generationId,archiveSha256:bigSpec.sha256,runtimeReadySha256:phase.readySha256,
      expectedChinaPublicBaseSha256:chinaObjectDigest(knownBase),minAdmittedRows:3000,maxArtifactBytes:200*1024*1024,
      validUntil:phase.ready.validUntil,expectedOwnerApprovalSha256:'b'.repeat(64),publicationAuthorized:false,cursorAdvanceAuthorized:false};
     const liveStorage=new ObjectJsonStorage();
     allowWrites=true;
     const staged=await transferChinaPrivateStage({storage:liveStorage,files:phase,permit:stagePermit,
      expectedPermitSha256:preparedPriceCardDigest(stagePermit),async assertApprovedRunner(){assert.ok(allowWrites);}});
     allowWrites=false;
     const nextRef={runId:staged.ready.runId,generationId:staged.ready.generationId,readySha256:staged.readySha256};
     const startState={version:1,market:'china',revision:1,active:knownBase,previous:null};
     remote.set(CHINA_PUBLIC_CONTROL,Buffer.from(JSON.stringify(startState)));
     process.env.AVTOCENA_CHINA_REGCLOUD_RUNTIME='1';
     const old=await request('countOnly=1');assert.equal(old.status,200);assert.equal((await old.json()).generationId,knownBase.generationId);
     const query='make=Mercedes-Benz&city='+encodeURIComponent('Омск')+'&sort=totalRub&pageSize=12';
     const preview=async(target:ChinaPublicRef)=>{
      const reader=await openChinaStageObjectFiles(liveStorage,target,async()=>{});
      return withPreparedChinaRegcloudPreview(reader,async()=>{
       const result=await request(query),count=await request(query+'&countOnly=1');
       assert.equal(result.status,200);assert.equal(count.status,200);
       const list=await result.json(),total=await count.json();
       assert.equal(total.total,list.total);assert.ok(total.total>0);
       const row=list.items[0],detail=await readOfferDetailForPage(row.id,true,{market:'china',city:'Омск',preparedCut:target.generationId});
       assert.equal(detail.offer?.totalRub,row.totalRub);
       return {version:1,kind:'normal-china-runtime-readback',generationId:list.generationId,readySha256:target.readySha256,
        buildSha256:'9'.repeat(64),checkedAt:Date.now(),cardId:row.id,listRub:row.totalRub,detailRub:detail.offer!.totalRub!,filteredCount:total.total} satisfies VerifiedChinaRuntimeProbe;
      });
     };
     const probe=await preview(nextRef),priorProbe=await preview(knownBase);
     assert.equal(probe.filteredCount,700);
     const permitFor=(action:ChinaOwnSwitchPermit['action'],current:ChinaPublicState|null,target:ChinaOwnSwitchPermit['target'],proof:VerifiedChinaRuntimeProbe):ChinaOwnSwitchPermit=>({
      version:1,market:'china',kind:'china-own-public-cut-cas-v1',action,storage:scopeConfig,expectedBaseSha256:chinaObjectDigest(current?.active??null),
      expectedPublicControlSha256:current?chinaObjectDigest(current):null,target,expectedRuntimeProbeSha256:chinaObjectDigest(proof),validUntil:phase.ready.validUntil,
     });
     const commit=(permit:ChinaOwnSwitchPermit,proof:VerifiedChinaRuntimeProbe)=>switchChinaRegcloudCut({storage:liveStorage,permit,
      expectedPermitSha256:chinaObjectDigest(permit),async assertApprovedRunner(){assert.ok(allowWrites);},async verifyNormalRuntimeReadback(){return proof;}});
     const switchPermit=permitFor('activate',startState,nextRef,probe);
     allowWrites=true;
     await assert.rejects(commit(switchPermit,{...probe,detailRub:probe.detailRub+1}),/normal_runtime_readback/);
     rejectCas=true;await assert.rejects(commit(switchPermit,probe),StorageConflictError);
     assert.deepEqual(JSON.parse(remote.get(CHINA_PUBLIC_CONTROL)!.toString()),startState);
     rejectCas=false;
     const changed=await commit(switchPermit,probe);
     assert.deepEqual(changed.state.previous,knownBase);assert.deepEqual(changed.state.active,nextRef);
     allowWrites=false;
     const live=await request(query),body=await live.json();assert.equal(live.status,200);assert.equal(body.generationId,nextRef.generationId);
     assert.equal(body.total,700);
     const actualPage=await renderChinaList({make:'Mercedes-Benz',city:'Омск',sort:'totalRub'});
     const actualProps=findProps(actualPage,'initialCards');
     assert.ok(actualProps);assert.equal(actualProps.initialTotal,700);
     const actual=await readOfferDetailForPage(body.items[0].id,true,{market:'china',city:'Омск',preparedCut:nextRef.generationId});
     assert.equal(actual.offer?.totalRub,body.items[0].totalRub);
     assert.equal((await request(query+'&preparedCut='+knownBase.generationId)).status,409);
     const originalTime=Date.now(),legalUntil=phase.ready.legalValidUntil!;
     assert.ok(legalUntil>phase.ready.validUntil,'fresh fixture has independently derived legal horizon');
     try{
      t.mock.timers.setTime(phase.ready.validUntil+1);
      await assert.rejects(openChinaStageObjectFiles(liveStorage,nextRef,async()=>{}),/ready_scope|stage_authority/);
      const stillActive=await request(query);
      assert.equal(stillActive.status,200);
      const afterIngestExpiry=await stillActive.json();
      assert.equal(afterIngestExpiry.generationId,nextRef.generationId);
      assert.deepEqual(afterIngestExpiry.items.map((x:any)=>[x.id,x.totalRub]),body.items.map((x:any)=>[x.id,x.totalRub]));
      const expiredIngestDetail=await readOfferDetailForPage(body.items[0].id,true,{market:'china',city:'Омск',preparedCut:nextRef.generationId});
      assert.equal(expiredIngestDetail.offer?.totalRub,body.items[0].totalRub);

      t.mock.timers.setTime(legalUntil);
      assert.equal((await request(query)).status,503,'expires at actual certified tariff event');
     }finally{t.mock.timers.setTime(originalTime);}

     allowWrites=true;
     const restored=await commit(permitFor('rollback',changed.state,knownBase,priorProbe),priorProbe);
     assert.deepEqual(restored.state.active,knownBase);assert.deepEqual(restored.state.previous,nextRef);
     allowWrites=false;
     assert.equal((await (await request('countOnly=1')).json()).generationId,knownBase.generationId);
     const current=remote.get(CHINA_PUBLIC_CONTROL)!;remote.delete(CHINA_PUBLIC_CONTROL);
     try{assert.equal((await request('countOnly=1')).status,503);}finally{remote.set(CHINA_PUBLIC_CONTROL,current);}
     // First publication preserves exact old metadata as a cheap rollback,
     // without staging/repricing the older catalogue. The configured new
     // normal reader never opens the global manifest on its healthy path.
     const globalLegacy={version:2,generationId:baseGenerationId,
      markets:{china:{count:9,chunks:['chunk-0001']},korea:{count:1,chunks:['chunk-0001']}}};
     const legacy:ChinaLegacyRollback={kind:'legacy-unmodified',generationId:baseGenerationId,manifestSha256:chinaObjectDigest(globalLegacy)};
     remote.set('catalog/manifest.json',Buffer.from(JSON.stringify(globalLegacy)));
     const bootstrapStage:ChinaDurableStagePermit={...stagePermit,runId:'qualifier-bootstrap',generationId:ready.ready.generationId,
      archiveSha256:ready.ready.archiveSha256,runtimeReadySha256:ready.readySha256,expectedChinaPublicBaseSha256:chinaObjectDigest(null),
      minAdmittedRows:9,validUntil:ready.ready.validUntil};
     allowWrites=true;
     const firstStage=await transferChinaPrivateStage({storage:liveStorage,files:ready,permit:bootstrapStage,
      expectedPermitSha256:chinaObjectDigest(bootstrapStage),async assertApprovedRunner(){assert.ok(allowWrites);}});
     const firstRef={runId:firstStage.ready.runId,generationId:firstStage.ready.generationId,readySha256:firstStage.readySha256};
     const firstProbe=await preview(firstRef);
     remote.delete(CHINA_PUBLIC_CONTROL);
     const firstPermit={...permitFor('activate',null,firstRef,firstProbe),bootstrapPrevious:legacy};
     const firstPublic=await commit(firstPermit,firstProbe);
     assert.deepEqual(firstPublic.state.previous,legacy);
     allowWrites=false;
     const afterSwitch=calls.length;
     assert.equal((await request('countOnly=1')).status,200);
     assert.ok(!calls.slice(afterSwitch).some(x=>x.key==='catalog/manifest.json'));
     const proofLegacy:VerifiedChinaRuntimeProbe={...priorProbe,kind:'normal-china-legacy-readback',readySha256:undefined,
      legacyManifestSha256:legacy.manifestSha256,generationId:legacy.generationId};
     const rollbackLegacy=permitFor('rollback',firstPublic.state,legacy,proofLegacy);
     allowWrites=true;
     remote.set('catalog/manifest.json',Buffer.from(JSON.stringify({...globalLegacy,updatedAt:'foreign_change'})));
     await assert.rejects(commit(rollbackLegacy,proofLegacy),/legacy_manifest_changed/);
     assert.deepEqual(JSON.parse(remote.get(CHINA_PUBLIC_CONTROL)!.toString()),firstPublic.state);
     remote.set('catalog/manifest.json',Buffer.from(JSON.stringify(globalLegacy)));
     const ordinaryRestored=await commit(rollbackLegacy,proofLegacy);
     allowWrites=false;
     assert.deepEqual(ordinaryRestored.state.active,legacy);
     assert.equal(await openConfiguredChinaRegcloudFiles(),null,'exact old route may be used only for the explicit rollback marker');
     remote.set('catalog/manifest.json',Buffer.from(JSON.stringify({...globalLegacy,updatedAt:'foreign_change'})));
     await assert.rejects(openConfiguredChinaRegcloudFiles(),/legacy_manifest_changed/);
     assert.equal((await request('countOnly=1')).status,503);
     assert.ok(calls.every(x=>x.method==='GET'||x.key!=='catalog/manifest.json'));
     assert.ok(calls.every(x=>x.key===CHINA_PUBLIC_CONTROL||x.key==='catalog/manifest.json'||x.key.startsWith(rootRemote)));
    }finally{
     globalThis.fetch=beforeFetch;
     for(const [k,v]of Object.entries(observedEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;
    }

    const independentHttpStart=requests.length;
    await withPreparedChinaHttpFixture({...indexed,independentChina:marketChina},async()=>{
     const query='make=BMW&model=X5&sort=totalRub';
     const response=await request(query+'&page=2&pageSize=2');assert.equal(response.status,200);
     const page=await response.json();
     const expected=mixed.filter(row=>row.model==='X5').sort((a,b)=>a.totalRub!-b.totalRub!||a.id.localeCompare(b.id));
     assert.equal(page.generationId,ig);assert.equal(page.total,expected.length);
     assert.deepEqual(page.items.map((row:VehicleOffer)=>row.id),expected.slice(2,4).map(row=>row.id));
     assert.equal((await (await request(query+'&countOnly=1')).json()).total,expected.length);
     const otherModel=mixed.find(row=>row.model==='X3')!;
     const other=await readOfferDetailForPage(otherModel.id);
     assert.ok(other.prepared&&other.offer);assert.equal((await resolveOfferDisplay(other.offer)).visibleRub,otherModel.totalRub);
     const removed=await readOfferDetailForPage(withdrawn.id);assert.equal(removed.offer,null);
     assert.equal(removed.withdrawn?.reason,'removed');
     assert.equal((await renderOffer(withdrawn.id)).props.offer?.reason,'removed');
     assert.equal((await renderOffer(otherModel.id,offerPath(other.offer).split('/').at(-1))).props['data-offer-price-rub'],otherModel.totalRub);
     const qCity='city='+encodeURIComponent(' г. КЕМЕРОВО ')+
      '&make='+encodeURIComponent('BMW,mercedes-benz,bmw')+'&yearFrom=2019&yearTo=2023&budgetTo=2550000&sort=totalRub';
     const starting=requests.length;
     const counted=await request(qCity+'&countOnly=1');
     assert.equal(counted.status,200);assert.equal((await counted.json()).total,2);
     assert.ok(!requests.slice(starting).some(r=>r.key.includes('/projections/')));
     const found=await (await request(qCity)).json();
     assert.deepEqual(new Set(found.items.map((x:VehicleOffer)=>x.make)),new Set(['BMW','Mercedes-Benz']));
     assert.equal(found.deliveryCity,'Кемерово');
     const nextPage=await (await request(qCity+'&page=2&pageSize=1')).json();
     assert.equal(nextPage.total,2);assert.equal(nextPage.items[0].id,found.items[1].id);
     for(const item of found.items){
      const base=await readPreparedChinaFixtureOffer(item.id),delivered=await readPreparedChinaFixtureOffer(item.id,'Кемерово');
      assert.ok(base?.offer&&delivered?.offer);
      const ledger=base.offer.calculationSnapshot,lines=new Map<string,number>(ledger.breakdown.map((line:any)=>[line.id,line.amountRub]));
      const adj=Number(ledger.sourcePriceAdjustment?.adjustmentRub||0),q=quoteCityDelivery('Кемерово','china');
      const oracle=calculateAvtocenaFromBusinessConfig({marketId:'china',marketConfig:ledger.marketConfig,sourcePriceRub:ledger.sourcePriceRub,
       carPriceRub:lines.get('car')!-adj,sourcePriceAdjustmentRub:adj,customsRub:lines.get('customs'),utilizationFeeRub:lines.get('utilization-fee'),
       cityDeliveryRub:q.amountRub,deliveryCity:q.city});
      assert.equal(delivered.offer.totalRub,item.totalRub);
      assert.equal(oracle.totalRub,item.totalRub);
      assert.deepEqual(delivered.offer.calculationSnapshot.breakdown.map((x:any)=>[x.id,x.amountRub]),
       oracle.breakdown.map(x=>[x.id,x.amountRub]));
      assert.deepEqual(delivered.offer.calculationSnapshot.paymentPlan,oracle.paymentPlan);
      const cityPick={market:'china',city:'г. Кемерово'};
      const page=await renderOffer(item.id,offerPath(delivered.offer).split('/').at(-1),cityPick);
      assert.equal(page.props['data-offer-price-rub'],item.totalRub);
     }
     const nov=await request('city='+encodeURIComponent('Новокузнецк')+'&yearFrom=2022&budgetFrom=1500000&budgetTo=2500000&sort=totalRub');
     assert.equal(nov.status,200);assert.equal((await nov.json()).total,2);
     // Widening the buyer query cannot switch generations, and the compatibility
     // path uses ordinary filters and sorting even where the fast slice misses.
     const broader=qCity.replace('2550000','3000000');
     const preCompat=requests.length;
     const widened=await request(broader);
     assert.equal(widened.status,200);
     const widenedBody=await widened.json();assert.equal(widenedBody.generationId,ig);assert.equal(widenedBody.total,2);
     assert.ok(requests.slice(preCompat).filter(r=>r.key.includes('/projections/')).length>=3,'first bounded cut load');
     const cityOther='city='+encodeURIComponent('г. ОМСК')+
      '&make='+encodeURIComponent('BMW,Mercedes-Benz,BMW')+
      '&yearFrom=2019&yearTo=2023&budgetTo=3000000&engineTo=1600&powerTo=120&sort=totalRubDesc';
     const traced=requests.length;
     const fallback=await request(cityOther+'&pageSize=1&includeFacets=1');
     assert.equal(fallback.status,200);
     const later=await fallback.json();
     const total=await (await request(cityOther+'&countOnly=1')).json();
     assert.equal(later.generationId,ig);assert.equal(total.generationId,ig);assert.equal(total.total,2);assert.equal(later.total,2);
     assert.equal(later.facets.generationId,ig);
     assert.deepEqual(new Set(later.facets.makes),new Set(['BMW','Mercedes-Benz']));
     assert.ok(!requests.slice(traced).some(r=>r.key.includes('/projections/')),'warm cut uses already authenticated immutable projections');
     const p2=await (await request(cityOther+'&page=2&pageSize=1')).json();
     assert.ok(later.items[0].totalRub>p2.items[0].totalRub);
     assert.notEqual(later.items[0].id,p2.items[0].id);
     for(const item of [...later.items,...p2.items]){
      const owned=await readOfferDetailForPage(item.id,true,{market:'china',city:'Омск'});
      assert.equal(owned.offer?.totalRub,item.totalRub);
      assert.equal((await renderOffer(item.id,offerPath(owned.offer!).split('/').at(-1),{market:'china',city:'Омск'})).props['data-offer-price-rub'],item.totalRub);
     }
     const modelAlias=await (await request('make=BMW&model=X%201&yearFrom=2022&engineTo=1600&powerTo=120&countOnly=1')).json();
     assert.equal(modelAlias.total,1);
     const category=await (await request('marketPage=1&city='+encodeURIComponent('Омск'))).json();
     assert.equal(category.generationId,ig);assert.equal(category.total,9);assert.equal(category.pageSize,24);
     assert.equal((await request('marketPage=1&page=0')).status,400);
     const htmlQuery={city:'г. Омск',make:'BMW,Mercedes-Benz',yearFrom:'2019',yearTo:'2023',
      budgetTo:'3000000',engineTo:'1600',powerTo:'120',sort:'totalRubDesc'};
     const htmlStart=requests.length;
     const ssr=await renderChinaList(htmlQuery);
     const paging=findProps(ssr,'initialCards');
     assert.ok(paging);assert.equal(paging.initialTotal,2);assert.equal(paging.query.city,htmlQuery.city);
     assert.equal(paging.query.engineTo,1600);assert.equal(paging.query.powerTo,120);assert.equal(paging.query.preparedCut,ig);
     const ssrCards=paging.initialCards.map((entry:any)=>entry.props.offer);
     assert.deepEqual(ssrCards.map((entry:any)=>entry.id),[later.items[0].id,p2.items[0].id]);
     assert.ok(requests.slice(htmlStart).every(r=>r.method==='GET'&&r.key.startsWith(chinaRoot)));
     const genMissing='gen_'+(asOf-500)+'_old';
     assert.equal((await request(cityOther+'&marketPage=1&page=2&preparedCut='+genMissing)).status,409);
     assert.equal((await request(cityOther+'&marketPage=1&page=2&preparedCut='+ig)).status,200);
     for(const row of ssrCards){
      const link=new URL(offerCardPath(row),'https://fixture.invalid');
      assert.equal(link.searchParams.get('market'),'china');assert.equal(link.searchParams.get('city'),'Омск');
      assert.equal(link.searchParams.get('preparedCut'),ig);
      const rendered=await renderOffer(row.id,link.pathname.split('/').at(-1),{
       market:'china',city:'Омск',preparedCut:ig,
      });
      assert.equal(rendered.props['data-offer-price-rub'],row.totalRub);
      const stale=await renderOffer(row.id,link.pathname.split('/').at(-1),{
       market:'china',city:'Омск',preparedCut:genMissing,
      });
      assert.equal(stale.type.name,'SupplierUnavailableOffer');
     }
     const activeKey=chinaRoot+'control.json',ownBefore=s3.get(activeKey)!;
     raceOwnControl=3; // open, initial fence, then the final response fence
     try{assert.equal((await request(cityOther)).status,503,'a cached pack cannot outlive its active cut');}
     finally{raceOwnControl=0;s3.set(activeKey,ownBefore);}
     // Simulate a moved control and a corrupt formerly-proofed projection root.
     const brokenDir=[...s3.keys()].find(key=>key.startsWith(chinaRoot)&&key.includes('/directory-'))!;
     const exactDir=s3.get(brokenDir)!;
     s3.set(brokenDir,{...exactDir,body:Buffer.from('{}')});
     try{assert.ok(findProps(await renderChinaList(htmlQuery),'resultError'));}finally{s3.set(brokenDir,exactDir);}
     raceOwnControl=3;
     try{assert.ok(findProps(await renderChinaList(htmlQuery),'resultError'));}
     finally{raceOwnControl=0;s3.set(activeKey,ownBefore);}
     assert.equal((await request('includeRates=1')).status,503);
     assert.equal((await request('city=obviously-unknown')).status,503);
     const missing=await readOfferDetailForPage('unknown-unqualified-fixture-id');
     assert.equal(missing.unavailable,true);assert.equal(missing.offer,null);

     const unavailable=await generateMetadata({params:Promise.resolve({id:withdrawn.id})});
     assert.equal(typeof unavailable.robots==='object'&&unavailable.robots?.index,false);
    });
    assert.ok(requests.slice(independentHttpStart).every(r=>r.method==='GET'&&r.key.startsWith(chinaRoot)));
    for(const [key,value] of koreanBefore)assert.deepEqual(s3.get(key),value);
    const httpReads=requests.slice(httpReadStart);
    assert.ok(httpReads.length>0&&httpReads.every(req=>req.method==='GET'&&
     (req.key==='catalog/manifest.json'||req.key.startsWith(`catalog/generations/${marked.generationId}/`)||req.key.startsWith(chinaRoot))));
    assert.ok(mutableReads.every(key=>key==='catalog-editorial/current.json'),mutableReads.join(','));
    storage.readJsonWithMeta=localRead;
    const unrelatedQueries=['make=BMW&model=X5&countOnly=1','make=BMW&model=X3&sort=totalRub&countOnly=1','make=BMW&model=X5&sort=totalRub&powerTo=300&countOnly=1','make=BMW&model=X5&sort=totalRub&countOnly=1&includeRates=1'];
    for(const q of unrelatedQueries){
     const legacy=await request(q);
     const same=await withPreparedChinaHttpFixture<Response>(indexed,()=>request(q));
     assert.equal(same.status,legacy.status);
     assert.equal(same.headers.get('cache-control'),legacy.headers.get('cache-control'));
     assert.deepEqual(await same.json(),await legacy.json());
    }
    const independent=Object.freeze({...indexed,independentChina:marketChina});
    const ownControl=chinaRoot+'control.json',activeControl=s3.get(ownControl)!;
    s3.delete(ownControl);
    try{
     const baseline=await request('countOnly=1');
     const before=await withPreparedChinaHttpFixture<Response>(independent,()=>request('countOnly=1'));
     assert.equal(before.status,baseline.status);
     assert.deepEqual(await before.json(),await baseline.json());
    }finally{s3.set(ownControl,activeControl);}
    s3.delete(ownControl);
    try{
     const legacyQuery={model:'X5'};
     const without=await renderChinaList(legacyQuery);
     const before=await withPreparedChinaHttpFixture(independent,()=>renderChinaList(legacyQuery));
     assert.equal(findProps(without,'resultError'),undefined);
     assert.equal(findProps(before,'resultError'),undefined);
     assert.equal(Boolean(findProps(before,'initialCards')),Boolean(findProps(without,'initialCards')));
    }finally{s3.set(ownControl,activeControl);}
    const ordinary=await request('countOnly=1');
    s3.set('catalog/manifest.json',oldActive);
    try{
     const unchanged=await withPreparedChinaHttpFixture<Response>(fixture,()=>request('countOnly=1'));
     assert.equal(unchanged.status,ordinary.status);
     assert.equal(unchanged.headers.get('cache-control'),ordinary.headers.get('cache-control'));
     assert.deepEqual(await unchanged.json(),await ordinary.json());
    }finally{s3.set('catalog/manifest.json',live);}

    // One real staged generation beyond the former hard stop. Build the exact
    // native chunks, locator and frozen-price ledgers, then take only selective
    // projection reads for a city/filter request.
    const fullRows:VehicleOffer[]=Array.from({length:640},(_,i)=>{
     const seed=i<500?mixed[2]:mixed[1],number=String(50001+i),id='fixture-full-cn-'+number;
     return {...seed,id,sourceOfferId:number,operational:{...seed.operational,sourceUrl:'https://global.che168.com/en/detail/'+number}};
    });
    const fullBlocks:PreparedPriceExpectedBlock[]=[];
    for(let start=0;start<fullRows.length;start+=500){
     const sourceChunk='chunk-'+String(1+Math.floor(start/500)).padStart(4,'0');
     for(let position=start,part=0;position<Math.min(start+500,fullRows.length);position+=50,part++){
      const rows=fullRows.slice(position,Math.min(position+50,start+500));
      fullBlocks.push({sourceChunk,part,rows:rows.length,sourceIdsSha256:preparedPriceCardDigest(rows.map(row=>row.id)),sourceInputSha256:preparedPriceCardDigest(rows)});
     }
    }
    const fullCapture={...capture,cursor:{...capture.cursor,sequence:32},statuses:[...fullRows.map(row=>({id:row.id,state:'available' as const})),withdrawn]};
    const current=await marketChina.observe(),fullGen='gen_'+(asOf+503)+'_streamingchina';
    const fullLease=await marketChina.acquire({action:'publish',generationId:fullGen,expectedBaseSha256:current.baseSha256},60000);
    const full=await prepareIndependentChinaFixture({...input,withFixedCities:undefined,withStreamingSearch:true,lease:fullLease,canonical:fullRows,
     capture:{...fullCapture,expectedReceiptSha256:independentChinaSourceDigest(fullCapture)},
     expectedAdmittedIdsSha256:preparedCoverageIdsDigest(fullRows.map(row=>row.id)),
     blockRows:50,expectedBlocks:async function*(){yield* fullBlocks;}});
    assert.equal(full.report.blockCount,13);
    await marketChina.activate(fullLease,full.ready);
    assert.equal((await marketChina.observe()).cursor?.sequence,32);
    const fullPrefix=chinaRoot+'generations/'+fullGen+'/';
    const oldProjection=[...s3.keys()].find(key=>key.startsWith(fullPrefix)&&key.includes('/projections/chunk-0001/'))!;
    assert.ok(oldProjection);
    const exact=s3.get(oldProjection)!;
    const testedFull=requests.length;
    storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
     assert.equal(key,'catalog-editorial/current.json');
     return localRead(key,fallback);
    };
    await withPreparedChinaHttpFixture(independent,async()=>{
     const q='make=Mercedes-Benz,mercedes-benz&engineTo=1600&powerTo=120&yearFrom=2022&budgetTo=3000000&sort=totalRub&city='+encodeURIComponent('Омск');
     s3.set(oldProjection,{...exact,body:Buffer.from('{}')});
     try{
      const counted=await request(q+'&countOnly=1');assert.equal(counted.status,200);assert.equal((await counted.json()).total,140);
      const second=await request(q+'&page=2&pageSize=24&includeFacets=1');assert.equal(second.status,200);
      const selected=await second.json();assert.equal(selected.generationId,fullGen);assert.equal(selected.total,140);
      assert.deepEqual(selected.items.map((x:VehicleOffer)=>x.id),fullRows.slice(524,548).map(x=>x.id));
      assert.deepEqual(selected.facets.makes,['Mercedes-Benz']);
      assert.ok(!requests.slice(testedFull).some(r=>r.key.includes('/projections/chunk-0001/')||r.key.includes('/offers/china/')));
      const pageView=await renderChinaList({make:'Mercedes-Benz',yearFrom:'2022',sort:'totalRub',city:'Омск'});
      const view=findProps(pageView,'initialCards'),filterView=findProps(pageView,'facets');
      assert.ok(view&&filterView);assert.equal(view.initialTotal,140);
      assert.deepEqual(new Set(filterView.facets.makes),new Set(['BMW','Mercedes-Benz']));
      assert.ok(!requests.slice(testedFull).some(r=>r.key.includes('/projections/chunk-0001/')));
      const card=selected.items[0],cardUrl=new URL(offerCardPath(card),'https://fixture.test');
      assert.equal(cardUrl.searchParams.get('preparedCut'),fullGen);
      const cardStart=requests.length;
      const rendered=await renderOffer(card.id,cardUrl.pathname.split('/').at(-1),{market:'china',city:'Омск',preparedCut:fullGen});
      assert.equal(rendered.props['data-offer-price-rub'],card.totalRub);
      assert.deepEqual(requests.slice(cardStart).filter(r=>r.key.includes('/offers/china/')).map(r=>r.key),[fullPrefix+'prepared/offers/china/chunk-0002.part-0.json']);
      assert.equal((await request('countOnly=1')).status,503,'affected broad query may not use old cut');
     }finally{s3.set(oldProjection,exact);}
     const broad=await request('marketPage=1&city='+encodeURIComponent('Омск')+'&page=2');
     assert.equal(broad.status,200);
     const body=await broad.json();assert.equal(body.total,640);assert.equal(body.items.length,24);
     const first=await (await request('marketPage=1&city='+encodeURIComponent('Омск')+'&page=1')).json();
     assert.ok(body.items.every((row:VehicleOffer)=>!first.items.some((old:VehicleOffer)=>old.id===row.id)));
     assert.equal((await readOfferDetailForPage(withdrawn.id)).withdrawn?.reason,'removed');
    });
    assert.ok(requests.slice(testedFull).every(r=>r.method==='GET'&&r.key.startsWith(chinaRoot)));
    for(const [key,value] of koreanBefore)assert.deepEqual(s3.get(key),value);

   }finally{
    aliases.deregister();
    if(previousReact===undefined)delete globals.React;else globals.React=previousReact;
    if(previousCache===undefined)delete react.cache;else react.cache=previousCache;
    storage.readJsonWithMeta=localRead;
   }

   assert.ok(requests.every(req=>req.method==='GET'||req.key==='catalog/manifest.json'||
    req.key.startsWith(`catalog/private-prepared-prices-v1/china/${cover.candidateGenerationId}/`)||
    req.key.startsWith(`catalog/generations/${cover.candidateGenerationId}/indexes/`)||req.key.startsWith(chinaRoot)||req.key.startsWith(koreaRoot)));

  }finally{
   globalThis.fetch=noNetwork;
   for(const [key,value] of Object.entries(s3Env))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  assert.equal(writes.length,0,'private fixture does not affect application local storage');
  assert.deepEqual((await fs.readdir('data',{recursive:true})).sort(),filesBefore);

  // Default disabled path still behaves as the existing writer, including a
  // normal activation. It does not create any of the shadow artifacts.
  const normal=await persistCatalogOffers(admittedSeed,{expectedBaseGenerationId:baseGenerationId});
  const pos=(suffix:string)=>writes.findIndex(key=>key.includes(normal.generationId)&&key.endsWith(suffix));
  const card=pos('/offers/china/chunk-0001.json'), index=pos('/indexes/budget-count-v3.json');
  const commit=writes.lastIndexOf('catalog/manifest.json');
  assert.ok(card>=0&&index>card&&commit>index,JSON.stringify(writes));
  assert.ok(!writes.some(key=>key.includes('/prepared-price-cards-v1/')));
  assert.equal((await storage.readJson<CatalogManifest>('catalog/manifest.json',active)).generationId,normal.generationId);
  assert.equal(outbound,0);
 }finally{
  process.chdir(cwd);globalThis.fetch=oldFetch;
  for(const [key,value] of Object.entries(oldEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
  resetJsonStorageForTests();resetCatalogReadCachesForTests();resetCatalogRateCache();resetChinaCnyPriceCache();invalidateEffectiveMarketsCache();
  await fs.rm(directory,{recursive:true,force:true});
 }
});
