import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const GEN=/^gen_(\d+)_[-a-z0-9]+$/i;
const GENERATION_OBJECT=/^catalog\/generations\/(gen_\d+_[-a-z0-9]+)\/[^\\]+$/i;
const INTERNAL_OBJECT=/^catalog\/internal\/offers\/[^/]+\/(gen_\d+_[-a-z0-9]+)-chunk-\d+\.json$/i;
const validKey=k=>typeof k==='string'&&!k.split('/').some(v=>v==='.'||v==='..'||v==='')&&!/[\\\x00-\x1f]/.test(k);
export const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function generationReferences(value,out=new Set()) {
 if(typeof value==='string') for(const match of value.matchAll(/\bgen_\d+_[-a-z0-9]+/gi)) out.add(match[0].replace(/-chunk-\d+$/,''));
 else if(Array.isArray(value))value.forEach(v=>generationReferences(v,out));
 else if(value&&typeof value==='object')Object.values(value).forEach(v=>generationReferences(v,out));
 return out;
}
function validatePublic(manifest,available){
 assert.ok(manifest&&GEN.test(manifest.generationId),'invalid_public_generation');
 assert.ok(manifest.markets&&typeof manifest.markets==='object'&&!Array.isArray(manifest.markets),'invalid_markets');
 assert.ok(Object.keys(manifest.markets).length>0,'empty_public_manifest');
 for(const [market,row] of Object.entries(manifest.markets)){
  assert.match(market,/^[a-z]+$/);assert.ok(Number.isSafeInteger(row?.count)&&row.count>=0&&Array.isArray(row.chunks),'invalid_market');
  assert.ok(row.count===0||row.chunks.length>0,'missing_market_chunks');
  for(const chunk of row.chunks){
   assert.equal(typeof chunk,'string');const key=chunk.startsWith('catalog/')?chunk:`catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
   assert.ok(validKey(key)&&GENERATION_OBJECT.test(key)&&available.has(key),'missing_or_invalid_public_chunk');
  }
 }
}
export function planRegRetention({generationObjects,internalObjects,publicManifest,previousManifest,internalManifest,extraReferences=[],now=Date.now(),maxDeletes=100000,graceMs=86400000}){
 assert.ok(Number.isFinite(now)&&Number.isInteger(maxDeletes)&&maxDeletes>0&&maxDeletes<=250000,'invalid_budget');
 assert.ok(Number.isFinite(graceMs)&&graceMs>=21600000,'unsafe_grace');
 const objects=[...generationObjects,...internalObjects],available=new Set();
 for(const row of objects){assert.ok(validKey(row.key)&&!available.has(row.key),'invalid_or_duplicate_key');assert.ok(Number.isSafeInteger(row.size)&&row.size>=0,'invalid_size');available.add(row.key);}
 validatePublic(publicManifest,available);validatePublic(previousManifest,available);
 assert.ok(internalManifest&&GEN.test(internalManifest.generationId)&&internalManifest.sources&&typeof internalManifest.sources==='object'&&!Array.isArray(internalManifest.sources),'invalid_internal_manifest');
 const referencedInternal=new Set();
 for(const [source,row] of Object.entries(internalManifest.sources)){
  assert.ok(Number.isSafeInteger(row?.count)&&row.count>=0&&Array.isArray(row.chunks)&&(row.count===0||row.chunks.length>0),'invalid_internal_source');
  for(const key of row.chunks){assert.ok(validKey(key)&&INTERNAL_OBJECT.test(key)&&key.startsWith(`catalog/internal/offers/${source}/`)&&available.has(key),'missing_or_invalid_internal_chunk');referencedInternal.add(key);}
 }
 const protectedIds=generationReferences([publicManifest,previousManifest,internalManifest,...extraReferences]);
 const groups=new Map();
 for(const row of generationObjects){const m=row.key.match(GENERATION_OBJECT);if(!m)continue;const group=groups.get(m[1])||[];group.push(row);groups.set(m[1],group);}
 const time=id=>Number(id.match(GEN)?.[1]||0),ids=[...groups.keys()].sort((a,b)=>time(b)-time(a)),cutoff=now-graceMs;
 ids.slice(0,2).forEach(id=>protectedIds.add(id));
 const stale=row=>{const modified=Date.parse(row.lastModified||'');return Number.isFinite(modified)&&modified>0&&modified<cutoff;};
 for(const [id,rows] of groups)if(time(id)<=0||time(id)>=cutoff||rows.some(row=>!stale(row)))protectedIds.add(id);
 const candidates=[];
 for(const id of [...ids].reverse())if(!protectedIds.has(id))candidates.push(...groups.get(id).map(row=>({...row,kind:'generation',generationId:id})));
 for(const row of internalObjects){const m=row.key.match(INTERNAL_OBJECT);if(m&&!referencedInternal.has(row.key)&&!protectedIds.has(m[1])&&time(m[1])>0&&time(m[1])<cutoff&&stale(row))candidates.push({...row,kind:'internal',generationId:m[1]});}
 const selected=candidates.slice(0,maxDeletes),bytes=rows=>rows.reduce((n,r)=>n+r.size,0);
 return {selected,summary:{version:1,at:new Date(now).toISOString(),graceMs,maxDeletes,protectedGenerations:[...protectedIds].sort(),currentGeneration:publicManifest.generationId,previousGeneration:previousManifest.generationId,internalGeneration:internalManifest.generationId,generationObjects:generationObjects.length,internalObjects:internalObjects.length,referencedInternal:referencedInternal.size,candidateObjects:candidates.length,candidateBytes:bytes(candidates),selectedObjects:selected.length,selectedBytes:bytes(selected),remainingObjects:candidates.length-selected.length,selectionDigest:fingerprint(selected.map(r=>[r.key,r.size,r.lastModified]))}};
}
export async function applyExactSelection({selected,checkFence,deleteObjects,onProgress=()=>{},batchSize=500}){
 assert.ok(Number.isInteger(batchSize)&&batchSize>0&&batchSize<=1000);const seen=new Set();
 for(const row of selected){assert.ok(validKey(row.key)&&(GENERATION_OBJECT.test(row.key)||INTERNAL_OBJECT.test(row.key))&&!seen.has(row.key),'unsafe_delete_selection');seen.add(row.key);}
 let acknowledged=0,acknowledgedBytes=0;
 for(let start=0;start<selected.length;start+=batchSize){
  await checkFence();const batch=selected.slice(start,start+batchSize);
  const count=await deleteObjects(batch.map(r=>r.key));assert.equal(count,batch.length,'delete_acknowledgment_mismatch');
  acknowledged+=count;acknowledgedBytes+=batch.reduce((n,r)=>n+r.size,0);await onProgress({acknowledged,acknowledgedBytes});
 }
 await checkFence();return {acknowledged,acknowledgedBytes};
}
