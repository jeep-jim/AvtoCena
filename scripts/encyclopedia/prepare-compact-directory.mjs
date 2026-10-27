import {commitDirectorySnapshot} from '../../apps/web/lib/encyclopedia/directory-plan.ts';
import {mechanicalFields} from '../../apps/web/lib/encyclopedia/compact.ts';
// Manual, saved-data-only migration. Never fetch cars or scan inventory on page requests.
import {randomUUID} from 'node:crypto';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {catalogGenerationId,readCatalogDirectoryCountRows,readCurrentPublicCatalogProjection} from '../../apps/web/lib/catalog/storage.ts';
import {readEncyclopediaIdentityResolver} from '../../apps/web/lib/catalog/encyclopedia-identity-data.ts';
import {readAjesQueryCache} from '../../apps/web/lib/catalog/ajes-query-cache.ts';
import {ajesQuery} from '../../apps/web/lib/catalog/ajes-query.ts';
import {readCollectionControls} from '../../apps/web/lib/catalog/collection-controls.ts';
import {MANIFEST,ROOT,modelId,summarize} from '../../apps/web/lib/encyclopedia/records.ts';
import {createSnapshotBuilder} from '../../apps/web/lib/encyclopedia/snapshot.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';
const store=getJsonStorage();
if(store.driver!=='object')throw Error('durable_object_storage_required');
const manifest=await store.readJson(MANIFEST,null);
if(!manifest)throw Error('existing_encyclopedia_required');
if(manifest.directoryCapturedAt){console.log(JSON.stringify({alreadyPrepared:true,capturedAt:manifest.directoryCapturedAt}));process.exit(0);}
const generation=await catalogGenerationId(),at=new Date().toISOString();
const resolver=await readEncyclopediaIdentityResolver();
const identity=(row)=>{const match=resolver?.resolve(row);return {make:match?.brandId?match.canonicalMake:row.make,model:match?.modelId?match.canonicalModel:row.model};};
const scope=new Map();
const add=(row,count,upperBound=false)=>{const name=identity(row);if(!isEncyclopediaCar(name)||!name.make||!name.model)return;const id=modelId(name.make,name.model),old=scope.get(id);scope.set(id,{...name,count:(old?.count||0)+count,upperBound:Boolean(old?.upperBound||upperBound)});};
for(const row of await readCatalogDirectoryCountRows())add(row,row.count);
const controls=await readCollectionControls();
// Exact cached aggregate queries only. A partial page is never a complete model list.
for(const [table,market] of [['stats','japan'],['korea','korea']]){
 if(controls.markets[market]?.enabled===false||controls.sources[`ajes_${market}_feed`]?.enabled===false)continue;
 const dedicated=await store.readJson(`catalog/partner-cache/ajes/compact-directory/${market}.json`,null);
 let complete=false;const seen=new Set();
 for(let page=1;page<=10;page++){
  const query=ajesQuery({table,aggregate:'models',page});
  const saved=dedicated?.complete&&dedicated.pages?.[page-1]?.sql===query.sql?dedicated.pages[page-1].value:await readAjesQueryCache(store,query.sql);
  if(!saved||saved.partial||saved.stale||!Array.isArray(saved.models)||!Number.isInteger(saved.received)||Date.now()-Date.parse(saved.observedAt)>86400000||!Number.isFinite(Date.parse(saved.observedAt)))throw Error(`fresh_complete_saved_directory_required:${market}:${page}`);
  for(const row of saved.models){const key=JSON.stringify([row.make,row.model]);if(seen.has(key)||!Number.isSafeInteger(row.total)||row.total<0)throw Error('invalid_directory_count');seen.add(key);add(row,row.total,true);}
  if(saved.received<500){complete=true;break;}
 }
 if(!complete)throw Error(`directory_incomplete:${market}`);
}
if(!scope.size)throw Error('empty_directory');
const projection=await readCurrentPublicCatalogProjection();
if(projection.generationId!==generation)throw Error('catalog_generation_changed');
const builder=createSnapshotBuilder(at);
for(const row of projection.rows)builder.add({...row,...identity(row)});
const existing=new Map(manifest.models.map(m=>[modelId(m.make,m.model),m]));
const prepared=new Map(),additions=[];
const signature=v=>JSON.stringify(mechanicalFields.map(f=>v[f]??null));
for(const [id,entry] of scope){
 const summary=existing.get(id),record=summary?await store.readJson(summary.key,null):builder.models.get(id)||{id,...entry,photo:'',revision:randomUUID(),updatedAt:at,variants:[]};
 if(!record||summary&&record.revision!==summary.revision)throw Error('encyclopedia_revision_mismatch');
 const snapshot={capturedAt:at,count:entry.count,upperBound:entry.upperBound};
 if(summary){
  const keys=new Set(record.variants.map(signature));
  const extra=(builder.models.get(id)?.variants||[]).filter(v=>{const key=signature(v);if(keys.has(key))return false;keys.add(key);return true;});
  let next=record,key=summary.key;
  if(extra.length){next={...record,variants:[...record.variants,...extra],revision:randomUUID(),updatedAt:at,previousKey:summary.key,directorySnapshot:snapshot};key=`${ROOT}/revisions/${record.id}/${next.revision}.json`;await store.writeJson(key,next,{ifNoneMatch:'*'});}
  prepared.set(summary.id,{...summarize(next,key),directorySnapshot:snapshot});
 }
 else{
  record.directorySnapshot=snapshot;
  const key=`${ROOT}/revisions/${id}/${record.revision}.json`;
  await store.writeJson(key,record,{ifNoneMatch:'*'});additions.push(summarize(record,key));
 }
}
if(await catalogGenerationId()!==generation)throw Error('catalog_generation_changed');
await store.writeJson(`${ROOT}/directory-backups/${randomUUID()}.json`,manifest,{ifNoneMatch:'*'});
await mutateDataJson(MANIFEST,null,current=>commitDirectorySnapshot(current,manifest,prepared,additions,at));
console.log(JSON.stringify({prepared:true,models:prepared.size+additions.length,added:additions.length,capturedAt:at,sourceRecordsPreserved:true}));
