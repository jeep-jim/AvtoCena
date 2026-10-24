import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {auditRetainedReferences,ROOT} from '../scripts/encyclopedia/audit-retained-references.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const row=(id,patch={})=>({url:`https://www.drom.ru/catalog/suzuki/alto/${id}/`,verification:'unverified_reference',period:'12.2021 - 12.2023',facts:{'Тип привода':'Передний','Марка кузова':'HA37S','Максимальная мощность, л.с.':'46'},...patch});
function store(rows){const map=new Map(rows.map(r=>[`${ROOT}/records/${hash(r.url)}.json`,r]));const checkpoint={saved:rows.length,visited:[],pending:['unchanged'],failed:[{at:'2026-10-22',message:'redirect_outside_catalog'}]};return {map,checkpoint,listObjects:async()=>[...map.keys()].map(key=>({key})),readJson:async k=>k.endsWith('/state.json')?checkpoint:map.get(k),writeJson:async()=>assert.fail('write forbidden')};}
test('groups existing retained rows without exporting facts or promoting peak power',async()=>{const s=store([row(1),row(2),row(3,{period:'2024 - настоящее время'})]);const before=JSON.stringify([...s.map]);const r=await auditRetainedReferences(s);assert.equal(r.recordsRead,3);assert.equal(r.eligiblePeriods,2);assert.equal(r.unknownOrInvalidPeriods,1);assert.equal(r.groups[0].chassisYearGroups,1);assert.equal(r.fieldPresence.power,3);assert.equal(r.fieldPresence.power30,undefined);assert.equal(r.verifiedFieldsAdded,0);assert.equal(r.storageWrites,0);assert.equal(r.supplierRequests,0);assert.equal(JSON.stringify([...s.map]),before);assert.equal(JSON.stringify(r).includes('HA37S'),false);assert.equal(r.checkpoint.failures[0].category,'redirect_outside_catalog');});
test('a changed checkpoint refuses a stable inventory claim',async()=>{const s=store([row(1)]);let n=0;const read=s.readJson;s.readJson=async k=>k.endsWith('/state.json')?{...s.checkpoint,saved:++n}:read(k);await assert.rejects(auditRetainedReferences(s),/checkpoint_changed/);});
test('object key is bound to source URL and cannot attest a substituted source',async()=>{const s=store([row(1)]);s.map.values().next().value.url='https://example.com/catalog/suzuki/alto/1/';await assert.rejects(auditRetainedReferences(s),/source_identity_mismatch/);});
test('unknown periods and missing records stay explicit',async()=>{const s=store([row(1,{period:'unknown'})]);const r=await auditRetainedReferences(s);assert.equal(r.eligiblePeriods,0);assert.equal(r.groups[0].chassisYearGroups,0);s.map.set([...s.map.keys()][0],null);await assert.rejects(auditRetainedReferences(s),/record_missing/);});
test('charging power is not motor power and transmission uses the actual retained label',async()=>{const s=store([row(1,{facts:{'Максимальная мощность быстрой зарядки, кВт':'120','Тип трансмиссии':'АКПП','Объем двигателя, куб.см':'1498','Марка двигателя':'DADA','Объем топливного бака, л':'50'}})]);const r=await auditRetainedReferences(s);assert.equal(r.fieldPresence.power,undefined);assert.equal(r.fieldPresence.fuel,undefined);assert.equal(r.fieldPresence.transmission,1);assert.equal(r.fieldPresence.engineCc,1);assert.equal(r.fieldPresence.engineCode,1);});

test('bounded review retains facts and provenance only for explicit year/group, never promotes evidence',async()=>{
 const s=store(Array.from({length:70},(_,i)=>row(i,{sourceKind:'technical_reference',retrievedAt:'2026-10-22',facts:{'Максимальная мощность, л.с.':'46','Описание':'excluded','Фото':'excluded'}})));
 const review={groups:['suzuki/alto'],year:2022};const r=await auditRetainedReferences(s,{review});
 assert.equal(r.review.rows.length,64);assert.equal(r.review.remainingAfterPage,6);assert.equal(r.verifiedFieldsAdded,0);
 assert.equal(r.review.rows[0].verification,'unverified_reference');assert.equal(r.review.rows[0].facts['Описание'],undefined);assert.equal(r.review.rows[0].facts['Фото'],undefined);
 assert.equal(r.review.rows[0].facts['Максимальная мощность, л.с.'],'46');
 const page2=await auditRetainedReferences(s,{review:{...review,afterDigest:r.review.nextAfterDigest}});
 assert.equal(page2.review.rows.length,6);assert.equal(page2.review.remainingAfterPage,0);
 assert.equal(new Set([...r.review.rows,...page2.review.rows].map(r=>r.recordDigest)).size,70);
});
test('review refuses invalid scopes and excludes open periods and other groups',async()=>{
 const s=store([row(1,{period:'2024 - настоящее время'}),row(2)]);
 for(const review of [{groups:[],year:2022},{groups:['../alto'],year:2022},{groups:['suzuki/alto'],year:2007},{groups:['suzuki/alto'],year:2022,afterDigest:'bad'}])await assert.rejects(auditRetainedReferences(s,{review}),/invalid_reference_review_scope/);
 assert.equal((await auditRetainedReferences(s,{review:{groups:['suzuki/alto'],year:2024}})).review.rows.length,0);
 assert.equal((await auditRetainedReferences(s,{review:{groups:['audi/a3'],year:2022}})).review.rows.length,0);
});
test('review refuses oversized facts and still detects checkpoint races',async()=>{
 const s=store([row(1,{facts:{'Тип привода':'x'.repeat(501)}})]);
 await assert.rejects(auditRetainedReferences(s,{review:{groups:['suzuki/alto'],year:2022}}),/invalid_reference_fact_size/);
});
