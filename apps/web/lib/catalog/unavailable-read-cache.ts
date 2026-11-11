import {DetailReadCache} from './detail-read-cache';
import {mergeUnavailableOffers,type UnavailableOffer} from './offer-availability';
/** Share immutable metadata across missing-card requests; recheck retention at lookup time. */
export class UnavailableReadCache {
 private cache=new DetailReadCache<Record<string,UnavailableOffer[]>>({maxEntries:2,maxBytes:64*1024*1024,ttlMs:3600_000,concurrency:1});
 clear(){this.cache.clear();}
 async get(generation:string,id:string,load:()=>Promise<UnavailableOffer[]>,now=Date.now()){
  const index=await this.cache.get(generation,async()=>{
   const result:Record<string,UnavailableOffer[]>=Object.create(null);
   for(const row of await load())if(row.id)(result[row.id]??=[]).push(row);
   return result;
  });
  return mergeUnavailableOffers(index[id]||[],[],new Set(),now)[0]||null;
 }
}
