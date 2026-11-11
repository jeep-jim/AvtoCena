import {getJsonStorage,type StorageObject} from '../data';
const GRACE_MS=48*60*60*1000;
/** Old immutable revisions only. Current chunks, accounts and encrypted files are never candidates. */
export function obsoleteMessageChunks(objects:StorageObject[],index:any,collection:string,now=Date.now(),directory="accounts/messages/"){
 if(index?.version!==1||index.collection!==collection||!Array.isArray(index.chunks)||!index.chunks.length||!Number.isInteger(index.total)||index.total!==index.chunks.reduce((sum:number,c:any)=>sum+Number(c.count),0)||index.chunks.some((c:any)=>typeof c.file!=='string'||c.file.includes('/')||c.file.includes('\\')||!Number.isInteger(c.count)||c.count<0))return [];
 const referenced=new Set(index.chunks.map((c:any)=>c.file));
 if(!/^(accounts\/messages\/|clients\/|dealers\/[-a-zA-Z0-9_]{1,100}\/)$/.test(directory)||!/^([a-f0-9]{64}|clients|reviews)$/.test(collection))return [];
 return objects.filter(o=>o.key.startsWith(directory+collection+'-')&&new RegExp('^'+collection+'-\\d{4,}-[a-f0-9-]{36}\\.json$').test(o.key.slice(directory.length))&&!referenced.has(o.key.slice(directory.length))&&Number.isFinite(Date.parse(o.lastModified||''))&&now-Date.parse(o.lastModified!)>GRACE_MS);
}
export async function cleanCustomerMessageRevisions(apply=false){
 const storage=getJsonStorage();if(!storage.listObjects||!storage.deleteJson)throw Error('message_cleanup_storage_unavailable');
 const objects=(await Promise.all(['accounts/messages','clients','dealers'].map(prefix=>storage.listObjects!(prefix)))).flat();
 const indexes=objects.filter(o=>/^(accounts\/messages\/[a-f0-9]{64}|clients\/clients|dealers\/[-a-zA-Z0-9_]{1,100}\/(clients|reviews))-index\.json$/.test(o.key));
 let eligible=0,deleted=0,reclaimedBytes=0;
 for(const item of indexes){
  const directory=item.key.slice(0,item.key.lastIndexOf('/')+1),collection=item.key.slice(directory.length,-'-index.json'.length);
  const index=await storage.readJson<any>(item.key,null);
  const candidates=obsoleteMessageChunks(objects,index,collection,Date.now(),directory);
  eligible+=candidates.length;
  if(!apply)continue;
  // Re-read the current references immediately before deletion. New writes use
  // fresh UUID chunks and cannot reference an obsolete revision from 48h ago.
  const current=await storage.readJson<any>(item.key,null);
  for(const object of obsoleteMessageChunks(candidates,current,collection,Date.now(),directory).slice(0,Math.max(0,10000-deleted))){await storage.deleteJson(object.key);deleted++;reclaimedBytes+=object.size||0;}
 }
 return {apply,collections:indexes.length,eligible,deleted,reclaimedBytes,graceHours:48};
}
