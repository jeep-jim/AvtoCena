import {AjesUnavailable} from './ajes-client';
import {matchesCatalogModel} from './model-filter';
import {modelSearchName} from './model-search-name';
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

/** A names directory is optional for an exact typed list request. Never hide
 * programming errors or source-switch failures, and never infer a zero count. */
export async function resolveAjesQueryModels<T extends {table?:string;model?:string;make?:string;modelFamilies?:string}>(query:T,read:()=>Promise<{models:Array<{model:string}>}>){
 if(!query.model)return {query,modelDirectoryUnavailable:false};
 if(!query.make)return {query:{...query,modelFamilies:query.model},modelDirectoryUnavailable:false};
 try{
  const directory=await read();
  // Hyundai Annual Report 2012, Product Lineup: TUCSON ix (ix35).
  // https://www.hyundai.com/content/dam/hyundai/ww/en/images/about-hyundai/ir/financial-statements/annual-report/hw073495.pdf
  // Only the Korean directory's actual Tucson ix rows qualify, never later
  // Tucson generations or Chinese ix35 variants; admission years stay unchanged.
  const selected=query.table==='korea'&&/^hyundai$/i.test(query.make)&&directory.models.some(row=>matchesCatalogModel(row.model,'TUCSON IX','HYUNDAI'))
   ?query.model.split('|').map(name=>/^ix[\s-]*35$/i.test(name.trim())?'TUCSON IX':name).join('|'):query.model;
  const selection=resolveAjesModelSelection(selected,directory.models,query.make);
  const next={...query};delete next.model;Object.assign(next,selection);
  return {query:next,modelDirectoryUnavailable:false};
 }catch(error){
  const recoverable=error instanceof AjesUnavailable&&['local_busy','visitor_restricted','request_timeout','connect_timeout','request_failed','invalid_response','directory_too_large','directory_page_repeated'].includes(error.reason)
   ||error instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(error.message);
  if(!recoverable)throw error;
  return {query,modelDirectoryUnavailable:true};
 }
}
