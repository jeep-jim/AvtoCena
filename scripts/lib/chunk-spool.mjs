import assert from 'node:assert/strict';import {digest} from './spool-hash.mjs';
const bytes=x=>Buffer.byteLength(JSON.stringify(x));const copy=x=>JSON.parse(JSON.stringify(x));
export function assertChunkSpoolManifest(manifest,binding){
 assert.deepEqual(manifest?.binding,binding,'chunk_manifest_binding');assert.equal(manifest.version,1);assert.equal(manifest.publicationAuthority,false);assert.equal(manifest.rows,binding.count);
 assert.ok(Array.isArray(manifest.chunks)&&manifest.chunks.length>0&&manifest.chunks.length<=binding.pages);let page=1,total=0,previous=null;const pin=digest(binding);
 for(const[c,entry]of manifest.chunks.entries()){assert.equal(entry.version,1);assert.equal(entry.binding,pin);assert.equal(entry.number,c+1);assert.equal(entry.first,page);assert.ok(Number.isSafeInteger(entry.last)&&entry.last>=page&&entry.last<=binding.pages);assert.equal(entry.previous,previous);assert.match(entry.dataSha,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=4*1024**2);assert.ok(bytes(entry)<=4096);total+=entry.bytes;previous=digest(entry);page=entry.last+1;}
 assert.equal(page,binding.pages+1);assert.equal(total,manifest.bytes);assert.ok(total<=4*1024**3&&bytes(manifest)<=16*1024**2);return manifest;
}
/** Opt-in immutable chunk transport; never a paid-input/publication witness. */
export async function captureChunkSpool({enabled=false,upstream,store,binding,snapshot,verifierFactory,assertAuthority,assertBatchAuthority,signal,onProgress=async()=>{},
 chunkBytes=4*1024**2,maxBytes=4*1024**3,commitBytes=4096,manifestBytes=16*1024**2}){
 assert.equal(enabled,true);assert.equal(typeof assertBatchAuthority,'function','chunk_batch_authority_required');assert.match(binding.run,/^\d{1,20}$/);assert.match(binding.attempt,/^[1-9]\d{0,5}$/);assert.match(binding.producerSha,/^[a-f0-9]{40}$/);
 const root=`catalog/intake-staging/encar/${binding.run}/${binding.attempt}`;assert.equal(binding.root,root);assert.equal(digest(snapshot),binding.snapshotSha);
 for(const[k,v]of Object.entries({runId:binding.run,attempt:binding.attempt,producerSha:binding.producerSha,pages:binding.pages,count:binding.count}))assert.equal(snapshot[k],v);
 assert.ok(Number.isSafeInteger(binding.pages)&&binding.pages>0&&binding.pages<=100000&&Number.isSafeInteger(binding.count)&&binding.count>0&&binding.count<=1000000);
 for(const[n,cap]of[[chunkBytes,4*1024**2],[maxBytes,4*1024**3],[commitBytes,4096],[manifestBytes,16*1024**2]])assert.ok(Number.isSafeInteger(n)&&n>0&&n<=cap);
 const pin=digest(binding),prefix=`catalog/recovery-raw-spool/v1/${pin}/`,overhead=binding.pages*commitBytes+manifestBytes;assert.ok(overhead+chunkBytes<=maxBytes);
 const check=async()=>{signal?.throwIfAborted();await assertBatchAuthority();assert.equal(digest(await upstream.readJson(root+'/complete.json',null)),binding.snapshotSha,'chunk_source_changed');};
 await check();const verifier=verifierFactory(snapshot,{runId:binding.run,attempt:binding.attempt,headSha:binding.producerSha});assert.ok(verifier?.verify&&verifier?.finish);
 const commits=[],locations=new Map();let page=1,total=0,rows=0,previous=null;
 async function immutable(key,value){signal?.throwIfAborted();await assertAuthority();const old=await store.readJson(key,null);if(old===null)await store.writeJson(key,value,{ifNoneMatch:'*'});assert.deepEqual(await store.readJson(key,null),value,'chunk_readback');}
 const settle=async tasks=>{const r=await Promise.allSettled(tasks);const failure=r.find(x=>x.status==='rejected');if(failure)throw failure.reason;return r.map(x=>x.value);};
 function consume(data,commit){assert.equal(commit.version,1);assert.equal(commit.first,page);assert.equal(commit.number,commits.length+1);assert.equal(commit.previous,previous);assert.equal(commit.binding,pin);assert.equal(commit.dataSha,digest(data));assert.equal(commit.bytes,bytes(data));assert.ok(commit.bytes<=chunkBytes&&bytes(commit)<=commitBytes);assert.equal(data.version,1);assert.equal(data.binding,pin);assert.ok(data.pairs.length>0&&data.pairs.length<=binding.pages);
  for(const [index,pair]of data.pairs.entries()){assert.equal(pair.page,page);verifier.verify(page,pair.rows,pair.receipt);locations.set(page,{number:commit.number,index,dataSha:commit.dataSha,receiptSha:digest(pair.receipt)});rows+=pair.rows.length;page++;}
  assert.equal(commit.last,page-1);total+=commit.bytes;assert.ok(total+overhead<=maxBytes,'chunk_capacity');previous=digest(commit);commits.push(commit);
 }
 // Resume contiguous committed chunk prefix, rebind every saved receipt to original source.
 for(;;){await check();const number=commits.length+1,commit=await store.readJson(prefix+`chunks/${number}/commit.json`,null);if(commit===null)break;
  const data=await store.readJson(prefix+`chunks/${number}/data.json`,null);assert.equal(digest(data),commit.dataSha,'chunk_saved_tamper');assert.ok(bytes(data)<=chunkBytes&&Array.isArray(data.pairs));
  for(let i=0;i<data.pairs.length;i+=4){await assertAuthority();const group=data.pairs.slice(i,i+4);const originals=await settle(group.map(p=>{assert.ok(Number.isSafeInteger(p.page)&&p.page>=1&&p.page<=binding.pages);return upstream.readJson(root+`/page-receipts/${p.page}.json`,null);}));for(let j=0;j<group.length;j++)assert.equal(digest(originals[j]),digest(group[j].receipt),'chunk_original_receipt_changed');}
  consume(data,commit);await onProgress({stage:"spool_chunk_resumed",chunks:commits.length,pages:page-1,rows,bytes:total});if(page>binding.pages)break;
 }
 let pairs=[];const emptyBytes=bytes({version:1,binding:pin,pairs:[]});let pendingBytes=emptyBytes;let fetchPage=page;
 async function flush(){if(!pairs.length)return;await check();const number=commits.length+1,data={version:1,binding:pin,pairs};const commit={version:1,binding:pin,number,first:pairs[0].page,last:pairs.at(-1).page,dataSha:digest(data),bytes:bytes(data),previous};
  assert.ok(bytes(data)<=chunkBytes&&total+bytes(data)+overhead<=maxBytes,'chunk_capacity');assert.ok(bytes(commit)<=commitBytes);
  // Verify BEFORE any durable write, while retaining ordered verifier state.
  consume(data,commit);
  await immutable(prefix+`chunks/${number}/data.json`,data);await immutable(prefix+`chunks/${number}/commit.json`,commit);await onProgress({stage:'spool_chunk_committed',chunks:commits.length,pages:page-1,rows,bytes:total});pairs=[];pendingBytes=emptyBytes;
 }
 while(fetchPage<=binding.pages){signal?.throwIfAborted();await assertAuthority();assert.ok(total+3*chunkBytes+overhead<=maxBytes,'chunk_capture_reservation');const pages=Array.from({length:Math.min(2,binding.pages-fetchPage+1)},(_,i)=>fetchPage+i);
  // Two page pairs = at most FOUR simultaneous source GETs.
  const group=await settle(pages.map(async p=>{const[raw,receipt]=await settle([upstream.readJson(root+`/pages/${p}.json`,null),upstream.readJson(root+`/page-receipts/${p}.json`,null)]);return{page:p,rows:raw,receipt};}));
  for(const pair of group){signal?.throwIfAborted();const size=bytes(pair);assert.ok(emptyBytes+size<=chunkBytes,'chunk_pair_oversize');if(pairs.length&&pendingBytes+1+size>chunkBytes)await flush();pendingBytes+=size+(pairs.length?1:0);pairs.push(pair);fetchPage++;}
 }
 await flush();verifier.finish();assert.equal(rows,binding.count);await check();const manifest={version:1,binding:copy(binding),chunks:commits,bytes:total,rows,publicationAuthority:false};assert.ok(bytes(manifest)<=manifestBytes);assertChunkSpoolManifest(manifest,binding);await immutable(prefix+'complete.json',manifest);await check();
 let cachedNumber=null,cachedData=null;const loading=new Map();
 async function loadChunk(loc){if(cachedNumber===loc.number)return cachedData;if(loading.has(loc.number))return loading.get(loc.number);assert.ok(loading.size<4,'chunk_replay_concurrency');const job=(async()=>{await assertBatchAuthority();const d=await store.readJson(prefix+`chunks/${loc.number}/data.json`,null);assert.equal(digest(d),loc.dataSha,'chunk_replay_tamper');cachedNumber=loc.number;cachedData=d;return d;})();loading.set(loc.number,job);try{return await job;}finally{loading.delete(loc.number);}}
 return Object.freeze({prefix,manifest:copy(manifest),async finishReplay(){assert.equal(loading.size,0,'chunk_replay_pending');await check();},async readJson(key,fallback){signal?.throwIfAborted();await assertAuthority();const m=key.startsWith(root+'/')&&/^(pages|page-receipts)\/([1-9]\d*)\.json$/.exec(key.slice(root.length+1));if(!m)return upstream.readJson(key,fallback);const p=Number(m[2]),loc=locations.get(p);assert.ok(loc,'chunk_replay_scope');const data=await loadChunk(loc);const pair=data.pairs[loc.index];assert.equal(pair.page,p);return copy(m[1]==='pages'?pair.rows:pair.receipt);}});
}
