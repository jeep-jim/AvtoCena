/** Plug only a reviewed signed GET function into this native restore wrapper.
 * It cannot create native read-protection pins: policy and state must genuinely be absent,
 * and the object adapter provides no mutation, HEAD, LIST, or broad API. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const policy='catalog/raw-feed-coordination/v1/policy.json',state='catalog/raw-feed-coordination/v1/state.json';
const MiB=1024**2,GiB=1024**3,hex=/^[a-f0-9]{64}$/;
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const need=(v,k)=>{if(!v)throw Error('china_archive_restore_'+k);};
export async function restoreViaBoundedReads({native,receipt,expected,readOnlyGet,localCapsule,assertReadScope,now=Date.now}){
 const source=Date.parse(expected.completedAt);
 const time=()=>need(now()>=source&&now()<source+48*3600000,'source_expired');
 need(typeof readOnlyGet==='function'&&typeof assertReadScope==='function'&&typeof native?.verifyIntakeArchive==='function'&&typeof native?.validateIntakeArchive==='function'&&typeof expected?.archiveRoot==='string'&&receipt?.market==='china','scope');
 need(expected.archiveRoot===receipt.root&&hex.test(expected.archiveSha256||'')&&receipt.manifestSha256===expected.archiveSha256&&receipt.reportDigest===expected.reportSha256&&
  digest(receipt.owner)===digest(expected.collector),'receipt');
 const manifestKey=receipt.root+'/complete.json',pinKey=receipt.handoff?.key;
 need(pinKey==='catalog/raw-feed-pins/v1/nonjp-intake-china-'+expected.collector.runId+'-'+expected.collector.attempt+'.json','pin_scope');
 const keys=new Map([[manifestKey,2*MiB],[pinKey,2*MiB],[policy,256*1024],[state,8*MiB]]);
 let gets=0,wireBytes=0;const hits=new Set();
 async function readJson(key){
  time();const maximumBytes=keys.get(key);need(maximumBytes&&++gets<=7400,'read_allowlist');
  const r=await readOnlyGet(key,maximumBytes);
  need(r?.status===200||r?.status===404,'read_status');
  if(r.status===404){need((key===policy||key===state)&&!r.body,'missing_exact_archive');return null;}
  if(key===policy||key===state)throw Error('china_archive_restore_coordination_present_stop');
  need(Buffer.isBuffer(r.body)&&r.body.length>0&&r.body.length<=maximumBytes,'read_cap');wireBytes+=r.body.length;need(wireBytes<=22*GiB,'wire_budget');
  if(![manifestKey,pinKey].includes(key)){need(!hits.has(key),'duplicate_part');hits.add(key);}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.body));time();return value;
 }
 await assertReadScope();await Promise.all([readJson(policy),readJson(state)]);
 const manifest=await readJson(manifestKey);
 native.validateIntakeArchive(manifest,receipt.root,expected.archiveSha256);
 need(manifest.collection.complete===true&&manifest.market==='china'&&manifest.files.length<=1200&&manifest.totalBytes<=12*GiB,'archive_caps');
 const partCount=manifest.files.reduce((n,x)=>n+x.parts.length,0);need(partCount>0&&partCount<=7350,'parts_cap');
 for(const f of manifest.files)for(const part of f.parts){need(!keys.has(part.key),'duplicate_key');keys.set(part.key,5*MiB);}
 const pin=await readJson(pinKey);
 time();const base=path.dirname(localCapsule);need(path.isAbsolute(localCapsule)&&path.normalize(localCapsule)===localCapsule&&await fs.realpath(base)===base,'output_scope');
 await fs.mkdir(localCapsule,{recursive:false,mode:0o700});
 await fs.writeFile(path.join(localCapsule,'complete.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(localCapsule,'pin.json'),JSON.stringify(pin),{flag:'wx',mode:0o600});
 const directory=path.join(localCapsule,'restored');
 const archive=await native.verifyIntakeArchive({storage:Object.freeze({driver:'object',readJson}),receipt,directory});
 need(digest(archive)===expected.archiveSha256&&hits.size===partCount,'native_readback');
 await assertReadScope();await Promise.all([readJson(policy),readJson(state)]);time();
 return {directory,gets,partCount,archiveBytes:archive.totalBytes,wireBytes,storageWrites:0,supplierRequests:0,publicationAuthorized:false};
}
