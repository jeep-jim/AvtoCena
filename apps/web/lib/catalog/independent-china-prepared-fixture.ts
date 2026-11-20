import {createHash} from 'node:crypto';
import type {CatalogFxBatch} from './rates';
import {CATALOG_CHUNK_SIZE} from './runtime-config';
import {compilePreparedChinaModelScope,preparedChinaModelIndexedPrice,offerPath,type CatalogManifest,type CatalogPreparedChinaManifest} from './storage';
import {streamChinaPriceCoverage,createPreparedCoverageIdsDigest,type PreparedPriceExpectedBlock} from './prepared-price-coverage';
import {preparedPriceCardDigest as digest,preparedPriceCardMarketDigest} from './prepared-price-card-block';
import {createPrivateChinaPriceSink,verifyPrivateChinaPriceSeal,type PrivatePriceSealAuthority} from './prepared-price-private-seal';
import {openPreparedChinaSnapshot,preparedChinaNativePartPath,stagePreparedChinaArtifacts} from './prepared-china-fixture-activation';
import type {IndependentCut,IndependentFixturePublication,IndependentMarketLease,IndependentMarketPaper} from './independent-market-activation-fixture';
import type {UnavailableOffer} from './offer-availability';
import type {VehicleOffer} from './types';
import type {FreshChinaPriceReplay} from './prepared-china-fresh-price-replay';

import {createDetailSpool} from './detail-spool';
import {createPreparedChinaIdShardWriter,type PreparedChinaIdLocation} from './prepared-china-id-locator';
import {applyFixedChinaCityLedger,createChinaFixedCityViews} from './prepared-china-fixed-city';
import {catalogOfferVisibleRub} from './public-priority';
import {createPreparedChinaModelView} from './prepared-china-model-view';
import {createChinaSelectorFacets,chinaSelectorNavigationQuery,summarizeChinaSelectorPart} from './prepared-china-streaming-selector';

const ID=/^[A-Za-z0-9_:-]{1,150}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=(code:string):never=>{throw Error('independent_china_prepared:'+code);};
type CapturedStatus={id:string;state:'available'}|({state:'withdrawn'} & UnavailableOffer);
type Captured={
 observedAt:number;validUntil:number;cursor:IndependentCut['source']['cursor'];
 statuses:CapturedStatus[];expectedReceiptSha256:string;
};
type PricePaper={
 manifest:CatalogPreparedChinaManifest;coverageSha256:string;privateSealSha256:string;
 receiptSha256:string;orderedIdsSha256:string;
};
type InventoryPaper={withdrawn:UnavailableOffer[];sourceReceiptSha256:string;previousCursorSha256:string};
type SearchPaper={directorySha256:string;modelScope:{make:string;model:string};fixedCityScopes?:true;streamingSelector?:true};
type Read=(key:string,sha?:string)=>Promise<Buffer>;

export function independentChinaSourceDigest(capture:Omit<Captured,'expectedReceiptSha256'>){
 return digest(['china-source-fixture-v1',capture.observedAt,capture.validUntil,capture.cursor,capture.statuses]);
}

function withdrawnLookup(cut:IndependentCut,inventory:IndependentMarketPaper){
 const supply=inventory.payload as InventoryPaper;
 if(!supply||supply.sourceReceiptSha256!==cut.source.receiptSha256||supply.previousCursorSha256!==cut.previousCursorSha256||
    !Array.isArray(supply.withdrawn)||supply.withdrawn.length>1024)return fail('withdrawn_scope');
 const result=new Map<string,UnavailableOffer>();
 for(const entry of supply.withdrawn){
  const when=Date.parse(entry?.removedAt||'');
  if(!entry||entry.market!=='china'||!ID.test(entry.id)||result.has(entry.id)||
     !['sold','removed'].includes(entry.reason)||!Number.isFinite(when)||when>cut.source.observedAt||
     typeof entry.make!=='string'||typeof entry.model!=='string')return fail('withdrawn_scope');
  result.set(entry.id,entry);
 }
 return result;
}
function nativeManifest(cut:IndependentCut,prices:IndependentMarketPaper){
 const p=prices.payload as PricePaper,manifest=p?.manifest,c=manifest?.markets?.china;
 if(!cut.preparedChina||!manifest||manifest.generationId!==cut.generationId||Object.keys(manifest.markets).length!==1||
    !c||c.count!==cut.admitted.count||!c.preparedChinaPriceReadV1||p.receiptSha256!==cut.pricing.receiptSha256||
    p.orderedIdsSha256!==cut.admitted.orderedIdsSha256||!SHA.test(p.privateSealSha256)||!SHA.test(p.coverageSha256))return fail('native_manifest');
 return manifest;
}

export async function verifyIndependentChinaPreparedArtifacts(cut:IndependentCut,
 papers:Record<'inventory'|'prices'|'search',IndependentMarketPaper>,read:Read){
 const withdrawn=withdrawnLookup(cut,papers.inventory),manifest=nativeManifest(cut,papers.prices);
 const search=papers.search.payload as SearchPaper;
 if(!search||search.directorySha256!==manifest.markets.china.preparedChinaPriceReadV1?.directorySha256||
    !search.modelScope?.make||!search.modelScope?.model)return fail('search_scope');
 const snapshot=await openPreparedChinaSnapshot(manifest,read,async()=>{});
 if(snapshot.streamingSelector!==search.streamingSelector)return fail('selector_scope');
 if(snapshot.validUntil!==cut.pricing.validUntil||cut.source.validUntil<snapshot.validUntil)return fail('validity');
 // This consumes only the candidate's exact generation. No neighboring locks
 // or previous shared manifest. All legacies are unchanged outside the fixture.
 const model=await compilePreparedChinaModelScope(search.modelScope.make,search.modelScope.model);
 if(!model)return fail('search_scope');
 const ids=createPreparedCoverageIdsDigest(),spool=await createDetailSpool<PreparedChinaIdLocation>(256,{maxBucketBytes:8*1024*1024});
 let rows=0;
 const navigation=snapshot.streamingSelector?createChinaSelectorFacets(cut.generationId,chinaSelectorNavigationQuery):undefined;
 const modelIndex=createPreparedChinaModelView(cut.generationId,model.keySha256);
 if(Boolean(snapshot.fixedCityViews)!==Boolean(search.fixedCityScopes))return fail('city_scope');
 const cityViews=search.fixedCityScopes?createChinaFixedCityViews(cut.generationId):null;
 const verifyObject=async (key:string,bytes:Buffer)=>{
  const sha=createHash('sha256').update(bytes).digest('hex');
  if(!(await read(key,sha)).equals(bytes))return fail('index_bytes');
 };
 try{
  for(const chunk of snapshot.chunks){
   const c=await snapshot.readChunk(chunk);
   for(let i=0;i<c.partCount;i++){
    const part=await c.load(i),block=await part.loadBlock(),native=await part.loadNativePart();
    if(snapshot.streamingSelector&&digest(c.selectors?.[i])!==digest(summarizeChinaSelectorPart(part.projection.items)))
     return fail('selector_readback');
    if(block.binding.fxReceiptSha256!==cut.pricing.receiptSha256||block.binding.pricingFingerprint!==cut.pricing.inputFingerprint||
       block.binding.calculationVersion!==cut.pricing.calculationVersion||Date.parse(block.binding.pricingAsOf)!==cut.pricing.pricedAt)
     return fail('pricing_receipt');
    const positions=part.projection.items.map((row,offset)=>{
     if(withdrawn.has(row.id))return fail('withdrawn_admitted');
     ids.add(row.id);rows++;navigation?.add(row);
     const position={id:row.id,chunk,part:i,offset};
     if(model.matches(row))modelIndex.add({...position,rub:preparedChinaModelIndexedPrice(row)});
     cityViews?.add(row,position,(scope,rub)=>{
      const ledger=block.details[offset],offer={...native[offset],totalRub:ledger.totalRub,
       calculationStatus:ledger.calculationStatus,calculationSnapshot:{...ledger.ledger,missing:[]}};
      const delivered=applyFixedChinaCityLedger(offer,row,scope);
      if(delivered.totalRub!==rub||catalogOfferVisibleRub(delivered)!==rub)return fail('city_detail_price');
     });
     return position;
    });
    await spool.append(positions);
   }
  }
  if(navigation&&digest(navigation.finish())!==digest(snapshot.navigationFacets))return fail('selector_navigation');
  const locator=createPreparedChinaIdShardWriter(cut.generationId,verifyObject);
  await spool.publishShards(locator.write,true);
  if(digest(locator.finish(rows))!==digest(snapshot.idRoots))return fail('locator_scope');
  const verifiedModel=await modelIndex.publish(verifyObject);
  if(digest(verifiedModel)!==digest(snapshot.modelView))return fail('search_coverage');
  if(cityViews&&digest(await cityViews.publish(verifyObject))!==digest(snapshot.fixedCityViews))return fail('city_scope');
 }finally{await spool.close();}
 if(rows!==cut.admitted.count||ids.finish()!==cut.admitted.orderedIdsSha256)return fail('coverage');
 await snapshot.assertCurrent();
}

export async function openIndependentChinaPrepared(publication:Pick<IndependentFixturePublication,'market'|'observe'|'openChinaPrepared'>){
 const active=await publication.openChinaPrepared();
 if(!active)return null;
 const withdrawn=withdrawnLookup(active.cut,active.inventory);
 const snapshot=await openPreparedChinaSnapshot(nativeManifest(active.cut,active.prices),active.read,active.assertCurrent,active.acceptedLegalUntil);
 if(snapshot.validUntil!==active.cut.pricing.validUntil)return fail('validity');
 return {snapshot,withdrawn,orderedAdmittedIdsSha256:active.cut.admitted.orderedIdsSha256};
}

/** Explicit mock fixture only. Caller supplies the native canonical rows and an
 * independently sealed capture/planning authority. No automatic publish. */
export async function prepareIndependentChinaFixture(input:{
 publication:IndependentFixturePublication;lease:IndependentMarketLease;canonical:readonly VehicleOffer[];capture:Captured;priceReplay?:FreshChinaPriceReplay;
 expectedAdmittedIdsSha256:string;expectedBlocks:()=>AsyncIterable<PreparedPriceExpectedBlock>;blockRows:number;
 fx:CatalogFxBatch;pricingFingerprint:string;calculationVersion:string;modelScope:{make:string;model:string};withFixedCities?:true;withStreamingSearch?:true;
 backend:Extract<PrivatePriceSealAuthority['backend'],{kind:'mock-s3'}>;
}){
 const {publication,lease,canonical,fx}=input,capture=structuredClone(input.capture);
 const io=await publication.chinaPreparation(lease);
 if(publication.market!=='china'||!canonical.length||canonical.length>2048||!Array.isArray(capture.statuses)||capture.statuses.length>3072||
    !Number.isSafeInteger(capture.observedAt)||capture.observedAt<=0||capture.observedAt>Date.now()||!Number.isSafeInteger(capture.validUntil)||
    capture.expectedReceiptSha256!==independentChinaSourceDigest(capture)||Date.now()>=capture.validUntil)
  return fail('source_receipt');
 const available=new Set<string>(),withdrawn:UnavailableOffer[]=[];
 const seen=new Set<string>();
 for(const row of capture.statuses){
  if(!row||!ID.test(row.id)||seen.has(row.id))return fail('source_identity');
  seen.add(row.id);
  if(row.state==='available')available.add(row.id);
  else if(row.state==='withdrawn'){
   const {state:_state,...evidence}=row;withdrawn.push(evidence);
  }else return fail('source_identity');
 }
 if(available.size!==canonical.length||canonical.some(row=>row.market!=='china'||row.status!=='active'||!available.delete(row.id)))
  return fail('admission');
 const count=canonical.length;
 const chunks=async function*(){
  for(let start=0;start<count;start+=CATALOG_CHUNK_SIZE)yield canonical.slice(start,start+CATALOG_CHUNK_SIZE);
 };
 return prepareIndependentChinaCanonicalChunks({...input,count,chunks,withdrawn,source:{...capture,receiptSha256:capture.expectedReceiptSha256}});
}

/** Dedicated disk-shadow bridge. Externally pinned archive acceptance supplies
 * canonical chunks and the exact independently attested coverage plan. */
export async function prepareIndependentChinaCanonicalChunks(input:{
 publication:IndependentFixturePublication;lease:IndependentMarketLease;count:number;
 chunks:()=>AsyncIterable<readonly VehicleOffer[]>;withdrawn:UnavailableOffer[];
 source:Omit<IndependentCut['source'],'complete'>;expectedAdmittedIdsSha256:string;priceReplay?:FreshChinaPriceReplay;
 expectedBlocks:()=>AsyncIterable<PreparedPriceExpectedBlock>;blockRows:number;
 fx:CatalogFxBatch;pricingFingerprint:string;calculationVersion:string;modelScope:{make:string;model:string};withFixedCities?:true;withStreamingSearch?:true;freshSnapshot?:true;
 backend:Extract<PrivatePriceSealAuthority['backend'],{kind:'mock-s3'}>;
}){
 const {publication,lease,count,chunks,fx,withdrawn}=input,source=structuredClone(input.source);
 const io=await publication.chinaPreparation(lease);
 if(publication.market!=='china'||!Number.isSafeInteger(count)||count<1||count>1_000_000||
    !Number.isSafeInteger(source.observedAt)||source.observedAt<=0||source.observedAt>Date.now()||
    !Number.isSafeInteger(source.validUntil)||Date.now()>=source.validUntil||
    !SHA.test(source.receiptSha256)||!source.cursor||!Number.isSafeInteger(source.cursor.sequence)||!SHA.test(source.cursor.anchorSha256)||
    !Number.isSafeInteger(input.blockRows)||input.blockRows<1||input.blockRows>128||!SHA.test(input.expectedAdmittedIdsSha256))
  return fail('archive_contract');
 if(io.baseCursor&&(source.cursor.stream!==io.baseCursor.stream||source.cursor.sequence<io.baseCursor.sequence||
    (source.cursor.sequence===io.baseCursor.sequence&&digest(source.cursor)!==digest(io.baseCursor))))return fail('cursor_regression');
 const generationId=lease.generationId,updatedAt=new Date(Number(generationId.split('_')[1])).toISOString();
 const manifest:CatalogManifest={version:2,generationId,updatedAt,markets:{china:{count,
  chunks:Array.from({length:Math.ceil(count/CATALOG_CHUNK_SIZE)},(_,i)=>'chunk-'+String(i+1).padStart(4,'0')),updatedAt}}};
 const scope:PrivatePriceSealAuthority={
  purpose:'local-private-price-seal-v1',independentFixture:true,runId:'market-'+lease.token,
  candidateGenerationId:generationId,expectedBaseGenerationId:io.baseGenerationId,baseEtag:lease.token,baseManifestSha256:io.baseSha256,
  candidateMarketDigest:preparedPriceCardMarketDigest(manifest,'china'),fxReceiptSha256:fx.receiptSha256,
  pricingFingerprint:input.pricingFingerprint,calculationVersion:input.calculationVersion,pricingAsOf:fx.receipt.pricingAsOf,
  expectedAdmittedRows:count,expectedAdmittedIdsSha256:input.expectedAdmittedIdsSha256,blockRows:input.blockRows,
  expiresAt:source.validUntil,...(input.freshSnapshot?{freshSourceValidUntil:source.validUntil}:{}),backend:input.backend,assertAuthorized:io.assertAuthorized,
 };
 const sink=createPrivateChinaPriceSink(io.storage,scope),ids=new Set<string>();
 const sourceRows=async function*(){
  let index=0;
  for await(const rows of chunks()){
   const key=manifest.markets.china.chunks[index];
   if(!key||rows.length!==Math.min(CATALOG_CHUNK_SIZE,count-index*CATALOG_CHUNK_SIZE))return fail('archive_chunk');
   if(input.withStreamingSearch){
    for(let i=0,part=0;i<rows.length;i+=input.blockRows,part++){
     const body=Buffer.from(JSON.stringify(rows.slice(i,i+input.blockRows)));
     await io.put(preparedChinaNativePartPath(generationId,key,part),body,source.validUntil);
    }
   }else await io.put(offerPath(generationId,'china',key),Buffer.from(JSON.stringify(rows)),source.validUntil);
   index++;
   for(const row of rows)yield row;
  }
  if(index!==manifest.markets.china.chunks.length)return fail('archive_chunk');
 };
 const report=await streamChinaPriceCoverage({manifest,source:sourceRows(),chunkSize:CATALOG_CHUNK_SIZE,
  assertActive:async()=>{await io.assertAuthorized();return io.baseSha256;},takeId:id=>{if(ids.has(id))return false;ids.add(id);return true;},context:{
   candidateGenerationId:generationId,expectedBaseGenerationId:io.baseGenerationId,
   expectedAdmittedRows:count,expectedAdmittedIdsSha256:input.expectedAdmittedIdsSha256,
   blockRows:input.blockRows,fx,pricingFingerprint:input.pricingFingerprint,freshSourceValidUntil:scope.freshSourceValidUntil,priceReplay:input.priceReplay,expectedBlocks:input.expectedBlocks,emit:sink.emit,
  }});
 const sealed=await sink.complete(report);
 const built=await stagePreparedChinaArtifacts({candidate:manifest,authority:scope,modelScope:input.modelScope,withFixedCities:input.withFixedCities,withStreamingSearch:input.withStreamingSearch,
  readObject:io.read,put:io.put,verifyParts:visit=>verifyPrivateChinaPriceSeal(io.storage,scope,sealed.sha256,visit)});
 const previousCursorSha256=digest(io.baseCursor),sourceReceiptSha256=source.receiptSha256,
  orderedIdsSha256=report.orderedAdmittedIdsSha256,pricingReceiptSha256=report.fxReceiptSha256;
 const payloads={
  inventory:{withdrawn,sourceReceiptSha256,previousCursorSha256} satisfies InventoryPaper,
  prices:{manifest:built.marked,coverageSha256:digest(report),privateSealSha256:sealed.sha256,
   receiptSha256:pricingReceiptSha256,orderedIdsSha256} satisfies PricePaper,
  search:{directorySha256:built.marked.markets.china.preparedChinaPriceReadV1!.directorySha256,modelScope:input.modelScope,...(input.withFixedCities?{fixedCityScopes:true as const}:{}),...(input.withStreamingSearch?{streamingSelector:true as const}:{})} satisfies SearchPaper,
 };
 const paper=(role:keyof typeof payloads):IndependentMarketPaper=>({version:1,role,market:'china',generationId,
  sourceReceiptSha256,pricingReceiptSha256,orderedIdsSha256,count,payload:payloads[role]});
 const cut:IndependentCut={version:1,market:'china',generationId,expectedBaseSha256:io.baseSha256,previousCursorSha256,preparedChina:true,
  source:{complete:true,receiptSha256:sourceReceiptSha256,observedAt:source.observedAt,validUntil:source.validUntil,cursor:source.cursor},
  pricing:{receiptSha256:pricingReceiptSha256,inputFingerprint:input.pricingFingerprint,calculationVersion:input.calculationVersion,
   pricedAt:Date.parse(fx.receipt.pricingAsOf),validUntil:built.validUntil,
   ...(built.legalValidUntil===undefined?{}:{legalValidUntil:built.legalValidUntil})},
  admitted:{count,orderedIdsSha256},
  papers:{inventory:digest(paper('inventory')),prices:digest(paper('prices')),search:digest(paper('search'))}};
 withdrawnLookup(cut,paper('inventory'));
 const ready=await publication.prepare(lease,cut,digest(cut),async role=>paper(role));
 return {ready,report};
}
