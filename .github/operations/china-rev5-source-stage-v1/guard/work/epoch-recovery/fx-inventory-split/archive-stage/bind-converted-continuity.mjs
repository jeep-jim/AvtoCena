/** Same-run local bridge. It does not collect, reconvert, mint a V2 inventory
 * seal, or write to source storage / cursor. The V2 retention step must follow. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash}from'node:crypto';import{constants}from'node:fs';
const sha=b=>createHash('sha256').update(b).digest('hex'),digest=x=>sha(JSON.stringify(x)),hex=/^[a-f0-9]{64}$/;
const liveCapabilities=new WeakSet();
export function isBoundChinaContinuity(v){return liveCapabilities.has(v);}
const need=(v,k)=>{if(!v)throw Error('china_continuity_'+k);};
async function readLocal(file,max){
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await h.stat();need(s.isFile()&&s.nlink===1&&s.size>0&&s.size<=max,'local_scope');const b=await h.readFile();need(b.length===s.size&&(await h.stat()).mtimeMs===s.mtimeMs,'local_changed');return b;}finally{await h.close();}
}
const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
export async function bindTerminalArchiveContinuity({sourceAuthority:a,expectedLaunch:p}){
 const {admission:ad,receipt:r,sourceSeal:s,reportFile,converted}=a;
 const assertCurrent=async(force=false)=>{need(Date.now()<s.sourceExpiresAt,'source_expired');await a.assertLive(force);need(Date.now()<s.sourceExpiresAt,'source_expired');};
 const readReport=async()=>{await assertCurrent();const b=await readLocal(reportFile,128*1024**2);need(sha(b)===r.reportDigest,'signed_native_report_sha');return b;};
 await assertCurrent(true);
 const ab=await readLocal(path.join(converted,'LOCAL_ADMISSION.json'),2*1024**2);
 need(sha(ab)===a.admissionSha256&&digest(ad)===a.admissionSha256&&r.reportDigest===p.archiveReportSha256&&r.manifestSha256===p.archiveManifestSha256&&
  a.admissionSha256===p.nativeAdmissionSha256&&digest(r)===p.nativeReceiptSha256&&r.owner.runId===process.env.GITHUB_RUN_ID&&r.owner.attempt==='1'&&
  r.owner.revision===process.env.GITHUB_SHA&&ad.sourceRows===s.observations&&ad.shards.length>0&&ad.shards.length<=1200&&digest(ad.shards)===ad.shardsSha256&&
  s.officialTerminalSha256===p.terminalWitnessSha256&&ad.archiveManifestSha256===r.manifestSha256&&ad.reportSha256===r.reportDigest&&ad.receiptSha256===a.receiptSha256,
  'archive_same_exact_protected_job');
 const rr=decode(await readReport()),src=rr.sources?.[0];
 need(rr.version===1&&rr.market==='china'&&rr.provider==='auto_api_che168'&&rr.completed===true&&rr.completedAt===s.sourceObservedAt&&Date.parse(ad.sourceExpiresAt)===s.sourceExpiresAt&&
   rr.sourceMaterialization?.terminalWitnessSha256===s.officialTerminalSha256&&rr.sources.length===1&&src.completeInventory===true&&src.stopReason==='source_finished'&&
   src.initialCursor===13123821&&src.cursor===s.terminalCursor&&src.cursor>src.initialCursor&&src.replica?.cursor===src.cursor&&src.replica.binding===src.snapshotBinding&&
   hex.test(src.replica.sha256)&&hex.test(src.baseReplica.sha256)&&hex.test(src.snapshotBinding)&&src.observations===ad.sourceRows,'native_source_ancestry');
 const result={version:1,kind:'china-local-conversion-continuity-only',archiveManifestSha256:r.manifestSha256,nativeAdmissionSha256:a.admissionSha256,
  preparedShardsSha256:ad.shardsSha256,rows:ad.sourceRows,sourceExpiresAt:ad.sourceExpiresAt,
  baseline:{chinaOwnControlSha256:'9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62',revision:5},
  applied:{value:src.initialCursor,replicaSha256:src.baseReplica.sha256,snapshotBinding:src.snapshotBinding},
  candidate:{cursor:src.cursor,replicaSha256:src.replica.sha256},sourceTerminalWitnessSha256:s.officialTerminalSha256,
  requiresV2RetainedMerge:true,v2SealIssued:false,publishAuthorized:false,cursorAdvanceAuthorized:false};
 const wire=Buffer.from(JSON.stringify(result)),file=path.join(converted,'LOCAL_CONTINUITY.json'),continuitySha256=sha(wire);
 await fs.writeFile(file,wire,{mode:0o600,flag:'wx'});
 need(sha(await readLocal(file,32*1024))===continuitySha256,'local_continuity_receipt');
 const cap=Object.freeze({result,sourceReceiptSha256:a.receiptSha256,shardCount:ad.shards.length,continuitySha256,readReport,
  async readShard(i){
   await assertCurrent();need(Number.isSafeInteger(i)&&i>=0&&i<ad.shards.length,'source_shard_index');
   const f=ad.shards[i];need(/^catalog-rebuild-china-[0-9]+\.json$/.test(f.file)&&hex.test(f.sha256),'source_shard_name');
   const b=await readLocal(path.join(converted,f.file),128*1024**2);need(b.length===f.bytes&&sha(b)===f.sha256,'source_shard_bytes');return b;
  },async assertContinuityCurrent(){await assertCurrent(true);}});
 liveCapabilities.add(cap);return cap;
}
