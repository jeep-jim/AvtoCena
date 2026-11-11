// Refresh exact existing IDs independently of the listing endpoint; guarded publication is separate.
import fs from 'node:fs/promises';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {kcarKoreaExactSource} from '../apps/web/lib/catalog/kcar-exact-source.ts';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory.ts';
import {restoreKcarRecovery,saveKcarRecovery} from './lib/kcar-recovery-checkpoint.mjs';
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('production_storage_required');
const durable=process.env.KCAR_RECOVERY_DURABLE==='1';
const checkpointStorage=Object.fromEntries(['readJson','getBinary','putBinary','writeJson','deleteBinary'].map(key=>[key,storage[key].bind(storage)]));
for(const key of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[key]=async()=>{throw Error('collection_read_only');};
const rows=(await readMarketOffers('korea')).filter(x=>x.sourceId==='kcar_korea_open');
const requested=Number(process.env.KCAR_REGISTRY_RECOVERY_LIMIT || 0);
if(!Number.isFinite(requested) || requested<0)throw Error('invalid_recovery_limit');
const limit=requested?Math.min(rows.length,requested):rows.length;
const state=(durable?await restoreKcarRecovery(checkpointStorage):null)||{version:2,startedAt:new Date().toISOString(),complete:false,records:[]};
const records=new Map(state.records.map(r=>[r.id,r]));
const report={startedAt:state.startedAt,available:rows.length,limit,resumed:records.size,attempted:0,refreshed:0,powerConfirmed:0,productionDateConfirmed:0,calculated:0,errors:[],confirmedWithdrawals:[],stopReason:'complete',sample:[]};
let consecutiveErrors=0,lastSaved=Date.now(),sinceSave=0;
const deadline=Date.now()+Math.max(60,Number(process.env.KCAR_RECOVERY_SECONDS || 9000))*1000;
for(const row of rows.slice(0,limit)) {
 if(records.has(row.id))continue;
 if(Date.now()>deadline){report.stopReason='time_budget';break;}
 report.attempted++;
 try {
  const fresh=await kcarKoreaExactSource.refreshOffer(row);
  records.set(row.id,{id:row.id,offer:fresh});consecutiveErrors=0;
 } catch(error) {
  const message=String(error?.message || error);
  if(message===`kcar_exact_detail_sold_${row.sourceOfferId}`){records.set(row.id,{id:row.id,withdrawal:{id:row.id,sourceId:row.sourceId,sourceOfferId:row.sourceOfferId,market:'korea',status:'sold',observedAt:new Date().toISOString()}});consecutiveErrors=0;}
  else {report.errors.push({id:row.sourceOfferId,message,cause:error?.cause?.code,networkCodes:error?.cause?.errors?.map(e=>e.code)});consecutiveErrors++;}
  if(error?.blocked){report.stopReason='blocked';break;}
  if(consecutiveErrors>=5){report.stopReason='source_unavailable';break;}
 }
 sinceSave++;
 if(sinceSave>=100 || Date.now()-lastSaved>=300000){
  state.records=[...records.values()];if(durable)await saveKcarRecovery(checkpointStorage,state);
  console.log(JSON.stringify({stage:'recovery_progress',attempted:report.attempted,completed:records.size,total:limit,errors:report.errors.length}));
  sinceSave=0;lastSaved=Date.now();
 }
}
const offers=[];
for(const row of rows.slice(0,limit)){
 const record=records.get(row.id);if(!record)continue;
 if(record.withdrawal){report.confirmedWithdrawals.push(record.withdrawal);continue;}
 const fresh=record.offer;offers.push(fresh);report.refreshed++;
 report.powerConfirmed+=Number(fresh.powerDataSource==='kcar_bound_registry_and_detail_hp' && fresh.powerHp>0);
 report.productionDateConfirmed+=Number(Boolean(fresh.operational?.semanticEvidence?.productionDate?.value));
 const prepared=await prepareSellerInventory(fresh);report.calculated+=Number(prepared?.totalRub>0);
 if(report.sample.length<10)report.sample.push({id:fresh.sourceOfferId,make:fresh.make,model:fresh.model,year:fresh.year,productionDate:fresh.productionDate,powerHp:fresh.powerHp,totalRub:prepared?.totalRub,pricingMode:prepared?.catalogPricingMode});
}
state.complete=rows.slice(0,limit).every(row=>records.has(row.id));state.records=[...records.values()];
if(durable)await saveKcarRecovery(checkpointStorage,state);
report.complete=state.complete;report.completedAt=new Date().toISOString();
if(report.stopReason==='complete'&&!state.complete)report.stopReason='partial_errors';
const dir=process.env.CATALOG_REBUILD_INPUT_DIR || 'kcar-registry-input';await fs.mkdir(dir,{recursive:true});
await fs.writeFile('kcar-registry-recovery-report.json',JSON.stringify(report,null,2));
await fs.writeFile(`${dir}/catalog-rebuild-korea-registry.json`,JSON.stringify({market:'korea',offers,report:{confirmedWithdrawals:report.confirmedWithdrawals,sources:[{sourceId:'kcar_korea_open',mode:'live',pages:1,freshSaved:offers.length,stopReason:'existing_inventory_'+report.stopReason}]}}));
console.log(JSON.stringify(report,null,2));
if(['blocked','source_unavailable'].includes(report.stopReason)||!offers.length)process.exitCode=1;
