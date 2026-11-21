import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {guard as need,digest} from '../rev5-successor-core.mjs';
const H=/^[a-f0-9]{64}$/,M=1024**2,G=1024**3,sha=b=>createHash('sha256').update(b).digest('hex');
const POLICY='catalog/raw-feed-coordination/v1/policy.json',STATE='catalog/raw-feed-coordination/v1/state.json';
const safePath=s=>typeof s==='string'&&s.split('/').every(x=>!!x&&x!=='.'&&x!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(x));
async function exactRemovePrivate(file,expected){
 const f=await fs.lstat(file);need(f.isFile()&&f.nlink===1&&(f.mode&0o077)===0&&f.size===expected.bytes&&await fs.realpath(file)===file,'consumed_private_file_scope');
 const hash=createHash('sha256');
 for await(const b of createReadStream(file,{highWaterMark:1024*1024}))hash.update(b);
 const after=await fs.lstat(file);
 need(hash.digest('hex')===expected.sha256&&after.size===f.size&&after.ino===f.ino&&after.mtimeMs===f.mtimeMs&&after.ctimeMs===f.ctimeMs,'consumed_private_file_changed');
 await fs.unlink(file);
}
export async function archiveAndConvert({source,original,archiveModule,converter,owner,scratch,scratchMeter,now=Date.now}){
 need(scratchMeter&&typeof scratchMeter.check==='function','scratch_meter_required');
 await scratchMeter.check('before_private_archive',{force:true});
 need(source.result?.archiveReceiptIssued===false&&source.result?.sourceExpiresAt>now()&&H.test(source.result.localReportSha256)&&
  /^[1-9][0-9]{0,19}$/.test(owner.runId)&&owner.attempt==='1'&&/^[a-f0-9]{40}$/.test(owner.revision),'local_source_proof');
 const ar='catalog/nonjp-intake/v1/china/'+owner.runId+'/1',pin='catalog/raw-feed-pins/v1/nonjp-intake-china-'+owner.runId+'-1.json';
 await source.assertLive(true);
 const [policy,state]=await Promise.all([POLICY,STATE].map(k=>original.readJson(k,null)));
 need(policy===null&&state===null,'new_raw_coordinator_policy_needs_review');
 const privacy=await original.readChinaPrivateStageBucketPrivacy();
 need(typeof privacy?.owner==='string'&&privacy.owner.length>0,'existing_native_bucket_privacy');
 let writes=0,reads=0, listed=false,metadata=0, archiveBytes=0;
 const keys=k=>safePath(k)&&(
  k===ar+'/complete.json'||k.startsWith(ar+'/files/')&&/\/files\/(?:report\.json|autohome_used_china_open-\d{6}\.jsonl)\/\d{1,4}-[a-f0-9]{64}\.json$/.test(k));
 const readOk=k=>keys(k)||k===pin||k===POLICY||k===STATE;
 const fence=async()=>{need(now()<source.result.sourceExpiresAt,'terminal_source_expired');await source.assertLive();};
 const store={
  driver:'object',
  async readJson(k,fallback){
   need(readOk(k)&&++reads<=12500,'archive_key_read_bound');await fence();return original.readJson(k,fallback);
  },
  async readJsonWithMeta(k,fallback){
   need(readOk(k)&&++reads<=12500,'archive_key_read_meta_bound');await fence();return original.readJsonWithMeta(k,fallback);
  },
  async writeJson(k,v,cond){
   need((keys(k)||k===pin)&&++writes<=5000&&cond&&Object.keys(cond).length===1&&
    (cond.ifNoneMatch==='*'||k===pin&&typeof cond.ifMatch==='string'&&cond.ifMatch.length>0),'archive_private_conditional_only');
   need((archiveBytes+=Buffer.byteLength(JSON.stringify(v)))<=2*G,'archive_wire_write_budget');
   await fence();
   return original.writeJson(k,v,cond);
  },
  async listBucketObjects(k){
   // Exactly native archive mandatory reserve metadata, once. No body scan
   // or caller-selected prefix. Existing workflow role already used this.
   need(!listed&&k==='','archive_one_native_capacity_check');listed=true;await fence();
   const a=await original.listBucketObjects('');
   need(Array.isArray(a)&&a.length<=1000000,'native_capacity_metadata_bound');
   metadata=a.length;return a;
  },
 };
 const refs=[
  {kind:'che168-snapshot',root:source.roots.snapshot},
  ...[source.roots.oldReplica,source.roots.newReplica].map(x=>({kind:'che168-replica',root:x.key,sha256:x.sha256})),
  ...[source.roots.originalJournal,source.roots.priorJournal,source.roots.priorJournal2,source.roots.journal].filter(Boolean).map(root=>({kind:'che168-journal',root})),
 ];
 const receipt=await archiveModule.archiveIntakeDirectory({storage:store,directory:source.outputRoot,market:'china',owner,verifiedAdditionalReferences:refs});
 need(receipt.root===ar&&receipt.reportDigest===source.result.localReportSha256&&H.test(receipt.manifestSha256)&&
  receipt.handoff.references.every(x=>x.kind!=='nonjp-intake'||x.root===ar)&&
  refs.every(x=>receipt.handoff.references.some(y=>x.kind===y.kind&&x.root===y.root&&x.sha256===y.sha256)),'actual_native_archive_and_retention');
 const reportFile=path.join(source.outputRoot,'report.json'),raw=await fs.readFile(reportFile);
 need(raw.length<=128*M&&sha(raw)===receipt.reportDigest,'verified_native_report_wire');
 const attached=archiveModule.attachIntakeArchiveReceipt(JSON.parse(raw),receipt),converted=path.join(scratch,'input-converted');
 await fs.mkdir(converted,{mode:0o700});
 const names=(await fs.readdir(source.outputRoot)).filter(n=>n.endsWith('.jsonl'));
 const index=await archiveModule.readIntakeArchiveManifest({storage:store,receipt,readerOwner:owner});
 const nativeFiles=new Map(index.files.filter(v=>v.name.endsWith('.jsonl')).map(v=>[v.name,v]));
 need(nativeFiles.size===names.length&&names.every(n=>nativeFiles.has(n))&&path.dirname(source.outputRoot)===scratch&&path.dirname(converted)===scratch,
   'same_owned_archive_input_files');
 const fileBytes=[...nativeFiles.values()].reduce((n,x)=>n+x.bytes,0);
 await scratchMeter.check('convert_owned_archive_parts',{force:true,needBytes:Math.max(2*G,Math.ceil(fileBytes*1.25)+640*M)});
 let droppedRaw=0;
 const out=await converter.convertMarketOnDisk({market:'china',directory:source.outputRoot,files:names,out:converted,report:attached,
  async afterConsumedFile(n){
   need(nativeFiles.has(n),'consumed_archive_file_unbound');
   await exactRemovePrivate(path.join(source.outputRoot,n),nativeFiles.get(n));
   droppedRaw+=nativeFiles.get(n).bytes;nativeFiles.delete(n);
   await scratchMeter.check('convert_owned_archive_parts');await fence();
  }});
 need(nativeFiles.size===0&&droppedRaw===fileBytes,'every_raw_input_consumed_after_durable_archive');
 await scratchMeter.check('native_conversion_complete',{force:true});
 need(out.market==='china'&&out.uniqueObservations===source.result.observations&&out.shards>0&&out.shards<=1200,'native_converter_census');
 const shards=[];let bytes=0;
 for(const file of (await fs.readdir(converted)).sort()){
  need(/^catalog-rebuild-china-[0-9]+\.json$/.test(file),'native_converted_path');
  const full=path.join(converted,file),st=await fs.lstat(full);
  need(st.isFile()&&st.nlink===1&&st.size>0&&st.size<=128*M&&(bytes+=st.size)<=7*G,'native_converted_size');
  await fs.chmod(full,0o600);
  shards.push({file,bytes:st.size,sha256:sha(await fs.readFile(full))});await fence();
 }
 need(shards.length===out.shards,'native_converted_shards');
 const receiptSha256=digest(receipt),admission={
  version:1,kind:'china-local-confirmed-input-only',sourceCompletedAt:source.result.sourceObservedAt,
  sourceExpiresAt:new Date(source.result.sourceExpiresAt).toISOString(),sourceRows:out.uniqueObservations,archiveManifestSha256:receipt.manifestSha256,
  receiptSha256,reportSha256:receipt.reportDigest,shards,shardsSha256:digest(shards),outputBytes:bytes,inventoryV2SealIssued:false,priced:false,
  providerRequests:0,publicationAuthorized:false,cursorAdvanceAuthorized:false};
 const rawAdmit=Buffer.from(JSON.stringify(admission));
 await fs.writeFile(path.join(converted,'LOCAL_ADMISSION.json'),rawAdmit,{mode:0o600,flag:'wx'});
 await source.assertLive(true);
 const post=await original.readChinaPrivateStageBucketPrivacy();
 need(post.owner===privacy.owner&&post.policySha256===privacy.policySha256,'archive_scope_privacy_drift');
 let released=0;
 return Object.freeze({admission,admissionSha256:sha(rawAdmit),receipt,receiptSha256,converted,reportFile,scratchMeter,
  sourceSeal:source.result,privateArchiveWrites:writes,archiveWireBytes:archiveBytes,nativeCapacityMetadataObjects:metadata,assertLive:source.assertLive,
  async releaseVerifiedConvertedShard(i,expected){
    const one=shards[i];need(released===i&&one?.sha256===expected,'consumed_conversion_shard_scope');
    await exactRemovePrivate(path.join(converted,one.file),one);released++;
  }});
}
