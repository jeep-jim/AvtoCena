import {createPreparedChinaModelView} from "./prepared-china-model-view";
import {createHash} from 'node:crypto';
import {compilePreparedChinaModelScope,preparedChinaModelIndexedPrice,offerPath,type CatalogManifest,type CatalogPreparedChinaManifest} from './storage';
import {createPreparedCoverageIdsDigest} from './prepared-price-coverage';
import {preparedPriceCardDigest as digest,preparedPriceCardMarketDigest} from './prepared-price-card-block';
import {openPreparedChinaSnapshot,preparedChinaNativePartPath} from './prepared-china-fixture-activation';
import type {IndependentCut,IndependentFixturePublication,IndependentMarketLease,IndependentMarketPaper} from './independent-market-activation-fixture';
import type {UnavailableOffer} from './offer-availability';
import type {VehicleOffer} from './types';

import {createDetailSpool} from './detail-spool';
import {createPreparedChinaIdShardWriter,type PreparedChinaIdLocation} from './prepared-china-id-locator';
import {applyFixedChinaCityLedger,createChinaFixedCityViews} from './prepared-china-fixed-city';
import {catalogOfferVisibleRub} from './public-priority';
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
type SearchPaper={directorySha256:string;modelScope:{make:string;model:string};fixedCityScopes?:true;streamingSelector?:true;chinaEditorialSha256?:string};
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
    !search.modelScope?.make||!search.modelScope?.model||
    (search.chinaEditorialSha256!==undefined&&!SHA.test(search.chinaEditorialSha256)))return fail('search_scope');
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
 const {chinaEditorialSha256}=active.search.payload as SearchPaper;
 if(chinaEditorialSha256!==undefined&&!SHA.test(chinaEditorialSha256))return fail('search_editorial_binding');
 return {snapshot,withdrawn,orderedAdmittedIdsSha256:active.cut.admitted.orderedIdsSha256,chinaEditorialSha256};
}

/** Explicit mock fixture only. Caller supplies the native canonical rows and an
 * independently sealed capture/planning authority. No automatic publish. */
