import {readEditorialOverviewSnapshot,editorialOverviewSnapshotPage} from './editorial-overview-snapshot';
import {readCatalogOverview,type CatalogOverview} from './overview';
import {withCatalogEditorial,editorialHasHidden,editorialHidden,applyCatalogEditorial} from './editorial';
import {searchOffers} from './storage';

/** Overlay current moderation on immutable feed showcases before rendering. */
export async function applyEditorialOverview(overview:CatalogOverview|null){
 if(!overview)return null;
 return withCatalogEditorial(async()=>{
  const prepared=editorialHasHidden()?await readEditorialOverviewSnapshot(overview.generationId,overview):null;
  const markets=Object.fromEntries(await Promise.all(Object.entries(overview.markets).map(async([market,snapshot])=>{
   if(editorialHasHidden(market)){
    // Refill the rail and calculate its count after exclusion, before pagination.
    const pageSize=Math.max(6,Math.min(48,snapshot.items.length));
    const current=editorialOverviewSnapshotPage(prepared,market,pageSize)||await searchOffers({market,page:1,pageSize,sort:'updatedAt'});
    return [market,{...snapshot,total:current.total,items:current.items.filter(row=>!editorialHidden(row)).map(row=>applyCatalogEditorial(row))}];
   }
   return [market,{...snapshot,items:snapshot.items.filter(row=>!editorialHidden(row)).map(row=>applyCatalogEditorial(row))}];
  })));
  return {...overview,markets} as CatalogOverview;
 });
}
export async function readPublicCatalogOverview(){return applyEditorialOverview(await readCatalogOverview());}
