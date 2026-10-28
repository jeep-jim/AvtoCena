import {applyUaeManualSpecifications} from './uae-manual-specifications';
import {createHash} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
import {modelKey as baseModelKey} from '../encyclopedia/calculation-index';
const modelKey=(make:any,model:any)=>baseModelKey(make,model)+(/\+\s*$/.test(String(model))?'plus':'');
import {DetailReadCache} from './detail-read-cache';
import {validateCustomerParameters} from './customer-parameters';
import type {VehicleOffer} from './types';

export const MANAGEMENT_KNOWLEDGE_PATH='knowledge/management-vehicle-parameters/v1/current.json';
export type ManagementFact={offerId:string;version:string;savedAt:string;savedBy:string;key:string;year:number;calculationFieldsVersion?:2;values:Record<string,any>};
export type ManagementKnowledge={encyclopediaRevisions?:Record<string,string>;version:1;revision:string;models:Record<string,Record<string,ManagementFact>>};
const empty=():ManagementKnowledge=>({version:1,revision:'empty',models:{}});
const cache=new DetailReadCache<ManagementKnowledge>({maxEntries:1,maxBytes:16*1024*1024,ttlMs:5000,concurrency:1});
export const readManagementKnowledge=()=>cache.get('current',()=>readDataJson(MANAGEMENT_KNOWLEDGE_PATH,empty()));
const fields=['vehicleCategory','grossVehicleWeightKg','n1IceFuel','fuel','engineCc','powerHp','powertrainKind','icePowerKw','power30MinKw','drive','transmission','bodyType','engineCode','chassisCode','generation','batteryKwh','motorPeakKw'] as const;
const known=(v:any)=>v!==null&&v!==undefined&&v!==''&&v!==0&&v!=='unknown';
const token=(v:any)=>String(v).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function same(k:string,a:any,b:any){return ['powerHp','icePowerKw','power30MinKw','batteryKwh','motorPeakKw'].includes(k)?Math.abs(Number(a)-Number(b))<(k==='powerHp'?1.01:0.1):k==='engineCc'?Math.abs(Number(a)-Number(b))<=10:token(a)===token(b);}
export function managementParameters(input:any,index:ManagementKnowledge):Record<string,any>{
 const offer=applyUaeManualSpecifications(input);
 const rows=Object.values(index.models[modelKey(offer.make,offer.model)]||{});
 const matches=rows.filter(row=>{
  if(row.offerId===offer.id||row.year!==Number(offer.year))return false;
  if(known(offer.powerKw)&&known(row.values.powerHp)&&Math.abs(Number(offer.powerKw)-Number(row.values.powerHp)*0.73549875)>1)return false;
  let anchors=0;
  for(const field of fields){
   if(['grossVehicleWeightKg','n1IceFuel'].includes(field)&&offer.vehicleCategory!=='N1'&&row.values.vehicleCategory!=='N1')continue;
   const a=offer[field],b=row.values[field];
   if(known(a)&&known(b)){
    if(!same(field,a,b))return false;
    // Power units and propulsion subtype are not independent anchors.
    if(!['vehicleCategory','grossVehicleWeightKg','n1IceFuel','powertrainKind','icePowerKw','power30MinKw','motorPeakKw'].includes(field))anchors++;
   }
  }
  return anchors>=2;
 });
 const parameters:Record<string,any>={};
 for(const field of fields){
  if(known(offer[field])||field==='power30MinKw'&&offer.power30MinKwByMotor?.some((v:any)=>Number(v)>0))continue;
  const available=matches.filter(r=>known(r.values[field])&&(!['grossVehicleWeightKg','n1IceFuel'].includes(field)||r.values.vehicleCategory==='N1'));
  // Explicit encyclopedia edits are the canonical default for a compatible
  // model. Older card contributions must not veto its corrected missing facts.
  // Filled recipient/manual values and conflicting mechanical identities above
  // remain protected; contradictory encyclopedia variants remain unresolved.
  const canonical=available.filter(r=>r.offerId.startsWith('encyclopedia:'));
  const values=(canonical.length?canonical:available).map(r=>r.values[field]);
  if(values.length&&values.every(v=>same(field,v,values[0])))parameters[field]=values[0];
 }
 if(parameters.powerHp&&!known(offer.powerKw))parameters.powerKw=parameters.powerHp*0.73549875;
 return parameters;
}
/** Explicitly confirmed staff inputs, separate from source/certification evidence. */
export async function rememberManagementCalculation(offer:VehicleOffer,record:{version:string;savedAt:string;savedBy:string;draft:Record<string,string>}){
 const p=validateCustomerParameters(record.draft);
 const values=Object.fromEntries(fields.filter(f=>known((p as any)[f])||known((offer as any)[f])).map(f=>[f,known((p as any)[f])?(p as any)[f]:(offer as any)[f]]));
 const fact:ManagementFact={calculationFieldsVersion:2,offerId:offer.id,version:record.version,savedAt:record.savedAt,savedBy:record.savedBy,key:modelKey(offer.make,offer.model),year:Number(p.year),values};
 return persistManagementFact(fact);
}
export async function rememberManagementEditorial(offer:VehicleOffer,entry:{version:string;updatedAt:string;updatedBy:string;specifications?:Record<string,string>}){
 if(!entry.specifications||!Object.keys(entry.specifications).some(k=>fields.includes(k as any)))return;
 const current=await readManagementKnowledge();
 const previous=current.models[modelKey(offer.make,offer.model)]?.[offer.id];
 offer=applyUaeManualSpecifications(offer);
 const values={...Object.fromEntries(fields.filter(f=>known((offer as any)[f])).map(f=>[f,(offer as any)[f]])),...previous?.values,...entry.specifications};
 await persistManagementFact({offerId:offer.id,key:modelKey(offer.make,offer.model),year:offer.year,version:entry.version,savedAt:entry.updatedAt,savedBy:entry.updatedBy,values});
}
async function persistManagementFact(fact:ManagementFact){
 const archive='knowledge/management-vehicle-parameters/v1/history/'+createHash('sha256').update(fact.version).digest('hex')+'.json';
 await mutateDataJson<ManagementFact|null>(archive,null,previous=>previous||fact);
 await mutateDataJson<ManagementKnowledge>(MANAGEMENT_KNOWLEDGE_PATH,empty(),current=>{
  const previous=Object.values(current.models).map(rows=>rows[fact.offerId]).filter(Boolean).sort((a,b)=>b.savedAt.localeCompare(a.savedAt))[0];
  if(previous&&previous.savedAt>fact.savedAt)return current;
  // A correction to this offer retires its former model/year relationship.
  const models={...current.models};
  for(const [key,rows] of Object.entries(models))if(rows[fact.offerId]){models[key]={...rows};delete models[key][fact.offerId];}
  models[fact.key]={...models[fact.key],[fact.offerId]:fact};
  return {...current,version:1,revision:fact.version,models};
 });
 cache.clear();
}
// Older memory entries omitted N1 mass/fuel even though the immutable saved
// scenario retained them. Recover only relevant model-years, never scan inventory
// or query a supplier. Read failures must not produce partial donor consensus.
const legacyCommercial=new DetailReadCache<Record<string,any>>({maxEntries:128,maxBytes:512*1024,ttlMs:300_000,concurrency:4,maxQueued:32});
async function restoreLegacyCommercialFacts(offers:Partial<VehicleOffer>[],index:ManagementKnowledge):Promise<ManagementKnowledge>{
 const wanted=new Set(offers.map(o=>modelKey(o.make,o.model)+':'+o.year));
 const keys=new Set(offers.map(o=>modelKey(o.make,o.model)));
 const candidates=[...keys].flatMap(key=>Object.values(index.models[key]||{})).filter(f=>
  wanted.has(f.key+':'+f.year)&&f.values.vehicleCategory==='N1'&&!f.calculationFieldsVersion&&!f.offerId.startsWith('encyclopedia:')
  &&(!known(f.values.grossVehicleWeightKg)||f.values.fuel==='hybrid'&&!known(f.values.n1IceFuel)));
 if(!candidates.length)return index;
 // Bound work for a displayed batch. Keep unresolved groups unresolved.
 if(candidates.length>32)return index;
 try{
  const recovered=await Promise.all(candidates.map(async fact=>{
   const values=await legacyCommercial.get(fact.offerId+':'+fact.version,async()=>{
    const {readSavedScenarioDraft}=await import('./saved-calculation-input');
    const draft=await readSavedScenarioDraft(fact.offerId,fact.version);
    if(!draft)return {};
    const p=validateCustomerParameters(draft);
    if(p.year!==fact.year||p.vehicleCategory!=='N1')return {};
    // A scenario is evidence only for the active fact's exact confirmed inputs.
    for(const field of fields)if(known(fact.values[field])&&known((p as any)[field])&&!same(field,fact.values[field],(p as any)[field]))return {};
    return Object.fromEntries(['grossVehicleWeightKg','n1IceFuel'].filter(k=>!known(fact.values[k])&&known((p as any)[k])).map(k=>[k,(p as any)[k]]));
   });
   return {...fact,values:{...fact.values,...values}};
  }));
  const models={...index.models};
  for(const fact of recovered)models[fact.key]={...models[fact.key],[fact.offerId]:fact};
  return {...index,models};
 }catch{return index;}
}
export async function attachManagementKnowledge<T extends Partial<VehicleOffer>>(offers:T[]):Promise<T[]>{
 if(!offers.length)return offers;
 const index=await restoreLegacyCommercialFacts(offers,await readManagementKnowledge().catch(()=>empty()));
 return offers.map(original=>{
  const offer={...original,operational:{...original.operational,managementKnowledge:undefined}};
  const parameters=managementParameters(offer,index);
  return Object.keys(parameters).length?{...offer,operational:{...offer.operational,managementKnowledge:{revision:index.revision,parameters}}}:offer;
 });
}
/** Applied to calculation inputs only; stored feed facts are never rewritten. */
export function managementDraft(offer:any,draft:Record<string,string>){
 const parameters=offer.operational?.managementKnowledge?.parameters||{};
 const result={...draft};
 for(const [field,value] of Object.entries(parameters)){
  const key=field==='powertrainKind'?'hybridKind':field;
  // This is the initial draft, before the visitor edits it. A supplied
  // alternative/estimate must not mask an empty actual vehicle field.
  if(!known(offer[field])||!result[key]||result[key]==='unknown')result[key]=String(value);
 }
 return result;
}

/** Confirmed encyclopedia edits use the same missing-only compatibility rules as cards.
 * Replace this model's contributions atomically, so clearing/renaming retires old facts.
 * This is staff knowledge, not a claim of manufacturer certification. */
export async function rememberEncyclopediaModel(record:import('../encyclopedia/schema').ModelRecord){
 const prefix=`encyclopedia:${record.id}:`,key=modelKey(record.make,record.model);
 const facts=record.variants.filter(v=>v.manualEditedAt&&v.year).map(v=>({
  offerId:prefix+v.id,key,year:v.year!,version:record.revision,savedAt:record.updatedAt,savedBy:record.editedBy||'',
  values:Object.fromEntries(fields.filter(f=>known((v as any)[f])).map(f=>[f,(v as any)[f]])),
 }));
 await mutateDataJson<ManagementKnowledge>(MANAGEMENT_KNOWLEDGE_PATH,empty(),current=>{
  if((current.encyclopediaRevisions?.[record.id]||'')>record.updatedAt)return current;
  const previous=Object.values(current.models).flatMap(Object.values).filter(f=>f.offerId.startsWith(prefix));
  if(previous.some(f=>f.savedAt>record.updatedAt))return current;
  const models=Object.fromEntries(Object.entries(current.models).map(([k,rows])=>[k,Object.fromEntries(Object.entries(rows).filter(([id])=>!id.startsWith(prefix)))]));
  for(const fact of facts)models[key]={...models[key],[fact.offerId]:fact};
  return {...current,version:1,revision:record.revision,models,encyclopediaRevisions:{...current.encyclopediaRevisions,[record.id]:record.updatedAt}};
 });
 cache.clear();
}

export function encyclopediaWithManagement(record:import('../encyclopedia/schema').ModelRecord,index:ManagementKnowledge){
 const variants=record.variants.map(v=>({...v,...managementParameters({...v,id:`encyclopedia:${record.id}:${v.id}`,make:record.make,model:record.model},index)}));
 const contributions=Object.values(index.models[modelKey(record.make,record.model)]||{}).filter(f=>!f.offerId.startsWith('encyclopedia:'));
 for(const fact of contributions){
  if(variants.some(v=>v.year===fact.year&&Object.entries(fact.values).every(([k,value])=>!known(value)||known((v as any)[k])&&same(k,(v as any)[k],value))))continue;
  variants.push({...fact.values,id:`staff:${createHash('sha256').update(fact.offerId).digest('hex').slice(0,24)}`,year:fact.year,markets:[],status:'review',observedCount:0,manualEditedAt:fact.savedAt});
 }
 return {...record,variants};
}
