/** Zero-provider, zero-write current-rev6 bootstrap. Requires an existing
 * signed read authority for the exact cut; does not accept caller expiry/replica guesses. */
import {gunzipSync} from 'node:zlib';
import {REV6,sha} from './daily-core.mjs';
const M=1024**2,P=2*M,H=/^[a-f0-9]{64}$/,UUID='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const R=new RegExp('^catalog/provider-replicas/che168/'+UUID+'$');
const strict=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const need=(x,k)=>{if(!x)throw Error('china_daily_rev6_bootstrap:'+k);};
const wire=x=>Buffer.from(JSON.stringify(x));
export const V3=Object.freeze({
 owner:Object.freeze({runId:'44866682279',attempt:'1',revision:'8e4edcd606b0ee70b9a9f90d30f795f84ef43950'}),
 root:'catalog/nonjp-intake/v1/china/44866682279/1',
 operationId:'nonjp-intake-china-44866682279-1',
 pin:'catalog/raw-feed-pins/v1/nonjp-intake-china-44866682279-1.json',
 readyAt:'2026-11-21T04:52:21.790Z',
 reportSha256:'4bd587f31c60d8f31c3a8a32b6df4f4eaf51a04e26896e1682271571509601bc',
 reportBytes:4629047,reportParts:3,observations:286546,partCount:1723,fileCount:575,archiveBytes:2688516745,
});
export async function validateAcceptedRev6Bootstrap({read,observe,rawProvenance,snapshotBinding,core=REV6,v3=V3}){
 need([read,observe,rawProvenance?.assertRawPin,rawProvenance?.rawReferences,rawProvenance?.assertDurableIntakeArchive].every(f=>typeof f==='function')&&
  H.test(snapshotBinding??''),'signed_ports_and_snapshot_pin');
 let req=0,received=0;
 const get=async(k,cap)=>{
  const b=await read(k,cap);need(Buffer.isBuffer(b)&&b.length>0&&b.length<=cap&&++req<=6&&(received+=b.length)<=17*M,'read_budget');
  return b;
 };
 const a=await observe();checkCurrent(a,core);
 const [mWire,pWire]=await Promise.all([get(v3.root+'/complete.json',2*M),get(v3.pin,32*1024)]);
 const manifest=strict(mWire),pin=rawProvenance.assertRawPin(strict(pWire));
 need(sha(mWire)===core.archiveSha256&&manifest?.version===1&&manifest.kind==='nonjp-intake'&&manifest.market==='china'&&
  manifest.collection?.complete===true&&sha(manifest.owner)===sha(v3.owner)&&manifest.reportDigest===v3.reportSha256&&
  manifest.totalBytes===v3.archiveBytes&&Array.isArray(manifest.files)&&manifest.files.length===v3.fileCount&&
  manifest.files.every(x=>Array.isArray(x?.parts))&&manifest.files.reduce((i,x)=>i+x.parts.length,0)===v3.partCount&&
  pin?.version===1&&sha(pin.owner)===sha(v3.owner)&&pin.operationId===v3.operationId&&pin.state==='ready'&&pin.readyAt===v3.readyAt&&
  pin.releasePolicy==='published_generation_references'&&pin.coordination===undefined,'exact_manifest_and_producer_pin');
 const entries=manifest.files.filter(f=>f.name==='report.json'),f=entries[0];
 need(entries.length===1&&f.bytes===v3.reportBytes&&f.sha256===v3.reportSha256&&f.parts.length===v3.reportParts&&f.parts.length===Math.ceil(f.bytes/P),'report_descriptor');
 const data=[];
 for(const [i,p] of f.parts.entries()){
  need(p.bytes===Math.min(P,f.bytes-P*i)&&H.test(p.sha256??'')&&p.key===v3.root+'/files/report.json/'+i+'-'+p.sha256+'.json','bounded_report_key');
  const record=strict(await get(p.key,4*M));
  need(record?.version===1&&record.encoding==='gzip-base64'&&record.bytes===p.bytes&&record.sha256===p.sha256&&
    typeof record.payload==='string'&&record.payload.length<=(P+65536)*2,'native_report_part');
  const gz=Buffer.from(record.payload,'base64');need(gz.toString('base64')===record.payload,'native_report_part');
  const b=gunzipSync(gz,{maxOutputLength:p.bytes});need(b.length===p.bytes&&sha(b)===p.sha256,'report_body_hash');data.push(b);
 }
 const reportWire=Buffer.concat(data);need(reportWire.length===f.bytes&&sha(reportWire)===v3.reportSha256,'report_body_complete');
 const report=strict(reportWire),s=report.sources?.[0],replica=s?.replica;
 need(report?.version===1&&report.market==='china'&&report.provider==='auto_api_che168'&&report.productionWrites===false&&report.completed===true&&
  !report.failure&&Date.parse(report.completedAt)===core.sourceObservedAt&&report.sourceMaterialization?.terminalWitnessSha256===core.terminalSha256&&
  report.sources.length===1&&s.sourceId==='autohome_used_china_open'&&s.provider==='auto_api_che168'&&s.completeInventory===true&&s.stopReason==='source_finished'&&
  s.initialCursor===13123821&&s.cursor===core.cursor&&s.uniqueOffers===v3.observations&&s.observations===v3.observations&&s.rejectedIdentity===0&&
  R.test(replica?.key??'')&&replica?.binding===snapshotBinding&&s.snapshotBinding===snapshotBinding&&
  replica.sha256===a.source.cursor.anchorSha256&&replica.cursor===core.cursor,'exact_terminal_replica_lineage');
 const refs=rawProvenance.rawReferences(pin.references);
 need(refs.length===8&&refs.some(x=>x.kind==='nonjp-intake'&&x.root===v3.root&&x.sha256===core.archiveSha256)&&
  refs.some(x=>x.kind==='che168-replica'&&x.root===replica.key&&x.sha256===replica.sha256),'exact_retained_archive_and_replica');
 const receipt=rawProvenance.assertDurableIntakeArchive({version:1,market:'china',owner:manifest.owner,root:v3.root,manifestSha256:core.archiveSha256,reportDigest:v3.reportSha256,
  handoff:{version:1,key:v3.pin,operationId:pin.operationId,owner:pin.owner,readyAt:pin.readyAt,references:refs,referencesSha256:sha(refs)}});
 const receiptBytes=wire(receipt);need(sha(receiptBytes)===a.source.receiptSha256,'byte_exact_receipt_not_live');
 const repManifestWire=await get(replica.key+'/manifest.json',2*M),repManifest=strict(repManifestWire);
 need(sha(repManifestWire)===replica.sha256&&repManifest.version===1&&repManifest.cursor===core.cursor&&repManifest.binding===snapshotBinding&&
  Number.isSafeInteger(repManifest.bytes)&&repManifest.bytes>0&&repManifest.bytes<=4*1024**3&&Array.isArray(repManifest.parts)&&
  repManifest.parts.length===Math.ceil(repManifest.bytes/(16*M))&&repManifest.parts.every((p,i)=>H.test(p?.sha256??'')&&p.bytes===Math.min(16*M,repManifest.bytes-i*16*M)),
  'replica_manifest_not_contiguous');
 const b=await observe();checkCurrent(b,core);need(b.etag===a.etag&&sha(a.source)===sha(b.source),'accepted_cut_changed');
 // Do not print/upload receiptBytes or raw root; pass in same authorized process.
 return {receiptBytes,nativeBase:{accepted:true,market:'china',controlSha256:core.controlSha256,generationId:core.generationId,cursor:core.cursor,
  sourceObservedAt:core.sourceObservedAt,replicaRoot:replica.key,replicaSha256:replica.sha256,snapshotBinding},
  report:{kind:'china_daily_rev6_bootstrap_metadata_verified',generationId:core.generationId,cursor:core.cursor,receiptSha256:sha(receiptBytes),
   readObjects:req,compressedBytesRead:received,replicaParts:repManifest.parts.length,loadedReplicaBodies:0,providerRequests:0,storageWrites:0}};
}
function checkCurrent(a,core){
 need(a?.accepted===true&&a.revision===core.revision&&a.controlSha256===core.controlSha256&&typeof a.etag==='string'&&a.etag.length>0&&
  a.generationId===core.generationId&&a.readySha256===core.readySha256&&a.archiveSha256===core.archiveSha256&&a.source?.complete===true&&
  a.source.observedAt===core.sourceObservedAt&&a.source.cursor?.stream==='che168'&&a.source.cursor.sequence===core.cursor&&
  H.test(a.source.receiptSha256??'')&&H.test(a.source.cursor.anchorSha256??''),'signed_current_rev6');
}
