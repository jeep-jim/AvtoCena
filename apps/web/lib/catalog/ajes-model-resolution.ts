import {AjesUnavailable} from './ajes-client';
import {matchesCatalogModel} from './model-filter';
import {modelSearchName} from './model-search-name';
import {canonicalCatalogBrand} from './brands';
import type {EncyclopediaIdentityResolver} from './encyclopedia-identity';
/** Resolve a displayed family only against names actually present in the source directory.
 * Base names include their versions even when the source also has an exact base row. */
export function resolveAjesModelNames(selected:string,models:Array<{model:string}>,make?:unknown):string {
 const names=[...new Set(models.map(x=>x.model.trim()).filter(Boolean))];
 const key=(s:string)=>modelSearchName(make,s).normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
 const resolved=selected.split('|').flatMap(value=>{
  const target=key(value),exact=names.find(n=>key(n)===target);
  const family=names.filter(n=>matchesCatalogModel(n,value,make));
  return family.length?family:[value];
 });
 const unique=[...new Set(resolved)];
 // Keep the existing bounded SQL selection contract.
 return unique.length<=20?unique.join('|'):selected;
}

/** Large source families use a bounded prefix condition instead of dropping their members. */
export function resolveAjesModelSelection(selected:string,models:Array<{model:string}>,make?:unknown):{model?:string;modelFamilies?:string}{
 const expanded=resolveAjesModelNames(selected,models,make);
 if(expanded!==selected)return {model:expanded};
 const names=[...new Set(models.map(x=>x.model.trim()).filter(Boolean))];
 const key=(s:string)=>modelSearchName(make,s).normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
 const exact:string[]=[],families:string[]=[];
 for(const value of selected.split('|')){
  const target=key(value),match=names.find(n=>key(n)===target);
  if(match)exact.push(match);
  if(names.some(n=>key(n).startsWith(target+' ')))families.push(target);
  else if(!match)exact.push(value);
 }
 return {...(exact.length?{model:[...new Set(exact)].join('|')}:{}),...(families.length?{modelFamilies:[...new Set(families)].join('|')}:{})};
}

type IdentityReader=()=>Promise<EncyclopediaIdentityResolver|null>;
const sourceQueryName=(value:string)=>value.trim().toUpperCase();
const readModelIdentity:IdentityReader=async()=>{
 const {readEncyclopediaIdentityResolver}=await import('./encyclopedia-identity-data');
 return readEncyclopediaIdentityResolver();
};

/** The historical Mazda/3 URL uses V2's reviewed safe source spelling. Resolve
 * it only for Japan discovery, then keep names that actually exist in AJ.
 * This never changes a listing's model or extends the technical identity map.
 */
async function legacyMazdaSelection(selected:string,models:Array<{model:string}>,make:string,readIdentity:IdentityReader,directoryStale=false):Promise<{selected:string;unavailable:boolean;requiredNames?:string[]}>{
 const legacy=(value:string)=>value.normalize('NFKC').trim()==='3';
 if(canonicalCatalogBrand(make)!=='Mazda'||!selected.split('|').some(legacy))
  return {selected,unavailable:false};
 if(!models.length)return {selected,unavailable:directoryStale};
 try{
  const resolver=await readIdentity(),brand=resolver?.resolveBrand('Mazda');
  const canonical=brand&&resolver?.resolveModel(brand.brand.id,'3')?.model;
  if(!resolver||!brand||!canonical||canonical.brandId!==brand.brand.id||canonical.canonicalName!=='MAZDA3'
   ||resolver.resolveModel(brand.brand.id,canonical.canonicalName)?.model.id!==canonical.id)return {selected,unavailable:true};
  const key=(value:string)=>value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
  const spellings=(canonical.sourceNames||[]).flatMap(alias=>typeof alias!=='string'&&alias.safe===true
   &&key(alias.value).replace(/ /g,'')===canonical.canonicalName
   &&resolver.resolveModel(brand.brand.id,alias.value)?.model.id===canonical.id?[alias.value]:[]);
  const prefix=(name:string,target:string)=>sourceQueryName(name)===sourceQueryName(target)||sourceQueryName(name).startsWith(sourceQueryName(target)+' ');
  const requiredNames=new Set<string>();
  const targets=selected.split('|').flatMap(value=>{
   if(!legacy(value))return [value];
   const candidates=[...new Set([value,canonical.canonicalName,...spellings])];
   const families=candidates.filter(target=>models.some(row=>prefix(row.model,target)));
   const matches=models.filter(row=>candidates.some(target=>matchesCatalogModel(row.model,target,make)));
   for(const row of matches)requiredNames.add(row.model);
   // Retain spaced source roots for the >20-name prefix path and preserve any
   // attached source badge as an exact name, without widening those prefixes.
   const exact=matches.filter(row=>!families.some(target=>prefix(row.model,target))).map(row=>row.model);
   return families.length||exact.length?[...families,...exact]:[value];
  });
  return {selected:[...new Set(targets)].join('|'),unavailable:directoryStale,requiredNames:[...requiredNames]};
 }catch{return {selected,unavailable:true};}
}

/** A names directory is optional for an exact typed list request. Never hide
 * programming errors or source-switch failures, and never infer a zero count. */
export async function resolveAjesQueryModels<T extends {table?:string;model?:string;make?:string;modelFamilies?:string}>(query:T,read:()=>Promise<{models:Array<{model:string}>;stale?:boolean}>,readIdentity:IdentityReader=readModelIdentity){
 if(!query.model)return {query,modelDirectoryUnavailable:false};
 if(!query.make)return {query:{...query,modelFamilies:query.model},modelDirectoryUnavailable:false};
 try{
  const directory=await read();
  const legacy=await legacyMazdaSelection(query.model,directory.models,query.make,readIdentity,directory.stale===true);
  const selection=resolveAjesModelSelection(legacy.selected,directory.models,query.make);
  const exact=selection.model?.split('|')||[],families=selection.modelFamilies?.split('|')||[];
  // Discovery normalization is broader than literal SQL. Keep every observed
  // legacy family spelling exact unless the emitted =/LIKE truly covers it.
  const uncovered=(legacy.requiredNames||[]).filter(model=>!exact.some(value=>sourceQueryName(value)===sourceQueryName(model))
   &&!families.some(value=>sourceQueryName(model).startsWith(sourceQueryName(value)+' ')));
  if(uncovered.length)selection.model=[...new Set([...exact,...uncovered])].join('|');
  if(legacy.requiredNames&&[selection.model,selection.modelFamilies].some(value=>value&&value.split('|').length>20))
   return {query,modelDirectoryUnavailable:true};
  const next={...query};delete next.model;Object.assign(next,selection);
  return {query:next,modelDirectoryUnavailable:legacy.unavailable};
 }catch(error){
  const recoverable=error instanceof AjesUnavailable&&(/^(?:http_(?:429|5\d\d)|local_busy|visitor_restricted|request_timeout|connect_timeout|request_failed|quota_exhausted|quota_busy|invalid_response|empty_response|response_too_large|query_too_large|directory_too_large|directory_page_repeated)$/.test(error.reason))
   ||error instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(error.message);
  if(!recoverable)throw error;
  return {query,modelDirectoryUnavailable:true};
 }
}
