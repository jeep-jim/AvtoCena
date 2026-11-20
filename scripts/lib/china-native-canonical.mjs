import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {digest,readVerifiedLocalFile} from './china-shadow-disk.mjs';

// This is packaging, not a source/status, canonical admission, price or
// publication authority. Status must come from a separately verified V2 cut.
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,ID=/^[A-Za-z0-9_:-]{1,150}$/;
const MiB=1024**2,MAX_RECEIPT=8*MiB,MAX_PART=4*MiB;
export const CHINA_LOCAL_CANONICAL_CHUNK_MAX_BYTES=16*MiB;
const json=x=>Buffer.from(JSON.stringify(x)),hash=x=>digest(json(x)),decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const need=(ok,code)=>{if(!ok)throw Error('china_native_canonical:'+code);};
const keys=x=>x&&typeof x==='object'&&!Array.isArray(x);
const sourceId=x=>typeof x==='string'&&/^[a-z0-9_-]{1,100}$/.test(x);
const room=(dir,root)=>dir===root||dir.startsWith(root+path.sep)||root.startsWith(dir+path.sep);
const nameFor=(prefix,i)=>prefix+String(i+1).padStart(4,'0')+'.json';
const date=value=>typeof value==='string'?Date.parse(value):NaN;
const awarePower=['powerKw','icePowerKw','motorPeakKw','power30MinKw','utilizationPowerKw','power30MinKwByMotor'];
const priceStatusReasons=['sold','removed'];
const possibleReason=/^[a-z0-9][a-z0-9_:.-]{0,159}$/;

async function localRoot(dir){
 need(typeof dir==='string'&&path.isAbsolute(dir)&&path.normalize(dir)===dir&&await fs.realpath(dir)===dir,'input_scope');
 return dir;
}
async function pinnedManifest(root,file,sha256){
 need(SHA.test(sha256??''),'external_pin_required');
 const p=path.join(root,file);
 const meta=await fs.lstat(p);
 need(meta.isFile()&&meta.nlink===1,'manifest_scope');
 return decode(await readVerifiedLocalFile(root,file,{bytes:meta.size,sha256},MAX_RECEIPT));
}
function withdrawal({item,observedAt}){
 const t=date(item?.removedAt);
 need(keys(item)&&ID.test(item.id??'')&&item.market==='china'&&priceStatusReasons.includes(item.reason)&&
   typeof item.make==='string'&&item.make.length>0&&item.make.length<=150&&typeof item.model==='string'&&item.model.length>0&&item.model.length<=150&&
   Number.isFinite(t)&&t<=observedAt&&item.evidence?.state===item.reason&&SHA.test(item.evidence?.sha256??''),'withdrawal_evidence');
 return {id:item.id,market:'china',make:item.make,model:item.model,reason:item.reason,removedAt:item.removedAt};
}
function readCanonical(native,status){
 const canonical=status.canonical??native;
 need(keys(canonical)&&native.status==='active'&&canonical.id===native.id&&canonical.market==='china'&&canonical.status==='active'&&
   canonical.sourceId===native.sourceId&&canonical.sourceOfferId===native.sourceOfferId&&
   typeof canonical.make==='string'&&canonical.make.length&&typeof canonical.model==='string'&&canonical.model.length&&
   Number.isSafeInteger(canonical.year)&&Number.isFinite(canonical.sourcePrice)&&canonical.sourcePrice>0&&canonical.sourceCurrency==='CNY'&&
   !canonical.deliveryCity&&!canonical.modificationSelection&&!canonical.editorialPriceKey&&canonical.catalogPricingMode!=='seller'&&
   SHA.test(status.canonicalSha256??'')&&hash(canonical)===status.canonicalSha256,'canonical_identity_or_input');
 if(native.sourceCurrency==='USD'){
  const lock=canonical.chinaPriceConversion;
  need(lock?.sourceCurrency==='USD'&&Number.isFinite(native.sourcePrice)&&native.sourcePrice>0&&
    lock.sourcePrice===native.sourcePrice&&lock.sourcePriceCny===canonical.sourcePrice&&
    Number.isFinite(lock.usdRub)&&lock.usdRub>0&&Number.isFinite(lock.cnyRub)&&lock.cnyRub>0&&
    Number.isFinite(date(lock.rateDate)),'china_price_anchor_required');
 }else{
  need(native.sourceCurrency==='CNY'&&native.sourcePrice===canonical.sourcePrice&&
    (!native.chinaPriceConversion||hash(native.chinaPriceConversion)===hash(canonical.chinaPriceConversion??null)),'china_source_price_changed');
 }
 // An attested canonical override can change display labels/strip bulky raw
 // payload but may not silently overwrite incoming power or exact evidence.
 for(const field of awarePower){
  if(native[field]!==undefined&&native[field]!==null)need(hash(native[field])===hash(canonical[field]??null),'native_kw_changed');
  const input=native.operational?.semanticEvidence?.[field],out=canonical.operational?.semanticEvidence?.[field];
  if(input?.status==='exact')need(hash(input)===hash(out??null),'native_kw_evidence_changed');
 }
 return canonical;
}
const CHE168='autohome_used_china_open',PROVIDER='auto_api_che168';
async function verifyFreshReplacement({nativeDir,authorityDir,native,nativeSha256,verdict,replacementSha256,nativeAt,nativeExpiry}){
 need(SHA.test(replacementSha256??'')&&verdict.replacementProofSha256===replacementSha256&&
  verdict.inventorySealSha256===replacementSha256&&verdict.priorWithdrawals?.length===0,'fresh_replacement_pin');
 const proof=await pinnedManifest(authorityDir,'FRESH_REPLACEMENT.json',replacementSha256);
 need(proof.version===1&&proof.kind==='china-complete-source-replacement-v1'&&proof.market==='china'&&
  proof.coverage==='materialized-full-active-snapshot'&&proof.previousServingGeneration==='rollback-only'&&
  proof.publicationAuthorized===false&&proof.cursorAdvanceAuthorized===false&&
  SHA.test(proof.ownerApprovalSha256??'')&&SHA.test(proof.continuitySha256??'')&&SHA.test(proof.collectorClosureSha256??'')&&
  proof.nativeAdmissionSha256===nativeSha256&&proof.nativeShardsSha256===native.shardsSha256&&
  proof.archiveManifestSha256===native.archiveManifestSha256&&proof.sourceReceiptSha256===native.receiptSha256&&
  proof.rawReport?.path==='native-report.json'&&proof.rawReport.sha256===native.reportSha256&&proof.rows===native.sourceRows&&
  verdict.allowedSourceIds?.length===1&&verdict.allowedSourceIds[0]===CHE168,'full_snapshot_proof_required');
 // Continuity binds the restored receipt and *provider replica*, not prior
 // published offer rows. A replica+changes producer can attest a full result;
 // a changes-only export can never be used as a replacement.
 const continuity=await pinnedManifest(nativeDir,'LOCAL_CONTINUITY.json',proof.continuitySha256);
 const raw=decode(await readVerifiedLocalFile(authorityDir,proof.rawReport.path,proof.rawReport,128*MiB));
 const paid=Array.isArray(raw.sources)?raw.sources.filter(x=>x.provider===PROVIDER):[],selected=paid[0];
 need(continuity.version===1&&continuity.kind==='china-local-conversion-continuity-only'&&
  continuity.nativeAdmissionSha256===nativeSha256&&continuity.archiveManifestSha256===native.archiveManifestSha256&&
  continuity.preparedShardsSha256===native.shardsSha256&&continuity.rows===native.sourceRows&&
  date(continuity.sourceExpiresAt)===nativeExpiry&&continuity.publishAuthorized===false&&continuity.cursorAdvanceAuthorized===false&&
  raw.version===1&&raw.market==='china'&&raw.provider===PROVIDER&&raw.completed===true&&!raw.failure&&
  raw.productionWrites===false&&date(raw.completedAt)===nativeAt&&paid.length===1&&selected.sourceId===CHE168&&
  selected.completeInventory===true&&selected.stopReason==='source_finished'&&selected.rejectedIdentity===0&&
  selected.uniqueOffers===native.sourceRows&&selected.observations===native.sourceRows&&
  Number.isSafeInteger(selected.cursor)&&selected.cursor>0&&selected.cursor===verdict.source?.cursor?.sequence&&
  selected.cursor===continuity.candidate?.cursor&&selected.replica?.cursor===selected.cursor&&
  SHA.test(selected.snapshotBinding??'')&&selected.replica?.binding===selected.snapshotBinding&&
  SHA.test(selected.replica?.sha256??'')&&selected.replica.sha256===continuity.candidate.replicaSha256&&
  selected.replica.sha256===verdict.source.cursor.anchorSha256&&
  SHA.test(verdict.orderedAdmittedIdsSha256??''),'full_snapshot_report_not_complete');
 return selected;
}
function enforceFullFreshRow(row,selected,observedAt){
 const v=row.operational?.che168ActiveVerification;
 need(row.sourceId===CHE168&&row.status==='active'&&row.operational?.provider==='auto-api.com'&&
  row.operational?.detailIdentityVerified===true&&/^\d+$/.test(row.sourceOfferId)&&
  row.id===digest(Buffer.from(CHE168+':'+row.sourceOfferId)).slice(0,24)&&
  v?.method==='snapshot_and_complete_change_stream'&&v.snapshotBinding===selected.snapshotBinding&&
  v.cursor===selected.cursor&&date(v.verifiedAt)===observedAt,'full_snapshot_row_verification');
}
export async function buildChinaCanonicalFromNative({nativeRoot,authorityRoot,out,nativeSha256,dispositionSha256,inputsSha256,replacementSha256,now=Date.now}){
 const nativeDir=await localRoot(nativeRoot),authorityDir=await localRoot(authorityRoot);
 need(typeof out==='string'&&path.isAbsolute(out)&&path.normalize(out)===out&&
   /^avtocena-china-canonical-[a-z0-9-]{1,45}$/.test(path.basename(out))&&
   await fs.realpath(path.dirname(out))===path.dirname(out)&&!room(out,nativeDir)&&!room(out,authorityDir),'output_scope');
 const native=await pinnedManifest(nativeDir,'LOCAL_ADMISSION.json',nativeSha256);
 const verdict=await pinnedManifest(authorityDir,'VERIFIED_DISPOSITION.json',dispositionSha256);
 const env=await pinnedManifest(authorityDir,'SHADOW_INPUTS.json',inputsSha256);
 const nativeAt=date(native.sourceCompletedAt),nativeExpiry=date(native.sourceExpiresAt),source=verdict.source;
 const current=()=>need(now()>=nativeAt&&now()<source.validUntil,'source_expired');
 need(native.version===1&&native.kind==='china-local-confirmed-input-only'&&native.inventoryV2SealIssued===false&&
   native.publicationAuthorized===false&&native.cursorAdvanceAuthorized===false&&Number.isSafeInteger(native.sourceRows)&&
   native.sourceRows>0&&native.sourceRows<=1_000_000&&native.priced===false&&native.providerRequests===0&&
   [native.archiveManifestSha256,native.receiptSha256,native.reportSha256,native.shardsSha256].every(x=>SHA.test(x??''))&&
   Array.isArray(native.shards)&&native.shards.length>0&&native.shards.length<=2000&&hash(native.shards)===native.shardsSha256&&
   Number.isFinite(nativeAt)&&Number.isFinite(nativeExpiry)&&nativeExpiry>nativeAt,'native_receipt');
 const replacement=replacementSha256!==undefined||verdict.replacementProofSha256!==undefined;
 need((replacement?verdict.version===1&&verdict.kind==='china-verified-fresh-disposition-v1'&&verdict.inventoryV2SealIssued===false:
   verdict.version===2&&verdict.kind==='china-verified-native-disposition-v2'&&verdict.inventoryV2SealIssued===true)&&verdict.market==='china'&&verdict.publicationAuthorized===false&&verdict.cursorAdvanceAuthorized===false&&
   verdict.nativeAdmissionSha256===nativeSha256&&verdict.nativeShardsSha256===native.shardsSha256&&verdict.archiveManifestSha256===native.archiveManifestSha256&&
   verdict.reportSha256===native.reportSha256&&SHA.test(verdict.inventorySealSha256??'')&&SHA.test(verdict.admissionPolicySha256??'')&&
   source?.observedAt===nativeAt&&source?.receiptSha256===native.receiptSha256&&Number.isSafeInteger(source?.validUntil)&&
   source.validUntil>nativeAt&&source.validUntil<=nativeExpiry&&keys(source.cursor)&&
   typeof source.cursor.stream==='string'&&source.cursor.stream.length>0&&source.cursor.stream.length<=96&&
   Number.isSafeInteger(source.cursor.sequence)&&source.cursor.sequence>=0&&SHA.test(source.cursor.anchorSha256??'')&&
   Array.isArray(verdict.shards)&&verdict.shards.length===native.shards.length&&
   Array.isArray(verdict.priorWithdrawals)&&verdict.priorWithdrawals.length<=1024&&
   Array.isArray(verdict.allowedSourceIds)&&verdict.allowedSourceIds.length>0&&verdict.allowedSourceIds.length<=16&&
   verdict.allowedSourceIds.every(sourceId)&&new Set(verdict.allowedSourceIds).size===verdict.allowedSourceIds.length,
   replacement?'verified_fresh_disposition_required':'verified_v2_disposition_required');
 current();
 const selectedSource=replacement?await verifyFreshReplacement({nativeDir,authorityDir,native,nativeSha256,verdict,replacementSha256,nativeAt,nativeExpiry}):null;
 // Pin runtime/FX/oracle to this exact verified disposition, never to an old
 // price day or a lookalike package. Existing CLI validates the frozen FX wire.
 need(env.version===1&&env.kind==='china-offline-shadow-inputs-v1'&&env.dispositionSha256===dispositionSha256&&
   env.inventorySealSha256===verdict.inventorySealSha256&&GEN.test(env.generationId??'')&&
   [env.pricingFingerprint,env.calculationVersion,env.fx?.receiptSha256].every(x=>SHA.test(x??''))&&env.fx?.receipt?.market==='china'&&
   hash(env.fx.receipt)===env.fx.receiptSha256&&typeof env.modelScope?.make==='string'&&env.modelScope.make.length>0&&
   typeof env.modelScope?.model==='string'&&env.modelScope.model.length>0&&
   Number.isSafeInteger(env.blockRows)&&env.blockRows>=1&&env.blockRows<=128&&
   (env.withFixedCities===undefined||env.withFixedCities===true)&&
   Array.isArray(env.runtimeFiles)&&env.runtimeFiles.length>0&&env.runtimeFiles.length<=2000&&
   env.evidence?.archive?.path==='evidence/archive-receipt.json'&&env.evidence.archive.sha256===source.receiptSha256&&
   env.evidence?.oracle?.path==='evidence/legacy-oracle.json','sealed_shadow_inputs_required');
 current();
 const inputs=[...env.runtimeFiles,env.evidence.archive,env.evidence.oracle],usedPaths=new Set();
 for(const f of env.runtimeFiles)need(f?.path?.startsWith('context/data/'),'runtime_scope');
 for(const f of inputs){
  need(!usedPaths.has(f.path),'duplicate_evidence_path');usedPaths.add(f.path);
 }
 const allowed=new Set(verdict.allowedSourceIds),seen=new Set(),withdrawn=[],withdrawnIds=new Set(),excludedReasons=new Map();
 const acceptWithdrawal=item=>{
  const row=withdrawal({item,observedAt:source.observedAt});
  need(!withdrawnIds.has(row.id)&&withdrawn.length<1024,'withdrawal_limit_or_duplicate');
  withdrawnIds.add(row.id);withdrawn.push(row);
 };
 for(const item of verdict.priorWithdrawals)acceptWithdrawal(item);
 const chunkOut=[],plan=[],ids=createHash('sha256').update('prepared-ordered-admitted-ids-v1\n');
 let rowsRead=0,bytesRead=0,admitted=0,excluded=0,withdrawnNative=0,batch=[],db,putCanonical;
 const spool=path.join(out,'.ordered-canonical.sqlite');
 // Exclusive new private directory; shadow-package.json is the last written
 // readiness file. No publish, HTTP/storage connector or cursor side effects.
 await fs.mkdir(out,{mode:0o700});
 let success=false;
 const write=async(rel,contents)=>{
  const dst=path.join(out,rel);
  await fs.mkdir(path.dirname(dst),{recursive:true,mode:0o700});
  await fs.writeFile(dst,contents,{flag:'wx',mode:0o600});
  return {path:rel,bytes:contents.length,sha256:digest(contents)};
 };
 const flush=async()=>{
  if(!batch.length)return;
  const name=nameFor('chunk-',chunkOut.length),contents=json(batch);
  need(contents.length<=CHINA_LOCAL_CANONICAL_CHUNK_MAX_BYTES,'local_chunk_budget');
  for(let i=0;i<batch.length;i+=env.blockRows){
   const block=batch.slice(i,i+env.blockRows),contents=json(block);
   need(contents.length<=MAX_PART,'native_price_block_budget');
   plan.push({sourceChunk:name.slice(0,-5),part:i/env.blockRows,rows:block.length,
    sourceIdsSha256:hash(block.map(x=>x.id)),sourceInputSha256:digest(contents)});
  }
  chunkOut.push({...await write('canonical/'+name,contents),rows:batch.length});batch=[];
 };
 const emit=async(row)=>{
  batch.push(row);ids.update(JSON.stringify(row.id)+'\n');
  if(batch.length===500)await flush();
 };
 try{
  if(replacement){
   const {DatabaseSync}=await import('node:sqlite');
   db=new DatabaseSync(spool);await fs.chmod(spool,0o600);
   db.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-16384; CREATE TABLE ordered(ord INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL); BEGIN');
   putCanonical=db.prepare('INSERT INTO ordered VALUES (?,?,?)');
  }
  for(const [i,shard] of native.shards.entries()){
   current();
   const status=verdict.shards[i],name=nameFor('catalog-rebuild-china-',i);
   need(shard?.file===name&&status?.file===nameFor('disposition-',i)&&status.nativeSha256===shard.sha256,'shard_binding');
   const raw=await readVerifiedLocalFile(nativeDir,name,shard,i===0?128*MiB:16*MiB);
   const disposition=decode(await readVerifiedLocalFile(authorityDir,status.file,status,32*MiB)),converted=decode(raw);
   bytesRead+=raw.length;
   need(converted?.market==='china'&&Array.isArray(converted.offers)&&converted.count===converted.offers.length&&
    converted.count>=1&&converted.count<=500&&Array.isArray(disposition)&&disposition.length===converted.count,'shard_census');
   for(const [j,row] of converted.offers.entries()){
    const d=disposition[j];
    need(row?.market==='china'&&ID.test(row.id??'')&&allowed.has(row.sourceId)&&typeof row.sourceOfferId==='string'&&row.sourceOfferId.length&&
      d?.id===row.id&&d.inputSha256===hash(row)&&!seen.has(row.id)&&!withdrawnIds.has(row.id),'source_row_binding');
    if(selectedSource)enforceFullFreshRow(row,selectedSource,nativeAt);
    seen.add(row.id);rowsRead++;
    if(d.state==='admitted'){
     const canonical=readCanonical(row,d);admitted++;
     if(replacement){
      need(Number.isSafeInteger(d.nativeSelectedOrdinal)&&d.nativeSelectedOrdinal>=0&&d.nativeSelectedOrdinal<native.sourceRows,'fresh_selected_ordinal');
      try{putCanonical.run(d.nativeSelectedOrdinal,row.id,JSON.stringify(canonical));}
      catch(error){if(error?.errcode===1555||error?.errcode===2067)need(false,'duplicate_selected_ordinal');throw error;}
      if(admitted%500===0)db.exec('COMMIT; BEGIN');
     }else await emit(canonical);
    }else if(d.state==='excluded'){
     need(typeof d.reason==='string'&&possibleReason.test(d.reason)&&!priceStatusReasons.includes(d.reason)&&
      !d.canonical&&!d.withdrawal,'exclusion_disposition');
     excludedReasons.set(d.reason,(excludedReasons.get(d.reason)||0)+1);excluded++;
    }else if(d.state==='withdrawn'){
     need(!replacement,'full_snapshot_excludes_no_implied_withdrawal');
     need(d.withdrawal?.id===row.id&&!d.canonical,'withdrawal_identity');
     acceptWithdrawal(d.withdrawal);withdrawnNative++;
    }else need(false,'missing_disposition');
   }
  }
  if(replacement){
   db.exec('COMMIT');let ordinal=0;
   for(const item of db.prepare('SELECT ord,id,payload FROM ordered ORDER BY ord').iterate()){
    if(ordinal%500===0)current();
    need(item.ord===ordinal++,'fresh_selected_ordinal_gap');
    const row=JSON.parse(item.payload);
    need(row.id===item.id,'fresh_selected_ordinal_identity');
    await emit(row);
   }
   need(ordinal===admitted,'fresh_selected_count');
   db.close();db=undefined;await fs.unlink(spool);
  }
  await flush();current();
  const expectedAdmittedIdsSha256=ids.digest('hex');
  if(replacement)need(expectedAdmittedIdsSha256===verdict.orderedAdmittedIdsSha256,'fresh_selected_order_digest');
  need(rowsRead===native.sourceRows&&bytesRead===native.outputBytes&&admitted>0&&rowsRead===admitted+excluded+withdrawnNative&&
    admitted===verdict.counts?.admitted&&excluded===verdict.counts?.excluded&&withdrawnNative===verdict.counts?.withdrawnNative&&
    withdrawn.length===verdict.counts?.withdrawnTotal,'source_disposition_census');
  for(const f of inputs)await write(f.path,await readVerifiedLocalFile(authorityDir,f.path,f,f.path.startsWith('context/data/')?64*MiB:16*MiB));
  const stats={sourceRows:rowsRead,admitted,excluded,withdrawnNative,withdrawnPrior:withdrawn.length-withdrawnNative,withdrawnTotal:withdrawn.length,
   exclusions:Object.fromEntries([...excludedReasons].sort(([a],[b])=>a.localeCompare(b)))};
  const spec={version:1,market:'china',stage:'canonical-admitted-v1',generationId:env.generationId,count:admitted,chunks:chunkOut,plan,
   runtimeFiles:env.runtimeFiles,evidence:env.evidence,archiveReceiptSha256:env.evidence.archive.sha256,legacyOracleSha256:env.evidence.oracle.sha256,
   withdrawn,modelScope:env.modelScope,withFixedCities:env.withFixedCities,withStreamingSearch:true,
   source,fx:env.fx,pricingFingerprint:env.pricingFingerprint,calculationVersion:env.calculationVersion,
   expectedAdmittedIdsSha256,blockRows:env.blockRows,
   conversion:{nativeSha256,dispositionSha256,inventorySealSha256:verdict.inventorySealSha256,admissionPolicySha256:verdict.admissionPolicySha256,inputsSha256,
    ...(replacement?{mode:'complete-fresh-replacement',replacementProofSha256:replacementSha256,previousServingGeneration:'rollback-only'}:{}),...stats}};
  const body=json(spec);
  need(body.length<=MAX_RECEIPT,'manifest_budget');
  const report={status:'offline_canonical_packaged_not_published',...stats,chunks:chunkOut.length,blocks:plan.length,
   expectSha256:digest(body),publicationAuthorized:false,cursorAdvanceAuthorized:false};
  await write('LOCAL_CANONICAL.json',json(report));current();
  await write('shadow-package.json',body);
  success=true;return report;
 }finally{if(db)db.close();if(!success)await fs.rm(out,{recursive:true,force:true});}
}
