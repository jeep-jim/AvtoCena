import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ObjectJsonStorage,StorageConflictError} from '../apps/web/lib/data';
import {openConfiguredChinaRegcloudFiles} from '../apps/web/lib/catalog/china-regcloud-object-reader';
import {openIndependentChinaRegcloud} from '../apps/web/lib/catalog/independent-market-activation-fixture';
import {openIndependentChinaPrepared} from '../apps/web/lib/catalog/independent-china-prepared-fixture';
import {createPreparedChinaFilterIndex,selectPreparedChinaFilterPage} from '../apps/web/lib/catalog/prepared-china-filter-index';
import {createPreparedCoverageIdsDigest} from '../apps/web/lib/catalog/prepared-price-coverage';
import {compilePreparedChinaCompatibilityPredicate} from '../apps/web/lib/catalog/storage';

// Build from the accepted public cut. A separate reviewed runtime pins the
// result. This command never writes manifests, receipts, prices or pointers.
const expected=process.argv[2];
assert(/^gen_\d{13}_china\d+$/.test(expected),'expected China generation required');
const source=await openConfiguredChinaRegcloudFiles();
assert(source,'no independent publication');
const active=await openIndependentChinaPrepared(openIndependentChinaRegcloud(source));
assert(active?.snapshot.generationId===expected,'live China generation changed');
const snapshot=active.snapshot;
const context={generationId:expected,marketDigest:snapshot.marketDigest,rows:snapshot.rows};
const writer=createPreparedChinaFilterIndex(context);
const ids=createPreparedCoverageIdsDigest();
const query={market:'china',powerTo:160} as const;
const matches=await compilePreparedChinaCompatibilityPredicate(query);
let observed=0,under160=0;
for(let start=0;start<snapshot.chunks.length;start+=4){
  const batch=await Promise.all(snapshot.chunks.slice(start,start+4).map(async chunk=>{
    const reader=await snapshot.readChunk(chunk);
    const parts=await Promise.all(Array.from({length:reader.partCount},(_,i)=>reader.load(i)));
    return {chunk,parts};
  }));
  for(const {chunk,parts} of batch)for(const [part,block] of parts.entries()){
    for(const [offset,row] of block.projection.items.entries()){
      ids.add(row.id);writer.add(row,{id:row.id,chunk,part,offset});
      observed++;if(matches(row))under160++;
    }
  }
  if(start%24===0){await snapshot.assertCurrent();console.log(JSON.stringify({chunks:start+batch.length,observed}));}
}
assert.equal(observed,snapshot.rows);
assert.equal(ids.finish(),active.orderedAdmittedIdsSha256,'admitted IDs changed');
await snapshot.assertCurrent();
const store=new ObjectJsonStorage();
const prefix='catalog/derived-read-cache/china/'+snapshot.directorySha256+'/';
const logical='catalog/generations/'+expected+'/indexes/prepared-china-read-v1/filters-v1/';
const key=(name:string)=>{
  assert(name.startsWith(logical));
  const rel=name.slice(logical.length);
  assert(/^(?:parts\/\d+-|ready-)[a-f0-9]{64}\.json$/.test(rel));
  return prefix+rel;
};
const read=async(name:string,sha:string)=>{
  const result=await store.getBinaryBounded(key(name),4*1024*1024);
  assert.equal(result.checksum,sha);
  return result.data;
};
const ref=await writer.publish(async(name,body)=>{
  const sha=createHash('sha256').update(body).digest('hex');
  assert(name.endsWith(sha+'.json'));
  try{await store.putBinary(key(name),body,'application/json',{ifNoneMatch:'*'});}
  catch(error){if(!(error instanceof StorageConflictError))throw error;}
  assert((await read(name,sha)).equals(body));
});
const filtered=await selectPreparedChinaFilterPage(context,ref,query,{start:0,pageSize:24,countOnly:true},read);
assert.equal(filtered?.total,under160);
await snapshot.assertCurrent();
console.log(JSON.stringify({stage:'verified_china_filter_index',generationId:expected,marketDigest:snapshot.marketDigest,
  directorySha256:snapshot.directorySha256,rows:observed,powerTo160:under160,indexSha256:ref.sha256}));
