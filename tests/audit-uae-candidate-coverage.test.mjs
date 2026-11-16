import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {analyzeCoverage, analyzeEditorialCoverage, health, inspectReferencedCards, installReadOnlyNetwork, forbidStorageWrites,
  allowedStorageKey, PINS, LIMITS} from '../scripts/audit-uae-candidate-coverage.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const projectionRow = id => ({id, market:'uae', year:2024, cardProjectionVersion:3,
  sourceGroup:'dubicars_uae_exact', sourcePrice:null, calculationStatus:'needs_data',
  catalogPricingMode:'seller', cardImageUrl:'https://DO_NOT_LOG_PHOTO',
  operational:{apiKey:'DO_NOT_LOG_KEY'}, vin:'DO_NOT_LOG_VIN'});
const budgetRow = (id,block=0) => ['uae',0,null,null,true,{id,block}];
const index = rows => ({version:3,generationId:PINS.generation,sourceRows:rows.length,rows:[],otherRows:rows});
const runtime = {prepareRows:rows => rows.map(row => ({...row,encyclopediaCalculation:{filledFields:['powerHp']},powerHp:150})),
  age:()=>({eligible:true}),excluded:()=>false,duplicate:()=>false,canRender:()=>true,allDubicars:()=>true,unpricedDubicars:()=>true};
function fixture() {
  return {manifest:{generationId:PINS.generation,markets:{uae:{count:3}}},
    projection:{generationId:PINS.generation,items:['a','b','c'].map(projectionRow)},
    selector:index([budgetRow('a')]),rootIndex:index([budgetRow('a'),budgetRow('b',8)]),runtime};
}

test('diagnosis retains the strict missing-ID failure and distinguishes root membership', () => {
  const result=analyzeCoverage(fixture());
  assert.equal(result.sourceCoveragePassed,false); assert.equal(result.missingCount,2);
  assert.equal(result.missingInRootCount,1); assert.equal(result.candidateEligibleRows,3);
  assert.deepEqual(result.missing.map(row=>[row.id,row.inRootIndex,row.rootBlock]),[['b',true,8],['c',false,null]]);
  assert.equal(result.missing[0].original.powerHp,null); assert.equal(result.missing[0].prepared.powerHp,150);
});
test('no missing eligible ID is converted into a passing result', () => {
  const f=fixture(); f.selector=f.rootIndex=index(['a','b','c'].map(id=>budgetRow(id)));
  const result=analyzeCoverage(f); assert.equal(result.sourceCoveragePassed,true); assert.deepEqual(result.missing,[]);
});
test('projection count generation identity and selector duplicates stay blocking', () => {
  for(const change of [f=>f.manifest.markets.uae.count++,f=>f.projection.generationId='wrong',
    f=>f.projection.items[1].id='a',f=>f.selector=index([budgetRow('a'),budgetRow('a')]),
    f=>f.selector=index([budgetRow('outside')]),f=>f.runtime={...runtime,prepareRows:()=>[{id:'outside'}]}]) {
    const f=fixture(); change(f); assert.throws(()=>analyzeCoverage(f),/uae_audit_/);
  }
});
test('safe flags redact source URLs private payloads and arbitrary field labels', () => {
  const f=fixture(); f.projection.items[1].sourceGroup='https://DO_NOT_LOG_SOURCE';
  f.runtime={...runtime,prepareRows:rows=>rows.map(row=>({...row,encyclopediaCalculation:{filledFields:['powerHp','DO_NOT_LOG_SECRET']}}))};
  const text=JSON.stringify(analyzeCoverage(f)); assert(!text.includes('DO_NOT_LOG')); assert(!text.includes('https://'));
});
test('referenced card blocks must contain the exact missing IDs; absent mappings stay unknown', async () => {
  const report=analyzeCoverage(fixture()),reads=[];
  const result=await inspectReferencedCards(report,async key=>{reads.push(key);return {generationId:PINS.generation,items:[projectionRow('b')]};});
  assert.equal(reads.length,1); assert.equal(result.exactIds,1);
  assert.deepEqual(report.missing.map(row=>row.cardMapping),['exact_id_found','no_root_index_mapping']);
  const other=analyzeCoverage(fixture());
  const wrong=await inspectReferencedCards(other,async()=>({generationId:PINS.generation,items:[projectionRow('a')]}));
  assert.equal(wrong.wrongMappingIds,1); assert.equal(other.missing[0].cardMapping,'referenced_block_missing_id');
});
test('card block bounds never fabricate a checked mapping', async () => {
  const f=fixture(); f.rootIndex=index([budgetRow('a'),budgetRow('b',8),budgetRow('c',9)]);
  const report=analyzeCoverage(f); let calls=0;
  const result=await inspectReferencedCards(report,async()=>{calls++;return {generationId:PINS.generation,items:[projectionRow('b')]};},{...LIMITS,cardBlocks:1});
  assert.equal(calls,1); assert.equal(result.complete,false); assert.equal(report.missing[1].cardMapping,'not_checked_within_bound');
});
test('private candidate binding matches the frozen observed binding digest', () => {
  assert.equal(hash({version:1,release:PINS.candidate,digest:PINS.encyclopedia,
    key:`knowledge/encyclopedia/calculation-indexes/${PINS.encyclopedia}.json`}),PINS.candidateBinding);
});
test('release-gate coverage stays distinct from pinned visitor editorial admission', async () => {
  let active=false;
  const f=fixture(), expected={revision:'editorial-v1',entries:{b:{id:'b',status:'hidden'}}};
  f.runtime={...runtime,prepareRows:rows=>runtime.prepareRows(rows).filter(row=>!active || row.id!=='b')};
  const editorial={withCatalogEditorial:async fn=>{active=true;try{return await fn();}finally{active=false;}},
    editorialRevision:()=>expected.revision,editorialEntries:()=>Object.values(expected.entries)};
  const gate=analyzeCoverage(f), visitor=await analyzeEditorialCoverage(f,editorial,expected);
  assert.deepEqual(gate.missing.map(row=>row.id),['b','c']);
  assert.deepEqual(visitor.missing.map(row=>row.id),['c']);
  assert.equal(gate.sourceCoveragePassed,false); assert.equal(visitor.sourceCoveragePassed,false);
  await assert.rejects(analyzeEditorialCoverage(f,editorial,{...expected,revision:'changed'}),/editorial_context_changed/);
});
test('health requires ok true as well as the exact retained source and calculator', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({ok:false,releaseSha:PINS.live,calculationVersion:PINS.liveCalculator});
    await assert.rejects(health(),/live_identity_changed/);
    globalThis.fetch=async()=>Response.json({ok:true,releaseSha:PINS.live,calculationVersion:PINS.liveCalculator});
    assert.deepEqual(await health(),{releaseSha:PINS.live,calculationVersion:PINS.liveCalculator});
  }finally{globalThis.fetch=original;}
});
test('read namespace permits UAE sources only and rejects private unrelated or other-generation paths', () => {
  const base=`catalog/generations/${PINS.generation}/indexes/`;
  for(const key of [base+'budget-count-v3.json',base+'budget-markets-v3/uae.json',base+'projection/uae.json',base+'budget-cards-v3/8.json','catalog-editorial/current.json'])assert(allowedStorageKey(key));
  for(const key of ['settings/site-business.json',base+'projection/korea.json',base+'budget-markets-v3/korea.json',
    base+'budget-cards-v3/../secret.json',base.replace(PINS.generation,'gen_123_other')+'projection/uae.json'])assert(!allowedStorageKey(key));
});
test('transport blocks mutations, other buckets, search, suppliers, rates, query strings and redirects', async () => {
  const calls=[];const fence=installReadOnlyNetwork(async(url,options)=>{calls.push({url,options});return new Response('{}');});
  try {
    const good='https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/catalog/manifest.json';
    await (await fetch(good)).text(); assert.equal(calls[0].options.redirect,'error');
    for(const [url,method]of [[good,'PUT'],[good,'DELETE'],[good+'?list-type=2','GET'],
      [good.replace('avtocena-staging-8120751','other'),'GET'],['https://supplier.invalid/offers','GET'],
      ['https://www.cbr.ru/scripts/XML_daily.asp','GET'],['https://avtocena.com/api/catalog/search','GET']])
      await assert.rejects(fetch(url,{method}),/network_forbidden/);
    assert.equal(calls.length,1);
  }finally{fence.restore();}
});
test('streamed response byte and request budgets are enforced', async () => {
  const fence=installReadOnlyNetwork(async()=>new Response('123456'),{limits:{...LIMITS,totalBytes:5,requests:1}});
  try {
    await assert.rejects((await fetch('https://avtocena.com/api/health')).text(),/byte_budget/);
    await assert.rejects(fetch('https://avtocena.com/api/health'),/request_budget/);
  }finally{fence.restore();}
});
test('all storage mutation and bucket-list interfaces are blocked', async () => {
  const storage={writeJson:async()=>{},putBinary:async()=>{},deleteObjects:async()=>{},listObjects:async()=>{}};
  forbidStorageWrites(storage);
  for(const fn of Object.values(storage))await assert.rejects(fn(),/storage_mutation_forbidden/);
});
