import {createHash} from 'node:crypto';
import {ajesQuery} from './ajes-query';

type Store={readJson:(key:string,fallback:null)=>Promise<any>;writeJson:(key:string,value:any)=>Promise<unknown>};
const root='catalog/partner-cache/ajes/queries';
const overallCount=ajesQuery({aggregate:'count'}).sql;
/** Keep counters out of the list collision pool; always verify the complete SQL hash. */
export function ajesQueryCacheLocation(sql:string){
 const hash=createHash('sha256').update(sql).digest('hex'),slot=parseInt(hash.slice(0,8),16)%128;
 const legacy=`${root}/${slot}.json`;
 const key=sql.startsWith('select count(*) from')
  ?`${root}/counts/${sql===overallCount?'overall':slot}.json`:legacy;
 return {hash,key,legacy};
}
export async function readAjesQueryCache(storage:Store,sql:string){
 const {hash,key,legacy}=ajesQueryCacheLocation(sql);
 for(const location of key===legacy?[key]:[key,legacy]){
  const saved=await storage.readJson(location,null);
  if(saved?.hash===hash)return saved.value;
 }
 return null;
}
export async function saveAjesQueryCache(storage:Store,sql:string,value:unknown){
 const {hash,key}=ajesQueryCacheLocation(sql),saved={hash,value};
 if(Buffer.byteLength(JSON.stringify(saved))<=256*1024)await storage.writeJson(key,saved);
}
