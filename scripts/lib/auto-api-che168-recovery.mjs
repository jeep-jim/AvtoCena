import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openChe168ReplayJournal} from './che168-replay-journal.mjs';
import {readCheckpointJsonl} from './read-checkpoint-jsonl.mjs';
import {observationShardWriter} from './catalog-intake-checkpoint.mjs';
import {collectAutoApiChe168} from './auto-api-che168-client.mjs';
import {normalizeAutoApiChe168,autoApiChe168RejectionReason,isAutoApiChe168QuarantineReason,AUTO_API_CHE168_SOURCE as sourceId} from '../../apps/web/lib/catalog/auto-api-che168.ts';
import {stableOfferId} from '../../apps/web/lib/catalog/storage.ts';
import {isAllowedCatalogSourceUrl} from '../../apps/web/lib/catalog/required-catalog-sources.ts';

/** Only the legacy post-completion normalization guard is recoverable. A timeout,
 * access failure, missing shard or interrupted snapshot must remain blocked. */
export function validateLegacyChe168Recovery(report) {
 const source=report?.sources?.find(row=>row.sourceId===sourceId);
 if(report?.version!==1 || report.provider!=='auto_api_che168' || report.market!=='china'
   || report.completed!==false || report.failure!=='auto_api_rejected_identity_review_required'
   || !Number.isFinite(Date.parse(report.startedAt)) || !source
   || !Number.isSafeInteger(source.observations) || source.observations<=0
   || !Number.isSafeInteger(source.uniqueOffers) || source.uniqueOffers<=0
   || !Number.isSafeInteger(source.rejectedIdentity) || source.rejectedIdentity<=0
   || source.rejectedIdentity>1000 || source.rejectedIdentity/(source.uniqueOffers+source.rejectedIdentity)>0.005)
   throw Error('auto_api_snapshot_not_recoverable');
 return source;
}

/** The exact detail error can only be thrown after /offers pagination ended
 * and change replay began. Accept it only with the new diagnostic checkpoint,
 * zero identity rejections and a fully verifiable observation/quarantine set. */
export function validateInterruptedChe168ReplayRecovery(report) {
 const source=report?.sources?.find(row=>row.sourceId===sourceId);
 const reasons=source?.rejectionReasons||{};
 if(report?.version!==1 || report.provider!=='auto_api_che168' || report.market!=='china'
   || report.completed!==false || report.failure!=='auto_api_detail_identity_mismatch'
   || !Number.isFinite(Date.parse(report.startedAt)) || !source
   || source.phase!=='snapshot' || !Number.isSafeInteger(source.pages) || source.pages<=0
   || !Number.isSafeInteger(source.rows) || source.rows<=0
   || !Number.isSafeInteger(source.observations) || source.observations<=0
   || !Number.isSafeInteger(source.uniqueOffers) || source.uniqueOffers!==source.observations
   || source.rejectedIdentity!==0 || source.changes!==0
   || !Number.isSafeInteger(source.cursor) || source.cursor<0
   || !Number.isSafeInteger(source.quarantined) || source.quarantined<0 || source.quarantined>1000
   || reasons.missing_model!==source.quarantined
   || Object.entries(reasons).some(([reason,count])=>reason!=='missing_model' && Number(count)>0)
   || source.quarantined/Math.max(1,source.uniqueOffers+source.quarantined)>0.005)
   throw Error('auto_api_snapshot_not_recoverable');
 return source;
}

async function readVerifiedQuarantine(directory,expected) {
 let body='';
 try{body=await fs.readFile(path.join(directory,'quarantine.ndjson'),'utf8');}
 catch(error){if(error?.code!=='ENOENT'||expected)throw Error('auto_api_recovery_invalid_quarantine');}
 const rows=body.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{throw Error('auto_api_recovery_invalid_quarantine');}});
 const ids=new Set();
 for(const row of rows){if(!/^\d+$/.test(String(row?.innerId))||row.reason!=='missing_model'||!Number.isFinite(Date.parse(row.observedAt)))throw Error('auto_api_recovery_invalid_quarantine');ids.add(String(row.innerId));}
 if(rows.length!==expected||ids.size!==expected)throw Error('auto_api_recovery_invalid_quarantine');
 return rows;
}

export async function recoverLegacyChe168Snapshot({directory,request,now=()=>new Date().toISOString(),journalStorage=null,artifactRunId=null,checkpointEvery=1000}) {
 if(!Number.isSafeInteger(checkpointEvery)||checkpointEvery<1||checkpointEvery>10000)throw Error('auto_api_invalid_checkpoint_interval');
 const original=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
 let source,recoveryKind,originalRejected=0,originalQuarantine=[];
 try{source=validateLegacyChe168Recovery(original);recoveryKind='legacy_post_completion_guard';originalRejected=source.rejectedIdentity;}
 catch(error){if(error?.message!=='auto_api_snapshot_not_recoverable')throw error;
  source=validateInterruptedChe168ReplayRecovery(original);recoveryKind='interrupted_change_replay';
  originalQuarantine=await readVerifiedQuarantine(directory,source.quarantined);}
 const files=(await fs.readdir(directory)).filter(name=>new RegExp(`^${sourceId}-[0-9]{6}\\.jsonl$`).test(name)).sort();
 const fingerprint=createHash('sha256').update(JSON.stringify({original,originalQuarantine}));
 for(const name of files)fingerprint.update(name).update(createHash('sha256').update(await fs.readFile(path.join(directory,name))).digest());
 const binding=fingerprint.digest('hex');
 const seen=new Set();let observations=0;
 for(const name of files)for await(const entry of readCheckpointJsonl(path.join(directory,name))) {
  const o=entry?.offer;
  if(o?.sourceId!==sourceId || o.market!=='china' || !/^\d+$/.test(String(o.sourceOfferId))
    || o.id!==stableOfferId(sourceId,String(o.sourceOfferId)) || o.operational?.provider!=='auto-api.com'
    || o.operational?.detailIdentityVerified!==true || !isAllowedCatalogSourceUrl('china',sourceId,o.operational.sourceUrl)
    || !new RegExp(`/${o.sourceOfferId}\\.html$`).test(o.operational.sourceUrl)
    || !Number.isFinite(Date.parse(entry.observedAt))) throw Error('auto_api_recovery_invalid_observation');
  seen.add(o.id);observations++;
 }
 if(observations!==source.observations || seen.size!==source.uniqueOffers) throw Error('auto_api_recovery_truncated_artifact');
 const start=recoveryKind==='interrupted_change_replay'?{change_id:source.cursor}:await request('change_id',{date:original.startedAt.slice(0,10)});
 if(!Number.isSafeInteger(start?.change_id)||start.change_id<0)throw Error('auto_api_invalid_change_id');
 const temporary=await fs.mkdtemp(path.join(directory,'.che168-recovery-'));
 const write=observationShardWriter(temporary,sourceId),quarantine=[];
 const withdrawals=new Map((original.confirmedWithdrawals||[]).map(row=>[row.id,row]));
 let journal=null,pageEvents=[],pending=[],pendingBytes=0,totalChanges=0,lastCursor=start.change_id,lastSavedAt=Date.now();
 const apply=async event=>{
  if(event?.kind==='observation'){
   const entry=event.entry,o=entry?.offer;
   if(o?.sourceId!==sourceId||o.market!=='china'||!/^\d+$/.test(String(o.sourceOfferId))
    ||o.id!==stableOfferId(sourceId,String(o.sourceOfferId))||o.operational?.provider!=='auto-api.com'
    ||o.operational?.detailIdentityVerified!==true||!isAllowedCatalogSourceUrl('china',sourceId,o.operational.sourceUrl)
    ||!new RegExp(`/${o.sourceOfferId}\\.html$`).test(o.operational.sourceUrl)
    ||!Number.isFinite(Date.parse(entry.observedAt)))throw Error('auto_api_invalid_replay_observation');
   await write(entry);seen.add(o.id);observations++;
  }else if(event?.kind==='quarantine'){
   const row=event.row;
   if(!/^\d+$/.test(row?.innerId)||!isAutoApiChe168QuarantineReason(row.reason)||!Number.isFinite(Date.parse(row.observedAt)))throw Error('auto_api_invalid_replay_quarantine');
   quarantine.push(row);
  }else if(event?.kind==='withdrawal'){
   const row=event.row;
   if(row?.sourceId!==sourceId||row.market!=='china'||row.status!=='removed'||!/^\d+$/.test(String(row.sourceOfferId))
    ||row.id!==stableOfferId(sourceId,String(row.sourceOfferId))||!Number.isFinite(Date.parse(row.observedAt)))throw Error('auto_api_invalid_replay_withdrawal');
   if(!withdrawals.has(row.id)||Date.parse(withdrawals.get(row.id).observedAt)<Date.parse(row.observedAt))withdrawals.set(row.id,row);
  }else throw Error('auto_api_invalid_replay_event');
 };
 const save=async()=>{
  if(!journal||lastCursor===journal.cursor)return;
  await journal.commit({cursor:lastCursor,changes:totalChanges,events:pending});
  pending=[];pendingBytes=0;lastSavedAt=Date.now();
 };
 try {
  if(journalStorage){
   journal=await openChe168ReplayJournal({storage:journalStorage,artifactRunId,binding,initialCursor:start.change_id,apply});
   lastCursor=journal.cursor;totalChanges=journal.changes;
   console.log(JSON.stringify({replayCheckpointRestored:true,changes:totalChanges,cursor:lastCursor}));
  }
  const previousChanges=totalChanges;
  const completed=await collectAutoApiChe168({request,yearFrom:new Date(original.startedAt).getUTCFullYear()-6,
   resume:{cursor:lastCursor,snapshotStartedAt:original.startedAt},now,
   onOffer:async(row,at)=>{
    const offer=normalizeAutoApiChe168(row,at);
    if(!offer){const reason=autoApiChe168RejectionReason(row);if(!isAutoApiChe168QuarantineReason(reason))throw Error('auto_api_recovery_identity_review_required');
     pageEvents.push({kind:'quarantine',row:{innerId:String(row.inner_id),reason,observedAt:at}});return;}
    pageEvents.push({kind:'observation',entry:{stage:'detail',observedAt:at,offer}});
   },
   onRemoval:async change=>{const id=stableOfferId(sourceId,String(change.inner_id));const row={id,sourceId,sourceOfferId:String(change.inner_id),market:'china',status:'removed',observedAt:change.created_at};
    pageEvents.push({kind:'withdrawal',row});},
   onProgress:async progress=>{
    for(const event of pageEvents)await apply(event);
    if(journal){pending.push(...pageEvents);pendingBytes+=Buffer.byteLength(JSON.stringify(pageEvents));}
    pageEvents=[];lastCursor=progress.cursor;totalChanges=previousChanges+progress.changes;
    if(journal&&(totalChanges-journal.changes>=checkpointEvery||pendingBytes>=8*1024*1024||Date.now()-lastSavedAt>=60000))await save();
    console.log(JSON.stringify({recovery:true,phase:progress.phase,changes:totalChanges,cursor:lastCursor}));
   }});
  await save();
  completed.changes=totalChanges;completed.initialCursor=start.change_id;
  const quarantined=originalRejected+originalQuarantine.length+quarantine.length;
  if(quarantined>1000 || quarantined/(observations+quarantined)>0.005)throw Error('auto_api_quarantine_review_required');
  const lastPart=Math.max(...files.map(name=>Number(name.match(/-(\d+)\.jsonl$/)[1])));
  const additions=(await fs.readdir(temporary)).sort();
  for(let i=0;i<additions.length;i++)await fs.copyFile(path.join(temporary,additions[i]),path.join(directory,`${sourceId}-${String(lastPart+i+1).padStart(6,'0')}.jsonl`),fs.constants.COPYFILE_EXCL);
  await fs.writeFile(path.join(directory,'report.before-recovery.json'),JSON.stringify(original));
  await fs.writeFile(path.join(directory,'quarantine.ndjson'),[...originalQuarantine,...quarantine].map(row=>JSON.stringify(row)).join('\n'));
  const rejectionReasons={legacy_unclassified:originalRejected};
  for(const row of [...originalQuarantine,...quarantine])rejectionReasons[row.reason]=(rejectionReasons[row.reason]||0)+1;
  const report={...original,completed:true,completedAt:completed.completedAt,failure:undefined,
   recovery:{kind:recoveryKind,legacyPostCompletionGuard:recoveryKind==='legacy_post_completion_guard',interruptedChangeReplay:recoveryKind==='interrupted_change_replay',
    originalRejected,originalQuarantined:originalQuarantine.length,
    originalRejectionReasons:recoveryKind==='legacy_post_completion_guard'?'unrecorded; not assumed to be missing_model':'missing_model',
    allRejectedRowsRemainUnpublished:true,originalObservationsVerified:source.observations},
   sources:[{...source,...completed,provider:'auto_api_che168',syncMode:'snapshot',mode:'snapshot',stopReason:'source_finished',
    snapshotStartedAt:original.startedAt,observations,uniqueOffers:seen.size,rejectedIdentity:0,quarantined,
    rejectionReasons},...original.sources.filter(row=>row.sourceId!==sourceId)],
   confirmedWithdrawals:[...withdrawals.values()]};
  await fs.writeFile(path.join(directory,'report.tmp'),JSON.stringify(report));await fs.rename(path.join(directory,'report.tmp'),path.join(directory,'report.json'));
  return report;
 } catch(error) {
  // Only fully processed pages enter the durable journal. Never advance over
  // a partial page, an unresolved 404, or a failed storage commit.
  await save();throw error;
 } finally {await fs.rm(temporary,{recursive:true,force:true});}
}
