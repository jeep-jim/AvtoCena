import {createHash} from 'node:crypto';
import {ObjectJsonStorage,StorageConflictError,type JsonStorage} from '../data';
import {preparedPriceCardBlockPath,preparedPriceCardDigest,preparedPriceCardMarketDigest,verifyPriceCardBlock,type PreparedPriceCardDescriptor} from './prepared-price-card-block';
import {compilePreparedChinaModelScope,preparedChinaModelIndexedPrice,offerPath,type CatalogManifest,type CatalogPreparedChinaManifest,type CatalogSearchProjection,type CatalogFacets} from './storage';
import {CATALOG_CHUNK_SIZE} from './runtime-config';
import {createDetailSpool} from './detail-spool';
import {createPreparedChinaIdShardWriter,readPreparedChinaIdLocation,validPreparedChinaIdRoots,type PreparedChinaIdLocation} from './prepared-china-id-locator';
import {createPreparedChinaModelView,selectPreparedChinaModelPage,type PreparedChinaModelViewRef} from './prepared-china-model-view';
import {createChinaFixedCityViews,fixedChinaCityViewRef,type ChinaFixedCityRefs,type ChinaFixedCityScope} from './prepared-china-fixed-city';
import {DELIVERY_TARIFF_VERSION} from './city-delivery';
import type {VehicleOffer} from './types';
import {createChinaSelectorFacets,chinaSelectorNavigationQuery,summarizeChinaSelectorPart,type ChinaSelectorPart} from './prepared-china-streaming-selector';
import {selectPreparedChinaFilterPage,type PreparedChinaFilterIndexRef} from './prepared-china-filter-index';
import type {CatalogSearchParams} from './types';

const ACTIVE='catalog/manifest.json',MAX=4*1024*1024,MAX_CHUNKS=2_000;
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,CHUNK=/^chunk-\d{4,10}$/;
const fail=(reason:string):never=>{throw Error('prepared_china_fixture:'+reason);};
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const json=(value:unknown)=>Buffer.from(JSON.stringify(value));
const parse=<T>(value:Buffer)=>JSON.parse(value.toString('utf8')) as T;
const {isArray}=Array;
type Directory={version:1;generationId:string;marketDigest:string;validUntil:number;legalValidUntil?:number;rows:number;chunkSha256:string[];idRoots?:Array<string|null>;modelView?:PreparedChinaModelViewRef;fixedCityViews?:ChinaFixedCityRefs;deliveryTariffVersion?:string;streamingSelector?:true;navigationFacets?:CatalogFacets;filterIndex?:PreparedChinaFilterIndexRef};
type Chunk={version:1;generationId:string;chunk:string;parts:PreparedPriceCardDescriptor[];selectors?:ChinaSelectorPart[]};
type Projection={generationId:string;items:CatalogSearchProjection[]};
const location=(g:string)=>`catalog/generations/${g}/indexes/prepared-china-read-v1/`;
const directoryPath=(g:string,d:string)=>location(g)+`directory-${d}.json`;
const chunkPath=(g:string,c:string,d:string)=>location(g)+`chunks/${c}-${d}.json`;
const projectionPath=(d:PreparedPriceCardDescriptor)=>location(d.generationId)+`projections/${d.sourceChunk}/${d.part}-${d.projectionSha256}.json`;
/** Block-sized exact native input; keep the same protected offers/china
 * prefix. Only independently staged streaming generations use this layout. */
export const preparedChinaNativePartPath=(g:string,chunk:string,part:number)=>offerPath(g,'china',chunk+'.part-'+part);
const inventoryDigest=(m:CatalogPreparedChinaManifest)=>{const unmarked=structuredClone(m);delete unmarked.markets.china.preparedChinaPriceReadV1;return preparedPriceCardMarketDigest(unmarked,'china');};
const active=(storage:JsonStorage)=>storage.readJsonWithMeta<CatalogPreparedChinaManifest|null>(ACTIVE,null);
async function read(storage:JsonStorage,key:string,expected?:string){
 if(!storage.getBinary)return fail('storage');
 const {data}=await storage.getBinary(key);
 if(!Buffer.isBuffer(data)||!data.length||data.length>MAX||(expected&&hash(data)!==expected))return fail('read_integrity');
 return data;
}

/** Explicit mock CAS proof only. No app or publisher callers. The precondition
 * verifies candidate legacy dependencies with fixture-specific authority. */
export async function openActivePreparedChinaFixture(storage:JsonStorage){
 const base=await active(storage),m=base.value;
 if(!m?.markets?.china||!Object.hasOwn(m.markets.china,'preparedChinaPriceReadV1'))return null;
 if(!base.found||!base.etag)return fail('reader_scope');
 return openPreparedChinaSnapshot(m,(key,expected)=>read(storage,key,expected),async()=>{
  const end=await active(storage);
  if(!end.found||end.etag!==base.etag||preparedPriceCardDigest(end.value)!==preparedPriceCardDigest(m))return fail('active_changed');
 });
}

/** The caller authenticates this manifest against one market's authority. */
export async function openPreparedChinaSnapshot(m:CatalogPreparedChinaManifest,
 readObject:(key:string,sha?:string)=>Promise<Buffer>,assertBinding:()=>Promise<void>,acceptedLegalUntil?:number){
 const c=m?.markets?.china,marker=c?.preparedChinaPriceReadV1;
 if(!c||m.version!==2||!GEN.test(m.generationId)||
    !marker||!SHA.test(marker.directorySha256)||!isArray(c.chunks)||c.chunks.length>MAX_CHUNKS)return fail('reader_scope');
 const dir=parse<Directory>(await readObject(directoryPath(m.generationId,marker.directorySha256),marker.directorySha256));
 const servingUntil=acceptedLegalUntil??dir.validUntil;
 if(acceptedLegalUntil!==undefined&&(!Number.isSafeInteger(acceptedLegalUntil)||dir.legalValidUntil!==acceptedLegalUntil||
    acceptedLegalUntil<dir.validUntil))return fail('accepted_legal_binding');
 if(dir.version!==1||dir.generationId!==m.generationId||dir.marketDigest!==inventoryDigest(m)||dir.rows!==c.count||
    !Number.isSafeInteger(dir.validUntil)||Date.now()>=servingUntil||!isArray(dir.chunkSha256)||
    dir.chunkSha256.length!==c.chunks.length||(dir.streamingSelector===true?dir.navigationFacets?.generationId!==m.generationId:dir.streamingSelector!==undefined||dir.navigationFacets!==undefined)||c.chunks.some((chunk,i)=>!CHUNK.test(chunk)||!SHA.test(dir.chunkSha256[i])))
  return fail('directory_scope');
 const assertCurrent=async()=>{
  await assertBinding();
  if(Date.now()>=servingUntil)return fail('active_changed');
 };
 const readChunk=async(chunk:string)=>{
  const at=c.chunks.indexOf(chunk);
  if(at<0)return fail('reader_scope');
  const chunkHash=dir.chunkSha256[at],meta=parse<Chunk>(await readObject(chunkPath(m.generationId,chunk,chunkHash),chunkHash));
  if(meta.version!==1||meta.generationId!==m.generationId||meta.chunk!==chunk||!isArray(meta.parts)||
     !meta.parts.length||meta.parts.length>CATALOG_CHUNK_SIZE||
     (dir.streamingSelector?(!isArray(meta.selectors)||meta.selectors.length!==meta.parts.length):meta.selectors!==undefined))return fail('part_scope');
  let nativeBody:Promise<Buffer>|undefined;
  const load=async(part:number)=>{
   const d=meta.parts[part];
   if(!Number.isSafeInteger(part)||part<0||part>=CATALOG_CHUNK_SIZE||!d||d.market!=='china'||
      d.generationId!==m.generationId||d.sourceChunk!==chunk||d.part!==part||d.marketInventoryDigest!==dir.marketDigest||
      !SHA.test(d.projectionSha256)||(acceptedLegalUntil!==undefined&&(!Number.isSafeInteger(d.legalValidUntil)||d.legalValidUntil!<acceptedLegalUntil))||
      Date.now()>=(acceptedLegalUntil??d.tariffValidUntil))return fail('part_scope');
   const projection=parse<Projection>(await readObject(projectionPath(d),d.projectionSha256));
   if(projection.generationId!==m.generationId||!isArray(projection.items)||projection.items.length!==d.rows||
      projection.items.some(row=>row.market!=='china'||!Number.isSafeInteger(row.totalRub)||!(row.totalRub!>0))||
      preparedPriceCardDigest(projection.items.map(row=>row.id))!==d.sourceIdsSha256)return fail('projection_parity');
   const loadBlock=async()=>{
    const block=verifyPriceCardBlock(await readObject(preparedPriceCardBlockPath(d),d.contentSha256),d);
    if(block.details.some((row,i)=>projection.items[i]?.id!==row.id||projection.items[i]?.totalRub!==row.totalRub))
     return fail('projection_parity');
    return block;
   };
   const loadNativePart=async()=>{
    let rows:VehicleOffer[];
    if(dir.streamingSelector){
     rows=parse<VehicleOffer[]>(await readObject(preparedChinaNativePartPath(m.generationId,chunk,part),d.sourceInputSha256));
    }else{
     const native=parse<VehicleOffer[]>(await (nativeBody??=readObject(offerPath(m.generationId,'china',chunk))));
     const offset=meta.parts.slice(0,part).reduce((sum,previous)=>sum+previous.rows,0);
     rows=isArray(native)?native.slice(offset,offset+d.rows):[];
    }
    if(!isArray(rows)||rows.length!==d.rows||preparedPriceCardDigest(rows)!==d.sourceInputSha256)return fail('candidate_rows');
    return rows;
   };
   return {projection,loadBlock,loadNativePart};
  };
  return {partCount:meta.parts.length,partRows:meta.parts.map(part=>part?.rows),selectors:meta.selectors,load};
 };
 // Native independently staged China packs seal fixed-size canonical chunks.
 // Select by absolute ordinal without downloading preceding or unrelated parts.
 const canonicalWindow=async(start:number,size:number,countOnly:boolean)=>{
  if(!dir.streamingSelector)return null;
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(size)||size<1||size>48||!Number.isSafeInteger(start+size)||
     !Number.isSafeInteger(dir.rows)||dir.rows<1||c.chunks.length!==Math.ceil(dir.rows/CATALOG_CHUNK_SIZE)||
     c.chunks.some((chunk,i)=>chunk!=='chunk-'+String(i+1).padStart(4,'0')))return fail('canonical_window_scope');
  const end=Math.min(start+size,dir.rows);
  if(countOnly||start>=end)return {total:dir.rows,items:[]};
  const reads:Promise<CatalogSearchProjection[]>[]=[];
  for(let i=Math.floor(start/CATALOG_CHUNK_SIZE);i*CATALOG_CHUNK_SIZE<end;i++){
   const origin=i*CATALOG_CHUNK_SIZE,rows=Math.min(CATALOG_CHUNK_SIZE,dir.rows-origin);
   reads.push((async()=>{
    const meta=await readChunk(c.chunks[i]);
    if(meta.partRows.some(n=>!Number.isSafeInteger(n)||n<1||n>128)||
       meta.partRows.reduce((total,n)=>total+n,0)!==rows)return fail('canonical_window_coverage');
    const parts:Promise<CatalogSearchProjection[]>[]=[];
    let offset=origin;
    for(const [part,n] of meta.partRows.entries()){
     const lo=Math.max(0,start-offset),hi=Math.min(n,end-offset);
     if(hi>lo)parts.push(meta.load(part).then(x=>x.projection.items.slice(lo,hi)));
     offset+=n;
    }
    return (await Promise.all(parts)).flat();
   })());
  }
  const items=(await Promise.all(reads)).flat();
  if(items.length!==end-start||new Set(items.map(row=>row.id)).size!==items.length)return fail('canonical_window_coverage');
  return {total:dir.rows,items};
 };
  const locate=async(id:string)=>{
  if(!validPreparedChinaIdRoots(dir.idRoots))return fail('id_directory_scope');
  return readPreparedChinaIdLocation(m.generationId,dir.idRoots,id,(key,checksum)=>readObject(key,checksum));
 };
 const modelPage=async(keySha256:string,input:Parameters<typeof selectPreparedChinaModelPage>[2])=>{
  const ref=dir.modelView;
  if(!Object.hasOwn(dir,'modelView'))return null;
  if(!ref||!SHA.test(ref.keySha256)||!SHA.test(ref.viewSha256))return fail('model_scope');
  if(ref.keySha256!==keySha256)return null;
  return selectPreparedChinaModelPage(m.generationId,ref,input,(key,checksum)=>readObject(key,checksum));
 };
 const cityPage=async(scope:ChinaFixedCityScope,input:Parameters<typeof selectPreparedChinaModelPage>[2])=>{
  const ref=fixedChinaCityViewRef(dir.fixedCityViews,scope);
  return ref?selectPreparedChinaModelPage(m.generationId,ref,input,(key,checksum)=>readObject(key,checksum)):null;
 };
 const filterPage=async(params:CatalogSearchParams,input:Parameters<typeof selectPreparedChinaFilterPage>[3])=>{
  if(!Object.hasOwn(dir,'filterIndex'))return null;
  return selectPreparedChinaFilterPage({generationId:m.generationId,marketDigest:dir.marketDigest,rows:dir.rows},dir.filterIndex!,params,input,readObject);
 };
 return {generationId:m.generationId,chunks:[...c.chunks],rows:c.count,validUntil:dir.validUntil,legalValidUntil:acceptedLegalUntil,idRoots:dir.idRoots,
  modelView:dir.modelView,fixedCityViews:dir.fixedCityViews,deliveryTariffVersion:dir.deliveryTariffVersion,
  directorySha256:marker.directorySha256,streamingSelector:dir.streamingSelector,navigationFacets:dir.navigationFacets,filterIndex:dir.filterIndex,readChunk,assertCurrent,locate,modelPage,cityPage,filterPage,canonicalWindow};
}

export async function readActivePreparedChinaFixturePart(storage:JsonStorage,chunk:string,part:number){
 const snapshot=await openActivePreparedChinaFixture(storage);
 if(!snapshot)return null;
 const {projection,loadBlock}=await (await snapshot.readChunk(chunk)).load(part);
 const block=await loadBlock();
 await snapshot.assertCurrent();
 return {generationId:snapshot.generationId,projection,block};
}
