import fs from 'node:fs/promises';
import path from 'node:path';
import {readCheckpointJsonl} from './read-checkpoint-jsonl.mjs';
import {observationShardWriter} from './catalog-intake-checkpoint.mjs';
import {collectAutoApiChe168} from './auto-api-che168-client.mjs';
import {normalizeAutoApiChe168,autoApiChe168RejectionReason,AUTO_API_CHE168_SOURCE as sourceId} from '../../apps/web/lib/catalog/auto-api-che168.ts';
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

export async function recoverLegacyChe168Snapshot({directory,request,now=()=>new Date().toISOString()}) {
 const original=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
 const source=validateLegacyChe168Recovery(original);
 const files=(await fs.readdir(directory)).filter(name=>new RegExp(`^${sourceId}-[0-9]{6}\\.jsonl$`).test(name)).sort();
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
 const start=await request('change_id',{date:original.startedAt.slice(0,10)});
 if(!Number.isSafeInteger(start?.change_id)||start.change_id<0)throw Error('auto_api_invalid_change_id');
 const temporary=await fs.mkdtemp(path.join(directory,'.che168-recovery-'));
 const write=observationShardWriter(temporary,sourceId),quarantine=[];
 const withdrawals=new Map((original.confirmedWithdrawals||[]).map(row=>[row.id,row]));
 try {
  const completed=await collectAutoApiChe168({request,yearFrom:new Date(original.startedAt).getUTCFullYear()-6,
   resume:{cursor:start.change_id,snapshotStartedAt:original.startedAt},now,
   onOffer:async(row,at)=>{
    const offer=normalizeAutoApiChe168(row,at);
    if(!offer){const reason=autoApiChe168RejectionReason(row);if(reason!=='missing_model')throw Error('auto_api_recovery_identity_review_required');
     quarantine.push({innerId:String(row.inner_id),reason,observedAt:at});return;}
    await write({stage:'detail',observedAt:at,offer});seen.add(offer.id);observations++;
   },
   onRemoval:async change=>{const id=stableOfferId(sourceId,String(change.inner_id));const row={id,sourceId,sourceOfferId:String(change.inner_id),market:'china',status:'removed',observedAt:change.created_at};
    if(!withdrawals.has(id)||Date.parse(withdrawals.get(id).observedAt)<Date.parse(row.observedAt))withdrawals.set(id,row);},
   onProgress:async progress=>console.log(JSON.stringify({recovery:true,phase:progress.phase,changes:progress.changes,cursor:progress.cursor}))});
  const quarantined=source.rejectedIdentity+quarantine.length;
  if(quarantined>1000 || quarantined/(observations+quarantined)>0.005)throw Error('auto_api_quarantine_review_required');
  const lastPart=Math.max(...files.map(name=>Number(name.match(/-(\d+)\.jsonl$/)[1])));
  const additions=(await fs.readdir(temporary)).sort();
  for(let i=0;i<additions.length;i++)await fs.copyFile(path.join(temporary,additions[i]),path.join(directory,`${sourceId}-${String(lastPart+i+1).padStart(6,'0')}.jsonl`),fs.constants.COPYFILE_EXCL);
  await fs.writeFile(path.join(directory,'report.before-recovery.json'),JSON.stringify(original));
  await fs.writeFile(path.join(directory,'quarantine.ndjson'),quarantine.map(row=>JSON.stringify(row)).join('\n'));
  const report={...original,completed:true,completedAt:completed.completedAt,failure:undefined,
   recovery:{legacyPostCompletionGuard:true,originalRejected:source.rejectedIdentity,originalRejectionReasons:'unrecorded; not assumed to be missing_model',allRejectedRowsRemainUnpublished:true,originalObservationsVerified:source.observations},
   sources:[{...source,...completed,provider:'auto_api_che168',syncMode:'snapshot',mode:'snapshot',stopReason:'source_finished',
    snapshotStartedAt:original.startedAt,observations,uniqueOffers:seen.size,rejectedIdentity:0,quarantined,
    rejectionReasons:{legacy_unclassified:source.rejectedIdentity,missing_model:quarantine.length}},...original.sources.filter(row=>row.sourceId!==sourceId)],
   confirmedWithdrawals:[...withdrawals.values()]};
  await fs.writeFile(path.join(directory,'report.tmp'),JSON.stringify(report));await fs.rename(path.join(directory,'report.tmp'),path.join(directory,'report.json'));
  return report;
 } finally {await fs.rm(temporary,{recursive:true,force:true});}
}
