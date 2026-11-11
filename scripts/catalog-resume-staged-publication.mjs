// Resume only an explicitly identified, previously validated immutable generation.
// No source access, canonicalization, chunk rewriting or deletion.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {verifyCatalogReadModels} from '../apps/web/lib/catalog/verify-read-models.ts';
const config=JSON.parse(await fs.readFile('.github/market-runs/china-staged-recovery.json','utf8'));
const {generationId,expectedBaseGenerationId,expectedCounts,failedOperationId}=config;
if(!/^gen_\d+_[a-z0-9]+$/.test(generationId)||!/^gen_\d+_[a-z0-9]+$/.test(expectedBaseGenerationId)||generationId===expectedBaseGenerationId||config.validatedRunId!==39840733509)throw Error('recovery_scope_invalid');
const storage=getJsonStorage(),prefix=`catalog/generations/${generationId}/`,lockPath='catalog/import-lock.json';
const log=(stage,extra={})=>console.log(JSON.stringify({stage,generationId,at:new Date().toISOString(),rss:process.memoryUsage().rss,...extra}));
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
async function anchors(){
 const [manifest,internal,lock]=await Promise.all([storage.readJsonWithMeta('catalog/manifest.json',null),storage.readJson('catalog/internal/manifest.json',null),storage.readJson(lockPath,null)]);
 if(manifest.value?.generationId!==expectedBaseGenerationId||!manifest.etag||internal?.generationId!==generationId)throw Error('recovery_base_or_stage_changed');
 if(Date.parse(lock?.lockedUntil||'')>Date.now()&&lock?.operationId!==failedOperationId&&lock?.operationId!==operationId)throw Error('recovery_other_writer_active');
 return {manifest,internal,lock};
}
const operationId='catalog_staged_recovery_'+crypto.randomUUID();
const initial=await anchors();
const idx=await storage.readJson(prefix+'indexes/offers-by-id.json',null);
if(idx?.generationId!==generationId||!idx.byId)throw Error('recovery_id_index_missing');
const expectedRows=Object.entries(idx.byId).map(([id,loc])=>({id,market:loc.market}));
const counts={};for(const row of expectedRows)counts[row.market]=(counts[row.market]||0)+1;
if(digest(counts)!==digest(expectedCounts))throw Error('recovery_validated_counts_mismatch');
const objects=await storage.listObjects(prefix+'offers/');
const chunks=objects.map(o=>{const m=o.key.slice(prefix.length).match(/^offers\/([a-z]+)\/(chunk-\d{4,})\.json$/);if(!m)throw Error('recovery_chunk_path_invalid');return {path:o.key,market:m[1],chunk:m[2]};});
const markets={};const hashes=new Map(),seen=new Set(),years={};let cursor=0,finished=0;
await Promise.all(Array.from({length:4},async()=>{
 while(cursor<chunks.length){const c=chunks[cursor++];const rows=await storage.readJson(c.path,null);
  if(!Array.isArray(rows)||!rows.length||rows.length>500)throw Error('recovery_chunk_invalid');
  for(const row of rows){const loc=idx.byId[row.id];if(!loc||loc.market!==c.market||loc.chunk!==c.chunk||row.market!==c.market||seen.has(row.id))throw Error('recovery_chunk_id_mismatch');seen.add(row.id);hashes.set(row.id,digest(row));if(row.market==='china'){if(!(row.year>=2014))throw Error('recovery_china_year_invalid');years[row.year]=(years[row.year]||0)+1;}}
  markets[c.market]??={count:0,chunks:[],updatedAt:c.market==='china'?new Date(Number(generationId.split('_')[1])).toISOString():initial.manifest.value.markets[c.market]?.updatedAt};
  markets[c.market].count+=rows.length;markets[c.market].chunks.push(c.chunk);
  finished++;if(finished%50===0||finished===chunks.length)log('saved_chunks_verified',{chunks:finished,offers:seen.size});
 }
}));
if(seen.size!==expectedRows.length)throw Error('recovery_saved_ids_missing');
for(const [market,value]of Object.entries(markets)){value.chunks.sort();if(value.count!==expectedCounts[market]||value.chunks.some((name,i)=>name!==`chunk-${String(i+1).padStart(4,'0')}`))throw Error('recovery_chunk_sequence_invalid');}
// All non-target rows must match the active immutable snapshot exactly.
for(const [market,entry]of Object.entries(initial.manifest.value.markets)){
 if(market==='china')continue;let n=0;
 for(const chunk of entry.chunks){const rows=await storage.readJson(`catalog/generations/${expectedBaseGenerationId}/offers/${market}/${chunk}.json`,null);if(!Array.isArray(rows))throw Error('recovery_baseline_missing');for(const row of rows){if(hashes.get(row.id)!==digest(row))throw Error('recovery_other_market_changed:'+market+':'+row.id);n++;}}
 if(n!==Number(expectedCounts[market]||0))throw Error('recovery_other_market_count:'+market);log('preserved_market_verified',{market,count:n});
}
let last=0;
await verifyCatalogReadModels(storage,generationId,expectedRows,(stage,count)=>{if(Date.now()-last>15000||stage==='details'){last=Date.now();log(stage,{count});}},row=>{if(hashes.get(row.id)!==digest(row))throw Error('recovery_detail_content_changed:'+row.id);});
for(const key of ['catalog/public/facets.json','catalog/public/brand-summary.json',prefix+'indexes/overview.json']){const v=await storage.readJson(key,null);if(v?.generationId!==generationId)throw Error('recovery_selector_generation:'+key);}
const manifest={version:2,generationId,updatedAt:new Date(Number(generationId.split('_')[1])).toISOString(),markets};
const verification={version:1,generationId,expectedBaseGenerationId,verifiedAt:new Date().toISOString(),counts,years,manifest,validatedRunId:config.validatedRunId,published:false};
await fs.writeFile('china-staged-verification.json',JSON.stringify(verification,null,2));log('staged_verification_complete',{counts,years});
if(config.activate===true)throw Error('activation_not_enabled_in_read_only_verifier');
log('verified_only');
