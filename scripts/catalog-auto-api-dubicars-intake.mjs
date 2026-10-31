import fs from 'node:fs/promises';
import path from 'node:path';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {stableOfferId} from '../apps/web/lib/catalog/storage.ts';
import {normalizeAutoApiDubicars,AUTO_API_DUBICARS_SOURCE as sourceId} from '../apps/web/lib/catalog/auto-api-dubicars.ts';
import {autoApiChe168Client,collectAutoApiChe168} from './lib/auto-api-che168-client.mjs';
import {observationShardWriter} from './lib/catalog-intake-checkpoint.mjs';
await assertCollectionEnabled('dubicars_feed');
const directory=process.env.AUTO_API_INTAKE_DIR||'catalog-intake-uae';
await fs.mkdir(directory,{recursive:true});
const files=await fs.readdir(directory);
let prior;
if(files.length){
 if(files.some(name=>name!=='report.json'&&!/^(?:dubizzle_uae_open|carswitch_uae_open)-[0-9]+\.jsonl$/.test(name)))throw Error('auto_api_intake_output_not_empty');
 prior=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
 if(prior.market!=='uae'||!Array.isArray(prior.sources)||prior.sources.some(row=>!['dubizzle_uae_open','carswitch_uae_open'].includes(row.sourceId)))throw Error('auto_api_invalid_prior_intake');
}
const write=observationShardWriter(directory,sourceId),seen=new Set(),withdrawn=new Map();
const deadline=Date.now()+Math.min(300*60000,Number(process.env.CATALOG_INTAKE_TIME_MS||210*60000));
const request=autoApiChe168Client({platform:'dubicars',apiKey:process.env.AUTO_API_DUBICARS_KEY,deadline,requestDelayMs:200,fetchImpl:async(...args)=>{await assertCollectionEnabled('dubicars_feed');return fetch(...args);}});
const saved=await getJsonStorage().readJson('catalog/intake-cursors/v1/uae.json',null);
const previous=saved?.sources?.find(row=>row.sourceId===sourceId&&row.provider==='auto_api_dubicars');
const age=Date.now()-Date.parse(previous?.snapshotStartedAt);
const resume=process.env.CATALOG_INTAKE_RESUME!=='0'&&saved?.version===1&&saved.market==='uae'&&saved.generationId&&previous&&Number.isSafeInteger(previous.cursor)&&previous.cursor>=0&&['source_finished','source_changes_finished'].includes(previous.stopReason)&&age>=0&&age<7*86400000?{cursor:previous.cursor,snapshotStartedAt:previous.snapshotStartedAt}:null;
const report={version:1,market:'uae',provider:'auto_api_dubicars',startedAt:new Date().toISOString(),completed:false,productionWrites:false,requiredSourceIds:[...new Set([sourceId,...(prior?.requiredSourceIds||prior?.sources?.map(row=>row.sourceId)||[])])],sources:[],confirmedWithdrawals:[]};
let observations=0,rejectedIdentity=0,lastProgress={},lastLog=0;
async function checkpoint(progress=lastProgress){lastProgress=progress;report.sources=[{sourceId,provider:report.provider,...progress,syncMode:progress.mode,observations,uniqueOffers:seen.size,rejectedIdentity,stopReason:report.completed?(progress.mode==='delta'?'source_changes_finished':'source_finished'):'collecting'}];report.sources.push(...(prior?.sources||[]));report.confirmedWithdrawals=[...withdrawn.values(),...(prior?.confirmedWithdrawals||[])];await fs.writeFile(path.join(directory,'report.tmp'),JSON.stringify(report));await fs.rename(path.join(directory,'report.tmp'),path.join(directory,'report.json'));if(Date.now()-lastLog>60000||report.completed){console.log(JSON.stringify({market:'uae',...report.sources[0],completed:report.completed}));lastLog=Date.now();}}
try{
 const completed=await collectAutoApiChe168({request,resume,onOffer:async(row,observedAt)=>{const offer=normalizeAutoApiDubicars(row,observedAt);if(!offer){rejectedIdentity++;return;}seen.add(offer.id);observations++;await write({stage:'detail',observedAt,offer});},onRemoval:async(change)=>{const sourceOfferId=String(change.inner_id),id=stableOfferId(sourceId,sourceOfferId);const old=withdrawn.get(id);if(!old||Date.parse(old.observedAt)<Date.parse(change.created_at))withdrawn.set(id,{id,sourceId,sourceOfferId,market:'uae',status:'removed',observedAt:change.created_at});},onProgress:checkpoint});
 if(!seen.size&&!resume)throw Error('auto_api_empty_inventory');
 if(rejectedIdentity)throw Error('auto_api_rejected_identity_review_required');
 Object.assign(report,{completed:true,completedAt:completed.completedAt});await checkpoint(completed);
}catch(error){report.failure=/^auto_api_[a-z0-9_]+$/.test(String(error?.message))?error.message:'auto_api_collection_failed';await checkpoint();throw Error(report.failure);}
