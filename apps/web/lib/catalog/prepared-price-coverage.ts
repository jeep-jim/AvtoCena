import {createHash} from 'node:crypto';
import type {CatalogManifest} from './storage';
import type {FreshChinaPriceReplay} from './prepared-china-fresh-price-replay';
import type {VehicleOffer} from './types';
import type {CatalogFxBatch} from './rates';
import {preparePriceCardBlock,preparedPriceCardDigest} from './prepared-price-card-block';

const sha=/^[a-f0-9]{64}$/;
const fail=(code:string):never=>{throw Error('catalog_price_shadow_coverage:'+code);};
const ordered=(domain:string)=>createHash('sha256').update(domain+'\n');
const append=(hash:ReturnType<typeof createHash>,value:unknown)=>hash.update(JSON.stringify(value)+'\n');
export function createPreparedCoverageIdsDigest(){
 const chain=ordered('prepared-ordered-admitted-ids-v1');
 return {add:(id:string)=>append(chain,id),finish:()=>chain.digest('hex')};
}
export function preparedCoverageIdsDigest(ids:Iterable<string>){
 const hash=createPreparedCoverageIdsDigest();
 for(const id of ids)hash.add(id);
 return hash.finish();
}

export type PreparedPriceExpectedBlock={
 sourceChunk:string;part:number;rows:number;sourceIdsSha256:string;sourceInputSha256:string;
};
export type PreparedPriceCoverageContext={
 candidateGenerationId:string;expectedBaseGenerationId:string;expectedAdmittedRows:number;expectedAdmittedIdsSha256:string;
 blockRows:number;fx:CatalogFxBatch;pricingFingerprint:string;freshSourceValidUntil?:number;priceReplay?:FreshChinaPriceReplay;
 expectedBlocks:()=>AsyncIterable<PreparedPriceExpectedBlock>;
 emit:(event:{record:PreparedPriceExpectedBlock & {key:string;artifactSha256:string;projectionSha256:string;bytes:number;tariffValidUntil:number};
   block:Awaited<ReturnType<typeof preparePriceCardBlock>>})=>Promise<void>;
};
export type PreparedPriceCoverageReport={
 mode:'shadow_coverage_only';published:false;candidateGenerationId:string;expectedBaseGenerationId:string;activeManifestSha256:string;
 admittedRows:number;orderedAdmittedIdsSha256:string;blockCount:number;orderedBlockRecordsSha256:string;
 artifactBytes:number;peakBlockRows:number;validUntil:number;fxReceiptSha256:string;pricingFingerprint:string;
};

/** Source rows are the real canonical order, not sorted or deduped again.
 * Keep only one bounded block. Await the shadow sink before the next one. */
export async function streamChinaPriceCoverage({manifest,source,context,chunkSize,assertActive,takeId}:{
 manifest:CatalogManifest;source:Iterable<VehicleOffer>|AsyncIterable<VehicleOffer>;context:PreparedPriceCoverageContext;
 chunkSize:number;assertActive:()=>Promise<string>;takeId:(id:string)=>boolean;
}):Promise<PreparedPriceCoverageReport>{
 const scope=Object.freeze({...context});
 const market=manifest.markets.china;
 if(!Number.isSafeInteger(scope.blockRows)||scope.blockRows<1||scope.blockRows>128||
    !Number.isSafeInteger(chunkSize)||chunkSize<1||!Number.isSafeInteger(scope.expectedAdmittedRows)||
    scope.expectedAdmittedRows<1||market.count!==scope.expectedAdmittedRows||
    !sha.test(scope.expectedAdmittedIdsSha256)||!sha.test(scope.pricingFingerprint)||
    scope.fx.receipt.market!=='china'||manifest.generationId!==scope.candidateGenerationId)return fail('scope');
 const activeManifestSha256=await assertActive(), plan=scope.expectedBlocks()[Symbol.asyncIterator]();
 const asOf=Date.parse(scope.fx.receipt.pricingAsOf);
 const businessDay=new Date(asOf+7*3600000).toISOString().slice(0,10);
 if(scope.freshSourceValidUntil!==undefined&&(!Number.isSafeInteger(scope.freshSourceValidUntil)||
   scope.freshSourceValidUntil<=asOf||scope.freshSourceValidUntil>asOf+48*3600000))return fail('fresh_source_horizon');
 let validUntil=scope.freshSourceValidUntil??(Date.parse(businessDay+'T00:00:00Z')+86400000-7*3600000);
 let planClosed=false;
 const closePlan=async()=>{if(!planClosed){planClosed=true;await plan.return?.();}};
 const assertHorizon=()=>{if(Date.now()>=validUntil)return fail('horizon');};
 const ids=ordered('prepared-ordered-admitted-ids-v1'), receipts=ordered('prepared-ordered-block-records-v1');
 let admittedRows=0, blockCount=0, artifactBytes=0,peakBlockRows=0;
 let position=0, buffer:VehicleOffer[]=[];
 const flush=async()=>{
  if(!buffer.length)return;
  assertHorizon();
  const sourceChunk=market.chunks[Math.floor(position/chunkSize)];
  const part=Math.floor((position%chunkSize)/scope.blockRows);
  const rows=buffer, recordBase={
   sourceChunk,part,rows:rows.length,sourceIdsSha256:preparedPriceCardDigest(rows.map(row=>row.id)),
   sourceInputSha256:preparedPriceCardDigest(rows)};
  buffer=[];
  const expected=await plan.next();
  if(expected.done)return fail('missing_block');
  const want=expected.value;
  if(want.sourceChunk!==sourceChunk||want.part!==part||want.rows!==rows.length||
     want.sourceIdsSha256!==recordBase.sourceIdsSha256||want.sourceInputSha256!==recordBase.sourceInputSha256)return fail('block_identity');
  if(await assertActive()!==activeManifestSha256)return fail('active_manifest');
  const block=await preparePriceCardBlock({manifest,market:'china',sourceChunk,part,offers:rows,sourceInputSha256:recordBase.sourceInputSha256,
   fx:scope.fx,pricingFingerprint:scope.pricingFingerprint,freshSourceValidUntil:scope.freshSourceValidUntil,priceReplay:scope.priceReplay});
  const record={...recordBase,key:block.path,artifactSha256:block.descriptor.contentSha256,
   projectionSha256:block.projectionSha256,bytes:block.bytes.length,tariffValidUntil:block.descriptor.tariffValidUntil};
  validUntil=Math.min(validUntil,record.tariffValidUntil);
  if(await assertActive()!==activeManifestSha256)return fail('active_manifest');
  append(receipts,record);
  await scope.emit({record:Object.freeze(record),block});
  artifactBytes+=record.bytes;
  peakBlockRows=Math.max(peakBlockRows,rows.length);blockCount++;position+=rows.length;
 };
 try{
  for await(const row of source){
   if(row.market!=='china'||++admittedRows>market.count)return fail('extra_admitted');
   // Consume the native writer's existing admission set. This adds no second
   // market-sized set, and catches a duplicated ID even if the plan repeats it.
   if(!takeId(row.id))return fail('duplicate_or_unknown_identity');
   append(ids,row.id);buffer.push(row);
   if(buffer.length===scope.blockRows||admittedRows%chunkSize===0)await flush();
  }
  await flush();
  if(!(await plan.next()).done)return fail('extra_block');
  await closePlan();
  const orderedAdmittedIdsSha256=ids.digest('hex');
  if(admittedRows!==scope.expectedAdmittedRows||orderedAdmittedIdsSha256!==scope.expectedAdmittedIdsSha256)return fail('admitted_ids');
  if(await assertActive()!==activeManifestSha256)return fail('active_manifest');
  assertHorizon();
  return {mode:'shadow_coverage_only',published:false,candidateGenerationId:manifest.generationId,
   expectedBaseGenerationId:scope.expectedBaseGenerationId,activeManifestSha256,admittedRows,orderedAdmittedIdsSha256,
   blockCount,orderedBlockRecordsSha256:receipts.digest('hex'),artifactBytes,peakBlockRows,validUntil,
   fxReceiptSha256:scope.fx.receiptSha256,pricingFingerprint:scope.pricingFingerprint};
 }finally{await closePlan();}
}
