import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {addReplayCount,openChe168ReplayJournal} from '../scripts/lib/che168-replay-journal.mjs';
import {archiveChe168Snapshot,snapshotBinding} from '../scripts/lib/che168-snapshot.mjs';

const binding='a'.repeat(64),prefix='catalog/intake-working/che168-v1/123',headKey=prefix+'/head.json';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const size=value=>Buffer.byteLength(JSON.stringify(value));
const encode=chunk=>({encoding:'gzip-base64',data:gzipSync(Buffer.from(JSON.stringify(chunk)),{level:1}).toString('base64')});

// The chain lives on disk. Each read returns just one immutable object; the
// reader under test still performs every decompression, hash and census check.
class DiskJournalStore {
 etags=new Map();sequence=0;reads=0;activeReads=0;maxActiveReads=0;maxChunkBytes=0;
 constructor(readonly directory:string){}
 file(key:string){assert.ok(key.startsWith(prefix+'/'));return path.join(this.directory,path.basename(key));}
 async readJsonWithMeta(key:string,fallback:any){
  this.activeReads++;this.maxActiveReads=Math.max(this.maxActiveReads,this.activeReads);
  try{
   let body;try{body=await fs.readFile(this.file(key));}catch(error){if(error.code==='ENOENT')return {found:false,value:fallback};throw error;}
   if(key!==headKey){this.reads++;this.maxChunkBytes=Math.max(this.maxChunkBytes,body.length);}
   return {found:true,value:JSON.parse(body.toString('utf8')),etag:this.etags.get(key)};
  }finally{this.activeReads--;}
 }
 async readJson(key:string,fallback:any){return (await this.readJsonWithMeta(key,fallback)).value;}
 async writeJson(key:string,value:any,condition:any={}){
  const old=this.etags.get(key);
  if(condition.ifNoneMatch==='*'&&old||condition.ifMatch&&condition.ifMatch!==old)throw Error('storage_conflict');
  this.etags.set(key,String(++this.sequence));
  await fs.writeFile(this.file(key),JSON.stringify(value));
 }
}
async function seed(storage:DiskJournalStore,count:number,changeCount=(index:number)=>1){
 const head={version:2,binding,initialCursor:0,cursor:count,changes:0,bytes:0,rawBytes:0,chunks:[] as {id:string,sha:string}[]};
 for(let index=0;index<count;index++){
  const chunk={binding,from:index,to:index+1,changes:changeCount(index),events:[{ordinal:index}]},stored=encode(chunk),id=randomUUID();
  await storage.writeJson(prefix+'/'+id+'.json',stored,{ifNoneMatch:'*'});
  head.chunks.push({id,sha:digest(stored)});head.bytes+=size(stored);head.rawBytes+=size(chunk);head.changes+=chunk.changes;
 }
 await storage.writeJson(headKey,head);return head;
}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'che168-long-journal-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));return new DiskJournalStore(directory);
}

test('more than 10000 real disk chunks replay in order, continue by CAS and reject late corruption',async t=>{
 t.mock.method(console,'log',()=>{});
 const storage=await fixture(t),head=await seed(storage,10001);let applied=0;
 const options={storage,artifactRunId:'123',binding,initialCursor:0,apply:async event=>{assert.equal(event.ordinal,applied++);}};
 const journal=await openChe168ReplayJournal(options);
 assert.equal(applied,10001);assert.equal(journal.cursor,10001);assert.equal(journal.changes,10001);
 assert.equal(storage.reads,10001);assert.equal(storage.maxActiveReads,1);assert.ok(storage.maxChunkBytes<1024);
 const stale=await openChe168ReplayJournal({...options,apply:async()=>{}});
 await journal.commit({cursor:10002,changes:10002,events:[{ordinal:10001}]});
 await assert.rejects(stale.commit({cursor:10003,changes:10003,events:[]}),/storage_conflict/);
 applied=0;await openChe168ReplayJournal({...options,readOnly:true});assert.equal(applied,10002);
 const saved=await storage.readJson(headKey,null);
 assert.equal(saved.chunks.length,10002);assert.equal(saved.cursor,10002);
 assert.ok(saved.bytes>head.bytes&&saved.rawBytes>head.rawBytes);
 const last=saved.chunks.at(-1),key=prefix+'/'+last.id+'.json',original=await storage.readJson(key,null);
 await storage.writeJson(key,{...original,data:original.data.slice(0,-4)+'AAAA'});
 await assert.rejects(openChe168ReplayJournal({...options,apply:async()=>{},readOnly:true}),/invalid_replay_checkpoint/);
 await storage.writeJson(key,original);await fs.unlink(storage.file(key));
 await assert.rejects(openChe168ReplayJournal({...options,apply:async()=>{},readOnly:true}),/invalid_replay_checkpoint/);
});

test('aggregate counters pass the former byte ceilings but reject invalid values and integer overflow',()=>{
 for(const total of [512*1024**2,8*1024**3,20*1024**3])assert.equal(addReplayCount(total,17),total+17);
 assert.equal(addReplayCount(Number.MAX_SAFE_INTEGER-1,1),Number.MAX_SAFE_INTEGER);
 for(const value of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null]){
  assert.throws(()=>addReplayCount(value,1),/invalid_replay_checkpoint/);
  assert.throws(()=>addReplayCount(1,value),/invalid_replay_checkpoint/);
 }
 assert.throws(()=>addReplayCount(Number.MAX_SAFE_INTEGER,1),/invalid_replay_checkpoint/);
});

test('false aggregate census and overflow still fail after valid immutable chunk checks',async t=>{
 const storage=await fixture(t),head=await seed(storage,2),options={storage,artifactRunId:'123',binding,initialCursor:0,apply:async()=>{},readOnly:true};
 for(const field of ['bytes','rawBytes','changes']){
  await storage.writeJson(headKey,{...head,[field]:head[field]+1});
  await assert.rejects(openChe168ReplayJournal(options),/invalid_replay_checkpoint/);
 }
 await storage.writeJson(headKey,{...head,rawBytes:8*1024**3+1,bytes:512*1024**2+1});
 const before=storage.reads;
 await assert.rejects(openChe168ReplayJournal(options),/invalid_replay_checkpoint/);
 assert.equal(storage.reads-before,2,'large claimed totals still require the exact complete byte census');
 const first={binding,from:0,to:1,changes:Number.MAX_SAFE_INTEGER,events:[{ordinal:0}]};
 const second={binding,from:1,to:2,changes:1,events:[{ordinal:1}]};
 const chunks=[];let bytes=0,rawBytes=0;
 for(const chunk of [first,second]){const stored=encode(chunk),id=randomUUID();await storage.writeJson(prefix+'/'+id+'.json',stored);chunks.push({id,sha:digest(stored)});bytes+=size(stored);rawBytes+=size(chunk);}
 await storage.writeJson(headKey,{...head,changes:Number.MAX_SAFE_INTEGER,bytes,rawBytes,chunks});
 const applied=[];
 await assert.rejects(openChe168ReplayJournal({...options,apply:async event=>{applied.push(event.ordinal);}}),/invalid_replay_checkpoint/);
 assert.deepEqual(applied,[0],'overflow is rejected before applying the next chunk');
});

test('an oversized individual chunk still cannot advance the journal head',async t=>{
 t.mock.method(console,'log',()=>{});
 const storage=await fixture(t),options={storage,artifactRunId:'123',binding,initialCursor:0,apply:async()=>{}};
 const journal=await openChe168ReplayJournal(options);
 await assert.rejects(journal.commit({cursor:1,changes:1,events:[{payload:'x'.repeat(64*1024**2)}]}),/replay_storage_budget/);
 assert.equal((await storage.readJsonWithMeta(headKey,null)).found,false);assert.equal(storage.etags.size,0);
});

const config=bytes=>({version:1,date:'2026-10-09',filename:'active_offer.csv',host:'https://autobase-barrett.auto-api.com',
 initialCursor:20,bytes,etag:'"fixture-etag"',modifiedAt:'2026-10-09T08:09:40.000Z',delimiter:'|'});
test('snapshot size may exceed 20 GiB while exact positive safe integers and bounded ranges remain required',async()=>{
 const c=config(20*1024**3+17);assert.match(snapshotBinding(c),/^[a-f0-9]{64}$/);
 assert.notEqual(snapshotBinding(c),snapshotBinding(config(c.bytes-1)));
 for(const bytes of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>snapshotBinding(config(bytes)),/invalid_snapshot_config/);
 let calls=0,writes=0;
 const storage={readJson:async()=>null,getBinary:async()=>{throw Error('unexpected_binary_read');},
  writeJson:async()=>{writes++;},putBinary:async()=>{writes++;}};
 await assert.rejects(archiveChe168Snapshot({config:config(Number.MAX_SAFE_INTEGER),storage,password:'fixture',fetchImpl:async(_url,options)=>{
  calls++;const [,start,end]=options.headers.range.match(/^bytes=(\d+)-(\d+)$/);
  assert.ok(Number.isSafeInteger(Number(start))&&Number.isSafeInteger(Number(end)));
  assert.equal(Number(end)-Number(start)+1,16*1024**2);
  return new Response('',{status:403});
 }}),/auto_api_snapshot_http_403/);
 assert.equal(calls,3);assert.equal(writes,0);
});
