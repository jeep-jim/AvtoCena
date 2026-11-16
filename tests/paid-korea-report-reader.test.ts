import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPaidKoreaReportReader} from '../apps/web/app/api/catalog/korea-report/paid-report-reader';
import {koreaHistoryIdentity} from '../apps/web/app/(public)/cars/offer/[id]/history-identity';

const lot='42196907';
const id=createHash('sha256').update(`encar_direct:${lot}`).digest('hex').slice(0,24);
const observedAt='2026-11-15T05:00:00.000Z',observedAtMs=Date.parse(observedAt);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(depth:2|3=2) {
  const prefix=id.slice(0,depth),root=`catalog/paid-encar-reports/v1/${observedAtMs}`;
  const offer:any={id,market:'korea',sourceId:'encar_direct',sourceOfferId:lot,
    updatedAt:'2026-11-16T08:00:00.000Z',operational:{provider:'auto_api_encar',lastSeenAt:observedAt}};
  const history={report_date:'2026-11-14',own_damage_count:4,own_damage_cost_won:3085736,
    other_damage_count:2,other_damage_cost_won:5404724,flood_partial_loss_count:null};
  const rows:any={history:[{offerId:id,sourceOfferId:lot,history}],
    inspection:[{offerId:id,sourceOfferId:lot,inspection:{accident:false,simple_repair:true},diagnosis:null}]};
  const complete:any={version:1,provider:'auto_api_encar',observedAt,observedAtMs,
    sourceRunId:'43570782014',sourceRunAttempt:'1',bucketPrefixLength:depth,rowCount:1,
    history:{[prefix]:{count:1,sha256:digest(rows.history)}},
    inspection:{[prefix]:{count:1,sha256:digest(rows.inspection)}}};
  const buckets:any=Object.fromEntries(['history','inspection'].map(kind=>[kind,
    {version:1,provider:'auto_api_encar',observedAt,observedAtMs,kind,prefix,rows:rows[kind]}]));
  let published:any={generationId:'current-fixture',markets:{korea:{provider:'auto_api_encar',count:1}}};
  let cached='current-fixture',controls:any={markets:{korea:{enabled:true}},sources:{encar_feed:{enabled:true}}};
  let controlReads=0,offerReads=0,generationReads=0;
  const reads:string[]=[];
  const objects=new Map<string,unknown>([[`${root}/complete.json`,complete],
    ...['history','inspection'].map(kind=>[`${root}/${kind}/${prefix}.json`,buckets[kind]] as [string,unknown])]);
  const deps={readJson:async(key:string)=>{reads.push(key);return key==='catalog/manifest.json'?published:objects.get(key)??null;},
    readOffer:async()=>{offerReads++;return offer;},readGeneration:async()=>{generationReads++;return cached;},
    readControls:async()=>{controlReads++;return controls;}};
  return {offer,history,rows,complete,buckets,root,prefix,reads,objects,deps,
    read:createPaidKoreaReportReader(deps),input:{offerId:id,lot,kind:'history' as const},
    setPublished:(value:any)=>{published=value;},setCached:(value:string)=>{cached=value;},
    setControls:(value:any)=>{controls=value;},counters:()=>({controlReads,offerReads,generationReads}),
    rehash:(kind:'history'|'inspection')=>{complete[kind][prefix]={count:buckets[kind].rows.length,sha256:digest(buckets[kind].rows)};}};
}

test('paid history reads only the exact saved observation and keeps real counts, money and unknowns',async()=>{
  for(const depth of [2,3] as const){
    const f=fixture(depth),report:any=await f.read(f.input);
    assert.equal(report.version,3);assert.equal(report.provider,'auto_api_encar');
    assert.equal(report.offerId,id);assert.equal(report.lot,lot);assert.equal(report.observedAt,observedAt);
    assert.equal(report.history.own_damage_count,4);assert.equal(report.history.own_damage_cost_won,3085736);
    assert.equal(report.history.other_damage_count,2);assert.equal(report.history.other_damage_cost_won,5404724);
    assert.equal(report.history.flood_partial_loss_count,null);
    assert.deepEqual(f.reads.filter(key=>key!=='catalog/manifest.json'),
      [`${f.root}/complete.json`,`${f.root}/history/${f.prefix}.json`]);
    assert.equal(f.counters().controlReads,2);assert.equal(f.counters().offerReads,1);
  }
});

test('inspection reads its independent bucket and does not fabricate unavailable diagnosis',async()=>{
  const f=fixture(),report:any=await f.read({...f.input,kind:'inspection'});
  assert.equal(report.kind,'inspection');assert.equal(report.inspection.accident,false);
  assert.equal(report.inspection.simple_repair,true);assert.equal(report.diagnosis,null);
  assert.ok(!f.reads.some(key=>key.includes('/history/')));
  f.rows.history[0].history=null;f.rehash('history');
  const missing:any=await f.read(f.input);assert.equal(missing.history,null);
});

test('invalid or malicious request identity rejects before any source or storage access',async()=>{
  for(const change of [{offerId:'../catalog/manifest.json'},{offerId:'ajes-korea-fixture'},
    {offerId:id.toUpperCase()},{lot:'123456?api_key=secret'},{lot:'../123456'},{kind:'changes'}]){
    const f=fixture();await assert.rejects(f.read({...f.input,...change} as any),/paid_korea_report_input/);
    assert.deepEqual(f.reads,[]);assert.deepEqual(f.counters(),{controlReads:0,offerReads:0,generationReads:0});
  }
});

test('paid and market switches are checked before lookup and again before returning the report',async()=>{
  for(const controls of [{markets:{korea:{enabled:false}},sources:{encar_feed:{enabled:true}}},
    {markets:{korea:{enabled:true}},sources:{encar_feed:{enabled:false}}}]){
    const f=fixture();f.setControls(controls);
    await assert.rejects(f.read(f.input),/paid_korea_report_disabled/);assert.deepEqual(f.reads,[]);
  }
  const f=fixture(),read=f.deps.readJson;
  f.deps.readJson=async key=>{const value=await read(key);if(key.includes('/history/'))f.setControls({});return value;};
  await assert.rejects(createPaidKoreaReportReader(f.deps)(f.input),/paid_korea_report_disabled/);
});

test('the trusted current offer must identify the same paid Encar vehicle',async()=>{
  for(const change of [{market:'china'},{sourceId:'ajes_korea_feed'},{sourceOfferId:'42196908'},
    {id:'b'.repeat(24)},{operational:{provider:'parser',lastSeenAt:observedAt}}]){
    const f=fixture();Object.assign(f.offer,change);
    await assert.rejects(f.read(f.input),/paid_korea_report_not_found/);
    assert.ok(!f.reads.some(key=>key.startsWith('catalog/paid-encar-reports/')));
  }
  const f=fixture();f.deps.readOffer=async()=>null;
  await assert.rejects(createPaidKoreaReportReader(f.deps)(f.input),/paid_korea_report_not_found/);
});

test('a current-generation mismatch fails closed before or after a saved report read',async()=>{
  const before=fixture();before.setCached('older-generation');
  await assert.rejects(before.read(before.input),/paid_korea_report_changed/);assert.equal(before.counters().offerReads,0);
  const after=fixture(),read=after.deps.readJson;
  after.deps.readJson=async key=>{const value=await read(key);if(key.includes('/history/'))
    after.setPublished({generationId:'new-generation',markets:{korea:{provider:'auto_api_encar',count:1}}});return value;};
  await assert.rejects(createPaidKoreaReportReader(after.deps)(after.input),/paid_korea_report_changed/);
  const provider=fixture();provider.setPublished({generationId:'current-fixture',markets:{korea:{provider:'parser',count:1}}});
  await assert.rejects(provider.read(provider.input),/paid_korea_report_changed/);
});

test('complete receipt is required and must bind the exact observation, count and source identity',async()=>{
  const absent=fixture();absent.objects.delete(`${absent.root}/complete.json`);
  await assert.rejects(absent.read(absent.input),/paid_korea_report_snapshot_missing/);
  for(const change of [{version:2},{provider:'other'},{observedAt:'2026-11-14T05:00:00.000Z'},
    {observedAtMs:observedAtMs+1},{sourceRunId:'0'},{sourceRunAttempt:'01'},
    {bucketPrefixLength:4},{rowCount:2},{history:{}}]){
    const f=fixture();Object.assign(f.complete,change);
    await assert.rejects(f.read(f.input),/paid_korea_report_snapshot_invalid/);
  }
  const bound=fixture();bound.offer.operational.paidEncarReportSnapshot={run:'43570782014',attempt:'1',observedAt};
  await bound.read(bound.input);
  bound.offer.operational.paidEncarReportSnapshot.attempt='2';
  await assert.rejects(bound.read(bound.input),/paid_korea_report_snapshot_invalid/);
});

test('saved bucket digest, metadata, identities and schema cannot silently substitute another report',async()=>{
  for(const change of [{kind:'inspection'},{prefix:'ff'},{observedAtMs:observedAtMs+1},
    {observedAt:'2026-11-14T05:00:00.000Z'},{provider:'other'},{rows:[]}]){
    const f=fixture();Object.assign(f.buckets.history,change);
    await assert.rejects(f.read(f.input),/paid_korea_report_snapshot_invalid/);
  }
  const altered=fixture();altered.rows.history[0].history.own_damage_count=0;
  await assert.rejects(altered.read(altered.input),/paid_korea_report_snapshot_invalid/);
  for(const change of [{offerId:'f'.repeat(24)},{sourceOfferId:'42196908'},{history:[]},{history:undefined}]){
    const f=fixture();Object.assign(f.rows.history[0],change);f.rehash('history');
    await assert.rejects(f.read(f.input),/paid_korea_report_snapshot_invalid/);
  }
  const oversized=fixture();oversized.rows.history[0].history.extra='x'.repeat(4*1024*1024);oversized.rehash('history');
  await assert.rejects(oversized.read(oversized.input),/paid_korea_report_snapshot_invalid/);
});

test('the existing button uses sourceOfferId for paid cards and preserves the AJ identity path',()=>{
  const f=fixture();assert.equal(f.offer.lotNumber,undefined);
  assert.deepEqual(koreaHistoryIdentity(f.offer,id,false),{offerId:id,lot});
  assert.equal(koreaHistoryIdentity(f.offer,id,true),undefined);
  assert.equal(koreaHistoryIdentity({...f.offer,operational:{provider:'parser'}},id,false),undefined);
  assert.equal(koreaHistoryIdentity({...f.offer,sourceOfferId:'../../other'},id,false),undefined);
  assert.deepEqual(koreaHistoryIdentity({market:'korea',sourceId:'ajes_korea_feed',lotNumber:lot},'ajes-korea-fixture',false),
    {offerId:'ajes-korea-fixture',lot});
  assert.equal(koreaHistoryIdentity({...f.offer,market:'china'},id,false),undefined);
});
