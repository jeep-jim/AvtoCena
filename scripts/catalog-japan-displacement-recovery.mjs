import fs from 'node:fs/promises';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {inventorySourceEvidence,prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory.ts';
import {enrichJapanOfficialDisplacement} from '../apps/web/lib/catalog/japan-official-displacement.ts';
const storage=getJsonStorage();for(const k of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[k]=async()=>{throw Error('recovery_read_only');};
const rows=await readMarketOffers('japan'),offers=[];
const report={startedAt:new Date().toISOString(),available:rows.length,matched:0,calculated:0,remainingBlockers:{},samples:[],errors:[]};
for(const row of rows){
 const source=inventorySourceEvidence(row),enriched=enrichJapanOfficialDisplacement(source);if(enriched===source)continue;report.matched++;
 try{const prepared=await prepareSellerInventory(enriched);if(!prepared){report.errors.push({id:row.id,error:'preparation_rejected'});continue;}offers.push(enriched);report.calculated+=Number(prepared.totalRub>0);if(!(prepared.totalRub>0)){const key=prepared.operational?.calculationBlocker||prepared.calculationStatus;report.remainingBlockers[key]=(report.remainingBlockers[key]||0)+1;}if(report.samples.length<10)report.samples.push({id:row.id,model:row.model,year:row.year,chassis:row.operational?.chassisCode,engineCc:prepared.engineCc,powerHp:prepared.powerHp,totalRub:prepared.totalRub});}catch(error){report.errors.push({id:row.id,error:String(error)});}
}
const dir=process.env.CATALOG_REBUILD_INPUT_DIR||'japan-displacement-input';await fs.mkdir(dir,{recursive:true});
await fs.writeFile(`${dir}/catalog-rebuild-japan-official.json`,JSON.stringify({market:'japan',offers,report:{confirmedWithdrawals:[],sources:[{sourceId:'proauctions_japan_stat',mode:'live',pages:0,freshSaved:offers.length,stopReason:'existing_inventory_official_displacement_only'}]}}));
report.completedAt=new Date().toISOString();await fs.writeFile('japan-displacement-recovery-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.errors.length||!offers.length)process.exitCode=1;
