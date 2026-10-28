import {readCalculationIndex} from '../encyclopedia/calculation-index';
import 'server-only';
import {ajesEndpoint} from './ajes-routing';
import {readAjesQueryCache,readPreviousTruckPolicyRows,readExpandedJapanRows,readUncappedChinaRows,saveAjesQueryCache,retainedAjesQueryEntries} from './ajes-query-cache';
import {ajesPassword} from './ajes-settings';
import {getJsonStorage} from '../data';
import {assertCollectionEnabled} from './collection-controls';
import {DetailReadCache} from './detail-read-cache';
import {heavyVehicleSqlExclusion} from './heavy-vehicle-families';
import {createAjesClient} from './ajes-client';
import {findSavedAjesSearch,findSavedAjesStockSearch,savedAjesFacets} from './ajes-saved-search';
import {reserveAjesRequest} from './ajes-quota';

// A cold direct link may need a row already shown by an earlier process. Only
// scan the existing fixed 128-slot cache on failed detail or exact-identity search.
const savedListIndex=new DetailReadCache<Record<string,any>>({maxEntries:1,maxBytes:6*1024*1024,ttlMs:60000,concurrency:1});
async function readSavedListIndex(){
 return savedListIndex.get('lists',async()=>{
  const result:Record<string,any>={};
  for(let start=0;start<128;start+=8){
   const slots=await Promise.all(Array.from({length:8},(_,i)=>getJsonStorage().readJson<any>(`catalog/partner-cache/ajes/queries/${start+i}.json`,null).catch(()=>null)));
   for(const slot of slots)for(const {value} of retainedAjesQueryEntries(slot))for(const lot of value?.items||[]){
    const key=lot.table+':'+lot.id,at=value.observedAt;
    if(!result[key]||Date.parse(result[key].observedAt)<Date.parse(at))result[key]={schemaVersion:value.schemaVersion,items:[lot],page:1,pageSize:1,observedAt:at,partial:true};
   }
  }
  return result;
 });
}
export async function readSavedAjesFacets(){await assertCollectionEnabled('ajes_japan_feed');return savedAjesFacets(await readSavedListIndex());}
async function readListedDetail(table:string,id:string){
 const index=await readSavedListIndex();
 return index[table+':'+id]||null;
}
export const ajesClient=createAjesClient({
 calculationIndex:readCalculationIndex,
 saveRequestFailure:value=>getJsonStorage().writeJson(`integrations/ajes/catalog-failure-${value.table}.json`,value),
  password:ajesPassword,
  endpoint:ajesEndpoint,
  readListedDetail,
  readSavedSearch:async input=>input.table==='china'||input.table==='korea'?(input.make&&input.model?findSavedAjesStockSearch(input,await readSavedListIndex()):null):findSavedAjesSearch(input,await readSavedListIndex(),Date.now(),readCalculationIndex()),
  saveAggregateEvidence:(kind,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/evidence/${kind}-last.json`,value),
  saveEvidence:(table,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/evidence/${table}-last-detail.json`,value),
  // Bounded list and count pools; exact hashes prevent unrelated cache hits.
  readQuery:sql=>readAjesQueryCache(getJsonStorage(),sql),
  readLegacyQuery:async sql=>{
    const read=(key:string)=>readAjesQueryCache(getJsonStorage(),key);
    // Carry only rows across this selection fix, never an inaccurate old count.
    if(!sql.startsWith('select * from'))return null;
    const priorTrucks=await readPreviousTruckPolicyRows(sql,read);if(priorTrucks)return priorTrucks;
    const china=await readUncappedChinaRows(sql,read);if(china)return china;
    const previous=sql.replace(heavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(true)).replace("auction_date desc, case when time in ('E','H','HE') then 1 else 0 end asc",'auction_date desc');
    let saved=previous!==sql?await read(previous):null;
    // Older lists remain useful as partial results when broadening Japan to 2008.
    // Never carry their narrower count/model aggregates into the expanded query.
    if(!saved)saved=await readExpandedJapanRows(sql,previous,read);
    return saved?{...saved,schemaVersion:0}:null;
  },
  saveQuery:(sql,value)=>saveAjesQueryCache(getJsonStorage(),sql,value),
  assertEnabled:table=>assertCollectionEnabled(`ajes_${table==='china'||table==='korea'?table:'japan'}_feed`),
  reserve:table=>reserveAjesRequest(getJsonStorage(),table),
  readDetail:(table,id)=>getJsonStorage().readJson(`catalog/partner-cache/ajes/${table}/${id}.json`,null),
  saveDetail:(table,id,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/${table}/${id}.json`,value),
});
