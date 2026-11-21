// Source preparation only. Remote creates are private and run-scoped; never publish or issue provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {once} from 'node:events';
import path from 'node:path';
import {ObjectJsonStorage} from '../../../apps/web/lib/data.ts';
import {normalizeAutoApiDubicars} from '../../../apps/web/lib/catalog/auto-api-dubicars.ts';
import {readVerifiedDelta,FRESH,sha,hash} from './chain.mjs';
import {readOldArchive} from './prepare.mjs';
import {replay,classifyPredecessor} from './replay.mjs';
import {ROOT,SEAL_KEY} from './accepted-collector.mjs';
const req=(x:unknown,c:string)=>assert.ok(x,c), E=process.env;
const C='catalog/intake-cursors/v1/uae.json', M='catalog/manifest.json';
const expectedHealth={releaseSha:'22867cbcfaee27b2e8917b6bf880e44827f67b60',calculationVersion:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'};
const own=/^catalog\/generations\/gen_\d{13}_[a-f0-9]{8}\/offers\/uae\/chunk-\d{4,6}\.json$/;
const gen=/^gen_\d{13}_[a-f0-9]{8}$/;
let phase='admit';
async function run(){
 req(E.GITHUB_REPOSITORY_ID==='1289722938'&&E.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&E.GITHUB_REF==='refs/heads/main'
  &&E.GITHUB_RUN_ATTEMPT==='1'&&E.GITHUB_JOB==='replay'
  &&E.GITHUB_WORKFLOW_REF==='jeep-jim/AvtoCena/.github/workflows/uae-private-replay-22867-v1.yml@refs/heads/main','uae_replay_role');
 req(E.JSON_STORAGE_DRIVER==='object'&&E.YC_OBJECT_STORAGE_ENDPOINT==='https://s3.regru.cloud'&&E.YC_OBJECT_STORAGE_REGION==='us-east-1'
  &&E.YC_OBJECT_STORAGE_BUCKET==='avtocena-staging-8120751'&&E.YC_OBJECT_STORAGE_PREFIX==='migration-staging/full-20261011/'
  &&E.YC_OBJECT_STORAGE_MAX_ATTEMPTS==='1','uae_replay_storage_identity');
 const argv=process.argv.slice(2),out=argv[0];
 req(argv.length===1&&out===path.resolve(out||'')&&await fs.realpath(out)===out&&(await fs.stat(out)).isDirectory()
  &&((await fs.stat(out)).mode&0o077)===0&&!(await fs.readdir(out)).length,'uae_replay_private_output');
 req(Date.now()>=Date.parse(FRESH.observations)&&Date.now()-Date.parse(FRESH.observations)<48*3600000,'uae_replay_source_outside_horizon');
  req(/^[1-9]\d{8,14}$/.test(E.GITHUB_RUN_ID||''),'uae_replay_run_identity');
 const storage=new ObjectJsonStorage();let gets=0, stageReads=0, stageWrites=0, stageBytes=0;
 const stage='catalog/operations/uae-source-prepared/v1/'+E.GITHUB_RUN_ID+'/attempt-1/';
 const stageKey=/^(?:(?:source-input|old-predecessor|dispositions|source-holds)\/chunk-\d{4}\.ndjson|source-prepared\.json)$/;
 async function privateCreate(name:string,b:Buffer){
  req(stageKey.test(name)&&Buffer.isBuffer(b)&&b.length>0&&b.length<=4*1024*1024&&
   ++stageWrites<=500&&(stageBytes+=b.length)<=192*1024*1024,'uae_source_prepared_private_write_bound');
  await storage.putBinary(stage+name,b,name.endsWith('.ndjson')?'application/x-ndjson':'application/json',{ifNoneMatch:'*'});
  const got=await storage.getBinary(stage+name);stageReads++;
  req(got.size===b.length&&sha(got.data)===sha(b),'uae_source_prepared_exact_stage_readback');
  return {key:name,bytes:b.length,sha256:sha(b)};
 }
 async function read(key:string,cap:number){
  req(++gets<=330&&([C,M,SEAL_KEY,ROOT+'sealed-delta.json'].includes(key)||own.test(key)||key.startsWith(ROOT)&&/^page-\d{6}\.json$/.test(key.slice(ROOT.length))),'uae_replay_object_scope');
  const b=await storage.getBinary(key);
  req(Buffer.isBuffer(b.data)&&b.data.length===b.size&&b.size<=cap,'uae_replay_object_size');return b.data;
 }
 async function health(){
  const r=await fetch('https://avtocena.com/api/health',{redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json','cache-control':'no-cache'}});
  req(r.ok,'uae_replay_health_unavailable');const h=await r.json();
  req(h.ok===true&&h.releaseSha===expectedHealth.releaseSha&&h.calculationVersion===expectedHealth.calculationVersion,'uae_replay_native_release_changed');
 }
 async function predecessor(base:any){
  const [manifest,cursor]=await Promise.all([read(M,1024*1024),read(C,1024*1024)]);
  const m=JSON.parse(manifest.toString()), c=JSON.parse(cursor.toString()), a=m.markets?.uae, p=base.predecessor;
  req(m.version===2&&gen.test(m.generationId)&&a?.count===25484&&p?.count===25484
   &&c.market==='uae'&&hash(a)===p.marketRecordSha256&&hash(c)===p.cursorSha256&&Array.isArray(a.chunks)&&a.chunks.length<=200,'uae_replay_predecessor_changed');
  const keys=a.chunks.map((x:string)=>/^chunk-\d{4,6}$/.test(x)?'catalog/generations/'+m.generationId+'/offers/uae/'+x+'.json':x);
  req(keys.every((k:string)=>own.test(k))&&new Set(keys).size===keys.length&&hash(keys)===p.refsSha256,'uae_replay_predecessor_refs_changed');
  return keys;
 }
 async function writeLines(name:string,rows:Iterable<unknown>){
  req(/^(?:source-input|old-predecessor|dispositions|source-holds)$/.test(name),'uae_replay_file_scope');
  const file=path.join(out,name+'.ndjson'),fd=createWriteStream(file,{flags:'wx',mode:0o600}),h=createHash('sha256');
  let count=0,bytes=0, pending:Buffer[]=[], n=0;const chunks=[];
  async function flush(){
   if(!n)return;
   const key=name+'/chunk-'+String(chunks.length).padStart(4,'0')+'.ndjson';
   chunks.push({...(await privateCreate(key,Buffer.concat(pending))),rows:n});
   pending=[];n=0;bytes=0;
  }
  for(const row of rows){const line=JSON.stringify(row)+'\n',b=Buffer.from(line);req(b.length<=4*1024*1024,'uae_replay_file_line_size');
   if(n&&(n===256||bytes+b.length>4*1024*1024))await flush();
   n++;bytes+=b.length;pending.push(b);if(!fd.write(b))await once(fd,'drain');h.update(b);count++;
  }
  await flush();fd.end();await finished(fd);return {name,count,sha256:h.digest('hex'),chunks};
 }
 phase='source_fetch';
 const [native,delta]=await Promise.all([readOldArchive(process.stdin),readVerifiedDelta(read),health()]);
 phase='private_exact_replay';
 const candidate=replay({...native,events:delta.events,normalize:normalizeAutoApiDubicars,observedThrough:FRESH.observations});
 const chunks=await predecessor(delta.base), old:any[]=[];
 for(const key of chunks){
  const raw=JSON.parse((await read(key,8*1024*1024)).toString());
  req(Array.isArray(raw)&&raw.length>0&&raw.length<=500,'uae_replay_live_shard');old.push(...raw);
 }
 req(old.length===25484,'uae_replay_live_count');
 const decisions=classifyPredecessor({old,result:candidate});
 const counts=Object.fromEntries([...new Set(decisions.rows.map(x=>x.disposition))].map(k=>[k,decisions.rows.filter(r=>r.disposition===k).length]));
 await Promise.all([predecessor(delta.base),health()]);
 phase='private_file';
 const entries=await Promise.all([
  writeLines('source-input',[...candidate.rows.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,row])=>({row,hold:candidate.held.get(key)??null}))),
  writeLines('old-predecessor',old),writeLines('dispositions',decisions.rows),
  writeLines('source-holds',[...candidate.held.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,hold])=>({sourceOfferId:id,hold}))),
 ]);
 phase='final_private_seal';
 await Promise.all([predecessor(delta.base),health()]);
 req(sha(await read(ROOT+'sealed-delta.json',1024*1024))===FRESH.seal,'uae_replay_delta_moved_before_private_seal');
 const result={version:1,kind:'uae-source-prepared-v1',market:'uae',newSourceSeal:FRESH.seal,cursor:FRESH.cursor,sourceObservedThrough:FRESH.observations,
  oldSourceCount:candidate.countsBefore,newSourceCount:candidate.rows.size,confirmedRemovedNativeIdentity:candidate.removals.size,sourceHeld:candidate.held.size,
  predecessorCounts:counts,oldPublicCount:old.length,exactReader:expectedHealth,inputFiles:entries,
  settledSellerAndPriceParity:false,settledEditorialOrPhotoRights:false,inputOnly:true,servable:false,publicationAllowed:false,supplierRequests:0,publicPointerWrites:0,cursorWrites:0,stageWrites:stageWrites+1};
 const wire=Buffer.from(JSON.stringify(result)),file=path.join(out,'source-proof.json');
 await fs.writeFile(file,wire,{flag:'wx',mode:0o600});req(sha(await fs.readFile(file))===sha(wire),'uae_replay_proof_readback');
 const sealed=await privateCreate('source-prepared.json',wire);
 const {inputFiles,...brief}=result;
 console.log(JSON.stringify({...brief,sourceReceiptSha256:sealed.sha256,storageReads:gets+stageReads,
  stageBytes,stageShards:stageWrites-1,inputSummary:inputFiles.map(({name,count,sha256,chunks})=>({name,count,sha256,shards:chunks.length}))}));
}
run().catch(err=>{const code=/^uae_[a-z0-9_]+$/.test(err?.message)?err.message:'uae_private_replay_failed';console.error(JSON.stringify({phase,code,publicationAllowed:false}));process.exitCode=1;});
