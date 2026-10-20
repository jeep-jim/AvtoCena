import {matchesCatalogColor} from './catalog-color-index';
import {parseCatalogSort,compareCatalogTerms} from './catalog-sort';
import {matchesFilterSelection} from './filter-selections';
import {catalogBodyType} from './pickup-body';
import { matchesAuctionGrades } from "./auction-grade-filter";
import { matchesCatalogModel } from "./model-filter";
import type { VehicleOffer } from "./types";
import { parseEngineCc } from "./engine-input";
import { matchesFuelFilter } from "./fuel-filter";
import { priceCardForCity } from "./card-city-delivery";
import { savedCalculationPreviewRub } from "./saved-calculation-preview";
import { catalogOfferVisibleRub } from "./public-priority";
export type GreenFilters = Record<string,string|undefined>;
export function greenCornerNeedsFullPricing(params:GreenFilters) {
 // Price predicates and price sorting need exact calculations for all candidates.
 // Ordinary pagination needs only the 24 visible current calculations.
 return Boolean(params.budgetFrom||params.budgetTo||params.budget||parseCatalogSort(params.sort)?.some(term=>term.startsWith('totalRub')));
}
export async function greenCornerPageSelection(items:VehicleOffer[],params:GreenFilters,
 price:(items:VehicleOffer[])=>Promise<VehicleOffer[]>,clampPage=true) {
 const full=greenCornerNeedsFullPricing(params);
 const candidates=full?filterGreenCorner(items,{...params,budgetFrom:undefined,budgetTo:undefined,budget:undefined,sort:undefined}):items;
 const current=full?await price(candidates):items;
 const matched=filterGreenCorner(current,params);
 const requested=Math.max(1,Math.floor(Number(params.page)||1));
 const page=clampPage?Math.min(requested,Math.max(1,Math.ceil(matched.length/24))):requested;
 const visible=matched.slice((page-1)*24,page*24);
 return {items:full?visible:await price(visible),total:matched.length,page,facets:greenCornerFacets(items)};
}
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
  if(!matchesCatalogColor(row,params.color))return false;
  if(params.q&&!lower(`${row.make} ${row.model} ${row.year}`).includes(lower(params.q)))return false;
  if(params.make&&!params.make.split(',').some(make=>lower(make)===lower(row.make)))return false;
  if(params.model&&!matchesCatalogModel(row.model,params.model,row.make))return false;
  if(!range(row.year,number('yearFrom'),number('yearTo'))||!range(row.mileageKm,number('mileageFrom'),number('mileageTo')))return false;
  if(!range(row.engineCc,parseEngineCc(params.engineFrom),parseEngineCc(params.engineTo)))return false;
  if(!range(row.powerHp,number('powerFrom'),number('powerTo')))return false;
  if((number('budgetFrom')||number('budget')||number('budgetTo'))&&!range(greenCornerBudgetPrice(row,params.city),number('budgetFrom'),number('budget')||number('budgetTo')))return false;
  if(!matchesFuelFilter(row.fuel,params.fuel))return false;
  if(!matchesAuctionGrades(row.auctionGrade,params.auctionGrade))return false;
  for(const key of ['transmission','drive','bodyType'] as const)if(!matchesFilterSelection(key==='bodyType'?catalogBodyType(row):row[key],params[key]))return false;
  return true;
 });
 const price=(row:VehicleOffer)=>greenCornerBudgetPrice(row,params.city);
 const terms=parseCatalogSort(params.sort)||[];
 return rows.sort((a,b)=>terms.length?compareCatalogTerms(a,b,terms,row=>price(row)||0)||a.id.localeCompare(b.id):b.year-a.year||a.id.localeCompare(b.id));
}
export function greenCornerFacets(items:VehicleOffer[]) {
 const values=(key:keyof VehicleOffer)=>[...new Set(items.map(row=>String(row[key]??'')).filter(Boolean))];
 return {makes:values('make'),models:items.map(row=>({make:row.make,model:row.model})),markets:['japan'],bodyTypes:values('bodyType'),fuels:values('fuel'),transmissions:values('transmission'),drives:values('drive')};
}
