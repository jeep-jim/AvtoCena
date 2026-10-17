// Owner-requested, bounded read-only check. Never log provider payloads or keys.
import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {readCollectionControls} from '../apps/web/lib/catalog/collection-controls.ts';
import {COLLECTION_MARKETS,COLLECTION_SOURCES,collectionEnabled,collectionMarketEnabled} from '../apps/web/lib/catalog/collection-controls-schema.ts';
import {snapshotBinding} from './lib/che168-snapshot.mjs';
import {autoApiChe168Client,autoApiPage} from './lib/auto-api-che168-client.mjs';
const storage=getJsonStorage(),controls=await readCollectionControls();
const manifest=await storage.readJson('catalog/manifest.json',null);
console.log(JSON.stringify({generationId:manifest?.generationId,markets:manifest?.markets}));
for(const {id:market} of COLLECTION_MARKETS){
 const [operation,cursor]=await Promise.all([storage.readJson(`catalog/operations/markets/${market}.json`,null),storage.readJson(`catalog/intake-cursors/v1/${market}.json`,null)]);
 console.log(JSON.stringify({market,enabled:collectionMarketEnabled(controls,market),sources:COLLECTION_SOURCES.filter(s=>s.market===market).map(s=>({id:s.id,enabled:collectionEnabled(controls,s.id)})),operation:operation&&{runId:operation.runId,lastAttemptAt:operation.lastAttemptAt,lastPublicationSuccess:operation.lastPublicationSuccess,lastCollectionSuccess:operation.lastCollectionSuccess,publicationStatus:operation.publicationStatus,collectionComplete:operation.collectionComplete,publishedCount:operation.publishedCount},cursor:cursor&&{generationId:cursor.generationId,updatedAt:cursor.updatedAt,sources:cursor.sources?.map(s=>({id:s.sourceId,provider:s.provider,stopReason:s.stopReason,cursor:s.cursor,hasReplica:Boolean(s.replica)}))}}));
}
const config=JSON.parse(await fs.readFile('data/catalog/che168-snapshot-v1.json','utf8')),binding=snapshotBinding(config);
const archive=await storage.readJson(`catalog/provider-snapshots/che168/${binding}/manifest.json`,null);
const cursor=await storage.readJson('catalog/intake-cursors/v1/china.json',null),source=cursor?.sources?.find(s=>s.provider==='auto_api_che168');
console.log(JSON.stringify({chinaArchive:{complete:archive?.complete===true,bindingMatches:archive?.binding===binding,parts:archive?.parts?.length,bytes:config.bytes},chinaResume:{bindingMatches:source?.snapshotBinding===binding,hasReplica:Boolean(source?.replica),cursor:source?.cursor}}));
if(collectionEnabled(controls,'che168_feed')){
 try{const request=autoApiChe168Client({apiKey:process.env.AUTO_API_CHE168_KEY,deadline:Date.now()+90000});const page=autoApiPage(await request('offers',{page:1}),1);console.log(JSON.stringify({paidFeedAccess:true,firstPageRows:page.items.length,hasNextPage:page.next!==null}));}
 catch(error){const code=/^auto_api_[a-z0-9_]+$/.test(error.message)?error.message:'provider_check_failed';console.log(JSON.stringify({paidFeedAccess:false,error:code}));process.exitCode=1;}
}
const repo='jeep-jim/AvtoCena';
async function api(path){const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{headers:{authorization:`Bearer ${process.env.GH_TOKEN}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('github_status_'+r.status);return r.json();}
for(const name of ['catalog-refresh-china','catalog-refresh-korea','catalog-refresh-europe','catalog-refresh-uae','catalog-refresh-georgia','catalog-refresh-green']){
 const w=await api(`/actions/workflows/${name}.yml`),runs=await api(`/actions/workflows/${w.id}/runs?per_page=1`);
 const r=runs.workflow_runs[0];console.log(JSON.stringify({workflow:name,state:w.state,lastRun:r&&{id:r.id,at:r.created_at,status:r.status,conclusion:r.conclusion}}));
}
