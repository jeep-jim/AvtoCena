import fs from 'node:fs/promises';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {inventorySourceEvidence,prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory.ts';
import {matchKoreaOfficialPower,enrichEncarOfficialPower} from '../apps/web/lib/catalog/korea-official-power.ts';
const storage=getJsonStorage();
for(const key of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[key]=async()=>{throw Error('recovery_read_only');};
const rows=(await readMarketOffers('korea')).filter(x=>x.sourceId==='encar_direct');
const report={startedAt:new Date().toISOString(),available:rows.length,withBoundInspection:0,matched:0,lowPower:0,calculated:0,prepared:0,remaining:0,errors:[],sample:[]};
const offers=[];let next=0;
async function worker(){while(next<rows.length){const row=rows[next++];report.withBoundInspection+=Number(row.operational?.inspection?.identityVerified===true);const input=inventorySourceEvidence(row);const match=matchKoreaOfficialPower(input);if(!match){report.remaining++;continue;}report.matched++;report.lowPower+=Number(match.powerHp<=160);try{const enriched=enrichEncarOfficialPower(input);const prepared=await prepareSellerInventory(enriched);if(!prepared){report.errors.push({id:row.id,error:'prepare_rejected'});continue;}offers.push(enriched);report.prepared++;report.calculated+=Number(prepared.totalRub>0);if(report.sample.length<12)report.sample.push({id:row.id,make:row.make,model:row.model,year:row.year,powerHp:prepared.powerHp,totalRub:prepared.totalRub});}catch(error){report.errors.push({id:row.id,error:String(error)});}if(report.matched%100===0)console.log(JSON.stringify({stage:'encar_official_progress',matched:report.matched,calculated:report.calculated}));}}
await Promise.all(Array.from({length:4},worker));
const dir=process.env.CATALOG_REBUILD_INPUT_DIR||'encar-official-input';await fs.mkdir(dir,{recursive:true});
report.completedAt=new Date().toISOString();
await fs.writeFile('encar-official-recovery-report.json',JSON.stringify(report,null,2));
await fs.writeFile(`${dir}/catalog-rebuild-korea-official.json`,JSON.stringify({market:'korea',offers,report:{confirmedWithdrawals:[],sources:[{sourceId:'encar_direct',mode:'live',pages:0,freshSaved:offers.length,stopReason:'existing_inventory_official_specifications_only'}]}}));
console.log(JSON.stringify(report));
if(report.errors.length||!offers.length)process.exitCode=1;
