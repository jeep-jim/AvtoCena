import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {EXPECTED,proveUaeDelta} from './uae-delta-proof.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const cd='catalog/intake-cursors/v1/uae.json',md='catalog/manifest.json';
function fixture(){
  const data=new Map(),calls=[],expected=structuredClone(EXPECTED);
  function archive(p){
    const root=`catalog/nonjp-intake/v1/uae/${p.run}/1`;
    const report={market:'uae',provider:'auto_api_dubicars',startedAt:p.startedAt,completedAt:p.completedAt,completed:true,productionWrites:false,requiredSourceIds:['dubicars_uae_exact'],
      sources:[{...p,provider:'auto_api_dubicars',sourceId:'dubicars_uae_exact',rejectedIdentity:0,snapshotStartedAt:expected.baseline.startedAt,stopReason:p.mode==='snapshot'?'source_finished':'source_changes_finished'}],confirmedWithdrawals:[]};
    const raw=Buffer.from(JSON.stringify(report)),sha256=hash(raw);
    const key=root+'/files/report.json/0-'+sha256+'.json';
    const manifest={version:1,kind:'nonjp-intake',market:'uae',owner:{runId:p.run,attempt:'1'},collection:{complete:true},
      files:[{name:'raw-dubicars_uae_exact-000001.jsonl'},{name:'dubicars_uae_exact-000001.jsonl'},{name:'report.json',bytes:raw.length,sha256,parts:[{key,sha256,bytes:raw.length}]}],reportDigest:sha256};
    p.hash=hash(JSON.stringify(manifest));
    data.set(root+'/complete.json',manifest);
    data.set(key,{version:1,encoding:'gzip-base64',payload:gzipSync(raw).toString('base64'),sha256,bytes:raw.length});
  }
  archive(expected.baseline);archive(expected.delta);
  const activeGen='gen_1894878284419_abcd1234';
  data.set(md,{version:2,generationId:activeGen,markets:{uae:{count:expected.activeCount,updatedAt:expected.activeAt,chunks:['chunk-0001','chunk-0051']},china:{unrelated:true}}});
  data.set(cd,{version:1,market:'uae',generationId:expected.generation,sources:[{sourceId:'dubicars_uae_exact',provider:'auto_api_dubicars',cursor:expected.baseline.cursor,stopReason:'source_finished',snapshotStartedAt:expected.baseline.startedAt}],
    durableIntakeArchive:{root:`catalog/nonjp-intake/v1/uae/${expected.baseline.run}/1`,manifestSha256:expected.baseline.hash}});
  data.set('catalog/generations/'+activeGen+'/offers/uae/chunk-0001.json',[{market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:'private-id'}]);
  data.set('catalog/generations/'+activeGen+'/offers/uae/chunk-0051.json',[{market:'uae',sourceId:'other_source'}]);
  return {data,expected,calls,read:async k=>{calls.push(k);return structuredClone(data.get(k)??null)}};
}
test('bounded verified metadata identifies a UAE-only bridge and does not claim whole raw/active coverage',async()=>{
  const f=fixture(),r=await proveUaeDelta(f,f.expected);
  assert.equal(r.status,'metadata_bridge_candidate');
  assert.equal(r.fullLocalReplicaVerified,false);
  assert.equal(r.currentlyFreshInventoryVerified,false);
  assert.equal(r.publicationAllowed,false);
  assert.equal(r.objectReads,10);
  assert.doesNotMatch(JSON.stringify(r),/private-id|other_source/);
});
test('already advanced exact cursor is distinct from stale baseline or actual live proof',async()=>{
  const f=fixture(),c=f.data.get(cd),d=f.expected.delta;
  c.sources[0].cursor=d.cursor;c.sources[0].stopReason='source_changes_finished';
  c.durableIntakeArchive={root:`catalog/nonjp-intake/v1/uae/${d.run}/1`,manifestSha256:d.hash};
  const r=await proveUaeDelta(f,f.expected);
  assert.equal(r.status,'delta_cursor_already_present');
  assert.equal(r.currentlyFreshInventoryVerified,false);
});
test('different active UAE count/date or archive binding is not presented as a replay candidate',async()=>{
  const f=fixture();f.data.get(md).markets.uae.count++;
  assert.equal((await proveUaeDelta(f,f.expected)).status,'unknown_current_binding');
});
test('missing/tampered raw metadata or report is rejected',async()=>{
  for(const kind of ['manifest','report']){
    const f=fixture(),key=[...f.data.keys()].find(k=>kind==='manifest'?k.includes('/44636630094/1/complete.json'):k.includes('/44636630094/1/files/report.json/'));
    if(kind==='manifest')f.data.get(key).collection.complete=false;
    else f.data.get(key).payload='AAAA';
    await assert.rejects(proveUaeDelta(f,f.expected));
  }
});
test('a UAE cursor race aborts but an unrelated China/global generation update does not',async()=>{
 const f=fixture();let reads=0;
 const run=await proveUaeDelta({read:async k=>{
   const x=await f.read(k);
   if(k===md&&++reads===2){x.generationId='gen_1994878284419_abcd1234';x.markets.china={changed:true};}
   return x;
 }},f.expected);
 assert.equal(run.status,'metadata_bridge_candidate');
 const g=fixture();let c=0;
 await assert.rejects(proveUaeDelta({read:async k=>{
   const x=await g.read(k);if(k===cd&&++c===2)x.sources[0].cursor++;
   return x;
 }},g.expected),/uae_state_changed_during_read/);
});
