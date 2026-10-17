import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {normalizeAutoApiChe168,autoApiChe168RejectionReason,isAutoApiChe168QuarantineReason,AUTO_API_CHE168_SOURCE as sourceId} from '../apps/web/lib/catalog/auto-api-che168.ts';
import {stableOfferId} from '../apps/web/lib/catalog/storage.ts';
import {autoApiChe168Client,collectAutoApiChe168} from './lib/auto-api-che168-client.mjs';
import {snapshotBinding,readChe168Snapshot} from './lib/che168-snapshot.mjs';
import {consumeChe168Csv} from './lib/che168-csv-stream.mjs';
import {saveChe168Replica,restoreChe168Replica} from './lib/che168-replica.mjs';
import {openChe168ReplayJournal} from './lib/che168-replay-journal.mjs';
import {observationShardWriter} from './lib/catalog-intake-checkpoint.mjs';

await assertCollectionEnabled('che168_feed');
const directory=process.env.AUTO_API_INTAKE_DIR||'catalog-intake-china';
const config=JSON.parse(await fs.readFile(process.env.CHE168_SNAPSHOT_CONFIG||'data/catalog/che168-snapshot-v1.json','utf8'));
const binding=snapshotBinding(config),storage=getJsonStorage();
if(storage.driver!=='object')throw Error('auto_api_durable_storage_required');
const yearFrom=new Date(Date.now()+7*3600000).getUTCFullYear()-6;
const saved=await storage.readJson('catalog/intake-cursors/v1/china.json',null);
const previous=saved?.sources?.find(row=>row.sourceId===sourceId);
// A legacy cursor is not aligned to the supplier's new file. Bootstrap once;
// later runs only restore the replica associated with a published cursor.
const resume=previous?.snapshotBinding===binding;
if(resume && (saved.version!==1||saved.market!=='china'||!saved.generationId||previous.provider!=='auto_api_che168'
  ||!Number.isSafeInteger(previous.cursor)||previous.cursor<config.initialCursor||!previous.replica
  ||!Number.isFinite(Date.parse(saved.updatedAt))||Date.parse(saved.updatedAt)>Date.now()
  ||previous.stopReason!=='source_finished'))throw Error('auto_api_invalid_saved_replica_cursor');
await fs.mkdir(directory,{recursive:true});
const files=await fs.readdir(directory);
let prior;
if(files.length){
  if(files.some(name=>name!=='report.json'&&!/^autohome_new_china_open-\d+\.jsonl$/.test(name)))throw Error('auto_api_intake_output_not_empty');
  prior=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
  if(prior.market!=='china'||!prior.completedAt||!Array.isArray(prior.sources)||prior.sources.some(row=>row.sourceId!=='autohome_new_china_open'))throw Error('auto_api_invalid_prior_intake');
}
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'che168-replica-')),filename=path.join(temp,'inventory.sqlite');
let db,source={sourceId,provider:'auto_api_che168',snapshotBinding:binding,snapshotStartedAt:config.modifiedAt,yearFrom,
  syncMode:'snapshot',mode:'snapshot',pages:resume?0:1,observations:0,rejectedIdentity:0,stopReason:'collecting'};
const report={version:1,provider:'auto_api_che168',market:'china',productionWrites:false,startedAt:new Date().toISOString(),completed:false,sources:[source,...(prior?.sources||[])],confirmedWithdrawals:[]};
const withdrawals=new Map(),quarantine=new Map();
async function checkpoint(){await fs.writeFile(path.join(directory,'report.tmp'),JSON.stringify(report));await fs.rename(path.join(directory,'report.tmp'),path.join(directory,'report.json'));}
await checkpoint();
try {
  if(resume)await restoreChe168Replica({storage,filename,descriptor:previous.replica,binding,cursor:previous.cursor});
  db=new DatabaseSync(filename);
  db.exec('PRAGMA cache_size=-16384; PRAGMA temp_store=FILE; CREATE TABLE IF NOT EXISTS inventory(id TEXT PRIMARY KEY,payload TEXT NOT NULL,event INTEGER NOT NULL);');
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('auto_api_invalid_replica_database');
  const put=db.prepare('INSERT INTO inventory VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,event=excluded.event WHERE excluded.event>=inventory.event');
  const get=db.prepare('SELECT payload,event FROM inventory WHERE id=?'),remove=db.prepare('DELETE FROM inventory WHERE id=? AND event<=?');
  const normalized=(row,at)=>{
    const offer=normalizeAutoApiChe168(row,at);
    if(!offer){const reason=autoApiChe168RejectionReason(row);if(!isAutoApiChe168QuarantineReason(reason))throw Error('auto_api_identity_review_required');
      return {kind:'quarantine',innerId:String(row.inner_id),reason,at};}
    return {kind:'offer',offer,at};
  };
  const apply=async event=>{
    if(!Number.isSafeInteger(event?.event)||event.event<config.initialCursor-1)throw Error('auto_api_invalid_replica_event');
    if(event.kind==='offer'){
      const o=event.offer;
      if(o?.sourceId!==sourceId||o.market!=='china'||o.id!==stableOfferId(sourceId,String(o.sourceOfferId))
        ||o.operational?.provider!=='auto-api.com'||o.operational?.detailIdentityVerified!==true)throw Error('auto_api_invalid_replica_offer');
      put.run(String(o.sourceOfferId),JSON.stringify(o),event.event);quarantine.delete(String(o.sourceOfferId));
    }else if(event.kind==='price'){
      const row=get.get(event.innerId);
      if(!row||!Number.isFinite(event.price)||event.price<=0||!Number.isFinite(Date.parse(event.at)))throw Error('auto_api_invalid_replica_price');
      if(row.event<=event.event){const o=JSON.parse(row.payload);
        o.sourcePrice=event.price;o.totalRub=null;o.calculationStatus='needs_data';o.updatedAt=event.at;
        o.operational={...o.operational,lastSeenAt:event.at,che168PriceChangeId:event.event};
        put.run(event.innerId,JSON.stringify(o),event.event);}
    }else if(event.kind==='removed'||event.kind==='quarantine'){
      if(!/^\d+$/.test(event.innerId)||!Number.isFinite(Date.parse(event.at)))throw Error('auto_api_invalid_replica_event');
      remove.run(event.innerId,event.event);
      if(event.kind==='quarantine'){
        if(!isAutoApiChe168QuarantineReason(event.reason))throw Error('auto_api_invalid_replica_quarantine');
        quarantine.set(event.innerId,event.reason);
      }else{const id=stableOfferId(sourceId,event.innerId);withdrawals.set(id,{id,sourceId,sourceOfferId:event.innerId,market:'china',status:'removed',observedAt:event.at});quarantine.delete(event.innerId);}
    }else throw Error('auto_api_invalid_replica_event');
  };
  if(!resume){
    let rows=0;db.exec('BEGIN');
    source.csv=await consumeChe168Csv({chunks:readChe168Snapshot({config,storage}),yearFrom,onRow:async row=>{
      await apply({...normalized(row,config.modifiedAt),event:config.initialCursor-1});
      if(++rows%1000===0){db.exec('COMMIT; BEGIN');if(rows%10000===0)console.log(JSON.stringify({phase:'csv',rows}));}
    }});
    db.exec('COMMIT');
  }
  const initialCursor=resume?previous.cursor:config.initialCursor;
  const journalBinding=createHash('sha256').update(JSON.stringify({binding,initialCursor,base:resume?previous.replica:null})).digest('hex');
  // Stable private working journal across runner failures, separate from the
  // committed publication cursor and the old legacy recovery artifact.
  const artifactRunId=BigInt(`0x${journalBinding.slice(0,14)}`).toString();
  const journal=await openChe168ReplayJournal({storage,artifactRunId,binding:journalBinding,initialCursor,apply});
  let pageEvents=[],pending=[],pendingBytes=0,lastCursor=journal.cursor,totalChanges=journal.changes,lastSave=Date.now();
  const previousChanges=journal.changes;
  const save=async()=>{
    if(lastCursor!==journal.cursor){await journal.commit({cursor:lastCursor,changes:totalChanges,events:pending});pending=[];pendingBytes=0;lastSave=Date.now();}
  };
  const request=async (...args)=>{await assertCollectionEnabled('che168_feed');return rawRequest(...args);};
  const rawRequest=autoApiChe168Client({apiKey:process.env.AUTO_API_CHE168_KEY,deadline:Date.now()+Math.min(240*60000,Number(process.env.CATALOG_INTAKE_TIME_MS||210*60000)),requestDelayMs:200});
  let completed;
  try{
    completed=await collectAutoApiChe168({request,yearFrom,resume:{cursor:journal.cursor,snapshotStartedAt:config.modifiedAt},useChangeData:true,
      onOffer:async(row,at,change)=>{const event={...normalized(row,at),event:change.id};await apply(event);pageEvents.push(event);},
      onRemoval:async change=>{const event={kind:'removed',innerId:String(change.inner_id),at:change.created_at,event:change.id};await apply(event);pageEvents.push(event);},
      onPriceChange:async change=>{
        const innerId=String(change.inner_id),price=Number(change.data.new_price);
        if(!Number.isFinite(price)||price<=0)throw Error('auto_api_invalid_changed_price');
        if(!get.get(innerId))return false;
        const event={kind:'price',innerId,price,at:change.created_at,event:change.id};await apply(event);pageEvents.push(event);return true;
      },
      onProgress:async progress=>{
        pending.push(...pageEvents);pendingBytes+=Buffer.byteLength(JSON.stringify(pageEvents));pageEvents=[];
        lastCursor=progress.cursor;totalChanges=previousChanges+progress.changes;
        if(totalChanges-journal.changes>=1000||pendingBytes>=8*1024*1024||Date.now()-lastSave>=60000){await save();source.cursor=lastCursor;source.changes=totalChanges;await checkpoint();}
      },
    });
    await save();
    source.cursor=lastCursor;source.changes=totalChanges;
  }catch(error){await save();source.cursor=lastCursor;source.changes=totalChanges;throw error;}
  const count=Number(db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n);
  if(!count)throw Error('auto_api_empty_inventory');
  // Owner instruction 09.10.2026: exclude unsuitable rows individually;
  // known missing-model/invalid-year rows must not block suitable inventory.
  // They have already been removed from SQLite by apply(). Identity failures,
  // corrupt archives, incomplete streams and empty inventory still fail closed.
  source.quarantined=quarantine.size;
  source.quarantineReasons=Object.fromEntries(['missing_model','invalid_year'].map(reason=>
    [reason,[...quarantine.values()].filter(value=>value===reason).length]));
  source.quarantinePolicy='exclude_invalid_rows_20261009';
  await checkpoint();
  const write=observationShardWriter(directory,sourceId);
  // The complete, gap-free event stream confirms which baseline rows remain
  // active. Preserve their actual detail date; record this distinct evidence.
  for(const row of db.prepare('SELECT payload FROM inventory').iterate()){
    const offer=JSON.parse(row.payload);
    offer.operational={...offer.operational,lastSeenAt:completed.completedAt,
      che168ActiveVerification:{method:'snapshot_and_complete_change_stream',snapshotBinding:binding,initialCursor:config.initialCursor,cursor:completed.cursor,verifiedAt:completed.completedAt}};
    await write({stage:'detail',observedAt:completed.completedAt,offer});
    source.observations++;
  }
  db.close();db=null;
  const replica=await saveChe168Replica({storage,filename,binding,cursor:completed.cursor});
  Object.assign(source,{cursor:completed.cursor,initialCursor,changes:totalChanges,uniqueOffers:count,replica,
    completeInventory:true,quarantined:quarantine.size,stopReason:'source_finished'});
  report.confirmedWithdrawals=[...withdrawals.values(),...(prior?.confirmedWithdrawals||[])];
  Object.assign(report,{completed:true,completedAt:completed.completedAt});await checkpoint();
  console.log(JSON.stringify({completed:true,mode:resume?'local_replica_and_changes':'csv_and_changes',offers:count,changes:totalChanges,cursor:completed.cursor,replicaSaved:true}));
}catch(error){
  report.failure=/^auto_api_[a-z0-9_]+$/.test(error?.message)?error.message:'auto_api_bulk_collection_failed';await checkpoint();throw Error(report.failure);
}finally{db?.close();await fs.rm(temp,{recursive:true,force:true});}
