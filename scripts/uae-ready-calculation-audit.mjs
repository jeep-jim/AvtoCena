// Owner-requested check of every published UAE pending row that already has volume and power.
// No catalog publication, source requests or cursor writes.
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {getOfferFromCurrentShard} from '../apps/web/lib/catalog/storage.ts';
import {prepareSellerInventory,inventorySourceEvidence} from '../apps/web/lib/catalog/prepare-seller-inventory.ts';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit.ts';
const storage=getJsonStorage(),before=await storage.readJson('catalog/manifest.json',null);
const projection=await storage.readJson('catalog/public/projection/uae.json',null);
if(!before?.generationId||projection?.generationId!==before.generationId)throw Error('generation_mismatch');
const pending=projection.items.filter(x=>!(Number(x.totalRub)>0&&x.catalogPricingMode!=='seller')&&Number(x.engineCc)>0&&Number(x.powerHp)>0);
if(pending.length>200)throw Error('audit_bounded_batch_required');
const counts={candidates:pending.length,checked:0,newlyCalculable:0,missingDetails:0,failed:0},reasons={};
for(const row of pending){
 const offer=await getOfferFromCurrentShard(row.id);if(!offer){counts.missingDetails++;continue;}
 try{
  const prepared=await prepareSellerInventory(offer);
  counts.checked++;
  if(Number(prepared?.totalRub)>0&&prepared?.catalogPricingMode!=='seller'){
   counts.newlyCalculable++;console.log('UAE_NEWLY_CALCULABLE',JSON.stringify({id:offer.id,engineCc:prepared.engineCc,powerHp:prepared.powerHp,totalRub:prepared.totalRub}));
  }else{
   const evidence=inventorySourceEvidence(offer);
   const missing=['year','engineCc','powerHp','fuelPowertrain','certifiedPower'].map(k=>({field:k,...classifySpecificationEvidence(evidence,k)})).filter(x=>!['exact','not_applicable'].includes(x.state));
   const reason=missing.length?missing.map(x=>x.field+':'+x.reason).sort().join('|'):!(Number(offer.sourcePrice)>0)?'source_price_missing':'calculation_not_ready';
   reasons[reason]=(reasons[reason]||0)+1;
   console.log('UAE_PENDING_KNOWN_SPECS',JSON.stringify({id:offer.id,reason}));
  }
 }catch{counts.failed++;console.log('UAE_CANDIDATE_CHECK_FAILED',row.id);}
}
const after=await storage.readJson('catalog/manifest.json',null);if(after?.generationId!==before.generationId)throw Error('generation_changed');
console.log('UAE_READY_CALCULATION_AUDIT',JSON.stringify({at:new Date().toISOString(),generationId:before.generationId,counts,reasons}));
if(counts.failed||counts.missingDetails)throw Error('candidate_audit_incomplete');
