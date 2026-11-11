import {createHash} from 'node:crypto';
import {getJsonStorage,readDataJson,type JsonStorage} from '../data';
import {readCalculationIndex} from '../encyclopedia/calculation-index';
import {calculationCacheVersion} from './shared-budget-prices';
import {editorialHidden,editorialRevision,readCatalogEditorialFresh,withCatalogEditorialSnapshot} from './editorial';
import {DetailReadCache} from './detail-read-cache';
import {protectCatalogCardPhotos} from './photo-proxy-policy';
import {PUBLIC_CATALOG_MARKETS} from './runtime-config';
import type {PublicVehicleOffer} from './types';

const LIMIT=12,MAX_BYTES=2*1024*1024;
const day=(now=new Date())=>new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
type Context={editorialRevision:string;release:string|null;calculationVersion:string;encyclopediaDigest:string|null};
type Summary={sourceTotal:number;total:number;items:PublicVehicleOffer[]};
type Snapshot={version:1;generationId:string;policyDate:string;context:Context;markets:Record<string,Summary>};
type Manifest={generationId:string;markets?:Record<string,{count?:number}>};
type SearchResult={generationId:string;total:number;items:PublicVehicleOffer[]};
export function editorialHomeContext(revision=editorialRevision()):Context{
 return {editorialRevision:revision,release:process.env.AVTOCENA_RELEASE_SHA||null,
  calculationVersion:calculationCacheVersion(),encyclopediaDigest:readCalculationIndex()?.digest||null};
}
export function editorialHomePath(generationId:string,policyDate:string,context:Context){
 if(!/^[a-zA-Z0-9_-]+$/.test(generationId)||!/^\d{4}-\d{2}-\d{2}$/.test(policyDate))throw Error('catalog_editorial_home_scope_invalid');
 const key=createHash('sha256').update(JSON.stringify(context)).digest('hex');
 return `catalog/generations/${generationId}/indexes/editorial-home-v1/${policyDate}/${key}.json`;
}
/** Structural public-card proof only; search owns admission and price/specification policy. */
function validPublicCard(value:unknown,market:string):value is PublicVehicleOffer{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const item=value as Record<string,unknown>;
 return typeof item.id==='string'&&item.id.trim()===item.id&&item.id.length>0&&item.market===market
  &&typeof item.make==='string'&&!!item.make.trim()&&typeof item.model==='string'&&!!item.model.trim()
  &&Number.isSafeInteger(item.year)&&Number(item.year)>0
  &&typeof item.status==='string'&&['active','sold','removed','stale'].includes(item.status)
  &&typeof item.offerType==='string'&&['fixed','auction'].includes(item.offerType)
  &&Array.isArray(item.images)&&item.images.every(image=>image&&typeof image==='object'&&!Array.isArray(image)
   &&typeof image.url==='string'&&!!image.url.trim())
  &&(item.cardImageUrl===undefined||typeof item.cardImageUrl==='string')
  &&!Object.hasOwn(item,'sourceGroup')&&!Object.hasOwn(item,'operational');
}
function validSummary(value:Summary|undefined,market:string,count:number){
 return !!value&&Number.isInteger(count)&&count>=0&&value.sourceTotal===count
  &&Number.isInteger(value.total)&&value.total>=0&&value.total<=count&&Array.isArray(value.items)
  &&value.items.length===Math.min(value.total,LIMIT)
  &&value.items.every(item=>validPublicCard(item,market))
  &&new Set(value.items.map(item=>item.id)).size===value.items.length;
}
function matches(value:Snapshot|null,generationId:string,policyDate:string,context:Context){
 return !!value&&value.version===1&&value.generationId===generationId&&value.policyDate===policyDate
  &&JSON.stringify(value.context)===JSON.stringify(context)&&!!value.markets&&typeof value.markets==='object';
}
const reads=new DetailReadCache<Snapshot|null>({maxEntries:6,maxBytes:MAX_BYTES,ttlMs:60_000,concurrency:2,maxQueued:4,queueTimeoutMs:1000});
export function resetEditorialHomeCache(){reads.clear();}
/** Optional, exact-day derivative. A miss retains the existing authoritative search. */
export async function readEditorialHome(generationId:string,sourceCounts:Record<string,number|undefined>,markets:readonly string[]){
 try{
 const policyDate=day(),context=editorialHomeContext();
 if(!markets.length)return {} as Record<string,Summary>;
 const path=editorialHomePath(generationId,policyDate,context);
 const value=await reads.get(path,async()=>{
  const stored=await readDataJson<Snapshot|null>(path,null);
  return stored&&Buffer.byteLength(JSON.stringify(stored))<=MAX_BYTES?stored:null;
 }).catch(()=>null);
 // No yesterday result, changed normalization context or incomplete market is accepted.
 if(day()!==policyDate||JSON.stringify(editorialHomeContext())!==JSON.stringify(context)
   ||!matches(value,generationId,policyDate,context))return {} as Record<string,Summary>;
 return Object.fromEntries(markets.filter(market=>validSummary(value!.markets[market],market,sourceCounts[market]!)
   &&value!.markets[market].items.every(item=>!editorialHidden(item)))
  .map(market=>[market,{...value!.markets[market],items:value!.markets[market].items.map(protectCatalogCardPhotos)}]));
 }catch{
  // Decode/photo-shape errors in this optional derivative must preserve search.
  // The authoritative search runs outside this boundary and keeps its errors.
  return {} as Record<string,Summary>;
 }
}

/** Current-day preparation only. Search owns all selector, ordering, refill and price semantics.
 * It is never invoked from a visitor or a collector for an unpublished generation. */
export async function prepareEditorialHome({search,storage=getJsonStorage(),markets=PUBLIC_CATALOG_MARKETS,now=()=>new Date()}:{
 search:(market:typeof PUBLIC_CATALOG_MARKETS[number])=>Promise<SearchResult>;
 storage?:Pick<JsonStorage,'readJson'|'readJsonWithMeta'|'writeJson'>;
 markets?:readonly string[];now?:()=>Date;
}){
 const capturedDay=day(now()),manifest=await storage.readJson<Manifest|null>('catalog/manifest.json',null);
 if(!manifest?.generationId||!/^[a-zA-Z0-9_-]+$/.test(manifest.generationId))throw Error('catalog_editorial_home_manifest_invalid');
 const index=await readCatalogEditorialFresh(),context=editorialHomeContext(index.revision);
 const editorialProof=JSON.stringify(index),manifestProof=JSON.stringify(manifest);
 const selected=PUBLIC_CATALOG_MARKETS.filter(market=>market!=='japan'&&markets.includes(market)
  &&Object.values(index.entries).some(entry=>entry.market===market&&entry.status!=='visible'));
 const check=async()=>{
  const [currentManifest,currentEditorial]=await Promise.all([
   storage.readJson<Manifest|null>('catalog/manifest.json',null),readCatalogEditorialFresh(),
  ]);
  if(day(now())!==capturedDay)throw Error('catalog_editorial_home_date_changed');
  if(JSON.stringify(currentManifest)!==manifestProof)throw Error('catalog_editorial_home_generation_changed');
  if(JSON.stringify(currentEditorial)!==editorialProof)throw Error('catalog_editorial_home_revision_changed');
  if(JSON.stringify(editorialHomeContext(index.revision))!==JSON.stringify(context))throw Error('catalog_editorial_home_calculation_changed');
 };
 await check();
 const summaries:Record<string,Summary>={};
 await withCatalogEditorialSnapshot(index,async()=>{
  // Fixed two-search admission, all work joined before an error is propagated.
  for(let offset=0;offset<selected.length;offset+=2){
   const batch=await Promise.allSettled(selected.slice(offset,offset+2).map(async market=>{
    const count=manifest.markets?.[market]?.count;
    if(!Number.isInteger(count)||Number(count)<0)throw Error('catalog_editorial_home_source_count_invalid');
    const result=count===0?{generationId:manifest.generationId,total:0,items:[]}:await search(market);
    const summary={sourceTotal:count!,total:result.total,items:result.items};
    if(result.generationId!==manifest.generationId||!validSummary(summary,market,count!))throw Error('catalog_editorial_home_search_incomplete');
    summaries[market]=summary;
   }));
   const failure=batch.find(result=>result.status==='rejected');
   if(failure?.status==='rejected')throw failure.reason;
  }
 });
 await check();
 if(!selected.length)return {generationId:manifest.generationId,policyDate:capturedDay,markets:[],prepared:false};
 const value:Snapshot={version:1,generationId:manifest.generationId,policyDate:capturedDay,context,markets:summaries};
 if(Buffer.byteLength(JSON.stringify(value))>MAX_BYTES)throw Error('catalog_editorial_home_capacity');
 const path=editorialHomePath(manifest.generationId,capturedDay,context),previous=await storage.readJsonWithMeta(path,null);
 if(previous.found&&!previous.etag)throw Error('catalog_editorial_home_etag_required');
 await check();
 await storage.writeJson(path,value,previous.found?{ifMatch:previous.etag}:{ifNoneMatch:'*'});
 const stored=await storage.readJson(path,null);
 if(JSON.stringify(stored)!==JSON.stringify(value))throw Error('catalog_editorial_home_readback_mismatch');
 await check();
 return {generationId:manifest.generationId,policyDate:capturedDay,markets:selected,prepared:true};
}
