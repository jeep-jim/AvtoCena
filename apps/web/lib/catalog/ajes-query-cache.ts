import {createHash} from 'node:crypto';
import {heavyVehicleSqlExclusion} from './heavy-vehicle-families';
import {ajesQuery} from './ajes-query';

type Store={readJson:(key:string,fallback:null)=>Promise<any>;writeJson:(key:string,value:any)=>Promise<unknown>};
const root='catalog/partner-cache/ajes/queries';
const maxBucketBytes=256*1024;
type QueryEntry={hash:string;value:any};
const writesByStorage=new WeakMap<Store,Map<string,Promise<void>>>();
/** Keep the current response readable by older releases and at most three
 * previously requested responses. This is not an inventory crawl or index. */
export function retainedAjesQueryEntries(saved:any):QueryEntry[]{
 return [saved,...(Array.isArray(saved?.previous)?saved.previous.slice(0,3):[])]
  .filter((entry):entry is QueryEntry=>typeof entry?.hash==='string'&&/^[a-f0-9]{64}$/.test(entry.hash)&&entry.value&&typeof entry.value==='object')
  .map(({hash,value})=>({hash,value}));
}
const overallCount=ajesQuery({aggregate:'count'}).sql,overallMakes=ajesQuery({aggregate:'makes'}).sql;
/** Keep counters out of the list collision pool; always verify the complete SQL hash. */
export function ajesQueryCacheLocation(sql:string){
 const hash=createHash('sha256').update(sql).digest('hex'),slot=parseInt(hash.slice(0,8),16)%128;
 const legacy=`${root}/${slot}.json`;
 const key=sql.startsWith('select count(*) from')
  ?`${root}/counts/${sql===overallCount?'overall':slot}.json`
  :sql.startsWith('select marka_name,')?`${root}/directories/${sql===overallMakes?'makes-overall':(sql.includes('model_name, count(*)')?'models':'makes')+'-'+slot}.json`:legacy;
 return {hash,key,legacy};
}
export async function readAjesQueryCache(storage:Store,sql:string){
 const {hash,key,legacy}=ajesQueryCacheLocation(sql);
 for(const location of key===legacy?[key]:[key,legacy]){
  const saved=await storage.readJson(location,null);
  const entry=retainedAjesQueryEntries(saved).find(entry=>entry.hash===hash);
  if(entry)return entry.value;
 }
 return null;
}
export async function saveAjesQueryCache(storage:Store,sql:string,value:unknown){
 const {hash,key}=ajesQueryCacheLocation(sql),saved={hash,value};
 if(Buffer.byteLength(JSON.stringify(saved))>maxBucketBytes)return;
 if(!sql.startsWith('select * from')){await storage.writeJson(key,saved);return;}
 // The 128 fixed slots and 256 KiB per-object ceiling remain unchanged.
 // Serialize only writes to the same slot in this process, so simultaneous
 // viewed pages cannot erase one another during a read/modify/write.
 let writes=writesByStorage.get(storage);
 if(!writes){writes=new Map();writesByStorage.set(storage,writes);}
 const pending=(writes.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
  let prior:any=null;try{prior=await storage.readJson(key,null);}catch{}
  const previous:QueryEntry[]=[];
  for(const entry of retainedAjesQueryEntries(prior)){
   if(entry.hash===hash||previous.some(value=>value.hash===entry.hash))continue;
   const candidate={...saved,previous:[...previous,entry]};
   if(Buffer.byteLength(JSON.stringify(candidate))<=maxBucketBytes)previous.push(entry);
   if(previous.length===3)break;
  }
  await storage.writeJson(key,previous.length?{...saved,previous}:saved);
 });
 writes.set(key,pending);
 const cleanup=()=>{if(writes!.get(key)===pending)writes!.delete(key);};
 void pending.then(cleanup,cleanup);
 await pending;
}

/** Carry old row selections through both age expansion and prior SQL compatibility. Counts never qualify. */
export async function readExpandedJapanRows(sql:string,previous:string,read:(sql:string)=>Promise<any|null>){
 if(!sql.startsWith('select * from')||!sql.includes('year>=2008'))return null;
 const candidates=[sql,previous].map(s=>s.replace('year>=2008','year>=2010'));
 for(const key of new Set(candidates)){const value=await read(key);if(value)return {...value,partial:true};}
 return null;
}

/** Reuse a bounded previously viewed China page after introducing the price ceiling.
 * Public mapping still applies the current RUB limit; this is never an exact count.
 */
export async function readUncappedChinaRows(sql:string,read:(sql:string)=>Promise<any|null>){
 if(!sql.startsWith('select * from china '))return null;
 const previous=sql.replace(/ and finish<=\d+/, '');
 if(previous===sql)return null;
 const value=await read(previous);
 return value?{...value,schemaVersion:0,partial:true}:null;
}

/** Old viewed rows remain a partial failure fallback; never reuse their old counts. */
export async function readPreviousTruckPolicyRows(sql:string,read:(sql:string)=>Promise<any|null>){
 if(!sql.startsWith('select * from'))return null;
 const current=heavyVehicleSqlExclusion();
 if(!sql.includes(current))return null;
 for(const legacy of [false,true]){
  const previous=sql.replace(current,heavyVehicleSqlExclusion(legacy,true));
  if(previous===sql)continue;
  const value=await read(previous);
  if(value)return {...value,schemaVersion:0,partial:true};
 }
 return null;
}
