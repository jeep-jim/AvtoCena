import type {CalculationFact} from './calculation-index';
import {hasAstraPower30Evidence,astraOfferIdentity} from './astra-power30-evidence';
const present=(v:any)=>v!==undefined&&v!==null&&v!==''&&v!==0&&v!=='unknown';
const token=(v:any)=>String(v??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const fields=['fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','motorPeakKw','drive','transmission','bodyType','engineCode','batteryKwh'] as const;
const text=(f:string,v:any)=>{
 const t=token(v);
 if(f==='fuel')return ({gasoline:'petrol',бензин:'petrol',электро:'electric',гибрид:'hybrid'} as any)[t]||t;
 if(f==='drive')return ({'4wd':'awd','4x4':'awd',полный:'awd',передний:'fwd',задний:'rwd'} as any)[t]||t;
 if(f==='transmission')return ({at:'automatic',mt:'manual',вариатор:'cvt',автомат:'automatic',одноступенчатыйредуктор:'singlespeed'} as any)[t]||t;
 return t;
};
const same=(f:string,a:any,b:any)=>['powerKw','icePowerKw','motorPeakKw'].includes(f)?Math.abs(Number(a)-Number(b))<=0.75:f==='powerHp'?Math.abs(Number(a)-Number(b))<=1:['engineCc','batteryKwh'].includes(f)?Number(a)===Number(b):text(f,a)===text(f,b);
export const astraPower30Key=(modelKey:string)=>'@astra-power30:'+modelKey;
const referenceFamilies=new WeakMap<object,Map<string,CalculationFact[]>>();
/** Registry trade names C/C300 and catalog C-Class are one search family.
 * Union every sibling; mechanical/certificate unanimity still decides matches. */
export function astraPower30FactsForKey(models:Record<string,CalculationFact[]>,key:string):CalculationFact[]{
 const family=/^mercedesbenz:([ces])(?:class)?$/.exec(key)?.[1];
 if(!family)return models[astraPower30Key(key)]||[];
 let cache=referenceFamilies.get(models);if(!cache){cache=new Map();referenceFamilies.set(models,cache);}
 if(!cache.has(family)){
  const pattern=new RegExp('^@astra-power30:mercedesbenz:'+family+'(?:class|[0-9]{3}[a-z]*)?$');
  cache.set(family,Object.entries(models).filter(([k])=>pattern.test(k)).flatMap(([,v])=>v));
 }
 return cache.get(family)!;
}
/** Keep undocumented siblings as blockers. year=0 is an internal technical-only
 * sentinel; these records are never offered as model-year facts. */
export function compileAstraPower30Facts(record:any):CalculationFact[]{
 const variants=(record.variants||[]).filter((v:any)=>v.astraEvidence&&v.astraIdentity);
 if(!variants.some((v:any)=>Number(v.astraEvidence.values?.power30MinKw)>0))return [];
 return variants.flatMap((v:any)=>{
  const e=v.astraEvidence,x=e.values||{};
  if(!/^https:\/\/opendata\.astra\.admin\.ch\/ivzod\//.test(e.sourceUrl||'')||!['edatenblatt','tas','targa'].includes(e.sourceDataset)
   ||!/^[a-f0-9]{64}$/.test(e.sourceSha256||'')||!/^[a-f0-9]{64}$/.test(e.corpusDigest||'')||!e.evidenceIds?.length)return [];
  // Known combustion siblings cannot be an electric/hybrid counterpart.
  if(x.powertrainKind==='combustion'&&x.fuel!=='hybrid')return [];
  const unchanged=fields.every(f=>!present(x[f])||JSON.stringify(v[f])===JSON.stringify(x[f]));
  const certified=e.sourceDataset!=='targa'&&unchanged&&v.status!=='verified'&&Number(x.power30MinKw)>0&&Number(x.power30MinKw)<=2000&&v.power30MinKw===x.power30MinKw;
  return [{make:record.make,model:record.model,modelId:record.id,variantId:v.id,revision:record.revision,year:0,trims:[],
   constraints:{...Object.fromEntries(fields.filter(f=>present(x[f])).map(f=>[f,x[f]])),astraIdentity:v.astraIdentity},
   values:certified?{power30MinKw:x.power30MinKw}:{},sources:certified?{power30MinKw:{kind:'official_registry' as const,url:e.sourceUrl,batchId:'astra-'+e.corpusDigest}}:{}}];
 });
}
const chassis=(v:any)=>token(String(v||'').replace(/^(?:E|GF|TA|ABA|CBA|DBA|DAA|DLA|3BA|4BA|5BA|5AA|6AA|6LA|7BA|ZAA)-/i,''));
export function matchAstraPower30(offer:any,facts:CalculationFact[]):{reason:string;value?:number;method?:string;candidates?:CalculationFact[]}{
 if(!facts.length)return {reason:'no_model_reference'};
 if(/customer_input|manual/i.test(offer.powerDataSource||'')||offer.calculationSnapshot?.modificationScenario)return {reason:'manual_parameters'};
 const semantic=offer.operational?.semanticEvidence||{};
 if(['power30MinKw','certifiedPower'].some(f=>['conflict','ambiguous'].includes(semantic[f]?.status)))return {reason:'certified_conflict'};
 const fuel=text('fuel',offer.fuel);
 if(!['hybrid','electric'].includes(fuel))return {reason:'unknown_electrified_identity'};
 const identity=offer.astraIdentity||offer.typeApprovalIdentity||offer.operational?.typeApprovalIdentity;
 const code=offer.chassisCode||offer.operational?.chassisCode||offer.operational?.modelCode;
 const engine=offer.engineCode;
 const pool=facts.filter(f=>fields.every(k=>!present(offer[k])||!present(f.constraints[k])||same(k,offer[k],f.constraints[k])
  // An EV feed's generic automatic label includes a single-speed reducer.
  // This broadens the candidate pool; it never supplies a transmission fact.
  ||k==='transmission'&&fuel==='electric'&&[text(k,offer[k]),text(k,f.constraints[k])].sort().join(':')==='automatic:singlespeed'));
 if(!pool.length)return {reason:'technical_conflict'};
 // An exact complete homologation identity has no market/year inference.
 const exact=identity&&pool.filter(f=>['approval','type','variant','version'].every(k=>present(identity[k])&&String(identity[k])===String(f.constraints.astraIdentity?.[k])));
 let candidates:CalculationFact[]=exact?.length?exact:pool,method='approval_type_variant_version';
 if(!exact?.length){
  const knownCode=Boolean(code),knownEngine=Boolean(engine&&token(engine).length>=3&&/\d/.test(engine));
  const codeMatches=(f:CalculationFact)=>knownCode&&chassis(code)===chassis(f.constraints.astraIdentity?.type);
  const engineMatches=(f:CalculationFact)=>knownEngine&&same('engineCode',engine,f.constraints.engineCode);
  const outputField=Number(offer.motorPeakKw)>0?'motorPeakKw':Number(offer.icePowerKw)>0?'icePowerKw':Number(offer.powerKw)>0?'powerKw':Number(offer.powerHp)>0?'powerHp':null;
  const anchor=(f:CalculationFact,k:string)=>present(offer[k])&&present(f.constraints[k])&&same(k,offer[k],f.constraints[k]);
  const output=(f:CalculationFact)=>Boolean(outputField&&(anchor(f,outputField)
   ||fuel==='electric'&&outputField==='powerHp'&&Number(f.constraints.powerKw)>0&&Math.abs(Number(offer.powerHp)*0.73549875-Number(f.constraints.powerKw))<=0.75));
  const completeMechanical=(f:CalculationFact)=>anchor(f,'fuel')&&anchor(f,'drive')&&output(f)
   &&(fuel==='electric'||anchor(f,'engineCc')&&(anchor(f,'icePowerKw')||anchor(f,'motorPeakKw')));
  const strong=(f:CalculationFact)=>anchor(f,'fuel')&&anchor(f,'drive')&&output(f)
   &&(fuel==='electric'||anchor(f,'engineCc'))&&(codeMatches(f)||engineMatches(f));
  if(!candidates.some(strong)&&!candidates.some(completeMechanical))return {reason:'insufficient_technical_anchors'};
  // A documented different type is excluded only when type itself is an anchor.
  // If only engine matches, a foreign-market chassis must not remove siblings.
  if(knownCode&&candidates.some(f=>strong(f)&&codeMatches(f))){
   candidates=candidates.filter(f=>!present(f.constraints.astraIdentity?.type)||codeMatches(f));method='chassis_powertrain_consensus';
  }else method=candidates.some(strong)?'engine_powertrain_consensus':'mechanical_powertrain_consensus';
 }
 if(candidates.some(f=>!(Number(f.values.power30MinKw)>0)))return {reason:'undocumented_candidate'};
 const value=Number(candidates[0].values.power30MinKw);
 if(!candidates.every(f=>Number(f.values.power30MinKw)===value))return {reason:'conflicting_certified_values'};
 return {reason:'matched',value,method,candidates};
}
export function applyAstraPower30<T extends Record<string,any>>(input:T,facts:CalculationFact[],digest:string):T {
 if(!input.id||!Number.isInteger(input.year)||!input.make||!input.model)return input;
 let offer:any=input;
 const prior=offer.astraPower30Evidence;
 if(prior&&prior.value===offer.power30MinKw){
  if(hasAstraPower30Evidence(offer)&&prior.indexDigest===digest)return input;
  offer={...offer,...resetPricing(offer),power30MinKw:undefined,astraPower30Evidence:undefined,operational:{...offer.operational,semanticEvidence:{...offer.operational?.semanticEvidence}}};
  if(offer.operational.semanticEvidence.power30MinKw?.source===`astra_power30:${prior.indexDigest}`)delete offer.operational.semanticEvidence.power30MinKw;
 }
 if(present(offer.power30MinKw)||offer.power30MinKwByMotor?.some((v:any)=>Number(v)>0))return offer;
 const match=matchAstraPower30(offer,facts);if(!match.value)return offer;
 const inputs=Object.fromEntries(fields.filter(k=>present(offer[k])).map(k=>[k,offer[k]]));
 const proof={version:1,indexDigest:digest,sourceIdentity:astraOfferIdentity(offer),value:match.value,inputs};
 return {...offer,power30MinKw:match.value,astraPower30Evidence:proof,
  ...resetPricing(offer),
  operational:{...offer.operational,semanticEvidence:{...offer.operational?.semanticEvidence,power30MinKw:{status:'exact',value:match.value,source:`astra_power30:${digest}`}},
   astraPower30Match:{indexDigest:digest,method:match.method,variants:match.candidates?.map(f=>({modelId:f.modelId,variantId:f.variantId,revision:f.revision,source:f.sources.power30MinKw}))}},
 } as T;
}

function resetPricing(offer:any){return {totalRub:null,previousTotalRub:null,priceDeltaRub:null,publicVisibleRub:undefined,publicSpecificationVerified:false,
  calculationStatus:'needs_data',catalogPricingMode:'seller',savedCalculationPreview:undefined,deliveredCalculationPreview:undefined,japanDeliveredPreview:undefined,
  calculationSnapshot:offer.calculationSnapshot?{currencyRate:offer.calculationSnapshot.currencyRate,sourcePriceRub:offer.calculationSnapshot.sourcePriceRub}:undefined};}
