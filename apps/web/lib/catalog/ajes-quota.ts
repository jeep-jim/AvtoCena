import {StorageConflictError,type JsonStorage} from '../data';
import {AjesUnavailable} from './ajes-client';
export type AjesUsageTable='main'|'stats'|'china'|'korea';

/** Owner instruction 17.10.2026: retain usage accounting, remove the local daily cutoff.
 * This does not grant extra supplier quota or bypass supplier refusals/rate limits. */
export async function reserveAjesRequest(storage:JsonStorage,table:AjesUsageTable,now=Date.now()) {
  const hour=Math.floor(now/3600000),key=`catalog/operations/ajes-quota-${table}.json`;
  for(let attempt=0;attempt<8;attempt++) {
    const meta=await storage.readJsonWithMeta<{buckets:Record<string,number>}|null>(key,null);
    if(meta.found&&(!meta.etag||!meta.value?.buckets||typeof meta.value.buckets!=='object'||Array.isArray(meta.value.buckets)))throw new AjesUnavailable('quota_invalid');
    const buckets:Record<string,number>={};
    for(const [h,count] of Object.entries(meta.value?.buckets??{})) {
      if(!/^\d+$/.test(h)||!Number.isSafeInteger(count)||count<0||Number(h)>hour)throw new AjesUnavailable('quota_invalid');
      if(Number(h)>=hour-24)buckets[h]=count;
    }
    buckets[hour]=(buckets[hour]??0)+1;
    try {await storage.writeJson(key,{buckets},meta.found?{ifMatch:meta.etag!}:{ifNoneMatch:'*'});return;}
    catch(error){if(!(error instanceof StorageConflictError))throw error;}
  }
  throw new AjesUnavailable('quota_busy');
}
