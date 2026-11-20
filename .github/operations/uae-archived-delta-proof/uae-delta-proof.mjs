import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=v=>hash(JSON.stringify(v));
const hex=/^[a-f0-9]{64}$/;
const LIMIT=18;
const bytes=2*1024*1024;
export const EXPECTED=Object.freeze({
  baseline:Object.freeze({run:'43988535521',hash:'ff7d930aec5ee8b059e28ef06e0ccc6afadd88b89d45df38917f85b44bd966a3',startedAt:'2026-11-17T00:34:23.387Z',completedAt:'2026-11-17T00:48:50.857Z',mode:'snapshot',initialCursor:320508,cursor:320763,pages:1372,rows:27433,changes:255,observations:27688,uniqueOffers:27433}),
  delta:Object.freeze({run:'44636630094',hash:'96ad148930615ee2c317235e46d41bd988f306e112c373ada744eb36e559f054',startedAt:'2026-11-19T23:20:24.748Z',completedAt:'2026-11-19T23:40:39.128Z',mode:'delta',initialCursor:320763,cursor:324989,pages:0,rows:0,changes:4226,observations:2866,uniqueOffers:2777}),
  generation:'gen_1794878284419_a611dfcf',activeAt:'2026-11-17T01:18:04.419Z',activeCount:25484
});
const root=p=>'catalog/nonjp-intake/v1/uae/'+p.run+'/1';
const publication='catalog/manifest.json',cursorKey='catalog/intake-cursors/v1/uae.json';
const source='dubicars_uae_exact',provider='auto_api_dubicars';
const allowedGeneration=/^gen_[1-9]\d{12}_[a-f0-9]{8}$/;
const chunkName=/^chunk-[0-9]{4,6}$/;
const safeNs=/^catalog\/generations\/gen_[1-9]\d{12}_[a-f0-9]{8}\/offers\/uae\/chunk-[0-9]{4,6}\.json$/;
const categories=(v)=>Object.fromEntries([...new Set(v)].map(k=>[k,v.filter(e=>e===k).length]));
const check=(truth,reason)=>assert.ok(truth,reason);

function summary(raw,p,baseline){
  check(raw?.market==='uae'&&raw.provider===provider&&raw.completed===true&&!raw.productionWrites&&!raw.failure
    &&Date.parse(raw.startedAt)<=Date.parse(p.startedAt)&&Date.parse(p.startedAt)-Date.parse(raw.startedAt)<60000&&raw.completedAt===p.completedAt&&Object.hasOwn(raw,'confirmedWithdrawals')&&Array.isArray(raw.confirmedWithdrawals),'archive_report_scope');
  check(Array.isArray(raw.requiredSourceIds)&&raw.requiredSourceIds.includes(source)&&Array.isArray(raw.sources),'archive_required_source');
  const rows=raw.sources.filter(s=>s.sourceId===source);
  check(rows.length===1,'archive_duplicate_source');
  const s=rows[0];
  for (const k of ['startedAt','completedAt','mode','initialCursor','cursor','pages','rows','changes','observations','uniqueOffers']) {
    check(s[k]===p[k],'archive_report_'+k);
  }
  check(s.provider===provider&&s.snapshotStartedAt===baseline.startedAt&&s.rejectedIdentity===0&&
    s.stopReason===(p.mode==='snapshot'?'source_finished':'source_changes_finished'),'archive_source_incomplete');
  const withdrawals=raw.confirmedWithdrawals.filter(item=>item.sourceId===source);
  check(withdrawals.every(w=>w.market==='uae'&&w.status==='removed'&&/^\d+$/.test(String(w.sourceOfferId))),'archive_withdrawal_identity');
  return {run:p.run,mode:p.mode,observedThrough:p.completedAt,snapshotStartedAt:s.snapshotStartedAt,first:s.initialCursor,last:s.cursor,
    rows:s.rows,changes:s.changes,observations:s.observations,uniqueOffers:s.uniqueOffers,requiredSourceCount:raw.requiredSourceIds.length,
    completeForDubiCars:true,explicitWithdrawals:withdrawals.length};
}

export async function proveUaeDelta({read},expected=EXPECTED){
  let requests=0;
  const get=async key=>{check(++requests<=LIMIT,'object_read_budget');return read(key);};
  async function archive(p){
    const r=root(p),m=await get(r+'/complete.json');
    check(m?.version===1&&m.kind==='nonjp-intake'&&m.market==='uae'&&String(m.owner?.runId)===p.run&&String(m.owner?.attempt)==='1'
      &&m.collection?.complete===true&&digest(m)===p.hash&&hex.test(m.reportDigest||''),'archive_manifest_pin');
    check(Array.isArray(m.files)&&m.files.length>2&&m.files.length<=20000,'archive_file_inventory');
    const f=m.files.filter(x=>x.name==='report.json');
    const rawMatch=/^raw-dubicars_uae_exact-\d{6}\.jsonl$/;
    const normalizedMatch=/^dubicars_uae_exact-\d{6}\.jsonl$/;
    const rawFileCount=m.files.filter(x=>rawMatch.test(x.name)).length;
    const normalizedFileCount=m.files.filter(x=>normalizedMatch.test(x.name)).length;
    check(rawFileCount>0&&normalizedFileCount>0,'archive_missing_raw_or_normalized_shards');
    check(f.length===1&&f[0].bytes>0&&f[0].bytes<=bytes&&f[0].parts?.length===1,'archive_report_budget');
    const part=f[0].parts[0];
    check(part.bytes===f[0].bytes&&part.sha256===f[0].sha256&&hex.test(part.sha256)&&part.key===r+'/files/report.json/0-'+part.sha256+'.json','archive_report_locator');
    const wire=await get(part.key);
    check(wire?.version===1&&wire.encoding==='gzip-base64'&&wire.bytes===part.bytes&&wire.sha256===part.sha256&&typeof wire.payload==='string'&&wire.payload.length<=4*1024*1024,'archive_report_wire');
    const compressed=Buffer.from(wire.payload,'base64');
    check(compressed.toString('base64')===wire.payload,'archive_report_encoding');
    const data=gunzipSync(compressed,{maxOutputLength:bytes});
    check(data.length===part.bytes&&hash(data)===part.sha256,'archive_report_file_hash');
    const report=JSON.parse(data.toString());
    check(digest(report)===m.reportDigest,'archive_report_manifest_hash');
    return {...summary(report,p,expected.baseline),manifestSha256:p.hash,rawFileCount,normalizedFileCount,allArchivePartsVerified:false};
  }
  const [current,cursor,baseline,delta]=await Promise.all([get(publication),get(cursorKey),archive(expected.baseline),archive(expected.delta)]);
  check(baseline.last===delta.first&&delta.last>delta.first&&baseline.snapshotStartedAt===delta.snapshotStartedAt,'delta_chain_gap');
  const record=current?.markets?.uae; check(current?.version===2&&allowedGeneration.test(current.generationId||'')&&record&&Number.isSafeInteger(record.count)&&record.count>0&&Number.isFinite(Date.parse(record.updatedAt))&&Array.isArray(record.chunks)&&record.chunks.length>0,'active_uae_unknown');
  check(cursor?.version===1&&cursor.market==='uae'&&allowedGeneration.test(cursor.generationId||'')&&Array.isArray(cursor.sources),'current_uae_cursor_unknown');
  const cursorRow=cursor.sources.filter(r=>r.sourceId===source);
  check(cursorRow.length===1&&cursorRow[0].provider===provider&&cursorRow[0].snapshotStartedAt===baseline.snapshotStartedAt,'current_uae_cursor_identity');
  const state=cursorRow[0];
  const matchesBaseline=state.cursor===baseline.last&&state.stopReason==='source_finished'&&cursor.generationId===expected.generation
    &&cursor.durableIntakeArchive?.root===root(expected.baseline)&&cursor.durableIntakeArchive?.manifestSha256===expected.baseline.hash
    &&record.count===expected.activeCount&&record.updatedAt===expected.activeAt;
  const matchesDelta=state.cursor===delta.last&&state.stopReason==='source_changes_finished'
    &&cursor.durableIntakeArchive?.root===root(expected.delta)&&cursor.durableIntakeArchive?.manifestSha256===expected.delta.hash;
  const paths=[...new Set([record.chunks[0],record.chunks.at(-1)])].map(chunk=>{
    // Normal writers store chunk-NNNNNN identifiers; exact references are also possible.
    const ref=String(chunk);
    if(safeNs.test(ref))return ref;
    check(chunkName.test(ref),'uae_chunk_reference_shape');
    return 'catalog/generations/'+current.generationId+'/offers/uae/'+ref+'.json';
  });
  const arrays=await Promise.all(paths.map(get));
  check(arrays.every(a=>Array.isArray(a)&&a.length>0&&a.length<=500&&a.every(o=>o.market==='uae')),'uae_sample_chunk_invalid');
  const sampleRows=arrays.flat();
  const sourceSummary=categories(sampleRows.map(o=>o.sourceId===source?'DubiCars':'Other or unverified'));
  const [again,againCursor]=await Promise.all([get(publication),get(cursorKey)]);
  // A new China/global generation isn't a reason to retry unless the actual UAE market record changed.
  check(digest(again?.markets?.uae)===digest(record)&&digest(againCursor)===digest(cursor),'uae_state_changed_during_read');
  return {market:'uae',status:matchesBaseline?'metadata_bridge_candidate':matchesDelta?'delta_cursor_already_present':'unknown_current_binding',
    baseline,delta,active:{manifestGenerationId:current.generationId,marketUpdatedAt:record.updatedAt,count:record.count,
      cursorGenerationId:cursor.generationId,cursor:state.cursor,cursorArchiveBoundToBaseline:matchesBaseline,cursorArchiveBoundToDelta:matchesDelta},
    provenanceSample:{chunks:paths.length,rows:sampleRows.length,sourceSummary,wholeMarketVerified:false},
    fullLocalReplicaVerified:false,currentlyFreshInventoryVerified:false,publicationAllowed:false,objectReads:requests,storageWrites:0,supplierRequests:0};
}
