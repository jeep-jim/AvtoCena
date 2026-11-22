import {createHash} from 'node:crypto';
import {ObjectJsonStorage,StorageConflictError,type JsonStorage} from '../data';
import {preparedPriceCardBlockPath,preparedPriceCardDigest,preparedPriceCardMarketDigest,verifyPriceCardBlock,type PreparedPriceCardDescriptor} from './prepared-price-card-block';
import {verifyPrivateChinaPriceSeal,type PrivatePriceSealAuthority} from './prepared-price-private-seal';
import {compilePreparedChinaModelScope,preparedChinaModelIndexedPrice,offerPath,writeCatalogManifestCas,type CatalogManifest,type CatalogPreparedChinaManifest,type CatalogSearchProjection,type CatalogFacets} from './storage';
import {CATALOG_CHUNK_SIZE} from './runtime-config';
import {createDetailSpool} from './detail-spool';
import {createPreparedChinaIdShardWriter,readPreparedChinaIdLocation,validPreparedChinaIdRoots,type PreparedChinaIdLocation} from './prepared-china-id-locator';
import {createPreparedChinaModelView,selectPreparedChinaModelPage,type PreparedChinaModelViewRef} from './prepared-china-model-view';
import {createChinaFixedCityViews,fixedChinaCityViewRef,type ChinaFixedCityRefs,type ChinaFixedCityScope} from './prepared-china-fixed-city';
import {DELIVERY_TARIFF_VERSION} from './city-delivery';
import type {VehicleOffer} from './types';
import {createChinaSelectorFacets,chinaSelectorNavigationQuery,summarizeChinaSelectorPart,type ChinaSelectorPart} from './prepared-china-streaming-selector';
import {createPreparedChinaFilterIndex,type PreparedChinaFilterIndexRef} from './prepared-china-filter-index';

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
export async function activatePreparedChinaFixture(input:{
 storage:ObjectJsonStorage;authority:PrivatePriceSealAuthority;sealSha256:string;
 unmarkedCandidate:CatalogManifest;candidateManifestSha256:string;
 verifyLegacyCandidate:(manifest:CatalogPreparedChinaManifest)=>Promise<void>;
 modelScope?:{make:string;model:string};
}){
 const {storage,sealSha256,verifyLegacyCandidate}=input;
 const a=Object.freeze({...input.authority,backend:Object.freeze({...input.authority.backend})});
 const backend=a.backend;
 if(backend.kind!=='mock-s3'||a.independentFixture||!(storage instanceof ObjectJsonStorage))return fail('mock_only');
 if(typeof verifyLegacyCandidate!=='function'||typeof a.assertAuthorized!=='function')return fail('authority_required');
 const assertBackend=()=>{
  if(globalThis.fetch!==backend.fixtureFetch||typeof backend.fixtureFetch!=='function'||
     !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(backend.origin)||
     !/^fixture-[a-z0-9-]{1,32}$/.test(backend.bucket)||!/^fixture-[a-z0-9-]{1,32}$/.test(backend.prefix)||
     process.env.YC_OBJECT_STORAGE_ENDPOINT!==backend.origin||process.env.YC_OBJECT_STORAGE_BUCKET!==backend.bucket||
     process.env.YC_OBJECT_STORAGE_PREFIX!==backend.prefix||process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID!=='fixture'||
     process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY!=='fixture')return fail('mock_only');
 };
 // The seal and active-CAS gate refer to the same original manifest.
 const gate=async()=>{
  assertBackend();await a.assertAuthorized();assertBackend();
  if(Date.now()>=a.expiresAt)return fail('expired');
  const m=await active(storage);
  if(!m.found||!m.etag||m.etag!==a.baseEtag||m.value?.version!==2||m.value.generationId!==a.expectedBaseGenerationId||
     preparedPriceCardDigest(m.value)!==a.baseManifestSha256)return fail('base_changed');
  assertBackend();if(Date.now()>=a.expiresAt)return fail('expired');
  return {...m,value:m.value};
 };
 const candidate:CatalogPreparedChinaManifest=structuredClone(input.unmarkedCandidate), china=candidate.markets?.china;
 if(a.purpose!=='local-private-price-seal-v1'||candidate.version!==2||candidate.generationId!==a.candidateGenerationId||
    !GEN.test(candidate.generationId)||!GEN.test(a.expectedBaseGenerationId)||!china||
    Object.hasOwn(china,'preparedChinaPriceReadV1')||Object.hasOwn(china,'preparedPriceReadV1')||
    preparedPriceCardDigest(candidate)!==input.candidateManifestSha256||
    preparedPriceCardMarketDigest(candidate,'china')!==a.candidateMarketDigest||china.count!==a.expectedAdmittedRows||
    china.chunks.length!==Math.ceil(china.count/CATALOG_CHUNK_SIZE)||china.chunks.length>MAX_CHUNKS||
    china.chunks.some((name,i)=>name!=='chunk-'+String(i+1).padStart(4,'0')))return fail('candidate');
 const base=await gate();
 const neighbors=(m:CatalogManifest)=>Object.fromEntries(Object.entries(m.markets).filter(([market])=>market!=='china'));
 if(JSON.stringify(neighbors(candidate))!==JSON.stringify(neighbors(base.value)))return fail('neighbor_manifest');
 for(const [market,entry] of Object.entries(neighbors(base.value))){
  // Equal metadata is not sufficient for a neighbor already bound to the old global generation.
  if(Object.hasOwn(entry,'preparedPriceReadV1')||Object.hasOwn(entry,'preparedChinaPriceReadV1'))return fail('neighbor_generation_bound');
  if(!/^[a-z][a-z0-9_-]{0,32}$/.test(market)||entry.chunks.length>MAX_CHUNKS)return fail('neighbor_scope');
  for(const name of entry.chunks){
   if(!CHUNK.test(name))return fail('neighbor_scope');
   assertBackend();
   const before=await read(storage,offerPath(base.value.generationId,market,name));
   assertBackend();
   await read(storage,offerPath(candidate.generationId,market,name),hash(before));
  }
 }
 const put=async(key:string,body:Buffer,validUntil:number)=>{
  await gate();if(Date.now()>=validUntil)return fail('expired');
  if(!body.length||body.length>MAX)return fail('write_size');
  try{await storage.putBinary(key,body,'application/json',{ifNoneMatch:'*'});}
  catch(error){if(!(error instanceof StorageConflictError))throw error;}
  assertBackend();
  if(!(await read(storage,key,hash(body))).equals(body))return fail('readback');
 };
 const sealed=await stagePreparedChinaArtifacts({candidate,authority:a,modelScope:input.modelScope,put,
  readObject:(key,expected)=>read(storage,key,expected),
  verifyParts:visit=>verifyPrivateChinaPriceSeal(storage,a,sealSha256,visit)});
 await verifyLegacyCandidate(structuredClone(sealed.marked));
 const current=await gate();
 if(Date.now()>=sealed.validUntil)return fail('expired');
 await writeCatalogManifestCas(storage,sealed.marked,{found:true,etag:current.etag!});
 return sealed.marked;
}

type SealedVisitor=NonNullable<Parameters<typeof verifyPrivateChinaPriceSeal>[3]>;
export async function stagePreparedChinaArtifacts(input:{
 candidate:CatalogPreparedChinaManifest;authority:PrivatePriceSealAuthority;modelScope?:{make:string;model:string};withFixedCities?:true;withStreamingSearch?:true;
 readObject:(key:string,sha?:string)=>Promise<Buffer>;put:(key:string,body:Buffer,validUntil:number)=>Promise<void>;
 verifyParts:(visit:SealedVisitor)=>ReturnType<typeof verifyPrivateChinaPriceSeal>;
}){
 const {candidate,authority:a,modelScope,readObject,put,verifyParts}=input,china=candidate.markets.china;
 if(!china||candidate.generationId!==a.candidateGenerationId||china.count!==a.expectedAdmittedRows||
    china.chunks.length!==Math.ceil(china.count/CATALOG_CHUNK_SIZE)||china.chunks.length>MAX_CHUNKS||
    china.chunks.some((name,i)=>name!=='chunk-'+String(i+1).padStart(4,'0'))||
    preparedPriceCardMarketDigest(candidate,'china')!==a.candidateMarketDigest)return fail('candidate');
 const model=modelScope?await compilePreparedChinaModelScope(modelScope.make,modelScope.model):null;
 if(modelScope&&!model)return fail('model_scope');
 const modelView=model?createPreparedChinaModelView(candidate.generationId,model.keySha256):null;
 const cityViews=input.withFixedCities?createChinaFixedCityViews(candidate.generationId):null;
 const spool=await createDetailSpool<PreparedChinaIdLocation>(256,{maxBucketBytes:8*1024*1024});
 try{
  const chunkSha256:string[]=[];
  const navigation=input.withStreamingSearch?createChinaSelectorFacets(candidate.generationId,chinaSelectorNavigationQuery):undefined;
  const filterIndex=input.withStreamingSearch?createPreparedChinaFilterIndex({generationId:candidate.generationId,marketDigest:a.candidateMarketDigest}):undefined;
  let minimumLegalValidUntil=Infinity;
  let chunkName='',rows:VehicleOffer[]=[],parts:PreparedPriceCardDescriptor[]=[],selectors:ChinaSelectorPart[]=[],offset=0,expectedRows=0;
  const flush=async()=>{
   if(!parts.length||offset!==expectedRows)return fail('chunk_coverage');
   const body=json({version:1,generationId:candidate.generationId,chunk:chunkName,parts,...(input.withStreamingSearch?{selectors}: {})} satisfies Chunk), sha=hash(body);
   await put(chunkPath(candidate.generationId,chunkName,sha),body,Math.min(...parts.map(p=>p.tariffValidUntil)));
   chunkSha256.push(sha);
  };
  const seal=await verifyParts(async({descriptor:d,block,projection})=>{
   if(d.sourceChunk!==chunkName){
    if(chunkName)await flush();
    if(china.chunks[chunkSha256.length]!==d.sourceChunk)return fail('chunk_coverage');
    chunkName=d.sourceChunk;parts=[];selectors=[];offset=0;
    expectedRows=Math.min(CATALOG_CHUNK_SIZE,china.count-chunkSha256.length*CATALOG_CHUNK_SIZE);
    if(!navigation){
     rows=parse<VehicleOffer[]>(await readObject(offerPath(candidate.generationId,'china',chunkName)));
     if(!isArray(rows)||rows.length!==expectedRows)return fail('candidate_rows');
    }
   }
   if(d.part!==parts.length||d.marketInventoryDigest!==a.candidateMarketDigest||offset+d.rows>expectedRows)
    return fail('candidate_rows');
   const native=navigation?parse<VehicleOffer[]>(await readObject(preparedChinaNativePartPath(d.generationId,d.sourceChunk,d.part),d.sourceInputSha256)):rows.slice(offset,offset+d.rows);
   if(!isArray(native)||native.length!==d.rows||preparedPriceCardDigest(native)!==d.sourceInputSha256)return fail('candidate_rows');
   await put(preparedPriceCardBlockPath(d),block,d.tariffValidUntil);
   await put(projectionPath(d),projection,d.tariffValidUntil);
   const projected=parse<Projection>(projection);
   if(navigation){
    selectors.push(summarizeChinaSelectorPart(projected.items));
    for(const row of projected.items)navigation.add(row);
   }
   const locations=projected.items.map((row,position)=>({id:row.id,chunk:d.sourceChunk,part:d.part,offset:position}));
   if(filterIndex)for(const [position,row] of projected.items.entries())filterIndex.add(row,locations[position]);
   await spool.append(locations);
   if(modelView||cityViews)for(const [i,row] of projected.items.entries()){
    if(modelView&&model?.matches(row))modelView.add({...locations[i],rub:preparedChinaModelIndexedPrice(row)});
    cityViews?.add(row,locations[i]);
   }
   minimumLegalValidUntil=Math.min(minimumLegalValidUntil,d.legalValidUntil??-Infinity);
   parts.push(d);offset+=d.rows;
  });
  await flush();
  if(chunkSha256.length!==china.chunks.length)return fail('directory_coverage');
  const validUntil=Math.min(a.expiresAt,seal.report.validUntil);
  const acceptedLegalHorizon=a.freshSourceValidUntil!==undefined&&Number.isSafeInteger(minimumLegalValidUntil)?minimumLegalValidUntil:undefined;
  const locators=createPreparedChinaIdShardWriter(candidate.generationId,(key,contents)=>put(key,contents,validUntil));
  await spool.publishShards(locators.write,true);
  const idRoots=locators.finish(seal.report.admittedRows);
  const directory:Directory={version:1,generationId:candidate.generationId,marketDigest:a.candidateMarketDigest,
   rows:seal.report.admittedRows,validUntil,...(acceptedLegalHorizon===undefined?{}:{legalValidUntil:acceptedLegalHorizon}),chunkSha256,idRoots,deliveryTariffVersion:DELIVERY_TARIFF_VERSION,
   ...(navigation?{streamingSelector:true as const,navigationFacets:navigation.finish()}:{}),
   ...(filterIndex?{filterIndex:await filterIndex.publish((key,contents)=>put(key,contents,validUntil))}:{}),
   ...(modelView?{modelView:await modelView.publish((key,contents)=>put(key,contents,validUntil))}:{}),
   ...(cityViews?{fixedCityViews:await cityViews.publish((key,contents)=>put(key,contents,validUntil))}:{})};
  const body=json(directory),directorySha256=hash(body);
  await put(directoryPath(candidate.generationId,directorySha256),body,directory.validUntil);
  const marked=structuredClone(candidate);
  marked.markets.china.preparedChinaPriceReadV1={directorySha256};
  return {marked,validUntil,legalValidUntil:acceptedLegalHorizon,report:seal.report};
 }finally{await spool.close();}
}

/** Authenticate one active snapshot for a bounded fixture request. */
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
  return {partCount:meta.parts.length,selectors:meta.selectors,load};
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
 return {generationId:m.generationId,chunks:[...c.chunks],rows:c.count,validUntil:dir.validUntil,legalValidUntil:acceptedLegalUntil,idRoots:dir.idRoots,
  modelView:dir.modelView,fixedCityViews:dir.fixedCityViews,deliveryTariffVersion:dir.deliveryTariffVersion,
  directorySha256:marker.directorySha256,streamingSelector:dir.streamingSelector,navigationFacets:dir.navigationFacets,readChunk,assertCurrent,locate,modelPage,cityPage};
}

export async function readActivePreparedChinaFixturePart(storage:JsonStorage,chunk:string,part:number){
 const snapshot=await openActivePreparedChinaFixture(storage);
 if(!snapshot)return null;
 const {projection,loadBlock}=await (await snapshot.readChunk(chunk)).load(part);
 const block=await loadBlock();
 await snapshot.assertCurrent();
 return {generationId:snapshot.generationId,projection,block};
}
