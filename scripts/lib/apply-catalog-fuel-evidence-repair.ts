import {createHash} from 'node:crypto';
import {fuelRepairDigest,repairFuelRows} from './catalog-fuel-evidence-repair';

const rootPath='catalog/public/projection/all.json';
const shard=(value:string)=>value.toLowerCase().replace(/[^a-z0-9а-яё-]+/gi,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
const keyHash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Caller holds the standard publication lease and supplies fresh context checks.
 * CAS failures stop immediately; no forced rollback can overwrite a newer writer.
 * Partial progress adds evidence only and is reported without claiming completion.
 */
export async function applyFuelRepairPlan({storage,plan,expectedDigest,sources,assertContext,onProgress=()=>{}}:any){
 if(fuelRepairDigest(plan)!==expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest))throw Error('fuel_apply_plan_digest');
 if(!/^gen_[0-9]+_[a-z0-9]+$/.test(plan.generationId)||plan.version!==1||!Array.isArray(plan.sources)||plan.sources.length<1||plan.sources.length>3
  ||!Array.isArray(plan.objects)||plan.objects.length>32||!Array.isArray(plan.pinned))throw Error('fuel_apply_plan_bounds');
 const generation=plan.generationId,pins=new Map(plan.pinned.map((p:any)=>[p.path,p.etag]));
 if(!pins.get(rootPath)||!Array.isArray(plan.budgetTargets))throw Error('fuel_apply_root_pin');
 const allowed=new Set<string>(),sourceIds=new Set<string>();
 for(const entry of plan.sources){
  const source=sources.get(entry.id);if(sourceIds.has(entry.id)||!source||fuelRepairDigest(source)!==entry.digest)throw Error('fuel_apply_source_changed');sourceIds.add(entry.id);
  const market=shard(source.market),make=shard(source.make),brandHash=keyHash(String(source.make).replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU')).slice(0,16);
  if(!market||!make||make.length>150)throw Error('fuel_apply_scope');
  for(const path of [`catalog/public/projection/${market}.json`,`catalog/generations/${generation}/indexes/projection/${market}.json`,`catalog/public/projection-brand/${make}-${brandHash}.json`,`catalog/generations/${generation}/indexes/projection-brand/${make}-${brandHash}.json`])allowed.add(path);
 }
 if(sources.size!==sourceIds.size||plan.budgetTargets.length!==sourceIds.size)throw Error('fuel_apply_source_count');
 const budgetIds=new Set<string>();
 for(const target of plan.budgetTargets){
  if(budgetIds.has(target.id)||!sourceIds.has(target.id)||!Number.isSafeInteger(target.block)||target.block<0||target.inOtherRows!==true||target.hasReplay)throw Error('fuel_apply_budget_replay_requires_separate_plan');budgetIds.add(target.id);
  allowed.add(`catalog/generations/${generation}/indexes/budget-cards-v3/${target.block}.json`);
 }
 async function read(path:string){const result=await storage.getBinary(path);if(result.data.length>128*1024*1024)throw Error('fuel_apply_object_bound');return JSON.parse(result.data.toString('utf8'));}
 async function assertPins(){await assertContext();for(const [path,etag] of pins){if(!etag||(await storage.readObjectMetadata(path)).etag!==etag)throw Error('fuel_apply_etag_changed:'+path);}}
 await assertPins();
 const root=await read(rootPath);
 if(root.storageFormat!=='catalog-projection-parts-v1'||root.generationId!==generation||!Array.isArray(root.parts)||root.parts.length>1000)throw Error('fuel_apply_root');
 const nextRoot={...root,parts:root.parts.map((part:any)=>({...part}))},patches:any[]=[],seen=new Set<string>();let preparedBytes=0;
 for(const object of plan.objects){
  if(seen.has(object.path))throw Error('fuel_apply_duplicate_path');seen.add(object.path);
  const partIndex=root.parts.findIndex((part:any)=>part.path===object.path);
  if(!allowed.has(object.path)&&partIndex<0)throw Error('fuel_apply_unexpected_path');
  if(!object.changed.length)continue;
  const before=await read(object.path);
  preparedBytes+=Buffer.byteLength(JSON.stringify(before));if(preparedBytes>256*1024*1024)throw Error('fuel_apply_plan_bytes_bound');
  if(fuelRepairDigest(before)!==object.beforeDigest)throw Error('fuel_apply_before_changed');
  const result=repairFuelRows(before.items,sources),after={...before,items:result.items};
  if(JSON.stringify(result.changed)!==JSON.stringify(object.changed)||fuelRepairDigest(after)!==object.afterDigest)throw Error('fuel_apply_patch_changed');
  if(partIndex<0 && (before.generationId!==generation||!pins.get(object.path)||object.etag!==pins.get(object.path)))throw Error('fuel_apply_projection_binding');
  let destination=object.path;
  if(partIndex>=0){
   const descriptor=root.parts[partIndex];
   if(descriptor.count!==before.items.length||descriptor.sha256!==object.beforeDigest||descriptor.path!==`catalog/generations/${generation}/indexes/projection-parts/all/${partIndex}-${descriptor.sha256}.json`)throw Error('fuel_apply_part_binding');
   destination=`catalog/generations/${generation}/indexes/projection-parts/all/${partIndex}-${object.afterDigest}.json`;
   nextRoot.parts[partIndex]={...descriptor,path:destination,sha256:object.afterDigest};
  }
  patches.push({path:object.path,destination,before,after,part:partIndex>=0,afterDigest:object.afterDigest,changed:object.changed});
 }
 if(!patches.length)return {verified:true,changedObjects:0,changedValues:0};
 // The complete plan must be validated before creating backups or applying any patch.
 await assertPins();
 const backupBase=`catalog/repairs/fuel-evidence/${expectedDigest}/`;
 async function immutable(path:string,value:any){
  try{await storage.writeJson(path,value,{ifNoneMatch:'*'});}catch(error){if((error as Error).message!=='storage_conflict'||fuelRepairDigest(await read(path))!==fuelRepairDigest(value))throw error;}
 }
 await immutable(backupBase+'plan.json',plan);
 for(const patch of patches)await immutable(backupBase+'before/'+keyHash(patch.path)+'.json',patch.before);
 await immutable(backupBase+'before/'+keyHash(rootPath)+'.json',root);
 await assertPins();
 const applied:any[]=[];
 for(const patch of patches){
  await assertContext();
  if(patch.part)await immutable(patch.destination,patch.after);
  else await storage.writeJson(patch.destination,patch.after,{ifMatch:pins.get(patch.path)});
  if(fuelRepairDigest(await read(patch.destination))!==patch.afterDigest)throw Error('fuel_apply_readback_failed');
  applied.push({path:patch.destination,changed:patch.changed,sha256:patch.afterDigest});onProgress(applied.at(-1));
 }
 await assertContext();
 if(fuelRepairDigest(root)!==fuelRepairDigest(nextRoot)){
  await storage.writeJson(rootPath,nextRoot,{ifMatch:pins.get(rootPath)});
  if(fuelRepairDigest(await read(rootPath))!==fuelRepairDigest(nextRoot))throw Error('fuel_apply_root_readback_failed');
 }
 await assertContext();
 return {verified:true,changedObjects:applied.length,changedValues:0,applied,rootDigest:fuelRepairDigest(nextRoot),backupBase};
}
