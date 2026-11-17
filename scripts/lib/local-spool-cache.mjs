import fs from 'node:fs/promises';import {constants} from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
/** Disposable runner cache only. Durable source remains immutable S3 spool.
 * A crashed local owner requires a NEW local directory, never lock stealing. */
export async function localSpoolCache({directory,store,prefix,maxBytes=4*1024**3,maxObjectBytes=16*1024**2,maxFiles=200001,signal}){
 assert.ok(path.isAbsolute(directory));assert.match(prefix,/^catalog\/recovery-raw-spool\/v1\/[a-f0-9]{64}\/$/);
 assert.ok(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=4*1024**3);assert.ok(Number.isSafeInteger(maxObjectBytes)&&maxObjectBytes>0&&maxObjectBytes<=16*1024**2);
 assert.ok(Number.isSafeInteger(maxFiles)&&maxFiles>0&&maxFiles<=200001);
 await fs.mkdir(directory,{recursive:true,mode:0o700});assert.ok((await fs.lstat(directory)).isDirectory()&&!(await fs.lstat(directory)).isSymbolicLink());
 const lock=path.join(directory,'.lock');await fs.mkdir(lock,{mode:0o700});let used=0,reserved=0,count=0,closing=false;const jobs=new Map(),writes=new Map(),sizes=new Map();
 try{for(const n of await fs.readdir(directory)){if(n==='.lock')continue;assert.match(n,/^[a-f0-9]{64}\.json$/,'spool_local_uncommitted');const stat=await fs.lstat(path.join(directory,n));assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maxObjectBytes);used+=stat.size;count++;sizes.set(n,stat.size);}assert.ok(used<=maxBytes&&count<=maxFiles,'spool_local_capacity');}catch(e){await fs.rmdir(lock);throw e;}
 const check=k=>{assert.ok(!closing,'spool_local_closed');signal?.throwIfAborted();assert.ok(k.startsWith(prefix));assert.match(k.slice(prefix.length),/^(complete\.json|chunks\/[1-9]\d*\/(data|commit)\.json)$/);return hash(k)+'.json';};
 async function readFile(name){const file=await fs.open(path.join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();assert.ok(stat.isFile()&&stat.size===sizes.get(name)&&stat.size<=maxObjectBytes,'spool_local_changed');const buf=Buffer.alloc(stat.size+1);let bytesRead=0;while(bytesRead<buf.length){const part=await file.read(buf,bytesRead,buf.length-bytesRead,bytesRead);if(!part.bytesRead)break;bytesRead+=part.bytesRead;}assert.equal(bytesRead,stat.size,'spool_local_length');return JSON.parse(buf.subarray(0,bytesRead).toString('utf8'));}finally{await file.close();}}
 async function load(k,f,name){
  if(sizes.has(name))return readFile(name);
  assert.ok(used+reserved+maxObjectBytes<=maxBytes&&count+jobs.size<maxFiles,'spool_local_capacity');reserved+=maxObjectBytes;
  let tmp;
  try{const value=await store.readJson(k,f);signal?.throwIfAborted();if(value===f||value===null)return value;
   const body=Buffer.from(JSON.stringify(value));assert.ok(body.length<=maxObjectBytes,'spool_local_object_bound');tmp=path.join(directory,hash(k)+'.'+randomUUID()+'.partial');
   const h=await fs.open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}
   signal?.throwIfAborted();await fs.rename(tmp,path.join(directory,name));tmp=null;sizes.set(name,body.length);used+=body.length;count++;
   const d=await fs.open(directory,constants.O_RDONLY);try{await d.sync();}finally{await d.close();}return value;
  }finally{reserved-=maxObjectBytes;if(tmp)await fs.rm(tmp,{force:true});}
 }
 const readJson=(k,f)=>{const name=check(k);assert.ok(!writes.has(name),'spool_local_write_busy');if(jobs.has(name))return jobs.get(name);const job=load(k,f,name);jobs.set(name,job);void job.finally(()=>jobs.delete(name)).catch(()=>{});return job;};
 const writeJson=(k,v,c)=>{const name=check(k);assert.deepEqual(c,{ifNoneMatch:'*'});assert.ok(!jobs.has(name)&&!writes.has(name),'spool_local_write_busy');const job=(async()=>{if(sizes.has(name)){await fs.unlink(path.join(directory,name));used-=sizes.get(name);sizes.delete(name);count--;}return store.writeJson(k,v,c);})();writes.set(name,job);void job.finally(()=>writes.delete(name)).catch(()=>{});return job;};
 return Object.freeze({readJson,writeJson,metrics:()=>({used,reserved,count}),async close(){closing=true;await Promise.allSettled([...jobs.values(),...writes.values()]);await fs.rmdir(lock);}});
}
