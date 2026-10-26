import {managementDraft} from './management-knowledge';
import {modelKey,readCalculationIndex,type CalculationIndex} from '../encyclopedia/calculation-index';
import {astraPower30FactsForKey} from '../encyclopedia/astra-power30';
import {precedentIdentityKey,precedentModelKeys,selectWithReportedPrecedents} from '../../../../scripts/encyclopedia/power30-precedents.mjs';
import reports from '../../../../data/catalog/power-reference/reported-power30-precedents.json';
import {offerParameterDraft} from './offer-parameter-draft';
import {completePowerUnitDraft} from './power-parameter-draft';
import type {VehicleOffer} from './types';

export type Power30Precedent = {kw:number;method:string;certified:false;requiresConfirmation:true};
const candidates=new WeakMap<CalculationIndex,Map<string,any[]>>();
/** Re-match immutable model knowledge for every incoming identity; never write certified fields. */
export function power30Precedent(offer:Partial<VehicleOffer>,index=readCalculationIndex()):Power30Precedent|undefined {
 if(!['electric','hybrid'].includes(offer.fuel||'')||offer.market==='uae')return; // The owner's UAE manual-parameter policy remains in force.
 const family=precedentModelKeys(precedentIdentityKey(modelKey(offer.make,offer.model),offer.model),offer.fuel);
 let facts:any[]=[];
 if(index){
  let keys=candidates.get(index);if(!keys){keys=new Map();candidates.set(index,keys);}
  const key=family.keys.join('|');facts=keys.get(key)||[];
  if(!keys.has(key)){facts=family.keys.flatMap(k=>[...(index.models[k]||[]),...astraPower30FactsForKey(index.models,k)]);keys.set(key,facts);}
 }
 const result=selectWithReportedPrecedents(offer,facts,reports.filter(f=>family.keys.includes(f.modelKey)));
 if(result.status!=='estimated')return; // A range is not a single calculation parameter.
 return {kw:result.estimatedPower30MinKw,method:result.method,certified:false,requiresConfirmation:true};
}
export function offerPrecedentParameterDraft(offer:VehicleOffer,raw:VehicleOffer=offer):Record<string,string>{
 const draft=managementDraft(offer,offerParameterDraft(offer,raw));
 if(draft.power30MinKw)return draft;
 const estimate=power30Precedent(offer);
 return estimate?completePowerUnitDraft({...draft,power30MinKw:String(estimate.kw),_power30EstimateKw:String(estimate.kw)}):draft;
}
export function usedPower30Precedent(offer:Partial<VehicleOffer>,parameters:Partial<VehicleOffer>){
 const estimate=power30Precedent(offer);
 return estimate&&Math.abs(Number(parameters.power30MinKw)-estimate.kw)<1e-8?estimate:undefined;
}
