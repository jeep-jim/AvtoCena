import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {catalogGenerationId,readCurrentPublicCatalogProjection} from '../../apps/web/lib/catalog/storage.ts';
import {readEncyclopediaIdentityResolver} from '../../apps/web/lib/catalog/encyclopedia-identity-data.ts';
import {catalogVehicleExcluded} from '../../apps/web/lib/catalog/inventory-admission.ts';
import {MANIFEST,ROOT,modelId,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
import {createSnapshotBuilder} from '../../apps/web/lib/encyclopedia/snapshot.ts';
import {appendMissingObservations} from '../../apps/web/lib/encyclopedia/observations.ts';
import {savedAjesLots,savedAjesObservation} from '../../apps/web/lib/encyclopedia/saved-observations.ts';

// Explicit one-shot reconciliation, never a request-time or scheduled inventory scan.
const apply=process.argv.includes('--apply'),store=getJsonStorage();
if(store.driver!=='object'||!store.listObjects)throw Error('durable_object_storage_required');
const baseline=await store.readJson(MANIFEST,null);if(!baseline)throw Error('existing_encyclopedia_required');
const generation=await catalogGenerationId(),at=new Date().toISOString();
const [projection,resolver]=await Promise.all([readCurrentPublicCatalogProjection(),readEncyclopediaIdentityResolver()]);
if(projection.generationId!==generation||!projection.rows.length)throw Error('current_catalog_snapshot_unavailable');
const builder=createSnapshotBuilder(at);
const add=row=>{
 const match=resolver?.resolve(row),name={make:match?.brandId?match.canonicalMake:row.make,model:match?.modelId?match.canonicalModel:row.model};
 if(!name.make||!name.model||!isEncyclopediaCar(name)||catalogVehicleExcluded({...row,...name}))return;
 builder.add({...row,...name,chassisCode:row.chassisCode||row.operational?.chassisCode});
};
for(const row of projection.rows)add(row);
const keys=Array.from({length:128},(_,i)=>`catalog/partner-cache/ajes/queries/${i}.json`);
for(const table of ['stats','korea'])for(const object of await store.listObjects(`catalog/partner-cache/ajes/${table}/`))if(object.key.endsWith('.json'))keys.push(object.key);
let cursor=0,cachedRows=0;
await Promise.all(Array.from({length:4},async()=>{for(;;){const key=keys[cursor++];if(!key)return;const saved=await store.readJson(key,null);for(const lot of savedAjesLots(saved)){add(savedAjesObservation(lot));cachedRows++;}}}));
const existing=new Map(baseline.models.map(m=>[modelId(m.make,m.model),m]));
const prepared=new Map(),additions=[],changes=[];let addedVariants=0,checkedModels=0;
const models=[...builder.models];let modelCursor=0;
await Promise.all(Array.from({length:4},async()=>{for(;;){
 const entry=models[modelCursor++];if(!entry)return;const [id,observed]=entry;
 const summary=existing.get(id),record=summary?await store.readJson(summary.key,null):null;
 if(summary&&(!record||record.revision!==summary.revision))throw Error('encyclopedia_revision_mismatch');
 const variants=appendMissingObservations(record?.variants||[],observed.variants),added=variants.length-(record?.variants.length||0);checkedModels++;
 if(!added)continue;
 const next=record?{...record,variants,revision:randomUUID(),updatedAt:at,previousKey:summary.key,directorySnapshot:summary.directorySnapshot||record.directorySnapshot}: {...observed,variants,directorySnapshot:{capturedAt:at}};
 const key=`${ROOT}/revisions/${next.id}/${next.revision}.json`;
 if(apply)await store.writeJson(key,next,{ifNoneMatch:'*'});
 const updated=summarize(next,key);if(summary)prepared.set(summary.id,updated);else additions.push(updated);
 addedVariants+=added;changes.push({make:next.make,model:next.model,addedVariants:added});
}}));
if(await catalogGenerationId()!==generation)throw Error('catalog_generation_changed_retry_required');
if(apply&&(prepared.size||additions.length)){
 await store.writeJson(`${ROOT}/directory-backups/${randomUUID()}.json`,baseline,{ifNoneMatch:'*'});
 await mutateDataJson(MANIFEST,null,current=>{
  const revisions=new Map(baseline.models.map(m=>[m.id,m.revision]));
  if(!current||current.models.length!==baseline.models.length||current.models.some(m=>revisions.get(m.id)!==m.revision))throw Error('concurrent_edit_retry_required');
  return {...current,updatedAt:at,models:[...current.models.map(m=>prepared.get(m.id)||m),...additions]};
 });
}
changes.sort((a,b)=>(a.make+' '+a.model).localeCompare(b.make+' '+b.model));
const report={applied:apply,at,generation,projectionRows:projection.rows.length,savedObjects:keys.length,cachedRows,checkedModels,addedModels:additions.length,updatedModels:prepared.size,addedVariants,existingValuesPreserved:true,supplierRequests:0,scope:'current saved projection and all retained Japan/Korea query/detail cache objects; not unseen supplier inventory',changes};
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/encyclopedia-saved-variants.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,changes:changes.filter(row=>/honda/i.test(row.make)&&/vezel/i.test(row.model))}));
