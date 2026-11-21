import {AsyncLocalStorage} from 'node:async_hooks';
import {ObjectJsonStorage} from '../data';
import {readCatalogEditorialFresh,withCatalogEditorialSnapshot} from './editorial';
import {preparedChinaEditorialEvidence} from './china-prepared-editorial.mjs';
import {openActivePreparedChinaFixture} from './prepared-china-fixture-activation';
import {catalogOfferVisibleRub} from './public-priority';
import {compilePreparedChinaModelScope,compilePreparedChinaCompatibilityPredicate,preparedChinaModelPublicItem,projectionCanRenderCard,catalogSearchProjectionMatches,selectPreparedChinaCompatibilityRows,orderPreparedChinaCompatibilityRows,facetsForPreparedChinaCompatibilityRows,type CatalogSearchProjection} from './storage';
import {openIndependentChinaPrepared} from './independent-china-prepared-fixture';
import {openIndependentChinaRegcloud,openIndependentChinaStage,type IndependentFixturePublication} from './independent-market-activation-fixture';
import {assertStageChinaFiles,type StageChinaFiles} from './china-stage-runtime-files';
import {chinaRegcloudRuntimeConfigured,openConfiguredChinaRegcloudFiles,assertChinaStageObjectFiles,type ChinaStageObjectFiles} from './china-regcloud-object-reader';
import type {CatalogSearchParams,VehicleOffer} from './types';

import {applyPreparedChinaDeliveryLedger,eligibleChinaFixedCityQuery,fixedChinaCityMembership,preparedChinaDeliveryQuote,projectFixedChinaCity,projectPreparedChinaDelivery} from './prepared-china-fixed-city';

import {createPreparedCoverageIdsDigest} from './prepared-price-coverage';
import {DELIVERY_TARIFF_VERSION} from './city-delivery';
import {compileChinaPartDispatch,createChinaSelectorFacets,createChinaSelectorPage} from './prepared-china-streaming-selector';
import {balanceBusinessRows,businessOrder,sortCatalogRows,MARKET_DIVERSITY_WINDOW_PAGES,MARKET_PAGE_SIZE} from './market-page';

type IndependentRead=Pick<IndependentFixturePublication,'market'|'observe'|'openChinaPrepared'>;
type Fixture={storage:ObjectJsonStorage;fetchMock:typeof fetch;origin:string;bucket:string;prefix:string;indexedModelOnly?:true;independentChina?:IndependentFixturePublication};
type Stage={files:StageChinaFiles;indexedModelOnly:true;independentChina:IndependentRead};
type Regcloud={regcloud:ChinaStageObjectFiles;indexedModelOnly:true;independentChina:IndependentRead};
const scope=new AsyncLocalStorage<Readonly<Fixture|Stage|Regcloud>>();
export class PreparedChinaCutChanged extends Error {
 constructor(){super('prepared_china_cut_changed');}
}
export class PreparedChinaFixtureUnavailable extends Error {
 constructor(){super('prepared_china_unavailable');}
}
function assertFixture(f:Readonly<Fixture|Stage|Regcloud>){
 if('regcloud' in f){assertChinaStageObjectFiles(f.regcloud);return;}
 if('files' in f){assertStageChinaFiles(f.files);return;}
 if(!(f.storage instanceof ObjectJsonStorage)||globalThis.fetch!==f.fetchMock||
    !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(f.origin)||!/^fixture-[a-z0-9-]{1,32}$/.test(f.bucket)||!/^fixture-[a-z0-9-]{1,32}$/.test(f.prefix)||
    process.env.YC_OBJECT_STORAGE_ENDPOINT!==f.origin||process.env.YC_OBJECT_STORAGE_BUCKET!==f.bucket||
    process.env.YC_OBJECT_STORAGE_PREFIX!==f.prefix||process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID!=='fixture'||
    process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY!=='fixture')throw new PreparedChinaFixtureUnavailable();
}
/** No enable flag and no ambient fixture: only a test may inject this scope. */
export async function withPreparedChinaHttpFixture<T>(fixture:Fixture,run:()=>Promise<T>){
 const fixed=Object.freeze({...fixture});assertFixture(fixed);
 if(fixed.independentChina&&(!fixed.indexedModelOnly||fixed.independentChina.market!=='china'))throw new PreparedChinaFixtureUnavailable();
 return scope.run(fixed,run);
}
// Explicit private staging runtime only. A verified file grant cannot fall
// through to the old route or resolve credentials/FX/editorial from live data.
export function withPreparedChinaStageRuntime<T>(files:StageChinaFiles,run:()=>Promise<T>){
 const scoped=Object.freeze({files,indexedModelOnly:true as const,independentChina:openIndependentChinaStage(files)});
 return scope.run(scoped,()=>withCatalogEditorialSnapshot({revision:'private-stage',entries:{}},run));
}
/** Operator-private readback of a candidate; no request parameter enables it. */
export function withPreparedChinaRegcloudPreview<T>(regcloud:ChinaStageObjectFiles,run:()=>Promise<T>){
 const scoped=Object.freeze({regcloud,indexedModelOnly:true as const,independentChina:openIndependentChinaRegcloud(regcloud)});
 return scope.run(scoped,run);
}
export const preparedChinaNormalRegcloudEnabled=()=>!scope.getStore()&&chinaRegcloudRuntimeConfigured();
export const hasPreparedChinaHttpFixture=()=>!!scope.getStore()||preparedChinaNormalRegcloudEnabled();
export const hasIndependentChinaHttpFixture=()=>!!scope.getStore()?.independentChina||preparedChinaNormalRegcloudEnabled();
export const preparedChinaIndexedModelOnly=()=>scope.getStore()?.indexedModelOnly===true||preparedChinaNormalRegcloudEnabled();
const preparedOffers=new WeakMap<VehicleOffer,()=>Promise<void>>();
export const preparedChinaOfferGuard=(row:VehicleOffer)=>preparedOffers.get(row);
const MAX_FIXTURE_ROWS=128;

async function open(){
 const existing=scope.getStore();
 const f=existing??(preparedChinaNormalRegcloudEnabled()?await (async()=>{
  const regcloud=await openConfiguredChinaRegcloudFiles();
  if(!regcloud)return null; // exact authenticated legacy rollback only
  return Object.freeze({regcloud,indexedModelOnly:true as const,independentChina:openIndependentChinaRegcloud(regcloud)});
 })():undefined);
 if(!f)return null;
 assertFixture(f);
 const scoped=f.independentChina?await openIndependentChinaPrepared(f.independentChina):null;
 if(f.independentChina&&!scoped&&(await f.independentChina.observe()).generationId)
  throw new PreparedChinaFixtureUnavailable();
 const snapshot=f.independentChina?scoped?.snapshot:'storage' in f?await openActivePreparedChinaFixture(f.storage):null;
 if(!snapshot)return null;
 if(!Number.isSafeInteger(snapshot.rows)||snapshot.rows<1)
  throw new PreparedChinaFixtureUnavailable();
 const assertCurrent=async()=>{
  if(existing?scope.getStore()!==f:!preparedChinaNormalRegcloudEnabled())throw new PreparedChinaFixtureUnavailable();
  assertFixture(f);
  // No editorial generation receipt in this candidate. Never ignore an edit,
  // silently reuse pre-edit amounts or recalculate as part of the fixture.
  if(!('files' in f)){
   const editorial=await readCatalogEditorialFresh();
   if(scoped?.chinaEditorialSha256!==undefined
     ?preparedChinaEditorialEvidence(editorial).sha256!==scoped.chinaEditorialSha256
     :Object.values(editorial.entries).some(entry=>entry.market==='china'))throw new PreparedChinaFixtureUnavailable();
  }
  assertFixture(f);
  await snapshot.assertCurrent();
 };
 return {snapshot,assertCurrent,withdrawn:scoped?.withdrawn,orderedAdmittedIdsSha256:scoped?.orderedAdmittedIdsSha256};
}

function attachChinaSelection<T>(item:T,generationId:string,city?:string){
 return hasIndependentChinaHttpFixture()?{...item,preparedChinaSelection:{version:1,generationId,...(city?{city}: {})}}:item;
}
type OpenFixture=NonNullable<Awaited<ReturnType<typeof open>>>;
type OpenChunk=Awaited<ReturnType<OpenFixture['snapshot']['readChunk']>>;
type OpenPart=Awaited<ReturnType<OpenChunk['load']>>;
async function walk(s:OpenFixture,visit:(part:OpenPart)=>Promise<void>,signal?:AbortSignal){
 let rows=0;
 const seen=new Set<string>();
 for(const chunk of s.snapshot.chunks){
  signal?.throwIfAborted();
  const reader=await s.snapshot.readChunk(chunk);
  for(let i=0;i<reader.partCount;i++){
   signal?.throwIfAborted();
   const part=await reader.load(i);
   signal?.throwIfAborted();
   for(const row of part.projection.items){
    if(!row.id||seen.has(row.id)||++rows>s.snapshot.rows)throw new PreparedChinaFixtureUnavailable();
    seen.add(row.id);
   }
   await visit(part);
  }
 }
 if(rows!==s.snapshot.rows)throw new PreparedChinaFixtureUnavailable();
}
export async function readPreparedChinaFixtureList(unsupported:boolean){
 try{
  const s=await open();
  if(!s)return null;
  if(unsupported||s.snapshot.rows>MAX_FIXTURE_ROWS||s.snapshot.chunks.length>MAX_FIXTURE_ROWS)throw new PreparedChinaFixtureUnavailable();
  const rows:CatalogSearchProjection[]=[];
  await walk(s,async part=>{rows.push(...part.projection.items);});
  await s.assertCurrent();
  return {generationId:s.snapshot.generationId,rows,assertCurrent:s.assertCurrent};
 }catch{throw new PreparedChinaFixtureUnavailable();}
}
const MAX_PREPARED_MODEL_PART_READS=4;
const modelScopeKeys=['market','make','model','sort','page','pageSize','budgetFrom','budgetTo'];
type PreparedModelScope=NonNullable<Awaited<ReturnType<typeof compilePreparedChinaModelScope>>>;
async function readIndexedModelPage(s:OpenFixture,selection:PreparedModelScope,params:CatalogSearchParams,countOnly:boolean){
 const page=params.page??1,size=params.pageSize??24,pageSize=Math.min(48,size),start=(page-1)*pageSize;
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||!Number.isSafeInteger(start+pageSize))return null;
 const result=await s.snapshot.modelPage(selection.keySha256,{lower:params.budgetFrom,upper:params.budgetTo,start,pageSize,countOnly});
 if(!result)return null;
 const generationId=s.snapshot.generationId;
 if(countOnly){
  await s.assertCurrent();
  return {generationId,total:result.total,items:[],marketCountInfo:{}};
 }
 const partKey=(position:{chunk:string;part:number})=>position.chunk+':'+position.part;
 const unique=[...new Map(result.positions.map(row=>[partKey(row),row])).values()];
 const chunks=new Map<string,Promise<OpenChunk>>(),parts=new Map<string,OpenPart>();
 for(let i=0;i<unique.length;i+=MAX_PREPARED_MODEL_PART_READS)await Promise.all(unique.slice(i,i+MAX_PREPARED_MODEL_PART_READS).map(async row=>{
  let chunk=chunks.get(row.chunk);
  if(!chunk){chunk=s.snapshot.readChunk(row.chunk);chunks.set(row.chunk,chunk);}
  parts.set(partKey(row),await (await chunk).load(row.part));
 }));
 const items=result.positions.map(row=>{
  const item=parts.get(partKey(row))?.projection.items[row.offset];
  if(item?.id!==row.id||item.totalRub!==row.rub||!selection.matches(item))throw new PreparedChinaFixtureUnavailable();
  return attachChinaSelection(preparedChinaModelPublicItem(item,row.rub),generationId);
 });
 await s.assertCurrent();
 return {generationId,total:result.total,page,pageSize,items,usedIndexShards:[]};
}
/** Only exact model ranking authorized by the immutable directory. */
export async function readPreparedChinaIndexedModel(params:CatalogSearchParams,countOnly:boolean){
 if(!preparedChinaIndexedModelOnly()||params.market!=='china'||!params.make||!params.model||
    params.sort!=='totalRub'||Object.entries(params).some(([k,v])=>v!==undefined&&!modelScopeKeys.includes(k)))return null;
 try{
  const selection=await compilePreparedChinaModelScope(params.make,params.model);
  if(!selection)return null;
  const s=await open();
  return s?await readIndexedModelPage(s,selection,params,countOnly):null;
 }catch{throw new PreparedChinaFixtureUnavailable();}
}
export async function readPreparedChinaIndexedCity(params:CatalogSearchParams,countOnly:boolean){
 if(!hasIndependentChinaHttpFixture())return null;
 const scope=eligibleChinaFixedCityQuery(params);
 if(!scope)return null;
 const page=params.page??1,size=params.pageSize??24,pageSize=Math.min(48,size),start=(page-1)*pageSize;
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||!Number.isSafeInteger(start+pageSize))return null;
 try{
  const s=await open();
  if(!s)return null;
  const result=await s.snapshot.cityPage(scope,{lower:params.budgetFrom,upper:params.budgetTo,start,pageSize,countOnly});
  if(!result)return null;
  if(countOnly){
   await s.assertCurrent();
   return {generationId:s.snapshot.generationId,total:result.total,items:[],marketCountInfo:{}};
  }
  const chunks=new Map<string,OpenChunk>(),parts=new Map<string,OpenPart>(),items=[];
  for(const position of result.positions){
   let chunk=chunks.get(position.chunk);
   if(!chunk){chunk=await s.snapshot.readChunk(position.chunk);chunks.set(position.chunk,chunk);}
   const key=position.chunk+':'+position.part;
   let part=parts.get(key);
   if(!part){part=await chunk.load(position.part);parts.set(key,part);}
   const row=part.projection.items[position.offset];
   if(row?.id!==position.id||!fixedChinaCityMembership(row,scope))throw new PreparedChinaFixtureUnavailable();
   items.push(attachChinaSelection(preparedChinaModelPublicItem(projectFixedChinaCity(row,scope),position.rub),s.snapshot.generationId,scope.city));
  }
  await s.assertCurrent();
  return {generationId:s.snapshot.generationId,total:result.total,page,pageSize,items,deliveryCity:scope.city,usedIndexShards:[]};
 }catch{throw new PreparedChinaFixtureUnavailable();}
}

const MAX_COMPATIBILITY_ROWS=512;
const packs=new WeakMap<IndependentRead,{authority:string;rows:Promise<CatalogSearchProjection[]>}>();
function compatibilityRows(s:OpenFixture,signal?:AbortSignal){
 const publication=scope.getStore()?.independentChina;
 if(!publication||s.snapshot.rows>MAX_COMPATIBILITY_ROWS)throw new PreparedChinaFixtureUnavailable();
 const identity=JSON.stringify([s.snapshot.generationId,s.snapshot.directorySha256]);
 const old=packs.get(publication);
 if(!signal&&old?.authority===identity)return old.rows;
 const rows=(async()=>{
  const projected:CatalogSearchProjection[]=[],proof=createPreparedCoverageIdsDigest();let bytes=0;
  await walk(s,async part=>{
   bytes+=Buffer.byteLength(JSON.stringify(part.projection));
   if(bytes>12*1024*1024)throw new PreparedChinaFixtureUnavailable();
   projected.push(...part.projection.items);
   for(const row of part.projection.items)proof.add(row.id);
  },signal);
  if(proof.finish()!==s.orderedAdmittedIdsSha256)throw new PreparedChinaFixtureUnavailable();
  return projected;
 })();
 if(signal)return rows;
 packs.set(publication,{authority:identity,rows});
 void rows.catch(()=>{if(packs.get(publication)?.rows===rows)packs.delete(publication);});
 return rows;
}

/** Bounded correctness fixture, not a full-feed performance path. Search
 * reuses same-cut projections and the existing exact filters/order/paging. */
export async function readPreparedChinaCompatibility(params:CatalogSearchParams,options:{
 countOnly:boolean;includeFacets:boolean;marketPage:boolean;unsupported:boolean;navigationFacets?:true;expectedGeneration?:string|null;signal?:AbortSignal;
}){
 if(!hasIndependentChinaHttpFixture()||params.market!=='china')return null;
 const {signal}=options;
 try{
  signal?.throwIfAborted();
  const s=await open();
  signal?.throwIfAborted();
  if(!s){if(options.expectedGeneration)throw new PreparedChinaCutChanged();return null;} // authenticated legacy rollback only
  if(options.expectedGeneration&&options.expectedGeneration!==s.snapshot.generationId)throw new PreparedChinaCutChanged();
  if(options.unsupported)throw new PreparedChinaFixtureUnavailable();
  const {city}=params;
  const deliveryCity=city?preparedChinaDeliveryQuote(city).city:undefined;
  if(city){
   if(s.snapshot.deliveryTariffVersion!==DELIVERY_TARIFF_VERSION)throw new PreparedChinaFixtureUnavailable();
  }
  const page=params.page??1,pageSize=options.marketPage?MARKET_PAGE_SIZE:Math.min(48,params.pageSize??24),start=(page-1)*pageSize;
  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||!Number.isSafeInteger(start+pageSize))
   throw new PreparedChinaFixtureUnavailable();
  const isUnsortedUnfiltered=(!params.sort||params.sort==='updatedAt')&&
   Object.entries(params).every(([k,v])=>['market','city','page','pageSize','sort'].includes(k)||!v);
  const isDefaultMarketPage=options.marketPage&&isUnsortedUnfiltered;
  const generationId=s.snapshot.generationId;
  const makePublic=(row:CatalogSearchProjection)=>{
   const adjusted=city?projectPreparedChinaDelivery(row,city):row;
   return attachChinaSelection(preparedChinaModelPublicItem(adjusted,adjusted.totalRub||0),generationId,deliveryCity);
  };
  // "Без сортировки": use the entire sealed order across all page links.
  // Explicit filters/sort still use the existing exact selection path below.
  if(isDefaultMarketPage||isUnsortedUnfiltered&&options.countOnly){
   const window=await s.snapshot.canonicalWindow(start,pageSize,options.countOnly&&!options.marketPage);
   if(window){
    if(window.items.some(row=>!projectionCanRenderCard(row)))throw new PreparedChinaFixtureUnavailable();
    const items=window.items.map(makePublic);
    const facets=options.navigationFacets?s.snapshot.navigationFacets:undefined;
    await s.assertCurrent();
    if(options.countOnly&&!options.marketPage)return {generationId,total:window.total,items:[],marketCountInfo:{}};
    return {generationId,total:window.total,page,pageSize,items,usedIndexShards:[],...(facets?{facets}:{})};
   }
  }
  // Share the exact immutable model index with the SSR grid and its normal
  // 24-card pagination API. Word ranges, city, additional filters, facets
  // scoped to the selected rows, and other sorts stay on the existing adapter.
  const indexedGridKeys=['market','make','model','sort','page','pageSize'];
  if(options.marketPage&&!options.includeFacets&&params.make&&params.model&&params.sort==='totalRub'&&
     Object.entries(params).every(([key,value])=>!value||indexedGridKeys.includes(key))){
   const selection=await compilePreparedChinaModelScope(params.make,params.model);
   if(selection){
    const indexed=await readIndexedModelPage(s,selection,{...params,page,pageSize},false);
    if(indexed&&'page' in indexed)return {...indexed,...(options.navigationFacets?{facets:s.snapshot.navigationFacets}:{})};
   }
  }
  // Base projection is used by the existing count/filter oracle. Existing
  // city predicate applies its delta once. Adjust returned DTOs only.
  const query=isDefaultMarketPage?{...params,city:undefined}:params;
  const width=pageSize*MARKET_DIVERSITY_WINDOW_PAGES,offset=Math.floor(start/width)*width;
  const limit=options.countOnly&&!options.marketPage?0:isDefaultMarketPage?offset+width:start+pageSize;
  const facetQuery=options.navigationFacets?{market:'china',hasPrice:'yes'}:options.includeFacets&&!options.marketPage&&!options.countOnly?params:undefined;
  let matched:CatalogSearchProjection[],facets,total=0;
  if(s.snapshot.streamingSelector){
   const predicate=await compilePreparedChinaCompatibilityPredicate(query),readsPart=compileChinaPartDispatch(query);
   const ranking=createChinaSelectorPage(query,limit);
   const accum=facetQuery&&!options.navigationFacets?createChinaSelectorFacets(generationId,facetQuery):undefined;
   // Broad exact membership may require a compact projection scan.
   // Navigation facets are presealed; skip unrelated blocks even in SSR.
   for(const chunk of s.snapshot.chunks){
    signal?.throwIfAborted();
    const reader=await s.snapshot.readChunk(chunk);
    if(!reader.selectors)throw new PreparedChinaFixtureUnavailable();
    for(let i=0;i<reader.partCount;i++){
     const relevant=readsPart(reader.selectors[i]);
     if(!relevant)continue;
     signal?.throwIfAborted();
     const part=await reader.load(i);
     signal?.throwIfAborted();
     for(const row of part.projection.items){
      if(predicate(row)){total++;ranking.add(row);accum?.add(row);}
     }
    }
   }
   matched=ranking.finish();
   facets=options.navigationFacets?s.snapshot.navigationFacets:accum?.finish();
  }else{
   const rows=await compatibilityRows(s,signal);
   signal?.throwIfAborted();
   matched=await selectPreparedChinaCompatibilityRows(rows,query);total=matched.length;
   if(limit)orderPreparedChinaCompatibilityRows(matched,query);
   facets=facetQuery?facetsForPreparedChinaCompatibilityRows(generationId,options.navigationFacets?rows:matched,facetQuery):undefined;
  }
  if(options.countOnly&&!options.marketPage){
   await s.assertCurrent();return {generationId,total,items:[],marketCountInfo:{}};
  }
  let items;
  if(isDefaultMarketPage){
   const window=balanceBusinessRows(matched.slice(offset,offset+width).map(row=>preparedChinaModelPublicItem(row,row.totalRub||0)));
   const byId=new Map(matched.slice(offset,offset+width).map(row=>[row.id,row]));
   items=balanceBusinessRows(window.slice(start-offset,start-offset+pageSize)).map(row=>makePublic(byId.get(row.id)!));
  }else{
   items=matched.slice(start,start+pageSize).map(makePublic);
   if(options.marketPage)items=params.sort&&params.sort!=='updatedAt'?sortCatalogRows(items,params.sort,params.city):
    params.model?items.sort(businessOrder):balanceBusinessRows(items);
  }
  signal?.throwIfAborted();
  await s.assertCurrent();
  signal?.throwIfAborted();
  return {generationId,total,page,pageSize,items,usedIndexShards:[],...(facets?{facets}:{})};
 }catch(error){if(error instanceof PreparedChinaCutChanged)throw error;throw new PreparedChinaFixtureUnavailable();}
}

/** Deliberately knows only the prepared generation. The existing public
 * fallback is not safe once an independent China pointer has been selected. */
export async function assertIndependentChinaFallbackAllowed(){
 if(!hasIndependentChinaHttpFixture())return;
 const s=await open();
 if(s)throw new PreparedChinaFixtureUnavailable();
}
export async function readPreparedChinaFixtureOffer(id:string,city?:string,clientCut?:string){
 // An explicitly live AJES card is not an id in this local market.
 if(/^ajes-(?:china|korea|stats)-/.test(id))return null;
 try{
  const s=await open();
  if(!s)return null;
  if(clientCut&&clientCut!==s.snapshot.generationId)throw new PreparedChinaFixtureUnavailable();
  const location=await s.snapshot.locate(id);
  let offer:VehicleOffer|null=null;
  if(location){
   const part=await (await s.snapshot.readChunk(location.chunk)).load(location.part),i=location.offset;
   const projected=part.projection.items[i];
   if(projected?.id!==id||projected.market!=='china')throw new PreparedChinaFixtureUnavailable();
   if(projectionCanRenderCard(projected)&&catalogSearchProjectionMatches(projected,{market:'china'})){
    const block=await part.loadBlock(),detail=block.details[i],native=(await part.loadNativePart())[i];
    if(!native||native.id!==id||native.market!=='china'||detail.id!==id)throw new PreparedChinaFixtureUnavailable();
    const snapshot={...detail.ledger,missing:[]} as unknown as VehicleOffer['calculationSnapshot'];
    const specs=detail.editorialSpecifications;
    if(specs&&Object.entries(specs).some(([key,value])=>projected[key as keyof typeof projected]!==value))
     throw new PreparedChinaFixtureUnavailable();
    offer={...native,...specs,...(specs?{editorialSpecifications:specs}:{}),
     calculationSnapshot:snapshot,totalRub:detail.totalRub,calculationStatus:detail.calculationStatus};
    if(catalogOfferVisibleRub(offer)!==detail.totalRub)throw new PreparedChinaFixtureUnavailable();
    if(city){
     if(s.snapshot.deliveryTariffVersion!==DELIVERY_TARIFF_VERSION)throw new PreparedChinaFixtureUnavailable();
     const cityOffer=applyPreparedChinaDeliveryLedger(offer,projected,city),rub=cityOffer.totalRub!;
     if(catalogOfferVisibleRub(cityOffer)!==rub)throw new PreparedChinaFixtureUnavailable();
     offer=cityOffer;
    }
   }
  }
  await s.assertCurrent();
  if(offer)preparedOffers.set(offer,s.assertCurrent);
  return {offer,withdrawn:!offer?s.withdrawn?.get(id):undefined,assertCurrent:s.assertCurrent};
 }catch{throw new PreparedChinaFixtureUnavailable();}
}

/** Fast homepage bridge: independent count and a small admitted prefix, not
 * an aggregate-sort claim. At most four exact prepared offer blocks. */
export async function readPreparedChinaHomeCards(rawLimit:number,options?:{city?:string;navigation?:true}){
 if(!preparedChinaNormalRegcloudEnabled())return null;
 const s=await open();if(!s)return null;
 const limit=Math.max(0,Math.min(12,Math.floor(rawLimit)||0));
 const city=options?.city?preparedChinaDeliveryQuote(options.city).city:undefined;
 if(city&&s.snapshot.deliveryTariffVersion!==DELIVERY_TARIFF_VERSION)throw new PreparedChinaFixtureUnavailable();
 const items:ReturnType<typeof preparedChinaModelPublicItem>[]=[];
 let reads=0;const id=new Set<string>();
 for(const chunk of limit?s.snapshot.chunks:[]){
  if(items.length>=limit||reads>=4)break;
  const meta=await s.snapshot.readChunk(chunk);
  for(let i=0;i<meta.partCount&&items.length<limit&&reads<4;i++){
   const part=await meta.load(i);reads++;
   for(const row of part.projection.items){
    if(items.length>=limit)break;
    if(row.market!=='china'||id.has(row.id))throw new PreparedChinaFixtureUnavailable();
    id.add(row.id);
    const adjusted=city?projectPreparedChinaDelivery(row,city):row;
    items.push(attachChinaSelection(preparedChinaModelPublicItem(adjusted,adjusted.totalRub||0),s.snapshot.generationId,city));
   }
  }
 }
 await s.assertCurrent();
 return {generationId:s.snapshot.generationId,total:s.snapshot.rows,items,facets:options?.navigation?s.snapshot.navigationFacets:undefined};
}
