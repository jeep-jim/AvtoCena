/** One-shot manifest-pinned archive restore and native local input admission. No writes to storage. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash,createHmac} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {actual,prepare,declareNativeArchiveReport} from './prepare-native-archive.mjs';import {restoreViaBoundedReads} from './bounded-archive-restore.mjs';
const G=1024**3,M=1024**2,ownedMax=24*G,memMax=6*G,pinPath='catalog/raw-feed-pins/v1/nonjp-intake-china-44457059256-1.json',manifestPath=actual.archiveRoot+'/complete.json';
const policy='catalog/raw-feed-coordination/v1/policy.json',state='catalog/raw-feed-coordination/v1/state.json';
const shape=Object.freeze({files:582,parts:1758,decoded:2760633543,partWire:386094361});
const sourceExpiry=Date.parse(actual.completedAt)+48*3600000;
const hash=b=>createHash('sha256').update(b).digest('hex'),hmac=(k,s)=>createHmac('sha256',k).update(s).digest(),digest=v=>hash(JSON.stringify(v));
const need=(b,s)=>{if(!b)throw Error('guarded_capsule_'+s);};
export function scopeGet({access,secret,manifestParts,currentTime=Date.now,fetchImpl=globalThis.fetch,known=shape}){
 need(typeof access==='string'&&/^[a-zA-Z0-9_+=./-]{1,256}$/.test(access)&&typeof secret==='string'&&secret.length>0&&secret.length<=1024&&!/[\r\n\x00]/.test(secret),'credentials');
 const controls=new Set([pinPath,manifestPath,policy,state]),tally={uniqueArchivePartCount:0,partWireBytes:0},seen=new Set();
 const host='s3.regru.cloud',base='/avtocena-staging-8120751/migration-staging/full-20261011/';
 return Object.freeze({tally,async get(key,limit){
  const p=manifestParts.has(key),control=controls.has(key),now=currentTime();
  need((p!==control)&&!seen.has(key)&&/^[a-zA-Z0-9_./-]{1,700}$/.test(key)&&key.split('/').every(x=>x&&x!=='.'&&x!=='..')&&Number.isSafeInteger(limit)&&limit>0&&limit<=8*M&&now>=Date.parse(actual.completedAt)&&now<sourceExpiry,'request_scope');
  if(p){seen.add(key);need(++tally.uniqueArchivePartCount<=known.parts,'part_count');}
  const pathname=base+key,dateTime=new Date(now).toISOString().replace(/[:-]|\.\d{3}/g,''),day=dateTime.slice(0,8),scope=day+'/us-east-1/s3/aws4_request';
  const headers={host,'x-amz-content-sha256':hash(''),'x-amz-date':dateTime},names=Object.keys(headers).sort();
  const req=['GET',pathname,'',names.map(k=>k+':'+headers[k]+'\n').join(''),names.join(';'),hash('')].join('\n'),sign=hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+names.join(';')+', Signature='+createHmac('sha256',sign).update(['AWS4-HMAC-SHA256',dateTime,scope,hash(req)].join('\n')).digest('hex');
  const result=await fetchImpl('https://'+host+pathname,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(Math.min(30000,Math.max(1,sourceExpiry-now)))});
  if(result.status===404){await result.body?.cancel();return{status:404};}
  const n=Number(result.headers.get('content-length'));
  if(result.status!==200||!Number.isSafeInteger(n)||n<=0||n>limit||result.headers.get('content-encoding')){await result.body?.cancel();throw Error('guarded_capsule_response');}
  if(p){tally.partWireBytes+=n;need(tally.partWireBytes<=known.partWire,'wire_cap');}
  const b=Buffer.alloc(n);let read=0;
  for await(const chunk of result.body){need(read+chunk.length<=n,'body_cap');b.set(chunk,read);read+=chunk.length;}
  need(read===n&&currentTime()<sourceExpiry,'body_size_or_expired');
  return {status:200,body:b};
 }});
}
async function assertSandbox(scratch,minimumFree=2*G){
 const group=(await fs.readFile('/proc/self/cgroup','utf8')).match(/^0::(\/system\.slice\/china-capsule-[0-9]+-[0-9]+\.service)$/m);
 need(group,'cgroup_identity');const root='/sys/fs/cgroup'+group[1];
 const [memory,swap,mounts,p]=await Promise.all(['/memory.max','/memory.swap.max'].map(x=>fs.readFile(root+x,'utf8')).concat(fs.readFile('/proc/self/mountinfo','utf8'),fs.statfs(scratch,{bigint:true})));
 need(memory.trim()===String(memMax)&&swap.trim()==='0','cgroup_hard_limits');
 need(path.isAbsolute(scratch)&&await fs.realpath(scratch)===scratch&&mounts.split('\n').some(l=>{const f=l.split(' ');return f[4]===scratch&&l.includes(' - ext4 /dev/loop')&&/\brw\b/.test(f[5])&&f[5].split(',').includes('nodev')&&f[5].split(',').includes('nosuid')&&f[5].split(',').includes('noexec');}),'scratch_hard_mount');
 need(p.blocks*p.bsize>0n&&p.blocks*p.bsize<=BigInt(ownedMax)&&p.bavail*p.bsize>=BigInt(minimumFree),'scratch_hard_size');
}
async function main(){
 need(process.argv.length===6,'args');
 const [nativeRoot,receiptFile,secretFile,scratch]=process.argv.slice(2);
 await assertSandbox(scratch,18*G);
 const secretStat=await fs.lstat(secretFile);need(secretStat.isFile()&&secretStat.nlink===1&&secretStat.size<=4096&&(secretStat.mode&0o077)===0,'secret_file_scope');
 const {access,secret}=JSON.parse(await fs.readFile(secretFile,'utf8'));
 const receiptBytes=await fs.readFile(receiptFile),receipt=JSON.parse(receiptBytes);need(receiptBytes.length===884&&hash(receiptBytes)===actual.receiptSha256,'receipt');
 const load=f=>import(pathToFileURL(path.join(nativeRoot,f)));
 const native=await load('scripts/lib/nonjp-intake-archive.mjs');
 const allowed=new Set(),forStorage=scopeGet({access,secret,manifestParts:allowed}),nativeFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('guarded_capsule_unexpected_fetch');};
 let acceptedManifest=false;
 const scope=async()=>{need(Date.now()<sourceExpiry,'source_expired');await assertSandbox(scratch);};
 const readOnlyGet=async(key,cap)=>{
  const x=await forStorage.get(key,cap);
  if(key===manifestPath&&x.status===200&&!acceptedManifest){
   const raw=JSON.parse(x.body),declared=declareNativeArchiveReport(raw,actual.archiveSha256,actual.reportSha256);
   const m=native.validateIntakeArchive(raw,actual.archiveRoot,actual.archiveSha256);
   need(m.files.length===shape.files&&m.totalBytes===shape.decoded&&m.files.reduce((n,x)=>n+x.parts.length,0)===shape.parts,'live_census');
   for(const f of m.files)for(const p of f.parts)allowed.add(p.key);
   acceptedManifest=true;console.log(JSON.stringify({stage:'verified_archive_manifest',files:shape.files,parts:shape.parts,restoredBytes:shape.decoded,manifestWireBytes:x.body.length,receiptBytes:receiptBytes.length,reportBytes:declared.bytes,reportParts:declared.parts}));
  }
  if(key===pinPath&&x.status===200)console.log(JSON.stringify({stage:'ready_pin_metadata_read',pinBytes:x.body.length}));
  if(allowed.has(key)&&x.status===200&&(forStorage.tally.uniqueArchivePartCount%100===0||forStorage.tally.uniqueArchivePartCount===shape.parts))
   console.log(JSON.stringify({stage:'archive_part_download',parts:forStorage.tally.uniqueArchivePartCount,totalParts:shape.parts,wireBytes:forStorage.tally.partWireBytes}));
  return x;
 };
 const capsule=path.join(scratch,'capsule');
 const restored=await restoreViaBoundedReads({native,receipt,expected:actual,readOnlyGet,localCapsule:capsule,assertReadScope:scope});
 need(restored.partCount===shape.parts&&restored.archiveBytes===shape.decoded&&forStorage.tally.partWireBytes===shape.partWire,'full_archive_census');
 console.log(JSON.stringify({stage:'archive_bytes_verified',parts:shape.parts,totalBytes:shape.decoded}));
 const outputDirectory=path.join(scratch,'input-converted');
 const result=await prepare({nativeRoot,receiptPath:receiptFile,archiveManifestPath:path.join(capsule,'complete.json'),rawPinPath:path.join(capsule,'pin.json'),
   restoredDirectory:restored.directory,outputDirectory,minimumFree:18*G,minimumMemoryCap:memMax,progress:msg=>console.log(JSON.stringify(msg))});
 await scope();
 const raw=await fs.readFile(path.join(outputDirectory,'LOCAL_ADMISSION.json'));
 console.log(JSON.stringify({stage:'native_sqlite_conversion_admitted',sourceRows:result.sourceRows,shards:result.shards.length,convertedBytes:result.outputBytes,
   admissionSha256:hash(raw),orderedShardInventorySha256:result.shardsSha256,archiveManifestSha256:result.archiveManifestSha256,
   hardCgroupBytes:memMax,hardScratchCeilingBytes:ownedMax,storageWrites:0,rawUploaded:false,providerRequests:0,publicationAuthorized:false,cursorAdvanceAuthorized:false}));
 globalThis.fetch=nativeFetch;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 try{await main();}catch(e){console.error(JSON.stringify({stage:'guarded_capsule_stopped',reason:/^(guarded_capsule_|china_archive_restore_|china_local_archive_)[a-z0-9_]+$/.test(e?.message||'')?e.message:'guard_or_native_refused',publicationAuthorized:false}));process.exitCode=1;}
