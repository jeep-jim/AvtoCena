import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
export const CHINA_GENERATION='gen_1794878284419_a611dfcf',CHINA_MANIFEST_SHA='4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038';
export const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const strong=x=>typeof x==='string'&&/^"[^"\r\n]+"$/.test(x);
export async function loadChinaControlChunk({storage,authorizeManifestChunk,generationId,manifestSha256}){
 const initial=await storage.readJsonWithMeta('catalog/manifest.json',null);assert.ok(initial.found&&strong(initial.etag),'china_control_manifest_etag');const manifest=initial.value;assert.equal(manifest.version,2);assert.equal(manifest.generationId,generationId);assert.equal(hash(manifest),manifestSha256,'china_control_manifest_pin');
 const chunks=manifest.markets?.china?.chunks;assert.ok(Array.isArray(chunks)&&chunks.length>0&&chunks.length<=10000);assert.ok(new Set(chunks).size===chunks.length);const chunk=chunks[0];assert.match(chunk,/^[a-zA-Z0-9_-]{1,100}$/);const key=authorizeManifestChunk(chunk,hash(manifest));
 const result=await storage.readJsonWithMeta(key,null);assert.ok(result.found&&strong(result.etag),'china_control_chunk_etag');const rows=result.value;assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=500,'china_control_chunk_rows');assert.ok(Buffer.byteLength(JSON.stringify(rows))<=16*1024**2,'china_control_chunk_bytes');
 const ids=new Set();for(const row of rows){assert.ok(row&&row.market==='china'&&typeof row.id==='string'&&row.id.length<=200&&!ids.has(row.id),'china_control_row_identity');ids.add(row.id);}
 const chunkSha=hash(rows);const verify=async()=>{for(const [path,etag]of [['catalog/manifest.json',initial.etag],[key,result.etag]]){const current=await storage.readObjectMetadata(path);assert.ok(current.found&&current.etag===etag,'china_control_remote_changed');}const current=await storage.readJsonWithMeta('catalog/manifest.json',null);assert.ok(current.found&&current.etag===initial.etag&&hash(current.value)===manifestSha256,'china_control_manifest_changed');const finalChunk=await storage.readJsonWithMeta(key,null);assert.ok(finalChunk.found&&finalChunk.etag===result.etag&&hash(finalChunk.value)===chunkSha,'china_control_chunk_changed');assert.equal(hash(rows),chunkSha,'china_control_local_changed');};
 return{rows,verify,receipt:{generationId,manifestSha256,chunkKey:key,chunkSha256:chunkSha,chunkRows:rows.length,manifestEtagHash:hash(initial.etag),chunkEtagHash:hash(result.etag)}};
}
export function selectChinaControl(rows,anchors){
 const candidates=rows.filter(r=>r.market==='china'&&typeof r.id==='string'&&Number.isFinite(r.sourcePrice)&&r.sourcePrice>0&&!r.editorialPriceKey&&Number.isFinite(r.engineCc)&&r.engineCc>0&&Number.isFinite(r.powerHp)&&r.powerHp>0&&(!r.powertrainKind||r.powertrainKind==='combustion'));
 const cny=candidates.find(r=>r.sourceCurrency==='CNY');if(cny)return{offer:structuredClone(cny),mode:'actual_cny',rowSha256:hash(cny)};
 for(const row of candidates){if(row.sourceCurrency!=='USD')continue;const entry=anchors?.version===1?anchors.entries?.[hash([row.id,row.sourcePrice])]:null;
 if(entry&&entry.sourceCurrency==='USD'&&entry.sourcePrice===row.sourcePrice&&Number.isFinite(entry.sourcePriceCny)&&entry.sourcePriceCny>0&&Number.isFinite(entry.usdRub)&&entry.usdRub>0&&Number.isFinite(entry.cnyRub)&&entry.cnyRub>0&&/^\d{4}-\d{2}-\d{2}$/.test(entry.rateDate))return{offer:structuredClone(row),mode:'actual_usd_with_captured_stored_anchor',rowSha256:hash(row),anchorSha256:hash(entry)};
 }
 assert.fail('china_control_no_eligible_cny_or_stored_anchor');
}
