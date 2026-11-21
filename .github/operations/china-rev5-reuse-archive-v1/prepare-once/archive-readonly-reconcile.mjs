// One exact read-only REGCloud archive reconciliation, no supplier/prefix LIST.
import {createHash,createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const M=1024**2,G=1024**3,H=/^[a-f0-9]{64}$/;
const RUN='44866682279',HEAD='8e4edcd606b0ee70b9a9f90d30f795f84ef43950';
const PREV='9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62';
const CONTROL='catalog/independent-market-public-v1/china/control.json';
const ARCHIVE='catalog/nonjp-intake/v1/china/'+RUN+'/1',OP='nonjp-intake-china-'+RUN+'-1',PIN='catalog/raw-feed-pins/v1/'+OP+'.json';
const START=Date.parse('2026-11-21T04:38:10.4817364Z'),STOP=Date.parse('2026-11-21T04:54:44.0635504Z');
export const exact=Object.freeze({CONTROL,ARCHIVE,PIN,RUN,HEAD,OP,PREV});
const need=(v,k)=>{if(!v)throw Error('china_archive_v3_reconcile:'+k);};
const sha=b=>createHash('sha256').update(b).digest('hex'),dig=x=>sha(JSON.stringify(x)),hmac=(k,s)=>createHmac('sha256',k).update(s).digest();
const at=s=>Number.isFinite(Date.parse(s)),owner=o=>o?.runId===RUN&&o.attempt==='1'&&o.revision===HEAD;
function checkArchive(x,expectedWireSha){
 const fileOk=n=>n==='report.json'||/^autohome_used_china_open-\d{6}\.jsonl$/.test(n);
 need(x.version===1&&x.kind==='nonjp-intake'&&x.market==='china'&&owner(x.owner)&&x.collection?.complete===true&&H.test(x.reportDigest)&&
   Array.isArray(x.files)&&x.files.length>=2&&x.files.length<=1201&&Number.isSafeInteger(x.totalBytes)&&x.totalBytes>0&&x.totalBytes<=5*G+128*M,
  'unexpected_complete_structure');
 need(dig(x)===expectedWireSha,'archive_manifest_noncanonical');
 const names=new Set();let bytes=0,parts=0,report=0;
 for(const f of x.files){
  need(fileOk(f?.name)&&!names.has(f.name)&&H.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&
   f.bytes<=(f.name==='report.json'?128*M:8*M)&&Array.isArray(f.parts)&&f.parts.length===Math.ceil(f.bytes/(2*M)),'exact_archive_file_metadata');
  names.add(f.name);bytes+=f.bytes;parts+=f.parts.length;
  if(f.name==='report.json'){need(f.sha256===x.reportDigest,'report_file_digest_not_manifest');report=f.bytes;}
  for(const [i,p] of f.parts.entries())need(H.test(p.sha256)&&p.key===ARCHIVE+'/files/'+f.name+'/'+i+'-'+p.sha256+'.json'&&
    p.bytes===Math.min(2*M,f.bytes-i*2*M),'exact_archive_part_metadata');
 }
 need(bytes===x.totalBytes&&report>0&&parts<=5000,'exact_archive_totals');
 return {files:names.size,parts,totalBytes:bytes,reportBytes:report,reportSha256:x.reportDigest};
}
function checkPin(pin){
 need(pin.version===1&&owner(pin.owner)&&pin.operationId===OP&&['loading','ready'].includes(pin.state)&&
   at(pin.createdAt)&&at(pin.updatedAt)&&Date.parse(pin.createdAt)>=START-1000&&Date.parse(pin.updatedAt)<=STOP+1000&&
   Date.parse(pin.createdAt)<=Date.parse(pin.updatedAt)&&Array.isArray(pin.references)&&pin.references.length>=1&&
   pin.references.length<=20&&new Set(pin.references.map(r=>r.root)).size===pin.references.length,'unexpected_producer_pin');
 const self=pin.references.filter(x=>x.kind==='nonjp-intake');
 need(self.length===1&&self[0].root===ARCHIVE&&(self[0].sha256===undefined||H.test(self[0].sha256)),'archive_pin_self_ref');
 const ready=pin.state==='ready';
 if(ready)need(pin.releasePolicy==='published_generation_references'&&at(pin.readyAt)&&pin.readyAt===pin.updatedAt&&H.test(self[0].sha256),'native_ready_pin');
 return {state:pin.state,updatedAt:pin.updatedAt,readyAt:ready?pin.readyAt:null,hasCoordination:Boolean(pin.coordination),
  rootClaimed:true,rootManifestSha256:self[0].sha256??null,referenceCount:pin.references.length};
}
export async function reconcileVerifiedV3({read}){
 const [ctl,manifest,pin]=await Promise.all([read(CONTROL,32*1024),read(ARCHIVE+'/complete.json',2*M),read(PIN,32*1024)]);
 need(ctl.status===200&&ctl.sha256===PREV&&ctl.json?.revision===5,'rev5_control_changed');
 const base={exactHostedV3:RUN,reads:3,lists:0,writes:0,bodyPartsRead:0,currentRev5Preserved:true,
  completeManifestFound:manifest.status===200,producerPinFound:pin.status===200,canReuseForNativeReadOnlyRestore:false};
 const a=manifest.status===200?checkArchive(manifest.json,manifest.sha256):null;
 const p=pin.status===200?checkPin(pin.json):null;
 if(a&&p&&p.state==='ready'){
  need(p.rootManifestSha256===manifest.sha256,'ready_pin_does_not_bind_complete');
  return {...base,result:'durable_archive_and_ready_pin_recovery_candidate',canReuseForNativeReadOnlyRestore:true,
   archiveManifestSha256:manifest.sha256,...a,pinState:p.state,pinReadyAt:p.readyAt,pinRefs:p.referenceCount,
   fullPayloadVerifiedHere:false,publishAuthorized:false,cursorAdvanceAuthorized:false};
 }
 if(a&&p?.state==='loading'){
  need(p.rootManifestSha256===null||p.rootManifestSha256===manifest.sha256,'loading_pin_manifest_conflict');
  return {...base,result:'complete_but_producer_handoff_not_ready',archiveManifestSha256:manifest.sha256,...a,pinState:p.state,
   pinUpdatedAt:p.updatedAt,pinManifestDigestAttached:p.rootManifestSha256!==null,pinCoordinated:p.hasCoordination};
 }
 if(a||p?.state==='ready')return {...base,result:'incomplete_or_inconsistent_archive_metadata',pinState:p?.state??null};
 if(p)return {...base,result:'producer_pin_loading_no_complete_manifest',pinState:p.state,pinUpdatedAt:p.updatedAt,
  pinManifestDigestAttached:p.rootManifestSha256!==null,pinCoordinated:p.hasCoordination};
 return {...base,result:'archive_and_raw_pin_absent_no_durable_handoff'};
}
export function makeFixedReader({access,secret,fetchImpl=globalThis.fetch,now=Date.now}){
 const host='s3.regru.cloud',prefix='/avtocena-staging-8120751/migration-staging/full-20261011/',region='us-east-1';
 const caps=new Map([[CONTROL,32*1024],[ARCHIVE+'/complete.json',2*M],[PIN,32*1024]]),seen=new Set(),expires=now()+25_000;
 need(typeof access==='string'&&/^[a-zA-Z0-9_+=.\/-]{1,256}$/.test(access)&&typeof secret==='string'&&secret.length>0&&secret.length<=1024,'bounded_existing_stage_role');
 return async(k,cap)=>{
  need(caps.get(k)===cap&&!seen.has(k)&&now()<expires,'exact_metadata_only');seen.add(k);
  const ts=new Date(now()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=ts.slice(0,8),scope=day+'/'+region+'/s3/aws4_request',empty=sha('');
  const fixed=prefix+k,names='host;x-amz-content-sha256;x-amz-date',headers={host,'x-amz-content-sha256':empty,'x-amz-date':ts};
  const canon='GET\n'+fixed+'\n\n'+names.split(';').map(n=>n+':'+headers[n]+'\n').join('')+'\n'+names+'\n'+empty;
  headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+names+', Signature='+
   createHmac('sha256',hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request')).update(['AWS4-HMAC-SHA256',ts,scope,sha(canon)].join('\n')).digest('hex');
  let r;try{r=await fetchImpl('https://'+host+fixed,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(Math.min(12000,expires-now()))});}
  catch{need(false,'metadata_transport');}
  if(r.status===404){await r.body?.cancel?.();return {status:404};}
  const n=Number(r.headers.get('content-length')),tag=r.headers.get('etag');
  if(r.status!==200||!r.body||!Number.isSafeInteger(n)||n<=0||n>cap||!/^"[^"\r\n]{1,128}"$/.test(tag??'')||r.headers.get('content-encoding')){
   await r.body?.cancel?.().catch(()=>{});need(false,r.status!==200&&/^\d{3}$/.test(String(r.status))?'metadata_http_'+r.status:'metadata_wire_bound');
  }
  const buffer=Buffer.alloc(n);let read=0;
  for await(const part of r.body){need((read+part.byteLength)<=n&&now()<expires,'metadata_wire_growth');buffer.set(part,read);read+=part.byteLength;}
  need(read===n,'metadata_short_body');
  try{return {status:200,sha256:sha(buffer),json:JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer))};}
  catch{need(false,'metadata_json');}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const e=process.env;need(e.GITHUB_REPOSITORY==='jeep-jim/AvtoCena'&&e.GITHUB_REPOSITORY_ID==='1289722938'&&e.GITHUB_REF==='refs/heads/main'&&
   e.GITHUB_RUN_ATTEMPT==='1'&&e.GITHUB_JOB==='observe','official_exact_observer');
  const read=makeFixedReader({access:e.REG_ACCESS,secret:e.REG_SECRET});
  console.log(JSON.stringify(await reconcileVerifiedV3({read})));
 }catch(e){const m=String(e?.message??'');console.error(JSON.stringify({result:'held',reason:/^china_archive_v3_reconcile:[a-z0-9_]{1,70}$/.test(m)?m:'metadata_unclassified_hold',writes:0}));
 process.exitCode=1;}
}
