import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {normalizeAutoApiChe168} from '../apps/web/lib/catalog/auto-api-che168';
import {readCatalogProjectionBatches} from '../apps/web/lib/catalog-projection-parts.ts';
import {verifySourceContribution} from '../apps/web/lib/catalog/source-contribution-reader.mjs';
import {verifiedRawInternalPointerDescriptor} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';
import {snapshotBinding} from '../scripts/lib/che168-snapshot.mjs';
import {saveChe168Replica} from '../scripts/lib/che168-replica.mjs';
import {verifyChe168ReplicaInput} from '../scripts/lib/che168-replica-witness.mjs';
import {openRawFeedPin, rawDigest, rawGenerationKey, buildRawGenerationProvenance} from '../scripts/lib/catalog-raw-provenance.mjs';
import {observationShardWriter} from '../scripts/lib/catalog-intake-checkpoint.mjs';
import {archiveIntakeDirectory, attachIntakeArchiveReceipt} from '../scripts/lib/nonjp-intake-archive.mjs';
import {createChe168PublicationContributions, prepareChe168InternalContribution, prepareChe168PublicContribution,
  che168InputRowsProof, verifiedChe168InputReport} from '../scripts/lib/catalog-che168-contributions.mjs';
import {mergeOfferVersions, mergeFreshCatalogOffer} from '../scripts/lib/catalog-offer-merge.mjs';
import {convertMarketOnDisk} from '../scripts/lib/catalog-disk-conversion.mjs';
import {prepareRawPublication} from '../scripts/lib/catalog-raw-publication.mjs';
import {prepareRawInternalPublication} from '../scripts/lib/catalog-raw-internal-publication.mjs';

const sourceId='autohome_used_china_open',at='2026-11-16T12:00:00.000Z',oldAt='2026-10-09T08:09:40.000Z';
const generationId='gen_1794830400000_china-contribution';
const owner={runId:'43870000003',attempt:'1',revision:'a'.repeat(40)};
const config={version:1,date:'2026-10-09',filename:'active_offer.csv',host:'https://autobase-barrett.auto-api.com',
  initialCursor:20,bytes:100,etag:'"fixture-csv"',modifiedAt:oldAt,delimiter:'|'};

class Store {
  driver='object'; data=new Map(); binary=new Map(); reads=[]; writes=[];
  set(key,value){this.data.set(key,structuredClone(value));}
  async readJson(key,fallback){this.reads.push(key);return structuredClone(this.data.get(key)??fallback);}
  async readJsonWithMeta(key,fallback){const found=this.data.has(key),value=await this.readJson(key,fallback);return {found,value,...(found?{etag:'"'+rawDigest(value)+'"'}:{})};}
  async readJsonBounded(key,maximum){const value=await this.readJson(key,null),bytes=value===null?0:Buffer.byteLength(JSON.stringify(value));assert.ok(bytes<=maximum);return {found:value!==null,value,bytes};}
  async writeJson(key,value,condition={}) {
    const old=this.data.get(key);
    if(condition.ifNoneMatch&&old!==undefined || condition.ifMatch&&condition.ifMatch!=='"'+rawDigest(old)+'"') {
      const error=Error('storage_conflict');error.name='StorageConflictError';throw error;
    }
    this.writes.push({key,condition:structuredClone(condition)});this.set(key,value);
  }
  async putBinary(key,bytes){this.writes.push({key});this.binary.set(key,Buffer.from(bytes));}
  async getBinary(key){this.reads.push(key);if(this.binary.has(key))return {data:Buffer.from(this.binary.get(key))};
    if(this.data.has(key))return {data:Buffer.from(JSON.stringify(this.data.get(key)))};throw Error('missing_binary');}
  async listBucketObjects(){return [...this.data].map(([key,value])=>({key,size:Buffer.byteLength(JSON.stringify(value))}))
    .concat([...this.binary].map(([key,value])=>({key,size:value.length})));}
}

async function fixture(t) {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'china-contribution-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const directory=path.join(temporary,'intake'),scratch=path.join(temporary,'scratch');await fs.mkdir(directory);await fs.mkdir(scratch);
  const storage=new Store(),binding=snapshotBinding(config),journalBinding=rawDigest({binding,initialCursor:20,base:null,replayVersion:2});
  const journalKey='catalog/intake-working/che168-v1/'+BigInt('0x'+journalBinding.slice(0,14)).toString();
  const snapshotRoot='catalog/provider-snapshots/che168/'+binding;
  const pin=await openRawFeedPin({storage,owner,operationId:'actual-china-materialization-fixture',references:[
    {kind:'che168-snapshot',root:snapshotRoot},{kind:'che168-journal',root:journalKey}]});
  const filename=path.join(temporary,'source.sqlite'),db=new DatabaseSync(filename);
  db.exec('CREATE TABLE inventory(id TEXT PRIMARY KEY,payload TEXT NOT NULL,event INTEGER NOT NULL)');
  const rows=[],write=observationShardWriter(directory,sourceId);
  for(const id of ['42','43']) {
    const offer=normalizeAutoApiChe168({inner_id:id,data:{inner_id:id,url:'https://www.che168.com/dealer/1/'+id+'.html',
      mark:'Toyota',model:'Corolla',year:2022,price:90000,images:['https://2sc2.autoimg.cn/escimg/'+id+'.jpg']}},oldAt);
    assert.ok(offer);db.prepare('INSERT INTO inventory VALUES(?,?,?)').run(id,JSON.stringify(offer),19);
    offer.operational={...offer.operational,lastSeenAt:at,che168ActiveVerification:{method:'snapshot_and_complete_change_stream',
      snapshotBinding:binding,initialCursor:20,cursor:20,verifiedAt:at}};
    rows.push(offer);await write({stage:'detail',observedAt:at,offer});
  }
  db.close();
  const replica=await saveChe168Replica({storage,filename,binding,cursor:20,beforeWrite:root=>pin.add([{kind:'che168-replica',root}])});
  const report={version:1,provider:'auto_api_che168',market:'china',completed:true,startedAt:at,completedAt:at,
    confirmedWithdrawals:[],sources:[{sourceId,provider:'auto_api_che168',snapshotBinding:binding,snapshotStartedAt:oldAt,yearFrom:2014,
      syncMode:'snapshot',mode:'snapshot',pages:1,observations:rows.length,uniqueOffers:rows.length,rejectedIdentity:0,
      completeInventory:true,stopReason:'source_finished',initialCursor:20,cursor:20,changes:0,
      workingJournal:{key:journalKey,binding:journalBinding},replica}],rawStoragePins:[await pin.handoff()]};
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report));
  const witness=await verifyChe168ReplicaInput({storage,directory,config,producer:{runId:owner.runId,attempt:owner.attempt,sourceSha:owner.revision},temporaryParent:scratch});
  const withWitness={...report,sourceInputWitness:witness};await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(withWitness));
  const intake=attachIntakeArchiveReceipt(withWitness,await archiveIntakeDirectory({storage,directory,market:'china',owner}));
  const internalKey=`catalog/internal/offers/${sourceId}/${generationId}-chunk-00001.json`;
  const publicKey=`catalog/generations/${generationId}/offers/china/chunk-00001.json`;
  const internalManifest={generationId,updatedAt:at,sources:{[sourceId]:{count:rows.length,chunks:[internalKey],updatedAt:at}}};
  const manifest={version:2,generationId,updatedAt:at,markets:{china:{count:rows.length,chunks:['chunk-00001']}}};
  const materialized=rows.map(mergeFreshCatalogOffer);
  storage.set(internalKey,materialized);storage.set(publicKey,materialized);storage.set('catalog/internal/manifest.json',internalManifest);
  storage.set(`catalog/generations/${generationId}/indexes/projection/china.json`,{generationId,items:rows.map(({id})=>({id}))});
  return {storage,directory,temporary,rows,materialized,replica,journalKey,snapshotRoot,witness,intake,internalKey,publicKey,internalManifest,manifest};
}
function newTracker(f,options={}) {
  return createChe168PublicationContributions({intake:f.intake,freshOffers:f.rows,sellerInventory:true,compactPublic:row=>row,
    sourceSha:owner.revision,calculationVersion:'b'.repeat(64),...options});
}
function tracking(f,retainedRows=null) {
  const contributions=newTracker(f);assert.ok(contributions);const materialized=[];
  for(const row of f.rows) {
    const retained=retainedRows?.find(value=>value.id===row.id);
    if(retained)contributions.observeMerge(retained,undefined,mergeOfferVersions(retained,undefined),{phase:'retained'});
    const result=mergeOfferVersions(row,retained);materialized.push(result);
    contributions.observeMerge(row,retained,result);contributions.recordAudited(result,result);
  }
  contributions.captureSelected(materialized);contributions.captureNormalized(materialized);contributions.captureFinal(materialized);
  return {contributions,materialized};
}
function historicBaseline(f) {
  const oldGeneration='gen_1794744000000_old-china',oldRoot='catalog/provider-replicas/che168/11111111-1111-1111-1111-111111111111';
  const baseline={version:2,generationId:oldGeneration,updatedAt:oldAt,markets:{china:{count:2,chunks:['old-china']}}};
  const prior=buildRawGenerationProvenance({manifest:baseline,marketSources:{china:{complete:false,producers:[],
    unknownSources:['historic_provenance_missing'],references:[{kind:'che168-replica',root:oldRoot,sha256:'c'.repeat(64)}]}},paidReports:{generationId:oldGeneration,manifestSha256:rawDigest(baseline),market:'korea',count:0,paidCount:0,chunkProofs:[],observations:[]}});
  f.storage.set('catalog/manifest.json',baseline);f.storage.set(rawGenerationKey(oldGeneration),prior);return {baseline,prior,oldRoot};
}

test('actual independent SQLite replica passes archive, converter and both generic contribution phases',async t=>{
  const f=await fixture(t);assert.deepEqual(che168InputRowsProof(f.rows),f.witness.normalized);
  const out=path.join(f.temporary,'converted');await fs.mkdir(out);
  await convertMarketOnDisk({market:'china',directory:f.directory,files:[sourceId+'-000001.jsonl'],out,report:f.intake});
  const converted=JSON.parse(await fs.readFile(path.join(out,'catalog-rebuild-china-0001.json'),'utf8'));
  assert.deepEqual(converted.report.sourceInputWitness,f.witness);assert.equal(rawDigest(converted.offers),rawDigest(f.rows));
  const {contributions}=tracking(f);assert.equal(contributions.reason,null);
  const internal=await prepareChe168InternalContribution({storage:f.storage,manifest:f.internalManifest,contributions});assert.ok(internal);
  const internalPublication=await prepareRawInternalPublication({storage:f.storage,manifest:f.internalManifest,baseManifest:null,
    intake:f.intake,operationId:'actual-independent-china',contributionCapabilities:[internal]});
  await internalPublication.verifyBeforeCommit();
  const descriptor=await verifiedRawInternalPointerDescriptor({storage:f.storage,manifest:f.internalManifest,provenance:internalPublication.provenance});
  assert.ok(descriptor.complete,'all internal rows have the actual source witness');
  const proof=await prepareChe168PublicContribution({...f,contributions,internal,readProjectionBatches:readCatalogProjectionBatches});assert.ok(proof);
  const checked=await verifySourceContribution({storage:f.storage,...proof.reference,internalManifest:f.internalManifest,publicManifest:f.manifest,stage:'public'});
  assert.equal(checked.count,2);assert.equal(proof.proof.input.snapshotRoot,f.replica.key);
  assert.ok(proof.proof.references.some(row=>row.root===f.replica.key));
  assert.ok(f.storage.reads.every(key=>!key.includes('/japan/')));
});

test('deduplicated same-ID changed bytes invalidate only the optional input witness',async t=>{
  const f=await fixture(t),out=path.join(f.temporary,'changed');await fs.mkdir(out);
  await fs.appendFile(path.join(f.directory,sourceId+'-000001.jsonl'),JSON.stringify({offer:{...f.rows[0],sourcePrice:1}})+'\n');
  await convertMarketOnDisk({market:'china',directory:f.directory,files:[sourceId+'-000001.jsonl'],out,report:f.intake});
  const saved=JSON.parse(await fs.readFile(path.join(out,'catalog-rebuild-china-0001.json'),'utf8'));
  assert.equal(saved.report.sourceInputWitness,undefined);assert.equal(saved.offers[0].sourcePrice,1);
  assert.equal(saved.report.completedAt,f.intake.completedAt);assert.deepEqual(saved.report.sources[0].replica,f.replica);
  assert.equal(verifiedChe168InputReport(f.intake,f.rows),f.intake);
});

test('the actual commercial merge qualifies only when retained bytes contribute nothing',async t=>{
  const f=await fixture(t);
  // A retained row containing only the same ID contributes no field. Both
  // branches execute the actual commercial merge from the entrypoint.
  const retained=f.rows.map(row=>({id:row.id}));
  for(const row of f.rows)assert.deepEqual(mergeOfferVersions(row,{id:row.id}),mergeOfferVersions(row,{}));
  const {contributions,materialized}=tracking(f,retained);assert.equal(contributions.reason,null);
  f.storage.set(f.internalKey,materialized);f.storage.set(f.publicKey,materialized);
  assert.ok(await prepareChe168InternalContribution({storage:f.storage,manifest:f.internalManifest,contributions}));
});

test('manual technical data, older first-seen, prices and photos never become independent through a caller callback',async t=>{
  const f=await fixture(t),row=f.rows[0];
  for(const retained of [
    {id:row.id,powerHp:210,powerDataSource:'manual',power30MinKw:88},
    {id:row.id,firstSeenAt:'2025-01-01T00:00:00Z'},
    {id:row.id,calculationSnapshot:{manualPriceRub:999999}},
    {id:row.id,totalRub:999999},
    {id:row.id,operational:{oldExtraField:'retained',raw:{legacyOnly:true}}},
    {id:row.id,images:[{url:'https://2sc2.autoimg.cn/escimg/old-only.jpg'}]},
  ]) {
    const result=mergeOfferVersions(row,retained),contributions=newTracker(f,{freshOnlyMerge:()=>result});
    contributions.observeMerge(row,retained,result);
    assert.match(contributions.reason,/^che168_contribution_borrowed_merge/);assert.equal(contributions.snapshot(),null);
  }
  const {contributions}=tracking(f);contributions.recordAudited({...row,id:'old_only'},row);
  assert.ok(contributions.reason,'a retained-only audited row cannot become source-derived');
});

test('partial, mismatched source and another reusable China source preserve conservative coverage',async t=>{
  const f=await fixture(t);
  for(const mutate of [
    value=>{value.partial=true;},value=>{value.sources[0].completeInventory=false;},value=>{value.sources[0].syncMode='delta';},
    value=>{value.rawArchiveDependencies=[{root:'old'}];},value=>{value.sources[0].replica.sha256='f'.repeat(64);},
    value=>{delete value.sourceInputWitness;},
  ]) {const intake=structuredClone(f.intake);mutate(intake);assert.equal(newTracker(f,{intake}),null);}
  assert.equal(newTracker(f,{sourceSha:null}),null);
  assert.equal(newTracker(f,{freshOffers:[...f.rows,{...f.rows[0],id:'new-source',sourceId:'autohome_new_china_open'}]}),null);
  const {contributions}=tracking(f),before=f.storage.writes.length;
  const manifest=structuredClone(f.internalManifest);manifest.sources.autohome_new_china_open={count:1,chunks:['old-new-source']};
  assert.equal(await prepareChe168InternalContribution({storage:f.storage,manifest,contributions,reusableSourceIds:[sourceId]}),null);
  assert.equal(f.storage.writes.length,before,'caller cannot narrow the fixed other-source requirement');
});

test('independent actual materialization retires historic union while preserving all current raw roots',async t=>{
  const f=await fixture(t),old=historicBaseline(f),{contributions}=tracking(f);
  const internal=await prepareChe168InternalContribution({storage:f.storage,manifest:f.internalManifest,contributions});assert.ok(internal);
  const proof=await prepareChe168PublicContribution({...f,contributions,internal,readProjectionBatches:readCatalogProjectionBatches});assert.ok(proof);
  const publication=await prepareRawPublication({storage:f.storage,manifest:f.manifest,expectedBaseGenerationId:old.baseline.generationId,
    market:'china',intake:f.intake,contributions:proof});await publication.verify();
  const saved=await f.storage.readJson(rawGenerationKey(generationId),null);
  assert.equal(saved.markets.china.complete,true);assert.deepEqual(saved.markets.china.unknownSources,[]);
  const roots=new Set(saved.markets.china.references.map(row=>row.root));assert.ok(!roots.has(old.oldRoot));
  for(const root of [f.replica.key,f.journalKey,f.snapshotRoot,f.intake.durableIntakeArchive.root])assert.ok(roots.has(root));
  assert.deepEqual(await f.storage.readJson(rawGenerationKey(old.baseline.generationId),null),old.prior,'previous provenance is immutable');
  assert.deepEqual(await f.storage.readJson('catalog/manifest.json',null),old.baseline,'preparation does not switch public pointers');
});

test('no source proof leaves historic roots and unknown metadata protected',async t=>{
  const f=await fixture(t),old=historicBaseline(f);
  const publication=await prepareRawPublication({storage:f.storage,manifest:f.manifest,expectedBaseGenerationId:old.baseline.generationId,
    market:'china',intake:f.intake});await publication.verify();
  const saved=await f.storage.readJson(rawGenerationKey(generationId),null);
  assert.equal(saved.markets.china.complete,false);assert.deepEqual(saved.markets.china.unknownSources,['historic_provenance_missing']);
  assert.ok(saved.markets.china.references.some(row=>row.root===old.oldRoot));
});
