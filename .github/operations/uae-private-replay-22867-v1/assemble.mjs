import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash,sha,FRESH} from './chain.mjs';
import {ORIGIN} from './replay.mjs';
const req=(x,c)=>assert.ok(x,c);
const id=/^[a-f0-9]{24}$/, hex=/^[a-f0-9]{64}$/;
const kindOf=k=>k==='seller'||k==='onRequest'||k==='retainedDelivered';
const privateField=/(?:authorization|secret|token|passwd|password|sessioncookie|privatekey|phototoken|vin|framenumber|sellerphone|selleremail|rawpayload)$/i;
const publicSource=(link,isImage)=>{
 const u=new URL(link);
 return u.origin==='https://www.dubicars.com'&&!u.username&&!u.password&&!u.search&&!u.hash
   &&(isImage?u.pathname.startsWith('/images/')&&/\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname):/[-]\d+\.html$/.test(u.pathname));
};
function safeBody(o){
 if(o==null||typeof o!=='object')return true;
 if(Array.isArray(o))return o.every(safeBody);
 return Object.entries(o).every(([k,v])=>!privateField.test(k)&&k!=='raw'&&safeBody(v));
}
/** Pure exact reader shape. Inputs must be same-job results of the authenticated production gates.
 * No module sets pointers, issues network requests, or reads a global manifest. */
export async function assemblePrivate({qualified,proof,ports,runId,generationId,outDir,clock=Date.now}){
 req(qualified?.canProposeReady===true&&qualified.sourceReceipt?.kind==='uae-full-source-replay-evidence-v1'
  &&qualified.sourceReceipt?.deltaSeal===FRESH.seal&&qualified.sourceReceipt?.deltaChain===FRESH.chain
  &&qualified.sourceReceipt?.unknownBuyerRows===0&&qualified.sourceReceipt?.unresolvedPredecessor===0
  &&qualified.sourceReceipt?.rawHeld===0&&qualified.doNotPublish===true,'uae_ready_qualification_refused');
 req(/^[1-9]\d{8,14}$/.test(runId)&&/^gen_\d{13}_[a-z0-9_-]{1,60}$/.test(generationId),'uae_ready_id_scope');
 req(Number.isSafeInteger(proof?.legalValidUntil)&&proof.legalValidUntil>clock()
  &&['editorialReceiptSha256','retainedDetailReceiptSha256'].every(k=>hex.test(proof[k]))
  &&proof.editorialReceiptSha256===qualified.priceReceipt.editorialSha256
  &&proof.retainedDetailReceiptSha256===qualified.priceReceipt.retainedDetailsSha256
  &&proof.legalValidUntil===qualified.priceReceipt.legalValidUntil,'uae_ready_binding_refused');
 const s=await fs.lstat(outDir);
 req(outDir===path.resolve(outDir)&&await fs.realpath(outDir)===outDir&&s.isDirectory()&&!(s.mode&0o077)&&!(await fs.readdir(outDir)).length,
  'uae_ready_private_directory');
 const put=async(name,obj,cap=4*1024*1024)=>{
  req(/^(?:(?:source-receipt|price-receipt|public-directory|READY)\.json|projection\/\d{1,3}\.json|details\/[a-f0-9]{2}\.json)$/.test(name),'uae_ready_private_output_path');
  const file=path.join(outDir,name),wire=Buffer.from(JSON.stringify(obj));
  req(wire.length>0&&wire.length<=cap,'uae_ready_partition_bytes');
  await fs.mkdir(path.dirname(file),{mode:0o700,recursive:true});await fs.writeFile(file,wire,{flag:'wx',mode:0o600});
  req(sha(await fs.readFile(file))===sha(wire),'uae_ready_file_readback');return sha(wire);
 };
 const admitted={seller:0,onRequest:0,retainedDelivered:0}, seen=new Set(), byShard=new Map(), rows=[];
 for(const raw of qualified.details){
   const d=ports.sanitizeNativeDetail(raw);
   req(d?.id===raw.id&&d.market==='uae'&&d.sourceId===ORIGIN&&d.status==='active'&&id.test(d.id)&&!seen.has(d.id)
      &&d.operational?.sourceUrl&&publicSource(d.operational.sourceUrl,false)&&
      (d.images??[]).every(x=>x?.url&&publicSource(x.url,true)&&!x.objectKey)&&safeBody(d),'uae_ready_public_detail_scope');
   req(d.sellerPriceRub===raw.sellerPriceRub&&ports.deliveredRub(d)===ports.deliveredRub(raw)&&d.sourcePrice===raw.sourcePrice,'uae_ready_sanitize_price_changed');
   const kind=ports.kindFromExactNative(d);req(kindOf(kind),'uae_ready_detail_price_kind');
   admitted[kind]++;
   seen.add(d.id);const shard=sha(d.id).slice(0,2);
   if(!byShard.has(shard))byShard.set(shard,[]);
   byShard.get(shard).push(d);
   const item=ports.nativeProjection(d);
   req(item?.id===d.id&&item.market==='uae'&&item.sourceGroup===ORIGIN&&safeBody(item)
       &&(kind==='retainedDelivered'?item.totalRub===ports.deliveredRub(d):!(Number(item.totalRub)>0))
       &&(kind==='seller'?item.sellerPriceRub===d.sellerPriceRub:!(Number(item.sellerPriceRub)>0)),
     'uae_ready_projection_price_mismatch');
   rows.push(item);
 }
 req(seen.size>0&&hash(admitted)===hash(qualified.admitted),'uae_ready_exact_admitted_membership');
 const sourceReceiptSha256=await put('source-receipt.json',qualified.sourceReceipt),priceReceiptSha256=await put('price-receipt.json',qualified.priceReceipt);
 const blocks=[],detailShards={};
 for(let i=0;i<rows.length;i+=256){
   const items=rows.slice(i,i+256),ordinal=blocks.length;req(ordinal<512,'uae_ready_projection_block_bound');
   blocks.push({rows:items.length,sha256:await put('projection/'+ordinal+'.json',{version:1,market:'uae',generationId,ordinal,items})});
 }
 for(const [shard,items] of byShard){
   req(items.length>0&&items.length<=512,'uae_ready_detail_shard_bound');
   detailShards[shard]={rows:items.length,sha256:await put('details/'+shard+'.json',{version:1,market:'uae',generationId,shard,items})};
 }
 const dir={version:1,kind:'uae-public-directory-v1',market:'uae',generationId,sourceReceiptSha256,priceReceiptSha256,admitted,blocks,detailShards};
 const publicDirectorySha256=await put('public-directory.json',dir);
 req(clock()<proof.legalValidUntil,'uae_ready_legal_expired_before_seal');
 const ready={version:1,kind:'uae-private-runtime-ready-v1',market:'uae',runId,generationId,sourceReceiptSha256,priceReceiptSha256,
  retainedDetailReceiptSha256:proof.retainedDetailReceiptSha256,publicDirectorySha256,editorialReceiptSha256:proof.editorialReceiptSha256,
  admitted,legalValidUntil:proof.legalValidUntil};
 return {readySha256:await put('READY.json',ready,32*1024),privateFilesOnly:true,published:false};
}
