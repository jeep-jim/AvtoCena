// Read-only complete UAE projection audit; bounded exact details, no repricing or supplier crawl.
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {getOfferFromCurrentShard} from '../apps/web/lib/catalog/storage.ts';
import {restoreDubicarsDisplacement} from '../apps/web/lib/catalog/dubicars-displacement.ts';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit.ts';
const storage=getJsonStorage();
const manifest=await storage.readJson('catalog/manifest.json',null);
const projection=await storage.readJson('catalog/public/projection/uae.json',null);
if(!manifest?.generationId||projection?.generationId!==manifest.generationId||!Array.isArray(projection.items))throw Error('projection_generation_mismatch');
const groups={};
for(const row of projection.items){
 const source=row.sourceId||row.sourceGroup||'unknown';
 const g=groups[source]??={total:0,withEngineCc:0,withoutEngineCc:0,calculated:0,seller:0,withEngineNoTotal:0,withoutEngineNoTotal:0,electric:0,withPowerHp:0};
 g.total++;if(Number(row.engineCc)>0)g.withEngineCc++;else g.withoutEngineCc++;
 if(Number(row.totalRub)>0&&row.catalogPricingMode!=='seller')g.calculated++;else if(Number(row.engineCc)>0)g.withEngineNoTotal++;else g.withoutEngineNoTotal++;
 if(row.catalogPricingMode==='seller')g.seller++;
 if(row.fuel==='electric'||row.powertrainKind==='electric')g.electric++;
 if(Number(row.powerHp)>0)g.withPowerHp++;
}
console.log('UAE_VOLUME_COVERAGE',JSON.stringify({at:new Date().toISOString(),generationId:manifest.generationId,groups}));
const missing=projection.items.filter(x=>!(Number(x.engineCc)>0)&&x.fuel!=='electric').slice(0,8);
const pending=projection.items.filter(x=>Number(x.engineCc)>0&&!(Number(x.totalRub)>0)).slice(0,6);
const ids=[...new Set(['cb659e39eaf16e5dae6a8c36','ab48d48542ae0cdc8df6a6c5',...missing.map(x=>x.id),...pending.map(x=>x.id)])];
for(const id of ids){
 const offer=await getOfferFromCurrentShard(id);if(!offer){console.log('UAE_VOLUME_DETAIL_MISSING',id);continue;}
 const restored=restoreDubicarsDisplacement(offer),preview=projection.items.find(x=>x.id===id);
 const evidence=Object.fromEntries(['year','engineCc','powerHp','fuelPowertrain','certifiedPower'].map(k=>{const v=classifySpecificationEvidence(restored,k);return [k,v];}));
 console.log('UAE_VOLUME_PAIR',JSON.stringify({id,source:offer.sourceId,make:offer.make,model:offer.model,rawDisplacement:offer.operational?.sourceDisplacementLabel??null,storedEngineCc:offer.engineCc??null,restoredEngineCc:restored.engineCc??null,previewEngineCc:preview?.engineCc??null,detailTotal:offer.totalRub??null,previewTotal:preview?.totalRub??null,mode:preview?.catalogPricingMode??null,evidence}));
}
const after=await storage.readJson('catalog/manifest.json',null);if(after?.generationId!==manifest.generationId)throw Error('generation_changed_during_audit');
