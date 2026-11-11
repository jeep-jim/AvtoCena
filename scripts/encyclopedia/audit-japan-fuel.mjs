import fs from 'node:fs/promises';
import {applyJapanFactoryFuel} from '../../apps/web/lib/encyclopedia/japan-fuel-reference.ts';
import {ajesOffer} from '../../apps/web/lib/catalog/ajes-offer.ts';
import {japanPreviewParameters} from '../../apps/web/lib/catalog/japan-preview-parameters.ts';
import {calculateOfferWithCustomerParametersDetailed} from '../../apps/web/lib/catalog/customs-pricing.ts';
import {convertToRub} from '../../apps/web/lib/catalog/rates.ts';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
const store=getJsonStorage();if(store.driver!=='object')throw Error('object_required');store.writeJson=async()=>{throw Error('read_only');};
const lots=new Map();for(let start=0;start<128;start+=8){for(const slot of await Promise.all(Array.from({length:8},(_,i)=>store.readJson(`catalog/partner-cache/ajes/queries/${start+i}.json`,null))))for(const lot of slot?.value?.items||[])if(lot.table==='stats')lots.set(lot.id,{lot,evidence:slot.value.sourceEvidenceById?.[lot.id]||slot.value.sourceEvidence});}
const fuels={},powerForms={},samples=[];for(const {lot,evidence} of lots.values()){const fuel=JSON.stringify([lot.sourceFuel,lot.sourceFuelField,evidence?.values?.TIME,evidence?.values?.FUEL]);fuels[fuel]=(fuels[fuel]||0)+1;const power=/^\d+(?:\.\d+)?$/.test(lot.sourcePower)?'single':lot.sourcePower?'alternatives_or_other':'empty';powerForms[power]=(powerForms[power]||0)+1;if(samples.length<25&&/TWINGO|MEGANE|CLIPPER|N BOX|ROOX/i.test(lot.model))samples.push({id:lot.id,make:lot.make,model:lot.model,year:lot.year,chassis:lot.chassisCode,power:lot.sourcePower,fuel:lot.sourceFuel,evidence:evidence?.values});}
console.log('JAPAN_FUEL_AUDIT',JSON.stringify({checkedAt:new Date().toISOString(),rows:lots.size,fuels,powerForms,samples}));

const attemptedModels=new Map();
const acceptance={rows:0,fuelFilled:0,readyInputs:0,calculationAttempts:0,calculated:0,failures:[],examples:[]};
for(const {lot} of lots.values()){
 const rate=await convertToRub(lot.finalPriceJpy,'JPY');if(!rate)continue;
 const original=ajesOffer(lot,rate,new Date().toISOString()),offer=applyJapanFactoryFuel(original);acceptance.rows++;
 if(!original.fuel&&offer.fuel)acceptance.fuelFilled++;
 let parameters;try{parameters=japanPreviewParameters(offer);acceptance.readyInputs++;}catch{continue;}
 if(acceptance.calculationAttempts>=20||(attemptedModels.get(offer.model)||0)>=4)continue;acceptance.calculationAttempts++;attemptedModels.set(offer.model,(attemptedModels.get(offer.model)||0)+1);
 try{const result=await calculateOfferWithCustomerParametersDetailed(offer,parameters);if(result.ok&&Number(result.calculation.totalRub)>0){acceptance.calculated++;acceptance.examples.push({id:offer.id,model:offer.model,year:offer.year,fuel:offer.fuel,powerHp:parameters.powerHp,totalRub:result.calculation.totalRub,estimated:true});}else acceptance.failures.push({id:offer.id,result});}catch(e){acceptance.failures.push({id:offer.id,error:e.message});}
}
console.log('JAPAN_FUEL_ACCEPTANCE',JSON.stringify(acceptance));

await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/japan-fuel-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),acceptance},null,2));
