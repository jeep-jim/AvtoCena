import {getJsonStorage,mutateDataJson,readDataJson} from './data';
import type {TeamIdea} from './team-ideas';

const path='crm/team-ideas/items.json';
export const IDEA_RETENTION_MS=30*86400000;
export function ideaExpiresAt(row:TeamIdea){
 const at=Date.parse(row.completedAt||'');
 return row.progress===100&&Number.isFinite(at)?new Date(at+IDEA_RETENTION_MS).toISOString():undefined;
}
export function expiredIdea(row:TeamIdea,now:number){const at=ideaExpiresAt(row);return !!at&&Date.parse(at)<=now;}
function tombstone(row:TeamIdea,now:number):TeamIdea {
 // Keep only the permanent number and a retry queue, never recycle a deleted idea's number.
 return {id:row.id,number:row.number,deletedAt:new Date(now).toISOString(),createdAt:row.createdAt,updatedAt:new Date(now).toISOString(),title:'',description:'',authorId:'',authorName:'',progress:0,votes:[],screenshots:[],pendingMedia:[...new Set([...row.screenshots,...(row.comments||[]).flatMap(c=>c.screenshots)])]};
}
async function removeMedia(rows:TeamIdea[]){
 const storage=getJsonStorage();let failed=0;
 for(const row of rows.filter(r=>r.deletedAt&&r.pendingMedia?.length)){
  const removed:string[]=[];
  for(const key of row.pendingMedia!){try{if(!storage.deleteBinary)throw Error('media_delete_unavailable');await storage.deleteBinary(`crm/team-ideas/media/${key}`);removed.push(key);}catch{failed++;}}
  if(removed.length)await mutateDataJson<TeamIdea[]>(path,[],current=>current.map(r=>r.id===row.id&&r.deletedAt?{...r,pendingMedia:(r.pendingMedia||[]).filter(k=>!removed.includes(k))}:r));
 }
 return failed;
}
export async function maintainIdeas(now=Date.now()){
 let rows=await readDataJson<TeamIdea[]>(path,[]);let purged=0;
 if(rows.some(r=>!r.deletedAt&&(r.progress===100&&!r.completedAt||expiredIdea(r,now)))){
  rows=await mutateDataJson<TeamIdea[]>(path,[],current=>{purged=0;return current.map(r=>{
   if(r.deletedAt)return r;
   if(r.progress===100&&!r.completedAt)return {...r,completedAt:new Date(now).toISOString()};
   if(expiredIdea(r,now)){purged++;return tombstone(r,now);}return r;
  });});
 }
 return {purged,failed:await removeMedia(rows)};
}
export async function removeIdea(id:string){
 const rows=await mutateDataJson<TeamIdea[]>(path,[],current=>{
  if(!current.some(r=>r.id===id))throw Error('ideas_missing');
  return current.map(r=>r.id===id&&!r.deletedAt?tombstone(r,Date.now()):r);
 });
 await removeMedia(rows.filter(r=>r.id===id));
}
