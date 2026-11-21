import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';

const SHA=/^[a-f0-9]{64}$/, ID=/^[a-f0-9]{24}$/, ROOT_GEN=/^gen_[1-9]\d{12}_[a-f0-9]{8}$/;
const SOURCE='dubicars_uae_exact', HORIZON='2026-11-19T23:40:39.128Z', M='catalog/manifest.json', C='catalog/intake-cursors/v1/uae.json';
const B='catalog/nonjp-intake/v1/uae/43988535521/1', D='catalog/nonjp-intake/v1/uae/44636630094/1';
export const ARCHIVE_MANIFESTS=Object.freeze([[B+'/complete.json','ff7d930aec5ee8b059e28ef06e0ccc6afadd88b89d45df38917f85b44bd966a3'],[D+'/complete.json','96ad148930615ee2c317235e46d41bd988f306e112c373ada744eb36e559f054']].map(Object.freeze));
const PIN='289930537687553b4d47d42936cc6c8ed009b1882862e573527d9208fb6b8c2f';
const ALLOWED_ACTIVE=/^catalog\/generations\/gen_[1-9]\d{12}_[a-f0-9]{8}\/offers\/uae\/chunk-\d{4,6}\.json$/;
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Buffer.from(JSON.stringify(v));
const req=(x,c)=>assert.ok(x,c);
const parse=(b,cap)=>{req(Buffer.isBuffer(b)&&b.length>0&&b.length<=cap,'uae_wire_bound');return JSON.parse(b.toString('utf8'));};
const observe=(io,k,cap)=>io.read(k,cap).then(data=>parse(data,cap));
function refs(record,generation) {
  req(record&&Number.isSafeInteger(record.count)&&record.count>0&&record.count<=100000&&Array.isArray(record.chunks)
      &&record.chunks.length>0&&record.chunks.length<=200&&Number.isFinite(Date.parse(record.updatedAt)), 'uae_live_record');
  const keys=record.chunks.map(k=> /^chunk-\d{4,6}$/.test(k)?'catalog/generations/'+generation+'/offers/uae/'+k+'.json':k);
  req(new Set(keys).size===keys.length&&keys.every(k=>ALLOWED_ACTIVE.test(k)), 'uae_live_chunk_path');
  return keys;
}
export async function capturePredecessor(io){
  const [manifest,cursor]=await Promise.all([observe(io,M,1024*1024),observe(io,C,1024*1024)]);
  req(manifest.version===2&&ROOT_GEN.test(manifest.generationId)&&cursor.version===1&&cursor.market==='uae'&&ROOT_GEN.test(cursor.generationId), 'uae_live_scope');
  const record=manifest.markets?.uae, keys=refs(record,manifest.generationId);
  const source=cursor.sources?.filter(x=>x.sourceId===SOURCE);
  req(source?.length===1&&source[0].provider==='auto_api_dubicars'&&source[0].cursor===320763&&source[0].stopReason==='source_finished'
    &&cursor.durableIntakeArchive?.root===B&&cursor.durableIntakeArchive?.manifestSha256===ARCHIVE_MANIFESTS[0][1], 'uae_live_predecessor_not_exact_base');
  return {generation:manifest.generationId,marketRecordSha256:sha(canonical(record)),refsSha256:sha(canonical(keys)),cursorSha256:sha(canonical(cursor)),
     cursor:source[0].cursor, count:record.count, observedAt:record.updatedAt, keys};
}
export function samePredecessor(a,b){return ['marketRecordSha256','refsSha256','cursorSha256','cursor','count','observedAt'].every(k=>a[k]===b[k]);}
const rowCount=(values,p)=>values.reduce((n,v)=>n+Number(p(v)),0);
async function localWire(dir,name,cap){
  const file=path.join(dir,name), s=await lstat(file);
  req(s.isFile()&&!(s.mode&0o077)&&s.size>0&&s.size<=cap&&await realpath(file)===file,'uae_private_local_wire');
  const b=await readFile(file);req(b.length===s.size,'uae_private_local_changed');return b;
}
export async function verifyLocal(dir){
  const s=await lstat(dir);req(path.resolve(dir)===dir&&await realpath(dir)===dir&&s.isDirectory()&&!(s.mode&0o077),'uae_private_local_root');
  const name='manifest-'+PIN+'.json', manifestBytes=await localWire(dir,name,1024*1024);
  req(sha(manifestBytes)===PIN,'uae_exact_source_shadow_manifest');
  const manifest=parse(manifestBytes,1024*1024);
  req(manifest.kind==='uae-source-evidence-shadow'&&manifest.market==='uae'&&manifest.coverage==='dubicars_only'
    &&manifest.fixture===false&&manifest.rows===27581&&manifest.chunks.length===56&&manifest.cursorObserved===324989&&manifest.observedThrough===HORIZON,'uae_shadow_scope');
  const ids=new Map(), chunks=[];
  for(const [i,v] of manifest.chunks.entries()){
    req(v.path==='rows-'+String(i).padStart(5,'0')+'.jsonl'&&SHA.test(v.sha256)&&v.rows>0&&v.rows<=500,'uae_shadow_chunk_descriptor');
    const b=await localWire(dir,v.path,1024*1024);
    req(b.length===v.bytes&&sha(b)===v.sha256,'uae_shadow_chunk_body');
    const lines=b.toString('utf8').trimEnd().split('\n');
    req(lines.length===v.rows,'uae_shadow_chunk_count');
    for(const line of lines){const row=JSON.parse(line);req(ID.test(row.id)&&!ids.has(row.id)&&row.market==='uae'&&row.sourceId===SOURCE,'uae_shadow_offer_identity');ids.set(row.id,row);}
    chunks.push({name:v.path, body:b, sha256:v.sha256});
  }
  req(ids.size===manifest.rows&&(await readdir(dir)).sort().join('\n')===[name,...chunks.map(x=>x.name)].sort().join('\n'),'uae_shadow_complete_membership');
  return {ids,chunks:[...chunks,{name,body:manifestBytes,sha256:PIN}]};
}
export async function compareMembership(io,a,archived){
  const old=new Map();let livePositiveDelivered=0,livePositiveDeliveredMissingSource=0,liveOtherSource=0,liveUnverifiedSource=0;
  for(const key of a.keys){
    const rows=await observe(io,key,8*1024*1024);
    req(Array.isArray(rows)&&rows.length>0&&rows.length<=500,'uae_live_chunk_rows');
    for(const row of rows){
      req(row.market==='uae'&&ID.test(row.id)&&!old.has(row.id),'uae_live_row_membership');
      const sourcePresent=archived.has(row.id), priced=typeof row.totalRub==='number'&&row.totalRub>0&&row.catalogPricingMode!=='seller';
      if(sourcePresent)req(!row.sourceId||row.sourceId===SOURCE,'uae_same_id_foreign_source');
      if(!row.sourceId)liveUnverifiedSource++;else if(row.sourceId!==SOURCE)liveOtherSource++;
      if(priced)livePositiveDelivered++;
      if(priced&&!sourcePresent)livePositiveDeliveredMissingSource++;
      old.set(row.id,sourcePresent);
    }
  }
  req(old.size===a.count,'uae_live_membership_count');
  const sourceOverlap=rowCount([...old.values()],v=>v);
  return {sourceOverlap, archiveOnly:archived.size-sourceOverlap, liveOnly:old.size-sourceOverlap,
    livePositiveDelivered,livePositiveDeliveredMissingSource,liveOtherSource,liveUnverifiedSource,
    exactActiveMembershipCompared:true,saleOrAvailabilityInferred:false,priceOrPhotoParityVerified:false};
}
export async function stage({io,runId,localDir,expectedHealth,getHealth,assertOwner,clock=Date.now}){
  req(/^[1-9]\d{8,14}$/.test(runId)&&/^[a-f0-9]{40}$/.test(expectedHealth?.releaseSha)&&SHA.test(expectedHealth.calculationVersion),'uae_stage_exact_authority');
  const now=clock(), observation=Date.parse(HORIZON);
  req(Number.isSafeInteger(now)&&now>=observation&&now-observation<48*3600000,'uae_archive_outside_review_horizon');
  const base='catalog/operations/uae-source-stage/v1/'+runId+'/attempt-1/';
  const archiveSource=await verifyLocal(localDir);
  const [health,start,owner]=await Promise.all([getHealth(),capturePredecessor(io),assertOwner()]);
  const matches=h=>h?.ok===true&&h.releaseSha===expectedHealth.releaseSha&&h.calculationVersion===expectedHealth.calculationVersion;
  req(matches(health),'uae_serving_release_changed');
  for(const [key,pin] of ARCHIVE_MANIFESTS){
    const body=await observe(io,key,2*1024*1024);req(body?.version===1&&sha(canonical(body))===pin,'uae_durable_archive_pin');
  }
  const delta=await compareMembership(io,start,archiveSource.ids);
  const check=async()=>{const [cur,h,nextOwner]=await Promise.all([capturePredecessor(io),getHealth(),assertOwner()]);req(samePredecessor(start,cur)&&matches(h)&&nextOwner===owner,'uae_live_predecessor_changed');return cur;};
  await check();
  for(const item of archiveSource.chunks){
    req(/^rows-\d{5}\.jsonl$/.test(item.name)||item.name==='manifest-'+PIN+'.json','uae_stage_write_path');
    await io.create(base+item.name,item.body);
    req(sha(await io.read(base+item.name,1024*1024))===item.sha256,'uae_stage_readback');
  }
  const end=await check(),{keys,...predecessor}=start;
  const out={version:1,kind:'private-uae-source-stage-v1',market:'uae',scope:'paid_dubicars_only',
    archiveManifestSha256:PIN,sourceRows:archiveSource.ids.size,cursorObserved:324989,sourceObservedThrough:HORIZON,predecessor,
    currentGenerationAtFinalLiveRead:end.generation,liveMembership:delta,serving:expectedHealth,
    stageShards:archiveSource.chunks.length-1,priceOrPhotoParityVerified:false,currentStockVerified:false,
    supplierRequests:0,publicPointerWrites:0,cursorWrites:0,servable:false,publicationAllowed:false};
  const body=canonical(out), seal=base+'sealed-source-evidence.json';
  await io.create(seal,body);req(sha(await io.read(seal,1024*1024))===sha(body),'uae_stage_seal_readback');
  return {...out, sealSha256:sha(body)};
}
