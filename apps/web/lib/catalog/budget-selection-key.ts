import type {CatalogSearchParams} from './types';
/** Membership without a budget is independent of delivery city. Card prices
 * and sort order still use city downstream; budget membership never shares it. */
export function budgetSelectionFilterKey(params:CatalogSearchParams){
 const {page:_page,pageSize:_pageSize,sort:_sort,city,...filters}=params;
 const query=params.budgetFrom||params.budgetTo?{...filters,city}:filters;
 return Object.entries(query).filter(([,v])=>v!==undefined&&v!=='').sort(([a],[b])=>a.localeCompare(b));
}
