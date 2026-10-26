import {applyUaeManualSpecifications} from './uae-manual-specifications';
import {createHash} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
import {modelKey as baseModelKey} from '../encyclopedia/calculation-index';
const modelKey=(make:any,model:any)=>baseModelKey(make,model)+(/\+\s*$/.test(String(model))?'plus':'');
import {DetailReadCache} from './detail-read-cache';
import {validateCustomerParameters} from './customer-parameters';
import type {VehicleOffer} from './types';

export const MANAGEMENT_KNOWLEDGE_PATH='knowledge/management-vehicle-parameters/v1/current.json';
export type ManagementFact={offerId:string;version:string;savedAt:string;savedBy:string;key:string;year:number;values:Record<string,any>};
export type ManagementKnowledge={version:1;revision:string;models:Record<string,Record<string,ManagementFact>>};
const empty=():ManagementKnowledge=>({version:1,revision:'empty',models:{}});
const cache=new DetailReadCache<ManagementKnowledge>({maxEntries:1,maxBytes:16*1024*1024,ttlMs:5000,concurrency:1});
export const readManagementKnowledge=()=>cache.get('current',()=>readDataJson(MANAGEMENT_KNOWLEDGE_PATH,empty()));
const fields=['vehicleCategory','fuel','engineCc','powerHp','powertrainKind','icePowerKw','power30MinKw','drive','transmission','bodyType','engineCode','chassisCode','generation','batteryKwh','motorPeakKw'] as const;
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
   const a=offer[field],b=row.values[field];
   if(known(a)&&known(b)){
    if(!same(field,a,b))return false;
    // Power units and propulsion subtype are not independent anchors.
    if(!['powertrainKind','icePowerKw','power30MinKw'].includes(field))anchors++;
   }
  }
  return anchors>=2;
 });
 const parameters:Record<string,any>={};
 for(const field of fields){
  if(known(offer[field])||field==='power30MinKw'&&offer.power30MinKwByMotor?.some((v:any)=>Number(v)>0))continue;
  const values=matches.filter(r=>known(r.values[field])).map(r=>r.values[field]);
  if(values.length&&values.every(v=>same(field,v,values[0])))parameters[field]=values[0];
 }
 if(parameters.powerHp&&!known(offer.powerKw))parameters.powerKw=parameters.powerHp*0.73549875;
 return parameters;
}
/** Explicitly confirmed staff inputs, separate from source/certification evidence. */
export async function rememberManagementCalculation(offer:VehicleOffer,record:{version:string;savedAt:string;savedBy:string;draft:Record<string,string>}){
 const p=validateCustomerParameters(record.draft);
 const values=Object.fromEntries(fields.filter(f=>known((p as any)[f])||known((offer as any)[f])).map(f=>[f,known((p as any)[f])?(p as any)[f]:(offer as any)[f]]));
 const fact:ManagementFact={offerId:offer.id,version:record.version,savedAt:record.savedAt,savedBy:record.savedBy,key:modelKey(offer.make,offer.model),year:Number(p.year),values};
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
  const previous=current.models[fact.key]?.[fact.offerId];
  if(previous&&previous.savedAt>fact.savedAt)return current;
  // A correction to this offer retires its former model/year relationship.
  const models={...current.models};
  for(const [key,rows] of Object.entries(models))if(rows[fact.offerId]){models[key]={...rows};delete models[key][fact.offerId];}
  models[fact.key]={...models[fact.key],[fact.offerId]:fact};
  return {version:1,revision:fact.version,models};
 });
 cache.clear();
}
export async function attachManagementKnowledge<T extends Partial<VehicleOffer>>(offers:T[]):Promise<T[]>{
 if(!offers.length)return offers;
 const index=await readManagementKnowledge().catch(()=>empty());
 return offers.map(offer=>{
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
  if(!result[key]||result[key]==='unknown')result[key]=String(value);
 }
 return result;
}
