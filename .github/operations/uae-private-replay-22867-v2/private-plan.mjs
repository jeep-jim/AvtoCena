import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sha,hash} from './chain.mjs';
const K=/^(source-input|predecessor-evidence|dispositions|source-holds)$/;
const SHA=/^[a-f0-9]{64}$/, ID=/^[a-f0-9]{24}$/;
const req=(x,c)=>assert.ok(x,c);
export const BLOCK_LIMIT=4*1024*1024,TOTAL_LIMIT=192*1024*1024;
const finite=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
export function compactPrior(row,immutableKey,ordinal,{deliveredRub,seller}){
 req(row?.market==='uae'&&row.sourceId==='dubicars_uae_exact'&&ID.test(row.id)
  &&/^[1-9]\d*$/.test(String(row.sourceOfferId))&&typeof immutableKey==='string'&&Number.isSafeInteger(ordinal)&&ordinal>=0,
  'uae_prior_exact_compact_scope');
 const liveDelivered=deliveredRub(row);
 const nativePricing={calculationStatus:row.calculationStatus??null,catalogPricingMode:row.catalogPricingMode??null,
  exactInlineDeliveredRub:liveDelivered>0?liveDelivered:null, sellerRub:seller(row)?finite(row.sellerPriceRub):null,
  sourcePrice:finite(row.sourcePrice),sourceCurrency:row.sourceCurrency??null};
 return {id:row.id,market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:String(row.sourceOfferId),
  immutableKey,ordinal,rowSha256:hash(row),pricing: nativePricing,
  nativePriceEvidenceSha256:hash([nativePricing,row.calculationSnapshot??null,row.deliveredCalculationPreview??null,row.savedCalculationPreview??null]),
  appearedAt:row.firstSeenAt??null,updatedAt:row.updatedAt??null,lastSeenAt:row.operational?.lastSeenAt??null,
  photoCount:Array.isArray(row.images)?row.images.length:0,nativePhotoEvidenceSha256:hash(row.images??[])};
}
export async function planStream(base,name,rows,{blockLimit=BLOCK_LIMIT,rowLimit=256}={}){
 req(K.test(name)&&Number.isInteger(blockLimit)&&blockLimit>0&&blockLimit<=BLOCK_LIMIT
    &&Number.isInteger(rowLimit)&&rowLimit>0&&rowLimit<=256,'uae_private_plan_group');
 const p=path.join(base,name);await fs.mkdir(p,{mode:0o700});
 let count=0,total=0,bytes=0, n=0, pending=[];const chunks=[],h=createHash('sha256');
 async function flush(){
    if(!n)return;
    req(chunks.length<499,'uae_private_plan_too_many_chunks');
    const key=name+'/chunk-'+String(chunks.length).padStart(4,'0')+'.ndjson';
    const b=Buffer.concat(pending);req(b.length===bytes&&b.length>0&&b.length<=blockLimit,'uae_private_plan_encoded_chunk_size');
    await fs.writeFile(path.join(base,key),b,{flag:'wx',mode:0o600});
    chunks.push({key,rows:n,bytes:b.length,sha256:sha(b)});
    n=0;bytes=0;pending=[];
 }
 for(const row of rows){
   const b=Buffer.from(JSON.stringify(row)+'\n');req(b.length>0&&b.length<=blockLimit,'uae_private_plan_single_row_size');
   if(n&&(n===rowLimit||bytes+b.length>blockLimit))await flush();
   n++;count++;bytes+=b.length;total+=b.length;pending.push(b);h.update(b);
 }
 await flush();
 return {name,count,bytes:total,sha256:h.digest('hex'),chunks};
}
export function checkPlan(entries,sealBytes){
 req(entries.length===4&&new Set(entries.map(e=>e.name)).size===4&&entries.every(e=>K.test(e.name))
  &&Number.isSafeInteger(sealBytes)&&sealBytes>0&&sealBytes<=BLOCK_LIMIT,'uae_private_plan_schema');
 const all=entries.flatMap(x=>x.chunks);
 req(all.length<500&&new Set(all.map(x=>x.key)).size===all.length,'uae_private_plan_total_object_count');
 req(all.every(x=>/^((?:source-input|predecessor-evidence|dispositions|source-holds)\/chunk-\d{4}\.ndjson)$/.test(x.key)&&x.bytes>0&&x.bytes<=BLOCK_LIMIT&&
   x.rows>0&&x.rows<=256&&SHA.test(x.sha256)),'uae_private_plan_chunk_shape');
 const bytes=all.reduce((x,y)=>x+y.bytes,0)+sealBytes;
 const everyGroupExact=entries.every(e=>e.count===e.chunks.reduce((x,y)=>x+y.rows,0)&&e.bytes===e.chunks.reduce((x,y)=>x+y.bytes,0));
 req(everyGroupExact,'uae_private_plan_group_total');
 return {objects:all.length+1,shards:all.length,bytes,withinLimit:bytes<=TOTAL_LIMIT};
}
