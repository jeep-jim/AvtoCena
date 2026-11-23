import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ObjectJsonStorage} from '../apps/web/lib/data.ts';
import {rawProducerOwner} from './lib/catalog-raw-provenance.mjs';
import {OWNED_CHINA_PREPARED,prepareOwnedChinaPublicationSource} from './lib/owned-china-publication-source.mjs';
import {ownedChinaCoverage,verifiedOwnedReplica} from './lib/owned-china-active-coverage.mjs';

const native=path.resolve(process.argv[2]),pin='fdb1bc1b98c97256e7b94988aeeeab996f2f9e4b';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:native,encoding:'utf8'}).trim(),pin);
const load=name=>import(pathToFileURL(path.join(native,'apps/web/lib/catalog',name+'.ts')).href);
const readerOwner=rawProducerOwner(),storage=new ObjectJsonStorage(),head=await storage.readJson(OWNED_CHINA_PREPARED,null);
const get=async route=>{
 assert(/^runs\/[0-9]+(?:\/attempts\/[0-9]+\/jobs\?per_page=100)?$/.test(route),'unsupported Actions path');
 const response=await fetch('https://api.github.com/repos/jeep-jim/AvtoCena/actions/'+route,{
  headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30_000)});
 assert(response.ok,'official producer lookup failed');return response.json();
};
assert(/^[1-9]\d{0,19}$/.test(head?.runId),'owned download missing');
const run=await get('runs/'+head.runId);
const temp=await mkdtemp(path.join(process.env.RUNNER_TEMP,'owned-china-source-'));
console.log(JSON.stringify({stage:'open_saved_source',run:head.runId,cursor:head.cursor,rows:head.observations}));
const prepared=await prepareOwnedChinaPublicationSource({storage,readActions:get,readerOwner,
 downloadOwner:{runId:String(run.id),attempt:String(run.run_attempt),revision:run.head_sha},
 directory:path.join(temp,'archive'),outputDirectory:path.join(temp,'converted')});
const config=JSON.parse(await readFile(new URL('../data/catalog/che168-snapshot-v1.json',import.meta.url),'utf8'));
const witness=await verifiedOwnedReplica({prepared,readerOwner,storage,config,temporaryParent:temp});
console.log(JSON.stringify({stage:'closed_replica_verified',rows:witness.snapshot.rows,cursor:witness.replicaReadback.cursor}));
const {openConfiguredChinaRegcloudFiles}=await load('china-regcloud-object-reader');
const {openIndependentChinaRegcloud}=await load('independent-market-activation-fixture');
const {openIndependentChinaPrepared}=await load('independent-china-prepared-fixture');
const {createPreparedCoverageIdsDigest}=await load('prepared-price-coverage');
const files=await openConfiguredChinaRegcloudFiles();
assert(files&&files.ready.generationId===prepared.plan.control.state.active.generationId&&
 files.readySha256===prepared.plan.control.state.active.readySha256,'public control changed');
const publication=openIndependentChinaRegcloud(files),base=await publication.observe();
const {snapshot,orderedAdmittedIdsSha256}=await openIndependentChinaPrepared(publication);
assert(base.generationId===snapshot.generationId&&base.cursor?.stream===prepared.plan.source.cursor.stream&&
 (base.cursor.sequence<prepared.plan.source.cursor.sequence||base.cursor.sequence===prepared.plan.source.cursor.sequence&&
 base.cursor.anchorSha256===prepared.plan.source.cursor.anchorSha256),'incumbent cursor mismatch');
async function* incumbentIds(){
 const ids=createPreparedCoverageIdsDigest();
 for(let i=0;i<snapshot.chunks.length;i+=4){
  const batches=await Promise.all(snapshot.chunks.slice(i,i+4).map(async key=>{
   const chunk=await snapshot.readChunk(key);
   return Promise.all(Array.from({length:chunk.partCount},(_,part)=>chunk.load(part)));
  }));
  for(const parts of batches)for(const part of parts)for(const row of part.projection.items){ids.add(row.id);yield row.id;}
 }
 assert.equal(ids.finish(),orderedAdmittedIdsSha256,'incumbent ordered ids changed');
 await snapshot.assertCurrent();
}
const coverage=await ownedChinaCoverage({prepared,witness,incumbentIds,incumbent:snapshot});
await files.assertPointer();
console.log(JSON.stringify({stage:'source_incumbent_coverage',...coverage,sourceObservedAt:new Date(prepared.plan.source.observedAt).toISOString(),
 incumbentCursor:base.cursor.sequence,downloadCursor:head.cursor,frozenRateRun:prepared.plan.evidence.prepared.rateRun,
 rateSources:Object.fromEntries(['CNY','RUB','EUR','USD'].map(code=>[code,prepared.rates.rates[code]?.rateSource??null])),
 published:false,cursorMoved:false}));
