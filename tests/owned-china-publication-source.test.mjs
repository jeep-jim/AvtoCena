import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {archiveIntakeDirectory} from '../scripts/lib/nonjp-intake-archive.mjs';
import {recordChinaDownloadReceipt} from '../scripts/lib/owned-china-verification.mjs';
import {prepareOwnedChinaPublicationSource,OWNED_CHINA_PREPARED,OWNED_CHINA_PUBLIC_CONTROL} from '../scripts/lib/owned-china-publication-source.mjs';

const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const sourceOwner={runId:'1000',attempt:'1',revision:'a'.repeat(40)};
const producer={runId:'2000',attempt:'1',revision:'b'.repeat(40)};
const readerOwner={runId:'3000',attempt:'1',revision:'c'.repeat(40)};
const time='2026-11-22T11:00:00.000Z',terminal='2026-11-22T11:01:00.000Z',now=Date.parse('2026-11-22T12:00:00Z');
const prefix='catalog/owned-feed/v1/china';

async function fixture({resumed=false,sourceDeadline,reportDeadline,withdrawals=[],editReport=()=>{}}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-china-source-'));
  const input=path.join(root,'input'),directory=path.join(root,'restored'),outputDirectory=path.join(root,'converted');
  await fs.mkdir(input);
  const objects=new Map(),versions=new Map(),writes=[];
  const put=(key,value)=>{objects.set(key,structuredClone(value));versions.set(key,(versions.get(key)??0)+1);};
  const storage={driver:'object',readJson:async(key,fallback)=>structuredClone(objects.get(key)??fallback),
    readJsonWithMeta:async(key,fallback)=>({found:objects.has(key),value:structuredClone(objects.get(key)??fallback),etag:objects.has(key)?'"'+versions.get(key)+'"':undefined}),
    getBinary:async key=>{const data=Buffer.from(JSON.stringify(objects.get(key)));return {data,size:data.length,checksum:hash(data)};},
    writeJson:async(key,value,condition)=>{
      if(condition?.ifNoneMatch==='*'&&objects.has(key)||condition?.ifMatch&&condition.ifMatch!=='"'+versions.get(key)+'"'){
        const error=Error('storage_conflict');error.name='StorageConflictError';throw error;
      }
      writes.push(key);put(key,value);
    }};
  const replicaManifest={version:1,binding:'e'.repeat(64),cursor:102,bytes:4096,parts:[{bytes:4096,sha256:'d'.repeat(64)}]};
  const replica={key:'catalog/provider-replicas/che168/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',sha256:hash(replicaManifest),binding:replicaManifest.binding,cursor:102};
  put(replica.key+'/manifest.json',replicaManifest);
  const report={version:1,market:'china',provider:'auto_api_che168',completed:true,completedAt:'2026-11-22T11:20:00.000Z',sources:[{
    sourceId:'autohome_used_china_open',provider:'auto_api_che168',ownedFeedRun:'1000',completeInventory:true,stopReason:'source_finished',
    initialCursor:100,cursor:102,changes:1,observations:1,uniqueOffers:1,snapshotBinding:replica.binding,replica,rejectedIdentity:0,
    ...(reportDeadline===undefined?{}:{validUntil:reportDeadline}),
  }],confirmedWithdrawals:withdrawals};
  editReport(report);
  await fs.writeFile(path.join(input,'report.json'),JSON.stringify(report));
  await fs.writeFile(path.join(input,'autohome_used_china_open-000001.jsonl'),JSON.stringify({offer:{
    id:'1'.repeat(24),market:'china',sourcePrice:100000,sourceCurrency:'CNY',make:'Toyota',model:'Corolla',year:2024,status:'active',
  }})+'\n');
  const receipt=await archiveIntakeDirectory({storage,directory:input,market:'china',owner:producer});
  put(OWNED_CHINA_PREPARED,{version:1,market:'china',runId:'1000',cursor:102,archiveRoot:receipt.root,
    archiveSha256:receipt.manifestSha256,observations:1,rateRun:'1000'});
  put(OWNED_CHINA_PUBLIC_CONTROL,{version:1,market:'china',revision:6,
    active:{runId:'full-fresh-999-1',generationId:'gen_1795166586455_china999',readySha256:'f'.repeat(64)},previous:null});
  const cut={version:1,market:'china',runId:'1000',status:'complete',startCursor:100,cursor:102,pages:1,rows:1,
    startedAt:time,completedAt:terminal,...(sourceDeadline===undefined?{}:{source:{validUntil:sourceDeadline}})};
  put(prefix+'/runs/1000/complete.json',cut);
  put(prefix+'/runs/1000/pages/100.json',{version:1,cursor:100,receivedAt:time,
    payload:{meta:{cur_change_id:100,next_change_id:102},result:[{id:101,inner_id:'11',change_type:'added'}]}});
  put(prefix+'/runs/1000/pages/102.json',{version:1,cursor:102,receivedAt:terminal,payload:{meta:{cur_change_id:102},result:[]}});
  put('catalog/feed-rates/v1/china/1000.json',{version:1,market:'china',runId:'1000',capturedAt:time,
    rates:Object.fromEntries(['CNY','EUR','USD'].map(currency=>[currency,{currency,effectiveRate:12,rateSource:'cbr_live'}]))});
  const downloadOwner=resumed?{...sourceOwner,runId:'1001'}:{...sourceOwner};
  if(resumed)await recordChinaDownloadReceipt(storage,cut,{runId:downloadOwner.runId,attempt:downloadOwner.attempt,producerSha:downloadOwner.revision});
  function authority(owner,workflow,jobNames,event){
    const run={id:Number(owner.runId),run_attempt:Number(owner.attempt),head_sha:owner.revision,head_branch:'main',path:workflow,event,
      status:'completed',conclusion:'success',repository:{id:1289722938,full_name:'jeep-jim/AvtoCena'},head_repository:{id:1289722938}};
    return {run,jobs:{total_count:jobNames.length,jobs:jobNames.map((name,index)=>({id:8000+index,name,run_id:run.id,head_sha:run.head_sha,
      status:'completed',conclusion:name==='recover_existing_intake'?'skipped':'success'}))}};
  }
  const authorities=new Map([
    [producer.runId,authority(producer,'.github/workflows/catalog-prepare-owned-china.yml',['prepare'],'workflow_run')],
    [downloadOwner.runId,authority(downloadOwner,'.github/workflows/catalog-refresh-china.yml',['download','recover_existing_intake'],'schedule')],
  ]);
  const calls=[];
  const readActions=async route=>{calls.push(route);const match=/^runs\/(\d+)(?:\/attempts\/(\d+)\/jobs\?per_page=100)?$/.exec(route);assert(match);
    const actual=authorities.get(match[1]);assert(actual);return structuredClone(match[2]?actual.jobs:actual.run);};
  const options={storage,readActions,downloadOwner,readerOwner,directory,outputDirectory,clock:()=>now};
  const baseline=writes.length;
  return {root,options,objects,versions,writes,put,receipt,report,authorities,calls,baseline,
    close:()=>fs.rm(root,{recursive:true,force:true})};
}

test('real saved archive restores, converts and streams an exact independently scoped input plan',async()=>{
  const f=await fixture();
  try{
    const result=await prepareOwnedChinaPublicationSource(f.options);
    assert.equal(result.plan.verifiedInput,true);assert.equal(result.plan.activationReady,false);
    assert.equal(result.plan.publicationAuthorized,false);assert.equal(result.plan.cursorAdvanceAuthorized,false);
    assert.equal(result.plan.evidence.producer.runId,'2000');assert.equal(result.plan.evidence.prepared.runId,'1000');
    assert.equal(result.plan.source.observedAt,Date.parse(terminal),'materialization time never refreshes supplier time');
    assert.equal(result.plan.source.validUntil,Date.parse(terminal)+48*3600_000);
    assert.equal(result.plan.evidence.replica.sha256,f.report.sources[0].replica.sha256);
    assert.equal(result.plan.evidence.replica.inventoryReadbackVerified,false);
    assert.deepEqual(result.plan.evidence.withdrawals,{records:0,uniqueIds:0,sha256:hash([]),coverage:'reported_removal_events',publicRetirementVerified:false});
    assert.equal(result.plan.source.cursor.sequence,102);assert.equal(result.plan.control.etag,'"1"');
    assert.equal(result.plan.sourceArchiveRows,1);assert.equal(result.plan.conversion.uniqueObservations,1);
    assert.deepEqual(result.report.durableIntakeArchive,result.receipt);
    const rows=[];for await(const batch of result.chunks())rows.push(...batch);
    assert.equal(rows.length,1);assert.equal(rows[0].id,'1'.repeat(24));await result.assertCurrent();
    assert.deepEqual(f.writes.slice(f.baseline),[],'uncoordinated fixture has no storage writes');
    assert(!f.calls.some(route=>route.includes('dispatch')));
  }finally{await f.close();}
});

test('source expiry uses the earlier sealed deadline and never the later report clock',async()=>{
  const until=now+3600_000;
  const f=await fixture({sourceDeadline:until,reportDeadline:new Date(until+3600_000).toISOString()});
  try{
    const result=await prepareOwnedChinaPublicationSource(f.options);
    assert.equal(result.plan.source.observedAt,Date.parse(terminal));assert.equal(result.plan.source.validUntil,until);
    assert.equal(result.plan.evidence.freshness.deadlines.length,2);
  }finally{await f.close();}
  for(const sourceDeadline of [now-1,'invalid',Date.parse(terminal)]){
    const broken=await fixture({sourceDeadline});
    try{await assert.rejects(prepareOwnedChinaPublicationSource(broken.options),/owned_china_source_(stale|deadline)/);}
    finally{await broken.close();}
  }
});

test('replica generation and exact reported withdrawal census remain bound to the archived report',async()=>{
  const sourceId='autohome_used_china_open',sourceOfferId='11';
  const row={id:createHash('sha256').update(sourceId+':'+sourceOfferId).digest('hex').slice(0,24),
    sourceId,sourceOfferId,market:'china',status:'removed',observedAt:time};
  const f=await fixture({withdrawals:[row]});
  try{
    const result=await prepareOwnedChinaPublicationSource(f.options);
    assert.equal(result.plan.evidence.withdrawals.records,1);assert.equal(result.plan.evidence.withdrawals.sha256,hash([row]));
    assert.equal(result.plan.evidence.withdrawals.publicRetirementVerified,false);
    f.objects.get(f.report.sources[0].replica.key+'/manifest.json').cursor=101;
    await assert.rejects(result.assertCurrent,/owned_china_replica_manifest/);
  }finally{await f.close();}
  for(const editReport of [
    report=>{report.confirmedWithdrawals=[{...row,id:'0'.repeat(24)}];},
    report=>{report.confirmedWithdrawals=[row,row];},
    report=>{report.sources[0].rejectedIdentity=1;},
    report=>{report.sources[0].replica.sha256='0'.repeat(64);},
  ]){
    const broken=await fixture({editReport});
    try{await assert.rejects(prepareOwnedChinaPublicationSource(broken.options),/owned_china_(report_|replica_)/);}
    finally{await broken.close();}
  }
});

test('resumed source keeps source and successful invocation owners distinct',async()=>{
  const f=await fixture({resumed:true});
  try{const {plan}=await prepareOwnedChinaPublicationSource(f.options);
    assert.equal(plan.evidence.download.resumedSourceRun,true);assert.equal(plan.evidence.downloader.runId,'1001');
    assert.equal(plan.evidence.prepared.runId,'1000');assert.equal(plan.evidence.producer.runId,'2000');
  }finally{await f.close();}
});

test('producer attempt/SHA/status, source owner, stale source and rate drift fail closed',async()=>{
  for(const damage of [
    f=>{f.authorities.get('2000').run.head_sha='0'.repeat(40);},
    f=>{f.authorities.get('2000').run.run_attempt=2;},
    f=>{f.authorities.get('2000').run.conclusion='failure';},
    f=>{f.options.downloadOwner={...sourceOwner,revision:'0'.repeat(40)};},
    f=>{f.options.clock=()=>now+49*3600_000;},
    f=>{f.objects.get('catalog/feed-rates/v1/china/1000.json').rates.CNY.effectiveRate=0;},
    f=>{f.objects.get(OWNED_CHINA_PREPARED).rateRun='1001';},
  ]){const f=await fixture();try{damage(f);await assert.rejects(prepareOwnedChinaPublicationSource(f.options),/owned_china_|china_download_/);}
    finally{await f.close();}}
});

test('same control bytes with a new ETag, prepared pointer drift, local corruption and mutable rates are rejected',async()=>{
  for(const kind of ['control','prepared','local','rates']){
    const f=await fixture();
    try{
      const result=await prepareOwnedChinaPublicationSource(f.options);
      if(kind==='control')f.put(OWNED_CHINA_PUBLIC_CONTROL,f.objects.get(OWNED_CHINA_PUBLIC_CONTROL));
      if(kind==='prepared')f.put(OWNED_CHINA_PREPARED,f.objects.get(OWNED_CHINA_PREPARED));
      if(kind==='rates')result.rates.rates.CNY.effectiveRate=100;
      if(kind==='local'){
        const filename=path.join(result.outputDirectory,result.plan.converted[0].name);
        const value=JSON.parse(await fs.readFile(filename));value.offers[0].sourcePrice=1;
        await fs.writeFile(filename,JSON.stringify(value));
        await assert.rejects(async()=>{for await(const batch of result.chunks())void batch;},/owned_china_conversion_changed/);
      }else await assert.rejects(result.assertCurrent,/owned_china_(control_changed|prepared_changed|frozen_rates_changed)/);
    }finally{await f.close();}
  }
});

test('archive corruption and nonempty output never produce a ready input',async()=>{
  for(const kind of ['archive','output']){
    const f=await fixture();
    try{
      if(kind==='archive'){
        const manifest=f.objects.get(f.receipt.root+'/complete.json');
        const part=f.objects.get(manifest.files.find(file=>file.name.endsWith('.jsonl')).parts[0].key);
        part.sha256='0'.repeat(64);
      }else{
        await fs.mkdir(f.options.outputDirectory);await fs.writeFile(path.join(f.options.outputDirectory,'keep.txt'),'keep');
      }
      await assert.rejects(prepareOwnedChinaPublicationSource(f.options),kind==='archive'?/intake_archive_part_wire/:/owned_china_output_not_empty/);
      if(kind==='output')assert.equal(await fs.readFile(path.join(f.options.outputDirectory,'keep.txt'),'utf8'),'keep');
    }finally{await f.close();}
  }
});
