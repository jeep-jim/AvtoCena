import {AsyncLocalStorage} from 'node:async_hooks';
import {ObjectJsonStorage} from '../data';
import {assertChinaLegacyRollback,chinaLegacyRollback,chinaRegcloudRuntimeConfigured,readChinaPublicState} from './china-regcloud-object-reader';
import {chinaLocalRuntimeConfigured,initializeLocalChinaReader} from './china-local-reader';
type Authority='legacy'|'own'|'unavailable';
const authority=new AsyncLocalStorage<Authority>();
/** Existing global China rows are allowed only with no independent cut or an
 * exact authenticated rollback. An uncertain own pointer never leaks legacy stock. */
export async function readChinaAggregateAuthority():Promise<Authority>{
 if(chinaLocalRuntimeConfigured())try{const state=await initializeLocalChinaReader();state!.assertCurrent();return 'own';}catch{return 'unavailable';}
 if(!chinaRegcloudRuntimeConfigured())return 'legacy';
 try{
  const storage=new ObjectJsonStorage(),first=await readChinaPublicState(storage);
  if(!first)return 'unavailable';
  if(!chinaLegacyRollback(first.state.active))return 'own';
  await assertChinaLegacyRollback(storage,first.state.active);
  const after=await readChinaPublicState(storage);
  return after?.etag===first.etag&&after.checksum===first.checksum?'legacy':'unavailable';
 }catch{return 'unavailable';}
}
export const omitLegacyChinaAggregate=()=>authority.getStore()==='own'||authority.getStore()==='unavailable';
export const chinaAggregateCacheKey=()=>omitLegacyChinaAggregate()?['no-old-china']:[];
export const legacyAggregateMarketAllowed=(market:unknown)=>!omitLegacyChinaAggregate()||market!=='china';
export async function withChinaAggregateAuthority<T>(market:string|undefined,task:()=>Promise<T>):Promise<T>{
 if((market&&market!=='any')||authority.getStore()||!chinaRegcloudRuntimeConfigured()&&!chinaLocalRuntimeConfigured())return task();
 const first=await readChinaAggregateAuthority(),output=await authority.run(first,task);
 // Transition after a long shared-cache read cannot publish old China content.
 if(first==='legacy'){
  const after=await readChinaAggregateAuthority();
  if(after!=='legacy')return authority.run(after,task);
 }
 return output;
}
