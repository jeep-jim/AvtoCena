import './helpers/server-only-hook.mjs';
import 'next/dist/server/node-environment-baseline';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getDataRoot,getJsonStorage} from '../apps/web/lib/data';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
import {captureCatalogFxBatch,resetCatalogRateCache,withCatalogFxBatch} from '../apps/web/lib/catalog/rates';
import {resetChinaCnyPriceCache} from '../apps/web/lib/catalog/china-cny-price';
import {resetCatalogEditorialCache} from '../apps/web/lib/catalog/editorial';
import {budgetPricingFingerprint} from '../apps/web/lib/catalog/shared-budget-prices';
import {preparedPriceCardDigest,preparedPriceCardMarketDigest,verifyPriceCardBlock} from '../apps/web/lib/catalog/prepared-price-card-block';
import {preparedCoverageIdsDigest,streamChinaPriceCoverage,type PreparedPriceCoverageContext,type PreparedPriceExpectedBlock} from '../apps/web/lib/catalog/prepared-price-coverage';
import type {PrivatePriceSealAuthority} from '../apps/web/lib/catalog/prepared-price-private-seal';
import {preparedChinaNativePartPath,stagePreparedChinaArtifacts} from '../apps/web/lib/catalog/prepared-china-fixture-activation';
import {resetPreparedChinaFilterIndexCacheForTests,selectPreparedChinaFilterPage,type PreparedChinaFilterEntry} from '../apps/web/lib/catalog/prepared-china-filter-index';
import {offerPath,orderPreparedChinaCompatibilityRows,type CatalogPreparedChinaManifest,type CatalogSearchProjection} from '../apps/web/lib/catalog/storage';
import {calculateRussiaCustomsForIndividual,type RussiaCustomsV2Input} from '../packages/engine/src/calculation/russiaCustomsV2';
import type {VehicleOffer} from '../apps/web/lib/catalog/types';

const asOf=Date.parse('2026-11-20T23:59:59Z'),generationId='gen_1790001000000_producerqa';
const json=(value:unknown)=>Buffer.from(JSON.stringify(value));
const hash=(body:Buffer)=>createHash('sha256').update(body).digest('hex');
type StageInput=Parameters<typeof stagePreparedChinaArtifacts>[0];
type SealedPart=Parameters<Parameters<StageInput['verifyParts']>[0]>[0];
type CoverageEvent=Parameters<PreparedPriceCoverageContext['emit']>[0];

function nativeOffer(index:number):VehicleOffer{
 const id='producer-'+String(index).padStart(4,'0'),powerHp=[120,160,161,300][index%4],powerKw=powerHp/1.35962;
 const customsInput:RussiaCustomsV2Input={customsValueRub:1_250_000,eurRateRub:95,engineCc:1498,powerHp,
  powerKw,icePowerKw:powerKw,utilizationPowerKw:powerKw,powertrainKind:'combustion',fuel:'petrol',vehicleCategory:'M1',
  productionDate:'2022-01-01',importedAt:new Date(asOf)};
 return {id,market:'china',sourceId:'autohome_used_china_open',sourceOfferId:id,status:'active',offerType:'fixed',
  make:'Fixture',model:'Producer',year:2022,productionDate:'2022-01-01',engineCc:1498,powerHp,powerKw,
  icePowerKw:powerKw,utilizationPowerKw:powerKw,powertrainKind:'combustion',fuel:'petrol',bodyType:'suv',
  powerDataSource:'fixture:named_ice_kw',sourcePrice:100000,sourceCurrency:'CNY',priceMode:'fixed',
  chinaPriceConversion:{sourceCurrency:'USD',sourcePrice:1_250_000/85,sourcePriceCny:100000,usdRub:85,cnyRub:12.5,rateDate:'2026-11-20'},
  operational:{sourceUrl:'https://global.che168.com/fixture/'+id,
   semanticEvidence:Object.fromEntries(Object.entries({powerHp,powerKw,engineCc:1498,fuel:'petrol',powertrainKind:'combustion'})
    .map(([key,value])=>[key,{status:'exact',value,source:'fixture-exact'}]))},
  images:[{id:'photo-'+id,url:'https://assets.fixture.test/photo.jpg'}],totalRub:2_000_000,calculationStatus:'ready',
  firstSeenAt:new Date(asOf-index*1000).toISOString(),updatedAt:new Date(asOf-index*1000).toISOString(),
  calculationSnapshot:{customsInput,customs:calculateRussiaCustomsForIndividual(customsInput),sourcePriceRub:1_250_000,
   priceIncludesAllCustoms:true,priceIncludesUtilizationFee:true,missing:[]}} as unknown as VehicleOffer;
}

test('actual streaming China producer seals a complete compact power index into its prepared directory',async t=>{
 t.mock.timers.enable({apis:['Date'],now:asOf});
 const priorEnv={rate:process.env.CATALOG_LIVE_RATE_DISABLED,calculation:process.env.AVTOCENA_CALCULATION_VERSION};
 const priorFetch=globalThis.fetch,db=getJsonStorage();
 const priorStorage={readJsonWithMeta:db.readJsonWithMeta,readJson:db.readJson,writeJson:db.writeJson};
 globalThis.fetch=async()=>{throw Error('producer_fixture_network_forbidden');};
 process.env.CATALOG_LIVE_RATE_DISABLED='1';process.env.AVTOCENA_CALCULATION_VERSION='a'.repeat(64);
 db.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  if(key==='fees/exchange-rates.json')return {found:true,value:{rates:[['CNY',12.5],['USD',85],['EUR',95]].map(([currency,cbrRate])=>
   ({currency,cbrRate,nominal:1,rateDate:'2026-11-20',rateSource:'cbr'}))} as T};
  assert.ok(['markets/markets.json','catalog-editorial/current.json','catalog/china-cny-prices/current.json'].includes(key),key);
  return {found:false,value:fallback};
 };
 db.readJson=async<T>(key:string,fallback:T)=>(await db.readJsonWithMeta(key,fallback)).value;
 db.writeJson=async()=>assert.fail('the source preparation fixture must not write mutable storage');
 try{
  resetCatalogRateCache();resetChinaCnyPriceCache();resetCatalogEditorialCache();invalidateEffectiveMarketsCache();
  const native=Array.from({length:501},(_,i)=>nativeOffer(i));
  const candidate:CatalogPreparedChinaManifest={version:2,generationId,updatedAt:new Date(asOf).toISOString(),
   markets:{china:{count:native.length,chunks:['chunk-0001','chunk-0002'],updatedAt:new Date(asOf).toISOString()}}};
  const base={...candidate,generationId:'gen_1790000000000_baseqa'};
  const fx=await captureCatalogFxBatch('china',['CNY']);
  const pricingFingerprint=await withCatalogFxBatch(fx,()=>budgetPricingFingerprint('china'));assert.ok(pricingFingerprint);
  const expected:PreparedPriceExpectedBlock[]=[],inputs=new Map<string,Buffer>();
  for(let chunk=0;chunk<2;chunk++){
   const rows=native.slice(chunk*500,(chunk+1)*500),sourceChunk=candidate.markets.china.chunks[chunk];
   inputs.set(offerPath(generationId,'china',sourceChunk),json(rows));
   for(let offset=0;offset<rows.length;offset+=128){
    const part=offset/128,batch=rows.slice(offset,offset+128);
    expected.push({sourceChunk,part,rows:batch.length,sourceIdsSha256:preparedPriceCardDigest(batch.map(row=>row.id)),sourceInputSha256:preparedPriceCardDigest(batch)});
    inputs.set(preparedChinaNativePartPath(generationId,sourceChunk,part),json(batch));
   }
  }
  const events:CoverageEvent[]=[];
  const context:PreparedPriceCoverageContext={candidateGenerationId:generationId,expectedBaseGenerationId:base.generationId,
   expectedAdmittedRows:native.length,expectedAdmittedIdsSha256:preparedCoverageIdsDigest(native.map(row=>row.id)),
   blockRows:128,fx,pricingFingerprint,expectedBlocks:async function*(){yield* expected;},emit:async event=>{events.push(event);}};
  const seenIds=new Set<string>();
  const report=await streamChinaPriceCoverage({manifest:candidate,source:native,context,chunkSize:500,
   assertActive:async()=>preparedPriceCardDigest(base),takeId:id=>{if(seenIds.has(id))return false;seenIds.add(id);return true;}});
  assert.equal(report.admittedRows,501);assert.equal(report.blockCount,5);
  const authority:PrivatePriceSealAuthority={purpose:'local-private-price-seal-v1',runId:'producer-qa',candidateGenerationId:generationId,
   expectedBaseGenerationId:base.generationId,baseEtag:'"fixture-base"',baseManifestSha256:report.activeManifestSha256,
   candidateMarketDigest:preparedPriceCardMarketDigest(candidate,'china'),fxReceiptSha256:fx.receiptSha256,pricingFingerprint,
   calculationVersion:'a'.repeat(64),pricingAsOf:fx.receipt.pricingAsOf,expectedAdmittedRows:native.length,
   expectedAdmittedIdsSha256:context.expectedAdmittedIdsSha256,blockRows:128,expiresAt:report.validUntil,
   backend:{kind:'local',dataRoot:getDataRoot()},assertAuthorized:async()=>{}};
  const parts:SealedPart[]=events.map(({block})=>({descriptor:block.descriptor,block:block.bytes,projection:json(block.projection)}));
  const projections=events.flatMap(({block})=>block.projection.items);
  const seal={version:1 as const,state:'private_shadow_only' as const,runId:authority.runId,scopeSha256:'b'.repeat(64),report,
   projectionBytes:parts.reduce((sum,part)=>sum+part.projection.length,0)};
  const directoryPrefix=`catalog/generations/${generationId}/indexes/prepared-china-read-v1/`;
  const isSealedReference=(key:string)=>key.startsWith(directoryPrefix+'directory-')||key.startsWith(directoryPrefix+'filters-v1/');

  function recorder(){
   const objects=new Map<string,Buffer>(),writes:string[]=[],nativeReads:string[]=[];
   let coverageVerified=false,visited=0;
   const put:StageInput['put']=async(key,body,validUntil)=>{
    assert.ok(validUntil>asOf);
    if(isSealedReference(key)){assert.equal(coverageVerified,true,'no compact index or directory before seal verification');assert.equal(visited,5);}
    assert.ok(!objects.has(key),'staging object is immutable: '+key);objects.set(key,Buffer.from(body));writes.push(key);
   };
   const readObject:StageInput['readObject']=async(key,sha)=>{
    nativeReads.push(key);const body=inputs.get(key);assert.ok(body,key);if(sha)assert.equal(hash(body),sha);return body;
   };
   const verifyParts:StageInput['verifyParts']=async visit=>{
    for(const part of parts){
     const block=verifyPriceCardBlock(part.block,part.descriptor),projection=JSON.parse(part.projection.toString());
     assert.equal(hash(part.projection),part.descriptor.projectionSha256);
     assert.equal(part.descriptor.marketInventoryDigest,authority.candidateMarketDigest);
     assert.equal(projection.generationId,generationId);
     assert.deepEqual(projection.items.map((row:CatalogSearchProjection)=>row.id),block.details.map(row=>row.id));
     assert.equal(projection.items.length,part.descriptor.rows);await visit(part);visited++;
     assert.equal(writes.some(isSealedReference),false,'reference remains private while the verifier is visiting parts');
    }
    assert.equal(visited,report.blockCount);assert.equal(parts.reduce((n,part)=>n+part.descriptor.rows,0),report.admittedRows);
    coverageVerified=true;return seal;
   };
   return {objects,writes,nativeReads,put,readObject,verifyParts};
  }

  await t.test('sealed directory, complete part locations, exact 160 hp boundary and bounded object reads',async()=>{
   const storage=recorder();
   const staged=await stagePreparedChinaArtifacts({candidate,authority,withStreamingSearch:true,...storage});
   assert.equal(candidate.markets.china.preparedChinaPriceReadV1,undefined,'input manifest remains unmarked');
   const directorySha=staged.marked.markets.china.preparedChinaPriceReadV1!.directorySha256;
   const directoryKey=directoryPrefix+`directory-${directorySha}.json`,body=storage.objects.get(directoryKey)!;
   assert.equal(hash(body),directorySha);assert.equal(storage.writes.at(-1),directoryKey);
   const directory=JSON.parse(body.toString());
   assert.equal(directory.streamingSelector,true);assert.equal(directory.generationId,generationId);
   assert.equal(directory.marketDigest,authority.candidateMarketDigest);assert.equal(directory.rows,501);
   assert.equal(directory.chunkSha256.length,2);assert.equal(directory.filterIndex.version,1);
   assert.equal(storage.nativeReads.length,5);assert.ok(storage.nativeReads.every(key=>/\.part-\d+\.json$/.test(key)));
   const filterReads:Array<{key:string;bytes:number}>=[];
   const get=async(key:string,sha:string)=>{
    assert.ok(key.startsWith(directoryPrefix+'filters-v1/'),'filter query reads only its compact objects');
    const data=storage.objects.get(key);assert.ok(data,key);assert.equal(hash(data),sha);filterReads.push({key,bytes:data.length});return data;
   };
   resetPreparedChinaFilterIndexCacheForTests();
   const filterContext={generationId,marketDigest:directory.marketDigest,rows:directory.rows};
   const params={market:'china' as const,powerTo:160};
   const count=await selectPreparedChinaFilterPage(filterContext,directory.filterIndex,params,{start:0,pageSize:24,countOnly:true},get);
   assert.ok(count);assert.equal(count.total,251);assert.deepEqual(count.positions,[]);
   assert.equal(filterReads.length,2,'one small ready object and one compressed part, no full-card sweep');
   assert.ok(filterReads.every(read=>read.bytes<64*1024));
   assert.ok(filterReads.reduce((sum,read)=>sum+read.bytes,0)<64*1024);
   t.diagnostic(`501 rows: cold power count reads ${filterReads.length} compact objects / ${filterReads.reduce((sum,read)=>sum+read.bytes,0)} bytes`);
   const expectedRows=projections.filter(row=>Number(row.id.slice(-4))%4<2);
   assert.ok(expectedRows.some(row=>row.powerHp===160));assert.ok(!expectedRows.some(row=>row.powerHp===161));
   orderPreparedChinaCompatibilityRows(expectedRows,params);
   const selected:PreparedChinaFilterEntry[]=[];
   for(let start=0;start<251;start+=24){
    const page=await selectPreparedChinaFilterPage(filterContext,directory.filterIndex,params,{start,pageSize:24,countOnly:false},get);
    assert.ok(page);assert.equal(page.total,251);selected.push(...page.positions);
   }
   assert.deepEqual(selected.map(entry=>entry[0]),expectedRows.map(row=>row.id));
   assert.equal(filterReads.length,2,'subsequent pages reuse only the authenticated immutable index');
   for(const entry of selected){
    const index=Number(entry[0].slice(-4)),withinChunk=index%500;
    assert.deepEqual(entry.slice(1,4),[candidate.markets.china.chunks[Math.floor(index/500)],Math.floor(withinChunk/128),withinChunk%128]);
   }
   assert.ok(selected.some(entry=>entry[0]==='producer-0500'&&entry[1]==='chunk-0002'));
   const ready=storage.objects.get(directoryPrefix+`filters-v1/ready-${directory.filterIndex.sha256}.json`)!;
   for(const wrong of [{...filterContext,generationId:'gen_1790001000000_other'}, {...filterContext,marketDigest:'c'.repeat(64)}, {...filterContext,rows:500}]){
    await assert.rejects(selectPreparedChinaFilterPage(wrong,directory.filterIndex,params,{start:0,pageSize:24,countOnly:true},async()=>ready),/prepared_china_filter:directory/);
   }
  });

  await t.test('missing parts, missing chunk and contradictory row census cannot publish a filter reference',async()=>{
   for(const variant of ['missing-part','missing-chunk','wrong-census','wrong-part-binding','seal-rejected'] as const){
    const storage=recorder();
    const chosen=variant==='missing-part'?parts.filter((_,i)=>i!==2):variant==='missing-chunk'?parts.slice(0,4):parts;
    const verifyParts:StageInput['verifyParts']=async visit=>{
     for(const part of chosen)await visit(variant==='wrong-part-binding'?{...part,descriptor:{...part.descriptor,marketInventoryDigest:'c'.repeat(64)}}:part);
     if(variant==='seal-rejected')throw Error('fixture_seal_rejected');
     return variant==='wrong-census'?{...seal,report:{...report,admittedRows:500}}:seal;
    };
    await assert.rejects(stagePreparedChinaArtifacts({candidate,authority,withStreamingSearch:true,...storage,verifyParts}),
     variant==='missing-part'||variant==='wrong-part-binding'?/prepared_china_fixture:candidate_rows/:variant==='missing-chunk'?/prepared_china_fixture:directory_coverage/:
      variant==='seal-rejected'?/fixture_seal_rejected/:/prepared_china_locator:coverage/);
    assert.equal(storage.writes.some(isSealedReference),false,variant);
   }
  });

  await t.test('candidate generation and market digest are rejected before staging writes',async()=>{
   for(const badAuthority of [{...authority,candidateGenerationId:'gen_1790001000000_other'},{...authority,candidateMarketDigest:'c'.repeat(64)}]){
    const storage=recorder();
    await assert.rejects(stagePreparedChinaArtifacts({candidate,authority:badAuthority,withStreamingSearch:true,...storage}),/prepared_china_fixture:candidate/);
    assert.equal(storage.writes.length,0);assert.equal(storage.nativeReads.length,0);
   }
  });
 }finally{
  Object.assign(db,priorStorage);globalThis.fetch=priorFetch;
  if(priorEnv.rate===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=priorEnv.rate;
  if(priorEnv.calculation===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=priorEnv.calculation;
  resetCatalogRateCache();resetChinaCnyPriceCache();resetCatalogEditorialCache();invalidateEffectiveMarketsCache();resetPreparedChinaFilterIndexCacheForTests();
 }
});
