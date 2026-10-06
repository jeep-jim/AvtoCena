import {catalogPowerBand} from './power-mix';
export const CATALOG_PREFERRED_PRICE_RUB=15_000_000;
export function catalogDisplayPrice(row:any){
 return [row.japanDeliveredPreview?.totalRub,row.totalRub,row.publicVisibleRub,row.sellerPriceRub,row.calculationSnapshot?.sourcePriceRub].map(Number).find(x=>Number.isFinite(x)&&x>0)||0;
}
export function catalogDisplayGroup(row:any){const price=catalogDisplayPrice(row);return price>CATALOG_PREFERRED_PRICE_RUB?2:price>0?0:1;}
/** Ranking only. Missing totals never masquerade as an affordable delivered quote. */
export function compareCatalogDisplayOrder(a:any,b:any){
 const group=catalogDisplayGroup(a)-catalogDisplayGroup(b);if(group)return group;
 if(catalogDisplayGroup(a)===2)return catalogDisplayPrice(a)-catalogDisplayPrice(b);
 return Number(catalogPowerBand(b)==='low')-Number(catalogPowerBand(a)==='low');
}
