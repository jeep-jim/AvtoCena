import {AjesUnavailable} from './ajes-client';
import {matchesCatalogModel} from './model-filter';
import {canonicalCatalogBrand} from './brands';
import type {EncyclopediaIdentityResolver} from './encyclopedia-identity';
import type {AjesResolvedModels} from './ajes-query';
/** Resolve a displayed family only against names actually present in the source directory.
 * Base names include their versions even when the source also has an exact base row. */
export function resolveAjesModelNames(selected:string,models:Array<{model:string}>,make?:unknown):string {
 const names=[...new Set(models.map(x=>x.model.trim()).filter(Boolean))];
 const resolved=selected.split('|').flatMap(value=>{
  const family=names.filter(n=>matchesCatalogModel(n,value,make));
  return family.length?family:[value];
 });
 return [...new Set(resolved)].join('|');
}

type ModelSelection={model?:string;modelFamilies?:string;resolvedModels?:AjesResolvedModels};
function modelSelection(exact:string[],families:string[]):ModelSelection {
 // Directory order/case is not selection identity. Use exactly the source SQL
 // compiler's trim/uppercase rule; preserve internal spaces, hyphens and width.
 exact=[...new Set(exact.map(sourceQueryName))].sort();families=[...new Set(families.map(sourceQueryName))].sort();
 if(exact.length>20||families.length>20)return {resolvedModels:{exact,families}};
 return {...(exact.length?{model:exact.join('|')}:{}),...(families.length?{modelFamilies:families.join('|')}:{})};
}
/** Compact only literal source prefixes; normalized discovery names are not
 * SQL spellings. Keep every uncovered alias exact instead of silently dropping
 * hyphens, attached badges, doubled spaces or full-width source letters.
 */
export function resolveAjesModelSelection(selected:string,models:Array<{model:string}>,make?:unknown,_incomplete=false):ModelSelection {
 const values=selected.split('|').filter(Boolean),names=resolveAjesModelNames(selected,models,make).split('|').filter(Boolean);
 const prefixes=new Set<string>();
 for(const value of values)for(const name of names){
  if(!matchesCatalogModel(name,value,make))continue;
  for(let index=name.indexOf(' ');index>0;index=name.indexOf(' ',index+1)){
   const prefix=name.slice(0,index);
   if(!prefix.endsWith(' ')&&matchesCatalogModel(prefix,value,make)){prefixes.add(prefix);break;}
  }
 }
 const covered=(name:string,prefix:string)=>sourceQueryName(name).startsWith(sourceQueryName(prefix)+' ');
 const candidates=[...prefixes].filter(prefix=>names.filter(name=>covered(name,prefix)).length>1);
 // The typed literal namespace is stable whether the optional directory is
 // fresh, retained or unavailable. A4 always means A4 plus "A4 ..."; a selected
 // variant keeps only its own namespace. Observed nonliteral aliases remain
 // explicit below, so a real alias-scope change still invalidates a cursor.
 // Metadata freshness remains the caller's separate completeness flag.
 candidates.push(...values);
 const families=[...new Set(candidates)].filter((prefix,_index,all)=>!all.some(other=>other!==prefix&&covered(prefix,other)));
 const exact=[...new Set([...names,...values])].filter(name=>!families.some(prefix=>covered(name,prefix)));
 return modelSelection(exact,families);
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
async function legacyMazdaSelection(selected:string,models:Array<{model:string}>,make:string,readIdentity:IdentityReader,directoryStale=false):Promise<{selected:string;unavailable:boolean}>{
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
  const targets=selected.split('|').flatMap(value=>{
   if(!legacy(value))return [value];
   const candidates=[...new Set([value,canonical.canonicalName,...spellings])];
   const families=candidates.filter(target=>models.some(row=>matchesCatalogModel(row.model,target,make)));
   // The shared compiler derives literal SQL prefixes from these observed
   // matches, including source spacing/full-width spelling. A canonical alias
   // itself is never emitted as a replacement source or technical identity.
   return families.length?families:[value];
  });
  return {selected:[...new Set(targets)].join('|'),unavailable:directoryStale};
 }catch{return {selected,unavailable:true};}
}

/** A names directory is optional for an exact typed list request. Never hide
 * programming errors or source-switch failures, and never infer a zero count. */
export async function resolveAjesQueryModels<T extends {table?:string;model?:string;make?:string;modelFamilies?:string;resolvedModels?:AjesResolvedModels}>(query:T,read:()=>Promise<{models:Array<{model:string}>;stale?:boolean}>,readIdentity:IdentityReader=readModelIdentity){
 if(!query.model)return {query,modelDirectoryUnavailable:false};
 if(!query.make)return {query:{...query,modelFamilies:query.model},modelDirectoryUnavailable:false};
 try{
  const directory=await read();
  const legacy=await legacyMazdaSelection(query.model,directory.models,query.make,readIdentity,directory.stale===true);
  const incomplete=Boolean(directory.stale||legacy.unavailable);
  const selection=resolveAjesModelSelection(legacy.selected,directory.models,query.make,incomplete);
  const next={...query};delete next.model;delete next.modelFamilies;delete next.resolvedModels;Object.assign(next,selection);
  return {query:next,modelDirectoryUnavailable:incomplete};
 }catch(error){
  const recoverable=error instanceof AjesUnavailable&&(/^(?:http_(?:429|5\d\d)|local_busy|visitor_restricted|request_timeout|connect_timeout|request_failed|quota_exhausted|quota_busy|invalid_response|empty_response|response_too_large|query_too_large|directory_too_large|directory_page_repeated)$/.test(error.reason))
   ||error instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(error.message);
  if(!recoverable)throw error;
  const next={...query};delete next.model;delete next.modelFamilies;delete next.resolvedModels;
  Object.assign(next,resolveAjesModelSelection(query.model,[],query.make,true));
  return {query:next,modelDirectoryUnavailable:true};
 }
}

