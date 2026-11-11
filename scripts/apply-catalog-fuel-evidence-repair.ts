import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {getJsonStorage,mutateDataJson} from '../apps/web/lib/data';
import {getOfferFromCurrentShard} from '../apps/web/lib/catalog/storage';
import {withCatalogReadModelRepairLock} from './lib/catalog-read-model-repair-lock.mjs';
import {fuelRepairDigest} from './lib/catalog-fuel-evidence-repair';
import {applyFuelRepairPlan} from './lib/apply-catalog-fuel-evidence-repair';

async function main(){
 const marker=JSON.parse(await readFile('.github/market-runs/catalog-fuel-evidence-repair.json','utf8'));
 if(marker.operation!=='apply-fuel-evidence'||!/^[a-f0-9]{64}$/.test(marker.planDigest)
  ||!/^docs\/diagnostics\/\d{4}-\d{2}-\d{2}-dbx-fuel-evidence-preview\.json$/.test(marker.planPath)
  ||!Number.isFinite(Date.parse(marker.expiresAt))||Date.parse(marker.expiresAt)<=Date.now()
  ||Date.parse(marker.expiresAt)>Date.now()+30*60_000)throw Error('fuel_apply_marker');
 const preview=JSON.parse(await readFile(marker.planPath,'utf8')),plan=preview.plan;
 if(preview.mode!=='preview'||preview.verified!==true||preview.productionWrites!==0||preview.planDigest!==marker.planDigest
  ||fuelRepairDigest(plan)!==marker.planDigest||Date.now()-Date.parse(preview.checkedAt)>30*60_000
  ||!Number.isFinite(Date.parse(preview.checkedAt))||Date.parse(preview.checkedAt)>Date.now())throw Error('fuel_apply_preview');
 const storage=getJsonStorage();if(storage.driver!=='object')throw Error('fuel_apply_storage');
 const base=`catalog/repairs/fuel-evidence/${marker.planDigest}/`,originalWrite=storage.writeJson.bind(storage);
 const allowed=new Set(['catalog/import-lock.json','catalog/public/projection/all.json',...plan.objects.map((o:any)=>o.path)]);
 for(const object of plan.objects){const part=object.path.match(/\/projection-parts\/all\/(\d+)-[a-f0-9]{64}\.json$/);if(part)allowed.add(`catalog/generations/${plan.generationId}/indexes/projection-parts/all/${part[1]}-${object.afterDigest}.json`);}
 storage.writeJson=async(path,value,condition)=>{
  if(!allowed.has(path)&&!path.startsWith(base))throw Error('fuel_apply_unexpected_write');
  if(!condition?.ifMatch&&!condition?.ifNoneMatch)throw Error('fuel_apply_unconditional_write');
  return originalWrite(path,value,condition);
 };
 for(const method of ['putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'] as const)(storage as any)[method]=async()=>{throw Error('fuel_apply_delete_forbidden');};
 const previous=await storage.readJson<any>(base+'result.json',null);
 if(previous?.verified===true&&previous.planDigest===marker.planDigest){console.log('FUEL_EVIDENCE_ALREADY_APPLIED',marker.planDigest);return;}
 const health=async()=>{const r=await fetch('https://avtocena.com/api/health',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('fuel_apply_health_'+r.status);const h=await r.json();if(h.releaseSha!==plan.release||h.calculationVersion!==preview.beforeHealth.calculationVersion)throw Error('fuel_apply_release_changed');};
 await health();
 const progress:any[]=[],result:any={planDigest:marker.planDigest,startedAt:new Date().toISOString(),verified:false,changedValues:0};
 try{
  const guardedMutate=(path:any,fallback:any,update:any)=>mutateDataJson(path,fallback,(current:any)=>{
   if(current?.lockedUntil&&!Number.isFinite(Date.parse(current.lockedUntil)))throw Error('fuel_apply_invalid_lease');
   return update(current);
  });
  await withCatalogReadModelRepairLock(guardedMutate,async()=>{
   const own=await storage.readJson<any>('catalog/import-lock.json',null),operationId=own?.operationId;
   if(!operationId||own.operationType!=='catalog_read_model_repair')throw Error('fuel_apply_lease_missing');
   const sourcePins=plan.pinned.filter((p:any)=>p.path.startsWith('catalog/public/offers/')||p.path.startsWith(`catalog/generations/${plan.generationId}/current-offers/`));
   if(!sourcePins.length)throw Error('fuel_apply_source_pins_missing');
   const assertContext=async()=>{
    const [manifest,lock]=await Promise.all([storage.readJson<any>('catalog/manifest.json',null),storage.readJson<any>('catalog/import-lock.json',null)]);
    if(manifest?.generationId!==plan.generationId||lock?.operationId!==operationId||!(Date.parse(lock?.lockedUntil)>Date.now()))throw Error('fuel_apply_context_changed');
    for(const pin of sourcePins)if((await storage.readObjectMetadata!(pin.path)).etag!==pin.etag)throw Error('fuel_apply_source_etag_changed');
    await health();
   };
   await assertContext();
   const sources=new Map();for(const entry of plan.sources){const source=await getOfferFromCurrentShard(entry.id);if(!source||fuelRepairDigest(source)!==entry.digest)throw Error('fuel_apply_source_changed');sources.set(entry.id,source);}
   Object.assign(result,await applyFuelRepairPlan({storage,plan,expectedDigest:marker.planDigest,sources,assertContext,onProgress:(value:any)=>{progress.push(value);console.log('FUEL_EVIDENCE_PATCH',JSON.stringify(value));}}));
   result.finishedAt=new Date().toISOString();result.release=plan.release;result.generationId=plan.generationId;
   await storage.writeJson(base+'result.json',result,{ifNoneMatch:'*'});
  });
 }catch(error){result.verified=false;result.error=String((error as Error).message);throw error;}
 finally{result.progress=progress;await mkdir('reports',{recursive:true});await writeFile('reports/catalog-fuel-evidence-repair-apply.json',JSON.stringify(result,null,2)+'\n');console.log('FUEL_EVIDENCE_APPLY',JSON.stringify(result));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
