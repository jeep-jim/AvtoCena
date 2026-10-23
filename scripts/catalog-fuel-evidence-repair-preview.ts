import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data';
import {catalogProjectionBatches} from '../apps/web/lib/catalog-projection-parts';
import {detailHash,detailShardPath} from '../apps/web/lib/catalog/detail-shards';
import {catalogIndexShardKey} from '../apps/web/lib/catalog/storage';
import {fuelRepairDigest,repairFuelRows} from './lib/catalog-fuel-evidence-repair';

// Explicit manual preview only. It cannot acquire a writer or alter any object.
export async function main(){
const marker=JSON.parse(await readFile('.github/market-runs/regcloud-publication-status.json','utf8'));
const request=marker.previewFuelEvidenceRepair;
if(!request || !Array.isArray(request.offerIds) || request.offerIds.length<1 || request.offerIds.length>3
 || new Set(request.offerIds).size!==request.offerIds.length || request.offerIds.some((id:any)=>!/^([a-f0-9]{24})$/.test(id))
 || !/^[a-f0-9]{40}$/.test(request.release) || !/^gen_[0-9]+_[a-z0-9]+$/.test(request.generationId))throw Error('fuel_preview_request');
const storage=getJsonStorage();
if(storage.driver!=='object'||!storage.getBinary||!storage.readObjectMetadata)throw Error('fuel_preview_object_storage_required');
for(const method of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'] as const)(storage as any)[method]=async()=>{throw Error('fuel_preview_write_forbidden');};
const deadline=Date.now()+260_000,pinned=new Map<string,string>(),objects:any[]=[],sources=new Map<string,any>();
let bytesRead=0,partReads=0;
const assertTime=()=>{if(Date.now()>deadline)throw Error('fuel_preview_time_bound');};
async function raw(path:string,maxBytes=128*1024*1024,pin=true){
 assertTime();
 const before=pin?await storage.readObjectMetadata!(path):null;
 if(pin&&(!before?.found||!before.etag))throw Error('fuel_preview_missing:'+path);
 const body=await storage.getBinary!(path);bytesRead+=body.data.length;
 if(body.data.length>maxBytes || bytesRead>2*1024*1024*1024)throw Error('fuel_preview_bytes_bound');
 if(pin){const after=await storage.readObjectMetadata!(path);if(after.etag!==before!.etag)throw Error('fuel_preview_changed:'+path);pinned.set(path,before!.etag!);}
 return JSON.parse(body.data.toString('utf8'));
}
async function health(){const r=await fetch('https://avtocena.com/api/health',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok)throw Error('fuel_preview_health_'+r.status);const h=await r.json();if(h.releaseSha!==request.release)throw Error('fuel_preview_release_changed');return {releaseSha:h.releaseSha,calculationVersion:h.calculationVersion};}
async function writerFree(){const lock=await raw('catalog/import-lock.json',65536,false);if(lock?.lockedUntil&&(!Number.isFinite(Date.parse(lock.lockedUntil))||Date.parse(lock.lockedUntil)>Date.now()))throw Error('fuel_preview_writer_active');return {operationId:lock?.operationId,lockedUntil:lock?.lockedUntil};}
const beforeHealth=await health(),beforeWriter=await writerFree();
const manifest=await raw('catalog/manifest.json',1024*1024);
if(manifest.generationId!==request.generationId)throw Error('fuel_preview_generation_changed');
const generation=manifest.generationId;
for(const id of request.offerIds){
 const hash=detailHash(id);let source;
 for(let depth=2;depth<=8;depth++){
  const shard=await raw(detailShardPath(generation,hash.slice(0,depth)),16*1024*1024);
  if(shard.generationId!==generation||!Array.isArray(shard.items)||shard.items.length>500)throw Error('fuel_preview_source_shard');
  if(shard.children===true){if(shard.items.length)throw Error('fuel_preview_source_directory');continue;}
  const found=shard.items.filter((row:any)=>row.id===id);if(found.length!==1)throw Error('fuel_preview_source_missing');source=found[0];break;
 }
 if(!source)throw Error('fuel_preview_source_depth_bound');sources.set(id,source);
}
function inspect(path:string,value:any,required:string[],part=false){
 if(!part&&value?.generationId!==generation)throw Error('fuel_preview_projection_generation:'+path);
 const result=repairFuelRows(value.items,sources);
 if(required.some(id=>!result.found.includes(id)))throw Error('fuel_preview_projection_target_missing:'+path);
 if(result.found.length){const next={...value,items:result.items};objects.push({path,etag:pinned.get(path)||null,beforeDigest:fuelRepairDigest(value),afterDigest:fuelRepairDigest(next),found:result.found,changed:result.changed,rows:value.items.length});}
 return result;
}
const scopes=new Map<string,Set<string>>();
const add=(path:string,id:string)=>{if(!scopes.has(path))scopes.set(path,new Set());scopes.get(path)!.add(id);};
for(const [id,source] of sources){
 const market=catalogIndexShardKey(source.market),make=catalogIndexShardKey(source.make);
 const brandHash=createHash('sha256').update(String(source.make).replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU')).digest('hex').slice(0,16);
 for(const path of [`catalog/public/projection/${market}.json`,`catalog/generations/${generation}/indexes/projection/${market}.json`,`catalog/public/projection-brand/${make}-${brandHash}.json`,`catalog/generations/${generation}/indexes/projection-brand/${make}-${brandHash}.json`])add(path,id);
}
for(const [path,ids] of scopes)inspect(path,await raw(path),[...ids]);
const budgetPath=`catalog/generations/${generation}/indexes/budget-count-v3.json`;
const budget=await raw(budgetPath);
if(budget.generationId!==generation||budget.version!==3||!Array.isArray(budget.rows)||!Array.isArray(budget.otherRows))throw Error('fuel_preview_budget_schema');
const budgetTargets=[];
for(const id of request.offerIds){
 const matches=[...budget.rows,...budget.otherRows].filter((row:any)=>row?.[5]?.id===id);
 if(matches.length!==1||!Number.isSafeInteger(matches[0][5].block)||matches[0][5].block<0)throw Error('fuel_preview_budget_target');
 const row=matches[0],path=`catalog/generations/${generation}/indexes/budget-cards-v3/${row[5].block}.json`;
 if(!scopes.has(path)){const part=await raw(path,16*1024*1024);if(part.items.length>256)throw Error('fuel_preview_budget_block_bound');inspect(path,part,[id]);scopes.set(path,new Set([id]));}
 budgetTargets.push({id,block:row[5].block,inOtherRows:budget.otherRows.includes(row),hasReplay:Boolean(row[7]),storedTotal:row[1]});
}
const rootPath='catalog/public/projection/all.json',root=await raw(rootPath,1024*1024);
if(root.storageFormat!=='catalog-projection-parts-v1'||root.generationId!==generation||!Array.isArray(root.parts)||root.parts.length>1000)throw Error('fuel_preview_parts_schema');
const counts=new Map(request.offerIds.map((id:string)=>[id,0]));let offset=0;
const readOnlyParts={...storage,readJson:async(path:string)=>{partReads++;return raw(path,16*1024*1024,false);}};
for await(const batch of catalogProjectionBatches(readOnlyParts as any,rootPath,root)){
 assertTime();const descriptor=root.parts[offset++];
 const result=inspect(descriptor.path,{items:batch.items},[],true);
 for(const id of result.found)counts.set(id,Number(counts.get(id))+1);
}
if([...counts.values()].some(count=>count!==1))throw Error('fuel_preview_parts_target_count');
for(const [path,etag] of pinned){assertTime();if((await storage.readObjectMetadata!(path)).etag!==etag)throw Error('fuel_preview_final_changed:'+path);}
const afterWriter=await writerFree(),afterHealth=await health();
if(beforeHealth.calculationVersion!==afterHealth.calculationVersion)throw Error('fuel_preview_calculation_changed');
const plan={version:1,release:request.release,generationId:generation,sources:[...sources].map(([id,row])=>({id,digest:fuelRepairDigest(row)})),pinned:[...pinned].map(([path,etag])=>({path,etag})),objects,budgetTargets};
const report={checkedAt:new Date().toISOString(),mode:'preview',productionWrites:0,verified:true,planDigest:fuelRepairDigest(plan),plan,beforeHealth,afterHealth,beforeWriter,afterWriter,partReads,bytesRead,changedObjects:objects.filter(o=>o.changed.length).length,changedValues:0,
 remaining:['Apply requires exact fresh source/generation/ETag checks and writer lease; no apply is implemented by this preview.','Price snapshots and live search/detail parity require verification after repair.']};
await mkdir('reports',{recursive:true});await writeFile('reports/catalog-fuel-evidence-repair-preview.json',JSON.stringify(report,null,2)+'\n');
console.log('FUEL_EVIDENCE_REPAIR_PREVIEW',JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
