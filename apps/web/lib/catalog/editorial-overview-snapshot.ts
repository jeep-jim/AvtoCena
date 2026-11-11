import {readDataJson} from '../data';
import {DetailReadCache} from './detail-read-cache';
import {editorialRevision} from './editorial';
import {readCatalogOverview,type CatalogOverview} from './overview';
import {datedCatalogPagePath} from './dated-pages';
import {protectCatalogCardPhotos} from './photo-proxy-policy';
import {publicationWithdrawn} from './publication-policy';
import type {PublicVehicleOffer} from './types';

export type EditorialOverviewSnapshot = {
  editorialSnapshotVersion:1;generationId:string;policyDate:string;editorialRevision:string;order:'updatedAt';
  markets:Record<string,{sourceTotal:number;total:number;items:PublicVehicleOffer[]}>;
};
export const editorialOverviewSnapshotPath=(generationId:string)=>
  `catalog/generations/${generationId}/indexes/editorial-overview-v1.json`;
const policyDay=(now:Date)=>new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
/** The raw overview is the rollback-compatible source-count proof. */
export function validEditorialOverviewSnapshot(value:unknown,raw:{generationId:string;markets:Record<string,{sourceTotal?:number;total:number}>},
  revision:string,day:string):value is EditorialOverviewSnapshot {
  const v=value as EditorialOverviewSnapshot|null;
  return !!v&&v.editorialSnapshotVersion===1&&v.order==='updatedAt'&&v.generationId===raw.generationId
    &&v.policyDate===day&&v.editorialRevision===revision&&!!revision&&!!v.markets&&!Array.isArray(v.markets)
    &&Object.entries(v.markets).every(([market,summary])=>{
      const source=raw.markets[market];
      return market!=='japan'&&!!source&&!!summary&&Number.isInteger(summary.sourceTotal)&&summary.sourceTotal>0
        &&summary.sourceTotal===(source.sourceTotal??source.total)&&Number.isInteger(summary.total)
        &&summary.total>=0&&summary.total<=summary.sourceTotal&&Array.isArray(summary.items)
        &&summary.items.length===Math.min(48,summary.total)
        &&summary.items.every(item=>item&&typeof item.id==='string'&&!!item.id.trim()&&item.id===item.id.trim()
          &&item.market===market&&!publicationWithdrawn(item))
        &&new Set(summary.items.map(item=>item.id)).size===summary.items.length;
    });
}
const cache=new DetailReadCache<EditorialOverviewSnapshot>({maxEntries:4,maxBytes:6*1024*1024,ttlMs:60_000,concurrency:2});
export function resetEditorialOverviewSnapshotCache(){cache.clear();}
export async function readEditorialOverviewSnapshot(generationId:string,knownRaw?:CatalogOverview|null){
  const revision=editorialRevision(),day=policyDay(new Date());
  const raw=knownRaw===undefined?await readCatalogOverview(generationId).catch(()=>null):knownRaw;
  if(!raw||raw.generationId!==generationId)return null;
  try{
    const value=await cache.get(JSON.stringify([generationId,day,revision]),async()=>{
      const path=editorialOverviewSnapshotPath(generationId);
      let current=await readDataJson<EditorialOverviewSnapshot|null>(path,null);
      if(current?.policyDate!==day)current=await readDataJson<EditorialOverviewSnapshot|null>(datedCatalogPagePath(path,day),null);
      if(!validEditorialOverviewSnapshot(current,raw,revision,day))throw Error('editorial_overview_unavailable');
      return current;
    });
    if(!validEditorialOverviewSnapshot(value,raw,revision,day))return null;
    return {...value,markets:Object.fromEntries(Object.entries(value.markets).map(([market,summary])=>
      [market,{...summary,items:summary.items.map(protectCatalogCardPhotos)}]))};
  }catch{return null;} // Exact existing moderated search remains authoritative.
}
export function editorialOverviewSnapshotPage(snapshot:EditorialOverviewSnapshot|null,market:string,pageSize:number){
  const summary=snapshot?.markets[market];
  if(!summary||summary.items.length<Math.min(summary.total,pageSize))return null;
  return {total:summary.total,items:summary.items.slice(0,pageSize)};
}
