import {fuelFilterKey,type ModelSummary} from './schema';
import {canonicalCatalogBrand} from '../catalog/brands';
const brandKey=(make:string)=>canonicalCatalogBrand(make).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** Presentation aliases share one heading; source IDs/revisions remain intact. */
export function canonicalDirectoryModels<T extends {make:string}>(models:T[]):T[]{
 const names=new Map<string,string>();
 return models.map(m=>{const key=brandKey(m.make);if(!names.has(key))names.set(key,canonicalCatalogBrand(m.make));return {...m,make:names.get(key)!};});
}
export function filterModels(models:ModelSummary[],p:Record<string,string|undefined>){const q=(p.q||'').toLocaleLowerCase('ru').trim();return models.filter(m=>(!q||`${m.make} ${m.model}`.toLocaleLowerCase('ru').includes(q))&&(!p.make||brandKey(m.make)===brandKey(p.make))&&(!p.fuel||m.fuels.some(f=>fuelFilterKey(f)===fuelFilterKey(p.fuel)))&&(!p.year||m.years.includes(Number(p.year)))&&(!p.missing30||m.needs30>0));}
