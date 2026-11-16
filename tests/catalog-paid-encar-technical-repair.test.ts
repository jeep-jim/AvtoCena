import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizePaidEncarOffer} from '../scripts/lib/paid-encar-offer.mjs';
import {PAID_ENCAR_REPAIR_SNAPSHOT, PAID_ENCAR_REPAIR_PROTECTED_KEYS, paidRepairDigest, paidRepairObjectRevision,
  paidRepairRowsProof, mergePaidEncarTechnicalCorrection, buildPaidEncarTechnicalRepair,
  assertPaidRepairPublicationRows} from '../scripts/lib/paid-encar-technical-repair.mjs';
import {loadPaidRepairPlan, createPaidRepairPublicationGuard, assertPaidRepairLeaseFree,
  assertPaidRepairSavedSnapshot, installPaidRepairNetworkFence, readPaidRepairPreservedMarket} from '../scripts/lib/paid-encar-repair-io.mjs';
import {hashRows} from '../scripts/lib/catalog-row-hash.mjs';
import {hasAllowedCatalogSourceProvenance, isCatalogYearAllowed} from '../apps/web/lib/catalog/offer-quality';
import {isAllDubicarsOffer} from '../apps/web/lib/catalog/dubicars-owner-policy';
import {writeCatalogProjectionBatches} from '../apps/web/lib/catalog-projection-parts';
import {EncarDirectAdapter} from '../apps/web/lib/catalog/adapters';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {compactPublicStorageOffer, publicOffer} from '../apps/web/lib/catalog/storage';

const observedAt = '2026-11-14T12:00:00.000Z', now = Date.parse('2026-11-16T13:00:00.000Z');
const sourceSha = 'a'.repeat(40), controllerSha = 'b'.repeat(40), generationId = 'gen_1794665184205_cfd76b47';
const liveIdentity = {release:'c'.repeat(40), calculationVersion:'d'.repeat(64)};
const adapter = new EncarDirectAdapter();
const snapshotRoot = `catalog/intake-staging/encar/${PAID_ENCAR_REPAIR_SNAPSHOT.runId}/${PAID_ENCAR_REPAIR_SNAPSHOT.attempt}`;
function data(inner_id = '42799484', patch = {}) {
  return {inner_id, mark:'Kia', model:'Morning', configuration:'GT Line', year:2024, engine_type:'Бензин',
    displacement_cc:998, power:76, power_ice_hp:76, price:12000000, currency:'KRW', km_age:12000,
    transmission_type:'Автомат', advertisement_type:'Продажа', sales_status:'Доступно', ...patch};
}
function source(d = data()) {
  const row = normalizePaidEncarOffer(d, {id:d.inner_id, observedAt, adapter});
  row.sourcePrice = d.price;
  row.images = Array.from({length:5}, (_,i) => ({id:'', url:`https://ci.encar.com/car/${d.inner_id}_${i+1}.jpg`,
    objectKey:'',checksum:'',size:0,mimeType:'image/jpeg'}));
  Object.assign(row.operational,{lastSeenAt:observedAt,exactPhotos:true,photoIdentityVerified:true,galleryImageCount:5});
  return row;
}
function current(d = data()) {
  const row = source(d);
  for (const key of ['fuel','engineCc','powerHp','powerKw','icePowerKw','powerDataConfidence','powerDataSource','utilizationPowerKw']) delete row[key];
  row.powertrainKind = 'unknown'; row.sourcePrice = 13500000; row.drive = d.drive_type === '2WD' ? 'fwd' : undefined;
  if (d.model === 'Seltos') row.fuel='petrol';
  for (const key of ['semanticEvidence','sourcePower','sourceDriveEvidence','fieldIdentityVerified']) delete row.operational[key];
  delete row.operational.raw;
  return row;
}
function meta(value: any) {return {found:value !== null, value, ...(value !== null ? {etag:'"'+paidRepairDigest(value)+'"'} : {})};}
function fixture(rows = [current()]) {
  const editorial = {version:1,revision:'r1',entries:{}};
  const manifest = {version:2,generationId,markets:{korea:{provider:'auto_api_encar',count:rows.length,chunks:['chunk-0001']}}};
  const snapshot = {pages:1,count:rows.length,completedAt:observedAt};
  const protectedObjects = Object.fromEntries(PAID_ENCAR_REPAIR_PROTECTED_KEYS.map(key => [key,meta(key.startsWith('catalog-editorial') ? editorial : {})]));
  const sourceProof = {identity:PAID_ENCAR_REPAIR_SNAPSHOT,snapshotSha256:paidRepairDigest(snapshot),
    snapshotRevision:paidRepairObjectRevision(meta(snapshot)),pagesSha256:'e'.repeat(64),rows:rows.length,pages:1,observedAt};
  return {currentRows:rows,sourceById:new Map(rows.map(row => [row.id,source(data(row.sourceOfferId))])),sourceProof,
    manifestMeta:meta(manifest),protectedObjects,editorial,liveIdentity,sourceSha,controllerSha,now,snapshot};
}
function memory(values: Record<string, any>) {
  const map = new Map(Object.entries(values));
  return {map,driver:'object',async readJson(key: string, fallback: any) {return structuredClone(map.has(key) ? map.get(key) : fallback);},
    async readJsonWithMeta(key: string, fallback: any) {return meta(await this.readJson(key,fallback));},
    async getBinary(key:string) {return {data:Buffer.from(JSON.stringify(map.get(key) ?? null))};},
    async writeJson() {throw Error('unexpected_write');}};
}

test('same saved observation repairs only current technical fields and clears ambiguous 2WD', () => {
  for (const d of [data(),data('42760061',{model:'Seltos',configuration:'1.6T 2WD',displacement_cc:1598,power:193,power_ice_hp:193,drive_type:'2WD'})]) {
    const old = current(d), incoming = source({...d,price:1000000});
    const result = mergePaidEncarTechnicalCorrection(old,incoming,{observedAt,editorial:null});
    assert.equal(result.outcome,'technical_corrected');
    assert.equal(result.offer.engineCc,d.displacement_cc); assert.equal(result.offer.powerHp,d.power);
    assert.equal(result.offer.fuel,'petrol'); assert.equal(result.offer.drive,undefined);
    assert.equal(result.offer.sourcePrice,13500000); assert.equal(result.offer.sourceCurrency,'KRW');
    assert.equal(result.offer.updatedAt,old.updatedAt); assert.equal(result.offer.operational.lastSeenAt,observedAt);
    assert.deepEqual(result.offer.images,old.images); assert.equal(result.offer.status,old.status);
    assert.equal(result.offer.totalRub,null);
  }
});

test('newer observations, missing historical IDs, differing year and verified specifications remain protected', () => {
  const old = current(), newer = structuredClone(old); newer.operational.lastSeenAt='2026-11-15T12:00:00.000Z';
  const verified = source(); verified.powerHp=81; verified.powerDataConfidence='documented'; verified.powerDataSource='owner_document';
  const scenarios = [[newer,source(),'newer_observation_preserved'],[old,undefined,'saved_identity_absent'],
    [{...old,year:2023},source(),'current_year_preserved'],[verified,source(),'verified_technical_preserved']];
  for (const [row,incoming,outcome] of scenarios) {
    const result = mergePaidEncarTechnicalCorrection(row,incoming,{observedAt,editorial:null});
    assert.equal(result.outcome,outcome); assert.deepEqual(result.offer,row); assert.ok(result.protectedTechnical);
  }
  const conflict = source(data('42799484',{engine_type:'Бензин',power_electro_kw:20}));
  assert.equal(mergePaidEncarTechnicalCorrection(old,conflict,{observedAt,editorial:null}).outcome,'source_technical_conflict_preserved');
});

test('manual price, drive, saved scenarios and independently verified core survive correction', () => {
  const old = current(data('42760061',{model:'Seltos',drive_type:'2WD'}));
  old.savedCalculationPreview={city:'Moscow',manualScenario:true}; old.operational.manualNotes={review:'kept'};
  const editorial = {revision:'manual1',entries:{[old.id]:{id:old.id,market:'korea',sourceId:'encar_direct',sourceOfferId:old.sourceOfferId,
    status:'hidden',sellerPrice:{amount:14000000,currency:'KRW'},specifications:{drive:'rwd',color:'blue'}}}};
  const incoming = source(data(old.sourceOfferId,{model:'Seltos',drive_type:'2WD'}));
  const result = mergePaidEncarTechnicalCorrection(old,incoming,{observedAt,editorial});
  assert.equal(result.offer.drive,'rwd'); assert.equal(result.offer.color,'blue'); assert.equal(result.offer.sourcePrice,14000000);
  assert.deepEqual(result.offer.savedCalculationPreview,old.savedCalculationPreview);
  assert.deepEqual(result.offer.operational.manualNotes,old.operational.manualNotes);
  assert.equal(editorial.entries[old.id].status,'hidden'); assert.equal(result.protectedTechnical.drive,'rwd');
});

test('repair receipt forbids resurrected IDs or lost rows and detects commercial/freshness/media/manual changes', () => {
  const f = fixture(), extra = source(data('99999999'));
  f.sourceById.set(extra.id,extra);
  const result = buildPaidEncarTechnicalRepair(f);
  assert.equal(result.offers.length,1); assert.equal(result.receipt.core.before.count,1);
  assertPaidRepairPublicationRows(result.receipt,result.offers,f.editorial,{input:true});
  assert.throws(() => assertPaidRepairPublicationRows(result.receipt,[...result.offers,extra],f.editorial),/row_count/);
  assert.throws(() => assertPaidRepairPublicationRows(result.receipt,[],f.editorial),/row_count/);
  for (const mutate of [(row:any)=>row.sourcePrice++, (row:any)=>row.sourceCurrency='USD',
    (row:any)=>row.updatedAt='2026-11-16T12:00:00Z', (row:any)=>row.operational.lastSeenAt='2026-11-16T12:00:00Z',
    (row:any)=>row.images.pop(), (row:any)=>row.operational.manualFacts={new:true}, (row:any)=>row.status='withdrawn',
    (row:any)=>row.engineCc=1598, (row:any)=>row.drive='fwd']) {
    const changed = structuredClone(result.offers); mutate(changed[0]);
    assert.throws(() => assertPaidRepairPublicationRows(result.receipt,changed,f.editorial),/paid_repair_/);
  }
  const corrupt = structuredClone(result.receipt); corrupt.core.before.count=2;
  assert.throws(() => assertPaidRepairPublicationRows(corrupt,result.offers,f.editorial),/receipt_invalid/);
  const truncated = {...f,manifestMeta:meta({...f.manifestMeta.value,markets:{korea:{...f.manifestMeta.value.markets.korea,count:2}}})};
  assert.throws(() => buildPaidEncarTechnicalRepair(truncated),/coverage_incomplete/);
});

test('protected newer technical fields cannot be changed during later canonicalization', () => {
  const f=fixture(); f.currentRows[0].operational.lastSeenAt='2026-11-15T12:00:00Z';
  const result=buildPaidEncarTechnicalRepair(f), changed=structuredClone(result.offers);
  changed[0].engineCc=999;
  assert.throws(()=>assertPaidRepairPublicationRows(result.receipt,changed,f.editorial),/verified_technical_changed/);
});

test('actual seller preparation keeps both repaired examples and the preservation digests', async () => {
  const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();
  mock.timers.enable({apis:['Date'],now});
  const rates={updatedAt:new Date(now).toISOString(),KRW:{cbrRate:6,nominal:100,rateDate:new Date(now).toISOString(),rateSource:'cbr'},
    EUR:{cbrRate:100,nominal:1,rateDate:new Date(now).toISOString(),rateSource:'cbr'}};
  const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?rates:[]}));
  const write=mock.method(LocalJsonStorage.prototype,'writeJson',async()=>{throw Error('unexpected_write');});
  try {
    for(const d of [data(),data('42760061',{model:'Seltos',configuration:'1.6T 2WD',displacement_cc:1598,power:193,power_ice_hp:193,drive_type:'2WD'})]) {
      const f=fixture([current(d)]);f.sourceById.set(f.currentRows[0].id,source(d));
      const result=buildPaidEncarTechnicalRepair(f), prepared=await prepareSellerInventory(normalizeVehicleOfferSpecs(result.offers[0]));
      assert.ok(prepared);
      const compact=compactPublicStorageOffer(prepared);
      const proof=assertPaidRepairPublicationRows(result.receipt,[compact],f.editorial);
      assert.equal(proof.commercialSha256,result.receipt.core.before.commercialSha256);
      const visible=publicOffer(compact);
      assert.equal(visible.engineCc,d.displacement_cc);assert.equal(visible.powerHp,d.power);assert.equal(visible.fuel,'petrol');assert.equal(visible.drive,undefined);
    }
    for (const marker of ['manual_source','manual_date','personal_scenario']) {
      const d=data('42760061',{model:'K5',configuration:'2.0',displacement_cc:1998,power:210,power_ice_hp:210,drive_type:'2WD'});
      const old:any=normalizeVehicleOfferSpecs(source(d));
      old.drive='rwd';old.utilizationPowerKw=undefined;delete old.operational.raw;
      if(marker==='manual_source')old.powerDataSource='manual';
      if(marker==='manual_date')old.manualEditedAt='2026-11-15T15:00:00Z';
      if(marker==='personal_scenario')old.calculationSnapshot={modificationScenario:{source:'customer_selection',variantId:'owner-choice'},customQuote:{totalRub:2345678}};
      const f=fixture([old]);f.sourceById.set(old.id,source({...d,power:76,power_ice_hp:76,displacement_cc:998}));
      const result=buildPaidEncarTechnicalRepair(f);
      assert.equal(result.receipt.core.records[0].outcome,'manual_technical_preserved',marker);
      assert.deepEqual(result.offers[0],old,marker);
      const prepared=await prepareSellerInventory(normalizeVehicleOfferSpecs(result.offers[0]));
      assert.ok(prepared,marker);
      const compact=compactPublicStorageOffer(prepared),visible=publicOffer(compact);
      assert.equal(visible.powerHp,210,marker);assert.equal(visible.drive,'rwd',marker);
      if(marker==='personal_scenario') {
        // The ordinary seller pipeline currently replaces this private quote.
        // The repair must stop before writes, not silently lose that scenario.
        assert.throws(()=>assertPaidRepairPublicationRows(result.receipt,[compact],f.editorial),/paid_repair_.*changed/);
        const altered=structuredClone(result.offers);altered[0].calculationSnapshot.customQuote.totalRub++;
        assert.throws(()=>assertPaidRepairPublicationRows(result.receipt,altered,f.editorial),/paid_repair_.*changed/);
      } else assertPaidRepairPublicationRows(result.receipt,[compact],f.editorial);
    }
    const hybrid=data('42760061',{mark:'Nissan',model:'Note',configuration:'e-POWER',engine_type:'Гибрид',displacement_cc:1198,
      power:136,power_ice_hp:82,power_electro_kw:100});
    const retained=current(hybrid);retained.trim='e-POWER maximum 30-minute power 60 kW';
    const f=fixture([retained]);f.sourceById.set(retained.id,source(hybrid));
    const merged=mergePaidEncarTechnicalCorrection(retained,f.sourceById.get(retained.id),{observedAt,editorial:f.editorial});
    assert.equal(merged.offer.power30MinKw,undefined);
    const prepared=await prepareSellerInventory(normalizeVehicleOfferSpecs(merged.offer));
    assert.ok(prepared);
    assert.equal(prepared.power30MinKw,60,'fixture reaches the actual retained-trim inference');
    assert.throws(()=>buildPaidEncarTechnicalRepair(f),/paid_repair_undocumented_30_min_power/);
  } finally {read.mock.restore();write.mock.restore();mock.timers.reset();resetCatalogRateCache();
    if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});

test('saved loader reads only current intersection, verifies source totals and leaves all observations unchanged', async () => {
  const f=fixture(), outside=data('99999999'), saved=[{inner_id:'42799484',data:data()},{inner_id:'99999999',data:outside}];
  const snapshot={...f.snapshot,count:2}, reportRoot=`catalog/paid-encar-reports/v1/${Date.parse(observedAt)}`;
  const storage=memory({'catalog/manifest.json':f.manifestMeta.value,
    ...Object.fromEntries(Object.entries(f.protectedObjects).map(([key,value]:any)=>[key,value.value])),
    [`catalog/generations/${generationId}/offers/korea/chunk-0001.json`]:f.currentRows,
    [snapshotRoot+'/complete.json']:snapshot,[snapshotRoot+'/pages/1.json']:saved,
    [reportRoot+'/complete.json']:{version:1,provider:'auto_api_encar',observedAt,observedAtMs:Date.parse(observedAt),sourceRunId:'43570782014',sourceRunAttempt:'1'}});
  const producer={id:'43570782014',run_attempt:1,head_sha:PAID_ENCAR_REPAIR_SNAPSHOT.producerSha,status:'completed',conclusion:'success'};
  const options={storage,producer,liveIdentity,sourceSha,controllerSha,now,verifyPages:()=>null,isNonCash:()=>false,
    normalize:(d:any)=>source(d)};
  const result=await loadPaidRepairPlan(options);
  assert.equal(result.offers.length,1);assert.equal(result.receipt.core.sourceProof.rows,2);assert.equal(result.receipt.core.sourceProof.matched,1);
  assert.equal(result.offers[0].updatedAt,observedAt);
  assert.ok(result.references.some((row:any)=>row.root===snapshotRoot));
  assert.ok(result.references.some((row:any)=>row.root===reportRoot));
  storage.map.set(snapshotRoot+'/complete.json',{...snapshot,count:3});
  await assert.rejects(loadPaidRepairPlan(options),/count_mismatch/);
  storage.map.set(snapshotRoot+'/complete.json',snapshot);
  await assert.rejects(loadPaidRepairPlan({...options,producer:{...producer,head_sha:'f'.repeat(40)}}),/producer_mismatch/);
  storage.map.set(snapshotRoot+'/complete.json',{...snapshot,pages:9,count:9});
  for(let page=1;page<=9;page++) {
    const d=page===1?data():data(String(90000000+page));
    storage.map.set(snapshotRoot+`/pages/${page}.json`,[{inner_id:d.inner_id,data:d}]);
  }
  const read=storage.readJson.bind(storage);let active=0,maximum=0;const verified=[];
  storage.readJson=async(key,fallback)=>{
    if(!key.includes('/pages/'))return read(key,fallback);
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setTimeout(resolve,5-(Number(key.match(/(\d+)\.json$/)?.[1])%4)));
    const value=await read(key,fallback);active--;return value;
  };
  const batched=await loadPaidRepairPlan({...options,verifyPages:()=>({verify(page){verified.push(page);},finish(){}})});
  assert.equal(maximum,4);assert.deepEqual(verified,[1,2,3,4,5,6,7,8,9]);
  assert.equal(batched.receipt.core.sourceProof.rows,9);assert.equal(batched.offers.length,1);
});

test('authority guard stops manifest, CRM, cursor, controls, day, health and lease drift and checks a fresh durable result', async () => {
  const f=fixture(), result=buildPaidEncarTechnicalRepair(f), values={
    'catalog/manifest.json':f.manifestMeta.value,...Object.fromEntries(Object.entries(f.protectedObjects).map(([key,value]:any)=>[key,value.value])),
    [snapshotRoot+'/complete.json']:f.snapshot,'catalog/import-lock.json':{operationId:'repair',lockedUntil:new Date(now+60000).toISOString()}};
  for(const key of ['catalog/manifest.json',...PAID_ENCAR_REPAIR_PROTECTED_KEYS,snapshotRoot+'/complete.json']) {
    const storage=memory(values), guard=await createPaidRepairPublicationGuard({storage,receipt:result.receipt,expectedSha256:result.receipt.sha256,readIdentity:async()=>liveIdentity,now:()=>now});
    storage.map.set(key,{...storage.map.get(key),revision:'changed'});
    await assert.rejects(guard.verifyAuthority({operationId:'repair'}),/paid_repair_.*changed/);
  }
  const storage=memory(values);let clock=now,health=liveIdentity;
  const guard=await createPaidRepairPublicationGuard({storage,receipt:result.receipt,expectedSha256:result.receipt.sha256,readIdentity:async()=>health,now:()=>clock});
  await guard.verifyAuthority({operationId:'repair'});
  await assert.rejects(guard.verifyAuthority({operationId:'other'}),/lease_lost/);
  clock=now+86400000;await assert.rejects(guard.verifyAuthority(),/day_changed/);clock=now;
  health={...liveIdentity,release:'f'.repeat(40)};await assert.rejects(guard.verifyAuthority(),/runtime_changed/);health=liveIdentity;
  const next='gen_1794665189999_aabbccdd';storage.map.set('catalog/manifest.json',{...f.manifestMeta.value,generationId:next});
  storage.map.set(`catalog/generations/${next}/offers/korea/chunk-0001.json`,result.offers);
  assert.equal((await guard.verifyPublished(next,'repair')).verified,true);
  storage.map.get(`catalog/generations/${next}/offers/korea/chunk-0001.json`)[0].sourcePrice++;
  await assert.rejects(guard.verifyPublished(next,'repair'),/paid_repair_.*changed/);
  assert.throws(()=>assertPaidRepairLeaseFree(values['catalog/import-lock.json'],now),/lock_busy/);
  for (const lockedUntil of ['invalid',123,undefined])
    assert.throws(()=>assertPaidRepairLeaseFree({operationId:'writer',lockedUntil},now),/lock_invalid/);
  assert.doesNotThrow(()=>assertPaidRepairLeaseFree(null,now));
  assert.doesNotThrow(()=>assertPaidRepairLeaseFree({lockedUntil:''},now));
  assert.doesNotThrow(()=>assertPaidRepairLeaseFree({lockedUntil:observedAt},now));
});

test('pinned legacy 10270-page metadata is accepted within an explicit bounded maximum', () => {
  assert.doesNotThrow(()=>assertPaidRepairSavedSnapshot({pages:10270,count:205385,completedAt:observedAt},now));
  for(const pages of [0,20001,Infinity,1.2])
    assert.throws(()=>assertPaidRepairSavedSnapshot({pages,count:205385,completedAt:observedAt},now),/snapshot_invalid/);
});

test('network fence forbids supplier requests, source/CRM/cursor writes and all deletion', async () => {
  const original=globalThis.fetch,calls=[];
  try {
    for(const allowWrites of [false,true]) {
      installPaidRepairNetworkFence({endpoint:'https://storage.test',bucket:'catalog-bucket',prefix:'saved/',allowWrites,
        fetchImpl:async(input:any)=>{calls.push(String(input));return new Response('{}');}});
      await fetch('https://storage.test/catalog-bucket/saved/catalog/manifest.json');
      for(const url of ['https://supplier.test/encar','https://ajes.test/stats','https://storage.test/another-bucket/saved/catalog/a'])
        await assert.rejects(fetch(url),/external_request_forbidden/);
      for(const key of ['catalog-editorial/current.json','catalog/intake-cursors/v1/korea.json','catalog/operations/collection-controls-v1.json',
        'catalog/intake-staging/encar/43570782014/1/complete.json','catalog/paid-encar-reports/v1/1/complete.json'])
        await assert.rejects(fetch('https://storage.test/catalog-bucket/saved/'+key,{method:'PUT'}),/external_request_forbidden/);
      await assert.rejects(fetch('https://storage.test/catalog-bucket/saved/catalog/manifest.json',{method:'DELETE'}),/external_request_forbidden/);
      const write=fetch('https://storage.test/catalog-bucket/saved/catalog/generations/gen_1_a/index.json',{method:'PUT'});
      if(allowWrites)await write;else await assert.rejects(write,/external_request_forbidden/);
    }
    assert.equal(calls.length,3);
  } finally {globalThis.fetch=original;}
});

test('manual repair remains disabled, has no supplier credential/collector/cursor commit and reuses staged publisher', () => {
  const workflow=fs.readFileSync(new URL('../.github/workflows/repair-paid-encar-technical.yml',import.meta.url),'utf8');
  if (workflow.includes('PAID_REPAIR_SOURCE_SHA: UNASSIGNED'))
    assert.match(workflow,/if: \$\{\{ false \}\}/);
  else assert.match(workflow,/PAID_REPAIR_SOURCE_SHA: ['"]?[a-f0-9]{40}['"]?\s/);
  assert.doesNotMatch(workflow,/schedule:|AUTO_API_.*KEY|ACCOUNT_KEY|catalog-commit-intake-cursor|catalog-paid-encar-intake\.mjs/);
  const publisher=fs.readFileSync(new URL('../scripts/catalog-publish-market.mjs',import.meta.url),'utf8');
  assert.match(publisher,/technicalRepairGuard\?\.assertRows\(publicOffers/);
  assert.match(publisher,/technicalRepairGuard\?\.assertRows\(publishedOffers/);
  assert.match(publisher,/beforeManifestCommit\(\)\s*\{\s*await technicalRepairGuard\?\.verifyAuthority/);
  assert.match(publisher,/prepareStagedCatalogBudget/);assert.match(publisher,/technicalRepairGuard\.verifyPublished/);
});

// The three IDs reproduce the audited coverage gap; all vehicle data are synthetic.
const missingUaeIds = ['291f2b7703a3b68aa76253cd','8ca9a91f7d9653e1fe307d00','f8b2705e947357c174ba4b55'];
function preservedFixture(count = 4) {
  const f = fixture();
  const rows = Array.from({length:count}, (_,i) => ({id:missingUaeIds[i] || `uae-fixture-${i}`,
    market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:String(100000+i),make:'Toyota',model:'Prado',year:2024,
    status:'active',sourcePrice:80000+i,sourceCurrency:'AED',totalRub:2500000+i,sellerPriceRub:2500000+i,
    firstSeenAt:observedAt,updatedAt:observedAt,images:[{id:`photo-${i}`,url:`https://example.test/${i}.jpg`}],
    editorialSpecifications:{drive:'rwd'},savedCalculationPreview:{manualScenario:true,totalRub:3000000+i},
    operational:{sourceUrl:`https://www.dubicars.com/2024-toyota-prado-${100000+i}.html`,manualNotes:{text:'keep'},lastSeenAt:observedAt}}));
  const chunks = Array.from({length:Math.ceil(count/500)}, (_,i) => `chunk-${String(i+1).padStart(4,'0')}`);
  f.manifestMeta = meta({...f.manifestMeta.value,markets:{...f.manifestMeta.value.markets,uae:{count,chunks}}});
  const result = buildPaidEncarTechnicalRepair(f);
  const projectionKey = `catalog/generations/${generationId}/indexes/projection/uae.json`;
  const storage = memory({'catalog/manifest.json':f.manifestMeta.value,
    ...Object.fromEntries(Object.entries(f.protectedObjects).map(([key,value]:any)=>[key,value.value])),
    [snapshotRoot+'/complete.json']:f.snapshot,
    ...Object.fromEntries(chunks.map((chunk,i) => [`catalog/generations/${generationId}/offers/uae/${chunk}.json`,rows.slice(i*500,(i+1)*500)])),
    [projectionKey]:{generationId,items:rows.map(({id,market})=>({id,market}))}});
  return {...f,...result,storage,rows,projectionKey,chunks};
}
const publisherSource = fs.readFileSync(new URL('../scripts/catalog-publish-market.mjs',import.meta.url),'utf8');
const preservedStart = publisherSource.indexOf('async function loadPreservedMarkets() {');
const preservedEnd = publisherSource.indexOf('\nconst canonicalTargetPreview =',preservedStart);
assert.ok(preservedStart >= 0 && preservedEnd > preservedStart);
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const runPreservedLoader = new AsyncFunction('technicalRepairGuard','readMarketOffers','hasAllowedCatalogSourceProvenance',
  'isCatalogYearAllowed','isAllDubicarsOffer','hashRows', `
  const PUBLIC_CATALOG_MARKETS = ['korea','uae'], market = 'korea';
  const preservedByMarket = {}, preservedPublicHashByMarket = {}, preservedPublicRowsByMarket = {};
  const expectedPublishedByMarket = {}, expectedPublishedHashByMarket = {}, purgedForbiddenPublicByMarket = {};
  ${publisherSource.slice(preservedStart,preservedEnd)}
  await loadPreservedMarkets();
  return {preservedByMarket,preservedPublicHashByMarket,preservedPublicRowsByMarket};`);
async function loadPreservedForTest(f, legacy = async () => {throw Error('legacy_reader_forbidden');}, repair = true) {
  const guard = repair ? await createPaidRepairPublicationGuard({storage:f.storage,receipt:f.receipt,
    expectedSha256:f.receipt.sha256,readIdentity:async()=>liveIdentity,now:()=>now}) : null;
  return runPreservedLoader(guard,legacy,hasAllowedCatalogSourceProvenance,isCatalogYearAllowed,isAllDubicarsOffer,hashRows);
}

test('actual repair preservation reads all 25666 UAE IDs and keeps prices, dates, photos and manual values byte-stable', async () => {
  const f = preservedFixture(25666), before = hashRows(f.rows), snapshot = structuredClone(f.rows);
  const directory = await writeCatalogProjectionBatches({...f.storage,
    async writeJson(key:string,value:any) {f.storage.map.set(key,structuredClone(value));}} as any,
  f.projectionKey,generationId,[f.storage.map.get(f.projectionKey).items]);
  const read = f.storage.readJson.bind(f.storage);let active = 0, peak = 0, parts = 0;
  f.storage.readJson = async(key,fallback) => {
    assert.notEqual(key,f.projectionKey,'maintenance must not expand the whole projection root');
    if (!key.includes('/projection-parts/')) return read(key,fallback);
    active++;peak=Math.max(peak,active);parts++;
    try {return await read(key,fallback);} finally {active--;}
  };
  const loaded = await loadPreservedForTest(f);
  assert.equal(loaded.preservedByMarket.uae,25666);
  assert.equal(loaded.preservedPublicHashByMarket.uae,before);
  assert.deepEqual(loaded.preservedPublicRowsByMarket.uae,snapshot);
  for (const id of missingUaeIds) assert.ok(loaded.preservedPublicRowsByMarket.uae.some(row=>row.id===id));
  assert.equal(hashRows(f.rows),before,'read validation must not normalize or mutate preserved records');
  assert.equal(parts,directory.parts.length);assert.equal(peak,1,'only one verified projection part is retained at a time');
});

test('actual repair preservation stops missing chunks, incomplete or replaced IDs and generation drift before persistence', async () => {
  const chunkKey = `catalog/generations/${generationId}/offers/uae/chunk-0001.json`;
  const cases = [
    ['missing chunk',(f:any)=>f.storage.map.delete(chunkKey),/preserved_chunk_missing/],
    ['truncated chunk',(f:any)=>f.storage.map.get(chunkKey).pop(),/preserved_coverage_incomplete/],
    ['duplicate ID',(f:any)=>f.storage.map.get(chunkKey)[1].id=f.rows[0].id,/preserved_duplicate_id/],
    ['invalid ID',(f:any)=>f.storage.map.get(chunkKey)[1].id=' '+f.rows[1].id,/preserved_identity_invalid/],
    ['foreign market',(f:any)=>f.storage.map.get(chunkKey)[1].market='china',/preserved_identity_invalid/],
    ['replacement ID',(f:any)=>f.storage.map.get(chunkKey)[1].id='replacement-id',/preserved_projection_ids_changed/],
    ['projection absent',(f:any)=>f.storage.map.delete(f.projectionKey),/catalog_projection_missing/],
    ['projection count',(f:any)=>f.storage.map.get(f.projectionKey).items.pop(),/preserved_coverage_incomplete/],
    ['projection generation',(f:any)=>f.storage.map.get(f.projectionKey).generationId='gen_1_other',/preserved_projection_generation/],
  ] as const;
  for (const [label,mutate,error] of cases) {
    const f = preservedFixture(); mutate(f); let reachedPersistence = false;
    await assert.rejects(async()=>{await loadPreservedForTest(f);reachedPersistence=true;},error,label);
    assert.equal(reachedPersistence,false,label);
    assert.equal(f.storage.map.get('catalog/manifest.json').generationId,generationId,label);
  }
  const f = preservedFixture(), read = f.storage.readJson.bind(f.storage);
  f.storage.readJson = async(key,fallback) => {
    const value = await read(key,fallback);
    if (key === chunkKey) f.storage.map.set('catalog/manifest.json',{...f.manifestMeta.value,generationId:'gen_1_other'});
    return value;
  };
  await assert.rejects(loadPreservedForTest(f),/paid_repair_manifest_changed/);
  const liveBranch = publisherSource.slice(publisherSource.indexOf('await acquirePublishLock();'));
  assert.ok(liveBranch.indexOf('await technicalRepairGuard?.verifyAuthority') < liveBranch.indexOf('await loadPreservedMarkets();'));
  assert.ok(liveBranch.indexOf('await loadPreservedMarkets();') < liveBranch.indexOf('manifest = await persistCatalogOffers('));
});

test('repair respects explicit borrowed chunks, validates bounded partitions, and ordinary preservation keeps its existing reader', async () => {
  const f = preservedFixture(), manifest = structuredClone(f.manifestMeta.value);
  const key = `catalog/generations/${generationId}/offers/uae/chunk-0001.json`;
  const borrowed = 'catalog/generations/gen_1_previous/offers/uae/chunk-0001.json';
  f.storage.map.set(borrowed,structuredClone(f.rows)); manifest.markets.uae.chunks=[borrowed];
  assert.deepEqual(await readPaidRepairPreservedMarket(f.storage,manifest,'uae'),f.rows);
  for (const entry of [{count:4,chunks:[key,key]}, {count:4,chunks:[]}, {count:0,chunks:[key]},
    {count:4.5,chunks:[key]}, {count:-1,chunks:[]}, {count:500001,chunks:[key]}, {count:4,chunks:['catalog/manifest.json']}]) {
    await assert.rejects(readPaidRepairPreservedMarket(f.storage,{...manifest,markets:{uae:entry}},'uae'),/paid_repair_/);
  }
  assert.deepEqual(await readPaidRepairPreservedMarket(f.storage,{...manifest,markets:{uae:{count:0,chunks:[]}}},'uae'),[]);
  assert.deepEqual(await readPaidRepairPreservedMarket(f.storage,{...manifest,markets:{}},'uae'),[]);
  await assert.rejects(readPaidRepairPreservedMarket(f.storage,manifest,'uae/../../korea'),/preserved_market_invalid/);
  let reads = 0;
  const loaded = await loadPreservedForTest(f,async market=>{assert.equal(market,'uae');reads++;return f.rows;},false);
  assert.equal(reads,1);assert.deepEqual(loaded.preservedPublicRowsByMarket.uae,f.rows);
  assert.equal(loaded.preservedPublicHashByMarket.uae,hashRows(f.rows));
});
