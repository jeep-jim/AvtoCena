import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getJsonStorage,StorageConflictError,type JsonStorage} from '../apps/web/lib/data';
import {COLLECTION_SOURCES,defaultCollectionControls,collectionEnabled,collectionMarketEnabled} from '../apps/web/lib/catalog/collection-controls-schema';
import {COLLECTION_CONTROLS_KEY,saveCollectionSwitch,readCollectionControls,validateCollectionControls,clearCollectionControlsCache,CollectionControlsConflict,CollectionControlsInputError} from '../apps/web/lib/catalog/collection-controls';
import {guardCollectionAdapter} from '../apps/web/lib/catalog/collection-adapter-guard';
import {collectionWorkflowEnabled} from '../apps/web/lib/catalog/collection-controls-schema';
import {failedWorkflowRetryBudget} from '../scripts/lib/catalog-recovery-policy.mjs';
function memory(){
 let saved:unknown=null,etag=0;
 return {driver:'local',readJsonWithMeta:async()=>({value:structuredClone(saved),found:saved!==null,etag:saved===null?undefined:String(etag)}),writeJson:async (_:string,value:unknown,c:any)=>{if((c.ifNoneMatch==='*'&&saved!==null)||(c.ifMatch!==undefined&&c.ifMatch!==String(etag)))throw new StorageConflictError();saved=structuredClone(value);etag++;}} as unknown as JsonStorage;
}
test('AJ System is selectable only for Japan; retired switches cannot permit collection',()=>{
 const controls=defaultCollectionControls();
 assert.deepEqual(COLLECTION_SOURCES.filter(source=>source.id.startsWith('ajes_')).map(source=>({id:source.id,market:source.market})),[{id:'ajes_japan_feed',market:'japan'}]);
 for(const market of ['china','korea']){
  const id=`ajes_${market}_feed`;
  assert.equal(id in controls.sources,false);
  controls.sources[id]={enabled:true,enabledAt:null,disabledAt:null,changedBy:'legacy-owner'};
  assert.equal(collectionEnabled(controls,id),false);
 }
 controls.sources.ajes_japan_feed.enabled=true;
 assert.equal(collectionEnabled(controls,'ajes_japan_feed'),true);
 assert.equal(COLLECTION_SOURCES.find(source=>source.id==='che168_feed')?.label,'Che168 · платный фид Auto API');
 assert.equal(COLLECTION_SOURCES.find(source=>source.id==='dubicars_feed')?.label,'DubiCars · платный фид Auto API');
});
test('normalizing legacy controls removes only retired AJ switches and preserves all history and other decisions',async()=>{
 const legacy=defaultCollectionControls(),at='2026-11-23T12:00:00Z';
 legacy.revision=23;legacy.updatedAt=at;legacy.markets.uae.enabled=false;
 legacy.sources.ajes_japan_feed={enabled:true,enabledAt:at,disabledAt:null,changedBy:'owner'};
 legacy.sources.ajes_china_feed={enabled:true,enabledAt:at,disabledAt:null,changedBy:'owner'};
 legacy.sources.ajes_korea_feed={enabled:false,enabledAt:null,disabledAt:at,changedBy:'owner'};
 legacy.sources.retained_future_source={enabled:false,enabledAt:null,disabledAt:at,changedBy:'owner'};
 legacy.history=[{revision:23,at,actor:'owner',scope:'source',id:'ajes_korea_feed',enabled:false},{revision:22,at,actor:'owner',scope:'source',id:'ajes_japan_feed',enabled:true}];
 const before=structuredClone(legacy),expected=structuredClone(legacy);
 delete expected.sources.ajes_china_feed;delete expected.sources.ajes_korea_feed;
 assert.deepEqual(validateCollectionControls(legacy),expected);assert.deepEqual(legacy,before,'normalization never mutates the stored input');
 let writes=0;
 const storage={readJsonWithMeta:async()=>({found:true,value:legacy,etag:'legacy'}),writeJson:async()=>{writes++;}} as unknown as JsonStorage;
 assert.deepEqual(await readCollectionControls(storage),expected);assert.equal(writes,0,'reading settings does not write a migration');
});
test('retired AJ source updates are rejected before storage access, including stale clients',async()=>{
 let reads=0,writes=0;
 const storage={readJsonWithMeta:async()=>{reads++;throw Error('unexpected storage read');},writeJson:async()=>{writes++;}} as unknown as JsonStorage;
 for(const id of ['ajes_china_feed','ajes_korea_feed'])for(const enabled of [true,false]){
  await assert.rejects(saveCollectionSwitch({scope:'source',id,enabled,revision:0},'owner',storage),CollectionControlsInputError);
 }
 assert.equal(reads,0);assert.equal(writes,0);
 const japan=await saveCollectionSwitch({scope:'source',id:'ajes_japan_feed',enabled:true,revision:0},'owner',memory());
 assert.equal(collectionEnabled(japan,'ajes_japan_feed'),true);
 assert.equal(japan.history[0].id,'ajes_japan_feed');
});
test('green recovery obeys its Japan parent and fresh-main retries remain bounded across run IDs',()=>{
 const controls=defaultCollectionControls();
 assert.equal(collectionWorkflowEnabled(controls,'green'),true);
 assert.equal(collectionEnabled(controls,'proauctions_japan_stat'),false);
 assert.equal(collectionWorkflowEnabled(controls,'japan'),false);assert.equal(collectionWorkflowEnabled(controls,'green'),true);
 controls.markets.japan.enabled=false;assert.equal(collectionWorkflowEnabled(controls,'green'),false);
 const now=Date.now();let recovery:any={};
 for(let i=0;i<3;i++){const {allowed,...state}=failedWorkflowRetryBudget(recovery,now+i*7200000);assert.equal(allowed,true);recovery={...state,runId:String(i)};}
 assert.equal(failedWorkflowRetryBudget(recovery,now+6*3600000).allowed,false);
 assert.equal(failedWorkflowRetryBudget(recovery,now+25*3600000).allowed,true);
 const watchdog=readFileSync('scripts/catalog-autonomy-watchdog.mjs','utf8');
 assert.equal((watchdog.match(/api\(`actions\/workflows\/\$\{workflow\}\/dispatches`/g)||[]).length,1,'one POST for each recovery decision');
});
test('China feed is on, both reserves off, market off preserves source selections',async()=>{
 const s=memory();let c=await readCollectionControls(s);
 assert.equal(collectionEnabled(c,'che168_feed'),true);assert.equal(collectionEnabled(c,'autohome_used_china_open'),false);assert.equal(collectionEnabled(c,'autohome_new_china_open'),false);
 c=await saveCollectionSwitch({scope:'market',id:'china',enabled:false,revision:0},'owner',s);
 assert.equal(collectionMarketEnabled(c,'china'),false);assert.equal(c.sources.che168_feed.enabled,true);assert.ok(c.markets.china.disabledAt);
 c=await saveCollectionSwitch({scope:'market',id:'china',enabled:true,revision:1},'owner',s);
 assert.equal(collectionEnabled(c,'che168_feed'),true);assert.equal(collectionEnabled(c,'autohome_used_china_open'),false);assert.ok(c.markets.china.enabledAt);assert.equal(c.history.length,2);
});
test('manual reserve requires feed off; stale and concurrent updates cannot overwrite owner decision',async()=>{
 const s=memory();await assert.rejects(saveCollectionSwitch({scope:'source',id:'autohome_used_china_open',enabled:true,revision:0},'owner',s),CollectionControlsInputError);
 await saveCollectionSwitch({scope:'source',id:'che168_feed',enabled:false,revision:0},'owner',s);
 await assert.rejects(saveCollectionSwitch({scope:'market',id:'china',enabled:false,revision:0},'owner',s),CollectionControlsConflict);
 const c=await saveCollectionSwitch({scope:'source',id:'autohome_used_china_open',enabled:true,revision:1},'owner',s);
 assert.equal(collectionEnabled(c,'autohome_used_china_open'),true);
 const results=await Promise.allSettled(['korea','europe'].map(id=>saveCollectionSwitch({scope:'market',id,enabled:false,revision:2},'owner',s)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await readCollectionControls(s)).revision,3);
});
test('corrupt, unknown and unavailable controls never default to collection permission',async()=>{
 assert.throws(()=>validateCollectionControls(null));assert.throws(()=>validateCollectionControls({...defaultCollectionControls(),sources:{che168_feed:{enabled:'true'}}}));
 await assert.rejects(readCollectionControls({readJsonWithMeta:async()=>({found:true,value:null})} as any));
 await assert.rejects(saveCollectionSwitch({scope:'source',id:'guazi_china_open',enabled:true,revision:0},'owner',memory()),CollectionControlsInputError);
 const storage=getJsonStorage(),original=storage.readJsonWithMeta;
 storage.readJsonWithMeta=async()=>{throw Error('storage_unavailable');};clearCollectionControlsCache();
 let requests=0;const source=guardCollectionAdapter({sourceId:'encar_direct',fetchPage:async()=>{requests++;}} as any);
 try{await assert.rejects(source.fetchPage(),/storage_unavailable/);assert.equal(requests,0);}finally{storage.readJsonWithMeta=original;clearCollectionControlsCache();}
});
test('guard blocks real adapter methods, preserves class binding and responds to owner switch',async()=>{
 const storage=getJsonStorage(),original=storage.readJsonWithMeta;
 let controls=defaultCollectionControls();storage.readJsonWithMeta=async <T>()=>({found:true,value:controls as T,etag:'fixture'});clearCollectionControlsCache();
 class Adapter {sourceId='autohome_used_china_open';calls=0;async fetchPage(){this.calls++;return {items:[]};}async fetchImages(){this.calls++;return [];}normalizeOffer(){return this.calls;}}
 const raw=new Adapter(),source=guardCollectionAdapter(raw as any);
 try{
  await assert.rejects(source.fetchPage(),/collection_disabled_by_owner/);await assert.rejects(source.fetchImages({} as any),/collection_disabled_by_owner/);assert.equal(raw.calls,0);
  controls.sources.autohome_used_china_open.enabled=true;controls.sources.che168_feed.enabled=false;clearCollectionControlsCache();await source.fetchPage();assert.equal(raw.calls,1);assert.equal(source.normalizeOffer(null),1);
  controls.markets.china.enabled=false;clearCollectionControlsCache();await assert.rejects(source.fetchPage(),/collection_disabled_by_owner/);assert.equal(raw.calls,1);
 }finally{storage.readJsonWithMeta=original;clearCollectionControlsCache();}
});
test('owner-only API and source collection gates remain wired',()=>{
 const route=readFileSync('apps/web/app/(crm)/api/crm/collection-controls/route.ts','utf8');assert.equal((route.match(/isPlatformOwner\(/g)||[]).length,2);assert.match(route,/isCalculationOriginAllowed\(req\)/);assert.match(route,/private, no-store/);
 const page=readFileSync('apps/web/app/(crm)/crm/site/page.tsx','utf8');assert.match(page,/isPlatformOwner\(user\)&&<CollectionControls/);
 const workflow=readFileSync('.github/workflows/catalog-market-refresh.yml','utf8');assert.match(workflow,/collectionMarketEnabled\(controls,market\)/);assert.match(workflow,/steps.sources.outputs.feed == 'true'/);assert.match(workflow,/steps.sources.outputs.parsers != ''/);
 const watchdog=readFileSync('scripts/catalog-autonomy-watchdog.mjs','utf8');assert.match(watchdog,/disabled_by_owner/);assert.doesNotMatch(watchdog,/rerun-failed-jobs/);
 assert.equal(COLLECTION_CONTROLS_KEY,'catalog/operations/collection-controls-v1.json');
});
