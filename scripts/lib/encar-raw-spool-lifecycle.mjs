import {paidEncarSavedPageVerifier}from'../catalog-paid-encar-intake.mjs';
import {assertChunkSpoolManifest}from'./chunk-spool.mjs';
import assert from'node:assert/strict';
import {openRawFeedPin,rawDigest,rawProducerOwner,RAW_PIN_PREFIX}from'./catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY,assertRawReadPermit}from'./catalog-raw-coordination.mjs';
import {readRawCoordinationPolicy,assertRawCoordinationPolicy}from'../../apps/web/lib/catalog/raw-coordination-gate.mjs';
import {readCollectionControls}from'../../apps/web/lib/catalog/collection-controls.ts';
import {collectionEnabled}from'../../apps/web/lib/catalog/collection-controls-schema.ts';
/** Backing storage MUST enforce bounded wire reads below raw-session wrappers.
 * Fresh claims may reuse immutable bytes; no existing claim is ever reopened. */
export async function openEncarRawSpoolLifecycle({storage,binding,owner=rawProducerOwner(),readConcurrency=1}){
 binding=structuredClone(binding);
 assert.equal(storage.driver,'object','spool_object_storage');assert.equal(typeof storage.readJsonBounded,'function','spool_bounded_storage_required');
 rawProducerOwner({GITHUB_RUN_ID:owner.runId,GITHUB_RUN_ATTEMPT:owner.attempt,GITHUB_SHA:owner.revision});
 assert.match(binding.run,/^\d{1,20}$/);assert.match(binding.attempt,/^[1-9]\d{0,5}$/);assert.match(binding.producerSha,/^[a-f0-9]{40}$/);assert.match(binding.snapshotSha,/^[a-f0-9]{64}$/);
 assert.equal(binding.root,`catalog/intake-staging/encar/${binding.run}/${binding.attempt}`);assert.ok(Number.isSafeInteger(binding.pages)&&binding.pages>0&&binding.pages<=100000);assert.ok(Number.isSafeInteger(binding.count)&&binding.count>0&&binding.count<=1000000);
 const sourceRef={kind:'encar-snapshot',root:binding.root,sha256:binding.snapshotSha},hash=rawDigest(binding),root=`catalog/recovery-raw-spool/v1/${hash}`,spoolRef={kind:'encar-recovery-spool',root};
 const readId=`encar-spool-read-${owner.runId}-${owner.attempt}`,writeId=`encar-spool-write-${owner.runId}-${owner.attempt}`;
 assert.ok(await readRawCoordinationPolicy(storage),'spool_coordination_required');
 // Never call openRawFeedPin on old loading/ready claims, even same Actions owner.
 for(const id of[readId,writeId])assert.equal(await storage.readJson(RAW_PIN_PREFIX+id+'.json',null),null,'spool_existing_owner_forbidden');
 const controls=await readCollectionControls(storage);assert.ok(collectionEnabled(controls,'encar_feed'),'spool_disabled');const controlHash=rawDigest({market:controls.markets.korea,source:controls.sources.encar_feed});
 const reader=await openRawFeedPin({storage,operationId:readId,owner,references:[sourceRef,spoolRef],readOnly:true,readConcurrency});assert.equal(reader.coordinated,true,'spool_reader_uncoordinated');
 const writer=await openRawFeedPin({storage,operationId:writeId,owner,references:[spoolRef]});assert.equal(writer.coordinated,true,'spool_writer_uncoordinated');
 const readerPin=await storage.readJson(reader.key,null);assert.ok(readerPin?.coordination,'spool_reader_binding');const readerPinDigest=rawDigest(readerPin);
 let state='capturing',pending=new Set(),sealedManifest=null,replayBatch=null;
 const assertLocalState=()=>assert.ok(['capturing','sealed'].includes(state),'spool_lifecycle_closed');
 const authority=async()=>{assert.ok(['capturing','sealed','sealing','finishing'].includes(state),'spool_lifecycle_closed');const c=await readCollectionControls(storage);assert.ok(collectionEnabled(c,'encar_feed'),'spool_disabled');assert.equal(rawDigest({market:c.markets.korea,source:c.sources.encar_feed}),controlHash,'spool_controls_changed');};
 const track=fn=>{const p=Promise.resolve().then(fn);pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};
 const inPageRange=k=>{const m=/\/(?:pages|page-receipts|chunks)\/([1-9]\d*)(?:\.json|\/)/.exec(k);return !m||Number.isSafeInteger(Number(m[1]))&&Number(m[1])<=binding.pages;};
 const sourceKey=k=>inPageRange(k)&&(k===binding.root+'/complete.json'||new RegExp('^'+binding.root+'/((pages|page-receipts)/[1-9]\\d*\\.json)$').test(k));
 const destinationKey=k=>inPageRange(k)&&(k===root+'/complete.json'||new RegExp('^'+root+'/chunks/[1-9]\\d*/(data|commit)\\.json$').test(k));
 async function sourceRead(key,fallback){assert.ok(['capturing','sealed'].includes(state),'spool_lifecycle_closed');assert.ok(sourceKey(key),'spool_source_key');return track(async()=>{assertLocalState();const value=await reader.storage.readJsonBounded(key,key===root+'/complete.json'?16*1024**2:key.endsWith('/commit.json')?4096:4*1024**2);assert.equal(typeof value?.found,'boolean','spool_bounded_result');return value.found?value.value:fallback;});}
 async function destinationRead(key,fallback){assert.ok(['capturing','sealed'].includes(state),'spool_lifecycle_closed');assert.ok(destinationKey(key),'spool_destination_key');return track(async()=>{assertLocalState();const value=await reader.storage.readJsonBounded(key,key===root+'/complete.json'?16*1024**2:key.endsWith('/commit.json')?4096:4*1024**2);assert.equal(typeof value?.found,'boolean','spool_bounded_result');return value.found?value.value:fallback;});}
 async function destinationWrite(key,value,condition){assert.equal(state,'capturing','spool_writes_closed');assert.ok(destinationKey(key),'spool_destination_key');assert.deepEqual(condition,{ifNoneMatch:'*'},'spool_immutable_only');return track(async()=>{assertLocalState();assert.ok(Buffer.byteLength(JSON.stringify(value))<=(key===root+'/complete.json'?16*1024**2:key.endsWith('/commit.json')?4096:4*1024**2),'spool_body_bound');await writer.storage.writeJson(key,value,{ifNoneMatch:'*'});});}
 async function assertSnapshot(){await authority();const result=await reader.storage.readJsonBounded(binding.root+'/complete.json',8*1024**2);const value=result?.found?result.value:null;assert.equal(rawDigest(value),binding.snapshotSha,'spool_snapshot_changed');return value;}
 async function verifyReadGrant(){try{await authority();assert.equal(rawDigest(await storage.readJson(reader.key,null)),readerPinDigest,'spool_reader_pin_changed');await assertRawCoordinationPolicy(storage,readerPin.coordination.policy);const current=await storage.readJson(RAW_COORDINATION_KEY,null);for(const key of[binding.root+'/complete.json',root+'/complete.json'])assertRawReadPermit(current,readerPin.coordination.ticket,key);}catch(error){state='failed';throw error;}}
 await assertSnapshot();
 return Object.freeze({root,bindingSha256:hash,upstream:Object.freeze({readJson:sourceRead}),store:Object.freeze({readJson:destinationRead,writeJson:destinationWrite}),assertAuthority:authority,assertLocalState,assertSnapshot,verifyReadGrant,
 async seal(expectedManifest){
  assert.equal(state,'capturing','spool_writes_closed');assert.equal(pending.size,0,'spool_io_pending');state='sealing';
  try{
   const snapshot=await assertSnapshot();await verifyReadGrant();
   const result=await reader.storage.readJsonBounded(root+'/complete.json',16*1024**2),saved=result?.found?result.value:null;
   assert.deepEqual(saved,expectedManifest,'spool_complete_changed');assertChunkSpoolManifest(saved,binding);
   const verifier=paidEncarSavedPageVerifier(snapshot,{runId:binding.run,attempt:binding.attempt,headSha:binding.producerSha});
   assert.ok(verifier?.verify&&verifier?.finish,'spool_original_verifier_required');let page=1,rows=0;
   for(const expected of saved.chunks){
    await verifyReadGrant();
    const key=root+`/chunks/${expected.number}/`;
    const c=await reader.storage.readJsonBounded(key+'commit.json',4096);assert.ok(c?.found,'spool_chunk_commit_missing');assert.deepEqual(c.value,expected,'spool_chunk_commit_changed');
    const d=await reader.storage.readJsonBounded(key+'data.json',4*1024**2);assert.ok(d?.found,'spool_chunk_data_missing');const data=d.value;
    assert.equal(rawDigest(data),expected.dataSha,'spool_chunk_digest');assert.equal(Buffer.byteLength(JSON.stringify(data)),expected.bytes,'spool_chunk_bytes');
    assert.equal(data?.version,1);assert.equal(data.binding,hash);assert.ok(Array.isArray(data.pairs)&&data.pairs.length===expected.last-expected.first+1,'spool_chunk_pairs');
    for(let offset=0;offset<data.pairs.length;offset+=4){
     const group=data.pairs.slice(offset,offset+4);
     for(let i=0;i<group.length;i++)assert.equal(group[i].page,page+i,'spool_chunk_page');
     const settled=await Promise.allSettled(group.map(pair=>reader.storage.readJsonBounded(binding.root+`/page-receipts/${pair.page}.json`,4*1024**2)));
     const failed=settled.find(x=>x.status==='rejected');if(failed)throw failed.reason;
     for(let i=0;i<group.length;i++){
      const pair=group[i],original=settled[i].value;
      assert.ok(original?.found,'spool_original_receipt_missing');assert.equal(rawDigest(original.value),rawDigest(pair.receipt),'spool_original_receipt_changed');
      verifier.verify(page,pair.rows,pair.receipt);rows+=pair.rows.length;page++;
     }
    }
   }
   verifier.finish();assert.equal(rows,binding.count);assert.equal(page,binding.pages+1);
   await verifyReadGrant();await assertSnapshot();
   sealedManifest=structuredClone(saved);await writer.add([{...spoolRef,sha256:rawDigest(saved)}]);const handoff=await writer.handoff();state='sealed';
   return Object.freeze({handoff,root,manifestSha256:rawDigest(saved),publicationAuthority:false,retirementReady:false});
  }catch(error){state='failed';throw error;}
 },
 async beginReplayBatch(number){assert.equal(state,'sealed','spool_not_sealed');assert.equal(replayBatch,null,'spool_replay_batch_active');const chunk=sealedManifest.chunks[number-1];assert.equal(chunk?.number,number,'spool_replay_chunk');replayBatch={opening:true};await verifyReadGrant();await assertSnapshot();replayBatch={number,first:chunk.first,last:chunk.last,reads:0};},
 assertReplayKey(key){assert.equal(state,'sealed','spool_not_sealed');assert.ok(replayBatch&&!replayBatch.opening&&!replayBatch.closing,'spool_replay_batch_required');assert.ok(sourceKey(key),'spool_source_key');const m=/\/(?:pages|page-receipts)\/([1-9]\d*)\.json$/.exec(key);assert.ok(m&&Number(m[1])>=replayBatch.first&&Number(m[1])<=replayBatch.last,'spool_replay_page');assert.ok(++replayBatch.reads<=2*(replayBatch.last-replayBatch.first+1),'spool_replay_read_bound');},
 async endReplayBatch(){assert.ok(replayBatch&&!replayBatch.opening&&!replayBatch.closing,'spool_replay_batch_required');replayBatch.closing=true;await verifyReadGrant();await assertSnapshot();replayBatch=null;},
 async finishRead(){assert.equal(state,'sealed','spool_not_sealed');assert.equal(replayBatch,null,'spool_replay_batch_active');assert.equal(pending.size,0,'spool_io_pending');state='finishing';await assertSnapshot();await reader.finishRead();state='closed';},
 // Crash/failure leaves real claims protected; no fabricated terminal proof or deletion.
 status:()=>({state,pending:pending.size,publicationAuthority:false,retirementReady:false})});
}
