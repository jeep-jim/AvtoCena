/** Offline China source admission using the existing pinned native archive validator + converter.
 * No production storage client, provider request, publication or cursor code. */
import fs from 'node:fs/promises';
import {createReadStream,constants as flags} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const MiB=1024**2, GiB=1024**3, hex=/^[a-f0-9]{64}$/;
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>hash(JSON.stringify(v));
export const actual=Object.freeze({market:'china',collector:{runId:'44457059256',attempt:'1',revision:'038574d914de2436cd10871629b1b0a8fe83a92c'},archiveSha256:'b8a2a25dc27390845dd5a423efa323c9472a338b1b97f413ba96aefa7f3b65ca',reportSha256:'894bb1eb1b37042de7ce611e19d8e33bfd58c01546d2a812f2c87f96cd906caf',receiptSha256:'174893f63c5870628a3df1ab3a5241fe49847f01fa579a84d80a369383c3c49a',completedAt:'2026-11-19T05:02:36.435Z',rows:290044,archiveRoot:'catalog/nonjp-intake/v1/china/44457059256/1'});
const fail=k=>{throw Error('china_local_archive_'+k);};
const need=(b,k)=>{if(!b)fail(k);};
const maxTotal=12*GiB, outputCap=16*GiB;
async function raw(file,cap,label,exactBytes){let h;try{h=await fs.open(file,flags.O_RDONLY|flags.O_NOFOLLOW);}catch{fail(label+'_path');}
 try{const s=await h.stat();need(s.isFile()&&s.nlink===1,label+'_file_type');
  need(s.size>0&&s.size<=cap&&(exactBytes===undefined||s.size===exactBytes),label+'_file_size');
  const b=Buffer.alloc(s.size);let offset=0;while(offset<b.length){const r=await h.read(b,offset,b.length-offset,offset);need(r.bytesRead>0,label+'_short');offset+=r.bytesRead;}
  const end=await h.stat();need(end.size===s.size&&end.mtimeMs===s.mtimeMs&&end.ctimeMs===s.ctimeMs,label+'_file_moved');return b;
 }finally{await h.close();}
}
async function json(file,cap,label,exactBytes,expectedSha){const b=await raw(file,cap,label,exactBytes);
 const sha256=hash(b);need(expectedSha===undefined||sha256===expectedSha,label+'_checksum');
 try{return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b)),sha256};}catch{fail(label+'_json');}
}
export function declareNativeArchiveReport(manifest,expectedArchiveSha,expectedReportSha){
 need(digest(manifest)===expectedArchiveSha,'manifest_checksum');const rows=manifest?.files?.filter(r=>r?.name==='report.json');
 need(rows?.length===1,'report_descriptor');const row=rows[0];
 need(Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=128*MiB,'report_declared_size');
 need(row.sha256===expectedReportSha&&Array.isArray(row.parts)&&row.parts.length===Math.ceil(row.bytes/(2*MiB)),'report_descriptor');
 return Object.freeze({bytes:row.bytes,parts:row.parts.length,sha256:row.sha256});
}
async function streamFile(file,bytes,expected,label="archive"){
 const st=await fs.lstat(file);need(st.isFile()&&st.nlink===1&&st.size===bytes&&bytes<=128*MiB,label+'_file_size');let count=0;
 const d=createHash('sha256'),h=await fs.open(file,flags.O_RDONLY|flags.O_NOFOLLOW);
 try{for await(const chunk of h.createReadStream({autoClose:false,highWaterMark:1024*1024})){count+=chunk.length;need(count<=bytes,'archive_file_growth');d.update(chunk);}
 const sha256=d.digest('hex');need(count===bytes&&(await h.stat()).size===bytes&&(!expected||sha256===expected),label+'_file_checksum');return{bytes,sha256};}finally{await h.close();}
}
async function dir(file){need(path.isAbsolute(file)&&await fs.realpath(file)===file&&(await fs.lstat(file)).isDirectory(),'directory_scope');return file;}
function freshness(anchor,now){const at=Date.parse(anchor.completedAt),t=now();need(Number.isSafeInteger(at)&&Number.isSafeInteger(t)&&t>=at&&t<at+48*3600000,'source_expired');return new Date(at+48*3600000).toISOString();}
async function verifyFiles(directory,manifest,beat,expectedReceipt){
 const local=(await fs.readdir(directory)).sort();if(local.includes('own-storage-receipt.json'))need((await json(path.join(directory,'own-storage-receipt.json'),64*1024,'restored_receipt')).sha256===expectedReceipt,'restored_receipt');const names=local.filter(x=>x!=='own-storage-receipt.json'),expected=manifest.files.map(x=>x.name).sort();
 need(JSON.stringify(names)===JSON.stringify(expected),'archive_inventory');
 for(const item of manifest.files){await streamFile(path.join(directory,item.name),item.bytes,item.sha256,item.name==='report.json'?'report_stream':'archive');await beat();}
}
export async function prepare({nativeRoot,receiptPath,archiveManifestPath,rawPinPath,restoredDirectory,outputDirectory,anchor=actual,now=Date.now,minimumFree=48*GiB,minimumMemoryCap=6*GiB,progress=()=>{}}){
 need(anchor.market==='china'&&[anchor.archiveSha256,anchor.reportSha256,anchor.receiptSha256].every(x=>hex.test(x||'')),'anchors');
 const revision=execFileSync('git',['-C',nativeRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 need(revision==='bb6317bffd1f7b1832681ac78378fe6c3e39e3b5','native_revision');
 const sourcePins=JSON.parse(await fs.readFile(new URL('../candidate-final/producer/operational/upstream/flow/input/SOURCE_PINS.json',import.meta.url),'utf8'));
 for(const [file,want] of Object.entries(sourcePins.files))need(await fs.realpath(path.join(nativeRoot,file))===path.join(nativeRoot,file)&&hash(await fs.readFile(path.join(nativeRoot,file)))===want,'native_module_pin');
 need(!execFileSync('git',['-C',nativeRoot,'diff','--name-only','HEAD','--','scripts/lib','scripts/publisher-runtime83','apps/web/lib'],{encoding:'utf8'}).trim(),'native_worktree_changed');
 const boot=(p)=>import(pathToFileURL(path.join(nativeRoot,p)).href);
 const native=await boot('scripts/lib/nonjp-intake-archive.mjs'), provenance=await boot('scripts/lib/catalog-raw-provenance.mjs'), converter=await boot('scripts/lib/catalog-disk-conversion.mjs');
 const parent=await dir(path.dirname(outputDirectory)),input=await dir(restoredDirectory);
 need(input!==parent&&!outputDirectory.startsWith(input+'/')&&path.isAbsolute(outputDirectory)&&path.normalize(outputDirectory)===outputDirectory,'output_scope');
 const check=async()=>{freshness(anchor,now);const v=await fs.statfs(parent,{bigint:true});need(v.bavail*v.bsize>=BigInt(Math.min(minimumFree,2*GiB)),'scratch_exhausted');need(process.memoryUsage().rss<=minimumMemoryCap,'rss_ceiling');};
 if(minimumFree){const v=await fs.statfs(parent,{bigint:true});need(v.bavail*v.bsize>=BigInt(minimumFree),'scratch_admission');}
 await check();
 const [{value:receipt,sha256:receiptSha}, {value:pin}, {value:manifestValue}]=await Promise.all([json(receiptPath,64*1024,'receipt'),json(rawPinPath,2*MiB,'pin'),json(archiveManifestPath,2*MiB,'manifest')]);
 need(receiptSha===anchor.receiptSha256,'receipt_bytes');
 provenance.assertDurableIntakeArchive(receipt);provenance.assertRawPin(pin);
 need(receipt.market==='china'&&digest(receipt.owner)===digest(anchor.collector)&&receipt.root===anchor.archiveRoot&&receipt.manifestSha256===anchor.archiveSha256&&receipt.reportDigest===anchor.reportSha256,'archive_receipt_pins');
 const declared=declareNativeArchiveReport(manifestValue,anchor.archiveSha256,anchor.reportSha256);
 const manifest=native.validateIntakeArchive(manifestValue,anchor.archiveRoot,anchor.archiveSha256);
 progress({stage:'local_archive_metadata_read',receiptBytes:(await fs.stat(receiptPath)).size,pinBytes:(await fs.stat(rawPinPath)).size,manifestBytes:(await fs.stat(archiveManifestPath)).size,reportBytes:declared.bytes,reportParts:declared.parts});
 need(manifest.market==='china'&&manifest.collection.complete===true&&manifest.totalBytes<=maxTotal&&manifest.files.length<=1200&&digest(manifest.owner)===digest(receipt.owner)&&manifest.reportDigest===anchor.reportSha256,'complete_collection');
 need(['ready','published'].includes(pin.state)&&pin.readyAt===receipt.handoff.readyAt&&pin.operationId===receipt.handoff.operationId&&digest(pin.owner)===digest(receipt.handoff.owner)&&digest(pin.references)===receipt.handoff.referencesSha256&&digest(pin.coordination??null)===digest(receipt.handoff.coordination??null),'archive_pin_identity');
 await verifyFiles(input,manifest,check,anchor.receiptSha256);
 const {value:report,sha256:reportSha}=await json(path.join(input,'report.json'),declared.bytes,'report',declared.bytes,declared.sha256);
 need(reportSha===anchor.reportSha256&&report.provider==='auto_api_che168'&&report.completed===true&&report.completedAt===anchor.completedAt,'report_authority');
 if(anchor===actual){const paid=report.sources?.filter(x=>x.provider==='auto_api_che168')??[];
  need(report.market==='china'&&paid.length===1&&paid[0].completeInventory===true&&paid[0].stopReason==='source_finished'&&paid[0].replica&&
   report.sources.reduce((n,x)=>n+Number(x.observations??0),0)===anchor.rows&&!report.sourceInputWitness&&
   report.sourceInputWitnessUnavailable==='che168_replica_witness_worker_source_unverified','report_coverage');}
 const attached=native.attachIntakeArchiveReceipt(report,receipt);
 await fs.mkdir(outputDirectory,{recursive:false,mode:0o700});progress({stage:'authenticated_local_archive',files:manifest.files.length,archiveBytes:manifest.totalBytes});
 // Native disk converter owns its SQLite working data. Wrapper external watchdog
 // must additionally cap process tree/writes; native converter is not a process controller.
 const converted=await converter.convertMarketOnDisk({market:'china',directory:input,files:manifest.files.map(x=>x.name),out:outputDirectory,report:attached});
 need(converted.uniqueObservations===anchor.rows&&converted.market==='china'&&converted.shards>0&&converted.shards<=1200,'converted_census');
 await verifyFiles(input,manifest,check,anchor.receiptSha256);
 const shards=[];let outputBytes=0;
 for(const f of (await fs.readdir(outputDirectory)).sort()){
  need(/^catalog-rebuild-china-[0-9]+\.json$/.test(f),'converted_scope');const file=path.join(outputDirectory,f),st=await fs.lstat(file);
  const row=await streamFile(file,st.size);shards.push({file:f,...row});outputBytes+=row.bytes;need(outputBytes<=outputCap,'converted_disk_cap');await check();
 }
 need(shards.length===converted.shards,'converted_shard_count');
 const stage={version:1,kind:'china-local-confirmed-input-only',sourceCompletedAt:anchor.completedAt,sourceExpiresAt:freshness(anchor,now),sourceRows:converted.uniqueObservations,archiveManifestSha256:anchor.archiveSha256,receiptSha256:anchor.receiptSha256,reportSha256:anchor.reportSha256,shards,shardsSha256:digest(shards),outputBytes,inventoryV2SealIssued:false,priced:false,providerRequests:0,publicationAuthorized:false,cursorAdvanceAuthorized:false};
 await fs.writeFile(path.join(outputDirectory,'LOCAL_ADMISSION.json'),JSON.stringify(stage),{flag:'wx',mode:0o600});
 return stage;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  need(process.argv.length===8,'usage_native_receipt_manifest_pin_restored_out');
  const [nativeRoot,receiptPath,archiveManifestPath,rawPinPath,restoredDirectory,outputDirectory]=process.argv.slice(2);
  globalThis.fetch=async()=>fail('network_denied');
  const a=await prepare({nativeRoot,receiptPath,archiveManifestPath,rawPinPath,restoredDirectory,outputDirectory,
   progress:event=>console.log(JSON.stringify(event))});
  console.log(JSON.stringify({stage:'converted_input_only',sourceRows:a.sourceRows,sourceExpiresAt:a.sourceExpiresAt,shards:a.shards.length,outputBytes:a.outputBytes,shardsSha256:a.shardsSha256,inventoryV2SealIssued:false,publicationAuthorized:false}));
 }catch(e){console.error(JSON.stringify({stage:'archive_admission_failed',error:/^china_local_archive_[a-z0-9_]+$/.test(e?.message||'')?e.message:'native_validation_failed',publicationAuthorized:false}));process.exitCode=1;}
}
