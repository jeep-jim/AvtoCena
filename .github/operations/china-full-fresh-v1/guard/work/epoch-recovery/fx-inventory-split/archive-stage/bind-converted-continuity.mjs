/** Same-run local bridge. It does not collect, reconvert, mint a V2 inventory
 * seal, or write to source storage / cursor. The V2 retention step must follow. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash}from'node:crypto';import{constants}from'node:fs';
import{actual}from'./prepare-native-archive.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),digest=x=>sha(JSON.stringify(x)),hex=/^[a-f0-9]{64}$/;
const liveCapabilities=new WeakSet();
export function isBoundChinaContinuity(v){return liveCapabilities.has(v);}
const need=(v,k)=>{if(!v)throw Error('china_continuity_'+k);};
export const expected=Object.freeze({publicSha:'4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038',publicGeneration:'gen_1794878284419_a611dfcf',
 internalSha:'df7d672ed585349a06e6718429f5496978f1cf625eacd55a7fc6d7483a72edc4',internalGeneration:'gen_1795145660283_bbfbf3d1',
 appliedCursorSha:'ea61f0889d966f68ccae3ad30ac6de8d486911e80344df8c8ab745c24eb3f34c',appliedCursorETag:'"d6948b6ab14de88ee77f905f6689e195"',appliedCursorGeneration:'gen_1792660229591_c103ed94',appliedCursor:12360638,candidateCursor:13123821,
 sourceAt:actual.completedAt,reportSha:actual.reportSha256,archiveSha:actual.archiveSha256,receiptSha:actual.receiptSha256,rows:actual.rows});
async function readLocal(file,max){
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await h.stat();need(s.isFile()&&s.nlink===1&&s.size>0&&s.size<=max,'local_scope');const b=await h.readFile();need(b.length===s.size&&(await h.stat()).mtimeMs===s.mtimeMs,'local_changed');return b;}finally{await h.close();}
}
const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const captured=(r,hash,tag)=>{need(Buffer.isBuffer(r?.body)&&r.body.length<=4*1024**2&&sha(r.body)===hash&&(!tag||tag===r.etag),'baseline_identity');return decode(r.body);};
export async function bindConvertedContinuity({convertedRoot,admissionSha256,archiveReportPath,readAuthenticatedSnapshot,now=Date.now,pins=expected}){
 // Snapshot callback is a pinned read-only authority, not a caller supplied JSON path.
 // Require exact hash+ETag observed independently, and actual old replica evidence.
 need(typeof readAuthenticatedSnapshot==='function'&&hex.test(admissionSha256||'')&&path.isAbsolute(convertedRoot)&&await fs.realpath(convertedRoot)===convertedRoot,'scope');
 const sourceEpoch=Date.parse(pins.sourceAt)+48*3600000;const time=()=>need(now()>=Date.parse(pins.sourceAt)&&now()<sourceEpoch,'source_expired');
 async function snapshot(){
  time();const a=await readAuthenticatedSnapshot();time();
  const pub=captured(a.public,pins.publicSha),int=captured(a.internal,pins.internalSha),cursor=captured(a.appliedCursor,pins.appliedCursorSha,pins.appliedCursorETag);
  need(pub?.generationId===pins.publicGeneration&&int?.generationId===pins.internalGeneration&&cursor?.generationId===pins.appliedCursorGeneration&&cursor?.version===1&&cursor.market==='china','baseline_generation');
  need(a.lease===null||a.lease?.lockedUntil===''||Number.isFinite(Date.parse(a.lease?.lockedUntil))&&Date.parse(a.lease.lockedUntil)<=now(),'shared_lease_active');
  const ctl=a.controls;need(ctl?.version===1&&ctl.markets?.china?.enabled===true&&ctl.sources?.che168_feed?.enabled===true&&ctl.sources?.ajes_china_feed?.enabled===false,'owner_controls');
  const matches=cursor?.sources?.filter(s=>s.provider==='auto_api_che168')??[];
  const source=matches[0],replica=source?.replica;
  need(matches.length===1&&source.cursor===pins.appliedCursor&&source.stopReason==='source_finished'&&
   /^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}$/.test(replica?.key||'')&&hex.test(replica?.sha256||'')&&hex.test(source.snapshotBinding||''),'applied_cursor_identity');
  const currentReplica=a.appliedReplica?.value;
  need(a.appliedReplica?.key===replica.key+'/manifest.json'&&Boolean(currentReplica)&&digest(currentReplica)===replica.sha256&&currentReplica?.version===1&&currentReplica.cursor===source.cursor&&
   replica.binding===source.snapshotBinding&&currentReplica.binding===source.snapshotBinding&&replica.cursor===source.cursor&&Array.isArray(currentReplica.parts)&&currentReplica.parts.length>0,'independent_replica_anchor');
  return {public:{sha256:pins.publicSha,etag:a.public.etag,generation:pins.publicGeneration},
   internal:{sha256:pins.internalSha,etag:a.internal.etag,generation:pins.internalGeneration},leaseSha256:digest(a.lease),
   controlsSha256:digest(ctl),appliedCursor:{sha256:pins.appliedCursorSha,etag:a.appliedCursor.etag,value:source.cursor,replicaSha256:replica.sha256,snapshotBinding:source.snapshotBinding,replicaKey:replica.key}};
 }
 const before=await snapshot();
 const receiptBytes=await readLocal(path.join(convertedRoot,'LOCAL_ADMISSION.json'),2*1024**2);
 need(sha(receiptBytes)===admissionSha256,'admission_sha');const ad=decode(receiptBytes);
 need(ad?.kind==='china-local-confirmed-input-only'&&ad.version===1&&ad.sourceCompletedAt===pins.sourceAt&&Date.parse(ad.sourceExpiresAt)===sourceEpoch&&ad.sourceRows===pins.rows&&
      ad.archiveManifestSha256===pins.archiveSha&&ad.reportSha256===pins.reportSha&&ad.receiptSha256===pins.receiptSha&&ad.inventoryV2SealIssued===false&&ad.publicationAuthorized===false&&ad.cursorAdvanceAuthorized===false&&
      Array.isArray(ad.shards)&&ad.shards.length>0&&ad.shards.length<=1200&&digest(ad.shards)===ad.shardsSha256&&new Set(ad.shards.map(x=>x.file)).size===ad.shards.length,'admission_binding');
 const reportBytes=await readLocal(archiveReportPath,128*1024**2);need(sha(reportBytes)===pins.reportSha,'report_sha');const report=decode(reportBytes),paid=report?.sources?.filter(x=>x.provider==='auto_api_che168')??[];
 const next=paid[0];
 const common=report?.completed===true&&report.provider==='auto_api_che168'&&report.market==='china'&&report.completedAt===pins.sourceAt&&paid.length===1&&next.completeInventory===true&&next.stopReason==='source_finished'&&next.cursor===pins.candidateCursor&&next.replica?.cursor===next.cursor&&next.replica?.binding===next.snapshotBinding&&hex.test(next.replica?.sha256||'');
 if(common&&!next.baseReplica)throw Error('china_continuity_authenticated_full_snapshot_no_delta_ancestry');
 need(report?.completed===true&&report.provider==='auto_api_che168'&&report.market==='china'&&report.completedAt===pins.sourceAt&&paid.length===1&&next.completeInventory===true&&
  next.stopReason==='source_finished'&&next.initialCursor===pins.appliedCursor&&next.cursor===pins.candidateCursor&&next.cursor>next.initialCursor&&
  next.baseReplica?.key===before.appliedCursor.replicaKey&&next.baseReplica?.sha256===before.appliedCursor.replicaSha256&&next.snapshotBinding===before.appliedCursor.snapshotBinding&&
  next.replica?.cursor===next.cursor&&next.replica?.binding===next.snapshotBinding&&hex.test(next.replica?.sha256||''),'gap_free_applied_ancestry');
 const after=await snapshot();need(digest(before)===digest(after),'snapshot_moved');time();
 const {replicaKey:_,...applied}=after.appliedCursor;
 const result={version:1,kind:'china-local-conversion-continuity-only',archiveManifestSha256:pins.archiveSha,nativeAdmissionSha256:admissionSha256,preparedShardsSha256:ad.shardsSha256,rows:ad.sourceRows,sourceExpiresAt:ad.sourceExpiresAt,
  baseline:{public:after.public,internal:after.internal},applied,candidate:{cursor:next.cursor,replicaSha256:next.replica.sha256},requiresV2RetainedMerge:true,v2SealIssued:false,publishAuthorized:false,cursorAdvanceAuthorized:false};
 const file=path.join(convertedRoot,'LOCAL_CONTINUITY.json'),bytes=Buffer.from(JSON.stringify(result));
 await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
 need(sha(await readLocal(file,32768))===sha(bytes),'continuity_readback');
 const capability=Object.freeze({result,sourceReceiptSha256:pins.receiptSha,shardCount:ad.shards.length,continuitySha256:sha(bytes),async readReport(){time();const b=await readLocal(archiveReportPath,128*1024**2);need(sha(b)===pins.reportSha,'report_sha');return b;},async readShard(i){
  time();need(Number.isSafeInteger(i)&&i>=0&&i<ad.shards.length,'shard_index');
  const v=ad.shards[i];need(/^catalog-rebuild-china-[0-9]+\.json$/.test(v.file||'')&&hex.test(v.sha256||'')&&Number.isSafeInteger(v.bytes),'shard_scope');
  const b=await readLocal(path.join(convertedRoot,v.file),128*1024**2);need(b.length===v.bytes&&sha(b)===v.sha256,'shard_readback');return b;
 },async assertContinuityCurrent(){need(digest(await snapshot())===digest(after),'snapshot_moved');}});
 liveCapabilities.add(capability);return capability;
}
