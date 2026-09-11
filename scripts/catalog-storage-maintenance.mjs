import crypto from 'node:crypto';
import fs from 'node:fs/promises';
const {mutateDataJson,getJsonStorage,readDataJson,writeDataJson}=await import('../apps/web/lib/data.ts');
const lockPath='catalog/import-lock.json';
const operationId=`storage-maintenance-${crypto.randomUUID()}`;
// Longer than the bounded workflow; an interrupted runner eventually unlocks.
const ttl=5*60*60*1000;
const waitMs=Math.max(0,Number(process.env.CATALOG_STORAGE_LOCK_WAIT_MS ?? 2700000));
const deadline=Date.now()+waitMs;
for (;;) {
  try {
    await mutateDataJson(lockPath,{lockedUntil:''},current=>{
      if(Date.parse(current?.lockedUntil||'')>Date.now())throw Error('catalog_publish_locked: storage maintenance deferred');
      return {operationId,operationType:'catalog_storage_maintenance',lockedUntil:new Date(Date.now()+ttl).toISOString(),startedAt:new Date().toISOString()};
    });
    break;
  } catch(error) {
    if(!String(error?.message||error).startsWith('catalog_publish_locked:') || Date.now()>=deadline)throw error;
    console.log('Storage maintenance waiting for active catalog operation');
    await new Promise(resolve=>setTimeout(resolve,Math.min(15000,deadline-Date.now())));
  }
}
try {
  // Dry preview always precedes deletion using the same protected-object rules.
  process.env.CATALOG_STORAGE_EMERGENCY='false';
  process.env.CATALOG_STORAGE_KEEP_GENERATIONS='2';
  process.env.CATALOG_STORAGE_CLEANUP_GRACE_MS='21600000';
  process.env.CATALOG_STORAGE_STAGING_RETENTION_MS='259200000';
  process.env.CATALOG_STORAGE_CLEANUP_MAX_DELETES='250000';
  process.env.CATALOG_STORAGE_CLEANUP_DRY_RUN='true';
  process.env.CATALOG_STORAGE_CLEANUP_REPORT='catalog-storage-preview.json';
  await import('./catalog-clean-object-storage.mjs?preview');
  const preview=JSON.parse(await fs.readFile('catalog-storage-preview.json','utf8'));
  if(preview.blocked || preview.errors?.length || process.exitCode)throw Error('storage_cleanup_preview_failed');
  process.env.CATALOG_STORAGE_CLEANUP_DRY_RUN='false';
  process.env.CATALOG_STORAGE_CLEANUP_REPORT='catalog-storage-cleanup-report.json';
  await import('./catalog-clean-object-storage.mjs?apply');
  const after=JSON.parse(await fs.readFile('catalog-storage-cleanup-report.json','utf8'));
  if(after.blocked || after.errors?.length || process.exitCode)throw Error('storage_cleanup_apply_failed');
  const storage=getJsonStorage();
  if(!storage.listBucketObjects)throw Error('storage_inventory_unavailable');
  const objects=await storage.listBucketObjects('');
  const bytes=objects.reduce((n,row)=>n+Math.max(0,Number(row.size)||0),0);
  const manifest=await readDataJson('catalog/manifest.json',null);
  if(manifest?.generationId!==preview.currentPublicGeneration)throw Error('storage_manifest_changed_during_cleanup');
  const report={checkedAt:new Date().toISOString(),beforeBytes:preview.physicalBucketInventory?.bytes ?? preview.namespaceInventory?.bytes,afterBytes:bytes,deletedObjects:after.deleted.total,protectedGenerations:after.protectedGenerations,generationId:manifest.generationId,marketCounts:Object.fromEntries(Object.entries(manifest.markets).map(([key,value])=>[key,value.count])),limitBytes:50_000_000_000,headroomBytes:5_000_000_000,ok:bytes<45_000_000_000};
  await fs.writeFile('catalog-storage-maintenance.json',JSON.stringify(report,null,2));
  await writeDataJson('catalog/storage-maintenance.json',report);
  console.log(JSON.stringify(report));
  if(!report.ok)throw Error('storage_headroom_still_insufficient');
} finally {
  await mutateDataJson(lockPath,{lockedUntil:''},current=>current?.operationId===operationId?{...current,lockedUntil:'',finishedAt:new Date().toISOString()}:current);
}
