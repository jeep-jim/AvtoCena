import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {readCurrentCatalogProjectionSnapshot,publicOffer} from '../../apps/web/lib/catalog/storage.ts';
import {applyEncyclopediaCalculation,hasEncyclopediaCalculationEvidence,readCalculationIndex,factFields} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {applyUaeManualSpecifications} from '../../apps/web/lib/catalog/uae-manual-specifications.ts';
import {specificationEvidenceComplete} from '../../apps/web/lib/catalog/modification-matching.ts';
import {classifySpecificationEvidence,SPECIFICATION_AUDIT_FIELDS} from '../../apps/web/lib/catalog/specification-evidence-audit.ts';
import {applyActiveBusinessPriceBatch} from '../../apps/web/lib/catalog/live-business-pricing.ts';
const storage=getJsonStorage(),index=readCalculationIndex();
if(!index)throw Error('encyclopedia_index_required');
const snapshot=await readCurrentCatalogProjectionSnapshot(),report={version:1,indexDigest:index.digest,generationId:snapshot.generationId,checkedAt:new Date().toISOString(),markets:{},samples:[],publicPriceParity:0};
if(!snapshot.items?.length)throw Error('catalog_snapshot_empty');
const candidates=[];
for(const raw of snapshot.items){
 const market=report.markets[raw.market]||={rows:0,pending:0,exactMatches:0,filledRecords:0,filledFields:0,completeSpecifications:0,calculated:0,calculationMissing:{},missing:{}};market.rows++;
 if(Number(raw.totalRub)>0&&raw.catalogPricingMode!=='seller')continue;
 market.pending++;
 const source=applyUaeManualSpecifications(raw),enriched=applyEncyclopediaCalculation(source,index);
 if(hasEncyclopediaCalculationEvidence(enriched)){
  market.exactMatches++;
  const filled=factFields.filter(f=>!source[f]&&enriched[f]);
  market.filledFields+=filled.length;market.filledRecords+=Number(filled.length>0);
  if(specificationEvidenceComplete(enriched)){market.completeSpecifications++;candidates.push(raw);}
 }
 for(const field of SPECIFICATION_AUDIT_FIELDS){const result=classifySpecificationEvidence(enriched,field);if(!['exact','not_applicable'].includes(result.state))market.missing[result.reason]=(market.missing[result.reason]||0)+1;}
}
for(let start=0;start<candidates.length;start+=4){
 const originals=candidates.slice(start,start+4),priced=await applyActiveBusinessPriceBatch(originals,{readOnly:true});
 for(let i=0;i<priced.length;i++){
  const row=priced[i];
  if(!['uae','korea'].includes(row.market)||!(Number(row.totalRub)>0)||row.catalogPricingMode==='seller')continue;
  const enriched=applyEncyclopediaCalculation(applyUaeManualSpecifications(originals[i]),index);
  const publicRow=publicOffer({...enriched,images:enriched.images||[]});
  const [replayed]=await applyActiveBusinessPriceBatch([publicRow],{readOnly:true});
  if(replayed.totalRub!==row.totalRub||replayed.catalogPricingMode==='seller')throw Error('encyclopedia_public_price_parity_failed:'+row.id);
  report.publicPriceParity++;
 }
 for(let i=0;i<priced.length;i++){const row=priced[i],market=report.markets[row.market],delivered=Number(row.totalRub)>0&&row.catalogPricingMode!=='seller';market.calculated+=Number(delivered);for(const reason of row.operational?.encyclopediaCalculationBlocked?.missing||[])market.calculationMissing[reason]=(market.calculationMissing[reason]||0)+1;if(report.samples.filter(s=>s.market===row.market).length<12)report.samples.push({id:row.id,market:row.market,make:row.make,model:row.model,year:row.year,engineCc:row.engineCc,powerHp:row.powerHp,totalRub:row.totalRub||null,status:row.calculationStatus,delivered:Number(row.totalRub)>0&&row.catalogPricingMode!=='seller',missing:row.calculationSnapshot?.missing||[]});}
}
const current=await storage.readJson('catalog/manifest.json',null);if(current?.generationId!==snapshot.generationId)throw Error('catalog_changed_during_encyclopedia_audit');
const key=`knowledge/encyclopedia/calculation-audits/${index.digest}/${Date.now()}.json`;
await storage.writeJson(key,report,{ifNoneMatch:'*'});const saved=await storage.readJson(key,null);
if(saved?.indexDigest!==report.indexDigest||JSON.stringify(saved.markets)!==JSON.stringify(report.markets))throw Error('audit_readback_failed');
console.log(JSON.stringify({stage:'encyclopedia_calculation_audit',...report,readback:true}));
if(!report.samples.some(x=>x.delivered))throw Error('encyclopedia_no_verified_calculation_gain');
