import {hasEncyclopediaCalculationEvidence,calculationSourceIdentity} from './calculation-evidence';
export {hasEncyclopediaCalculationEvidence} from './calculation-evidence';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getDataRoot} from '../data';
import {canonicalCatalogBrand} from '../catalog/brands';

// Immutable, privately prepared release data. No storage/network reads on lookup.
export const CALCULATION_INDEX_PATH='knowledge/encyclopedia/calculation-v1.json';
export const factFields=['fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','power30MinKw','transmission','drive','bodyType','engineCode','grossVehicleWeightKg'] as const;
type Field=typeof factFields[number];
type Source={kind:'manufacturer'|'official_registry'|'manual'|'owner_reference';url?:string;batchId?:string;markets?:string[]};
export type CalculationFact={modelId:string;variantId:string;revision:string;year:number;trims:string[];constraints:Record<string,any>;values:Partial<Record<Field,any>>;sources:Partial<Record<Field,Source>>};
export type CalculationIndex={version:1;digest:string;manifestDigest:string;createdAt:string;models:Record<string,CalculationFact[]>};
export const token=(v:unknown)=>String(v??'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
export const modelKey=(make:unknown,model:unknown)=>`${token(canonicalCatalogBrand(String(make||'')))}:${token(model)}`;
export const checksum=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exists=(v:any)=>v!==undefined&&v!==null&&v!==''&&v!==0&&token(v)!=='unknown';
function normalized(field:string,value:any):any{
 const t=token(value);
 if(field==='fuel')return ({gasoline:'petrol',бензин:'petrol',дизель:'diesel',электро:'electric'} as any)[t]||t;
 if(field==='powertrainKind')return ({ice:'combustion',bev:'electric',hev:'other_hybrid',phev:'other_hybrid',erev:'series_hybrid',reev:'series_hybrid',otherhybrid:'other_hybrid',serieshybrid:'series_hybrid'} as any)[t]||t;
 if(field==='drive')return ({'4wd':'awd','4x4':'awd',полный:'awd',передний:'fwd',задний:'rwd'} as any)[t]||t;
 if(field==='transmission')return ({at:'automatic',автомат:'automatic',механика:'manual',mt:'manual',robot:'dct',робот:'dct',вариатор:'cvt'} as any)[t]||t;
 if(field==='bodyType')return ({седан:'sedan',saloon:'sedan',estate:'wagon',универсал:'wagon',crossover:'suv',кроссовер:'suv',хэтчбек:'hatchback'} as any)[t]||t;
 return typeof value==='number'?value:t;
}
function same(field:string,a:any,b:any){
 if(['powerHp','powerKw'].includes(field))return Math.abs(Number(a)-Number(b))<= (field==='powerHp'?1:0.74);
 return normalized(field,a)===normalized(field,b);
}
/** Research review is field-level; stale evidence never certifies a later edit. */
export function compileModelFacts(record:any):CalculationFact[]{
 const out:CalculationFact[]=[];
 for(const v of record.variants||[]){
  if(!Number.isInteger(v.year)||!v.trim)continue;
  const values:any={},sources:any={},trims=new Set([token(v.trim)]);
  const evidence=[...(v.researchEvidenceHistory||[]),v.researchEvidence].filter(Boolean);
  for(const e of evidence){
   if(!['manufacturer','official_registry'].includes(e.source?.type)||!/^https:\/\//.test(e.source?.url||''))continue;
   if(e.checkedIdentity?.make!==record.make||e.checkedIdentity?.model!==record.model||e.checkedIdentity?.year!==v.year||e.checkedIdentity?.trim!==v.trim)continue;
   for(const field of factFields)if(e.fields?.includes(field)&&exists(v[field])&&JSON.stringify(v[field])===JSON.stringify(e.values?.[field])){
    if(field==='power30MinKw'&&!e.source.certificationDocument)continue;
    values[field]=v[field];sources[field]={kind:e.source.type,url:e.source.url,batchId:e.batchId};
   }
   if(e.originalTrim)trims.add(token(e.originalTrim));
  }
  const reference=v.status==='observed'&&(v.markets||[]).some((m:string)=>m==='china'||m==='europe');
  for(const field of factFields){
   if(sources[field]||!exists(v[field]))continue;
   if(v.status==='verified'&&/^https?:\/\//.test(v.sourceUrl||'')){
    values[field]=v[field];sources[field]={kind:'manual',url:v.sourceUrl};
   }else if(reference&&field!=='power30MinKw'){
    values[field]=v[field];sources[field]={kind:'owner_reference',markets:v.markets.filter((m:string)=>m==='china'||m==='europe')};
   }
  }
  if(!Object.keys(values).length)continue;
  out.push({modelId:record.id,variantId:v.id,revision:record.revision,year:v.year,trims:[...trims],
   constraints:Object.fromEntries([...factFields,'generation','chassisCode'].filter(f=>exists(v[f])).map(f=>[f,v[f]])),values,sources});
 }
 return out;
}
let bundled:CalculationIndex|null|undefined;
export function readCalculationIndex(){
 if(bundled!==undefined)return bundled;
 try{
  const raw=JSON.parse(fs.readFileSync(path.join(getDataRoot(),CALCULATION_INDEX_PATH),'utf8'));
  if(raw.version!==1||raw.digest!==checksum(raw.models))throw Error('encyclopedia_calculation_index_invalid');
  bundled=raw;
 }catch(e:any){if(e.code!=='ENOENT')throw e;bundled=null;}
 return bundled;
}
export function resetCalculationIndexForTests(){bundled=undefined;}
/** Exact modification/year, hard constraints, and per-field unanimity. No score winner. */
export function applyEncyclopediaCalculation<T extends Record<string,any>>(offer:T,index=readCalculationIndex()):T{
 if(!index||!offer.make||!offer.model||!Number.isInteger(offer.year)||!offer.trim)return offer;
 if(/customer_input|manual/i.test(offer.powerDataSource||'')||offer.calculationSnapshot?.modificationScenario)return offer;
 if(hasEncyclopediaCalculationEvidence(offer)){
  const previous=offer.operational?.encyclopediaCalculation||offer.encyclopediaCalculation;
  if(previous.indexDigest===index.digest)return offer;
  // Retire only values inserted by the previous index, never later manual edits.
  const fresh:any={...offer,operational:{...offer.operational,semanticEvidence:{...offer.operational?.semanticEvidence}}};
  for(const field of previous.filledFields||[])delete fresh[field];
  for(const field of Object.keys(previous.values))if(fresh.operational.semanticEvidence[field]?.source===`permanent_encyclopedia:${previous.indexDigest}`)delete fresh.operational.semanticEvidence[field];
  delete fresh.operational.encyclopediaCalculation;delete fresh.encyclopediaCalculation;
  if(previous.filledFields?.length){fresh.totalRub=null;fresh.publicVisibleRub=undefined;fresh.publicSpecificationVerified=false;fresh.calculationSnapshot=undefined;fresh.catalogPricingMode='seller';}
  if(fresh.powerDataSource===`permanent_encyclopedia:${previous.indexDigest}`){delete fresh.powerDataSource;delete fresh.powerDataConfidence;}
  offer=fresh;
 }
 const trim=token(offer.trim);
 // Marketing labels such as Base, Premium or Luxury do not identify an engine.
 if((!/\d/u.test(trim)||!/[\p{L}]/u.test(trim))&&!offer.engineCode&&!offer.chassisCode)return offer;
 const all=(index.models[modelKey(offer.make,offer.model)]||[]).filter(v=>v.year===offer.year&&v.trims.includes(trim));
 const candidates=all.filter(v=>Object.entries(v.constraints).every(([f,value])=>!exists(offer[f])||same(f,offer[f],value))
  &&['generation','chassisCode','engineCode'].every(f=>!exists(offer[f])||exists(v.constraints[f])&&same(f,offer[f],v.constraints[f])));
 if(!candidates.length)return offer;
 const next:any={...offer},applied:any={},provenance:any={},filledFields:string[]=[],semantic={...offer.operational?.semanticEvidence};
 for(const field of factFields){
  if(['conflict','ambiguous'].includes(semantic[field]?.status))continue;
  const entries=candidates.filter(c=>exists(c.values[field]));
  // A partially documented candidate remains a possible different modification.
  if(entries.length!==candidates.length)continue;
  const value=entries[0].values[field];
  if(!entries.every(c=>same(field,c.values[field],value)))continue;
  if(exists(next[field])&&!same(field,next[field],value))continue;
  if(!exists(next[field])){next[field]=['fuel','powertrainKind','drive','transmission','bodyType'].includes(field)?normalized(field,value):value;filledFields.push(field);}
  applied[field]=next[field];provenance[field]=entries.map(c=>({modelId:c.modelId,variantId:c.variantId,revision:c.revision,...c.sources[field]}));
  semantic[field]={status:'exact',value:next[field],source:`permanent_encyclopedia:${index.digest}`,provenance:provenance[field]};
 }
 if(!Object.keys(applied).length)return offer;
 if(applied.powerHp||applied.powerKw){next.powerDataSource=`permanent_encyclopedia:${index.digest}`;next.powerDataConfidence=Object.values(provenance).flat().some((s:any)=>s.kind==='owner_reference')?'source_exact':'documented';}
 next.operational={...offer.operational,semanticEvidence:semantic,encyclopediaCalculation:{version:1,indexDigest:index.digest,
  sourceIdentity:calculationSourceIdentity(offer),values:applied,provenance,filledFields}};
 next.encyclopediaCalculation={version:1,indexDigest:index.digest,sourceIdentity:calculationSourceIdentity(offer),
  values:Object.fromEntries(Object.entries(applied).filter(([f])=>['engineCc','powerHp','powerKw','icePowerKw','power30MinKw','fuel','powertrainKind'].includes(f))),filledFields:filledFields.filter(f=>['engineCc','powerHp','powerKw','icePowerKw','power30MinKw','fuel','powertrainKind'].includes(f))};
 return next;
}
