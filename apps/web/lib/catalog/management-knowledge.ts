import {applyUaeManualSpecifications} from './uae-manual-specifications';
import {createHash} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
import {modelKey as baseModelKey,normalizeCalculationFactValue as normalizeCalculationFact} from '../encyclopedia/calculation-index';
export const managementModelKey=(make:any,model:any)=>baseModelKey(make,model)+(/\+\s*$/.test(String(model))?'plus':'');
const modelKey=managementModelKey;
import {DetailReadCache} from './detail-read-cache';
import {powerUnitPatch} from './power-parameter-draft';
import {validateCustomerParameters} from './customer-parameters';
import type {VehicleOffer} from './types';

export const MANAGEMENT_KNOWLEDGE_PATH='knowledge/management-vehicle-parameters/v1/current.json';
export type ManagementFact={offerId:string;version:string;savedAt:string;savedBy:string;key:string;year:number;calculationFieldsVersion?:2;values:Record<string,any>;previousValues?:Record<string,any>[];targetOfferId?:string;supersedes?:Record<string,string>};
export type ManagementKnowledge={encyclopediaRevisions?:Record<string,string>;version:1;revision:string;models:Record<string,Record<string,ManagementFact>>};
const empty=():ManagementKnowledge=>({version:1,revision:'empty',models:{}});
const cache=new DetailReadCache<ManagementKnowledge>({maxEntries:1,maxBytes:16*1024*1024,ttlMs:5000,concurrency:1});
export const readManagementKnowledge=(fresh=false)=>fresh?readDataJson(MANAGEMENT_KNOWLEDGE_PATH,empty()):cache.get('current',()=>readDataJson(MANAGEMENT_KNOWLEDGE_PATH,empty()));
const fields=['vehicleCategory','grossVehicleWeightKg','n1IceFuel','fuel','engineCc','powerHp','powerKw','powertrainKind','icePowerKw','power30MinKw','drive','transmission','bodyType','engineCode','chassisCode','generation','batteryKwh','motorPeakKw'] as const;
const known=(v:any)=>v!==null&&v!==undefined&&v!==''&&v!==0&&v!=='unknown';
const token=(v:any)=>String(v).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
// Use the existing calculation vocabulary for propulsion aliases. In particular,
// HEV and other_hybrid must not block each other's missing facts; series remains distinct.
const managementValue=(k:string,v:any)=>{
 if(k==='fuel'&&['hev','phev','mhev'].includes(token(v)))return 'hybrid';
 if(k==='powertrainKind'&&['parallelhybrid','mhev'].includes(token(v)))return 'other_hybrid';
 return ['fuel','powertrainKind'].includes(k)?normalizeCalculationFact(k,v):v;
};
function same(k:string,a:any,b:any){a=managementValue(k,a);b=managementValue(k,b);return ['powerHp','powerKw','icePowerKw','power30MinKw','batteryKwh','motorPeakKw'].includes(k)?Math.abs(Number(a)-Number(b))<(k==='powerHp'?1.01:k==='powerKw'?0.75:0.1):k==='engineCc'?Math.abs(Number(a)-Number(b))<=10:token(a)===token(b);}
function compatibleManagementValues(offer:any,values:Record<string,any>){
 if(known(offer.powerKw)&&known(values.powerHp)&&Math.abs(Number(offer.powerKw)-Number(values.powerHp)*0.73549875)>1)return false;
 let anchors=0;
 for(const field of fields){
  if(['grossVehicleWeightKg','n1IceFuel'].includes(field)&&offer.vehicleCategory!=='N1'&&values.vehicleCategory!=='N1')continue;
  const a=offer[field],b=values[field];
  if(known(a)&&known(b)){
   if(!same(field,a,b))return false;
   if(!['vehicleCategory','grossVehicleWeightKg','n1IceFuel','powerKw','powertrainKind','icePowerKw','power30MinKw','motorPeakKw'].includes(field))anchors++;
  }
 }
 return anchors>=2;
}
function compatibleRevisionValues(offer:any,before:Record<string,any>,after:Record<string,any>){
 if(!compatibleManagementValues(offer,before))return false;
 // A newly discovered conflicting field is not evidence that this is the same
 // modification. Every changed known value must have its own prior value.
 return fields.every(field=>{
  if(['grossVehicleWeightKg','n1IceFuel'].includes(field)&&offer.vehicleCategory!=='N1'&&after.vehicleCategory!=='N1')return true;
  if(!known(offer[field])||!known(after[field])||same(field,offer[field],after[field]))return true;
  const old=before[field]??(field==='powerKw'&&known(before.powerHp)?Number(before.powerHp)*0.73549875:undefined);
  return known(old)&&same(field,offer[field],old);
 });
}
export const managementFactValues=(value:any)=>Object.fromEntries(fields.filter(f=>known(value?.[f])).map(f=>[f,value[f]]));
const factsOf=managementFactValues;
function priorValues(...groups:(Record<string,any>[]|undefined)[]){
 const unique=new Map<string,Record<string,any>>();
 for(const value of groups.flatMap(g=>g||[])){const clean=factsOf(value);if(Object.keys(clean).length)unique.set(JSON.stringify(clean),clean);}
 const values=[...unique.values()];
 // Keep the initial source identity and seven recent revisions. Older ambiguous
 // recipients remain untouched; history archives retain every actual save.
 return values.length<=8?values:[values[0],...values.slice(-7)];
}
function activeFacts(index:ManagementKnowledge,key:string){
 const rows=Object.values(index.models[key]||{});
 const superseded=new Map<string,string>();
 for(const newer of rows)for(const [id,version] of Object.entries(newer.supersedes||{})){const key=id+':'+version;if((superseded.get(key)||'')<newer.savedAt)superseded.set(key,newer.savedAt);}
 return rows.filter(row=>(superseded.get(row.offerId+':'+row.version)||'')<=row.savedAt);
}
/** A correction can replace only values still matching a recorded prior identity.
 * An unrelated conflicting variant or a later explicit card edit is never a target. */
export function managementCorrections(offer:any,index:ManagementKnowledge,after='',canonicalOnly=false){
 const rows=activeFacts(index,modelKey(offer.make,offer.model)).filter(row=>
  (!canonicalOnly||row.offerId.startsWith('encyclopedia:'))&&row.offerId!==offer.id&&row.year===Number(offer.year)&&row.savedAt>(after||offer.manualEditedAt||'')
  &&(!row.targetOfferId||row.targetOfferId===offer.id||String(offer.id).startsWith('encyclopedia:')));
 const candidates=rows.flatMap(row=>(row.previousValues||[]).filter(before=>compatibleRevisionValues(offer,before,row.values)).map(before=>({row,before})));
 const result:Record<string,any>={};
 for(const field of fields){
  if(known(offer.editorialSpecifications?.[field]))continue;
  if(field==='power30MinKw'&&offer.power30MinKwByMotor?.some((v:any)=>Number(v)>0))continue;
  const changed=candidates.filter(({row,before})=>(known(before[field])?(!known(row.values[field])||!same(field,before[field],row.values[field])):!known(offer[field])&&known(row.values[field]))
   &&(!known(offer[field])||same(field,offer[field],before[field])));
  // Encyclopedia changes are canonical for cards. In an encyclopedia view its
  // own contribution is already excluded, and newer card edits can return.
  const canonical=changed.filter(({row})=>row.offerId.startsWith('encyclopedia:'));
  const chosen=canonical.length?canonical:changed;
  const values=chosen.map(({row})=>known(row.values[field])?managementValue(field,row.values[field]):null);
  if(values.length&&values.every(v=>v===null?values[0]===null:values[0]!==null&&same(field,v,values[0])))result[field]=values[0];
 }
 return result;
}
export function managementModelRevision(make:any,model:any,index:ManagementKnowledge){
 return createHash('sha256').update(JSON.stringify(index.models[modelKey(make,model)]||{})).digest('hex');
}
export function managementParameters(input:any,index:ManagementKnowledge):Record<string,any>{
 const offer=applyUaeManualSpecifications(input);
 const rows=activeFacts(index,modelKey(offer.make,offer.model));
 const matches=rows.filter(row=>row.offerId!==offer.id&&row.year===Number(offer.year)&&(compatibleManagementValues(offer,row.values)||row.savedAt>(offer.manualEditedAt||'')&&(row.previousValues||[]).some(before=>compatibleRevisionValues(offer,before,row.values))));
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
  if(values.length&&values.every(v=>same(field,v,values[0])))parameters[field]=managementValue(field,values[0]);
 }
 const corrections=managementCorrections(offer,index);
 Object.assign(parameters,corrections);
 if(parameters.powerHp&&(!known(offer.powerKw)||Object.hasOwn(corrections,'powerHp'))&&!Object.hasOwn(parameters,'powerKw'))parameters.powerKw=parameters.powerHp*0.73549875;
 return parameters;
}
/** Explicitly confirmed staff inputs, separate from source/certification evidence. */
export async function rememberManagementCalculation(offer:VehicleOffer,record:{version:string;savedAt:string;savedBy:string;draft:Record<string,string>},previousDraft?:Record<string,string>){
 const p=validateCustomerParameters(record.draft);
 const values=Object.fromEntries(fields.filter(f=>known((p as any)[f])||known((offer as any)[f])).map(f=>[f,known((p as any)[f])?(p as any)[f]:(offer as any)[f]]));
 const fact:ManagementFact={calculationFieldsVersion:2,offerId:offer.id,version:record.version,savedAt:record.savedAt,savedBy:record.savedBy,key:modelKey(offer.make,offer.model),year:Number(p.year),values,previousValues:priorValues(Number(p.year)===offer.year?[factsOf(offer)]:[],previousDraft&&Number(previousDraft.year)===Number(p.year)?[{...factsOf(offer),...factsOf(validateCustomerParameters(previousDraft))}]:[])};
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
  const canonical=Object.values(current.models[fact.key]||{}).filter(row=>row.targetOfferId===fact.offerId&&row.year===fact.year&&row.savedAt<fact.savedAt);
  const previousValues=priorValues(previous?.key===fact.key&&previous.year===fact.year?previous.previousValues:[],fact.previousValues,
   previous?.key===fact.key&&previous.year===fact.year?[previous.values]:[],canonical.map(row=>row.values));
  const supersedes={...previous?.supersedes};
  for(const row of Object.values(current.models[fact.key]||{})){
   if(row.offerId.startsWith('encyclopedia:')&&row.year===fact.year&&row.savedAt<fact.savedAt&&(!row.targetOfferId||row.targetOfferId===fact.offerId)
    &&(fact.previousValues||[]).some(before=>compatibleManagementValues(before,row.values)))supersedes[row.offerId]=row.version;
  }
  models[fact.key]={...models[fact.key],[fact.offerId]:{...fact,previousValues,supersedes}};
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
export async function attachManagementKnowledge<T extends Partial<VehicleOffer>>(offers:T[],fresh=false):Promise<T[]>{
 if(!offers.length)return offers;
 const index=await restoreLegacyCommercialFacts(offers,await readManagementKnowledge(fresh).catch(()=>empty()));
 return offers.map(original=>{
  const offer={...original,operational:{...original.operational,managementKnowledge:undefined}};
  const parameters=managementParameters(offer,index);
  return Object.keys(parameters).length?{...offer,operational:{...offer.operational,managementKnowledge:{revision:managementModelRevision(offer.make,offer.model,index),parameters,correctedFields:Object.keys(parameters).filter(field=>known((offer as any)[field])&&(parameters[field]===null||!same(field,(offer as any)[field],parameters[field])))}}}:offer;
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
  if(!known(offer[field])||!result[key]||result[key]==='unknown'||offer.operational?.managementKnowledge?.correctedFields?.includes(field)&&same(field,result[key],offer[field]))Object.assign(result,powerUnitPatch(key,value===null?'':String(value),result));
 }
 return result;
}

/** Default card views follow newer canonical revisions; archived share scenarios
 * call neither this function nor the mutable knowledge reader. */
export function managementSavedDraft(offer:any,draft:Record<string,string>,savedAt:string,index:ManagementKnowledge){
 const input={...offer,...validateCustomerParameters(draft)};
 const corrections=managementCorrections(input,index,savedAt,true);
 const result={...draft};
 for(const [field,value] of Object.entries(corrections))Object.assign(result,powerUnitPatch(field==='powertrainKind'?'hybridKind':field,value===null?'':String(value),result));
 if(Object.hasOwn(corrections,'powerHp')&&!Object.hasOwn(corrections,'powerKw'))result.powerKw=corrections.powerHp===null?'':String(Number(corrections.powerHp)*0.73549875);
 return result;
}
export function invalidateManagementPrice<T extends Partial<VehicleOffer>>(offer:T):T{
 const learned=offer.operational?.managementKnowledge as any;
 if(!learned?.correctedFields?.length)return offer;
 return {...offer,totalRub:null,previousTotalRub:null,priceDeltaRub:null,publicVisibleRub:undefined,publicSpecificationVerified:false,
  calculationStatus:'needs_data',catalogPricingMode:'seller',calculationSnapshot:undefined,
  savedCalculationPreview:undefined,deliveredCalculationPreview:undefined,japanDeliveredPreview:undefined} as T;
}

/** Encyclopedia edits retain prior identities for revision-linked corrections.
 * Replace this model's contributions atomically, so clearing/renaming retires old facts.
 * This is staff knowledge, not a claim of manufacturer certification. */
export async function rememberEncyclopediaModel(record:import('../encyclopedia/schema').ModelRecord){
 const prefix=`encyclopedia:${record.id}:`,key=modelKey(record.make,record.model);
 const previousRecord=record.previousKey?await readDataJson<import('../encyclopedia/schema').ModelRecord|null>(record.previousKey,null):null;
 const facts=record.variants.filter(v=>v.manualEditedAt&&v.year).map(v=>({
  offerId:prefix+v.id,key,year:v.year!,version:record.revision,savedAt:Number.isFinite(Date.parse(v.manualEditedAt!))?v.manualEditedAt!:record.updatedAt,savedBy:record.editedBy||'',
  values:factsOf(v),targetOfferId:(v as any).managementOfferId,
  previousValues:priorValues((v as any).managementBaseline?[(v as any).managementBaseline]:[],previousRecord?.variants.filter(old=>old.id===v.id&&old.year===v.year).map(factsOf)),
 }));
 await mutateDataJson<ManagementKnowledge>(MANAGEMENT_KNOWLEDGE_PATH,empty(),current=>{
  if((current.encyclopediaRevisions?.[record.id]||'')>record.updatedAt)return current;
  const previous=Object.values(current.models).flatMap(Object.values).filter(f=>f.offerId.startsWith(prefix));
  if(previous.some(f=>f.savedAt>record.updatedAt))return current;
  const models=Object.fromEntries(Object.entries(current.models).map(([k,rows])=>[k,Object.fromEntries(Object.entries(rows).filter(([id])=>!id.startsWith(prefix)))]));
  for(const fact of facts){const old=previous.find(p=>p.offerId===fact.offerId&&p.year===fact.year);models[key]={...models[key],[fact.offerId]:{...fact,version:old?.savedAt===fact.savedAt?old.version:fact.version,previousValues:priorValues(old?.previousValues,old?[old.values]:[],fact.previousValues)}};}
  return {...current,version:1,revision:record.revision,models,encyclopediaRevisions:{...current.encyclopediaRevisions,[record.id]:record.updatedAt}};
 });
 cache.clear();
}

export function encyclopediaWithManagement(record:import('../encyclopedia/schema').ModelRecord,index:ManagementKnowledge,year?:number|null){
 const selected=(value:number|undefined)=>year===undefined||(year===null?!value:value===year);
 const variants=record.variants.filter(v=>selected(v.year)).map(v=>({...v,...managementParameters({...v,id:`encyclopedia:${record.id}:${v.id}`,make:record.make,model:record.model},index)}));
 const contributions=Object.values(index.models[modelKey(record.make,record.model)]||{}).filter(f=>selected(f.year)&&!f.offerId.startsWith('encyclopedia:'));
 for(const fact of contributions){
  if(record.variants.some(v=>(v as any).managementOfferId===fact.offerId&&(v.manualEditedAt||'')>=fact.savedAt))continue;
  if(variants.some(v=>v.year===fact.year&&Object.entries(fact.values).every(([k,value])=>!known(value)||known((v as any)[k])&&same(k,(v as any)[k],value))))continue;
  variants.push({...fact.values,id:`staff:${createHash('sha256').update(fact.offerId).digest('hex').slice(0,24)}`,year:fact.year,markets:[],status:'review',observedCount:0,manualEditedAt:fact.savedAt});
 }
 return {...record,variants};
}
