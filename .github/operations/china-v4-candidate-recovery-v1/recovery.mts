import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from './apps/web/lib/data';
import {CHINA_PUBLIC_CONTROL,readChinaPublicState,readConfiguredRegcloudScope,chinaLegacyRollback} from './apps/web/lib/catalog/china-regcloud-object-reader';
const RUN='44765240609', REV='891a5e3ed885872b99487a47b7d88edd172b1665', AT='2026-11-20T17:45:03.110Z';
const PIN_SHA='a14bda5ccf4c4e8a3920ff8858d6bad6a8d5307fad0d706dd8236650a9b4f4d2';
const CONTROL='9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62';
const GEN='gen_1795166586455_china44710087159', DEPLOY_RUN='full-fresh-44710087159-1';
const READY='1080f0664095d3ed784eb1134cf20ab89c0facd33489b82f575eb7d279eb7cb6', CURSOR=13123821;
const ACTIVE_READY='catalog/private-market-stage-v1/china/'+DEPLOY_RUN+'/READY.json';
const pinOperation='che168-intake-'+RUN+'-1', P='catalog/raw-feed-pins/v1/'+pinOperation+'.json';
const R='catalog/provider-replicas/che168/', S='catalog/provider-snapshots/che168/', J='catalog/intake-working/che168-v1/';
const scope={endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',region:'us-east-1',prefix:'migration-staging/full-20261011'};
const SHA=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const uint=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const objectDigest=(x:unknown)=>hash(JSON.stringify(x));
const parse=(b:Buffer)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const need=(ok:unknown,code:string)=>{if(!ok)throw Error('recovery_'+code)};
const M=1024**2, CHUNK=16*M, HEAD_LIMIT=256;
export function derive(pin:any){
 need(pin?.version===1&&pin.operationId===pinOperation&&pin.state==='ready'&&pin.readyAt===AT&&pin.updatedAt===AT&&
   pin.owner?.runId===RUN&&pin.owner?.attempt==='1'&&pin.owner?.revision===REV&&
   pin.releasePolicy==='published_generation_references'&&!pin.coordination&&Array.isArray(pin.references)&&pin.references.length===4,
   'pin_shape');
 const refs=pin.references as {kind:string;root:string;sha256?:string}[];
 need(refs.every(r=>r&&typeof r.root==='string'&&['che168-journal','che168-snapshot','che168-replica'].includes(r.kind))&&new Set(refs.map(x=>x.root)).size===4,'reference_shape');
 const snapshots=refs.filter(r=>r.kind==='che168-snapshot'), journals=refs.filter(r=>r.kind==='che168-journal'), replicas=refs.filter(r=>r.kind==='che168-replica');
 need(snapshots.length===1&&journals.length===1&&replicas.length===2&&replicas.every(r=>r.root.startsWith(R)&&UUID.test(r.root.slice(R.length))),'reference_kinds');
 const old=replicas.filter(x=>SHA.test(x.sha256??'')), next=replicas.filter(x=>!Object.hasOwn(x,'sha256'));
 need(old.length===1&&next.length===1&&snapshots[0].root.startsWith(S),'replica_shape');
 const binding=snapshots[0].root.slice(S.length);
 need(SHA.test(binding),'snapshot_binding');
 const previous={key:old[0].root,binding,cursor:CURSOR,sha256:old[0].sha256};
 const journalBinding=objectDigest({binding,initialCursor:CURSOR,base:previous,replayVersion:2});
 const journalId=BigInt('0x'+journalBinding.slice(0,14)).toString();
 need(journals[0].root===J+journalId,'journal_binding');
 return {previous,candidateRoot:next[0].root,journalBinding,journalKey:J+journalId+'/head.json'};
}
export function classifyReplica(manifest:any,journal:any,expected:ReturnType<typeof derive>){
 need(manifest?.version===1&&manifest.binding===expected.previous.binding&&uint(manifest.cursor)&&manifest.cursor>CURSOR&&
   uint(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=16*1024*M&&Array.isArray(manifest.parts)&&
   manifest.parts.length===Math.ceil(manifest.bytes/CHUNK)&&manifest.parts.length<=1024&&
   manifest.parts.every((p:any,i:number)=>p&&SHA.test(p.sha256)&&p.bytes===Math.min(CHUNK,manifest.bytes-i*CHUNK)),
   'candidate_manifest');
 need(journal?.version===2&&journal.binding===expected.journalBinding&&journal.initialCursor===CURSOR&&journal.cursor===manifest.cursor&&
   uint(journal.changes)&&journal.changes>0&&uint(journal.bytes)&&journal.bytes>0&&journal.bytes<=512*M&&
   uint(journal.rawBytes)&&journal.rawBytes>0&&journal.rawBytes<=8*1024*M&&
   Array.isArray(journal.chunks)&&journal.chunks.length>=1&&journal.chunks.length<=10000&&
   journal.chunks.every((x:any)=>x&&UUID.test(x.id)&&SHA.test(x.sha))&&
   new Set(journal.chunks.map((x:any)=>x.id)).size===journal.chunks.length,'terminal_journal');
 return {cursor:manifest.cursor,declaredReplicaBytes:manifest.bytes,partCount:manifest.parts.length,candidateManifestSha256:objectDigest(manifest),
  journalHeadSha256:objectDigest(journal),journalChunkCount:journal.chunks.length,journalEventCount:journal.changes};
}
async function main(){
 const c=readConfiguredRegcloudScope();
 need(Object.entries(scope).every(([k,v])=>c[k as keyof typeof c]===v),'storage_scope');
 const transport=globalThis.fetch, prefix='/'+scope.bucket+'/'+scope.prefix+'/', allowed=new Set<string>([CHINA_PUBLIC_CONTROL,P,ACTIVE_READY]);
 const heads=new Map<string,number>(), seenSizes=new Map<string,number>(), start=Date.now();
 let gets=0,headCalls=0;
 globalThis.fetch=async(raw,init)=>{
   need((typeof raw==='string'||raw instanceof URL)&&Date.now()-start<160_000,'network_bound');
   const u=new URL(String(raw));
   need(u.origin===scope.endpoint&&!u.search&&!u.hash&&!u.username&&!u.password&&u.pathname.startsWith(prefix),'network_scope');
   const key=decodeURIComponent(u.pathname.slice(prefix.length));
   if(init?.method==='GET'){
     need(init.redirect==='error'&&allowed.has(key)&&++gets<=10,'get_scope');return transport(raw,init);
   }
   need(init?.method==='HEAD'&&heads.has(key)&&++headCalls<=HEAD_LIMIT,'head_scope');
   const r=await transport(raw,{...init,redirect:'error'});
   const length=r.headers.get('content-length'),n=Number(length);
   need(r.status===200&&typeof length==='string'&&/^[1-9]\d{0,8}$/.test(length)&&uint(n)&&n<=heads.get(key)!&&
      !!r.headers.get('etag'),'part_head_unavailable');
   seenSizes.set(key,n);return r;
 };
 try{
  const store=new ObjectJsonStorage(), a=await readChinaPublicState(store);
  if(!a||chinaLegacyRollback(a.state.active))throw Error('recovery_control');
  need(a.checksum===CONTROL&&a.state.revision===5&&a.state.active.generationId===GEN&&a.state.active.runId===DEPLOY_RUN&&a.state.active.readySha256===READY,'control');
  const read=async(k:string,max:number)=>(await store.getBinaryBounded(k,max)).data;
  const [pin,readyBytes]=await Promise.all([read(P,32*1024),read(ACTIVE_READY,32*1024)]);
  need(hash(pin)===PIN_SHA,'pin_hash');need(hash(readyBytes)===READY,'accepted_ready');
  const expected=derive(parse(pin));
  const oldKey=expected.previous.key+'/manifest.json', candidateKey=expected.candidateRoot+'/manifest.json';
  [oldKey,candidateKey,expected.journalKey].forEach(k=>allowed.add(k));
  const [oldBytes,mBytes,jBytes]=await Promise.all([read(oldKey,2*M),read(candidateKey,2*M),read(expected.journalKey,2*M)]);
  const old=parse(oldBytes);
  need(old?.version===1&&old.binding===expected.previous.binding&&old.cursor===CURSOR&&objectDigest(old)===expected.previous.sha256,'accepted_replica');
  const m=parse(mBytes),j=parse(jBytes),metadata=classifyReplica(m,j,expected);
  let partEvidence='held_head_cap';
  if(metadata.partCount<=HEAD_LIMIT){
   for(const [i,p] of m.parts.entries())heads.set(expected.candidateRoot+'/'+i+'.gz',Math.min(17*M,p.bytes+65536));
   const keys=[...heads.keys()];
   for(let i=0;i<keys.length;i+=8)await Promise.all(keys.slice(i,i+8).map(async k=>{
     const v=await store.readObjectMetadata(k);
     need(v.found===true&&typeof v.etag==='string'&&seenSizes.has(k),'part_head_unavailable');
   }));
   partEvidence='metadata_present_not_body_verified';
  }
  const [endPin,endM,endJ,b]=await Promise.all([read(P,32*1024),read(candidateKey,2*M),read(expected.journalKey,2*M),readChinaPublicState(store)]);
  need(hash(endPin)===PIN_SHA&&hash(endM)===hash(mBytes)&&hash(endJ)===hash(jBytes)&&b?.etag===a.etag&&b.checksum===a.checksum,'scope_moved');
  console.log(JSON.stringify({status:'candidate_metadata_only',runId:RUN,generationId:GEN,previouslyAppliedCursor:CURSOR,
   ...metadata,partEvidence,metadataPartCount:seenSizes.size,summedCompressedBytes:[...seenSizes.values()].reduce((x,y)=>x+y,0),
   signedGets:gets,signedHeads:headCalls,sourceInventoryVerified:false,storageWrites:0,supplierRequests:0,publication:false,cursorAdvanced:false}));
 }finally{globalThis.fetch=transport;}
}
if(process.argv.includes('--read-metadata-only')){
 try{await main()}catch(e){const label=e instanceof Error?e.message:'';console.log(JSON.stringify({status:'held',
  reason:/^recovery_[a-z_]+$/.test(label)?label:'signed_metadata_unavailable',storageWrites:0,supplierRequests:0}));process.exitCode=1;}
}
