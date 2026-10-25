import {applyAstraPower30,astraPower30FactsForKey} from './astra-power30';
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
export type CalculationFact={make?:string;model?:string;chassisDriveComplete?:boolean;modelId:string;variantId:string;revision:string;year:number;trims:string[];constraints:Record<string,any>;values:Partial<Record<Field,any>>;sources:Partial<Record<Field,Source>>};
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
 if(['powerHp','powerKw','icePowerKw'].includes(field))return Math.abs(Number(a)-Number(b))<= (field==='powerHp'?1:0.74);
 return normalized(field,a)===normalized(field,b);
}
/** Research review is field-level; stale evidence never certifies a later edit. */
export function compileModelFacts(record:any,ancestors:any[]=[]):CalculationFact[]{
 const out:CalculationFact[]=[];
 for(const v of record.variants||[]){
  if(!Number.isInteger(v.year))continue;
  const values:any={},sources:any={},trims=new Set<string>(token(v.trim)?[token(v.trim)]:[]);
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
  out.push({make:record.make,model:record.model,modelId:record.id,variantId:v.id,revision:record.revision,year:v.year,trims:[...trims],
   constraints:Object.fromEntries([...factFields,'generation','chassisCode'].filter(f=>exists(v[f])).map(f=>[f,v[f]])),values,sources});
 }
 // A code shared by an undocumented sibling must not become a drive proof.
 const code=(v:any)=>token(String(v||'').replace(/^(?:E|GF|TA|ABA|CBA|DBA|DAA|DLA|3BA|4BA|5BA|5AA|6AA|6LA|7BA|ZAA)-/i,''));
 const byId=new Map(out.map(f=>[f.variantId,f]));
 const groups=new Map<string,boolean>();
 for(const v of record.variants||[]){
  if(!v.chassisCode||!Number.isInteger(v.year))continue;
  const key=v.year+':'+code(v.chassisCode);
  groups.set(key,(groups.get(key)??true)&&exists(byId.get(v.id)?.values.drive));
 }
 for(const fact of out)if(fact.constraints.chassisCode)fact.chassisDriveComplete=groups.get(fact.year+':'+code(fact.constraints.chassisCode))===true;
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
function resolvesRoundedAutoPapaVolume(offer:any,evidence:any,entries:CalculationFact[]){
 if(offer.sourceId!=='autopapa_georgia_open'||exists(offer.engineCc)||exists(evidence?.value)||evidence?.source!=='autopapa_listing_card_engine')return false;
 const raw=evidence.rawValues;
 return Array.isArray(raw)&&raw.length>0&&raw.length<=4&&entries.every(c=>c.sources.engineCc?.kind==='manufacturer'&&Boolean(c.sources.engineCc.batchId))
  &&raw.every((v:unknown)=>{const m=String(v).trim().match(/^(\d{1,2})[.,](\d{1,2})\s*l$/i);if(!m)return false;
   const cc=Number(m[1]+'.'+m[2])*1000,rounding=500/10**m[2].length;
   return entries.every(c=>Math.abs(Number(c.values.engineCc)-cc)<=rounding);
  });
}
/** Exact modification/year, hard constraints, and per-field unanimity. No score winner. */
function applyAnnualEncyclopediaCalculation<T extends Record<string,any>>(offer:T,index=readCalculationIndex(),options:{technicalIdentity?:boolean;specificationIdentity?:boolean;ordinarySpecificationIdentity?:boolean}={technicalIdentity:true,specificationIdentity:true}):T{
 if(!index||!offer.make||!offer.model||!Number.isInteger(offer.year)||(!offer.trim&&!options.technicalIdentity&&!options.specificationIdentity))return offer;
 if(/customer_input|manual/i.test(offer.powerDataSource||'')||offer.calculationSnapshot?.modificationScenario)return offer;
 if(hasEncyclopediaCalculationEvidence(offer)){
  const previous=offer.operational?.encyclopediaCalculation||offer.encyclopediaCalculation;
  if(previous.indexDigest===index.digest)return offer;
  // Retire only values inserted by the previous index, never later manual edits.
  const fresh:any={...offer,operational:{...offer.operational,semanticEvidence:{...offer.operational?.semanticEvidence}}};
  for(const field of previous.filledFields||[])delete fresh[field];
  const refinement=offer.operational?.encyclopediaPowertrainRefinement;
  if(refinement?.indexDigest===previous.indexDigest&&refinement.sourceIdentity===calculationSourceIdentity(offer)&&offer.powertrainKind===refinement.kind){
   fresh.powertrainKind=refinement.originalKind;
   delete fresh.operational.encyclopediaPowertrainRefinement;
  }
  for(const field of Object.keys(previous.values))if(fresh.operational.semanticEvidence[field]?.source===`permanent_encyclopedia:${previous.indexDigest}`){
   const original=fresh.operational.semanticEvidence[field].resolvedSourceEvidence;
   if(original)fresh.operational.semanticEvidence[field]=original;else delete fresh.operational.semanticEvidence[field];
  }
  if(refinement?.indexDigest===previous.indexDigest&&refinement.sourceIdentity===calculationSourceIdentity(offer)&&refinement.originalFuelEvidence&&!fresh.operational.semanticEvidence.fuel)fresh.operational.semanticEvidence.fuel=refinement.originalFuelEvidence;
  delete fresh.operational.encyclopediaCalculation;delete fresh.encyclopediaCalculation;
  if(previous.filledFields?.some((f:string)=>['engineCc','powerHp','powerKw','icePowerKw','power30MinKw','fuel','powertrainKind','grossVehicleWeightKg'].includes(f))){fresh.totalRub=null;fresh.publicVisibleRub=undefined;fresh.publicSpecificationVerified=false;fresh.calculationSnapshot=undefined;fresh.catalogPricingMode='seller';}
  if(fresh.powerDataSource===`permanent_encyclopedia:${previous.indexDigest}`){delete fresh.powerDataSource;delete fresh.powerDataConfidence;}
  offer=fresh;
 }
 const refinementBase=offer;if(options.specificationIdentity)offer=refineUnattestedHybridKind(offer,index);const kindRefined=offer!==refinementBase;
 const trim=token(offer.trim);
 const identity={...offer,chassisCode:offer.chassisCode||offer.operational?.chassisCode};
 const annual=(index.models[modelKey(offer.make,offer.model)]||[]).filter(v=>v.year===offer.year);
 const roundedJapanVolume=(v:CalculationFact,f:string,value:any)=>options.technicalIdentity&&f==='engineCc'&&offer.market==='japan'
  &&exists(identity.chassisCode)&&same('chassisCode',identity.chassisCode,v.constraints.chassisCode)
  &&Number(identity.engineCc)%100===0&&Math.abs(Number(identity.engineCc)-Number(value))<=25;
 const nonConflicting=(v:CalculationFact)=>Object.entries(v.constraints).every(([f,value])=>!exists(identity[f])||same(f,identity[f],value)||roundedJapanVolume(v,f,value));
 const compatible=(v:CalculationFact)=>nonConflicting(v)
  &&['generation','chassisCode','engineCode'].every(f=>!exists(identity[f])||exists(v.constraints[f])&&same(f,identity[f],v.constraints[f]));
 const exact=annual.filter(v=>v.trims.includes(trim));
 const specificTrim=(/\d/u.test(trim)&&/[\p{L}]/u.test(trim))||identity.engineCode||identity.chassisCode;
 let candidates=specificTrim?exact.filter(compatible):[];
 let technicalMatch=false,specificationMatch=false,ordinarySpecificationMatch=false;
 // A conflicting equipment name cannot block an independently matching
 // technical code. Real mechanical contradictions still exclude the donor.
 if(options.technicalIdentity&&!candidates.length&&(exists(identity.chassisCode)||exists(identity.engineCode))){
  candidates=annual.filter(v=>compatible(v)&&['chassisCode','engineCode'].some(f=>exists(identity[f])&&exists(v.constraints[f])&&same(f,identity[f],v.constraints[f])));
  technicalMatch=candidates.length>0;
 }
 // Specification consensus: independent known mechanical anchors,
 // same annual model, and every compatible candidate retained for unanimity.
 if(options.specificationIdentity&&!candidates.length){
  const power=(v:any)=>Number(v.powerKw)||(Number(v.powerHp)*0.73549875);
  const strong=(v:CalculationFact)=>{
   const x=v.values;
   if(!exists(identity.fuel)||!exists(x.fuel)||!same('fuel',identity.fuel,x.fuel))return false;
   if(exists(identity.powertrainKind)&&(!exists(x.powertrainKind)||!same('powertrainKind',identity.powertrainKind,x.powertrainKind)))return false;
   // Feed records often omit the redundant powertrain kind. Keep all fuel-
   // compatible candidates; any missing/divergent output still blocks that field.
   // An explicitly supplied ICE measurement must compare with ICE, never system power.
   const useIce=Number(identity.icePowerKw)>0;
   const a=useIce?Number(identity.icePowerKw):power(identity),b=useIce?Number(x.icePowerKw):power(x);
   if(!(a>0&&b>0&&Math.abs(a-b)<=0.75))return false;
   const anchor=(f:Field)=>exists(identity[f])&&exists(x[f])&&same(f,identity[f],x[f]);
   return normalized('fuel',identity.fuel)==='electric'
    ?anchor('drive')&&anchor('bodyType')
    :anchor('engineCc')&&(anchor('drive')||anchor('bodyType'));
  };
  // A source-only code is not a contradiction with an undocumented donor code.
  // Known conflicting codes are still rejected by nonConflicting. Keep incomplete
  // donors in the pool instead of dropping them to manufacture consensus.
  const pool=annual.filter(nonConflicting);
  if(pool.some(strong)){candidates=pool;specificationMatch=true;}
  else if(options.ordinarySpecificationIdentity!==false&&['petrol','diesel'].includes(normalized('fuel',identity.fuel))&&pool.some(v=>{
   const x=v.values;
   if(!exists(x.fuel)||!same('fuel',identity.fuel,x.fuel))return false;
   if(exists(identity.powertrainKind)&&(!exists(x.powertrainKind)||!same('powertrainKind',identity.powertrainKind,x.powertrainKind)))return false;
   const a=Number(identity.icePowerKw)||power(identity),b=Number(identity.icePowerKw)>0?Number(x.icePowerKw):power(x);
   const powerAnchor=a>0&&b>0&&Math.abs(a-b)<=0.75;
   const volumeAnchor=exists(identity.engineCc)&&exists(x.engineCc)&&same('engineCc',identity.engineCc,x.engineCc);
   const layoutAnchor=['drive','bodyType'].some(f=>exists(identity[f])&&exists(x[f])&&same(f,identity[f],x[f]));
   // A reviewed factory output, known gearbox and annual model may recover
   // missing displacement even when the source omitted both body and drive.
   // Unreviewed observations alone cannot open this narrower path.
   const exactFactoryOutput=Number(identity.powerHp)>0&&Number(x.powerHp)>0?Math.abs(Number(identity.powerHp)-Number(x.powerHp))<0.01:Math.abs(a-b)<0.1;
   const factoryGearboxAnchor=exactFactoryOutput&&exists(identity.transmission)&&exists(v.constraints.transmission)&&same('transmission',identity.transmission,v.constraints.transmission)
    &&v.sources.engineCc?.kind==='manufacturer'&&Boolean(v.sources.engineCc.batchId)
    &&['powerHp','powerKw','icePowerKw'].some(f=>(v.sources as any)[f]?.kind==='manufacturer'&&Boolean((v.sources as any)[f]?.batchId));
   return (powerAnchor&&(volumeAnchor||factoryGearboxAnchor))||((powerAnchor||volumeAnchor)&&layoutAnchor);
  })){
   // Missing displacement or output cannot be required to recover itself.
   // Every compatible annual variant remains in the consensus pool; this
   // narrower evidence path never transfers certified thirty-minute power.
   candidates=pool;specificationMatch=true;ordinarySpecificationMatch=true;
  }
 }
 if(!candidates.length)return refinementBase;
 const next:any={...offer},applied:any={},provenance:any={},filledFields:string[]=[],semantic={...offer.operational?.semanticEvidence};
 for(const field of factFields){
  // Certification belongs to an exact modification; a code-only bridge is not sufficient.
  if((technicalMatch||ordinarySpecificationMatch)&&field==='power30MinKw')continue;
  if(specificationMatch&&field==='power30MinKw'&&candidates.some(v=>!compatible(v)))continue;
  if(semantic[field]?.status==='conflict')continue;
  const entries=candidates.filter(c=>exists(c.values[field]));
  // A partially documented candidate remains a possible different modification.
  if(entries.length!==candidates.length)continue;
  const value=entries[0].values[field];
  if(!entries.every(c=>same(field,c.values[field],value)))continue;
  const ambiguous=semantic[field]?.status==='ambiguous';
  if(ambiguous&&!(field==='bodyType'&&resolvesCoarseMobileBody(offer,semantic[field],entries))&&!(field==='engineCc'&&resolvesRoundedAutoPapaVolume(offer,semantic[field],entries)))continue;
  if(exists(next[field])&&!same(field,next[field],value))continue;
  if(!exists(next[field])){next[field]=['fuel','powertrainKind','drive','transmission','bodyType'].includes(field)?normalized(field,value):value;filledFields.push(field);}
  applied[field]=next[field];provenance[field]=entries.map(c=>({modelId:c.modelId,variantId:c.variantId,revision:c.revision,...c.sources[field]}));
  semantic[field]={status:'exact',value:next[field],source:`permanent_encyclopedia:${index.digest}`,provenance:provenance[field],
   ...(ambiguous?{resolvedSourceEvidence:semantic[field]}:{})};
 }
 if(!Object.keys(applied).length||(kindRefined&&!applied.powertrainKind))return refinementBase;
 if(kindRefined&&!filledFields.includes('powertrainKind'))filledFields.push('powertrainKind');
 if(applied.powerHp||applied.powerKw){next.powerDataSource=`permanent_encyclopedia:${index.digest}`;next.powerDataConfidence=Object.values(provenance).flat().some((s:any)=>s.kind==='owner_reference')?'source_exact':'documented';}
 next.operational={...offer.operational,semanticEvidence:semantic,encyclopediaCalculation:{version:1,indexDigest:index.digest,
  sourceIdentity:calculationSourceIdentity(offer),values:applied,provenance,filledFields,matchMethod:specificationMatch?'specification_consensus':technicalMatch?'technical_identity':'exact_trim'}};
 next.encyclopediaCalculation={version:1,indexDigest:index.digest,sourceIdentity:calculationSourceIdentity(offer),
  values:applied,filledFields};
 return next;
}

/** Che168's bare hybrid fallback is not evidence of a parallel drivetrain.
 * Refine only an unattested default against an exact named, mechanically matching,
 * independently reviewed annual variant. Keep explicit source/manual conflicts. */
function refineUnattestedHybridKind<T extends Record<string,any>>(offer:T,index:CalculationIndex|null):T {
 const semantic=offer.operational?.semanticEvidence;
 if(!index||offer.sourceId!=='autohome_used_china_open'||offer.market!=='china'||offer.fuel!=='hybrid'||offer.powertrainKind!=='other_hybrid'
  ||!offer.trim||offer.manualEditedAt||/manual|customer_input/i.test(offer.powerDataSource||'')||offer.calculationSnapshot?.modificationScenario
  ||hasEncyclopediaCalculationEvidence(offer)||semantic?.powertrainKind
  ||semantic?.fuel?.source!=='auto_api_che168:engine_type'||semantic.fuel.status!=='exact'||semantic.fuel.value!=='hybrid')return offer;
 const rows=(index.models[modelKey(offer.make,offer.model)]||[]).filter(v=>v.year===offer.year&&v.trims.includes(token(offer.trim))
  &&Object.entries(v.constraints).every(([f,value])=>f==='powertrainKind'||!exists(offer[f])||same(f,offer[f],value)));
 if(!rows.length||!rows.every(v=>{
  const proof=v.sources.powertrainKind,x=v.values;
  return proof?.batchId&&['manufacturer','official_registry','manual'].includes(proof.kind)&&x.powertrainKind==='series_hybrid'
   &&['fuel','engineCc','drive'].every(f=>exists(offer[f])&&exists((x as any)[f])&&same(f,offer[f],(x as any)[f]))
   &&['powerHp','powerKw'].some(f=>exists(offer[f])&&exists((x as any)[f])&&same(f,offer[f],(x as any)[f]));
 }))return offer;
 return {...offer,powertrainKind:'series_hybrid',operational:{...offer.operational,encyclopediaPowertrainRefinement:{
  indexDigest:index.digest,originalKind:offer.powertrainKind,kind:'series_hybrid',
  sourceIdentity:calculationSourceIdentity(offer),originalFuelEvidence:semantic.fuel,provenance:rows.map(v=>({modelId:v.modelId,variantId:v.variantId,...v.sources.powertrainKind}))}}};
}

/** Annual facts and immutable ASTRA technical certificates have separate matching rules. */
export function applyEncyclopediaCalculation<T extends Record<string,any>>(offer:T,index=readCalculationIndex(),options:{technicalIdentity?:boolean;specificationIdentity?:boolean;ordinarySpecificationIdentity?:boolean}={technicalIdentity:true,specificationIdentity:true}):T {
 const annual=applyAnnualEncyclopediaCalculation(offer,index,options);
 return index?applyAstraPower30(annual,astraPower30FactsForKey(index.models,modelKey(offer.make,offer.model)),index.digest):annual;
}
