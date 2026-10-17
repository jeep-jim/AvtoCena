import 'server-only';
import {createHash} from 'node:crypto';
import {ajesPassword} from './ajes-settings';
import {getJsonStorage} from '../data';
import {assertCollectionEnabled} from './collection-controls';
import {DetailReadCache} from './detail-read-cache';
import {heavyVehicleSqlExclusion} from './heavy-vehicle-families';
import {createAjesClient} from './ajes-client';
import {reserveAjesRequest} from './ajes-quota';

// A cold direct link may need a row already shown by an earlier process. Only
// scan the existing fixed 128-slot cache on a failed full-detail request.
const savedListIndex=new DetailReadCache<Record<string,any>>({maxEntries:1,maxBytes:6*1024*1024,ttlMs:60000,concurrency:1});
async function readListedDetail(table:string,id:string){
 const index=await savedListIndex.get('lists',async()=>{
  const result:Record<string,any>={};
  for(let start=0;start<128;start+=8){
   const slots=await Promise.all(Array.from({length:8},(_,i)=>getJsonStorage().readJson<any>(`catalog/partner-cache/ajes/queries/${start+i}.json`,null).catch(()=>null)));
   for(const slot of slots)for(const lot of slot?.value?.items||[]){
    const key=lot.table+':'+lot.id,at=slot.value.observedAt;
    if(!result[key]||Date.parse(result[key].observedAt)<Date.parse(at))result[key]={schemaVersion:slot.value.schemaVersion,items:[lot],page:1,pageSize:1,observedAt:at,partial:true};
   }
  }
  return result;
 });
 return index[table+':'+id]||null;
}
export const ajesClient=createAjesClient({
  password:ajesPassword,
  readListedDetail,
  saveAggregateEvidence:(kind,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/evidence/${kind}-last.json`,value),
  saveEvidence:(table,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/evidence/${table}-last-detail.json`,value),
  // Fixed-size cache: 128 slots, at most 256 KiB each. Collisions are misses.
  readQuery:async sql=>{
    const read=async(key:string)=>{
      const hash=createHash('sha256').update(key).digest('hex');
      const saved:any=await getJsonStorage().readJson(`catalog/partner-cache/ajes/queries/${parseInt(hash.slice(0,8),16)%128}.json`,null);
      return saved?.hash===hash?saved.value:null;
    };
    const current=await read(sql);if(current)return current;
    // Carry only rows across this selection fix, never an inaccurate old count.
    if(!sql.startsWith('select * from'))return null;
    const previous=sql.replace(heavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(true)).replace("auction_date desc, case when time in ('E','H','HE') then 1 else 0 end asc",'auction_date desc');
    const saved=previous!==sql?await read(previous):null;
    return saved?{...saved,schemaVersion:0}:null;
  },
  saveQuery:async(sql,value)=>{
    const hash=createHash('sha256').update(sql).digest('hex'),saved={hash,value};
    if(Buffer.byteLength(JSON.stringify(saved))<=256*1024)await getJsonStorage().writeJson(`catalog/partner-cache/ajes/queries/${parseInt(hash.slice(0,8),16)%128}.json`,saved);
  },
  assertEnabled:()=>assertCollectionEnabled('ajes_japan_feed'),
  reserve:table=>reserveAjesRequest(getJsonStorage(),table),
  readDetail:(table,id)=>getJsonStorage().readJson(`catalog/partner-cache/ajes/${table}/${id}.json`,null),
  saveDetail:(table,id,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/${table}/${id}.json`,value),
});
