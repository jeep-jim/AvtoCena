// Bounded exact refresh of existing inventory. Publication is a separate guarded step.
import fs from 'node:fs/promises';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {kcarKoreaExactSource} from '../apps/web/lib/catalog/kcar-exact-source.ts';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory.ts';
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('production_storage_required');
for(const key of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix']) storage[key]=async()=>{throw Error('collection_read_only');};
const rows=(await readMarketOffers('korea')).filter(x=>x.sourceId==='kcar_korea_open');
const limit=Math.min(rows.length,Math.max(1,Number(process.env.KCAR_REGISTRY_RECOVERY_LIMIT || 60)));
const report={startedAt:new Date().toISOString(),available:rows.length,limit,attempted:0,refreshed:0,powerConfirmed:0,productionDateConfirmed:0,calculated:0,errors:[],confirmedWithdrawals:[],stopReason:'bounded_sample',sample:[]};
const offers=[];
const dir=process.env.CATALOG_REBUILD_INPUT_DIR || 'kcar-registry-input';
await fs.mkdir(dir,{recursive:true});
for(const row of rows.slice(0,limit)) {
 report.attempted++;
 try {
  const fresh=await kcarKoreaExactSource.refreshOffer(row);
  report.refreshed++;
  report.powerConfirmed+=Number(fresh.powerDataSource==='kcar_bound_registry_and_detail_hp' && fresh.powerHp>0);
  report.productionDateConfirmed+=Number(Boolean(fresh.operational?.semanticEvidence?.productionDate?.value));
  const prepared=await prepareSellerInventory(fresh);
  report.calculated+=Number(prepared?.totalRub>0);
  if(report.sample.length<10)report.sample.push({id:fresh.sourceOfferId,make:fresh.make,model:fresh.model,year:fresh.year,productionDate:fresh.productionDate,powerHp:fresh.powerHp,totalRub:prepared?.totalRub,pricingMode:prepared?.catalogPricingMode});
  offers.push(fresh);
 } catch(error) {
  const message=String(error?.message || error);
  if(message===`kcar_exact_detail_sold_${row.sourceOfferId}`) report.confirmedWithdrawals.push({id:row.id,sourceId:row.sourceId,sourceOfferId:row.sourceOfferId,market:'korea',status:'sold',observedAt:new Date().toISOString()});
  else report.errors.push({id:row.sourceOfferId,message});
  if(error?.blocked){report.stopReason='blocked';break;}
 }
 await fs.writeFile('kcar-registry-recovery-report.json',JSON.stringify(report,null,2));
}
report.completedAt=new Date().toISOString();
await fs.writeFile('kcar-registry-recovery-report.json',JSON.stringify(report,null,2));
await fs.writeFile(`${dir}/catalog-rebuild-korea-registry.json`,JSON.stringify({market:'korea',offers,report:{confirmedWithdrawals:report.confirmedWithdrawals,sources:[{sourceId:'kcar_korea_open',mode:'live',pages:1,freshSaved:offers.length,stopReason:report.stopReason}]}}));
console.log(JSON.stringify(report,null,2));
if(report.stopReason==='blocked' || !offers.length)process.exitCode=1;
