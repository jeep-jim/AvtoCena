import {getJsonStorage} from '../../apps/web/lib/data';
import {ajesQuery} from '../../apps/web/lib/catalog/ajes-query';
import {readAjesQueryCache,retainedAjesQueryEntries} from '../../apps/web/lib/catalog/ajes-query-cache';

// Saved objects only. Never import the supplier client or print identifiers,
// addresses, SQL, credentials, response bodies, or configuration values.
async function main(){
 const storage=getJsonStorage(),ids=new Set<string>();
 let snapshots=0,readErrors=0;const dates:string[]=[];
 for(let start=0;start<128;start+=4){
  const slots=await Promise.all(Array.from({length:4},(_,i)=>storage.readJson(`catalog/partner-cache/ajes/queries/${start+i}.json`,null).catch(()=>{readErrors++;return null;})));
  for(const slot of slots)for(const {value} of retainedAjesQueryEntries(slot)){
   const rows=Array.isArray(value.items)?value.items.filter((r:any)=>r?.table==='korea'&&typeof r.id==='string'):[];
   if(!rows.length)continue;snapshots++;for(const r of rows)ids.add(r.id);
   if(Number.isFinite(Date.parse(value.observedAt)))dates.push(new Date(value.observedAt).toISOString());
  }
 }
 console.log('KOREA_SAVED_INVENTORY',JSON.stringify({slotsRead:128,readErrors,snapshots,uniqueSavedIds:ids.size,oldest:dates.sort()[0]??null,newest:dates.at(-1)??null}));
 for(const make of [undefined,'BMW'])for(const aggregate of ['count',undefined] as const){
  const q=ajesQuery({table:'korea',make,aggregate});
  const v:any=await readAjesQueryCache(storage,q.sql);
  console.log('KOREA_EXACT_CACHE',JSON.stringify({make:make??'all',kind:aggregate??'list',found:!!v,total:v?.total??null,items:v?.items?.length??null,observedAt:v?.observedAt??null}));
 }
 for(const kind of ['list-1','list-2','list-3','list-4','list-5','list-6','count','makes','models','detail']){
  const v:any=await storage.readJson(`integrations/ajes/catalog-failure-pages/korea-${kind}.json`,null);
  if(!v){console.log('KOREA_FAILURE',{kind,present:false});continue;}
  const allowed=/^(visitor_restricted|request_failed|request_timeout|connect_timeout|invalid_response|empty_response|response_too_large|identity_mismatch|query_too_large|http_\d{3})$/;
  console.log('KOREA_FAILURE',JSON.stringify({kind,present:true,startedAt:v.startedAt,finishedAt:v.finishedAt,outcome:allowed.test(v.outcome)?v.outcome:'other',httpStatus:v.httpStatus,providerCode:/^(bot|ban)\d{0,12}$/.test(v.providerCode)?v.providerCode:null,endpoint:v.endpoint==='http://87.242.72.57/api/'?'ru':v.endpoint==='http://78.46.90.228/api/'?'global':'other'}));
 }
}
main().catch(()=>{console.log('KOREA_INVENTORY_READ_FAILED');process.exitCode=1;});
