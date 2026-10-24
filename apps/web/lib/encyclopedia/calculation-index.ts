import {isOwnerConfirmedEvidence} from './owner-evidence.mjs';
import {hasEncyclopediaCalculationEvidence,calculationSourceIdentity} from './calculation-evidence';
export {hasEncyclopediaCalculationEvidence} from './calculation-evidence';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getDataRoot} from '../data';
import {canonicalCatalogBrand} from '../catalog/brands';
import {retainedReferenceSources} from './reference-evidence';

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
export function compileModelFacts(record:any,ancestors:any[]=[]):CalculationFact[]{
 const out:CalculationFact[]=[];
 for(const v of record.variants||[]){
  if(!Number.isInteger(v.year)||!v.trim)continue;
  const values:any={},sources:any={},trims=new Set([token(v.trim)]);
  const evidence=[...(v.researchEvidenceHistory||[]),v.researchEvidence].filter(Boolean).reverse();
  const identityTrims=new Set([v.trim]);
  const retainedReferences:any={};
  for(const e of evidence){
   if(!(['manufacturer','official_registry'].includes(e.source?.type)||isOwnerConfirmedEvidence(e.source))||!/^https:\/\//.test(e.source?.url||''))continue;
   if(e.checkedIdentity?.make!==record.make||e.checkedIdentity?.model!==record.model||e.checkedIdentity?.year!==v.year||!identityTrims.has(e.checkedIdentity?.trim))continue;
   if(e.originalTrim)identityTrims.add(e.originalTrim);
   const snapshot=e.ownerReferenceSnapshot;
   if(snapshot?.markets?.some((m:string)=>m==='china'||m==='europe'))for(const field of factFields){
    if(field!=='power30MinKw'&&exists(v[field])&&JSON.stringify(snapshot.values?.[field])===JSON.stringify(v[field]))retainedReferences[field]={kind:'owner_reference',markets:snapshot.markets.filter((m:string)=>m==='china'||m==='europe')};
   }
   for(const field of factFields)if(!sources[field]&&e.fields?.includes(field)&&exists(v[field])&&JSON.stringify(v[field])===JSON.stringify(e.values?.[field])){
    if(field==='power30MinKw'&&!(isOwnerConfirmedEvidence(e.source)||e.source.certificationDocument))continue;
    values[field]=v[field];sources[field]={kind:isOwnerConfirmedEvidence(e.source)?'manual':e.source.type,url:e.source.url,batchId:e.batchId};
   }
   if(e.originalTrim)trims.add(token(e.originalTrim));
  }
  // Recover only unchanged observations along the immutable revision chain.
  // A manual edit or unproved identity change ends that chain.
  let child=v;
  let unchanged=factFields.filter(f=>f!=='power30MinKw'&&exists(v[f]));
  if(v.status==='review'&&v.researchEvidence)for(const parent of ancestors){
   if(parent.id!==record.id||parent.make!==record.make||parent.model!==record.model)break;
   const prior=parent.variants?.find((p:any)=>p.id===v.id);
   if(!prior||prior.year!==v.year)break;
   const e=child.researchEvidence;
   if(child.status!=='observed'&&!(child.status==='review'&&e))break;
   if(prior.trim!==child.trim&&!(e?.originalTrim===prior.trim&&e?.checkedIdentity?.trim===child.trim&&['manufacturer','official_registry'].includes(e?.source?.type)))break;
   unchanged=unchanged.filter(f=>JSON.stringify(child[f])===JSON.stringify(prior[f]));
   if(prior.status==='observed'){
    const markets=(prior.markets||[]).filter((m:string)=>m==='china'||m==='europe');
    if(markets.length)for(const field of unchanged)retainedReferences[field]={kind:'owner_reference',markets};
    break;
   }
   child=prior;
  }
  const reference=v.status==='observed'&&(v.markets||[]).some((m:string)=>m==='china'||m==='europe');
  const reused=retainedReferenceSources(record,v);
  for(const field of factFields){
   if(sources[field]||!exists(v[field]))continue;
   if(v.status==='verified'&&/^https?:\/\//.test(v.sourceUrl||'')){
    values[field]=v[field];sources[field]={kind:'manual',url:v.sourceUrl};
   }else if(reused[field]){
    values[field]=v[field];sources[field]=reused[field];
   }else if(retainedReferences[field]){
    values[field]=v[field];sources[field]=retainedReferences[field];
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
/** mobile.de's Limousine category does not distinguish a sedan from a hatchback.
 * An exact, independently reviewed factory body can resolve that empty bucket;
 * other ambiguous values and actual source contradictions remain blocked. */
function resolvesCoarseMobileBody(offer:any,evidence:any,entries:CalculationFact[]){
 return offer.sourceId==='mobile_de_open'&&!exists(offer.bodyType)&&!exists(evidence?.value)
  &&/^mobile\.de consumer (?:SRP|SRP\/VIP) category$/.test(evidence?.source||'')
  &&Array.isArray(evidence?.rawValues)&&evidence.rawValues.length>0&&evidence.rawValues.length<=8
  &&evidence.rawValues.every((value:unknown)=>typeof value==='string'&&/^limousine(?:,\s*(?:gebrauchtfahrzeug|jahreswagen|neufahrzeug|tageszulassung|vorführfahrzeug))?$/i.test(value.trim()))
  &&entries.every(c=>c.sources.bodyType?.kind==='manufacturer'&&/^https:\/\//.test(c.sources.bodyType.url||'')&&Boolean(c.sources.bodyType.batchId));
}
/** Exact modification/year, hard constraints, and per-field unanimity. No score winner. */
export function applyEncyclopediaCalculation<T extends Record<string,any>>(offer:T,index=readCalculationIndex(),options:{technicalIdentity?:boolean}={technicalIdentity:true}):T{
 if(!index||!offer.make||!offer.model||!Number.isInteger(offer.year)||(!offer.trim&&!options.technicalIdentity))return offer;
 if(/customer_input|manual/i.test(offer.powerDataSource||'')||offer.calculationSnapshot?.modificationScenario)return offer;
 if(hasEncyclopediaCalculationEvidence(offer)){
  const previous=offer.operational?.encyclopediaCalculation||offer.encyclopediaCalculation;
  if(previous.indexDigest===index.digest)return offer;
  // Retire only values inserted by the previous index, never later manual edits.
  const fresh:any={...offer,operational:{...offer.operational,semanticEvidence:{...offer.operational?.semanticEvidence}}};
  for(const field of previous.filledFields||[])delete fresh[field];
  for(const field of Object.keys(previous.values))if(fresh.operational.semanticEvidence[field]?.source===`permanent_encyclopedia:${previous.indexDigest}`){
   const original=fresh.operational.semanticEvidence[field].resolvedSourceEvidence;
   if(original)fresh.operational.semanticEvidence[field]=original;else delete fresh.operational.semanticEvidence[field];
  }
  delete fresh.operational.encyclopediaCalculation;delete fresh.encyclopediaCalculation;
  if(previous.filledFields?.some((f:string)=>['engineCc','powerHp','powerKw','icePowerKw','power30MinKw','fuel','powertrainKind','grossVehicleWeightKg'].includes(f))){fresh.totalRub=null;fresh.publicVisibleRub=undefined;fresh.publicSpecificationVerified=false;fresh.calculationSnapshot=undefined;fresh.catalogPricingMode='seller';}
  if(fresh.powerDataSource===`permanent_encyclopedia:${previous.indexDigest}`){delete fresh.powerDataSource;delete fresh.powerDataConfidence;}
  offer=fresh;
 }
 const trim=token(offer.trim);
 const identity={...offer,chassisCode:offer.chassisCode||offer.operational?.chassisCode};
 const annual=(index.models[modelKey(offer.make,offer.model)]||[]).filter(v=>v.year===offer.year);
 const roundedJapanVolume=(v:CalculationFact,f:string,value:any)=>options.technicalIdentity&&f==='engineCc'&&offer.market==='japan'
  &&exists(identity.chassisCode)&&same('chassisCode',identity.chassisCode,v.constraints.chassisCode)
  &&Number(identity.engineCc)%100===0&&Math.abs(Number(identity.engineCc)-Number(value))<=25;
 const compatible=(v:CalculationFact)=>Object.entries(v.constraints).every(([f,value])=>!exists(identity[f])||same(f,identity[f],value)||roundedJapanVolume(v,f,value))
  &&['generation','chassisCode','engineCode'].every(f=>!exists(identity[f])||exists(v.constraints[f])&&same(f,identity[f],v.constraints[f]));
 const exact=annual.filter(v=>v.trims.includes(trim));
 const specificTrim=(/\d/u.test(trim)&&/[\p{L}]/u.test(trim))||identity.engineCode||identity.chassisCode;
 let candidates=specificTrim?exact.filter(compatible):[];
 let technicalMatch=false;
 // Never bypass a conflicting exact named modification. Different trim names
 // require an explicit chassis/engine anchor; all compatible facts must agree.
 if(options.technicalIdentity&&!exact.length&&(exists(identity.chassisCode)||exists(identity.engineCode))){
  candidates=annual.filter(v=>compatible(v)&&['chassisCode','engineCode'].some(f=>exists(identity[f])&&exists(v.constraints[f])&&same(f,identity[f],v.constraints[f])));
  technicalMatch=candidates.length>0;
 }
 if(!candidates.length)return offer;
 const next:any={...offer},applied:any={},provenance:any={},filledFields:string[]=[],semantic={...offer.operational?.semanticEvidence};
 for(const field of factFields){
  // Certification belongs to an exact modification; a code-only bridge is not sufficient.
  if(technicalMatch&&field==='power30MinKw')continue;
  if(semantic[field]?.status==='conflict')continue;
  const entries=candidates.filter(c=>exists(c.values[field]));
  // A partially documented candidate remains a possible different modification.
  if(entries.length!==candidates.length)continue;
  const value=entries[0].values[field];
  if(!entries.every(c=>same(field,c.values[field],value)))continue;
  const ambiguous=semantic[field]?.status==='ambiguous';
  if(ambiguous&&!(field==='bodyType'&&resolvesCoarseMobileBody(offer,semantic[field],entries)))continue;
  if(exists(next[field])&&!same(field,next[field],value))continue;
  if(!exists(next[field])){next[field]=['fuel','powertrainKind','drive','transmission','bodyType'].includes(field)?normalized(field,value):value;filledFields.push(field);}
  applied[field]=next[field];provenance[field]=entries.map(c=>({modelId:c.modelId,variantId:c.variantId,revision:c.revision,...c.sources[field]}));
  semantic[field]={status:'exact',value:next[field],source:`permanent_encyclopedia:${index.digest}`,provenance:provenance[field],
   ...(ambiguous?{resolvedSourceEvidence:semantic[field]}:{})};
 }
 if(!Object.keys(applied).length)return offer;
 if(applied.powerHp||applied.powerKw){next.powerDataSource=`permanent_encyclopedia:${index.digest}`;next.powerDataConfidence=Object.values(provenance).flat().some((s:any)=>s.kind==='owner_reference')?'source_exact':'documented';}
 next.operational={...offer.operational,semanticEvidence:semantic,encyclopediaCalculation:{version:1,indexDigest:index.digest,
  sourceIdentity:calculationSourceIdentity(offer),values:applied,provenance,filledFields,matchMethod:technicalMatch?'technical_identity':'exact_trim'}};
 next.encyclopediaCalculation={version:1,indexDigest:index.digest,sourceIdentity:calculationSourceIdentity(offer),
  values:applied,filledFields};
 return next;
}
