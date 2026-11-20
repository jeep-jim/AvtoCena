import {createHash} from 'node:crypto';
import {getDataRoot,LocalJsonStorage,ObjectJsonStorage,StorageConflictError,type JsonStorage} from '../data';
import {preparedPriceCardBlockPath,preparedPriceCardDigest,verifyPriceCardBlock,type PreparedPriceCardDescriptor} from './prepared-price-card-block';
import {CATALOG_CHUNK_SIZE} from './runtime-config';
import type {PreparedPriceCoverageContext,PreparedPriceCoverageReport} from './prepared-price-coverage';
import type {CatalogManifest} from './storage';

type Event=Parameters<PreparedPriceCoverageContext['emit']>[0];
type RecordV1={version:1;ordinal:number;record:Event['record'];descriptor:PreparedPriceCardDescriptor;projectionBytes:number};
type Seal={version:1;state:'private_shadow_only';runId:string;scopeSha256:string;report:PreparedPriceCoverageReport;projectionBytes:number};
export type PrivatePriceSealAuthority={
 purpose:'local-private-price-seal-v1';runId:string;candidateGenerationId:string;expectedBaseGenerationId:string;
 baseEtag:string;baseManifestSha256:string;candidateMarketDigest:string;fxReceiptSha256:string;pricingFingerprint:string;
 calculationVersion:string;pricingAsOf:string;expectedAdmittedRows:number;expectedAdmittedIdsSha256:string;blockRows:number;expiresAt:number;freshSourceValidUntil?:number;
 backend:{kind:'local';dataRoot:string}|{kind:'mock-s3';origin:string;bucket:string;prefix:string;fixtureFetch:typeof fetch};
 assertAuthorized:()=>Promise<void>;
 /** Mock-only per-market fence. assertAuthorized verifies its own control CAS lease. */
 independentFixture?:true;
};
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/;
const MAX_VALUE=4*1024*1024,MAX_METADATA=16*1024,MAX_BLOCKS=1_000_000;
const fail=(reason:string):never=>{throw Error('prepared_price_private:'+reason);};
const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const openChain=(label:string)=>createHash('sha256').update(label+'\n');
const add=(chain:ReturnType<typeof createHash>,value:unknown)=>chain.update(JSON.stringify(value)+'\n');
const day=(ms:number)=>new Date(ms+7*3600000).toISOString().slice(0,10);

function prepareScope(storage:JsonStorage,authority?:PrivatePriceSealAuthority){
 if(!authority||authority.purpose!=='local-private-price-seal-v1'||typeof authority.assertAuthorized!=='function')return fail('authority_required');
 const a=Object.freeze({...authority,backend:Object.freeze({...authority.backend})});
 if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(a.runId)||!GEN.test(a.candidateGenerationId)||!GEN.test(a.expectedBaseGenerationId)||
    a.candidateGenerationId===a.expectedBaseGenerationId||!a.baseEtag||!Number.isFinite(Date.parse(a.pricingAsOf))||
    !Number.isSafeInteger(a.expectedAdmittedRows)||a.expectedAdmittedRows<1||a.expectedAdmittedRows>MAX_BLOCKS||
    !Number.isSafeInteger(a.blockRows)||a.blockRows<1||a.blockRows>128||
    !Number.isSafeInteger(a.expiresAt)||!storage.getBinary||!storage.putBinary||
    ![a.baseManifestSha256,a.candidateMarketDigest,a.fxReceiptSha256,a.pricingFingerprint,
      a.calculationVersion,a.expectedAdmittedIdsSha256].every(value=>SHA.test(value)))return fail('authority_scope');
 const assertBackend=()=>{
  if(a.backend.kind==='local'){
   if(!(storage instanceof LocalJsonStorage)||storage.driver!=='local'||getDataRoot()!==a.backend.dataRoot)return fail('backend');
  }else if(a.backend.kind==='mock-s3'){
   const b=a.backend;
   // The only object backend admitted by this local prototype is loopback
   // with synthetic fixture credentials and namespace. No prod enable flag.
   if(!(storage instanceof ObjectJsonStorage)||storage.driver!=='object'||
      !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(b.origin)||!/^fixture-[a-z0-9-]{1,32}$/.test(b.bucket)||
      !/^fixture-[a-z0-9-]{1,32}$/.test(b.prefix)||process.env.YC_OBJECT_STORAGE_ENDPOINT!==b.origin||
      process.env.YC_OBJECT_STORAGE_BUCKET!==b.bucket||process.env.YC_OBJECT_STORAGE_PREFIX!==b.prefix||
      process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID!=='fixture'||process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY!=='fixture'||
      typeof b.fixtureFetch!=='function'||globalThis.fetch!==b.fixtureFetch)
    return fail('backend');
  }else return fail('backend');
 };
 assertBackend();
 if(a.independentFixture&&a.backend.kind!=='mock-s3')return fail('backend');
 const asOf=Date.parse(a.pricingAsOf);
 if(a.freshSourceValidUntil!==undefined&&(!Number.isSafeInteger(a.freshSourceValidUntil)||a.freshSourceValidUntil!==a.expiresAt||
 a.freshSourceValidUntil<=asOf||a.freshSourceValidUntil>asOf+48*3600000))return fail('fresh_source_horizon');
 const basePath=a.independentFixture
  ?`catalog/market-activation-fixture-v1/china/generations/${a.candidateGenerationId}/prepared/private/${a.runId}/`
  :`catalog/private-prepared-prices-v1/china/${a.candidateGenerationId}/${a.runId}/`;
 const backendIdentity=a.backend.kind==='local'?['local',a.backend.dataRoot]:
  ['mock-s3',a.backend.origin,a.backend.bucket,a.backend.prefix];
 const scopeSha256=preparedPriceCardDigest([a.purpose,a.runId,a.candidateGenerationId,a.expectedBaseGenerationId,
  a.baseEtag,a.baseManifestSha256,a.candidateMarketDigest,a.fxReceiptSha256,a.pricingFingerprint,a.calculationVersion,
  a.pricingAsOf,a.expectedAdmittedRows,a.expectedAdmittedIdsSha256,a.blockRows,a.expiresAt,backendIdentity,...(a.independentFixture?['market-control-v1']:[]),...(a.freshSourceValidUntil===undefined?[]:['fresh-source-v1',a.freshSourceValidUntil])]);
 const clock=()=>{if(Date.now()<asOf||Date.now()>=a.expiresAt||a.freshSourceValidUntil===undefined&&day(Date.now())!==day(asOf))return fail('expired');};
 const gate=async()=>{
  clock();assertBackend();await a.assertAuthorized();assertBackend();clock();
  if(a.independentFixture)return;
  const active=await storage.readJsonWithMeta<CatalogManifest|null>('catalog/manifest.json',null);
  if(!active.found||!active.etag||active.etag!==a.baseEtag||active.value?.generationId!==a.expectedBaseGenerationId||
     preparedPriceCardDigest(active.value)!==a.baseManifestSha256)return fail('active_manifest');
  clock();assertBackend();
 };
 const read=async(relative:string,lengthLimit:number)=>{
  assertBackend();
  const body=await storage.getBinary!(basePath+relative);
  if(!Buffer.isBuffer(body.data)||body.data.length<1||body.data.length>lengthLimit)return fail('object_size');
  return body.data;
 };
 const put=async(relative:string,data:Buffer,validUntil:number)=>{
  await gate();if(Date.now()>=validUntil)return fail('expired');
  try{await storage.putBinary!(basePath+relative,data,'application/json',{ifNoneMatch:'*'});}
  catch(error){if(!(error instanceof StorageConflictError))throw error;}
  const back=await read(relative,data.length);
  if(!data.equals(back))return fail('object_readback');
 };
 return {a,basePath,scopeSha256,asOf,gate,put,read};
}
type Scope=ReturnType<typeof prepareScope>;
const ordinalName=(ordinal:number)=>String(ordinal).padStart(8,'0');
const recordKey=(ordinal:number)=>`records/${ordinalName(ordinal)}.json`;
const blockKey=(ordinal:number,hash:string)=>`blocks/${ordinalName(ordinal)}-${hash}.json`;
const projectionKey=(ordinal:number,hash:string)=>`projections/${ordinalName(ordinal)}-${hash}.json`;

function createEvidence(scope:Scope){
 const {a,asOf}=scope;
 const ids=openChain('prepared-ordered-admitted-ids-v1'), records=openChain('prepared-ordered-block-records-v1');
 let admittedRows=0,blockCount=0,artifactBytes=0,projectionBytes=0,peakBlockRows=0;
 let validUntil=a.freshSourceValidUntil??(Date.parse(day(asOf)+'T00:00:00Z')+86400000-7*3600000);
 return {
  get ordinal(){return blockCount+1;},
  add(meta:RecordV1,blockBytes:Buffer,projectionBytesBuffer:Buffer){
   const {descriptor:d,record:r,ordinal}=meta;
   const sourceChunk='chunk-'+String(Math.floor(admittedRows/CATALOG_CHUNK_SIZE)+1).padStart(4,'0');
   const part=Math.floor((admittedRows%CATALOG_CHUNK_SIZE)/a.blockRows);
   const count=Math.min(a.blockRows,CATALOG_CHUNK_SIZE-admittedRows%CATALOG_CHUNK_SIZE,a.expectedAdmittedRows-admittedRows);
   if(meta.version!==1||ordinal!==blockCount+1||ordinal>MAX_BLOCKS||count<1||d.market!=='china'||
      d.generationId!==a.candidateGenerationId||d.marketInventoryDigest!==a.candidateMarketDigest||
      d.fxReceiptSha256!==a.fxReceiptSha256||d.pricingFingerprint!==a.pricingFingerprint||
      d.calculationVersion!==a.calculationVersion||d.freshSourceValidUntil!==a.freshSourceValidUntil||d.pricingAsOf!==a.pricingAsOf||d.sourceChunk!==sourceChunk||d.part!==part||d.rows!==count||
      r.sourceChunk!==d.sourceChunk||r.part!==d.part||r.rows!==d.rows||r.sourceIdsSha256!==d.sourceIdsSha256||
      r.sourceInputSha256!==d.sourceInputSha256||r.key!==preparedPriceCardBlockPath(d)||r.artifactSha256!==d.contentSha256||
      r.projectionSha256!==d.projectionSha256||r.bytes!==d.bytes||r.tariffValidUntil!==d.tariffValidUntil||
      projectionBytesBuffer.length!==meta.projectionBytes||projectionBytesBuffer.length>MAX_VALUE||
      digest(projectionBytesBuffer)!==d.projectionSha256)return fail('block_identity');
   const block=verifyPriceCardBlock(blockBytes,d);
   const projection=JSON.parse(projectionBytesBuffer.toString('utf8'));
   if(projection?.generationId!==d.generationId||projection.items?.length!==count||
      block.details.some((row,i)=>projection.items[i]?.id!==row.id||projection.items[i]?.market!==d.market||projection.items[i]?.totalRub!==row.totalRub))
    return fail('projection_parity');
   for(const row of block.details)add(ids,row.id);
   add(records,r);
   admittedRows+=count;blockCount++;artifactBytes+=r.bytes;projectionBytes+=meta.projectionBytes;
   validUntil=Math.min(validUntil,r.tariffValidUntil);peakBlockRows=Math.max(peakBlockRows,count);
  },
  finish(report:PreparedPriceCoverageReport){
   if(report?.mode!=='shadow_coverage_only'||report.published!==false||report.candidateGenerationId!==a.candidateGenerationId||
      report.expectedBaseGenerationId!==a.expectedBaseGenerationId||report.activeManifestSha256!==a.baseManifestSha256||
      report.fxReceiptSha256!==a.fxReceiptSha256||report.pricingFingerprint!==a.pricingFingerprint||
      admittedRows!==a.expectedAdmittedRows||report.admittedRows!==admittedRows||
      report.blockCount!==blockCount||report.artifactBytes!==artifactBytes||report.peakBlockRows!==peakBlockRows||
      report.validUntil!==validUntil||Date.now()>=validUntil||
      report.orderedAdmittedIdsSha256!==a.expectedAdmittedIdsSha256||report.orderedAdmittedIdsSha256!==ids.digest('hex')||
      report.orderedBlockRecordsSha256!==records.digest('hex'))return fail('coverage');
   return projectionBytes;
  },
 };
}

/** Deliberately not connected to publisher. Requires an injected local permit.
 * A partial run has immutable leftovers, never an eligible activation seal. */
export function createPrivateChinaPriceSink(storage:JsonStorage,authority?:PrivatePriceSealAuthority){
 const scope=prepareScope(storage,authority),proof=createEvidence(scope);
 let busy=false,closed=false,poisoned=false;
 const exclusive=async<T>(fn:()=>Promise<T>)=>{
  if(busy){poisoned=true;return fail('sink_state');}
  if(closed||poisoned)return fail('sink_state');
  busy=true;
  try{return await fn();}catch(error){poisoned=true;throw error;}finally{busy=false;}
 };
 const emit=(event:Event)=>exclusive(async()=>{
  const ordinal=proof.ordinal,{record,block}=event;
  const projection=bytes(block.projection), data=Buffer.from(block.bytes);
  const meta:RecordV1={version:1,ordinal,record:structuredClone(record),descriptor:structuredClone(block.descriptor),projectionBytes:projection.length};
  proof.add(meta,data,projection);
  const encoded=bytes(meta);
  if(encoded.length>MAX_METADATA)return fail('metadata_size');
  await scope.put(blockKey(ordinal,meta.descriptor.contentSha256),data,meta.descriptor.tariffValidUntil);
  await scope.put(projectionKey(ordinal,meta.descriptor.projectionSha256),projection,meta.descriptor.tariffValidUntil);
  await scope.put(recordKey(ordinal),encoded,meta.descriptor.tariffValidUntil);
 });
 const complete=(report:PreparedPriceCoverageReport)=>exclusive(async()=>{
  await scope.gate();
  const projectionBytes=proof.finish(report);
  const seal:Seal={version:1,state:'private_shadow_only',runId:scope.a.runId,scopeSha256:scope.scopeSha256,report,projectionBytes};
  const encoded=bytes(seal);
  if(encoded.length>MAX_METADATA)return fail('metadata_size');
  await scope.put('seal.json',encoded,report.validUntil);await scope.gate();
  if(Date.now()>=report.validUntil)return fail('expired');
  closed=true;
  return {key:scope.basePath+'seal.json',sha256:digest(encoded)};
 });
 return {emit,complete};
}

/** Fresh readback walks only the predecessor-proved ordinals; no LIST and no
 * whole-market cache. A seal ref must come from trusted local coordination. */
export async function verifyPrivateChinaPriceSeal(storage:JsonStorage,authority:PrivatePriceSealAuthority,expectedSha256:string,visit?:(part:{descriptor:PreparedPriceCardDescriptor;block:Buffer;projection:Buffer})=>Promise<void>){
 const scope=prepareScope(storage,authority),proof=createEvidence(scope);
 if(!SHA.test(expectedSha256))return fail('seal_identity');
 await scope.gate();
 const stored=await scope.read('seal.json',MAX_METADATA);
 if(digest(stored)!==expectedSha256)return fail('seal_identity');
 const seal=JSON.parse(stored.toString('utf8')) as Seal;
 if(seal?.version!==1||seal.state!=='private_shadow_only'||seal.runId!==scope.a.runId||seal.scopeSha256!==scope.scopeSha256||
    !Number.isSafeInteger(seal.report?.blockCount)||seal.report.blockCount<1||seal.report.blockCount>scope.a.expectedAdmittedRows)
  return fail('seal_identity');
 for(let i=1;i<=seal.report.blockCount;i++){
  await scope.gate();
  const meta=JSON.parse((await scope.read(recordKey(i),MAX_METADATA)).toString('utf8')) as RecordV1;
  if(meta?.ordinal!==i||!SHA.test(meta.descriptor?.contentSha256)||!SHA.test(meta.descriptor?.projectionSha256))return fail('record_identity');
  const block=await scope.read(blockKey(i,meta.descriptor.contentSha256),MAX_VALUE);
  const projection=await scope.read(projectionKey(i,meta.descriptor.projectionSha256),MAX_VALUE);
  proof.add(meta,block,projection);
  if(visit)await visit({descriptor:meta.descriptor,block,projection});
 }
 if(proof.finish(seal.report)!==seal.projectionBytes)return fail('projection_coverage');
 await scope.gate();
 if(Date.now()>=seal.report.validUntil)return fail('expired');
 return seal;
}
