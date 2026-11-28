import type {CalculationIndex} from '../encyclopedia/calculation-index';
import {modelKey} from '../encyclopedia/calculation-index';
import type {CatalogEditorialIndex} from './editorial';
import {ajesText} from './ajes-query';

/** Source candidates only. The unchanged local admission and power/body
 * matchers decide which rows actually belong in the visible selection. */
export type JapanSourceModelCohort={modelKey:string;make:string;model:string;year:number};
export type JapanPowerCandidatePlan={
 powerFrom?:number;powerTo?:number;models:JapanSourceModelCohort[];ids:string[];
 ownerStepwgn:boolean;complete:boolean;unresolved:string[];
};
export type JapanBodyCandidateScope={
 models:JapanSourceModelCohort[];ids:string[];
 sourceBody?:{field:'BODY_TYPE';labels:string[]};pickupCandidates?:boolean;
 complete:boolean;unresolved:string[];
};
export type JapanSourceModel={make:string;model:string};
type ResolvedModel=JapanSourceModel&{years:number[]};
export type AjesSourceSelection={
 version:1;
 power?:{from?:number;to?:number;models:ResolvedModel[];ids:string[];ownerModels:JapanSourceModel[]};
 body?:{models:ResolvedModel[];ids:string[];sourceBody?:{field:'BODY_TYPE';labels:string[]};pickupCandidates:boolean};
};
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const sourceName=(value:unknown):value is string=>typeof value==='string'&&/^[\p{L}\p{N} .+()&/_-]{1,80}$/u.test(value)&&value.trim()===value;
const positive=(value:unknown)=>Number.isFinite(Number(value))&&Number(value)>0;
const powerRange=(from:unknown,to:unknown)=>[from,to].some(value=>value!==undefined)
 &&[from,to].every(value=>value===undefined||Number.isSafeInteger(value)&&Number(value)>=1&&Number(value)<=2500)
 &&(from===undefined||to===undefined||Number(from)<=Number(to));
const unique=<T>(items:T[],key:(value:T)=>string)=>[...new Map(items.map(item=>[key(item),item])).values()];
const orderedStrings=(items:string[])=>[...new Set(items)].sort();

export function buildJapanPowerCandidatePlan(options:{powerFrom?:number;powerTo?:number;index:CalculationIndex|null;editorial:CatalogEditorialIndex}):JapanPowerCandidatePlan {
 const {powerFrom,powerTo}=options;
 if(!powerRange(powerFrom,powerTo))throw Error('ajes_invalid_query');
 const models:JapanSourceModelCohort[]=[],ids:string[]=[],unresolved:string[]=[];
 // UI bounds limit explicit inputs, not otherwise valid source/local values.
 // Missing bounds must remain absent, as in the actual local power matcher.
 const matches=(value:unknown)=>positive(value)&&(powerFrom===undefined||Number(value)>=powerFrom)&&(powerTo===undefined||Number(value)<=powerTo);
 if(options.index){
  if(!record(options.index.models))unresolved.push('power_index_invalid');
  else for(const [key,facts] of Object.entries(options.index.models)){
   // ASTRA supplies certified 30-minute kW, never the discovery horsepower.
   if(key.startsWith('@astra-power30:'))continue;
   if(!Array.isArray(facts)){unresolved.push('power_facts_invalid');continue;}
   for(const fact of facts){
    if(!record(fact)||!record(fact.values)){unresolved.push('power_fact_invalid');continue;}
    if(!matches(fact.values.powerHp))continue;
    if(!/^[^:]+:[^:]+$/u.test(key)||!Number.isInteger(fact.year)||fact.year<2008||fact.year>2100){
     // An annual fact outside the admitted years cannot apply to an AJ row.
     if(Number.isInteger(fact.year)&&(fact.year<2008||fact.year>2100))continue;
     unresolved.push('power_model_identity_invalid');continue;
    }
    models.push({modelKey:key,make:typeof fact.make==='string'?fact.make:'',model:typeof fact.model==='string'?fact.model:'',year:fact.year});
   }
  }
 }
 if(!record(options.editorial?.entries))unresolved.push('power_editorial_invalid');
 else for(const [id,entry] of Object.entries(options.editorial.entries)){
  // Legacy specifications can change make/model/fuel and activate owner or
  // annual evidence without a direct powerHp edit. Actual admission matches
  // the dictionary key and source identity, not the entry's redundant id.
  if(entry?.market!=='japan'||entry.sourceId!=='ajes_japan_feed'||entry.status!=='visible')continue;
  if(!validId(entry.sourceOfferId)||id!==`ajes-stats-${entry.sourceOfferId}`){unresolved.push('power_editorial_identity_invalid');continue;}
  ids.push(entry.sourceOfferId);
 }
 return {powerFrom,powerTo,models:unique(models,row=>JSON.stringify([row.modelKey,row.year])).sort((a,b)=>a.modelKey.localeCompare(b.modelKey)||a.year-b.year),
  ids:orderedStrings(ids),ownerStepwgn:matches(150),complete:unresolved.length===0,unresolved:orderedStrings(unresolved)};
}

/** Resolve canonical evidence against the complete names directory for this
 * source query. The directory parser trims source names; the SQL compiler must
 * therefore retain raw spellings affected by trim/normalization as candidates. */
export function resolveJapanSourceSelection(options:{power?:JapanPowerCandidatePlan;body?:JapanBodyCandidateScope;sourceModels:JapanSourceModel[];directoryComplete:boolean}){
 // An unobserved body branch leaves useful, explicitly incomplete evidence
 // candidates. Alias/identity errors cannot safely produce a restricted query.
 const bodyCoverageWarnings=new Set(['body_source_schema_unobserved','body_encyclopedia_unavailable']);
 const unresolved:string[]=[...(options.power?.unresolved??[]),...(options.body?.unresolved??[])];
 if(options.power&&!options.power.complete)unresolved.push('power_plan_incomplete');
 if(options.body&&!options.body.complete&&(!options.body.unresolved.length||options.body.unresolved.some(reason=>!bodyCoverageWarnings.has(reason))))unresolved.push('body_plan_incomplete');
 const needsDirectory=Boolean(options.power?.models.length||options.power?.ownerStepwgn||options.body?.models.length);
 if(needsDirectory&&!options.directoryComplete)unresolved.push('source_model_directory_incomplete');
 // Directory rows also carry counts. Only source identities enter the typed
 // descriptor; ancillary metadata must not become an SQL field or cursor key.
 const sourceModels=unique(options.sourceModels.map(row=>({make:row?.make,model:row?.model})),row=>JSON.stringify([row.make,row.model]));
 const byKey=new Map<string,JapanSourceModel[]>();
 for(const row of sourceModels){
  if(!row||typeof row.make!=='string'||typeof row.model!=='string'){unresolved.push('source_model_identity_invalid');continue;}
  const key=modelKey(ajesText(row.make),ajesText(row.model)),rows=byKey.get(key)||[];
  rows.push(row);byKey.set(key,rows);
 }
 const resolve=(models:JapanSourceModelCohort[]):ResolvedModel[]=>{
  const groups=new Map<string,ResolvedModel>();
  for(const cohort of models){
   if(!/^[^:]+:[^:]+$/u.test(cohort.modelKey)||!Number.isInteger(cohort.year)||cohort.year<2008||cohort.year>2100){unresolved.push('model_cohort_invalid');continue;}
   for(const row of byKey.get(cohort.modelKey)||[]){
    if(!sourceName(row.make)||!sourceName(row.model)){unresolved.push('source_model_spelling_unsupported');continue;}
    const key=JSON.stringify([row.make,row.model]),group=groups.get(key)||{...row,years:[]};
    group.years.push(cohort.year);groups.set(key,group);
   }
  }
  return [...groups.values()].map(row=>({...row,years:[...new Set(row.years)].sort((a,b)=>a-b)}))
   .sort((a,b)=>a.make.localeCompare(b.make)||a.model.localeCompare(b.model));
 };
 const selection:AjesSourceSelection={version:1};
 if(options.power){
  const ownerModels=options.power.ownerStepwgn?sourceModels.filter(row=>/^honda$/i.test(ajesText(row.make))
   &&/^(?:step\s*w(?:a)?g(?:o)?n|степ\s*вагон|ステップワゴン)(?:$|[\s-])/i.test(ajesText(row.model))):[];
  if(ownerModels.some(row=>!sourceName(row.make)||!sourceName(row.model)))unresolved.push('owner_model_spelling_unsupported');
  selection.power={from:options.power.powerFrom,to:options.power.powerTo,models:resolve(options.power.models),ids:options.power.ids,
   ownerModels:ownerModels.filter(row=>sourceName(row.make)&&sourceName(row.model)).sort((a,b)=>a.make.localeCompare(b.make)||a.model.localeCompare(b.model))};
 }
 if(options.body)selection.body={models:resolve(options.body.models),ids:options.body.ids,
  ...(options.body.sourceBody?{sourceBody:options.body.sourceBody}:{}),pickupCandidates:options.body.pickupCandidates===true};
 if(!options.power&&!options.body)unresolved.push('source_selection_empty');
 const complete=unresolved.length===0;
 const representable=unresolved.every(reason=>bodyCoverageWarnings.has(reason));
 return {selection:representable?selection:null,complete,unresolved:orderedStrings(unresolved)};
}

export {japanSourceSelectionSql} from './japan-source-selection-sql';
