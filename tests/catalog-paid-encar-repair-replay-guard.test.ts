import test from 'node:test';
import assert from 'node:assert/strict';
import {EncarDirectAdapter} from '../apps/web/lib/catalog/adapters';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {normalizePaidEncarOffer} from '../scripts/lib/paid-encar-offer.mjs';
import {paidEncarSavedPageVerifier} from '../scripts/catalog-paid-encar-intake.mjs';
import {PAID_ENCAR_REPAIR_SNAPSHOT, PAID_ENCAR_REPAIR_PROTECTED_KEYS, paidRepairDigest,
  paidRepairObjectRevision, mergePaidEncarTechnicalCorrection, buildPaidEncarTechnicalRepair,
  assertPaidRepairPublicationRows} from '../scripts/lib/paid-encar-technical-repair.mjs';
import {loadPaidRepairPlan} from '../scripts/lib/paid-encar-repair-io.mjs';

// All listing and certificate data in this file are synthetic offline fixtures.
const observedAt = '2026-11-14T12:55:40.904Z', now = Date.parse('2026-11-16T11:00:00Z');
const adapter = new EncarDirectAdapter(), generationId = 'gen_1794665184205_cfd76b47';
const sourceSha = 'a'.repeat(40), controllerSha = 'b'.repeat(40);
const liveIdentity = {release:'c'.repeat(40), calculationVersion:'d'.repeat(64)};
const snapshotRoot = `catalog/intake-staging/encar/${PAID_ENCAR_REPAIR_SNAPSHOT.runId}/${PAID_ENCAR_REPAIR_SNAPSHOT.attempt}`;
const raw = (inner_id = '54000001') => ({inner_id,mark:'Kia',model:'Niro',configuration:'Hybrid',year:2024,
  engine_type:'Гибрид',displacement_cc:1580,power:141,power_ice_hp:105,power_electro_kw:32,drive_type:'2WD',
  price:12000000,currency:'KRW',advertisement_type:'Продажа',sales_status:'Доступно'});
const meta = (value: any) => ({found:value !== null,value,etag:value === null ? undefined : paidRepairDigest(value)});
function mapped(data = raw()) {
  const offer = normalizePaidEncarOffer(data,{id:data.inner_id,observedAt,adapter});
  offer.updatedAt = observedAt; offer.operational.lastSeenAt = observedAt;
  return offer;
}
function fixture() {
  const incoming = mapped(), current = structuredClone(incoming);
  for (const field of ['fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','motorPeakKw',
    'powerDataConfidence','powerDataSource','power30MinKw','power30MinKwByMotor','utilizationPowerKw']) delete current[field];
  current.operational.semanticEvidence = {}; current.drive = 'fwd'; current.sourcePrice = 13500000;
  const editorial = {revision:'fixture',entries:{}};
  const protectedObjects = Object.fromEntries(PAID_ENCAR_REPAIR_PROTECTED_KEYS.map(key =>
    [key,meta(key === 'catalog-editorial/current.json' ? editorial : {})]));
  const snapshot = {pages:1,count:1,completedAt:observedAt};
  return {currentRows:[current],sourceById:new Map([[incoming.id,incoming]]),editorial,protectedObjects,
    manifestMeta:meta({version:2,generationId,markets:{korea:{provider:'auto_api_encar',count:1,chunks:['chunk-0001']}}}),
    sourceProof:{identity:PAID_ENCAR_REPAIR_SNAPSHOT,snapshotSha256:paidRepairDigest(snapshot),
      snapshotRevision:paidRepairObjectRevision(meta(snapshot)),pagesSha256:'e'.repeat(64),rows:1,pages:1,observedAt},
    sourceSha,controllerSha,liveIdentity,now};
}

test('repair refuses undocumented 30-minute power inferred from preserved current trim or raw fields', () => {
  for (const fromRaw of [false,true]) {
    const f = fixture(), current = f.currentRows[0], incoming = f.sourceById.get(current.id);
    if (fromRaw) current.operational.raw = {power30MinKwByMotor:[20,30]};
    else current.trim = 'Hybrid 30 min 50 kW';
    const before = structuredClone(current), sourceBefore = structuredClone(incoming);
    assert.equal(incoming.power30MinKw,undefined, 'the final v3 mapper accepted a source without certified power');
    const merged = mergePaidEncarTechnicalCorrection(current,incoming,{observedAt,editorial:f.editorial});
    assert.equal(normalizeVehicleOfferSpecs(merged.offer).power30MinKw,50, 'exercise the actual previously unsafe replay');
    assert.throws(() => buildPaidEncarTechnicalRepair(f),/^AssertionError.*paid_repair_undocumented_30_min_power/);
    assert.deepEqual(current,before); assert.deepEqual(incoming,sourceBefore);
  }
});

test('the replay guard also covers unchanged missing-source and newer-observation branches', () => {
  for (const reason of ['missing','newer']) {
    const f = fixture(); f.currentRows[0].trim = 'Hybrid 30 min 50 kW';
    if (reason === 'missing') f.sourceById.clear();
    else f.currentRows[0].operational.lastSeenAt = '2026-11-15T12:55:40.904Z';
    assert.throws(() => buildPaidEncarTechnicalRepair(f),/paid_repair_undocumented_30_min_power/);
  }
});

test('explicit documented or encyclopedia 44 kW survives without changing its stored shape or provenance', () => {
  for (const power of [{power30MinKw:44}, {power30MinKwByMotor:[20,24]}, {power30MinKw:44,power30MinKwByMotor:[20,24]}]) {
    const f = fixture(), current = mapped();
    Object.assign(current,power,{powerDataConfidence:'documented',powerDataSource:'owner_document:offline_fixture',
      trim:'Hybrid 30 min 50 kW',savedCalculationPreview:{manualScenario:true}});
    current.operational.semanticEvidence.certifiedPower = {status:'exact',source:'owner_document:offline_fixture',value:44,unit:'kW'};
    current.encyclopediaCalculation = {version:1,indexDigest:'f'.repeat(64),sourceIdentity:'offline_fixture',
      values:{power30MinKw:44},filledFields:['power30MinKw']};
    const before = structuredClone(current); f.currentRows = [current];
    const result = buildPaidEncarTechnicalRepair(f), kept = result.offers[0];
    assert.equal(normalizeVehicleOfferSpecs(kept).power30MinKw,44, 'explicit power wins over unrelated retained text');
    for (const field of ['power30MinKw','power30MinKwByMotor','powerDataConfidence','powerDataSource',
      'encyclopediaCalculation','savedCalculationPreview','trim']) assert.deepEqual(kept[field],before[field],field);
    assert.deepEqual(kept.operational.semanticEvidence.certifiedPower,before.operational.semanticEvidence.certifiedPower);
    assert.deepEqual(current,before, 'the probe does not mutate the existing record');
    assertPaidRepairPublicationRows(result.receipt,result.offers,f.editorial,{input:true});
  }
});

test('ordinary hybrid repair still succeeds with unknown certified power', () => {
  const f = fixture(), result = buildPaidEncarTechnicalRepair(f);
  assert.equal(result.offers[0].power30MinKw,undefined);
  assert.equal(result.offers[0].power30MinKwByMotor,undefined);
  assert.equal(result.offers[0].sourcePrice,13500000);
  assertPaidRepairPublicationRows(result.receipt,result.offers,f.editorial,{input:true});
});

test('saved loader accepts 10270 pages under the bounded repair contract and retains its hard cap', async () => {
  const f = fixture(), snapshot = {pages:10270,count:10270,completedAt:observedAt};
  const reportRoot = `catalog/paid-encar-reports/v1/${Date.parse(observedAt)}`;
  const values = new Map<string, any>([
    ['catalog/manifest.json',f.manifestMeta.value],
    ...Object.entries(f.protectedObjects).map(([key,value]:any) => [key,value.value] as [string,any]),
    [`catalog/generations/${generationId}/offers/korea/chunk-0001.json`,f.currentRows],
    [snapshotRoot + '/complete.json',snapshot],
    [reportRoot + '/complete.json',{version:1,provider:'auto_api_encar',observedAt,observedAtMs:Date.parse(observedAt),
      sourceRunId:PAID_ENCAR_REPAIR_SNAPSHOT.runId,sourceRunAttempt:PAID_ENCAR_REPAIR_SNAPSHOT.attempt}],
  ]);
  let pagesRead = 0;
  const storage = {driver:'object',async readJson(key:string,fallback:any) {
    if (key.startsWith(snapshotRoot + '/pages/')) {
      pagesRead++; const id = key.endsWith('/1.json') ? '54000001' : '99999999';
      return [{inner_id:id,data:raw(id)}];
    }
    return structuredClone(values.has(key) ? values.get(key) : fallback);
  },async readJsonWithMeta(key:string,fallback:any) {return meta(await this.readJson(key,fallback));},
  async writeJson() {throw Error('unexpected_write');}};
  const options = {storage,sourceSha,controllerSha,liveIdentity,now,
    producer:{id:PAID_ENCAR_REPAIR_SNAPSHOT.runId,run_attempt:1,head_sha:PAID_ENCAR_REPAIR_SNAPSHOT.producerSha,status:'completed'},
    verifyPages:paidEncarSavedPageVerifier,isNonCash:()=>false,normalize:(data:any)=>mapped(data)};
  const result = await loadPaidRepairPlan(options);
  assert.equal(pagesRead,10270); assert.equal(result.receipt.core.sourceProof.pages,10270);
  assert.equal(result.receipt.core.sourceProof.rows,10270); assert.equal(result.receipt.core.sourceProof.matched,1);
  assert.equal(result.offers.length,1, 'the large snapshot cannot add absent current identities');
  values.set(snapshotRoot + '/complete.json',{...snapshot,pages:20001,count:20001});
  await assert.rejects(loadPaidRepairPlan(options),/paid_repair_saved_snapshot_invalid/);
  assert.equal(pagesRead,10270, 'an oversized header is rejected before reading any page');
});
