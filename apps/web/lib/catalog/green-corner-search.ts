import type { VehicleOffer } from "./types";
import { parseEngineCc } from "./engine-input";
import { matchesFuelFilter } from "./fuel-filter";
import { priceCardForCity } from "./card-city-delivery";
import { savedCalculationPreviewRub } from "./saved-calculation-preview";
import { catalogOfferVisibleRub } from "./public-priority";
export type GreenFilters = Record<string,string|undefined>;
// Match the price shown by CatalogPrice, including saved calculations and city delivery.
export function greenCornerBudgetPrice(row:VehicleOffer, city = ""):number|undefined {
 const saved = savedCalculationPreviewRub((row as any).savedCalculationPreview);
 if(saved)return saved;
 const priced = priceCardForCity(row,city).offer;
 const value = Number(priced.japanDeliveredPreview?.totalRub) || catalogOfferVisibleRub(priced);
 return Number.isFinite(value) && value > 0 ? value : undefined;
}
export function filterGreenCorner(items:VehicleOffer[], params:GreenFilters) {
 const lower=(v:unknown)=>String(v??"").trim().toLowerCase();
 const number=(key:string)=>{const n=Number(params[key]);return Number.isFinite(n)&&n>0?n:undefined;};
 const range=(value:number|undefined,from:number|undefined,to:number|undefined)=>!from&&!to || value!=null&&Number.isFinite(value)&&(!from||value>=from)&&(!to||value<=to);
 const rows=items.filter(row=>{
  if(params.q&&!lower(`${row.make} ${row.model} ${row.year}`).includes(lower(params.q)))return false;
  if(params.make&&!params.make.split(',').some(make=>lower(make)===lower(row.make)))return false;
  if(params.model&&!lower(row.model).includes(lower(params.model)))return false;
  if(!range(row.year,number('yearFrom'),number('yearTo'))||!range(row.mileageKm,number('mileageFrom'),number('mileageTo')))return false;
  if(!range(row.engineCc,parseEngineCc(params.engineFrom),parseEngineCc(params.engineTo)))return false;
  if(!range(row.powerHp,number('powerFrom'),number('powerTo')))return false;
  if((number('budgetFrom')||number('budget')||number('budgetTo'))&&!range(greenCornerBudgetPrice(row,params.city),number('budgetFrom'),number('budget')||number('budgetTo')))return false;
  if(!matchesFuelFilter(row.fuel,params.fuel))return false;
  for(const key of ['transmission','drive','bodyType','auctionGrade'] as const)if(params[key]&&lower(row[key])!==lower(params[key]))return false;
  return true;
 });
 const price=(row:VehicleOffer)=>greenCornerBudgetPrice(row,params.city);
 const sortPrice=(a:VehicleOffer,b:VehicleOffer)=>{const x=price(a),y=price(b);return x==null?(y==null?0:1):y==null?-1:params.sort==='totalRubDesc'?y-x:x-y;};
 return rows.sort((a,b)=>params.sort==='totalRub'||params.sort==='totalRubDesc'?sortPrice(a,b):params.sort==='yearAsc'?a.year-b.year:params.sort==='mileage'?(a.mileageKm??Infinity)-(b.mileageKm??Infinity):b.year-a.year||a.id.localeCompare(b.id));
}
export function greenCornerFacets(items:VehicleOffer[]) {
 const values=(key:keyof VehicleOffer)=>[...new Set(items.map(row=>String(row[key]??'')).filter(Boolean))];
 return {makes:values('make'),models:items.map(row=>({make:row.make,model:row.model})),markets:['japan'],bodyTypes:values('bodyType'),fuels:values('fuel'),transmissions:values('transmission'),drives:values('drive')};
}
