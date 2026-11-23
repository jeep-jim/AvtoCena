import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

// Explicit offline volume check; intentionally outside normal CI.
// node scripts/run-node-with-resources.mjs tests/manual/che168-volume-smoke.mjs . /tmp/che168-volume-report.json
assert.equal(process.argv.length,4,'Usage: che168-volume-smoke.mjs SOURCE_ROOT OUTPUT_JSON');
const source=path.resolve(process.argv[2]);
const output=path.resolve(process.argv[3]);
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
const journalPath=path.join(source,'scripts/lib/che168-replay-journal.mjs');
const snapshotPath=path.join(source,'scripts/lib/che168-snapshot.mjs');
const sha=body=>createHash('sha256').update(body).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const moduleDigests=async()=>({journal:sha(await fs.readFile(journalPath)),snapshot:sha(await fs.readFile(snapshotPath))});
const before=await moduleDigests(),started=Date.now(),root=await fs.mkdtemp(path.join(os.tmpdir(),'che168-volume-smoke-'));
let supplierRequests=0;
globalThis.fetch=async()=>{supplierRequests++;throw Error('smoke_network_forbidden');};
const {openChe168ReplayJournal}=await import(pathToFileURL(journalPath).href);
const {snapshotBinding,readChe168Snapshot}=await import(pathToFileURL(snapshotPath).href);
const MIB=1024**2,binding='a'.repeat(64),prefix='catalog/intake-working/che168-v1/123',headKey=prefix+'/head.json';
let journalReads=0,journalMaxRead=0,journalActive=0,journalMaxActive=0;
const fileFor=key=>{assert.ok(key.startsWith(prefix+'/'));return path.join(root,path.basename(key));};
const storage={
 async readJsonWithMeta(key,fallback){
  journalActive++;journalMaxActive=Math.max(journalMaxActive,journalActive);
  try{let body;try{body=await fs.readFile(fileFor(key));}catch(error){if(error.code==='ENOENT')return{found:false,value:fallback};throw error;}
   if(key!==headKey){journalReads++;journalMaxRead=Math.max(journalMaxRead,body.length);}
   return{found:true,value:JSON.parse(body.toString('utf8')),etag:sha(body)};
  }finally{journalActive--;}
 },
 async readJson(key,fallback){return(await this.readJsonWithMeta(key,fallback)).value;},
 async writeJson(key,value,condition={}){
  const old=await this.readJsonWithMeta(key,null);
  assert.ok(!(condition.ifNoneMatch==='*'&&old.found));
  assert.ok(!condition.ifMatch||old.etag===condition.ifMatch);
  await fs.writeFile(fileFor(key),JSON.stringify(value));
 }
};
let phase='journal_fixture';
try{
 const head={version:2,binding,initialCursor:0,cursor:0,changes:0,bytes:0,rawBytes:0,chunks:[]};
 async function appendFixture(payload){
  const ordinal=head.chunks.length,chunk={binding,from:ordinal,to:ordinal+1,changes:1,events:[{ordinal,payload}]};
  const raw=JSON.stringify(chunk),stored={encoding:'gzip-base64',data:gzipSync(Buffer.from(raw),{level:1}).toString('base64')};
  const body=JSON.stringify(stored),id=randomUUID();
  await fs.writeFile(fileFor(prefix+'/'+id+'.json'),body);
  head.chunks.push({id,sha:sha(body)});head.bytes+=Buffer.byteLength(body);head.rawBytes+=Buffer.byteLength(raw);
  head.cursor++;head.changes++;
 }
 {
  const payload=randomBytes(9*MIB).toString('base64');
  for(let n=0;n<44;n++)await appendFixture(payload);
 }
 console.log(JSON.stringify({stage:'volume_smoke_fixture',chunks:head.chunks.length,encodedBytes:head.bytes,rawBytes:head.rawBytes}));
 {
  const payload='x'.repeat(60*MIB);
  for(let n=0;n<128;n++){await appendFixture(payload);if((n+1)%32===0)console.log(JSON.stringify({stage:'volume_smoke_fixture',chunks:head.chunks.length,encodedBytes:head.bytes,rawBytes:head.rawBytes}));}
 }
 assert.ok(head.bytes>512*MIB);assert.ok(head.rawBytes>8*1024**3);
 await fs.writeFile(fileFor(headKey),JSON.stringify(head));
 const initial={chunks:head.chunks.length,encodedBytes:head.bytes,rawBytes:head.rawBytes};
 phase='journal_readback';let applied=0;
 const journal=await openChe168ReplayJournal({storage,artifactRunId:'123',binding,initialCursor:0,apply:async event=>{
  assert.equal(event.ordinal,applied);assert.equal(event.payload.length,applied<44?12*MIB:60*MIB);applied++;
  if(applied%32===0)console.log(JSON.stringify({stage:'volume_smoke_replay',applied}));
 }});
 assert.equal(applied,head.chunks.length);assert.equal(journal.cursor,head.cursor);assert.equal(journal.changes,head.changes);
 assert.equal(journalReads,head.chunks.length);assert.equal(journalMaxActive,1);assert.ok(journalMaxRead<64*MIB);
 await journal.commit({cursor:head.cursor+1,changes:head.changes+1,events:[{ordinal:head.cursor,payload:'tail'}]});
 const after=await storage.readJson(headKey,null);assert.equal(after.chunks.length,head.chunks.length+1);assert.equal(after.cursor,head.cursor+1);
 phase='snapshot_readback';
 const snapshotSource=await fs.readFile(snapshotPath,'utf8'),host=snapshotSource.match(/config\.host !== '([^']+)'/)[1];
 const config={version:1,date:'2026-10-09',filename:'active_offer.csv',host,initialCursor:20,bytes:20*1024**3+17,
  etag:'"synthetic-volume"',modifiedAt:'2026-10-09T08:09:40.000Z',delimiter:'|'};
 const snapshotRoot='catalog/provider-snapshots/che168/'+snapshotBinding(config),part=Buffer.alloc(16*MIB,120),tail=Buffer.alloc(17,120);
 const partPath=path.join(root,'snapshot-part.gz'),tailPath=path.join(root,'snapshot-tail.gz');
 await fs.writeFile(partPath,gzipSync(part,{level:1}));await fs.writeFile(tailPath,gzipSync(tail,{level:1}));
 const partSha=sha(part),tailSha=sha(tail),count=Math.ceil(config.bytes/part.length);
 const parts=Array.from({length:count},(_,index)=>({index,bytes:index===count-1?17:part.length,sha256:index===count-1?tailSha:partSha}));
 const manifest={version:1,binding:snapshotBinding(config),config,parts,complete:true};
 let snapshotReads=0,snapshotActive=0,snapshotMaxActive=0,snapshotBytes=0,snapshotParts=0;
 const snapshotStorage={
  async readJson(key){assert.equal(key,snapshotRoot+'/manifest.json');return manifest;},
  async getBinary(key){
   const prefix=snapshotRoot+'/';assert.ok(key.startsWith(prefix));
   const name=key.slice(prefix.length),index=Number(name.replace('.csv.gz',''));
   assert.equal(name,String(index).padStart(5,'0')+'.csv.gz');assert.ok(index>=0&&index<count);
   snapshotActive++;snapshotMaxActive=Math.max(snapshotMaxActive,snapshotActive);
   try{snapshotReads++;return{data:await fs.readFile(index===count-1?tailPath:partPath)};}finally{snapshotActive--;}
  }
 };
 for await(const raw of readChe168Snapshot({config,storage:snapshotStorage})){
  snapshotBytes+=raw.length;snapshotParts++;
  if(snapshotParts%256===0)console.log(JSON.stringify({stage:'volume_smoke_snapshot',parts:snapshotParts,bytes:snapshotBytes}));
 }
 assert.equal(snapshotBytes,config.bytes);assert.equal(snapshotParts,count);assert.equal(snapshotReads,count);assert.equal(snapshotMaxActive,1);
 assert.equal(supplierRequests,0);assert.deepEqual(await moduleDigests(),before);
 const report={passed:true,synthetic:true,base:sourceHead,sourceSha256:before,
  journal:{...initial,readChunks:applied,maxConcurrentReads:journalMaxActive,maxStoredChunkBytes:journalMaxRead,cursorAfterAppend:after.cursor,
   appendedByConditionalHead:true,allChunkChecksumsAndCensusVerified:true},
  snapshot:{bytes:snapshotBytes,parts:snapshotParts,maxConcurrentReads:snapshotMaxActive,maxRawPartBytes:part.length,allPartChecksumsVerified:true},
  supplierRequests,externalStorageWrites:0,elapsedMs:Date.now()-started,maxRssKiB:process.resourceUsage().maxRSS};
 await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({stage:'volume_smoke_complete',...report}));
}catch(error){
 await fs.writeFile(output,JSON.stringify({passed:false,synthetic:true,phase,code:String(error.message).slice(0,240),elapsedMs:Date.now()-started,supplierRequests},null,2)+'\n');throw error;
}finally{await fs.rm(root,{recursive:true,force:true});}
