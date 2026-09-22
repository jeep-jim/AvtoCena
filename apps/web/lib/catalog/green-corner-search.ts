import type { VehicleOffer } from "./types";
import { parseEngineCc } from "./engine-input";
import { matchesFuelFilter } from "./fuel-filter";
export type GreenFilters = Record<string,string|undefined>;
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
  // The stock price control explicitly uses FOB; never treat it as a delivered budget.
  if(!range(row.sellerPriceRub,number('fobFrom'),number('fobTo')))return false;
  if((number('budgetFrom')||number('budget')||number('budgetTo'))&&!range(row.totalRub??undefined,number('budgetFrom'),number('budget')||number('budgetTo')))return false;
  if(!matchesFuelFilter(row.fuel,params.fuel))return false;
  for(const key of ['transmission','drive','bodyType','auctionGrade'] as const)if(params[key]&&lower(row[key])!==lower(params[key]))return false;
  return true;
 });
 const price=(row:VehicleOffer)=>row.sellerPriceRub??Infinity;
 return rows.sort((a,b)=>params.sort==='totalRub'?price(a)-price(b):params.sort==='totalRubDesc'?price(b)-price(a):params.sort==='yearAsc'?a.year-b.year:params.sort==='mileage'?(a.mileageKm??Infinity)-(b.mileageKm??Infinity):b.year-a.year||a.id.localeCompare(b.id));
}
export function greenCornerFacets(items:VehicleOffer[]) {
 const values=(key:keyof VehicleOffer)=>[...new Set(items.map(row=>String(row[key]??'')).filter(Boolean))];
 return {makes:values('make'),models:items.map(row=>({make:row.make,model:row.model})),markets:['japan'],bodyTypes:values('bodyType'),fuels:values('fuel'),transmissions:values('transmission'),drives:values('drive')};
}
