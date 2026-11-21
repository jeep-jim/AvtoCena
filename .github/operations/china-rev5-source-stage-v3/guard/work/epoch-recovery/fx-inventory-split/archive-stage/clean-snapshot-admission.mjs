/** Authored fresh-only snapshot input. No retention merge, origin status inference or writes. */
import {createHash} from 'node:crypto';
import {isBoundChinaContinuity} from './bind-converted-continuity.mjs';
import {chinaHeavyPolicyReason} from '../../../budget-fallback/china-heavy-policy.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),digest=x=>sha(JSON.stringify(x)),valid=/^[a-f0-9]{64}$/;
const fail=(v,c)=>{if(!v)throw Error('china_clean_snapshot_'+c);};
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const src='autohome_used_china_open', admissions=new WeakSet();
export function isCleanSnapshotProof(proof){return admissions.has(proof);}
export async function admitCleanChinaSnapshot({continuity,now=Date.now,knownHeavyFamily,onVerifiedBatch,progress=()=>{}}){
 fail(isBoundChinaContinuity(continuity)&&typeof onVerifiedBatch==='function'&&typeof knownHeavyFamily==='function','authority');
 const {result}=continuity,expires=Date.parse(result.sourceExpiresAt),start=now();
 const time=()=>fail(now()>=start&&now()<expires,'expired');
 time();await continuity.assertContinuityCurrent();
 const raw=await continuity.readReport(), report=parse(raw), rows=result.rows;
 const reportSources=report?.sources;
 const source=reportSources?.find(x=>x.provider==='auto_api_che168');
 fail(report.version===1&&report.market==='china'&&report.provider==='auto_api_che168'&&report.productionWrites===false&&
  report.completed===true&&!report.failure&&reportSources?.length===1&&source?.sourceId===src&&source.completeInventory===true&&source.stopReason==='source_finished'&&
  source.uniqueOffers===rows&&source.observations===rows&&source.rejectedIdentity===0&&source.cursor===result.candidate.cursor&&
  source.initialCursor===result.applied.value&&source.cursor>source.initialCursor&&source.snapshotBinding===result.applied.snapshotBinding&&valid.test(source.snapshotBinding)&&
  source.replica?.cursor===source.cursor&&source.replica?.binding===source.snapshotBinding&&source.replica?.sha256===result.candidate.replicaSha256&&
  valid.test(source.replica?.sha256)&&Date.parse(report.completedAt)+48*3600000===expires,'complete_inventory');
 // Archived withdrawn statuses only. Unseen old rows are never fetched or labelled sold.
 fail(Array.isArray(report.confirmedWithdrawals)&&report.confirmedWithdrawals.length<=500000,'withdrawal_scope');
 const withdrawals=new Map();
 for(const w of report.confirmedWithdrawals){
  fail(w?.market==='china'&&w.sourceId===src&&typeof w.id==='string'&&typeof w.sourceOfferId==='string'&&['sold','removed'].includes(w.status)&&
   Number.isFinite(Date.parse(w.observedAt))&&Date.parse(w.observedAt)<=Date.parse(report.completedAt),'withdrawal_shape');
  const prev=withdrawals.get(w.id);if(!prev||Date.parse(prev.observedAt)<Date.parse(w.observedAt))withdrawals.set(w.id,w);
 }
 const ids=new Set(), offerIds=new Set(), reasonCounts={};
 const ordered=createHash('sha256').update('china-full-fresh-source-ordered-input-v1\n');
 let admitted=0,withdrawn=0,excluded=0,unknownKw=0,idBytes=0;
 for(let i=0;i<continuity.shardCount;i++){
  time();const b=await continuity.readShard(i),chunk=parse(b);
  fail(Array.isArray(chunk.offers)&&chunk.offers.length>0&&chunk.offers.length<=500,'batch');
  const dispositions=[];
  for(const row of chunk.offers){
   const v=row?.operational?.che168ActiveVerification;
   fail(row?.market==='china'&&row.sourceId===src&&row.status==='active'&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=150&&
    typeof row.sourceOfferId==='string'&&/^[0-9]{1,150}$/.test(row.sourceOfferId)&&row.id===sha(src+':'+row.sourceOfferId).slice(0,24)&&
    row.operational?.provider==='auto-api.com'&&row.operational?.detailIdentityVerified===true&&
    v?.method==='snapshot_and_complete_change_stream'&&v.snapshotBinding===source.snapshotBinding&&v.cursor===source.cursor&&v.verifiedAt===report.completedAt&&
    !ids.has(row.id)&&!offerIds.has(row.sourceOfferId),'row_identity_or_replica');
   idBytes+=Buffer.byteLength(row.id)+Buffer.byteLength(row.sourceOfferId);
   fail(idBytes<=128*1024**2&&ids.size<rows,'id_bound');ids.add(row.id);offerIds.add(row.sourceOfferId);
   const inputSha256=digest(row),w=withdrawals.get(row.id);
   ordered.update(JSON.stringify({id:row.id,inputSha256})+'\n');
   if(w&&w.sourceOfferId===row.sourceOfferId&&Date.parse(w.observedAt)>=Date.parse(v.verifiedAt)){
    withdrawn++;dispositions.push({id:row.id,inputSha256,state:'withdrawn',withdrawal:{id:row.id,market:'china',make:row.make,model:row.model,
     reason:w.status,removedAt:w.observedAt,evidence:{state:w.status,sha256:digest(w)}}});continue;
   }
   const reason=chinaHeavyPolicyReason(row,{knownHeavyFamily});
   if(reason){excluded++;reasonCounts[reason]=(reasonCounts[reason]??0)+1;dispositions.push({id:row.id,inputSha256,state:'excluded',reason});continue;}
   if(!['powerKw','icePowerKw','motorPeakKw','power30MinKw','utilizationPowerKw'].some(x=>typeof row[x]==='number'&&row[x]>0))unknownKw++;
   admitted++;dispositions.push({id:row.id,inputSha256,state:'eligible_unpriced'});
  }
  // May persist a provisional batch in an already qualified private same-owner
  // stage; external adapter must stay opaque and cannot expose before final seal.
  await onVerifiedBatch(Object.freeze({index:i,inputFileSha256:sha(b),rows:chunk.offers,dispositions}));
  if((i+1)%25===0||i+1===continuity.shardCount)progress({stage:'china_full_fresh_admission',shards:i+1,offers:ids.size,admitted,excluded,withdrawn});
 }
 fail(ids.size===rows&&offerIds.size===rows&&admitted+excluded+withdrawn===rows&&admitted>0,'census');
 await continuity.assertContinuityCurrent();time();
 const proof=Object.freeze({version:1,kind:'china-full-fresh-source-admission-only',coverage:'materialized_complete_replica_after_committed_delta',
  oldRowsMerged:false,sourceRows:rows,eligibleUnpricedRows:admitted,excludedRows:excluded,explicitlyWithdrawnRows:withdrawn,unknownKw,reasonCounts,
  orderedInputSha256:ordered.digest('hex'),continuitySha256:continuity.continuitySha256,sourceReportSha256:sha(raw),sourceCompletedAt:report.completedAt,sourceExpiresAt:expires,
  nativeAdmissionSha256:result.nativeAdmissionSha256,nativeShardsSha256:result.preparedShardsSha256,archiveManifestSha256:result.archiveManifestSha256,
  sourceCursor:result.candidate.cursor,sourceReplicaSha256:result.candidate.replicaSha256,sourceBinding:source.snapshotBinding,
  priced:false,nativeFinalV2SealIssued:false,publicationAuthorized:false,cursorAdvanceAuthorized:false});
 admissions.add(proof);return Object.freeze({proof,proofSha256:digest(proof)});
}
