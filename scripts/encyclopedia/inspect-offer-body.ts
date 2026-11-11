import fs from 'node:fs/promises';
import {getJsonStorage} from '../../apps/web/lib/data';
import {detailHash,detailShardPath} from '../../apps/web/lib/catalog/detail-shards';
import {applyEncyclopediaCalculation,checksum,modelKey,token} from '../../apps/web/lib/encyclopedia/calculation-index';
import {canonicalizeSemanticSourceFields} from '../../apps/web/lib/catalog/powertrain-safety';
import {normalizeVehicleOfferSpecs} from '../../apps/web/lib/catalog/spec-normalization';

// Addressed, explicit read-only diagnosis. Never reads all.json or projections.
async function main(){
 const request=JSON.parse(await fs.readFile('.github/market-runs/encyclopedia-body-parity.json','utf8'));
 if(!/^[a-f0-9]{24}$/.test(request.offerId)||!/^gen_[0-9]+_[a-z0-9]+$/.test(request.generationId)||! /^[a-f0-9]{40}$/.test(request.release)||! /^[a-f0-9]{64}$/.test(request.indexDigest))throw Error('body_inspection_request');
 const storage=getJsonStorage();
 if(storage.driver!=='object'||!storage.getBinary||!storage.readObjectMetadata)throw Error('body_inspection_object_storage_required');
 for(const method of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])(storage as any)[method]=async()=>{throw Error('body_inspection_write_forbidden');};
 const pinned=new Map<string,string>();let bytes=0;const deadline=Date.now()+180000;
 async function raw(path:string,maxBytes:number,pin=true){
  if(Date.now()>deadline)throw Error('body_inspection_timeout');
  const before=await storage.readObjectMetadata!(path);
  if(!before.found||!before.etag)throw Error('body_inspection_missing');
  const body=await storage.getBinary!(path);bytes+=body.data.length;
  if(body.data.length>maxBytes||bytes>320*1024*1024)throw Error('body_inspection_bytes_bound');
  if((await storage.readObjectMetadata!(path)).etag!==before.etag)throw Error('body_inspection_changed');
  if(pin)pinned.set(path,before.etag);
  return JSON.parse(body.data.toString('utf8'));
 }
 async function health(){const r=await fetch('https://avtocena.com/api/health',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok)throw Error('body_inspection_health_http');const h=await r.json();if(h.releaseSha!==request.release)throw Error('body_inspection_release_changed');return h;}
 async function writerFree(){const lock=await raw('catalog/import-lock.json',65536,false);if(lock.lockedUntil&&(!Number.isFinite(Date.parse(lock.lockedUntil))||Date.parse(lock.lockedUntil)>Date.now()))throw Error('body_inspection_writer_active');}
 const beforeHealth=await health();await writerFree();
 const manifest=await raw('catalog/manifest.json',1024*1024);if(manifest.generationId!==request.generationId)throw Error('body_inspection_generation_changed');
 const binding=await raw('knowledge/encyclopedia/calculation-releases/'+request.release+'.json',1024*1024);
 if(binding.release!==request.release||binding.digest!==request.indexDigest||!/^knowledge\/encyclopedia\/calculation-indexes\/[a-f0-9]{64}\.json$/.test(binding.key))throw Error('body_inspection_binding');
 const index=await raw(binding.key,256*1024*1024);if(index.digest!==request.indexDigest||checksum(index.models)!==request.indexDigest)throw Error('body_inspection_index_checksum');
 let source:any;
 for(let depth=2;depth<=8;depth++){
  const shard=await raw(detailShardPath(request.generationId,detailHash(request.offerId).slice(0,depth)),16*1024*1024);
  if(shard.generationId!==request.generationId||!Array.isArray(shard.items)||shard.items.length>500)throw Error('body_inspection_shard');
  if(shard.children===true){if(shard.items.length)throw Error('body_inspection_directory');continue;}
  const matches=shard.items.filter((r:any)=>r.id===request.offerId);if(matches.length!==1)throw Error('body_inspection_target_missing');source=matches[0];break;
 }
 if(!source)throw Error('body_inspection_depth_bound');
 const candidates=(index.models[modelKey(source.make,source.model)]||[]).filter((v:any)=>v.year===source.year&&v.trims.includes(token(source.trim)));
 if(candidates.length>20)throw Error('body_inspection_candidate_bound');
 const fields=['id','sourceId','make','model','year','trim','generation','chassisCode','engineCode','fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','power30MinKw','drive','transmission','bodyType'];
 const stage=(row:any)=>({values:Object.fromEntries(fields.map(f=>[f,row[f]??null])),powertrainEvidence:Object.fromEntries(['fuel','powertrainKind','icePowerKw'].map(field=>{const e=row.operational?.semanticEvidence?.[field];return [field,e?{status:e.status,value:e.value,source:e.source,rawValues:Array.isArray(e.rawValues)?e.rawValues.slice(0,8).map((v:unknown)=>String(v).slice(0,120)):[]}:null];})),bodyEvidence:row.operational?.semanticEvidence?.bodyType?{status:row.operational.semanticEvidence.bodyType.status,value:row.operational.semanticEvidence.bodyType.value,source:row.operational.semanticEvidence.bodyType.source,rawValues:Array.isArray(row.operational.semanticEvidence.bodyType.rawValues)?row.operational.semanticEvidence.bodyType.rawValues.slice(0,8).map((value:unknown)=>String(value).slice(0,120)):[]}:null,attestation:row.operational?.encyclopediaCalculation||row.encyclopediaCalculation||null});
 const enriched=applyEncyclopediaCalculation(source,index);
 for(const [path,etag] of pinned)if((await storage.readObjectMetadata!(path)).etag!==etag)throw Error('body_inspection_final_changed');
 await writerFree();const afterHealth=await health();if(beforeHealth.calculationVersion!==afterHealth.calculationVersion)throw Error('body_inspection_calculation_changed');
 const report={checkedAt:new Date().toISOString(),productionWrites:0,bytesRead:bytes,request,beforeHealth,afterHealth,sourceDigest:checksum(source),source:stage(source),enriched:stage(enriched),canonicalized:stage(canonicalizeSemanticSourceFields(enriched)),normalized:stage(normalizeVehicleOfferSpecs(enriched)),candidates:candidates.map((v:any)=>({variantId:v.variantId,revision:v.revision,constraints:v.constraints,bodyType:v.values.bodyType,bodySource:v.sources.bodyType,powertrainKind:v.values.powertrainKind,powertrainSource:v.sources.powertrainKind,icePowerKw:v.values.icePowerKw,icePowerSource:v.sources.icePowerKw}))};
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/encyclopedia-body-parity.json',JSON.stringify(report,null,2)+'\n');console.log('BODY_PARITY_INSPECTION',JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
