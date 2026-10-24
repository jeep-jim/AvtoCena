import {fuelFilterKey,type ModelSummary} from './schema';
import {canonicalCatalogBrand,catalogBrandPresentation,isCatalogBrandPlaceholder} from '../catalog/brands';
const brandKey=(make:string)=>catalogBrandPresentation(make).name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** Presentation aliases share one heading; source IDs/revisions remain intact. */
export function canonicalDirectoryModels<T extends {make:string}>(models:T[]):T[]{
 const names=new Map<string,string>();
 return models.filter(m=>!isCatalogBrandPlaceholder(m.make)).map(m=>{
  const presentation=catalogBrandPresentation(m.make),key=brandKey(m.make);
  if(!names.has(key))names.set(key,presentation.name);
  // Keep conversion visible and records individually editable; no technical merge.
  const model=(m as any).model;
  return {...m,make:names.get(key)!,...(presentation.conversion&&model?{model:`${model} (${presentation.conversion})`}:{})};
 });
}
export function filterModels(models:ModelSummary[],p:Record<string,string|undefined>){const q=(p.q||'').toLocaleLowerCase('ru').trim();return models.filter(m=>(!q||`${m.make} ${m.model}`.toLocaleLowerCase('ru').includes(q))&&(!p.make||brandKey(m.make)===brandKey(p.make))&&(!p.fuel||m.fuels.some(f=>fuelFilterKey(f)===fuelFilterKey(p.fuel)))&&(!p.year||m.years.includes(Number(p.year)))&&(!p.missing30||m.needs30>0));}
