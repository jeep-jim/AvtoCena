import {createHash} from 'node:crypto';
import {canonicalCatalogBrand} from '../../apps/web/lib/catalog/brands.ts';
import {canonicalSourceModelIdentity} from '../../apps/web/lib/catalog/open-source-normalizer.ts';
import {isEncyclopediaCar} from '../../apps/web/lib/encyclopedia/scope.ts';

/** Official ASTRA evidence is a technical reference, not a list of model years. */
export const ASTRA_ROOT='knowledge/astra/v1';
export const ASTRA_FIELDS=['fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','motorPeakKw','power30MinKw','transmission','drive','bodyType','engineCode','grossVehicleWeightKg','batteryKwh'];
const numeric=new Set(['engineCc','powerHp','powerKw','icePowerKw','motorPeakKw','power30MinKw','grossVehicleWeightKg','batteryKwh']);
const sourceDatasets=new Set(['edatenblatt','tas','targa']);
const enums={fuel:new Set(['petrol','diesel','electric','hybrid','lpg','cng','hydrogen']),powertrainKind:new Set(['combustion','electric','other_hybrid','series_hybrid']),drive:new Set(['fwd','rwd','awd']),transmission:new Set(['manual','automatic','cvt','dct','Одноступенчатый редуктор']),bodyType:new Set(['sedan','hatchback','wagon','coupe','convertible','suv','crossover','minivan','van','pickup'])};
export const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const sha=value=>createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
export const key=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
// A plus sign can distinguish a plug-in powertrain, e.g. 450h versus 450h+.
const designation=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\+/g,' plus ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const clean=(value,max=240)=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,max);
const present=value=>value!==undefined&&value!==null&&value!==''&&value!==0&&key(value)!=='unknown';
const positive=value=>/^[0-9]+(?:[.,][0-9]+)?$/.test(String(value??''))&&Number(String(value).replace(',','.'))>0?Number(String(value).replace(',','.')):undefined;
export const astraModelId=(make,model)=>sha(`${key(make)}:${key(designation(model))}`).slice(0,24);
export const makeName=value=>({vw:'Volkswagen',mercedesamg:'Mercedes-Benz'}[key(value)]||canonicalCatalogBrand(clean(value,80)));
export function sourceModelName(facts){
 let model=clean(facts.commercialName,160);
 for(const make of [clean(facts.make,80),makeName(facts.make)])if(model.toLowerCase().startsWith(make.toLowerCase()+' ')){model=model.slice(make.length).trim();break;}
 return model;
}
function comparable(field,value){
 const t=key(value);
 if(field==='fuel')return ({gasoline:'petrol',бензин:'petrol',дизель:'diesel',электро:'electric'})[t]||t;
 if(field==='powertrainKind')return ({ice:'combustion',bev:'electric',hev:'otherhybrid',phev:'otherhybrid',erev:'serieshybrid',reev:'serieshybrid'})[t]||t;
 if(field==='drive')return ({'4wd':'awd','4x4':'awd',полный:'awd',передний:'fwd',задний:'rwd'})[t]||t;
 if(field==='transmission')return ({at:'automatic',автомат:'automatic',mt:'manual',механика:'manual',робот:'dct',вариатор:'cvt'})[t]||t;
 return numeric.has(field)?Number(value):t;
}
export function sameAstraValue(field,a,b){
 if(['powerKw','powerHp'].includes(field))return Math.abs(Number(a)-Number(b))<=(field==='powerKw'?0.74:1);
 return comparable(field,a)===comparable(field,b);
}
function validateSource(row){
 if(!row||!sourceDatasets.has(row.sourceDataset)||!row.facts||!/^([a-f0-9]{64})$/.test(row.evidenceId||'')||!/^[a-f0-9]{64}$/.test(row.sourceSha256||''))throw Error('invalid_astra_evidence');
 const url=new URL(row.sourceUrl);
 if(url.protocol!=='https:'||url.hostname!=='opendata.astra.admin.ch'||!url.pathname.startsWith('/ivzod/')||url.username||url.password)throw Error('invalid_astra_source_url');
 if(!clean(row.facts.make)||!clean(row.facts.commercialName))return 'missing_make_or_commercial_name';
 if(/^(?:n\/a|na|none|null|unknown|unbekannt|[-?*]+|0)$/i.test(sourceModelName(row.facts)))return 'unknown_commercial_name';
 if(!row.facts.approval&&!row.facts.approvalCH)return 'missing_approval_identity';
 return null;
}
/** Only decoder-proven categorical values; no power inference from names or peaks. */
export function normalizeAstraValues(row){
 const facts=row.facts,values={};
 for(const field of ASTRA_FIELDS){
  const supplied=row.values?.[field];
  if(numeric.has(field)){
   // The decoder may deliberately withhold conflicting/ambiguous raw numbers.
   // Its omission is authoritative; never restore the number from facts.
   const n=positive(supplied),max=field==='engineCc'||field==='grossVehicleWeightKg'?50000:field==='batteryKwh'?2000:5000;
   if(n!==undefined&&n<=max)values[field]=n;
  }else if(enums[field]?.has(supplied))values[field]=supplied;
 }
 if(clean(row.values?.engineCode,160)&&!/[\u3400-\u9fff]/u.test(String(row.values.engineCode)))values.engineCode=clean(row.values.engineCode,160);
 // Generic TARGA/TAS hybrid net power is not a system or ICE measurement.
 if(facts.powerSemantics&&/unknown|unspecified|hybrid_net/.test(facts.powerSemantics))delete values.powerKw;
 if(row.sourceDataset==='targa')delete values.power30MinKw;
 if(values.power30MinKw&&(row.certified30Min!==true||!['edatenblatt','tas'].includes(row.sourceDataset)||!present(facts.power30MinKw)))delete values.power30MinKw;
 if(values.power30MinKw&&values.motorPeakKw&&values.power30MinKw>values.motorPeakKw)delete values.power30MinKw;
 return values;
}
export function eligibleAstraRow(row){
 const reason=validateSource(row);if(reason)return {eligible:false,reason};
 const make=makeName(row.facts.make),model=sourceModelName(row.facts);
 if(!isEncyclopediaCar({make,model})||/^(?:elf|canter|dutro)(?:\s|$)/i.test(model))return {eligible:false,reason:'excluded_vehicle_family'};
 const category=clean(row.values?.vehicleCategory||row.facts.category).toUpperCase(),body=clean(row.facts.bodyworkCode).toUpperCase();
 if(/^M1G?$/.test(category))return {eligible:true};
 if(/^N1G?$/.test(category)&&['BB','BE'].includes(body)&&positive(row.facts.grossVehicleWeightKg)<=3500)return {eligible:true};
 return {eligible:false,reason:category?'outside_passenger_light_van_pickup_scope':'unknown_vehicle_category'};
}
export function identityOf(row){
 return Object.fromEntries(['approval','approvalCH','type','variant','version'].filter(f=>present(row.facts[f])).map(f=>[f,String(row.facts[f])]));
}
/** Preserve identities and divergent technical versions; manufacturing years never become year. */
export function astraVariant(row,corpusDigest){
 const values=normalizeAstraValues(row),identity=identityOf(row);
 const signature=sha({identity,make:makeName(row.facts.make),model:sourceModelName(row.facts),values});
 const label=[sourceModelName(row.facts),identity.type,identity.variant,identity.version].filter(Boolean).join(' / ');
 return {id:`astra-${signature.slice(0,32)}`,trim:clean(label,160),...values,markets:[],observedCount:0,status:'review',
  sourceUrl:row.sourceUrl,notes:'Данные официального реестра ASTRA. Модельный год в источнике не указан.',
  astraIdentity:identity,astraEvidence:{version:1,corpusDigest,evidenceIds:[row.evidenceId],sourceDataset:row.sourceDataset,sourceSha256:row.sourceSha256,sourceUrl:row.sourceUrl,values,manufactureYears:row.manufactureYears||[],
   ...(row.additionalFactsRef?{additionalFactsRefs:[row.additionalFactsRef]}:{}),...(row.sourceRecordIds?.length?{sourceRecordIds:row.sourceRecordIds}:{})}};
}
/** Display grouping only; none of these abbreviations certifies a specification. */
function sourceGroupingNames(make,name){
 const brand=key(make),names=[];
 if(brand==='mercedesbenz'){
  const spaced=name.replace(/^((?:GL[ABCDEKS]|CL[AS]|EQ[ABCEVS]|[ABCEGSV]))\s*(?=\d{2,3})/i,'$1 ');
  const canonical=canonicalSourceModelIdentity(spaced,make,'');if(canonical)names.push(canonical);
 }
 if(brand==='lexus'){
  const family=name.match(/^(CT|ES|GS|GX|HS|IS|LBX|LC|LM|LS|LX|NX|RC|RX|RZ|SC|UX)\s*(?=\d{3})/i)?.[1];if(family)names.push(family.toUpperCase());
 }
 if(brand==='bmw'){
  const series=name.match(/^(?:M)?([1-8])\d{2}\s*(?:[diteLx]|$)/i)?.[1];if(series)names.push(`${series} Series`);
  if(/^iX(?:\s|$)/i.test(name))names.push('iX');
 }
 if(brand==='audi'){
  const family=name.match(/^(A[468])L(?=\s|\d|$)/i)?.[1];if(family)names.push(family.toUpperCase());
 }
 if(brand==='mazda'&&/^[236]$/.test(name))names.push(`Mazda${name}`);
 if(brand==='mini'){
  const family=name.match(/^(?:(?:3|5)door|Cabrio)\s+(Cooper|One|JCW)\b/i)?.[1];if(family)names.push(({cooper:'Cooper',one:'One',jcw:'Jcw'})[family.toLowerCase()]);
 }
 if(brand==='ds'){
  const family=name.match(/^DS\s*([3479])(?:CRB\.?|Crossback|\s|$)/i)?.[1];if(family)names.push(`DS${family}`);
 }
 let expanded=name;
 if(brand==='skoda')expanded=expanded.replace(/^(Superb|Octavia|Fabia)C(?=\s|\d|\.)/i,'$1 ');
 if(brand==='volkswagen')expanded=expanded.replace(/^PassatV(?=\s|\d|\.)/i,'Passat ');
 if(brand==='peugeot')expanded=expanded.replace(/^ExpertTr\.?\s*/i,'Expert ');
 if(brand==='citroen')expanded=expanded.replace(/^C5\s*Airc\.?\s*/i,'C5 Aircross ');
 if(brand==='landrover')expanded=expanded.replace(/^RR\s*Evoque/i,'Range Rover Evoque ').replace(/^RR\s*Sport/i,'Range Rover Sport ').replace(/^RR(?=\s|\d)/i,'Range Rover ').replace(/^DiscoverySp\.?/i,'Discovery Sport ');
 if(brand==='lamborghini')expanded=expanded.replace(/^\d{3}\s+(Hurac[aàá]n|Urus|Aventador|Gallardo)\b/i,(_,model)=>model.normalize('NFKD').replace(/[\u0300-\u036f]/g,''));
 if(['citroen','peugeot','opel','fiat','renault'].includes(brand))expanded=expanded.replace(/^[eë]-(?=Berlingo|Partner|Rifter|Traveller|C[34]|Jumpy|Doblo|Combo|Master|Scudo|Ducato)/i,'');
 // The decimal displacement is a separate source descriptor, including Swiss
 // labels without a space (Vitara1.4T). No displacement/power value is inferred.
 expanded=expanded.replace(/(?:\s+|(?<=[\p{L}]))\d[.,]\d{1,2}(?=[\p{L}\s]|$).*$/u,'').replace(/\s+(?:HSD|HDi|TDI|CRDI|dCi|D-4D|Hybrid|xDrive|4MOTION|4WD|4x4)(?:\s|$).*$/i,'').trim();
 if(expanded&&expanded!==name)names.push(expanded);
 return [...new Set(names)].filter(n=>n&&designation(n)!==designation(name));
}
/** A suffix is used only when the source explicitly names an existing model prefix. */
export function resolveAstraModel(row,summaries,allowAliases=true){
 const make=makeName(row.facts.make),name=sourceModelName(row.facts),pool=summaries.filter(m=>key(makeName(m.make))===key(make));
 const exact=pool.filter(m=>designation(m.model)===designation(name));
 if(exact.length===1)return {summary:exact[0],sourceSuffix:''};
 if(exact.length>1)return {reason:'ambiguous_existing_model'};
 const prefixes=pool.flatMap(m=>{
  // Only punctuation/spacing variations of a directory name are accepted. The
  // terminal boundary distinguishes A3/A30 and 450h/450h+.
  const characters=clean(m.model).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\s._-]+/g,'').split('');
  if(!characters.length)return [];
  const pattern=characters.map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s._-]*');
  const match=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(new RegExp('^'+pattern+'(?![\\p{L}\\p{N}+])','iu'));
  return match?[{summary:m,length:characters.length,sourceSuffix:name.slice(match[0].length).replace(/^[\s._-]+/,'')}]:[];
 }).sort((a,b)=>b.length-a.length);
 if(prefixes.length&&(!prefixes[1]||prefixes[0].length>prefixes[1].length))return {summary:prefixes[0].summary,sourceSuffix:prefixes[0].sourceSuffix};
 if(prefixes.length>1&&prefixes[0].length===prefixes[1].length)return {reason:'ambiguous_existing_model_prefix'};
 if(allowAliases){
  const aliases=sourceGroupingNames(make,name),matches=aliases.map(alias=>resolveAstraModel({...row,facts:{...row.facts,commercialName:alias}},pool,false));
  const existing=[...new Map(matches.filter(m=>!m.create&&!m.reason).map(m=>[m.summary.id,m.summary])).values()];
  if(existing.length===1)return {summary:existing[0],sourceSuffix:'',groupingAliasOnly:true};
  if(existing.length>1)return {reason:'ambiguous_existing_model_alias'};
  if(aliases.length)return {summary:{id:astraModelId(make,aliases[0]),make,model:aliases[0]},sourceSuffix:'',create:true,groupingAliasOnly:true};
 }
 return {summary:{id:astraModelId(make,name),make,model:name},sourceSuffix:'',create:true};
}
function fullIdentityMatch(v,row){
 const supplied=v.astraIdentity||v.typeApprovalIdentity;
 if(!supplied)return false;
 const fields=supplied.approvalCH?['approvalCH','type',...['approval','variant','version'].filter(f=>present(supplied[f]))]:['approval','type','variant','version'];
 return fields.every(f=>present(supplied[f])&&String(supplied[f])===String(row.facts[f]));
}
function compatible(v,source){
 const values=source.values;
 // Body categories can differ between CoC classification and commercial body names.
 for(const field of ASTRA_FIELDS.filter(f=>!['bodyType','grossVehicleWeightKg','batteryKwh'].includes(f)))if(present(v[field])&&present(values[field])&&!sameAstraValue(field,v[field],values[field]))return false;
 return true;
}
function identityMatch(v,source){
 if(fullIdentityMatch(v,source.row))return {kind:'approval_type_variant_version',strong:true};
 const values=source.values;
 // Exact engine codes can still span power/drive/transmission variants. Require
 // these independently supplied discriminators, then unanimity across the corpus.
 const engine=present(v.engineCode)&&present(values.engineCode)&&key(v.engineCode).length>=3&&/\d/.test(v.engineCode)&&key(v.engineCode)===key(values.engineCode);
 const mechanicalFields=['fuel','powertrainKind','drive','transmission'];
 const targetMechanical=mechanicalFields.every(f=>present(v[f]));
 const mechanical=targetMechanical&&mechanicalFields.every(f=>present(values[f])&&sameAstraValue(f,v[f],values[f]));
 const electric=comparable('powertrainKind',v.powertrainKind)==='electric';
 const targetDisplacement=electric?present(v.powerKw):present(v.engineCc);
 const displacement=electric?present(values.powerKw)&&sameAstraValue('powerKw',v.powerKw,values.powerKw):present(values.engineCc)&&v.engineCc===values.engineCc;
 if(!source.groupingAliasOnly&&engine&&targetMechanical&&targetDisplacement&&(v.markets||[]).includes('europe'))return {kind:'european_engine_and_powertrain_consensus',strong:mechanical&&displacement};
 // An exact official commercial modification name has regional scope. A generic
 // Base/Premium or only matching displacement never proves a modification.
 const official=designation(source.sourceSuffix),trim=designation(v.trim);
 const exactName=official&&(trim===official||trim.startsWith(official+' '))&&/\d/.test(official)&&/[\p{L}]/u.test(official);
 // Named modification matching additionally requires a known comparable power.
 // Equipment suffixes may follow a complete official designation at a boundary.
 // Plausible incomplete source rows remain candidates, and cannot silently be
 // discarded to obtain agreement in the one field being filled.
 const powerField=present(v.icePowerKw)?'icePowerKw':present(v.powerKw)?'powerKw':null;
 const power=powerField&&present(values[powerField])&&sameAstraValue(powerField,v[powerField],values[powerField]);
 if(!source.groupingAliasOnly&&exactName&&targetMechanical&&targetDisplacement&&powerField&&(v.markets||[]).includes('europe'))return {kind:'official_european_modification_consensus',strong:mechanical&&displacement&&power};
 // Ordinary calculation facts are country-independent. Equipment names do
 // not discriminate engines. Retain every compatible candidate (including
 // incompletely documented ones) and require field-level unanimity below.
 const outputField=present(v.icePowerKw)?'icePowerKw':present(v.powerKw)?'powerKw':present(v.powerHp)?'powerHp':null;
 const targetCore=present(v.fuel)&&(targetDisplacement||outputField)&&(present(v.drive)||present(v.bodyType));
 if(targetCore){
  const anchors=['fuel',...(present(v.powertrainKind)?['powertrainKind']:[]),...(targetDisplacement?[electric?'powerKw':'engineCc']:[]),...(outputField?[outputField]:[]),...['drive','bodyType'].filter(f=>present(v[f]))];
  return {kind:'cross_market_mechanical_consensus',strong:anchors.every(f=>present(values[f])&&sameAstraValue(f,v[f],values[f]))};
 }
 return null;
}
function consensus(sources,field){
 if(!sources.length||sources.some(s=>!present(s.values[field])))return undefined;
 const first=sources[0].values[field];
 // Exact equality, not the matching tolerance, is required for a written fact.
 return sources.every(s=>stable(s.values[field])===stable(first))?first:undefined;
}
export function planAstraExistingVariant(record,v,sources,context){
 if(!Number.isInteger(v.year)||!v.trim||v.status==='verified'||v.researchEvidence?.source?.type==='owner_confirmed')return {reason:'manual_or_unknown_year'};
 const priorEvidence=[...(v.researchEvidenceHistory||[]),v.researchEvidence].filter(Boolean);
 const protectedFields=new Set(priorEvidence.flatMap(e=>e.source?.type==='owner_confirmed'?(e.fields||[]):['official_registry','manufacturer'].includes(e.source?.type)?(e.fields||[]).filter(f=>present(v[f])&&stable(v[f])===stable(e.values?.[f])):[]));
 const candidates=sources.map(s=>({...s,match:identityMatch(v,s)})).filter(s=>s.match&&compatible(v,s));
 if(!candidates.some(s=>s.match.strong))return {reason:'no_exact_technical_match'};
 const confirmed={},filled=[],attested=[];
 for(const field of ASTRA_FIELDS){
  if(protectedFields.has(field))continue;
  if(field==='power30MinKw'&&candidates.some(s=>s.match.kind==='cross_market_mechanical_consensus'))continue;
  const value=consensus(candidates,field);if(value===undefined)continue;
  // Matching tolerance never upgrades a different numeric value to official fact.
  if(present(v[field])&&(numeric.has(field)?Number(v[field])!==Number(value):!sameAstraValue(field,v[field],value)))continue;
  if(!present(v[field])){confirmed[field]=value;filled.push(field);}else{confirmed[field]=v[field];attested.push(field);}
 }
 if(!Object.keys(confirmed).length)return {reason:'conflicting_or_incomplete_evidence',candidateCount:candidates.length};
 const batchId=`astra-${context.corpusDigest}`;
 if(v.researchEvidence?.batchId===batchId&&Object.entries(confirmed).every(([f,val])=>stable(v[f])===stable(val)&&stable(v.researchEvidence.values?.[f])===stable(val)))return {reason:'already_supported'};
 const evidenceIds=[...new Set(candidates.map(s=>s.row.evidenceId))].sort();
 const idsDigest=sha(evidenceIds),sourceUrls=[...new Set(candidates.map(s=>s.row.sourceUrl))].sort();
 const source={type:'official_registry',url:sourceUrls[0],checkedAt:context.checkedAt,
  statement:'ASTRA: точное техническое соответствие и единогласие подтверждённых значений во всех подходящих записях. Существующий модельный год сохранён; даты изготовления не преобразованы в модельный год. 30-минутная мощность взята только из отдельного официального поля.',
  ...(confirmed.power30MinKw?{certificationDocument:'ASTRA eCoC 27.4 MaximumContinuousRatedPowerVeh / TAS maximumContinuousRatedPower; exact matched source identities retained in immutable corpus.'}:{}),
  corpusDigest:context.corpusDigest,evidenceIdsDigest:idsDigest,sourceUrls};
 const prior=v.researchEvidence;
 const next={...v,...confirmed,status:'review',...(prior?{researchEvidenceHistory:[...(v.researchEvidenceHistory||[]),prior]}:{}),
  researchEvidence:{batchId,source,fields:Object.keys(confirmed),values:confirmed,originalTrim:v.trim,checkedIdentity:{make:record.make,model:record.model,year:v.year,trim:v.trim},
   ...(v.status==='observed'&&(v.markets||[]).some(m=>m==='china'||m==='europe')?{ownerReferenceSnapshot:{markets:v.markets.filter(m=>m==='china'||m==='europe'),values:Object.fromEntries(ASTRA_FIELDS.filter(f=>f!=='power30MinKw'&&present(v[f])).map(f=>[f,v[f]]))}}:{})},
  astraMatchEvidence:{version:1,corpusDigest:context.corpusDigest,evidenceIdsDigest:idsDigest,evidenceIds,matchKinds:[...new Set(candidates.map(s=>s.match.kind))].sort()}};
 return {variant:next,filled,attested,candidateCount:candidates.length,evidenceIds,assertion:{modelId:record.id,variantId:v.id,year:v.year,trim:v.trim,fields:confirmed,batchId,sourceUrl:source.url}};
}
export function planAstraModel(current,sources,context){
 const changes=[],held={},assertions=[],variants=[];
 const inc=reason=>held[reason]=(held[reason]||0)+1;
 for(const v of current.variants){
  if(v.astraEvidence){variants.push(v);continue;}
  const result=planAstraExistingVariant(current,v,sources,context);
  if(!result.variant){inc(result.reason);variants.push(v);continue;}
  variants.push(result.variant);assertions.push(result.assertion);
  changes.push({variantId:v.id,operation:'fill_or_attest',filled:result.filled,attested:result.attested,candidates:result.candidateCount});
 }
 const existing=new Map(variants.map(v=>[v.id,v])),originalIds=new Set(current.variants.map(v=>v.id));
 for(const source of context.annualOnly?[]:sources){
  const added=astraVariant(source.row,context.corpusDigest),old=existing.get(added.id);
  if(old){
   // User-edited or previously imported source records are never replaced.
   if(!old.astraEvidence||stable(old.astraEvidence.values)!==stable(added.astraEvidence.values))inc('source_variant_preserved_after_edit');
   else if(!originalIds.has(old.id)){
    old.astraEvidence.evidenceIds=[...new Set([...old.astraEvidence.evidenceIds,...added.astraEvidence.evidenceIds])].sort();
    if(added.astraEvidence.additionalFactsRefs)old.astraEvidence.additionalFactsRefs=[...new Map([...(old.astraEvidence.additionalFactsRefs||[]),...added.astraEvidence.additionalFactsRefs].map(ref=>[stable(ref),ref])).values()];
    if(added.astraEvidence.sourceRecordIds)old.astraEvidence.sourceRecordIds=[...new Set([...(old.astraEvidence.sourceRecordIds||[]),...added.astraEvidence.sourceRecordIds])].sort();
   }
   continue;
  }
  variants.push(added);existing.set(added.id,added);changes.push({variantId:added.id,operation:'create_unknown_year',fields:Object.keys(added.astraEvidence.values)});
 }
 if(!changes.length)return {record:current,changes,held,assertions};
 const hash=sha({priorRevision:current.revision||null,corpusDigest:context.corpusDigest,at:context.at,variants});
 const revision=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 return {record:{...current,variants,revision,updatedAt:context.at,editedBy:'owner-authorized-astra-import'},changes,held,assertions};
}
