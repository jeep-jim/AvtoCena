import fs from 'node:fs/promises';
import {readDataJson} from '../apps/web/lib/data.ts';
const [manifest,maintenance,japan]=await Promise.all([
 readDataJson('catalog/manifest.json',null),readDataJson('catalog/storage-maintenance.json',null),readDataJson('catalog/collector-state/proauctions/current.json',null)
]);
const problems=[];const ageDays=value=>(Date.now()-Date.parse(value||''))/86400000;
if(!maintenance?.ok || !Number.isFinite(ageDays(maintenance?.checkedAt)) || ageDays(maintenance.checkedAt)>2)problems.push('storage_maintenance_missing_failed_or_older_than_48h');
if(!japan)problems.push('japan_durable_collection_not_started');
else{
 if(!Number.isFinite(ageDays(japan.savedAt)) || ageDays(japan.savedAt)>16)problems.push('japan_checkpoint_stale');
 if(!japan.complete && ageDays(japan.savedAt)>2)problems.push('japan_continuation_stalled');
 if(!japan.published && ageDays(japan.startedAt)>2)problems.push('japan_publication_pending_over_48h');
 if(['source_access_refused','transport_error_checkpointed','repeated_listing_page'].includes(japan.stopReason))problems.push(`japan_${japan.stopReason}`);
}
const markets={};
for(const market of ['japan','china','korea','europe','georgia','uae']){
 const record=manifest?.markets?.[market];markets[market]={count:record?.count||0,publishedAt:record?.updatedAt||null};
 if(!record?.count || !Number.isFinite(ageDays(record.updatedAt)) || ageDays(record.updatedAt)>(market==='japan'?16:4))problems.push(`${market}_publication_missing_or_stale`);
}
const report={checkedAt:new Date().toISOString(),ok:!problems.length,problems,markets,maintenanceAt:maintenance?.checkedAt,storageBytes:maintenance?.afterBytes,japan: japan?{savedAt:japan.savedAt,publishedAt:japan.publishedAt,complete:japan.complete,details:japan.details}:null,note:'Publication timestamps do not prove fresh source observations; full source-data audits remain separate.'};
await fs.writeFile('catalog-operations-health.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(problems.length)process.exitCode=1;
