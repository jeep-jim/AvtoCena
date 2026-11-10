import {randomUUID} from 'node:crypto';
import {DetailReadCache} from './detail-read-cache';

/** Secondary work has one fixed process-wide admission budget. No results or
 * pending calls are shared between visitors: inner readers retain their own
 * source/IP/price cache contracts. Never hold a slot around nested scheduled work.
 */
export function createRelatedOffersScheduler() {
  const queue = new DetailReadCache<unknown>({
    name:'catalog_related_operations',maxEntries:1,maxBytes:1,ttlMs:0,concurrency:2,maxQueued:16,queueTimeoutMs:5_000,
    shouldCache:()=>false,
  });
  return <T>(load:()=>Promise<T>):Promise<T> => {
    const key=randomUUID();
    return queue.get(key,load,key) as Promise<T>;
  };
}

export const runRelatedOfferOperation=createRelatedOffersScheduler();
